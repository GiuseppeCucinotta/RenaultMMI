import { EventEmitter } from "node:events";
import type { Logger } from "../shared/logger.js";
import { HttpError } from "../shared/service-http.js";
import { ArtworkService } from "./artwork.js";
import { BlueZClient, type BluezPlayer } from "./bluez.js";
import { CallManager, type CallActionRequest } from "./calls.js";
import type { BluetoothConfig } from "./config.js";
import { logger as defaultLogger } from "./logger.js";
import { MediaController } from "./media.js";
import { PairingManager } from "./pairing.js";
import { PairingAgent } from "./agent.js";
import type { AgentPort, BluezPort } from "./ports.js";
import { capabilitiesOf, classifyDeviceKind, isPhoneCandidate } from "./devices.js";
import {
  IDLE_BLUETOOTH_STATE,
  NO_ADAPTER,
  type BluetoothAdapter,
  type BluetoothDevice,
  type BluetoothMedia,
  type BluetoothPairing,
  type BluetoothPlaybackAction,
  type BluetoothState,
  type BluetoothTrack,
} from "./types.js";

/** Actions that only ever target one phone. */
export type PhoneAction = "connect" | "disconnect" | "forget" | "trust" | "untrust";

export interface PhoneManagerOptions {
  config: BluetoothConfig;
  logger?: Logger;
  /** List computers and headsets as well (`BLUETOOTH_SHOW_ALL_DEVICES=1`). */
  showAllDevices?: boolean;
  /**
   * BlueZ collaborators. Tests pass a structural fake so the pairing policy
   * and the state mapping can be exercised without a system bus.
   */
  bluez?: BluezPort;
  agent?: AgentPort;
  artwork?: ArtworkService;
  /** Builds the cover-art downloader; tests pass a busless one. */
  artworkFactory?: (bluez: BluezPort, cacheDir: string) => ArtworkService;
  calls?: CallManager;
}

/**
 * The one object the service talks to.
 *
 * It publishes a single device-centric {@link BluetoothState} and exposes a
 * handful of verbs. Everything else — D-Bus objects, the pairing agent, the
 * cover-art cache, playback interpolation, the "one phone at a time" rule —
 * stays internal, so the service layer and the renderer only ever deal with
 * phones and the media of the active phone.
 */
export class PhoneManager extends EventEmitter {
  private readonly bluez: BluezPort;
  private readonly agent: AgentPort;
  private readonly pairing: PairingManager;
  private readonly media: MediaController;
  private readonly artwork: ArtworkService;
  private readonly calls: CallManager;
  private readonly logger: Logger;
  private readonly showAllDevices: boolean;

  private available = false;
  private state: BluetoothState = { ...IDLE_BLUETOOTH_STATE };
  /** Monotonic counter: the highest id is the phone that connected last. */
  private connectionClock = 0;
  private connectedSequence = new Map<string, number>();
  private lastPrimary: string | null = null;
  private startedTick = false;

  constructor(options: PhoneManagerOptions) {
    super();
    this.logger = options.logger ?? defaultLogger;
    this.showAllDevices = options.showAllDevices ?? options.config.showAllDevices;
    // The concrete client satisfies the port structurally; the cast keeps the
    // constructor accepting both without leaking BlueZClient's wider surface.
    this.bluez = options.bluez ?? (new BlueZClient({ showAllDevices: this.showAllDevices }) as BluezPort);
    this.agent = options.agent ?? (new PairingAgent() as AgentPort);
    const makeArtwork =
      options.artworkFactory ??
      ((client: BluezPort, dir: string) => new ArtworkService(client as BlueZClient, dir));
    this.artwork =
      options.artwork ?? makeArtwork(this.bluez, options.config.artworkDir);
    this.media = new MediaController(this.bluez, this.artwork);
    this.pairing = new PairingManager({ bluez: this.bluez, agent: this.agent });
    this.calls = options.calls ?? new CallManager();

    this.bluez.on("changed", () => this.onBluezChanged());
    this.bluez.on("device-connected", () => void this.onPrimaryConnected());
    this.bluez.on("discovery-stopped", () => this.publish());
    this.bluez.on("bluez-unavailable", () => this.onBluezUnavailable());
    this.pairing.on("state", () => this.publish());
    this.pairing.on("paired", (devicePath: string) => void this.onPaired(devicePath));
    this.media.on("state", () => this.publish());
    this.media.onArtworkDownloaded(() => this.refreshMedia());
  }

