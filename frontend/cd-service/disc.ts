import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { readUdevProperties } from "./drive.js";
import { logger } from "./logger.js";

export type DiscIdentity =
  | { kind: "audio"; discId: string; trackCount: number }
  | { kind: "data"; discId: string; label: string | null };

export interface ScannedFile {
  /** Absolute path of the audio file on the mounted disc */
  path: string;
  /** Human-readable title derived from the file name */
  title: string;
}

const AUDIO_EXTENSIONS = new Set([
  ".mp3",
  ".flac",
  ".ogg",
  ".oga",
  ".m4a",
  ".wav",
  ".wma",
]);

const SPAWN_TIMEOUT_MS = 5000;
const MAX_DATA_TRACKS = 999;

/**
 * Classifies the disc currently in the drive:
 * - ISO9660/UDF filesystem detected by udev/blkid -> data disc (MP3/FLAC files)
 * - audio track count reported by the kernel TOC scan -> audio CD (CDDA)
 *
 * The udev database is the primary source (populated by systemd-udevd on
 * every media change); blkid + cd-discid remain as fallbacks for setups
 * where udev properties are unavailable.
 */
export function identifyDisc(device: string): DiscIdentity | null {
  const udev = readUdevProperties(device);
  if (udev) {
    if (udev.ID_FS_TYPE) {
      return {
        kind: "data",
        discId: slugify(udev.ID_FS_UUID || udev.ID_FS_LABEL || "data-disc"),
        label: udev.ID_FS_LABEL || null,
      };
    }
    const audioTracks = Number(udev.ID_CDROM_MEDIA_TRACK_COUNT_AUDIO);
    if (Number.isInteger(audioTracks) && audioTracks > 0) {
      return {
        kind: "audio",
        discId: readAudioDiscId(device) ?? `audio-${audioTracks}`,
        trackCount: audioTracks,
      };
    }
  }

  const filesystem = probeFilesystem(device);
  if (filesystem?.fstype) {
    return {
      kind: "data",
      discId: slugify(filesystem.uuid ?? filesystem.label ?? "data-disc"),
      label: filesystem.label || null,
    };
  }

  const toc = readAudioToc(device);
  if (toc && toc.trackCount > 0) {
    return { kind: "audio", ...toc };
  }
  return null;
}

/** Stable TOC hash from cd-discid, when the utility is installed. */
function readAudioDiscId(device: string): string | null {
  return readAudioToc(device)?.discId ?? null;
}

export interface TocEntry {
  /** 1-based track number */
  index: number;
  /** Start sector (logical sector number) */
  startLsn: number;
  /** Track length in seconds */
  durationSeconds: number;
}

/**
 * Reads the full table of contents via cd-info (libcdio-utils). Used to get
 * real per-track durations and sector offsets, since modern mpv only accepts
 * whole-disc cdda URLs (per-track `cdda://N` support was dropped around
 * mpv 0.38+). Returns null when cd-info is unavailable or unreadable.
 */
export function readToc(device: string): TocEntry[] | null {
  const run = spawnSync("cd-info", ["--no-device-info", device], {
    encoding: "utf8",
    timeout: SPAWN_TIMEOUT_MS,
  });
  const output = run.stdout ?? "";
  if (run.status !== 0 && !output.includes("Track List")) {
    // Some cd-info builds exit non-zero on minor quirks; trust usable output.
    return null;
  }

  interface RawTrack {
    index: number;
    startLsn: number;
  }
  const rawTracks: RawTrack[] = [];
  let leadoutLsn = 0;

  for (const line of output.split("\n")) {
    const trackMatch =
      /^\s*(\d+):\s*\d+:\d+:\d+\s+(\d+)\s+(audio|data)\b/.exec(line);
    if (trackMatch) {
      rawTracks.push({
        index: Number(trackMatch[1]),
        startLsn: Number(trackMatch[2]),
      });
      continue;
    }
    const leadoutMatch = /^\s*\d+:\s*\d+:\d+:\d+\s+(\d+)\s+leadout/.exec(line);
    if (leadoutMatch) {
      leadoutLsn = Number(leadoutMatch[1]);
    }
  }

  if (rawTracks.length === 0 || leadoutLsn <= 0) return null;

  return rawTracks.map((track, i) => {
    const endLsn =
      i + 1 < rawTracks.length ? rawTracks[i + 1].startLsn : leadoutLsn;
    return {
      index: track.index,
      startLsn: track.startLsn,
      durationSeconds: Math.max(0, Math.round((endLsn - track.startLsn) / 75)),
    };
  });
}

