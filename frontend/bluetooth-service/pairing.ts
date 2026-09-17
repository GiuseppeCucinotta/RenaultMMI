import { EventEmitter } from "node:events";
import { logger } from "./logger.js";
import type { AgentPrompt } from "./agent.js";
import type { AgentPort } from "./ports.js";
import type { BluezDevicePort } from "./ports.js";
import {
  IDLE_PAIRING,
  type BluetoothPairing,
  type BluetoothPairingAction,
  type BluetoothPairingError,
  type BluetoothPairingMethod,
} from "./types.js";

/** BlueZ pairs synchronously; this bounds a phone that never answers. */
const PAIR_TIMEOUT_MS = 45_000;

export interface PairingManagerOptions {
  bluez: BluezDevicePort;
  agent: AgentPort;
}

function isPairingAction(value: string): value is BluetoothPairingAction {
  return (
    value === "pair" ||
    value === "confirm" ||
    value === "reject" ||
    value === "cancel" ||
    value === "submit"
  );
}

function hasName(error: unknown, name: string): boolean {
  const text = error instanceof Error ? error.message : String(error);
  const type = error && typeof error === "object" && "type" in error ? String(error.type) : "";
  return text.includes(name) || type.includes(name);
}

/**
 * Owns the pairing state machine and the prompts BlueZ raises through the
 * agent. It never talks to D-Bus directly — {@link BlueZClient} does — which
 * keeps the entire flow exercisable with a fake client.
 */
export class PairingManager extends EventEmitter {
  private readonly bluez: BluezDevicePort;
  private readonly agent: AgentPort;
  private state: BluetoothPairing = { ...IDLE_PAIRING };
  private inFlight: { devicePath: string; timer: NodeJS.Timeout } | null = null;
  /**
   * Device a prompt belongs to when the agent cannot name it (it caches names
   * from the device map, which may lag a freshly discovered phone).
   */
  private promptedDevicePath: string | null = null;

  constructor(options: PairingManagerOptions) {
    super();
    this.bluez = options.bluez;
    this.agent = options.agent;
    this.agent.on("prompt", (prompt: AgentPrompt) => this.onPrompt(prompt));
    this.agent.on("cancelled", () => this.fail("rejected", "cancelled by the phone"));
    this.agent.on("timeout", () => this.fail("timeout", "the phone did not answer"));
    this.bluez.on("device-connected", (devicePath?: string) => this.onDeviceConnected(devicePath));
  }

  getState(): BluetoothPairing {
    return this.state;
  }

  isPairingDevice(devicePath: string): boolean {
    return this.state.deviceId === devicePath && this.state.stage !== "idle";
  }

  /** Keeps the agent's name cache in sync so prompts show a real label. */
  syncDeviceNames(): void {
    const names = new Map<string, string>();
    for (const device of this.bluez.getDevices()) {
      names.set(device.path, device.alias || device.address);
    }
    this.agent.setDeviceNames(names);
  }

  /**
   * The single entry point for the renderer's pairing buttons.
   *
   * `pair` starts (or re-uses) a connection attempt; `confirm`/`reject`
   * answer a BlueZ prompt; `submit` carries the digits the user typed;
   * `cancel` aborts whatever is running.
   */
  async run(action: BluetoothPairingAction | string, deviceId?: string, value?: string): Promise<BluetoothPairing> {
    if (!isPairingAction(action)) throw new Error(`unknown pairing action: ${action}`);
    this.syncDeviceNames();

    switch (action) {
      case "pair":
        if (!deviceId) throw new Error("pairing requires a device id");
        await this.begin(deviceId);
        break;
      case "confirm":
        this.answer(true);
        break;
      case "reject":
        this.answer(false);
        break;
      case "submit":
        this.submitValue(value);
        break;
      case "cancel":
        await this.cancel();
        break;
    }
    return this.state;
  }

  /* -------------------------------- workflow ------------------------------- */

  private async begin(devicePath: string): Promise<void> {
    const device = this.bluez.getDevice(devicePath);
    if (!device) {
      this.fail("unknown-device", `unknown device ${devicePath}`);
      return;
    }
    if (this.inFlight) return; // one attempt at a time

    this.setState({
      stage: "pairing",
      deviceId: devicePath,
      deviceName: device.alias || device.address,
      method: null,
      passkey: null,
      error: null,
    });

    const timer = setTimeout(() => {
      void this.abort(devicePath);
      this.fail("timeout", "pairing did not finish in time");
    }, PAIR_TIMEOUT_MS);
    timer.unref();
    this.inFlight = { devicePath, timer };

    try {
      // An already-paired phone needs no Pair() (a no-op at best, an error on
      // some stacks): the post-pair hook connects the profiles. Pairing a new
      // phone emits "paired" too, so both paths end in exactly one connect.
      if (!device.paired) {
        await this.bluez.pairDevice(devicePath);
      }
      // Trust so the phone reconnects on its own next time the car starts.
      await this.bluez.setDeviceTrusted(devicePath, true);
      await this.finishSuccess(devicePath);
    } catch (error) {
      this.handleFailure(devicePath, error);
    }
  }

  private async finishSuccess(devicePath: string): Promise<void> {
    this.clearInFlight();
    const device = this.bluez.getDevice(devicePath);
    logger.log(`paired with ${device?.alias ?? devicePath}`);
    this.state = { ...IDLE_PAIRING };
    this.emit("paired", devicePath);
    this.emitState();
  }

