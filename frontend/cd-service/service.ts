import { errorMessage, type Logger } from "../shared/logger.js";
import type { MpvFactory } from "../shared/mpv.js";
import {
  BaseMediaService,
  HttpError,
  requireInteger,
  requireMethod,
  requireNumber,
  requireString,
  sendJson,
  type RouteContext,
  type RouteTable,
  type ServiceSettings,
} from "../shared/service-http.js";
import type { CdConfig } from "./config.js";
import {
  identifyDisc,
  mountDataDisc,
  readToc,
  scanDataTracks,
  unmountDataDisc,
  type DiscIdentity,
} from "./disc.js";
import { DriveMonitor, type DriveSnapshot } from "./drive.js";
import { logger as defaultLogger } from "./logger.js";
import { CdPlayer } from "./player.js";
import type { CdState } from "./types.js";

const PLAYBACK_ACTIONS = ["play", "pause", "toggle", "next", "previous", "stop"] as const;
type PlaybackAction = (typeof PLAYBACK_ACTIONS)[number];

export interface CdServiceOptions {
  logger?: Logger;
  createMpv?: MpvFactory;
  /** Injectable drive watcher; tests replace the udev-backed monitor. */
  drive?: DriveMonitor;
  /** Injectable disc identification; tests replace the hardware probe. */
  identifyDisc?: (device: string) => DiscIdentity | null;
  settings?: Partial<ServiceSettings>;
  installProcessHandlers?: boolean;
}

/**
 * Glues drive watching, disc identification and playback together:
 * - disc inserted  -> identify -> (data: mount + scan) -> load playlist -> autoplay
 * - disc ejected   -> unmount + drop playback state
 * - USB unplugged  -> same teardown, state reports "no drive"
 *
 * Drive transitions are processed sequentially so slow identification of one
 * event never races the next, and they are ignored while suspended: on resume
 * the physical disc is re-identified and compared with the RAM snapshot.
 *
 * HTTP, SSE, routing, shutdown and the suspend/resume state machine come from
 * {@link BaseMediaService}.
 */
export class CdService extends BaseMediaService<CdState> {
  private readonly drive: DriveMonitor;
  private readonly player: CdPlayer;
  private readonly identify: (device: string) => DiscIdentity | null;
  private mountedDevice: string | null = null;
  /** Last drive state reported by the monitor (kept fresh while suspended). */
  private driveSnapshot: DriveSnapshot = { device: null, hasMedia: false };

  private processing = false;
  private pending: DriveSnapshot | null = null;

  constructor(config: CdConfig, options: CdServiceOptions = {}) {
    const logger = options.logger ?? defaultLogger;
    super({
      name: "cd",
      port: config.port,
      logger,
      settings: options.settings,
      installProcessHandlers: options.installProcessHandlers,
    });

    this.identify = options.identifyDisc ?? identifyDisc;
    this.drive = options.drive ?? new DriveMonitor(config.device, logger);
    this.player = new CdPlayer(config.mpvBinary, { createMpv: options.createMpv });
    this.player.on("state", () => this.broadcast());

    this.drive.on("changed", (snapshot: DriveSnapshot) => {
      this.driveSnapshot = snapshot;
      this.player.setDrive(snapshot);
      if (this.suspended) {
        this.logger.log("drive changed while suspended — reconciling on resume");
        return;
      }
      this.enqueueDriveChange(snapshot);
    });
  }

  /* ------------------------------- base hooks ----------------------------- */

  protected getState(): CdState {
    return this.player.getState();
  }

  protected onStart(): void {
    // udev events drive media detection; no polling timer is armed here.
    this.drive.start();
    this.driveSnapshot = this.drive.getSnapshot();
  }

  protected async onStop(): Promise<void> {
    this.drive.stop();
    await this.teardownDisc();
  }

  /**
   * Cheap, demand-driven liveness check. Replaces the old 4s
   * `setInterval(player.healthCheck)`: mpv crashes already arrive as a
   * `crashed` event, and any user interaction re-verifies the player, so a
   * background timer is pure overhead.
   */
  protected onActivity(): void {
    void this.player.healthCheck();
  }

  protected async onSuspend(): Promise<void> {
    const snapshot = await this.player.suspend();
    if (snapshot) {
      this.logger.log(
        `snapshot: disc=${snapshot.discId} track=${snapshot.trackIndex + 1} position=${Math.round(snapshot.positionSeconds)}s`,
      );
    }
  }