interface FilesystemProbe {
  fstype: string;
  label: string;
  uuid: string;
}

function probeFilesystem(device: string): FilesystemProbe | null {
  const run = spawnSync("blkid", ["-o", "export", device], {
    encoding: "utf8",
    timeout: SPAWN_TIMEOUT_MS,
  });
  if (run.status !== 0 || !run.stdout) return null;

  const fields: Record<string, string> = {};
  for (const line of run.stdout.split("\n")) {
    const eq = line.indexOf("=");
    if (eq > 0) fields[line.slice(0, eq)] = line.slice(eq + 1).trim();
  }
  return {
    fstype: fields.ID_FS_TYPE ?? "",
    label: fields.ID_FS_LABEL ?? "",
    uuid: fields.ID_FS_UUID ?? "",
  };
}

function readAudioToc(
  device: string,
): { discId: string; trackCount: number } | null {
  const run = spawnSync("cd-discid", [device], {
    encoding: "utf8",
    timeout: SPAWN_TIMEOUT_MS,
  });
  if (run.status !== 0 || !run.stdout) return null;

  // cd-discid output: "<discid> <numtracks> <offset1> ... <disc-seconds>"
  const parts = run.stdout.trim().split(/\s+/);
  const trackCount = Number(parts[1]);
  if (!parts[0] || !Number.isInteger(trackCount) || trackCount <= 0) {
    return null;
  }
  return { discId: parts[0], trackCount };
}

/**
 * Returns the mount point of a data disc, mounting it through udisks2 when
 * needed. Returns null when the disc cannot be mounted (no udisksd, unreadable).
 */
export function mountDataDisc(device: string): string | null {
  const existing = queryMountPoint(device);
  if (existing) return existing;

  const run = spawnSync("udisksctl", ["mount", "-b", device], {
    encoding: "utf8",
    timeout: 10000,
  });
  if (run.status === 0) {
    const mounted = queryMountPoint(device);
    if (mounted) {
      logger.log(`mounted ${device} at ${mounted}`);
      return mounted;
    }
  } else {
    logger.warn(
      `udisksctl mount failed for ${device}: ${(run.stderr || "").trim() || "unknown error"}`,
    );
  }
  return null;
}

export function unmountDataDisc(device: string): void {
  const result = spawnSync("udisksctl", ["unmount", "-b", device], {
    encoding: "utf8",
    timeout: 10000,
  });
  if (result.status === 0) {
    logger.log(`unmounted ${device}`);
  }
}

function queryMountPoint(device: string): string | null {
  const run = spawnSync("lsblk", ["-no", "MOUNTPOINT", device], {
    encoding: "utf8",
    timeout: SPAWN_TIMEOUT_MS,
  });
  if (run.status !== 0) return null;
  for (const line of (run.stdout ?? "").split("\n")) {
    const candidate = line.trim();
    if (candidate) return candidate;
  }
  return null;
}

/** Recursively collects playable audio files from a mounted data disc. */
export function scanDataTracks(mountPoint: string): ScannedFile[] {
  const files: ScannedFile[] = [];
  walk(mountPoint, mountPoint, files);
  return files;
}

function walk(root: string, dir: string, out: ScannedFile[]): void {
  if (out.length >= MAX_DATA_TRACKS) return;

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      walk(root, full, out);
      continue;
    }
    if (
      entry.isFile() &&
      AUDIO_EXTENSIONS.has(path.extname(entry.name).toLowerCase())
    ) {
      out.push({
        path: full,
        title: titleFromFile(entry.name),
      });
      if (out.length >= MAX_DATA_TRACKS) return;
    }
  }
}

function titleFromFile(fileName: string): string {
  return path.basename(fileName, path.extname(fileName));
}

function slugify(value: string): string {
  const slug = value.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  return slug || "disc";
}
