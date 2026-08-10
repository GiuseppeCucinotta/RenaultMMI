import { EventEmitter } from "node:events";
import * as dbus from "dbus-next";
import type { ClientInterface, MessageBus } from "dbus-next";
import { logger } from "./logger.js";

const BLUEZ_SERVICE = "org.bluez";
const BLUEZ_ROOT = "/";
const OBJECT_MANAGER_IFACE = "org.freedesktop.DBus.ObjectManager";
const PROPERTIES_IFACE = "org.freedesktop.DBus.Properties";
const DEVICE_IFACE = "org.bluez.Device1";
const PLAYER_IFACE = "org.bluez.MediaPlayer1";

const A2DP_SOURCE_UUID = "0000110a-0000-1000-8000-00805f9b34fb";
const A2DP_SINK_UUID = "0000110b-0000-1000-8000-00805f9b34fb";
const AVRCP_UUID = "0000110e-0000-1000-8000-00805f9b34fb";

const RESYNC_INTERVAL_MS = 5000;

export interface BluezDevice {
  path: string;
  address: string;
  alias: string;
  connected: boolean;
  audioProfile: boolean;
}

export interface BluezTrack {
  title: string | null;
  artist: string | null;
  album: string | null;
  durationMs: number | null;
}

export interface BluezPlayer {
  path: string;
  devicePath: string;
  name: string;
  status: string;
  track: BluezTrack;
  positionMs: number;
  positionAt: number;
}

type ManagedObjects = Record<string, Record<string, Record<string, unknown>>>;

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

/**
 * Thin client over BlueZ (the Linux Bluetooth stack) on the D-Bus system bus.
 *
 * Discovers A2DP/AVRCP devices and their `org.bluez.MediaPlayer1` players
 * (exposed when the Pi acts as an AVRCP controller over a connected phone),
 * tracks live property changes, and forwards playback commands. A periodic
 * re-sync acts as a safety net for missed signals.
 */
export class BlueZClient extends EventEmitter {
  private bus: MessageBus | null = null;
  private available = false;
  private objectManagerSubscribed = false;
  private devices = new Map<string, BluezDevice>();
  private players = new Map<string, BluezPlayer>();
  private subscribedPaths = new Set<string>();
  private resyncTimer: NodeJS.Timeout | null = null;
  private resyncQueued = false;

  isAvailable(): boolean {
    return this.available;
  }

  async connect(): Promise<void> {
    if (this.bus) return;

    this.bus = dbus.systemBus();
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
    if (this.resyncTimer) {
      clearInterval(this.resyncTimer);
      this.resyncTimer = null;
    }
    const bus = this.bus;
    this.bus = null;
    if (bus) bus.disconnect();
  }

  getActiveDevice(): BluezDevice | null {
    for (const player of this.players.values()) {
      const device = this.devices.get(player.devicePath);
      if (device?.connected) return device;
    }
    for (const device of this.devices.values()) {
      if (device.connected && device.audioProfile) return device;
    }
    return null;
  }

  getActivePlayer(): BluezPlayer | null {
    const device = this.getActiveDevice();
    if (!device) return null;
    for (const player of this.players.values()) {
      if (player.devicePath === device.path) return player;
    }
    return null;
  }

  async play(path: string): Promise<void> {
    await this.callPlayer(path, "Play");
  }

  async pause(path: string): Promise<void> {
    await this.callPlayer(path, "Pause");
  }

  async next(path: string): Promise<void> {
    await this.callPlayer(path, "Next");
  }

  async previous(path: string): Promise<void> {
    await this.callPlayer(path, "Previous");
  }

  async stop(path: string): Promise<void> {
    await this.callPlayer(path, "Stop");
  }

