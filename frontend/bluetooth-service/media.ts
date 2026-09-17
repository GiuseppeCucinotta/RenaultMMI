import { EventEmitter } from "node:events";
import type { ArtworkService } from "./artwork.js";
import type { BluezPlayer } from "./bluez.js";
import type { BluezMediaPort } from "./ports.js";
import { logger } from "./logger.js";
import { setBluetoothVolume } from "./volume.js";
import {
  IDLE_MEDIA,
  type ArtworkState,
  type BluetoothMedia,
  type BluetoothPlaybackAction,
  type BluetoothStatus,
} from "./types.js";

const TICK_MS = 500;

function toStatus(raw: string): BluetoothStatus {
  if (raw === "playing") return "playing";
  if (raw === "paused") return "paused";
  return "stopped";
}

/**
 * The AVRCP read model for the phone that currently owns the audio path.
 *
 * AVRCP position updates are throttled (well under 1 Hz), so the position is
 * anchored on every reported value and interpolated locally while the phone
 * reports "playing" — that keeps the progress bar smooth without a real
 * playback clock.
 *
 * This controller is told *which* phone is active; it never decides that
 * itself, so the "one phone at a time" policy lives in one place.
 */
export class MediaController extends EventEmitter {
  private readonly bluez: BluezMediaPort;
  private readonly artwork: ArtworkService | null;
  private state: BluetoothMedia = { ...IDLE_MEDIA };
  private status: BluetoothStatus = "none";
  private positionMs = 0;
  private positionAt = 0;
  private activeDevicePath: string | null = null;
  private activePlayer: BluezPlayer | null = null;
  private lastVolumePercent: number | null = null;
  private tickTimer: NodeJS.Timeout | null = null;
  private suspended = false;
  /** Set while suspended when the phone was playing, to restore it on resume. */
  private suspendedWhilePlaying = false;
  constructor(bluez: BluezMediaPort, artwork?: ArtworkService) {
    super();
    this.bluez = bluez;
    this.artwork = artwork ?? null;
  }

  /**
   * Registered by the phone manager: cover art arrives asynchronously, so the
   * track has to be rebuilt once the JPEG lands on disk.
   */
  onArtworkDownloaded(handler: () => void): void {
    this.artwork?.on("downloaded", handler);
  }

  getState(): BluetoothMedia {
    return this.state;
  }

  getActiveDevicePath(): string | null {
    return this.activeDevicePath;
  }

  isPlaying(): boolean {
    return this.status === "playing";
  }

  startTick(): void {
    if (this.tickTimer) return;
    this.tickTimer = setInterval(() => this.tick(), TICK_MS);
    this.tickTimer.unref(); // never keep the process alive for interpolation
  }

  stopTick(): void {
    if (this.tickTimer) clearInterval(this.tickTimer);
    this.tickTimer = null;
  }

  /**
   * Points the read model at a phone (or at nothing). Called by the phone
   * manager whenever the primary device changes or BlueZ reports new player
   * properties.
   */
  setActivePhone(devicePath: string | null, player: BluezPlayer | null, track: BluetoothMedia["track"]): void {
    const now = Date.now();

    if (!devicePath) {
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
      this.positionAt = this.status === "playing" && !this.suspended ? now : 0;
    }

    this.activeDevicePath = devicePath;
    this.activePlayer = player;
    const changed =
      this.state.deviceId !== devicePath ||
      this.state.status !== this.status ||
      this.state.track?.title !== track?.title ||
      this.state.track?.artist !== track?.artist ||
      this.state.track?.album !== track?.album ||
      this.state.track?.durationMs !== track?.durationMs ||
      this.state.track?.artworkUrl !== track?.artworkUrl ||
      this.state.track?.artworkState !== track?.artworkState;

    this.state = {
      deviceId: devicePath,
      status: this.status,
      track,
      positionMs: Math.round(this.positionMs),
      durationMs: track?.durationMs ?? null,
    };

    if (changed) {
      logger.log(
        `media: device=${devicePath ?? "none"} status=${this.status}` +
          (track ? ` track="${track.title}"` : "") +
          ` pos=${this.state.positionMs}ms`,
      );
    }
    this.emit("state", this.getState());
  }

  /** Resolves the artwork state for a track without touching the filesystem. */
  artworkStateFor(imgHandle: string | null): ArtworkState {
    if (!imgHandle) return "none";
    return this.artwork?.isAvailable(imgHandle) ? "ready" : "loading";
  }

  /**
   * Suspends *playback only*: the BlueZ connection intentionally stays up so
   * metadata keeps flowing and a future call handler keeps seeing the phone.
   */
  async suspend(): Promise<void> {
    this.suspended = true;
    this.suspendedWhilePlaying = this.status === "playing";
    const player = this.activePlayer;

    if (this.suspendedWhilePlaying && player) {
      try {
        await this.bluez.pause(player.path);
      } catch (error) {
        logger.error("suspend pause failed:", errorMessage(error));
      }
    }

    this.stopTick();
    this.positionAt = 0;
    if (this.suspendedWhilePlaying) {
      this.status = "paused";
      this.state = { ...this.state, status: "paused" };
    }
    this.emit("state", this.getState());
  }

  /** Restarts interpolation and, if we paused it, resumes the phone. */
  async resume(): Promise<void> {
    this.suspended = false;
    this.startTick();

    const player = this.activePlayer;
    if (this.suspendedWhilePlaying && player) {
      try {
        await this.bluez.play(player.path);
      } catch (error) {
        logger.error("resume play failed:", errorMessage(error));
      }
    }

    this.suspendedWhilePlaying = false;
    this.positionAt = this.status === "playing" ? Date.now() : 0;
  }

  async runAction(action: BluetoothPlaybackAction): Promise<BluetoothMedia> {
    const player = this.activePlayer;
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
      logger.error("playback action failed:", errorMessage(error));
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

  /** Re-applies the last volume to a freshly connected phone. */
  async restoreVolume(): Promise<void> {
    if (this.lastVolumePercent == null) return;
    await this.setVolume(this.lastVolumePercent);
  }

  private tick(): void {
    if (this.status !== "playing" || this.positionAt <= 0) return;
    const now = Date.now();
    this.positionMs += now - this.positionAt;
    this.positionAt = now;
    this.state = { ...this.state, positionMs: Math.round(this.positionMs) };
    this.emit("state", this.getState());
  }

}


function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
