import { createReadStream, existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import type { Logger } from "../shared/logger.js";
import type { MpvFactory } from "../shared/mpv.js";
import {
  BaseMediaService,
  CORS_HEADERS,
  HttpError,
  requireBoolean,
  requireInteger,
  requireMethod,
  requireNumber,
  requireString,
  sendJson,
  sendNotFound,
  type RouteContext,
  type RouteTable,
  type ServiceSettings,
} from "../shared/service-http.js";
import type { JukeboxConfig } from "./config.js";
import {
  findAlbum,
  resolveMusicPath,
  type JukeboxLibrary,
  type JukeboxPlaybackState,
} from "./library.js";
import { JukeboxPlayer } from "./player.js";
import { loadLibrary, saveLibrary, scanLibrary } from "./scanner.js";

const MIME_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

const PLAYBACK_ACTIONS = ["play", "pause", "toggle", "next", "previous", "stop"] as const;
type PlaybackAction = (typeof PLAYBACK_ACTIONS)[number];

export interface JukeboxServiceOptions {
  logger?: Logger;
  createMpv?: MpvFactory;
  settings?: Partial<ServiceSettings>;
  installProcessHandlers?: boolean;
}

/**
 * Music library + mpv playback, exposed over the shared service runtime.
 *
 * Built-in endpoints (`/api/health`, `/api/state`, `/api/events`,
 * `/api/settings`) come from {@link BaseMediaService}; the music-specific
 * routes are declared in {@link JukeboxService.createRoutes}.
 */
export class JukeboxService extends BaseMediaService<JukeboxPlaybackState> {
  private readonly config: JukeboxConfig;
  private readonly player: JukeboxPlayer;
  private library: JukeboxLibrary | null = null;

  constructor(config: JukeboxConfig, options: JukeboxServiceOptions = {}) {
    super({
      name: "jukebox",
      port: config.port,
      logger: options.logger,
      settings: options.settings,
      installProcessHandlers: options.installProcessHandlers,
    });
    this.config = config;
    this.player = new JukeboxPlayer(config.musicRoot, config.mpvBinary, {
      createMpv: options.createMpv,
    });
    this.player.on("state", () => this.broadcast());
  }

  protected getState(): JukeboxPlaybackState {
    return this.player.getState();
  }

  protected async onStart(): Promise<void> {
    this.library = await loadLibrary(this.config.libraryPath);
    this.player.setLibrary(this.library);
    try {
      await this.player.start();
      this.logger.log(`music root: ${this.config.musicRoot}`);
    } catch (error) {
      this.logger.error(
        "failed to start mpv:",
        error instanceof Error ? error.message : error,
      );
    }
  }

  protected async onStop(): Promise<void> {
    await this.player.stop();
  }

  /** Frees the mpv process; the album/track/position stay in RAM. */
  protected async onSuspend(): Promise<void> {
    const snapshot = await this.player.suspend();
    if (snapshot) {
      this.logger.log(
        `snapshot: album=${snapshot.albumId} track=${snapshot.trackIndex} position=${Math.round(snapshot.positionSeconds)}s`,
      );
    }
  }

  protected async onResume(): Promise<void> {
    const restored = await this.player.resume();
    if (!restored) this.logger.log("nothing to restore (no album was loaded)");
  }

  protected isBusy(): boolean {
    return this.getState().isPlaying;
  }

  protected healthDetails(): Record<string, unknown> {
    return {
      libraryLoaded: this.library !== null,
      mpvAvailable: this.player.isRunning(),
    };
  }

  protected createRoutes(): RouteTable {
    return {
      library: (ctx) => this.handleLibrary(ctx),
      scan: (ctx) => this.handleScan(ctx),
      play: (ctx) => this.handlePlay(ctx),
      playback: (ctx) => this.handlePlayback(ctx),
      seek: (ctx) => this.handleSeek(ctx),
      track: (ctx) => this.handleTrack(ctx),
      volume: (ctx) => this.handleVolume(ctx),
      artwork: (ctx) => this.handleArtwork(ctx),
    };
  }

  /* -------------------------------- handlers ------------------------------ */

  private handleLibrary(ctx: RouteContext): void {
    requireMethod(ctx, "GET");
    if (!this.library) {
      sendJson(ctx.res, 404, { error: "Library not scanned yet" });
      return;
    }
    sendJson(ctx.res, 200, this.library);
  }

  private async handleScan(ctx: RouteContext): Promise<void> {
    requireMethod(ctx, "POST");
    this.library = await scanLibrary(this.config.musicRoot, this.config.artworkCacheDir);
    await saveLibrary(this.config.libraryPath, this.library);
    this.player.setLibrary(this.library);
    sendJson(ctx.res, 200, this.library);
  }

  private async handlePlay(ctx: RouteContext): Promise<void> {
    requireMethod(ctx, "POST");
    const body = await ctx.body();
    const albumId = requireString(body.albumId, "albumId");
    // `paused` loads the album without starting playback: used by the renderer
    // to rebuild its state after a service restart without making noise.
    const paused = "paused" in body ? requireBoolean(body.paused, "paused") : false;
    try {
      await this.player.playAlbum(albumId, { paused });
    } catch (error) {
      throw new HttpError(404, error instanceof Error ? error.message : "Album not found");
    }
    sendJson(ctx.res, 200, this.player.getState());
  }

  private async handlePlayback(ctx: RouteContext): Promise<void> {
    requireMethod(ctx, "POST");
    const action = requireString((await ctx.body()).action, "action");
    if (!PLAYBACK_ACTIONS.includes(action as PlaybackAction)) {
      throw new HttpError(400, "Unknown playback action");
    }

    switch (action as PlaybackAction) {
      case "play":
        await this.player.resumePlayback();
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
    sendJson(ctx.res, 200, this.player.getState());
  }

  private async handleSeek(ctx: RouteContext): Promise<void> {
    requireMethod(ctx, "POST");
    await this.player.seek(requireNumber((await ctx.body()).seconds, "seconds"));
    sendJson(ctx.res, 200, this.player.getState());
  }

  private async handleTrack(ctx: RouteContext): Promise<void> {
    requireMethod(ctx, "POST");
    const trackIndex = requireInteger((await ctx.body()).trackIndex, "trackIndex", 0);
    await this.player.playTrackAt(trackIndex);
    sendJson(ctx.res, 200, this.player.getState());
  }

  private async handleVolume(ctx: RouteContext): Promise<void> {
    requireMethod(ctx, "POST");
    await this.player.setVolume(requireNumber((await ctx.body()).volume, "volume"));
    sendJson(ctx.res, 200, this.player.getState());
  }

  private async handleArtwork(ctx: RouteContext): Promise<void> {
    const albumId = ctx.parts[2];
    const album = albumId && this.library ? findAlbum(this.library, albumId) : null;
    const relativePath = album?.artworkPath;
    if (!albumId || !relativePath) {
      sendNotFound(ctx.res);
      return;
    }

    const absolutePath = resolveMusicPath(this.config.musicRoot, relativePath);
    if (!existsSync(absolutePath)) {
      sendNotFound(ctx.res);
      return;
    }

    const stat = await fs.stat(absolutePath);
    ctx.res.writeHead(200, {
      "Content-Type": MIME_TYPES[path.extname(absolutePath).toLowerCase()] ?? "application/octet-stream",
      "Content-Length": stat.size,
      "Cache-Control": "no-cache",
      ...CORS_HEADERS,
    });
    createReadStream(absolutePath).pipe(ctx.res);
  }
}
