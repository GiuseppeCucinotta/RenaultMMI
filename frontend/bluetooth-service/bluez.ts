import { EventEmitter } from "node:events";
import * as dbus from "dbus-next";
import type { ClientInterface, MessageBus } from "dbus-next";
import { logger } from "./logger.js";
import {
  isPhoneCandidate,
  toAdapterSnapshot,
  type BluezAdapterSnapshot,
  type BluezDeviceSnapshot,
} from "./devices.js";

const BLUEZ_SERVICE = "org.bluez";
const BLUEZ_ROOT = "/";

const OBJECT_MANAGER_IFACE = "org.freedesktop.DBus.ObjectManager";
const PROPERTIES_IFACE = "org.freedesktop.DBus.Properties";
const ADAPTER_IFACE = "org.bluez.Adapter1";
const DEVICE_IFACE = "org.bluez.Device1";
const BATTERY_IFACE = "org.bluez.Battery1";
const PLAYER_IFACE = "org.bluez.MediaPlayer1";

const RESYNC_INTERVAL_MS = 5000;
/** Discovery is a radio inquiry; leaving it on wears the controller and the phones. */
const DISCOVERY_TIMEOUT_MS = 60_000;

export interface BluezTrack {
  title: string | null;
  artist: string | null;
  album: string | null;
  durationMs: number | null;
  /** AVRCP 1.6 cover art handle (only present when an OBEX BIP session is up) */
  imgHandle: string | null;
}

export interface BluezPlayer {
  path: string;
  devicePath: string;
  name: string;
  status: string;
  track: BluezTrack;
  positionMs: number;
  positionAt: number;
  /** BIP OBEX port exposed by the phone (experimental BlueZ, AVRCP cover art) */
  obexPort: number | null;
}

type ManagedObjects = Record<string, Record<string, Record<string, unknown>>>;

/** Injectable bus factory: lets tests run the whole client without a system bus. */
export type BluezBusFactory = () => MessageBus;

export interface BlueZClientOptions {
  /** Overrides `dbus.systemBus()`. Used by tests, never by the service. */
  createBus?: BluezBusFactory;
  /** Show computers/headsets too; driven by `BLUETOOTH_SHOW_ALL_DEVICES`. */
  showAllDevices?: boolean;
}

function unwrap(value: unknown): unknown {
  if (value instanceof dbus.Variant) return unwrap(value.value);
  if (Array.isArray(value)) return value.map((item) => unwrap(item));
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = unwrap(item);
    }
    return out;
  }
  return value;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return null;
}

