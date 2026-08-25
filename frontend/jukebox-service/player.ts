import { EventEmitter } from "node:events";
import os from "node:os";
import path from "node:path";
import Mpv from "node-mpv";
import { findAlbum, type JukeboxLibrary, type JukeboxPlaybackState } from "./library.js";

export class JukeboxPlayer extends EventEmitter {
  private readonly musicRoot: string;
  private readonly mpvBinary: string;
  private mpv: Mpv | null = null;
  private library: JukeboxLibrary | null = null;
  private albumId: string | null = null;
  private trackIndex = 0;
  private durationSeconds = 0;
  private currentTimeSeconds = 0;
  private isPlaying = false;
  private volume = 83;

  constructor(musicRoot: string, mpvBinary: string) {
    super();
    this.musicRoot = musicRoot;
    this.mpvBinary = mpvBinary;
  }

  setLibrary(library: JukeboxLibrary | null): void {
    this.library = library;
  }

  isRunning(): boolean {
    return this.mpv?.isRunning() ?? false;
  }

  async start(): Promise<void> {
    if (this.mpv) return;

    this.mpv = new Mpv(
      {
        binary: this.mpvBinary,
        audio_only: true,
        time_update: 0.5,
        socket: path.join(os.tmpdir(), `jukebox-mpv-${process.pid}.sock`),
      },
      ["--no-video", `--volume=${this.volume}`],
    );

    this.mpv.on("timeposition", (seconds: number) => {
      this.currentTimeSeconds = seconds;
      this.emitState();
    });

    this.mpv.on("status", (status: { property: string; value: unknown }) => {
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

    this.mpv.on("started", async () => {
      this.isPlaying = true;
      try {
        const duration = await this.mpv?.getDuration();
        if (typeof duration === "number" && duration > 0) {
          this.durationSeconds = duration;
        }
      } catch {
        // keep the metadata-derived duration as a fallback
      }
      this.emitState();
    });

    this.mpv.on("paused", () => {
      this.isPlaying = false;
      this.emitState();
    });

    this.mpv.on("resumed", () => {
      this.isPlaying = true;
      this.emitState();
    });

    this.mpv.on("stopped", () => {
      this.isPlaying = false;
      this.emitState();
    });

    this.mpv.on("crashed", () => {
      this.isPlaying = false;
      this.emitState();
    });

    await this.mpv.start();
  }

  async quit(): Promise<void> {
    const mpv = this.mpv;
    this.mpv = null;
    if (mpv?.isRunning()) {
      await mpv.quit().catch(() => undefined);
    }
  }

  async playAlbum(albumId: string): Promise<void> {
    if (!this.mpv || !this.mpv.isRunning()) {
      await this.start();
    }
    const mpv = this.requireMpv();
    const album = this.library ? findAlbum(this.library, albumId) : null;
    if (!album || album.songs.length === 0) {
      throw new Error(`Album "${albumId}" not found in library`);
    }

    const paths = album.songs.map((song) => path.join(this.musicRoot, song.filePath));

    this.albumId = albumId;
    this.trackIndex = 0;
    this.currentTimeSeconds = 0;
    this.durationSeconds = album.songs[0].durationSeconds;

    await mpv.clearPlaylist();
    for (let index = 0; index < paths.length; index++) {
      if (index === 0) {
        await mpv.load(paths[index], "replace");
      } else {
        await mpv.append(paths[index], "append");
      }
    }
    await mpv.loopPlaylist("inf").catch(() => undefined);

    this.isPlaying = true;
    this.emitState();
  }

  async togglePause(): Promise<void> {
    await this.requireMpv().togglePause();
  }

  async pause(): Promise<void> {
    await this.requireMpv().pause();
  }

  async resume(): Promise<void> {
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
    this.emitState();
    await this.quit();
  }

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

  private emitState(): void {
    this.emit("state", this.getState());
  }

  private requireMpv(): Mpv {
    if (!this.mpv) {
      throw new Error("Player is not running");
    }
    return this.mpv;
  }
}
