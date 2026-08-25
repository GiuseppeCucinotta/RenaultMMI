import { EventEmitter } from "node:events";
import type {
  ArtworkState,
  BluetoothPlaybackAction,
  BluetoothState,
  BluetoothStatus,
} from "./types.js";
import { IDLE_BLUETOOTH_STATE } from "./types.js";
import type { BlueZClient } from "./bluez.js";
import type { ArtworkService } from "./artwork.js";
import { setBluetoothVolume } from "./volume.js";
import { logger } from "./logger.js";

const TICK_MS = 500;

function toStatus(raw: string): BluetoothStatus {
  if (raw === "playing") return "playing";
  if (raw === "paused") return "paused";
  return "stopped";
}

/**
 * Single source of truth for the Bluetooth state served to the renderer.
 *
 * AVRCP position updates from phones are throttled (well under 1 Hz), so the
 * position is anchored on every reported value and interpolated locally while
 * the player reports "playing". The result is a smooth progress readout even
 * though Bluetooth has no real-time clock.
 */
export class BluetoothPlayer extends EventEmitter {
  private readonly bluez: BlueZClient;
  private readonly artwork: ArtworkService | null;
  private state: BluetoothState = IDLE_BLUETOOTH_STATE;
  private status: BluetoothStatus = "none";
  private positionMs = 0;
  private positionAt = 0;
  private lastVolumePercent: number | null = null;
  private tickTimer: NodeJS.Timeout | null = null;

  constructor(bluez: BlueZClient, artwork?: ArtworkService) {
    super();
    this.bluez = bluez;
    this.artwork = artwork ?? null;
    this.bluez.on("changed", () => this.refresh());
    if (this.artwork) {
      this.artwork.on("downloaded", () => this.refresh());
    }
    this.bluez.on("device-connected", () => {
      if (this.lastVolumePercent != null) void this.setVolume(this.lastVolumePercent);
    });
    this.bluez.on("bluez-unavailable", () => {
      this.positionMs = 0;
      this.positionAt = 0;
      this.status = "none";
      this.state = { ...IDLE_BLUETOOTH_STATE };
      this.emit("state", this.getState());
    });
  }

  async start(): Promise<void> {
    await this.bluez.connect();
    this.refresh();
    this.tickTimer = setInterval(() => this.tick(), TICK_MS);
  }

  async stop(): Promise<void> {
    if (this.tickTimer) clearInterval(this.tickTimer);
    await this.bluez.disconnect();
  }

  getState(): BluetoothState {
    return this.state;
  }

  async runAction(action: BluetoothPlaybackAction): Promise<BluetoothState> {
    const player = this.bluez.getActivePlayer();
    if (!player) return this.getState();
    try {
      switch (action) {
        case "play":
          await this.bluez.play(player.path);
          break;
        case "pause":
          await this.bluez.pause(player.path);
          break;
        case "toggle":
          if (player.status === "playing") await this.bluez.pause(player.path);
          else await this.bluez.play(player.path);
          break;
        case "next":
          await this.bluez.next(player.path);
          break;
        case "previous":
          await this.bluez.previous(player.path);
          break;
        case "stop":
          await this.bluez.stop(player.path);
          break;
      }
    } catch (error) {
      logger.error("playback action failed:", error instanceof Error ? error.message : error);
    }
    return this.getState();
  }

  async setVolume(percent: number): Promise<void> {
    const clamped = Math.max(0, Math.min(100, Math.round(percent)));
    this.lastVolumePercent = clamped;
    const applied = await setBluetoothVolume(clamped);
    if (!applied) {
      logger.warn(`volume ${clamped}% requested but no bluez sink found (phone audio not playing?)`);
    } else {
      logger.log(`volume -> ${clamped}%`);
    }
  }

  private refresh(): void {
    const device = this.bluez.getActiveDevice();
    const player = this.bluez.getActivePlayer();
    const now = Date.now();

    if (!device) {
      this.positionMs = 0;
      this.positionAt = 0;
      this.status = "none";
    } else if (!player) {
      this.positionMs = 0;
      this.positionAt = 0;
      this.status = "stopped";
    } else {
      this.status = toStatus(player.status);
      if (this.status !== "playing" || player.positionMs !== this.positionMs) {
        this.positionMs = player.positionMs;
      }
      this.positionAt = this.status === "playing" ? now : 0;
    }

    const track = player?.track ?? null;
    const artworkState: ArtworkState =
      track?.imgHandle == null
        ? "none"
        : this.artwork?.isAvailable(track.imgHandle)
          ? "ready"
          : "loading";
    const hasTrack =
      track != null &&
      (track.title != null ||
        track.artist != null ||
        track.album != null ||
        track.durationMs != null ||
        artworkState !== "none");

    const next: BluetoothState = {
      connected: device != null,
      deviceName: device?.alias ?? null,
      deviceAddress: device?.address ?? null,
      status: this.status,
      track: hasTrack
        ? {
            title: track.title,
            artist: track.artist,
            album: track.album,
            durationMs: track.durationMs,
            artworkUrl: artworkState === "ready" ? `/api/artwork/${track.imgHandle}.jpg` : null,
            artworkState,
          }
        : null,
      positionMs: Math.round(this.positionMs),
      durationMs: track?.durationMs ?? null,
    };

    if (this.emitStateIfChanged(next)) {
      logger.log(
        `state: connected=${next.connected}${next.deviceName ? ` device="${next.deviceName}"` : ""}` +
          ` status=${next.status}` +
          (next.track ? ` track="${next.track.title}"` : "") +
          ` pos=${next.positionMs}ms${next.durationMs ? `/${next.durationMs}ms` : ""}`,
      );
    }
  }

  private tick(): void {
    if (this.status !== "playing" || this.positionAt <= 0) return;
    const now = Date.now();
    this.positionMs += now - this.positionAt;
    this.positionAt = now;
    this.state = { ...this.state, positionMs: Math.round(this.positionMs) };
    this.emit("state", this.getState());
  }

  private emitStateIfChanged(next: BluetoothState): boolean {
    const prev = this.state;
    const changed =
      prev.connected !== next.connected ||
      prev.deviceName !== next.deviceName ||
      prev.status !== next.status ||
      prev.track?.title !== next.track?.title ||
      prev.track?.artist !== next.track?.artist ||
      prev.track?.album !== next.track?.album ||
      prev.track?.durationMs !== next.track?.durationMs ||
      prev.track?.artworkUrl !== next.track?.artworkUrl ||
      prev.track?.artworkState !== next.track?.artworkState;
    this.state = next;
    this.emit("state", next);
    return changed;
  }
}
