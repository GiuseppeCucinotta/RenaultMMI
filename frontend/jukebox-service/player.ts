import { EventEmitter } from "node:events";
import path from "node:path";
import {
  defaultMpvFactory,
  mpvSocketPath,
  type MpvFactory,
  type MpvLike,
} from "../shared/mpv.js";
import {
  findAlbum,
  type JukeboxAlbum,
  type JukeboxLibrary,
  type JukeboxPlaybackState,
} from "./library.js";

/**
 * Minimal RAM snapshot taken by {@link JukeboxPlayer.suspend}: everything the
 * player needs to bring the exact same listening position back after mpv (and
 * its memory) has been released.
 */
export interface JukeboxSnapshot {
  albumId: string;
  trackIndex: number;
  /** Track-relative position in seconds. */
  positionSeconds: number;
  wasPlaying: boolean;
}

export interface JukeboxPlayerOptions {
  /** Injectable mpv constructor — tests pass a fake, production uses node-mpv. */
  createMpv?: MpvFactory;
}

export interface StartOptions {
  /** Launch mpv with playback held (used when restoring a snapshot). */
  paused?: boolean;
}

export interface PlayAlbumOptions {
  /** Load the album without starting playback. */
  paused?: boolean;
}

const DEFAULT_VOLUME = 83;

/** Reads mpv's real pause state; assumes playback when the property is unavailable. */
async function isPaused(mpv: MpvLike): Promise<boolean> {
  try {
    return (await mpv.getProperty("pause")) === true;
  } catch {
    return false;
  }
}

export class JukeboxPlayer extends EventEmitter {
  private readonly musicRoot: string;
  private readonly mpvBinary: string;
  private readonly createMpv: MpvFactory;
  private mpv: MpvLike | null = null;
  private library: JukeboxLibrary | null = null;
  private albumId: string | null = null;
  private trackIndex = 0;
  private durationSeconds = 0;
  private currentTimeSeconds = 0;
  private isPlaying = false;
  private volume = DEFAULT_VOLUME;
  private snapshot: JukeboxSnapshot | null = null;

  constructor(musicRoot: string, mpvBinary: string, options: JukeboxPlayerOptions = {}) {
    super();
    this.musicRoot = musicRoot;
    this.mpvBinary = mpvBinary;
    this.createMpv = options.createMpv ?? defaultMpvFactory;
  }

  setLibrary(library: JukeboxLibrary | null): void {
    this.library = library;
  }

  isRunning(): boolean {
    return this.mpv?.isRunning() ?? false;
  }

  async start(options: StartOptions = {}): Promise<void> {
    if (this.mpv) return;

    // `--pause=yes` makes mpv load the first file without sounding it, so a
    // paused restore never bleeds a fraction of a second of audio.
    const args = ["--no-video", `--volume=${this.volume}`];
    if (options.paused) args.push("--pause=yes");

    const mpv = this.createMpv(
      {
        binary: this.mpvBinary,
        audio_only: true,
        time_update: 0.5,
        socket: mpvSocketPath("jukebox"),
      },
      args,
    );
    this.mpv = mpv;

    mpv.on("timeposition", (seconds: number) => {
      this.currentTimeSeconds = seconds;
      this.emitState();
    });

    mpv.on("status", (status: { property: string; value: unknown }) => {
      if (status.property === "playlist-pos" && typeof status.value === "number") {
        this.trackIndex = status.value;
        this.emitState();
      } else if (status.property === "duration" && typeof status.value === "number") {
        this.durationSeconds = status.value;
        this.emitState();
      } else if (status.property === "pause" && typeof status.value === "boolean") {
        this.isPlaying = !status.value;
        this.emitState();
      }
    });

    mpv.on("started", async () => {
      // mpv reports `started` when the FILE is loaded, which also happens while
      // it is held paused (a snapshot restore). Ask mpv instead of assuming
      // playback began, otherwise the UI shows "playing" for held audio.
      this.isPlaying = !(await isPaused(mpv));
      try {
        const duration = await mpv.getDuration();
        if (typeof duration === "number" && duration > 0) {
          this.durationSeconds = duration;
        }
      } catch {
        // keep the metadata-derived duration as a fallback
      }
      this.emitState();
    });

    mpv.on("paused", () => {
      this.isPlaying = false;
      this.emitState();
    });

    mpv.on("resumed", () => {
      this.isPlaying = true;
      this.emitState();
    });

    mpv.on("stopped", () => {
      this.isPlaying = false;
      this.emitState();
    });

    mpv.on("crashed", () => {
      this.isPlaying = false;
      this.emitState();
    });

    await mpv.start();
  }

