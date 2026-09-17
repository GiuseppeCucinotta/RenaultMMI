import { EventEmitter } from "node:events";
import {
  defaultMpvFactory,
  mpvSocketPath,
  type MpvFactory,
  type MpvLike,
} from "../shared/mpv.js";
import type { DriveSnapshot } from "./drive.js";
import type { ScannedFile, TocEntry } from "./disc.js";
import type { CdState, CdTrack } from "./types.js";
import { IDLE_CD_STATE } from "./types.js";
import { logger } from "./logger.js";

export interface LoadedDisc {
  kind: "audio" | "data";
  discId: string;
  /** CD-Text album or data-disc volume label, once known */
  title: string | null;
  artist: string | null;
}

/**
 * RAM snapshot taken by {@link CdPlayer.suspend}. The disc id is what makes a
 * resume safe: if a different disc is in the drive when the service wakes up,
 * the snapshot is discarded instead of seeking into a stream that no longer
 * exists.
 */
export interface CdSnapshot {
  discId: string;
  /** Chapter/playlist index of the current track (0-based). */
  trackIndex: number;
  /** Stream-absolute position in seconds. */
  positionSeconds: number;
  wasPlaying: boolean;
}

export interface CdPlayerOptions {
  /** Injectable mpv constructor — tests pass a fake, production uses node-mpv. */
  createMpv?: MpvFactory;
}

/** Seconds before the current position restarts the track on "previous". */
const PREVIOUS_RESTART_THRESHOLD_S = 3;

/** How long an explicit chapter jump is protected from stale positions (ms). */
const CHAPTER_SETTLE_MS = 10000;

/**
 * Drives mpv for the inserted disc:
 * - audio CDs are loaded as ONE whole-disc `cdda://` stream (libcdio-paranoia
 *   reads the raw sectors). Modern mpv dropped per-track cdda URLs, but the
 *   whole-disc load exposes every CD track as an mpv chapter, which we use for
 *   track navigation. Real track durations come from the cd-info TOC.
 * - data discs play the scanned file playlist directly off the mount point.
 *
 * A disc autoplays from track 1 as soon as it is loaded, matching car-stereo
 * behaviour. CD-Text titles (when present) replace the generic "Track N"
 * labels as soon as mpv reports them.
 */
export class CdPlayer extends EventEmitter {
  private readonly mpvBinary: string;
  private readonly createMpv: MpvFactory;
  private mpv: MpvLike | null = null;
  private mpvDevice: string | null = null;
  private disc: LoadedDisc | null = null;
  private tracks: CdTrack[] = [];
  /** Chapter/playlist index of the current track (0-based). */
  private trackIndex = 0;
  /** Explicitly requested chapter while mpv is still seeking there. */
  private desiredChapter: number | null = null;
  private desiredChapterAt = 0;
  /** Last track-relative seek target, while it is still settling. */
  private lastSeekInto: number | null = null;
  private lastSeekAt = 0;
  /** Start time (s) of each chapter within the whole-disc stream. */
  private chapterTimes: number[] = [];
  private durationSeconds = 0;
  private currentTimeSeconds = 0;
  private isPlaying = false;
  private volume = 83;
  private drive: DriveSnapshot = { device: null, hasMedia: false };
  /** Reloads the currently inserted disc (used after an mpv crash). */
  private reloadDisc: (() => Promise<void>) | null = null;
  private recovering = false;
  /** Position/disc kept in RAM while the service is suspended. */
  private snapshot: CdSnapshot | null = null;

  constructor(mpvBinary: string, options: CdPlayerOptions = {}) {
    super();
    this.mpvBinary = mpvBinary;
    this.createMpv = options.createMpv ?? defaultMpvFactory;
  }

  isRunning(): boolean {
    return this.mpv?.isRunning() ?? false;
  }

  setDrive(snapshot: DriveSnapshot): void {
    const changed =
      snapshot.device !== this.drive.device ||
      snapshot.hasMedia !== this.drive.hasMedia;
    this.drive = snapshot;
    if (changed) this.emitState();
  }