  private async resync(): Promise<void> {
    const bus = this.bus;
    if (!bus) return;

    const wasActivePath = this.getActiveDevice()?.path ?? null;

    try {
      const root = await bus.getProxyObject(BLUEZ_SERVICE, BLUEZ_ROOT);
      const manager = root.getInterface(OBJECT_MANAGER_IFACE);
      const raw = (await manager.GetManagedObjects()) as unknown;
      const managed = unwrap(raw) as ManagedObjects;

      const devices = new Map<string, BluezDevice>();
      const players = new Map<string, BluezPlayer>();
      const now = Date.now();

      for (const [path, interfaces] of Object.entries(managed)) {
        const deviceProps = interfaces[DEVICE_IFACE];
        if (deviceProps) {
          const uuids = Array.isArray(deviceProps.UUIDs) ? deviceProps.UUIDs.map(String) : [];
          devices.set(path, {
            path,
            address: String(deviceProps.Address ?? ""),
            alias: String(deviceProps.Alias ?? deviceProps.Name ?? ""),
            connected: Boolean(deviceProps.Connected),
            audioProfile:
              uuids.includes(A2DP_SOURCE_UUID) ||
              uuids.includes(A2DP_SINK_UUID) ||
              uuids.includes(AVRCP_UUID),
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
            },
            positionMs: nextPositionMs,
            positionAt: samePosition && prev ? prev.positionAt : now,
          });
        }
      }

      this.devices = devices;
      this.players = players;
      this.available = true;
      this.attachSignalListeners();
      if (!this.objectManagerSubscribed) {
        void this.subscribeObjectManager();
      }

      const activeDevice = this.getActiveDevice();
      const activePlayer = this.getActivePlayer();
      if (wasActivePath !== activeDevice?.path) {
        logger.log(
          activeDevice
            ? `device connected: ${activeDevice.alias} (${activeDevice.address})`
            : "no active audio device",
        );
        this.emit(activeDevice ? "device-connected" : "device-disconnected");
      }
      logger.log(
        `resync: ${devices.size} device(s), ${players.size} player(s)` +
          (activePlayer
            ? ` | active player: ${activePlayer.name}` +
              (activePlayer.track.title ? ` | "${activePlayer.track.title}"` : "") +
              ` | status=${activePlayer.status} pos=${activePlayer.positionMs}ms`
            : activeDevice
              ? ` | device "${activeDevice.alias}" has no MediaPlayer1 (start playback on the phone)`
              : ""),
      );
      this.emit("changed");
    } catch (error) {
      if (this.available) {
        logger.error("bluez unavailable:", error instanceof Error ? error.message : error);
      }
      this.available = false;
      this.devices.clear();
      this.players.clear();
      this.emit("bluez-unavailable");
    }
  }

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
      logger.error("failed to subscribe to object manager:", error instanceof Error ? error.message : error);
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
            this.devices.clear();
            this.players.clear();
            this.emit("bluez-unavailable");
          }
        },
      );
    } catch (error) {
      logger.error("failed to subscribe to name owner changes:", error instanceof Error ? error.message : error);
    }
  }

  private attachSignalListeners(): void {
    const bus = this.bus;
    if (!bus) return;

    const targets = new Set<string>();
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
  }

  private onPropertiesChanged(
    path: string,
    ifaceName: string,
    changed: Record<string, unknown>,
  ): void {
    if (ifaceName === DEVICE_IFACE) {
      const device = this.devices.get(path);
      if (!device) return;
      if (typeof changed.Connected === "boolean" && changed.Connected !== device.connected) {
        device.connected = changed.Connected;
        logger.log(
          changed.Connected
            ? `device connected: ${device.alias} (${device.address})`
            : `device disconnected: ${device.alias} (${device.address})`,
        );
        this.emit(changed.Connected ? "device-connected" : "device-disconnected");
      }
      if (typeof changed.Alias === "string") device.alias = changed.Alias;
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
        };
        logger.log(
          `player track -> "${player.track.title}"` +
            (player.track.artist ? ` by ${player.track.artist}` : ""),
        );
      }
      this.emit("changed");
    }
  }

  private async callPlayer(path: string, method: string): Promise<void> {
    const bus = this.bus;
    if (!bus) return;
    try {
      const object = await bus.getProxyObject(BLUEZ_SERVICE, path);
      const player = object.getInterface(PLAYER_IFACE) as ClientInterface;
      const call = player[method] as (() => Promise<unknown>) | undefined;
      if (call) {
        logger.log(`action -> ${method} on ${path}`);
        await call();
      }
    } catch (error) {
      logger.error(`${method} failed:`, error instanceof Error ? error.message : error);
    }
  }
}
