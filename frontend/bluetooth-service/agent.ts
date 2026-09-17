import { EventEmitter } from "node:events";
import * as dbus from "dbus-next";
import type { MessageBus } from "dbus-next";
import { logger } from "./logger.js";

type AgentInterface = InstanceType<typeof dbus.interface.Interface>;

const AGENT_IFACE = "org.bluez.Agent1";
const AGENT_MANAGER_IFACE = "org.bluez.AgentManager1";

/** Our own well-known name for the agent object; BlueZ tracks its owner. */
const AGENT_SERVICE = "org.renaultmmi.btagent";
const AGENT_PATH = "/org/renaultmmi/btagent";
const AGENT_CAPABILITY = "KeyboardDisplay";

const CANCELED = "org.bluez.Error.Canceled";
const REJECTED = "org.bluez.Error.Rejected";

/** BlueZ `uint32` passkeys must be shown with leading zeros, as typed on the phone. */
export function formatPasskey(value: unknown): string {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return "000000";
  return String(Math.max(0, Math.trunc(numeric))).padStart(6, "0").slice(-6);
}

export interface AgentDeviceInfo {
  path: string;
  name: string | null;
  /** The numeric comparison code, only for confirmation prompts. */
  passkey?: string;
}

/** Requests raised by BlueZ that need a human decision on the car screen. */
export type AgentPrompt =
  | { kind: "pairing"; device: AgentDeviceInfo }
  | { kind: "confirmation"; device: AgentDeviceInfo; passkey: string }
  | { kind: "display-passkey"; device: AgentDeviceInfo; passkey: string }
  | { kind: "display-pin"; device: AgentDeviceInfo; pin: string }
  | { kind: "passkey"; device: AgentDeviceInfo }
  | { kind: "pin"; device: AgentDeviceInfo }
  | { kind: "authorization"; device: AgentDeviceInfo; uuid: string | null };

/**
 * A prompt BlueZ is blocked on. `resolve` takes whatever the Agent1 member is
 * declared to return, so the payload itself stays untyped here.
 */
interface PendingRequest {
  devicePath: string;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

/** BlueZ aborts an unanswered agent request after ~30 s itself; stay under it. */
const PROMPT_TIMEOUT_MS = 25_000;

/**
 * `org.bluez.Agent1` implementation, registered with `KeyboardDisplay`
 * capability.
 *
 * BlueZ calls us in the middle of pairing and blocks until we answer, so every
 * method stores its D-Bus reply and emits a prompt event; the pairing manager
 * (and through it the renderer) answers with {@link confirm} / {@link reject}.
 * An unanswered prompt is rejected after {@link PROMPT_TIMEOUT_MS} so a lost
 * renderer can never wedge the pairing state machine.
 */
export class PairingAgent extends EventEmitter {
  private readonly service: string;
  private readonly path: string;
  private bus: MessageBus | null = null;
  private iface: AgentInterface | null = null;
  private registered = false;
  private ownsName = false;
  private pending: PendingRequest | null = null;
  private deviceNames = new Map<string, string>();

  constructor(options: { service?: string; path?: string } = {}) {
    super();
    this.service = options.service ?? AGENT_SERVICE;
    this.path = options.path ?? AGENT_PATH;
  }

  isRegistered(): boolean {
    return this.registered;
  }

  /** Caches friendly names so prompts can show "Pixel 9" instead of an address. */
  setDeviceNames(names: Map<string, string>): void {
    this.deviceNames = names;
  }

  /**
   * Requests the well-known name and exports the agent, then registers it as
   * the default agent. Returns false when BlueZ is unreachable — pairing then
   * simply cannot prompt, and the service stays up.
   */
  async register(bus: MessageBus): Promise<boolean> {
    if (this.registered) return true;
    this.bus = bus;

    try {
      const reply = await bus.requestName(this.service, 0);
      if (
        reply === dbus.RequestNameReply.PRIMARY_OWNER ||
        reply === dbus.RequestNameReply.ALREADY_OWNER
      ) {
        this.ownsName = true;
      } else {
        logger.warn(`agent name ${this.service} not acquired (reply ${reply}); using the unique name`);
      }
    } catch (error) {
      // Owning a well-known name is introspection sugar: the system bus policy
      // may refuse it, and BlueZ keys agents off the sender's unique name, so
      // this must never stop us from registering.
      logger.warn(
        `agent name ${this.service} refused by bus policy (${errorMessage(error)}); using the unique name`,
      );
    }

    try {
      this.iface = this.createInterface();
      bus.export(this.path, this.iface);
    } catch (error) {
      logger.error("failed to export pairing agent:", errorMessage(error));
      return false;
    }

    try {
      const root = await bus.getProxyObject("org.bluez", "/org/bluez");
      const manager = root.getInterface(AGENT_MANAGER_IFACE) as unknown as {
        RegisterAgent: (path: unknown, capability: string) => Promise<void>;
        RequestDefaultAgent: (path: unknown) => Promise<void>;
      };
      await manager.RegisterAgent(this.path, AGENT_CAPABILITY);
      await manager.RequestDefaultAgent(this.path);
      this.registered = true;
      logger.log(`pairing agent registered (${AGENT_CAPABILITY})`);
      return true;
    } catch (error) {
      logger.error("failed to register pairing agent:", errorMessage(error));
      this.unexport();
      return false;
    }
  }