function asUuidList(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

/** `dev_AA_BB_...` object path → `AA:BB:...`, used when Address is missing. */
function addressFromPath(path: string): string {
  const match = /dev_([0-9A-Fa-f]{2}(?:_[0-9A-Fa-f]{2}){5})$/.exec(path);
  return match ? match[1].replace(/_/g, ":").toUpperCase() : "";
}

/** BlueZ escapes non-alphanumerics in object paths as `_XX` hex. */
function unescapePath(path: string): string {
  return path.replace(/_([0-9A-Fa-f]{2})/g, (_all, hex: string) =>
    String.fromCharCode(Number.parseInt(hex, 16)),
  );
}

/**
 * Thin client over BlueZ (the Linux Bluetooth stack) on the D-Bus system bus.
 *
 * It owns four things and nothing more:
 *  - the `Adapter1` (power, discoverability, inquiry start/stop),
 *  - the device map, including `Battery1` and `Class of Device`,
 *  - A2DP/AVRCP `MediaPlayer1` players, and
 *  - the raw `Device1` operations (pair/connect/disconnect/forget).
 *
 * All policy — which phone is primary, how a pairing prompt is answered,
 * when the scan stops — lives in the managers above this class, so the D-Bus
 * surface stays thin and mockable.
 */
export class BlueZClient extends EventEmitter {
  private readonly options: BlueZClientOptions;
  private bus: MessageBus | null = null;
  private available = false;
  private objectManagerSubscribed = false;
  private adapters = new Map<string, BluezAdapterSnapshot>();
  private devices = new Map<string, BluezDeviceSnapshot>();
  private players = new Map<string, BluezPlayer>();
  private subscribedPaths = new Set<string>();
  private resyncTimer: NodeJS.Timeout | null = null;
  private discoveryTimer: NodeJS.Timeout | null = null;
  private resyncQueued = false;
  private warnedNoObex = false;
  private warnedNoAdapter = false;

  constructor(options: BlueZClientOptions = {}) {
    super();
    this.options = options;
  }

  isAvailable(): boolean {
    return this.available;
  }

  /** The system bus, so the pairing agent can export itself on the same connection. */
  getBus(): MessageBus | null {
    return this.bus;
  }

  /** Out-of-band re-read, used by the `refresh` scan action. */
  resyncNow(): Promise<void> {
    return this.resync();
  }

  /** The controller the service drives; the first adapter BlueZ exposes. */
  getAdapter(): BluezAdapterSnapshot | null {
    return this.adapters.values().next().value ?? null;
  }

  getAdapters(): BluezAdapterSnapshot[] {
    return [...this.adapters.values()];
  }

  getDevices(): BluezDeviceSnapshot[] {
    return [...this.devices.values()];
  }

  getDevice(id: string): BluezDeviceSnapshot | null {
    return this.devices.get(id) ?? null;
  }

  getPlayers(): BluezPlayer[] {
    return [...this.players.values()];
  }

  getPlayer(id: string): BluezPlayer | null {
    return this.players.get(id) ?? null;
  }

  /** Players belonging to a device, newest BlueZ exposes one per device. */
  getPlayersForDevice(devicePath: string): BluezPlayer[] {
    return [...this.players.values()].filter((player) => player.devicePath === devicePath);
  }

  /**
   * Devices that pass the phone filter, paired first. Ordering is otherwise
   * preserved so the list does not jump around between resyncs.
   */
  listPhoneCandidates(): BluezDeviceSnapshot[] {
    const options = { showAll: this.options.showAllDevices ?? false };
    const candidates = this.getDevices().filter((device) => isPhoneCandidate(device, options));
    return candidates.sort((a, b) => Number(b.paired) - Number(a.paired));
  }

  /* ------------------------------- lifecycle ------------------------------ */

  async connect(): Promise<void> {
    if (this.bus) return;

    this.bus = this.options.createBus ? this.options.createBus() : dbus.systemBus();
    this.bus.on("error", (error: unknown) => {
      logger.error("dbus bus error:", error instanceof Error ? error.message : error);
    });
    logger.log("connecting to system D-Bus");

    await this.resync();
    if (this.available) {
      await this.subscribeObjectManager();
    }
    await this.subscribeNameOwnerChanges();

    this.resyncTimer = setInterval(() => void this.resync(), RESYNC_INTERVAL_MS);
  }

  async disconnect(): Promise<void> {
    this.stopDiscoveryTimer();
    if (this.resyncTimer) {
      clearInterval(this.resyncTimer);
      this.resyncTimer = null;
    }
    const bus = this.bus;
    this.bus = null;
    this.adapters.clear();
    this.devices.clear();
    this.players.clear();
    this.subscribedPaths.clear();
    this.objectManagerSubscribed = false;
    this.available = false;
    if (bus) bus.disconnect();
  }

  /* -------------------------------- adapter ------------------------------- */

  private async adapterInterface(method: string): Promise<((...args: unknown[]) => Promise<unknown>) | null> {
    const bus = this.bus;
    const adapter = this.getAdapter();
    if (!bus || !adapter) return null;
    try {
      const object = await bus.getProxyObject(BLUEZ_SERVICE, adapter.path);
      const iface = object.getInterface(ADAPTER_IFACE) as ClientInterface;
      const call = iface[method] as ((...args: unknown[]) => Promise<unknown>) | undefined;
      return call ? call.bind(iface) : null;
    } catch (error) {
      logger.error(`adapter ${method} unavailable:`, errorMessage(error));
      return null;
    }
  }

  private async setAdapterProperty(name: string, value: unknown): Promise<boolean> {
    const bus = this.bus;
    const adapter = this.getAdapter();
    if (!bus || !adapter) return false;
    try {
      const object = await bus.getProxyObject(BLUEZ_SERVICE, adapter.path);
      const props = object.getInterface(PROPERTIES_IFACE) as ClientInterface;
      await (props.Set as (...args: unknown[]) => Promise<unknown>).call(
        props,
        ADAPTER_IFACE,
        name,
        new dbus.Variant(signatureOf(value), value),
      );
      logger.log(`adapter ${name} -> ${String(value)}`);
      return true;
    } catch (error) {
      logger.error(`failed to set adapter ${name}:`, errorMessage(error));
      return false;
    }
  }

  /** Powers the radio. `false` also aborts any running inquiry. */
  async setPowered(powered: boolean): Promise<boolean> {
    if (!powered) await this.stopDiscovery();
    return this.setAdapterProperty("Powered", powered);
  }

  async setPairable(pairable: boolean): Promise<boolean> {
    return this.setAdapterProperty("Pairable", pairable);
  }

  async setDiscoverable(discoverable: boolean): Promise<boolean> {
    // Never let BlueZ time the discoverable window out from under a scan:
    // 0 means "until told otherwise", and stopDiscovery restores it.
    if (discoverable) await this.setDiscoverableTimeout(0);
    const applied = await this.setAdapterProperty("Discoverable", discoverable);
    if (!discoverable) await this.setDiscoverableTimeout(180);
    return applied;
  }

  private async setDiscoverableTimeout(seconds: number): Promise<boolean> {
    return this.setAdapterProperty("DiscoverableTimeout", seconds);
  }

  /**
   * Starts an inquiry and arms a hard timeout, so a renderer that crashes or
   * navigates away can never leave the radio scanning forever.
   */
  async startDiscovery(): Promise<boolean> {
    if (this.getAdapter()?.discovering) {
      this.armDiscoveryTimeout();
      return true;
    }
    const start = await this.adapterInterface("StartDiscovery");
    if (!start) return false;
    try {
      await start();
      logger.log("discovery started");
      const adapter = this.getAdapter();
      if (adapter) adapter.discovering = true;
      this.armDiscoveryTimeout();
      this.emit("changed");
      return true;
    } catch (error) {
      logger.error("startDiscovery failed:", errorMessage(error));
      return false;
    }
  }

  async stopDiscovery(): Promise<boolean> {
    this.stopDiscoveryTimer();
    if (!this.getAdapter()?.discovering) return true;
    const stop = await this.adapterInterface("StopDiscovery");
    if (!stop) return false;
    try {
      await stop();
      logger.log("discovery stopped");
      const adapter = this.getAdapter();
      if (adapter) adapter.discovering = false;
      this.emit("discovery-stopped");
      this.emit("changed");
      return true;
    } catch (error) {
      // BlueZ answers "No discovery started" if it stopped on its own.
      logger.warn("stopDiscovery failed:", errorMessage(error));
      const adapter = this.getAdapter();
      if (adapter) adapter.discovering = false;
      this.emit("discovery-stopped");
      this.emit("changed");
      return false;
    }
  }

  isDiscovering(): boolean {
    return this.getAdapter()?.discovering ?? false;
  }

  private armDiscoveryTimeout(): void {
    this.stopDiscoveryTimer();
    this.discoveryTimer = setTimeout(() => {
      logger.log("discovery timeout reached, stopping scan");
      void this.stopDiscovery();
    }, DISCOVERY_TIMEOUT_MS);
    this.discoveryTimer.unref();
  }

  private stopDiscoveryTimer(): void {
    if (this.discoveryTimer) clearTimeout(this.discoveryTimer);
    this.discoveryTimer = null;
  }

  /* --------------------------------- device ------------------------------- */

  private async deviceInterface(
    devicePath: string,
    ifaceName: string,
    method: string,
  ): Promise<((...args: unknown[]) => Promise<unknown>) | null> {
    const bus = this.bus;
    if (!bus) return null;
    try {
      const object = await bus.getProxyObject(BLUEZ_SERVICE, devicePath);
      const iface = object.getInterface(ifaceName) as ClientInterface;
      const call = iface[method] as ((...args: unknown[]) => Promise<unknown>) | undefined;
      return call ? call.bind(iface) : null;
    } catch (error) {
      logger.error(`${method} on ${devicePath} unavailable:`, errorMessage(error));
      return null;
    }
  }

  /**
   * Calls a `Device1` method. Errors bubble up: the pairing manager needs to
   * distinguish "user rejected" from "already paired" from "timed out".
   */
  async callDevice(devicePath: string, method: string): Promise<void> {
    const call = await this.deviceInterface(devicePath, DEVICE_IFACE, method);
    if (!call) throw new Error(`BlueZ device method ${method} unavailable`);
    logger.log(`device ${method} -> ${devicePath}`);
    await call();
  }

  async setDeviceTrusted(devicePath: string, trusted: boolean): Promise<boolean> {
    const bus = this.bus;
    if (!bus) return false;
    try {
      const object = await bus.getProxyObject(BLUEZ_SERVICE, devicePath);
      const props = object.getInterface(PROPERTIES_IFACE) as ClientInterface;
      await (props.Set as (...args: unknown[]) => Promise<unknown>).call(
        props,
        DEVICE_IFACE,
        "Trusted",
        new dbus.Variant("b", trusted),
      );
      return true;
    } catch (error) {
      logger.warn(`failed to set Trusted=${trusted} on ${devicePath}:`, errorMessage(error));
      return false;
    }
  }

  async pairDevice(devicePath: string): Promise<void> {
    await this.callDevice(devicePath, "Pair");
  }

  async cancelPairing(devicePath: string): Promise<void> {
    await this.callDevice(devicePath, "CancelPairing");
  }

  async connectDevice(devicePath: string): Promise<void> {
    await this.callDevice(devicePath, "Connect");
  }

  async disconnectDevice(devicePath: string): Promise<void> {
    await this.callDevice(devicePath, "Disconnect");
  }

  /** Unpairs: BlueZ drops the link key and the device from the object tree. */
  async forgetDevice(devicePath: string): Promise<void> {
    const adapter = this.getAdapter();
    if (!adapter) throw new Error("no Bluetooth adapter");
    const remove = await this.adapterInterface("RemoveDevice");
    if (!remove) throw new Error("RemoveDevice unavailable");
    logger.log(`forget device ${devicePath}`);
    await remove(devicePath);
  }

  async play(playerPath: string): Promise<void> {
    await this.callPlayer(playerPath, "Play");
  }

  async pause(playerPath: string): Promise<void> {
    await this.callPlayer(playerPath, "Pause");
  }

  async next(playerPath: string): Promise<void> {
    await this.callPlayer(playerPath, "Next");
  }

  async previous(playerPath: string): Promise<void> {
    await this.callPlayer(playerPath, "Previous");
  }

  async stop(playerPath: string): Promise<void> {
    await this.callPlayer(playerPath, "Stop");
  }

  /* --------------------------------- resync ------------------------------- */

  private async resync(): Promise<void> {
    const bus = this.bus;
    if (!bus) return;

    const wasPrimaryPath = this.primaryDevicePath();

    try {
      const root = await bus.getProxyObject(BLUEZ_SERVICE, BLUEZ_ROOT);
      const manager = root.getInterface(OBJECT_MANAGER_IFACE);
      const raw = (await manager.GetManagedObjects()) as unknown;
      const managed = unwrap(raw) as ManagedObjects;

      const adapters = new Map<string, BluezAdapterSnapshot>();
      const devices = new Map<string, BluezDeviceSnapshot>();
      const players = new Map<string, BluezPlayer>();
      const now = Date.now();

      for (const [path, interfaces] of Object.entries(managed)) {
        const adapterProps = interfaces[ADAPTER_IFACE];
        if (adapterProps) {
          const previous = this.adapters.get(path);
          const snapshot = toAdapterSnapshot(path, adapterProps);
          adapters.set(path, snapshot);
          // Discovering is polled by BlueZ: keep our own timeout authoritative
          // so we never report a scan that we already stopped.
          if (previous && previous.discovering !== snapshot.discovering) {
            logger.log(`adapter discovering -> ${snapshot.discovering}`);
          }
        }

        const deviceProps = interfaces[DEVICE_IFACE];
        if (deviceProps) {
          const batteryProps = interfaces[BATTERY_IFACE];
          devices.set(path, {
            path,
            address: asString(deviceProps.Address) ?? addressFromPath(path),
            alias: asString(deviceProps.Alias) ?? asString(deviceProps.Name) ?? "",
            name: asString(deviceProps.Name),
            connected: Boolean(deviceProps.Connected),
            paired: Boolean(deviceProps.Paired),
            trusted: Boolean(deviceProps.Trusted),
            blocked: Boolean(deviceProps.Blocked),
            rssi: asNumber(deviceProps.RSSI),
            classOfDevice: asNumber(deviceProps.Class),
            batteryPercent: asNumber(batteryProps?.Percentage),
            adapterPath: path.slice(0, path.lastIndexOf("/")) || BLUEZ_ROOT,
            uuids: asUuidList(deviceProps.UUIDs),
          });
        }

        const playerProps = interfaces[PLAYER_IFACE];
        if (playerProps) {
          const trackRaw = (playerProps.Track ?? {}) as Record<string, unknown>;
          const durationMs = Number(trackRaw.Duration ?? 0);
          const prev = this.players.get(path);
          const nextPositionMs = Number(playerProps.Position ?? 0);
          const nextStatus = String(playerProps.Status ?? "stopped");
          const samePosition =
            prev != null && prev.positionMs === nextPositionMs && prev.status === nextStatus;

          players.set(path, {
            path,
            devicePath: String(playerProps.Device ?? ""),
            name: String(playerProps.Name ?? ""),
            status: nextStatus,
            track: {
              title: typeof trackRaw.Title === "string" ? trackRaw.Title : null,
              artist: typeof trackRaw.Artist === "string" ? trackRaw.Artist : null,
              album: typeof trackRaw.Album === "string" ? trackRaw.Album : null,
              durationMs: durationMs > 0 ? durationMs : null,
              imgHandle:
                typeof trackRaw.ImgHandle === "string" && trackRaw.ImgHandle
                  ? trackRaw.ImgHandle
                  : null,
            },
            obexPort: typeof playerProps.ObexPort === "number" ? playerProps.ObexPort : null,
            positionMs: nextPositionMs,
            positionAt: samePosition && prev ? prev.positionAt : now,
          });
        }
      }

      this.adapters = adapters;
      this.devices = devices;
      this.players = players;
      this.available = true;
      this.attachSignalListeners();
      if (!this.objectManagerSubscribed) {
        void this.subscribeObjectManager();
      }

      // Bring the cached "discovering" flag back in line with BlueZ, but leave
      // the timeout timer untouched (it is the only thing that stops the scan).
      const adapter = this.getAdapter();
      if (adapter && Object.keys(managed).length > 0) {
        const live = Object.entries(managed).find(([, ifaces]) => ifaces[ADAPTER_IFACE]);
        if (live) adapter.discovering = Boolean(live[1][ADAPTER_IFACE]?.Discovering);
      }

      this.warnIfNoAdapter();
      this.reportResync(wasPrimaryPath);
      this.emit("changed");
    } catch (error) {
      if (this.available) {
        logger.error("bluez unavailable:", errorMessage(error));
      }
      this.available = false;
      this.adapters.clear();
      this.devices.clear();
      this.players.clear();
      this.emit("bluez-unavailable");
    }
  }

  private warnIfNoAdapter(): void {
    const missing = this.adapters.size === 0;
    if (missing && !this.warnedNoAdapter) {
      logger.warn("BlueZ is up but exposes no Adapter1 (no Bluetooth controller?)");
    }
    this.warnedNoAdapter = missing;
  }

  private reportResync(wasPrimaryPath: string | null): void {
    const primary = this.primaryDevicePath();
    if (wasPrimaryPath !== primary) {
      const device = primary ? this.devices.get(primary) : null;
      logger.log(
        device
          ? `active device: ${device.alias} (${device.address})`
          : "no connected phone",
      );
      this.emit(primary ? "device-connected" : "device-disconnected", primary);
    }

    const activePlayer = this.getActivePlayer();
    logger.log(
      `resync: ${this.adapters.size} adapter(s), ${this.devices.size} device(s), ` +
        `${this.players.size} player(s)` +
        (activePlayer
          ? ` | player: ${activePlayer.name}` +
            (activePlayer.track.title ? ` | "${activePlayer.track.title}"` : "") +
            ` | status=${activePlayer.status} pos=${activePlayer.positionMs}ms` +
            (activePlayer.obexPort != null ? ` | obexPort=${activePlayer.obexPort}` : "")
          : ""),
    );

    const experimental = [...this.players.values()].some((player) => player.obexPort != null);
    if (!experimental && this.players.size > 0 && !this.warnedNoObex) {
      logger.warn(
        "no player exposes ObexPort -> cover art unavailable " +
          "(bluetoothd must run with --experimental; reconnect the phone after enabling)",
      );
    }
    this.warnedNoObex = !experimental;
  }

  /**
   * The device that owns the audio path: a connected device with a media
   * player wins, then any connected audio-profile device. Deliberately
   * unchanged from the AVRCP-only era so media behaviour is stable.
   */
  primaryDevicePath(): string | null {
    for (const player of this.players.values()) {
      const device = this.devices.get(player.devicePath);
      if (device?.connected) return player.devicePath;
    }
    for (const device of this.devices.values()) {
      if (device.connected && playerlessAudioDevice(device)) return device.path;
    }
    return null;
  }

  getActiveDevice(): BluezDeviceSnapshot | null {
    const path = this.primaryDevicePath();
    return path ? (this.devices.get(path) ?? null) : null;
  }

  getActivePlayer(): BluezPlayer | null {
    const device = this.getActiveDevice();
    if (!device) return null;
    return this.getPlayersForDevice(device.path)[0] ?? null;
  }

  /* ------------------------------- signals -------------------------------- */

  private queueResync(): void {
    if (this.resyncQueued) return;
    this.resyncQueued = true;
    setTimeout(() => {
      this.resyncQueued = false;
      void this.resync();
    }, 150);
  }

  private async subscribeObjectManager(): Promise<void> {
    const bus = this.bus;
    if (!bus || this.objectManagerSubscribed) return;
    try {
      const root = await bus.getProxyObject(BLUEZ_SERVICE, BLUEZ_ROOT);
      const manager = root.getInterface(OBJECT_MANAGER_IFACE);
      manager.on("InterfacesAdded", () => this.queueResync());
      manager.on("InterfacesRemoved", () => this.queueResync());
      this.objectManagerSubscribed = true;
      logger.log("subscribed to ObjectManager signals");
    } catch (error) {
      logger.error("failed to subscribe to object manager:", errorMessage(error));
    }
  }

  private async subscribeNameOwnerChanges(): Promise<void> {
    const bus = this.bus;
    if (!bus) return;
    try {
      const dbusObject = await bus.getProxyObject("org.freedesktop.DBus", "/org/freedesktop/DBus");
      const dbusInterface = dbusObject.getInterface("org.freedesktop.DBus");
      dbusInterface.on(
        "NameOwnerChanged",
        (name: string, _oldOwner: string, newOwner: string) => {
          if (name !== BLUEZ_SERVICE) return;
          if (newOwner) {
            logger.log("BlueZ (re)started");
            this.objectManagerSubscribed = false;
            this.queueResync();
          } else {
            logger.warn("BlueZ has exited");
            this.available = false;
            this.adapters.clear();
            this.devices.clear();
            this.players.clear();
            this.emit("bluez-unavailable");
          }
        },
      );
    } catch (error) {
      logger.error("failed to subscribe to name owner changes:", errorMessage(error));
    }
  }

  private attachSignalListeners(): void {
    const bus = this.bus;
    if (!bus) return;

    const targets = new Set<string>();
    for (const path of this.adapters.keys()) targets.add(path);
    for (const path of this.devices.keys()) targets.add(path);
    for (const path of this.players.keys()) targets.add(path);

    for (const path of targets) {
      if (this.subscribedPaths.has(path)) continue;
      this.subscribedPaths.add(path);
      bus
        .getProxyObject(BLUEZ_SERVICE, path)
        .then((object) => {
          const props = object.getInterface(PROPERTIES_IFACE);
          props.on(
            "PropertiesChanged",
            (ifaceName: string, changed: Record<string, unknown>) => {
              this.onPropertiesChanged(path, ifaceName, unwrap(changed) as Record<string, unknown>);
            },
          );
        })
        .catch(() => {
          this.subscribedPaths.delete(path);
        });
    }

    // Drop subscriptions for objects BlueZ has removed, otherwise the set
    // grows for the lifetime of the service.
    const live = targets;
    for (const path of [...this.subscribedPaths]) {
      if (!live.has(path)) this.subscribedPaths.delete(path);
    }
  }

  private onPropertiesChanged(
    path: string,
    ifaceName: string,
    changed: Record<string, unknown>,
  ): void {
    if (ifaceName === ADAPTER_IFACE) {
      const adapter = this.adapters.get(path);
      if (!adapter) return;
      if (typeof changed.Powered === "boolean" && changed.Powered !== adapter.powered) {
        adapter.powered = changed.Powered;
        logger.log(changed.Powered ? "adapter powered on" : "adapter powered off");
      }
      if (typeof changed.Discoverable === "boolean") adapter.discoverable = changed.Discoverable;
      if (typeof changed.Pairable === "boolean") adapter.pairable = changed.Pairable;
      if (typeof changed.Discovering === "boolean") {
        adapter.discovering = changed.Discovering;
        // BlueZ stops discovery on its own after ~30 s; keep our timer honest.
        if (!changed.Discovering) this.stopDiscoveryTimer();
      }
      if (typeof changed.Alias === "string") adapter.name = changed.Alias;
      this.emit("changed");
      return;
    }

    if (ifaceName === BATTERY_IFACE) {
      const device = this.devices.get(path);
      if (!device) return;
      const percent = asNumber(changed.Percentage);
      if (percent != null && percent !== device.batteryPercent) {
        device.batteryPercent = percent;
        this.emit("changed");
      }
      return;
    }

    if (ifaceName === DEVICE_IFACE) {
      const device = this.devices.get(path);
      if (!device) return;
      const wasPrimary = this.primaryDevicePath();
      if (typeof changed.Connected === "boolean") device.connected = changed.Connected;
      if (typeof changed.Paired === "boolean") device.paired = changed.Paired;
      if (typeof changed.Trusted === "boolean") device.trusted = changed.Trusted;
      if (typeof changed.Alias === "string") device.alias = changed.Alias;
      if (typeof changed.RSSI === "number") device.rssi = changed.RSSI;
      if (Array.isArray(changed.UUIDs)) device.uuids = asUuidList(changed.UUIDs);
      const isPrimary = this.primaryDevicePath();
      if (isPrimary !== wasPrimary) {
        logger.log(
          isPrimary
            ? `device connected: ${device.alias} (${device.address})`
            : `device disconnected: ${device.alias} (${device.address})`,
        );
        this.emit(isPrimary ? "device-connected" : "device-disconnected", isPrimary);
      }
      this.emit("changed");
      return;
    }

    if (ifaceName === PLAYER_IFACE) {
      const player = this.players.get(path);
      if (!player) return;
      if (typeof changed.Status === "string" && changed.Status !== player.status) {
        player.status = changed.Status;
        logger.log(`player status -> ${changed.Status}`);
      }
      if (typeof changed.Position === "number") {
        player.positionMs = changed.Position;
        player.positionAt = Date.now();
      }
      if (changed.Track !== null && typeof changed.Track === "object") {
        const track = changed.Track as Record<string, unknown>;
        const durationMs = Number(track.Duration ?? 0);
        player.track = {
          title: typeof track.Title === "string" ? track.Title : null,
          artist: typeof track.Artist === "string" ? track.Artist : null,
          album: typeof track.Album === "string" ? track.Album : null,
          durationMs: durationMs > 0 ? durationMs : null,
          imgHandle:
            typeof track.ImgHandle === "string" && track.ImgHandle ? track.ImgHandle : null,
        };
        logger.log(
          `player track -> "${player.track.title}"` +
            (player.track.artist ? ` by ${player.track.artist}` : "") +
            (player.track.imgHandle ? ` | art handle ${player.track.imgHandle}` : ""),
        );
      }
      if (typeof changed.ObexPort === "number") {
        player.obexPort = changed.ObexPort;
        logger.log(`player obexPort -> ${changed.ObexPort} (cover art available)`);
      }
      this.emit("changed");
    }
  }

  private async callPlayer(path: string, method: string): Promise<void> {
    const call = await this.deviceInterface(path, PLAYER_IFACE, method);
    if (!call) return;
    try {
      logger.log(`action -> ${method} on ${path}`);
      await call();
    } catch (error) {
      logger.error(`${method} failed:`, errorMessage(error));
    }
  }
}

/** An A2DP/AVRCP device that has no MediaPlayer1 yet (phone idle, no track). */
function playerlessAudioDevice(device: BluezDeviceSnapshot): boolean {
  return device.uuids.some(
    (uuid) =>
      uuid.startsWith("0000110a") || uuid.startsWith("0000110b") || uuid.startsWith("0000110e"),
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function signatureOf(value: unknown): string {
  if (typeof value === "boolean") return "b";
  if (typeof value === "number") return "u";
  return "s";
}

export { unescapePath };