  /* ------------------------------- lifecycle ------------------------------- */

  async start(): Promise<void> {
    await this.bluez.connect();
    await this.artwork.start();
    await this.registerAgent();
    await this.bluez.setPairable(true);
    // A connectable, pairable controller is the whole point of the car: the
    // phone has to be able to find and pair with us too.
    this.available = this.bluez.isAvailable();
    // A phone may already be connected when the service (re)starts, and no
    // property change will announce it: read the media slice once here.
    this.refreshMedia();
    this.publish();
  }

  async stop(): Promise<void> {
    this.media.stopTick();
    await this.agent.unregister();
    await this.bluez.stopDiscovery();
    await this.bluez.disconnect();
    await this.artwork.stop();
  }

  /**
   * Suspension here means "stop the radio work", not "drop BlueZ": the device
   * list and the pairing agent stay live so a phone that connects while the
   * source is idle is still noticed.
   */
  async suspend(): Promise<void> {
    await this.bluez.stopDiscovery();
    await this.media.suspend();
    this.publish();
  }

  async resume(): Promise<void> {
    await this.media.resume();
    this.publish();
  }

  isBusy(): boolean {
    return this.media.isPlaying();
  }

  getState(): BluetoothState {
    return this.state;
  }

  /** True when BlueZ will actually ask us to confirm a pairing. */
  canPrompt(): boolean {
    return this.agent.canPrompt();
  }

  healthDetails(): Record<string, unknown> {
    const state = this.state;
    return {
      bluezAvailable: state.available,
      connected: state.devices.some((device) => device.connected),
      playerAvailable: state.media.track != null,
      adapterPowered: state.adapter.powered,
      discovering: state.discovering,
      pairable: state.adapter.pairable,
      pairedDevices: state.devices.filter((device) => device.paired).length,
      visibleDevices: state.devices.length,
      pairingStage: state.pairing.stage,
      callsSupported: state.calls.supported,
      pairingPrompt: this.canPrompt(),
    };
  }

  /* --------------------------- the small interface ------------------------- */

  /** `POST /api/scan` — `start` / `stop` / `refresh`. */
  async scanAction(action: string): Promise<BluetoothState> {
    switch (action) {
      case "start":
        if (!this.state.adapter.powered) {
          throw new HttpError(409, "Bluetooth adapter is powered off");
        }
        await this.bluez.setDiscoverable(true);
        await this.bluez.startDiscovery();
        break;
      case "stop":
        await this.bluez.stopDiscovery();
        await this.bluez.setDiscoverable(false);
        break;
      case "refresh":
        await this.bluez.resyncNow();
        break;
      default:
        throw new HttpError(400, `Unknown scan action "${action}"`);
    }
    this.publish();
    return this.state;
  }

  /** `POST /api/phone` — per-device verbs. */
  async phoneAction(action: string, deviceId: string): Promise<BluetoothState> {
    const device = this.bluez.getDevice(deviceId);
    if (!device) throw new HttpError(404, "Unknown device");

    switch (action) {
      case "connect":
        // One connection path for both cases: the pairing manager connects a
        // paired phone and pairs an unknown one, then connects it. Trusting
        // first lets BlueZ reconnect it on the next car start.
        if (device.paired) await this.bluez.setDeviceTrusted(deviceId, true);
        await this.pairing.run("pair", deviceId);
        break;
      case "disconnect":
        await this.bluez.disconnectDevice(deviceId);
        this.connectedSequence.delete(deviceId);
        break;
      case "forget":
        await this.bluez.forgetDevice(deviceId);
        this.connectedSequence.delete(deviceId);
        break;
      case "trust":
        await this.bluez.setDeviceTrusted(deviceId, true);
        break;
      case "untrust":
        await this.bluez.setDeviceTrusted(deviceId, false);
        break;
      default:
        throw new HttpError(400, `Unknown phone action "${action}"`);
    }

    this.publish();
    return this.state;
  }