  async unregister(): Promise<void> {
    const bus = this.bus;
    if (!bus) return;
    try {
      const root = await bus.getProxyObject("org.bluez", "/org/bluez");
      const manager = root.getInterface(AGENT_MANAGER_IFACE) as unknown as {
        UnregisterAgent: (path: unknown) => Promise<void>;
      };
      if (this.registered) await manager.UnregisterAgent(this.path);
    } catch {
      // BlueZ is gone; nothing to unregister.
    }
    this.releaseName();
    this.unexport();
    this.cancelPending("service stopping");
  }

  private unexport(): void {
    const bus = this.bus;
    if (bus && this.iface) {
      try {
        bus.unexport(this.path, this.iface);
      } catch {
        // already gone
      }
    }
    this.iface = null;
    this.registered = false;
    this.bus = null;
  }

  /** True once the agent is the BlueZ default agent and can prompt. */
  canPrompt(): boolean {
    return this.registered;
  }

  /**
   * Drops the well-known name. Only done on shutdown: releasing it while the
   * service keeps running would leave BlueZ pointing at a nameless sender.
   */
  private releaseName(): void {
    const bus = this.bus;
    if (!bus || !this.ownsName) return;
    try {
      void bus.releaseName(this.service);
    } catch {
      // Bus already gone.
    }
    this.ownsName = false;
  }

  /* ----------------------------- answers from UI --------------------------- */

  /** Answers a `confirmation` (numeric comparison) prompt. */
  confirm(accept: boolean): boolean {
    const pending = this.pending;
    if (!pending) return false;
    this.settle(pending, accept);
    return true;
  }

  /** Answers a PIN prompt with the digits typed by the user. */
  replyPin(pin: string): boolean {
    const pending = this.pending;
    if (!pending) return false;
    if (!/^\d{1,16}$/.test(pin)) {
      this.rejectPending(REJECTED, "invalid PIN");
      return false;
    }
    this.finish(pending, pin);
    return true;
  }

  /** Answers a passkey-entry prompt (car types the code shown on the phone). */
  replyPasskey(passkey: string): boolean {
    const pending = this.pending;
    if (!pending) return false;
    const digits = passkey.replace(/\D/g, "").slice(0, 6);
    if (!digits) {
      this.rejectPending(REJECTED, "invalid passkey");
      return false;
    }
    this.finish(pending, Number.parseInt(digits, 10));
    return true;
  }

  /** Answers an authorization prompt (profile access, no user code). */
  authorize(accept: boolean): boolean {
    return this.confirm(accept);
  }

  /** Rejects whatever BlueZ is waiting on; used on cancel/disconnect. */
  reject(reason = "rejected on the car screen"): boolean {
    if (!this.pending) return false;
    this.rejectPending(CANCELED, reason);
    return true;
  }

  private cancelPending(reason: string): void {
    if (this.pending) this.rejectPending(CANCELED, reason);
  }

  private settle(pending: PendingRequest, accept: boolean): void {
    if (accept) this.finish(pending, undefined);
    else this.rejectPending(REJECTED, "declined on the car screen");
  }

  private finish(pending: PendingRequest, value: unknown): void {
    clearTimeout(pending.timer);
    this.pending = null;
    this.emit("prompt-cleared", pending.devicePath);
    pending.resolve(value);
  }

  private rejectPending(type: string, message: string): void {
    const pending = this.pending;
    this.pending = null;
    if (!pending) return;
    clearTimeout(pending.timer);
    this.emit("prompt-cleared", pending.devicePath);
    pending.reject(new dbus.DBusError(type, message));
  }