  async quit(): Promise<void> {
    const mpv = this.mpv;
    this.mpv = null;
    if (mpv?.isRunning()) {
      await mpv.quit().catch(() => undefined);
    }
  }

  /* ------------------------------ playback ------------------------------- */

  async playAlbum(albumId: string, options: PlayAlbumOptions = {}): Promise<void> {
    const album = this.library ? findAlbum(this.library, albumId) : null;
    if (!album || album.songs.length === 0) {
      throw new Error(`Album "${albumId}" not found in library`);
    }
    if (!this.mpv || !this.mpv.isRunning()) {
      await this.start({ paused: options.paused });
    }
    if (options.paused) {
      // Hold playback BEFORE the playlist is loaded: an mpv that is already
      // running (started with the service) would otherwise sound the first
      // moments of the file before the pause below lands.
      await this.requireMpv().pause();
    }

    await this.loadAlbumPlaylist(album, albumId);
    if (options.paused) {
      await this.requireMpv().pause();
      this.isPlaying = false;
    } else {
      this.isPlaying = true;
    }
    this.emitState();
  }

  async togglePause(): Promise<void> {
    await this.requireMpv().togglePause();
  }

  async pause(): Promise<void> {
    await this.requireMpv().pause();
  }

  async resumePlayback(): Promise<void> {
    await this.requireMpv().resume();
  }

  async next(): Promise<void> {
    await this.requireMpv().next();
  }

  async previous(): Promise<void> {
    await this.requireMpv().prev();
  }

  async playTrackAt(trackIndex: number): Promise<void> {
    const mpv = this.requireMpv();
    const album = this.albumId && this.library ? findAlbum(this.library, this.albumId) : null;
    if (!album) {
      throw new Error("No album is currently playing");
    }
    if (trackIndex < 0 || trackIndex >= album.songs.length) {
      throw new Error(`Track index ${trackIndex} out of range`);
    }

    await mpv.jump(trackIndex);
    this.trackIndex = trackIndex;
    this.currentTimeSeconds = 0;
    this.emitState();
  }

  async seek(seconds: number): Promise<void> {
    await this.requireMpv().seek(seconds, "absolute");
  }

  async setVolume(volume: number): Promise<void> {
    const percent = Math.max(0, Math.min(100, Math.round(volume)));
    this.volume = percent;
    const mpv = this.mpv;
    if (!mpv?.isRunning()) return;
    try {
      await mpv.volume(percent);
    } catch {
      // volume settles on the next explicit set; playback is unaffected
    }
  }

  async stop(): Promise<void> {
    const mpv = this.mpv;
    if (mpv?.isRunning()) {
      try {
        await mpv.stop();
      } catch {
        // mpv already gone — nothing to stop
      }
    }
    this.albumId = null;
    this.trackIndex = 0;
    this.currentTimeSeconds = 0;
    this.durationSeconds = 0;
    this.isPlaying = false;
    this.snapshot = null;
    this.emitState();
    await this.quit();
  }

  /* --------------------------- suspend / resume --------------------------- */