  async loadAudioDisc(
    device: string,
    discId: string,
    trackCount: number,
    toc: TocEntry[] | null,
  ): Promise<void> {
    await this.ensureMpv(device);

    this.disc = { kind: "audio", discId, title: null, artist: null };
    this.tracks = Array.from({ length: trackCount }, (_, i) => {
      const tocEntry = toc?.find((entry) => entry.index === i + 1);
      return {
        index: i + 1,
        title: `Track ${i + 1}`,
        durationSeconds: tocEntry?.durationSeconds ?? null,
      };
    });
    // Whole-disc stream: one playlist entry, one chapter per CD track.
    this.chapterTimes =
      toc && toc.length === trackCount
        ? toc.map((entry) => entry.startLsn / 75)
        : [];
    this.reloadDisc = () =>
      this.loadAudioDisc(device, discId, trackCount, toc);
    await this.loadPlaylist(["cdda://"]);
  }

  async loadDataDisc(
    discId: string,
    label: string | null,
    files: ScannedFile[],
  ): Promise<void> {
    await this.ensureMpv(null);

    this.disc = { kind: "data", discId, title: label, artist: null };
    this.tracks = files.map((file, i) => ({
      index: i + 1,
      title: file.title,
      durationSeconds: null,
    }));
    this.chapterTimes = [];
    this.reloadDisc = () => this.loadDataDisc(discId, label, files);
    await this.loadPlaylist(files.map((file) => file.path));
  }

  async playFromStart(): Promise<void> {
    const mpv = this.requireMpv();
    try {
      // A freshly loaded disc starts at position 0 anyway; just ensure playback.
      await mpv.play();
    } catch (error) {
      logger.warn(
        "playFromStart failed:",
        error instanceof Error ? error.message : error,
      );
    }
    this.trackIndex = 0;
    this.currentTimeSeconds = 0;
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
    await this.requireMpv().play();
  }

  async next(): Promise<void> {
    if (!this.disc || this.trackIndex >= this.tracks.length - 1) return;
    await this.goToTrack(this.trackIndex + 1);
  }

  async previous(): Promise<void> {
    if (!this.disc) return;

    // Position reads are unreliable while CDDA seeks buffer; prefer what the
    // listener actually asked for recently over where the stream currently is.
    const seekPending =
      this.lastSeekInto != null && Date.now() - this.lastSeekAt < CHAPTER_SETTLE_MS;
    const jumpPending =
      this.desiredChapter != null && Date.now() - this.desiredChapterAt < CHAPTER_SETTLE_MS;

    let intoTrack = this.currentTimeSeconds - this.chapterStartTime(this.trackIndex);
    if (seekPending) intoTrack = this.lastSeekInto ?? intoTrack;
    if (jumpPending) intoTrack = 0;

    if (intoTrack > PREVIOUS_RESTART_THRESHOLD_S || this.trackIndex === 0) {
      await this.goToTrack(this.trackIndex);
    } else {
      await this.goToTrack(this.trackIndex - 1);
    }
  }

  async playTrackAt(trackIndex1Based: number): Promise<void> {
    const index = trackIndex1Based - 1;
    if (!this.disc || index < 0 || index >= this.tracks.length) {
      throw new Error(`Track ${trackIndex1Based} out of range`);
    }
    await this.goToTrack(index);
  }