  /** `POST /api/pairing` — the prompt flow. */
  async pairingAction(action: string, deviceId?: string, value?: string): Promise<BluetoothPairing> {
    try {
      return await this.pairing.run(action, deviceId, value);
    } catch (error) {
      throw new HttpError(400, error instanceof Error ? error.message : String(error));
    }
  }

  async playback(action: BluetoothPlaybackAction): Promise<BluetoothMedia> {
    const media = await this.media.runAction(action);
    this.publish();
    return media;
  }

  async setVolume(percent: number): Promise<BluetoothState> {
    await this.media.setVolume(percent);
    return this.state;
  }

  /** `POST /api/calls` — reserved; rejects until an HFP backend exists. */
  async callAction(request: CallActionRequest): Promise<void> {
    await this.calls.run(request);
    this.publish();
  }

  /* -------------------------------- internals ------------------------------ */

  private onBluezChanged(): void {
    this.available = this.bluez.isAvailable();
    this.pairing.syncDeviceNames();
    if (!this.startedTick && this.bluez.isAvailable()) {
      this.startedTick = true;
      this.media.startTick();
    }
    this.refreshMedia();
    this.publish();
  }

  private onBluezUnavailable(): void {
    this.available = false;
    this.connectedSequence.clear();
    this.lastPrimary = null;
    this.media.setActivePhone(null, null, null);
    this.publish();
  }

  /**
   * "Last connected phone wins" (the multi-phone policy): the newcomer becomes
   * primary and the other phones are disconnected, so media and calls always
   * have one unambiguous owner.
   */
  private async onPrimaryConnected(): Promise<void> {
    const primary = this.bluez.getActiveDevice();
    if (!primary) return;

    this.connectionClock += 1;
    this.connectedSequence.set(primary.path, this.connectionClock);

    for (const device of this.bluez.getDevices()) {
      if (!device.connected || device.path === primary.path) continue;
      this.connectedSequence.delete(device.path);
      this.logger.log(`disconnecting ${device.alias} (${primary.alias} is now the active phone)`);
      try {
        await this.bluez.disconnectDevice(device.path);
      } catch (error) {
        this.logger.warn(
          `could not disconnect ${device.alias}:`,
          error instanceof Error ? error.message : error,
        );
      }
    }

    if (this.lastPrimary !== primary.path) {
      this.lastPrimary = primary.path;
      await this.media.restoreVolume();
    }
    this.refreshMedia();
    this.publish();
  }

  private async onPaired(devicePath: string): Promise<void> {
    // A successful pairing almost always lands in "connected"; ask BlueZ for
    // the profiles too, because pairing alone does not always start A2DP.
    try {
      await this.bluez.connectDevice(devicePath);
    } catch (error) {
      this.logger.warn(
        `paired with ${devicePath} but could not connect profiles:`,
        error instanceof Error ? error.message : error,
      );
    }
    this.publish();
  }

  /**
   * Rebuilds the media slice from the primary phone. `media` never points at a
   * phone that is not connected, so a stale player can never leak into the UI.
   */
  private refreshMedia(): void {
    const device = this.bluez.getActiveDevice();
    if (!device) {
      this.media.setActivePhone(null, null, null);
      return;
    }
    const player = this.bluez.getPlayersForDevice(device.path)[0] ?? null;
    this.media.setActivePhone(device.path, player, trackFrom(player, (handle) => this.media.artworkStateFor(handle)));
  }