  private handleFailure(devicePath: string, error: unknown): void {
    this.clearInFlight();
    const message = error instanceof Error ? error.message : String(error);
    logger.warn(`pairing with ${devicePath} failed: ${message}`);

    if (hasName(error, "AuthenticationCanceled") || hasName(error, "Canceled")) {
      this.fail("rejected", message);
    } else if (hasName(error, "AuthenticationRejected") || hasName(error, "Rejected")) {
      this.fail("rejected", message);
    } else if (hasName(error, "AuthenticationTimeout") || /timed? ?out/i.test(message)) {
      this.fail("timeout", message);
    } else if (hasName(error, "AlreadyExists") || /already (paired|exists)/i.test(message)) {
      // Already paired: treat as success so the UI moves on to "connected".
      void this.finishSuccess(devicePath);
    } else if (hasName(error, "NotReady") || hasName(error, "NotPowered")) {
      this.fail("unavailable", message);
    } else {
      this.fail("failed", message);
    }
  }

  private onPrompt(prompt: AgentPrompt): void {
    const path = prompt.device.path || this.promptedDevicePath;
    this.promptedDevicePath = path;
    const device = path ? this.bluez.getDevice(path) : null;
    const name = prompt.device.name ?? device?.alias ?? device?.address ?? null;
    const method = methodFor(prompt);

    logger.log(`pairing prompt (${prompt.kind}) for ${name ?? path ?? "unknown device"}`);
    this.setState({
      stage: "awaiting-confirmation",
      deviceId: path,
      deviceName: name,
      method,
      // A code shown on both screens is the confirmation code the user compares.
      passkey: "passkey" in prompt ? prompt.passkey : null,
      error: null,
    });
  }

  private answer(accept: boolean): void {
    const method = this.state.method;
    if (method === "passkey-entry") {
      // "confirm" without digits cannot answer a code prompt.
      if (!accept) this.resolvePrompt(this.agent.reject());
      return;
    }
    this.resolvePrompt(accept ? this.agent.confirm(true) : this.agent.reject());
  }

  private submitValue(value: string | undefined): void {
    const digits = (value ?? "").replace(/\D/g, "");
    if (digits.length < 4 || digits.length > 6) {
      logger.warn(`ignoring out-of-range pairing code (${digits.length} digits)`);
      return;
    }
    const answered =
      this.state.method === "passkey-entry"
        ? this.agent.replyPasskey(digits)
        : this.agent.replyPin(digits);
    this.resolvePrompt(answered);
  }

  /**
   * Records that the BlueZ prompt was answered.
   *
   * The prompt is the only part of pairing that blocks, so once it is answered
   * the UI must stop showing it: leaving the state at `awaiting-confirmation`
   * would pin the modal on screen forever even though `Pair()` is already
   * running to completion (which then publishes `idle` or `failed` on its own).
   */
  private resolvePrompt(answered: boolean): void {
    if (!answered) {
      // Nothing was waiting: BlueZ already closed the prompt, or none was open.
      logger.warn("pairing answer ignored: no prompt is waiting");
      return;
    }
    if (this.state.stage !== "awaiting-confirmation") return;
    this.state = { ...this.state, stage: "pairing", passkey: null };
    this.emitState();
  }

  /**
   * Safety net: a phone can finish the pairing itself (the user taps Pair on
   * the handset) or the connection can land before our own reply round-trips.
   * In both cases BlueZ reports the device as connected, and a prompt that is
   * no longer pending must not keep the modal on screen.
   *
   * This deliberately does *not* reject the waiting prompt: if BlueZ is still
   * holding it, cancelling could tear down a pairing that just succeeded. The
   * prompt is left to resolve on its own (or to time out) once the UI stops
   * asking about it.
   */
  private onDeviceConnected(devicePath: string | undefined): void {
    const target = devicePath ?? this.state.deviceId;
    if (!target || this.state.stage !== "awaiting-confirmation") return;
    if (this.state.deviceId && this.state.deviceId !== target) return;
    logger.log(`pairing prompt cleared: ${target} connected`);
    this.state = { ...this.state, stage: "pairing", passkey: null };
    this.emitState();
  }

  private async cancel(): Promise<void> {
    const target = this.state.deviceId;
    this.agent.reject("cancelled on the car screen");
    if (target) await this.abort(target);
    this.clearInFlight();
    this.state = { ...IDLE_PAIRING };
    logger.log("pairing cancelled");
    this.emitState();
  }

  private async abort(devicePath: string): Promise<void> {
    try {
      await this.bluez.cancelPairing(devicePath);
    } catch {
      // Nothing was pairing any more; CancelPairing is best effort.
    }
  }

  private clearInFlight(): void {
    if (!this.inFlight) return;
    clearTimeout(this.inFlight.timer);
    this.inFlight = null;
    this.promptedDevicePath = null;
  }

  private fail(error: BluetoothPairingError, detail: string): void {
    this.clearInFlight();
    logger.warn(`pairing failed (${error}): ${detail}`);
    this.state = {
      stage: "failed",
      deviceId: this.state.deviceId,
      deviceName: this.state.deviceName,
      method: this.state.method,
      passkey: null,
      error,
    };
    this.emit("failed", this.state.deviceId, error);
    this.emitState();
  }

  private setState(next: BluetoothPairing): void {
    this.state = next;
    this.emitState();
  }

  private emitState(): void {
    this.emit("state", this.state);
  }
}

function methodFor(prompt: AgentPrompt): BluetoothPairingMethod {
  switch (prompt.kind) {
    case "confirmation":
    case "display-passkey":
      return "confirm";
    case "passkey":
    case "pin":
      return "passkey-entry";
    case "authorization":
    case "pairing":
      return "confirm";
    default:
      return "just-works";
  }
}