  /**
   * Wakes up by comparing the disc that is *physically* in the drive with the
   * one recorded in the snapshot: same disc -> seek back and resume, different
   * disc (or empty drive) -> reset and load whatever is there now.
   */
  protected async onResume(): Promise<void> {
    this.pending = null;
    const snapshot = this.player.getSnapshot();
    if (!snapshot) {
      this.logger.log("nothing to restore (no disc was loaded)");
      return;
    }

    const drive = this.driveSnapshot;
    if (!drive.hasMedia || !drive.device) {
      this.logger.log("disc ejected while suspended — resetting");
      await this.teardownDisc();
      return;
    }

    const identity = this.identify(drive.device);
    if (!identity || identity.discId !== snapshot.discId) {
      this.logger.log(
        `disc changed while suspended (${snapshot.discId} -> ${identity?.discId ?? "unknown"}) — resetting`,
      );
      this.player.clearSnapshot();
      await this.teardownDisc();
      await this.applyDriveChange(drive);
      return;
    }

    const loaded = await this.loadDisc(drive.device, identity);
    if (!loaded) {
      await this.teardownDisc();
      return;
    }
    await this.player.restoreSnapshot();
  }

  protected isBusy(): boolean {
    return this.getState().isPlaying;
  }

  protected healthDetails(): Record<string, unknown> {
    const state = this.getState();
    return {
      driveConnected: state.driveConnected,
      hasDisc: state.hasDisc,
      mpvAvailable: this.player.isRunning(),
    };
  }

  protected createRoutes(): RouteTable {
    return {
      playback: (ctx) => this.handlePlayback(ctx),
      track: (ctx) => this.handleTrack(ctx),
      seek: (ctx) => this.handleSeek(ctx),
      volume: (ctx) => this.handleVolume(ctx),
    };
  }

  /* -------------------------------- handlers ------------------------------ */

  private async handlePlayback(ctx: RouteContext): Promise<void> {
    requireMethod(ctx, "POST");
    const action = requireString((await ctx.body()).action, "action");
    if (!PLAYBACK_ACTIONS.includes(action as PlaybackAction)) {
      throw new HttpError(400, "Unknown playback action");
    }
    // No disc -> nothing to act on; stay graceful so the UI can mash buttons
    // while the drive is empty.
    if (this.getState().hasDisc) await this.runAction(action as PlaybackAction);
    sendJson(ctx.res, 200, this.getState());
  }

  private async handleTrack(ctx: RouteContext): Promise<void> {
    requireMethod(ctx, "POST");
    const trackIndex = requireInteger((await ctx.body()).trackIndex, "trackIndex", 1);
    if (this.getState().hasDisc) await this.player.playTrackAt(trackIndex);
    sendJson(ctx.res, 200, this.getState());
  }

  private async handleSeek(ctx: RouteContext): Promise<void> {
    requireMethod(ctx, "POST");
    const seconds = requireNumber((await ctx.body()).seconds, "seconds");
    if (this.getState().hasDisc) await this.player.seek(seconds);
    sendJson(ctx.res, 200, this.getState());
  }

  private async handleVolume(ctx: RouteContext): Promise<void> {
    requireMethod(ctx, "POST");
    const volume = requireNumber((await ctx.body()).volume, "volume");
    await this.player.setVolume(volume);
    sendJson(ctx.res, 200, this.getState());
  }

  private async runAction(action: PlaybackAction): Promise<void> {
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

  /* ----------------------------- disc lifecycle --------------------------- */

  private enqueueDriveChange(snapshot: DriveSnapshot): void {
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

      const identity = this.identify(snapshot.device);
      if (!identity) {
        this.logger.warn(`unreadable or blank disc in ${snapshot.device}`);
        await this.teardownDisc();
        return;
      }

      if (!(await this.loadDisc(snapshot.device, identity))) {
        await this.teardownDisc();
        return;
      }
      await this.player.playFromStart();
    } catch (error) {
      this.logger.error("drive change handling failed:", errorMessage(error));
      await this.teardownDisc().catch(() => undefined);
    }
  }

  /** Loads the identified disc into mpv; false when it cannot be played. */
  private async loadDisc(device: string, identity: DiscIdentity): Promise<boolean> {
    if (identity.kind === "audio") {
      // Full TOC for real track durations + chapter mapping (mpv plays the
      // whole disc as one stream with a chapter per CD track).
      const toc = readToc(device);
      this.logger.log(
        `audio CD ${identity.discId}: ${identity.trackCount} tracks in ${device}${toc ? " (toc ok)" : " (no toc)"}`,
      );
      await this.player.loadAudioDisc(device, identity.discId, identity.trackCount, toc);
      return true;
    }

    const mountPoint = mountDataDisc(device);
    if (!mountPoint) {
      this.logger.warn(`could not mount data disc in ${device}`);
      return false;
    }
    this.mountedDevice = device;

    const files = scanDataTracks(mountPoint);
    if (files.length === 0) {
      this.logger.warn(`no playable audio files on disc in ${device}`);
      return false;
    }
    this.logger.log(
      `data disc ${identity.discId}${identity.label ? ` "${identity.label}"` : ""}: ${files.length} files`,
    );
    await this.player.loadDataDisc(identity.discId, identity.label, files);
    return true;
  }

  private async teardownDisc(): Promise<void> {
    if (this.mountedDevice) {
      unmountDataDisc(this.mountedDevice);
      this.mountedDevice = null;
    }
    await this.player.onDiscRemoved();
  }
}