  private publish(): void {
    if (!this.available) {
      // BlueZ is gone: publish an honest empty state rather than whatever the
      // last successful read left behind.
      this.state = {
        ...this.state,
        available: false,
        adapter: { ...NO_ADAPTER },
        discovering: false,
        devices: [],
        pairing: this.pairing.getState(),
        media: this.media.getState(),
        calls: this.calls.getState(),
      };
      this.emit("state", this.state);
      return;
    }

    const adapter = this.bluez.getAdapter();
    const adapterState: BluetoothAdapter = adapter
      ? {
          path: adapter.path,
          name: adapter.name,
          address: adapter.address,
          powered: adapter.powered,
          discoverable: adapter.discoverable,
          pairable: adapter.pairable,
          discovering: adapter.discovering,
        }
      : { ...NO_ADAPTER };

    const primary = this.bluez.getActiveDevice();
    const devices = this.visibleDevices(primary?.path ?? null);

    const next: BluetoothState = {
      available: this.available,
      adapter: adapterState,
      discovering: adapterState.discovering,
      devices,
      pairing: this.pairing.getState(),
      media: this.media.getState(),
      calls: this.calls.getState(),
    };

    this.state = next;
    this.emit("state", next);
  }

  /** Maps BlueZ devices to the public shape, paired phones first. */
  private visibleDevices(primaryPath: string | null): BluetoothDevice[] {
    const primaryMediaPath = this.media.getActiveDevicePath() ?? primaryPath;
    return this.bluez
      .getDevices()
      .filter((device) => isPhoneCandidate(device, { showAll: this.showAllDevices }))
      .map((device) => {
        const players = this.bluez.getPlayersForDevice(device.path);
        const capabilities = capabilitiesOf({
          uuids: device.uuids,
          classOfDevice: device.classOfDevice,
          batteryPercent: device.batteryPercent,
          hasMediaPlayer: players.length > 0,
        });
        return {
          id: device.path,
          address: device.address,
          name: device.alias || device.name || device.address,
          kind: classifyDeviceKind(device.classOfDevice),
          paired: device.paired,
          connected: device.connected,
          trusted: device.trusted,
          primary: device.path === primaryMediaPath,
          rssi: device.rssi,
          batteryPercent: device.batteryPercent,
          capabilities,
        } satisfies BluetoothDevice;
      })
      .sort((a, b) => {
        if (a.paired !== b.paired) return Number(b.paired) - Number(a.paired);
        if (a.connected !== b.connected) return Number(b.connected) - Number(a.connected);
        return a.name.localeCompare(b.name);
      });
  }

  /**
   * Registers the pairing agent on the system bus. An injector that provides
   * its own agent (tests) also owns its registration.
   */
  private async registerAgent(): Promise<void> {
    const bus = this.bluez.getBus?.();
    if (!bus) {
      // No system bus (tests, or a headless run): pairing cannot prompt, but
      // the rest of the service must still work.
      this.logger.warn("no system bus: pairing prompts will not be shown");
      return;
    }
    await this.agent.register(bus as Parameters<PairingAgent["register"]>[0]);
  }
}

function trackFrom(
  player: BluezPlayer | null,
  artworkState: (handle: string | null) => BluetoothTrack["artworkState"],
): BluetoothTrack | null {
  if (!player) return null;
  const track = player.track;
  const state = artworkState(track.imgHandle);
  const hasTrack =
    track.title != null ||
    track.artist != null ||
    track.album != null ||
    track.durationMs != null ||
    state !== "none";
  if (!hasTrack) return null;
  return {
    title: track.title,
    artist: track.artist,
    album: track.album,
    durationMs: track.durationMs,
    artworkUrl: state === "ready" ? `/api/artwork/${track.imgHandle}.jpg` : null,
    artworkState: state,
  };
}

