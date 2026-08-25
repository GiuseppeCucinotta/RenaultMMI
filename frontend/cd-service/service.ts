import { EventEmitter } from "node:events";
import type { CdConfig } from "./config.js";
import { DriveMonitor, type DriveSnapshot } from "./drive.js";
import {
  identifyDisc,
  mountDataDisc,
  readToc,
  scanDataTracks,
  unmountDataDisc,
} from "./disc.js";
import { CdPlayer } from "./player.js";
import type { CdPlaybackAction, CdState } from "./types.js";
import { logger } from "./logger.js";

/** How often to check that mpv is still alive while a disc is loaded. */
const WATCHDOG_MS = 4000;

/**
 * Glues drive watching, disc identification and playback together:
 * - disc inserted  -> identify -> (data: mount + scan) -> load playlist -> autoplay
 * - disc ejected   -> unmount + drop playback state
 * - USB unplugged  -> same teardown, state reports "no drive"
 *
 * Drive transitions are processed sequentially so slow identification of one
 * event never races the next.
 */
export class CdService extends EventEmitter {
  private readonly drive: DriveMonitor;
  private readonly player: CdPlayer;
  private mountedDevice: string | null = null;
  private watchdog: NodeJS.Timeout | null = null;

  private processing = false;
  private pending: DriveSnapshot | null = null;

  constructor(config: CdConfig) {
    super();
    this.drive = new DriveMonitor(config.device);
    this.player = new CdPlayer(config.mpvBinary);
    this.player.on("state", (state: CdState) => this.emit("state", state));
    this.drive.on("changed", (snapshot: DriveSnapshot) => {
      this.player.setDrive(snapshot);
      this.enqueue(snapshot);
    });
  }

  async start(): Promise<void> {
    this.drive.start();
    // Detect a silently dead mpv (crash, OOM kill): self-heal instead of
    // leaving "playing" state with no audio and dead controls.
    this.watchdog = setInterval(
      () => void this.player.healthCheck(),
      WATCHDOG_MS,
    );
    this.watchdog.unref();
  }

  async stop(): Promise<void> {
    if (this.watchdog) clearInterval(this.watchdog);
    this.watchdog = null;
    this.drive.stop();
    if (this.mountedDevice) {
      unmountDataDisc(this.mountedDevice);
      this.mountedDevice = null;
    }
    await this.player.onDiscRemoved();
  }

  getState(): CdState {
    return this.player.getState();
  }

  isRunning(): boolean {
    return this.player.isRunning();
  }

  async runAction(action: CdPlaybackAction): Promise<void> {
    // No disc -> nothing to act on; stay graceful instead of erroring so the
    // UI can mash buttons while the drive is empty.
    if (!this.player.getState().hasDisc) return;
    switch (action) {
      case "play":
        await this.player.resume();
        break;
      case "pause":
        await this.player.pause();
        break;
      case "toggle":
        await this.player.togglePause();
        break;
      case "next":
        await this.player.next();
        break;
      case "previous":
        await this.player.previous();
        break;
      case "stop":
        await this.player.stop();
        break;
    }
  }

  async playTrackAt(trackIndex: number): Promise<void> {
    if (!this.player.getState().hasDisc) return;
    await this.player.playTrackAt(trackIndex);
  }

  async seek(seconds: number): Promise<void> {
    if (!this.player.getState().hasDisc) return;
    await this.player.seek(seconds);
  }

  async setVolume(volume: number): Promise<void> {
    await this.player.setVolume(volume);
  }

  private enqueue(snapshot: DriveSnapshot): void {
    this.pending = snapshot;
    if (!this.processing) void this.drain();
  }

  private async drain(): Promise<void> {
    this.processing = true;
    try {
      while (this.pending) {
        const snapshot = this.pending;
        this.pending = null;
        await this.applyDriveChange(snapshot);
      }
    } finally {
      this.processing = false;
    }
  }

  private async applyDriveChange(snapshot: DriveSnapshot): Promise<void> {
    try {
      if (!snapshot.hasMedia || !snapshot.device) {
        await this.teardownDisc();
        return;
      }

      const identity = identifyDisc(snapshot.device);
      if (!identity) {
        logger.warn(`unreadable or blank disc in ${snapshot.device}`);
        await this.teardownDisc();
        return;
      }

      if (identity.kind === "audio") {
        // Full TOC for real track durations + chapter mapping (mpv plays the
        // whole disc as one stream with a chapter per CD track).
        const toc = readToc(snapshot.device);
        logger.log(
          `audio CD ${identity.discId}: ${identity.trackCount} tracks in ${snapshot.device}${toc ? " (toc ok)" : " (no toc)"}`,
        );
        await this.player.loadAudioDisc(
          snapshot.device,
          identity.discId,
          identity.trackCount,
          toc,
        );
      } else {
        const mountPoint = mountDataDisc(snapshot.device);
        if (!mountPoint) {
          logger.warn(`could not mount data disc in ${snapshot.device}`);
          await this.teardownDisc();
          return;
        }
        this.mountedDevice = snapshot.device;

        const files = scanDataTracks(mountPoint);
        if (files.length === 0) {
          logger.warn(`no playable audio files on disc in ${snapshot.device}`);
          await this.teardownDisc();
          return;
        }
        logger.log(
          `data disc ${identity.discId}${identity.label ? ` "${identity.label}"` : ""}: ${files.length} files`,
        );
        await this.player.loadDataDisc(identity.discId, identity.label, files);
      }

      await this.player.playFromStart();
    } catch (error) {
      logger.error(
        "drive change handling failed:",
        error instanceof Error ? error.message : error,
      );
      await this.teardownDisc().catch(() => undefined);
    }
  }

  private async teardownDisc(): Promise<void> {
    if (this.mountedDevice) {
      unmountDataDisc(this.mountedDevice);
      this.mountedDevice = null;
    }
    await this.player.onDiscRemoved();
  }
}