  /**
   * Seeks within the CURRENT TRACK (seconds are track-relative), matching the
   * renderer's progress-bar contract.
   */
  async seek(seconds: number): Promise<void> {
    if (this.disc?.kind === "audio" && this.chapterTimes.length > 0) {
      const base = this.chapterStartTime(this.trackIndex);
      const maxInto = this.tracks[this.trackIndex]?.durationSeconds;
      let target = base + Math.max(0, seconds);
      if (maxInto) target = Math.min(target, base + maxInto - 1);
      await this.requireMpv().seek(target, "absolute");
      this.lastSeekInto = Math.max(0, seconds);
      this.lastSeekAt = Date.now();
      return;
    }
    await this.requireMpv().seek(seconds, "absolute");
    this.lastSeekInto = null;
    this.lastSeekAt = Date.now();
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

  /** Disc ejected or became unreadable: drop state and tear down mpv. */
  async onDiscRemoved(): Promise<void> {
    this.resetPlayback();
    this.disc = null;
    this.tracks = [];
    this.chapterTimes = [];
    this.reloadDisc = null;
    this.snapshot = null;
    await this.quit();
    this.emitState();
  }

  /* --------------------------- suspend / resume --------------------------- */

  /**
   * Keeps the disc identity, track and position in RAM, then releases mpv and
   * everything it holds (decoder, buffers, the open cdda stream).
   *
   * The disc metadata itself is kept so `/api/state` and `/api/events` still
   * describe what is loaded while the service sleeps.
   */
  async suspend(): Promise<CdSnapshot | null> {
    if (this.disc) {
      this.snapshot = {
        discId: this.disc.discId,
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

  /** The snapshot held in RAM (null when running or no disc was loaded). */
  getSnapshot(): CdSnapshot | null {
    return this.snapshot;
  }

  clearSnapshot(): void {
    this.snapshot = null;
  }

  /**
   * Re-applies the snapshot to a freshly (re)loaded disc. Must be called after
   * the matching disc content has been loaded via `loadAudioDisc` /
   * `loadDataDisc`; returns false when there is nothing to restore or the
   * loaded disc is not the one that was suspended.
   */
  async restoreSnapshot(): Promise<boolean> {
    const snapshot = this.snapshot;
    if (!snapshot || !this.disc) return false;
    if (this.disc.discId !== snapshot.discId) return false;

    const index = Math.min(
      Math.max(snapshot.trackIndex, 0),
      Math.max(this.tracks.length - 1, 0),
    );
    await this.goToTrack(index);

    if (snapshot.positionSeconds > 0) {
      await this.requireMpv().seek(snapshot.positionSeconds, "absolute");
      this.currentTimeSeconds = snapshot.positionSeconds;
    }

    this.isPlaying = snapshot.wasPlaying;
    if (snapshot.wasPlaying) await this.requireMpv().play();
    else await this.requireMpv().pause();

    this.snapshot = null;
    this.emitState();
    return true;
  }

  /**
   * Called periodically by the service: detects a dead mpv (killed, OOM,
   * crash) while a disc is loaded and brings playback back at the same track.
   * Without this the state goes stale — "playing" with nothing audible and
   * controls that silently do nothing.
   */
  async healthCheck(): Promise<void> {
    if (!this.disc || this.recovering) return;
    if (this.mpv && !this.mpv.isRunning()) {
      logger.warn("mpv is down while a disc is loaded");
      await this.recover();
    }
  }

  /** Restarts mpv and resumes the current disc at the current track. */
  async recover(): Promise<void> {
    if (!this.disc || this.recovering) return;
    this.recovering = true;

    const resumeTrack = this.trackIndex;
    try {
      logger.warn(`recovering mpv, resuming at track ${resumeTrack + 1}`);
      await new Promise((resolve) => setTimeout(resolve, 1500));
      this.mpv = null; // force a fresh instance
      const reload = this.reloadDisc;
      if (!reload) return;
      await reload();
      await this.playFromStart();
      if (resumeTrack > 0) {
        // Right after a fresh load the cdda stream may not accept seeks yet
        // (stream still opening); retry until the jump lands.
        for (let i = 0; i < 6 && this.trackIndex !== resumeTrack; i++) {
          await new Promise((resolve) => setTimeout(resolve, 1200));
          await this.goToTrack(resumeTrack);
        }
      }
    } catch (error) {
      logger.error(
        "recovery failed:",
        error instanceof Error ? error.message : error,
      );
      this.isPlaying = false;
      this.emitState();
    } finally {
      this.recovering = false;
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
    this.resetPlayback();
    this.emitState();
  }

  async quit(): Promise<void> {
    const mpv = this.mpv;
    this.mpv = null;
    this.mpvDevice = null;
    if (mpv?.isRunning()) {
      await mpv.quit().catch(() => undefined);
    }
  }

  getState(): CdState {
    if (!this.disc) {
      return {
        ...IDLE_CD_STATE,
        driveConnected: this.drive.device != null,
        device: this.drive.device,
      };
    }

    const track = this.tracks[this.trackIndex];
    const trackDuration =
      track?.durationSeconds ??
      (this.chapterTimes.length > 0
        ? this.nextChapterTime(this.trackIndex) - this.chapterStartTime(this.trackIndex)
        : null);

    return {
      driveConnected: this.drive.device != null,
      device: this.drive.device,
      hasDisc: true,
      discType: this.disc.kind,
      discId: this.disc.discId,
      discTitle: this.disc.title,
      tracks: this.tracks,
      currentTrackIndex: this.trackIndex + 1,
      currentTimeSeconds: Math.max(
        0,
        Math.round(this.currentTimeSeconds - this.chapterStartTime(this.trackIndex)),
      ),
      durationSeconds: trackDuration ?? this.durationSeconds ?? null,
      isPlaying: this.isPlaying,
    };
  }

  private resetPlayback(): void {
    this.trackIndex = 0;
    this.currentTimeSeconds = 0;
    this.durationSeconds = 0;
    this.isPlaying = false;
    this.desiredChapter = null;
    this.lastSeekInto = null;
  }

  private emitState(): void {
    this.emit("state", this.getState());
  }

  private chapterStartTime(index: number): number {
    return this.chapterTimes[index] ?? 0;
  }

  private nextChapterTime(index: number): number {
    return (
      this.chapterTimes[index + 1] ??
      this.chapterStartTime(index) + (this.tracks[index]?.durationSeconds ?? 0)
    );
  }

  private async goToTrack(index: number): Promise<void> {
    const mpv = this.requireMpv();

    /**
     * Seeks can silently fail right after a load: the cdda stream takes a
     * while to open, mpv rejects commands in that window and node-mpv does
     * not always propagate the rejection. So issue the command, then VERIFY
     * the player actually moved before reporting success.
     */
    for (let attempt = 0; attempt < 10; attempt++) {
      try {
        if (this.disc?.kind === "audio" && this.chapterTimes.length > 0) {
          await mpv.seek(this.chapterTimes[index] + 0.1, "absolute");
        } else if (this.disc?.kind === "audio") {
          await mpv.setProperty("chapter", index);
        } else {
          await mpv.jump(index);
        }
      } catch {
        // fall through to verification/retry
      }

      await new Promise((resolve) => setTimeout(resolve, 400));
      if (await this.isOnTrack(index)) {
        this.trackIndex = index;
        this.desiredChapter = index;
        this.desiredChapterAt = Date.now();
        this.lastSeekInto = null;
        void this.refreshMetadata();
        this.emitState();
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 900));
    }

    logger.warn(`goToTrack(${index}) did not land — keeping track ${this.trackIndex + 1}`);
  }

  /** True when mpv confirms playback sits at the requested track. */
  private async isOnTrack(index: number): Promise<boolean> {
    if (!this.mpv?.isRunning()) return false;
    try {
      if (this.disc?.kind === "audio") {
        const value = (await this.mpv.getProperty("chapter")) as unknown;
        if (typeof value === "number" && value >= 0) return value === index;
        // No chapter support: accept a position close to the track start.
        return (
          this.chapterTimes.length > 0 &&
          Math.abs(this.currentTimeSeconds - this.chapterTimes[index]) < 6
        );
      }
      const pos = (await this.mpv.getProperty("playlist-pos")) as unknown;
      return pos === index;
    } catch {
      return false;
    }
  }

  /**
   * Starts mpv lazily on first disc insert. Audio CDs need the drive passed
   * via --cdda-device; a drive change between inserts restarts the instance.
   */
  private async ensureMpv(device: string | null): Promise<void> {
    if (this.mpv && this.mpvDevice !== device) {
      await this.quit();
    }
    if (this.mpv) return;

    this.mpvDevice = device;
    const mpv = this.createMpv(
      {
        binary: this.mpvBinary,
        audio_only: true,
        time_update: 0.5,
        socket: mpvSocketPath("cd"),
      },
      ["--no-video", `--volume=${this.volume}`]
        .concat(device ? [`--cdda-device=${device}`, "--cdda-cdtext=yes"] : []),
    );
    this.mpv = mpv;

    this.attachHandlers(mpv);
    await mpv.start();
  }

  private attachHandlers(mpv: MpvLike): void {
    // The whole-disc CDDA stream has no playlist movement; the current track
    // is the active mpv CHAPTER. Track it on every position tick (~2 Hz).
    mpv.on("timeposition", (seconds: number) => {
      this.currentTimeSeconds = seconds;
      void this.syncChapter();
      this.emitState();
    });

    mpv.on("status", (status: { property: string; value: unknown }) => {
      if (status.property === "playlist-pos" && typeof status.value === "number") {
        if (status.value >= 0 && status.value !== this.trackIndex && !this.disc) {
          this.trackIndex = status.value;
        }
        this.emitState();
      } else if (status.property === "duration" && typeof status.value === "number") {
        this.durationSeconds = status.value;
        this.emitState();
      } else if (status.property === "pause" && typeof status.value === "boolean") {
        this.isPlaying = !status.value;
        this.emitState();
      }
    });

    mpv.on("started", () => {
      this.isPlaying = true;
      void this.refreshMetadata();
      this.emitState();
    });

    mpv.on("resumed", () => {
      this.isPlaying = true;
      this.emitState();
    });

    mpv.on("paused", () => {
      this.isPlaying = false;
      this.emitState();
    });

    mpv.on("stopped", () => {
      this.isPlaying = false;
      this.emitState();
    });

    mpv.on("crashed", () => {
      this.isPlaying = false;
      this.emitState();
      void this.recover();
    });
  }

  /**
   * Keeps trackIndex aligned with the active mpv chapter.
   *
   * The `chapter` property is authoritative; the position-derived fallback
   * exists for builds that don't expose it. During long CDDA seeks mpv keeps
   * reporting positions from where the stream is actually reading (often far
   * behind the target), so a freshly requested chapter is protected by a
   * settle window before position evidence may override it.
   */
  private async syncChapter(): Promise<void> {
    if (this.disc?.kind !== "audio") return;

    let chapter: number | null = null;
    try {
      const value = (await this.requireMpv().getProperty("chapter")) as unknown;
      if (typeof value === "number" && value >= 0) chapter = value;
    } catch {
      // property unavailable — fall back to position mapping below
    }

    if (chapter == null && this.chapterTimes.length > 0) {
      chapter = this.chapterFromPosition(this.currentTimeSeconds);
    }
    if (chapter == null || chapter === this.trackIndex) return;

    const settling =
      this.desiredChapter != null &&
      Date.now() - this.desiredChapterAt < CHAPTER_SETTLE_MS;
    if (settling && chapter !== this.desiredChapter) return;

    logger.log(`track ${chapter + 1}/${this.tracks.length}`);
    this.trackIndex = chapter;
    if (chapter === this.desiredChapter) this.desiredChapter = null;
    void this.refreshMetadata();
    this.emitState();
  }

  private chapterFromPosition(seconds: number): number {
    let chapter = 0;
    for (let i = 0; i < this.chapterTimes.length; i++) {
      if (seconds >= this.chapterTimes[i]) chapter = i;
    }
    return chapter;
  }

  /**
   * Pulls CD-Text / tag metadata for the current track once mpv has it
   * loaded, upgrading the placeholder "Track N" titles in place.
   */
  private async refreshMetadata(): Promise<void> {
    if (!this.disc || !this.mpv?.isRunning()) return;
    try {
      const chapterMeta = (await this.mpv.getProperty(
        "chapter-metadata",
      )) as unknown as Record<string, unknown> | null | undefined;
      if (chapterMeta && typeof chapterMeta === "object") {
        const title = chapterMeta.TITLE ?? chapterMeta.title;
        const track = this.tracks[this.trackIndex];
        if (typeof title === "string" && title.trim() && track) {
          track.title = title.trim();
          this.emitState();
        }
      }

      if (!this.disc.title || !this.disc.artist) {
        const meta = (await this.mpv.getMetadata()) as unknown as Record<string, unknown>;
        const album = meta.album ?? meta.ALBUM;
        const artist = meta.artist ?? meta.ARTIST;
        if (typeof album === "string" && album.trim() && !this.disc.title) {
          this.disc.title = album.trim();
          this.emitState();
        }
        if (typeof artist === "string" && artist.trim() && !this.disc.artist) {
          this.disc.artist = artist.trim();
          this.emitState();
        }
      }
    } catch {
      // metadata unavailable (plain CDDA without CD-Text) — keep placeholders
    }
  }

  private requireMpv(): MpvLike {
    if (!this.mpv) {
      throw new Error("CD player is not running");
    }
    return this.mpv;
  }

  private async loadPlaylist(entries: string[]): Promise<void> {
    const mpv = this.requireMpv();
    this.resetPlayback();

    await mpv.clearPlaylist();
    // Raw IPC commands on purpose: node-mpv's load()/append() run the target
    // through path.resolve() unless it contains "http", which destroys
    // protocol URLs like cdda://.
    for (let index = 0; index < entries.length; index++) {
      const mode =
        index === 0 ? "replace" : this.disc?.kind === "data" ? "append-play" : "append";
      await mpv.command("loadfile", [entries[index], mode]);
    }
    this.emitState();
  }
}