  /* ------------------------------- agent body ------------------------------ */

  /**
   * Builds the `Agent1` interface. Member configuration is used instead of
   * decorators so the methods keep their `this` binding to this instance.
   */
  private createInterface(): AgentInterface {
    // The D-Bus interface methods are called by dbus-next, so they need the
    // PairingAgent instance rather than their own `this`.
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    const methods: Record<string, { inSignature: string; outSignature: string }> = {
      Release: { inSignature: "", outSignature: "" },
      RequestPinCode: { inSignature: "o", outSignature: "s" },
      DisplayPinCode: { inSignature: "os", outSignature: "" },
      RequestPasskey: { inSignature: "o", outSignature: "u" },
      DisplayPasskey: { inSignature: "ou", outSignature: "" },
      RequestConfirmation: { inSignature: "ou", outSignature: "" },
      RequestAuthorization: { inSignature: "o", outSignature: "" },
      AuthorizeService: { inSignature: "os", outSignature: "" },
      Cancel: { inSignature: "", outSignature: "" },
    };

    class RenaultAgentInterface extends dbus.interface.Interface {
      constructor() {
        super(AGENT_IFACE);
        dbus.interface.Interface.configureMembers.call(RenaultAgentInterface, { methods });
      }

      Release(): void {
        self.onRelease();
      }

      RequestPinCode(device: unknown): Promise<string> {
        return self.ask<string>({ kind: "pin", device: self.describe(device) });
      }

      DisplayPinCode(device: unknown, pin: unknown): void {
        self.announce("display-pin", device, { passkey: String(pin) });
      }

      RequestPasskey(device: unknown): Promise<number> {
        return self.ask<number>({ kind: "passkey", device: self.describe(device) });
      }

      DisplayPasskey(device: unknown, passkey: unknown, entered: unknown): void {
        void entered;
        self.announce("display-passkey", device, { passkey: formatPasskey(passkey) });
      }

      RequestConfirmation(device: unknown, passkey: unknown): Promise<void> {
        return self.ask<void>({
          kind: "confirmation",
          device: self.describe(device),
          passkey: formatPasskey(passkey),
        });
      }

      RequestAuthorization(device: unknown): Promise<void> {
        return self.ask<void>({
          kind: "authorization",
          device: self.describe(device),
          uuid: null,
        });
      }

      AuthorizeService(device: unknown, uuid: unknown): Promise<void> {
        return self.ask<void>({
          kind: "authorization",
          device: self.describe(device),
          uuid: String(uuid),
        });
      }

      Cancel(): void {
        self.onCancel();
      }
    }

    return new RenaultAgentInterface() as unknown as AgentInterface;
  }

  private onRelease(): void {
    logger.log("BlueZ released the pairing agent");
    this.registered = false;
    this.emit("released");
  }

  private onCancel(): void {
    logger.log("BlueZ cancelled the pairing request");
    this.rejectPending(CANCELED, "cancelled by the phone");
    this.emit("cancelled");
  }

  private announce(
    kind: "display-passkey" | "display-pin",
    device: unknown,
    extra: Record<string, string>,
  ): void {
    logger.log(`agent ${kind} for ${devicePathOf(device)}`);
    this.emit("display", kind, this.describe(device), extra);
  }

  private ask<T>(prompt: AgentPrompt): Promise<T> {
    const path = prompt.device.path;
    if (this.pending) {
      // BlueZ serialises prompts in practice; refuse rather than silently drop.
      return Promise.reject(new dbus.DBusError(CANCELED, "another pairing prompt is pending"));
    }
    logger.log(`agent ${prompt.kind} prompt for ${prompt.device.name ?? path}`);

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.rejectPending(CANCELED, "pairing prompt timed out");
        this.emit("timeout", path);
      }, PROMPT_TIMEOUT_MS);
      timer.unref();
      this.pending = {
        devicePath: path,
        resolve: resolve as (value: unknown) => void,
        reject,
        timer,
      };
      this.emit("prompt", prompt);
    });
  }

  private describe(device: unknown): AgentDeviceInfo {
    const path = devicePathOf(device);
    return { path, name: this.deviceNames.get(path) ?? null };
  }
}

function devicePathOf(device: unknown): string {
  if (typeof device === "string") return device;
  if (device && typeof device === "object" && "toString" in device) {
    const text = String(device);
    if (text.startsWith("/")) return text;
  }
  return "";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