  /**
   * Snapshot the listening position in RAM, then kill mpv — the single
   * biggest memory consumer this service owns (the process itself, its audio
   * decoder and its buffers).
   *
   * The album/track metadata is intentionally kept so `/api/state` keeps
   * showing the right track while suspended.
   */
  async suspend(): Promise<JukeboxSnapshot | null> {
    if (this.albumId) {
      this.snapshot = {
        albumId: this.albumId,
        trackIndex: this.trackIndex,
        positionSeconds: this.currentTimeSeconds,
        wasPlaying: this.isPlaying,
      };
    }
    await this.quit();
    this.isPlaying = false;
    this.emitState();
    return this.snapshot;
  }

  /**
   * Relaunch mpv and jump back to the snapshot position. Returns false when
   * there is nothing to restore (never played, or the album vanished from the
   * library after a rescan).
   */
  async resume(): Promise<boolean> {
    const snapshot = this.snapshot;
    if (!snapshot) return false;

    const album = this.library ? findAlbum(this.library, snapshot.albumId) : null;
    if (!album || album.songs.length === 0) {
      this.snapshot = null;
      return false;
    }

    // Always restore paused: returning to the Jukebox source must never start
    // audio on its own, whatever the album was doing before it was suspended.
    // (`wasPlaying` stays in the snapshot as a record of that state; the
    // listener presses play when they are ready.)
    await this.start({ paused: true });
    const mpv = this.requireMpv();
    await mpv.pause(); // hold before the load, so nothing bleeds out
    await this.loadAlbumPlaylist(album, snapshot.albumId);

    const track = Math.min(Math.max(snapshot.trackIndex, 0), album.songs.length - 1);
    if (track > 0) await mpv.jump(track);
    this.trackIndex = track;
    this.durationSeconds = album.songs[track]?.durationSeconds ?? this.durationSeconds;

    if (snapshot.positionSeconds > 0) {
      await mpv.seek(snapshot.positionSeconds, "absolute");
    }
    this.currentTimeSeconds = snapshot.positionSeconds;

    this.isPlaying = false;
    await mpv.pause();

    this.snapshot = null;
    this.emitState();
    return true;
  }

  /** The snapshot currently held in RAM (null when running or never played). */
  getSnapshot(): JukeboxSnapshot | null {
    return this.snapshot;
  }

  clearSnapshot(): void {
    this.snapshot = null;
  }

  /* --------------------------------- state -------------------------------- */

  getState(): JukeboxPlaybackState {
    const album = this.albumId && this.library ? findAlbum(this.library, this.albumId) : null;
    const song = album?.songs[this.trackIndex];

    return {
      albumId: this.albumId,
      trackIndex: this.trackIndex,
      artistName: album?.artistName ?? null,
      albumTitle: album?.title ?? null,
      trackTitle: song?.title ?? null,
      durationSeconds: this.durationSeconds || song?.durationSeconds || null,
      currentTimeSeconds: this.currentTimeSeconds,
      isPlaying: this.isPlaying,
    };
  }

  /* -------------------------------- private ------------------------------- */

  private async loadAlbumPlaylist(album: JukeboxAlbum, albumId: string): Promise<void> {
    const mpv = this.requireMpv();
    const paths = album.songs.map((song) => path.join(this.musicRoot, song.filePath));

    this.albumId = albumId;
    this.trackIndex = 0;
    this.currentTimeSeconds = 0;
    this.durationSeconds = album.songs[0]?.durationSeconds ?? 0;

    await mpv.clearPlaylist();
    for (let index = 0; index < paths.length; index++) {
      if (index === 0) {
        await mpv.load(paths[index], "replace");
      } else {
        await mpv.append(paths[index], "append");
      }
    }
    await mpv.loopPlaylist("inf").catch(() => undefined);
  }

  private emitState(): void {
    this.emit("state", this.getState());
  }

  private requireMpv(): MpvLike {
    if (!this.mpv) {
      throw new Error("Player is not running");
    }
    return this.mpv;
  }
}
