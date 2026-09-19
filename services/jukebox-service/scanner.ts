import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import fg from "fast-glob";
import pLimit from "p-limit";
import { parseFile } from "music-metadata";
import type {
  JukeboxAlbum,
  JukeboxArtist,
  JukeboxLibrary,
  JukeboxSong,
} from "./library.js";

const AUDIO_EXTENSIONS = ["mp3", "flac", "m4a", "aac", "ogg", "opus", "wav", "wma"];
const AUDIO_PATTERN = `**/*.{${AUDIO_EXTENSIONS.join(",")}}`;
const ARTWORK_FILENAMES = [
  "cover.jpg",
  "front.jpg",
  "artwork.jpg",
  "folder.jpg",
  "album.jpg",
  "thumb.jpg",
];

export function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  return slug || "unknown";
}

export const artistId = (name: string): string => `ar_${slugify(name)}`;
export const albumId = (artistName: string, albumTitle: string): string =>
  `al_${slugify(artistName)}-${slugify(albumTitle)}`;
export const songId = (album: string, track: number): string =>
  `so_${album}_${String(track).padStart(2, "0")}`;

interface ParsedAudioFile {
  absPath: string;
  relPath: string;
  dirAbs: string;
  parentDir: string;
  grandParentDir: string | null;
  ext: string;
  title: string | null;
  artist: string | null;
  album: string | null;
  trackNo: number | null;
  year: number | null;
  durationSeconds: number;
  picture: Uint8Array | null;
}

function titleFromFilename(filename: string): string {
  const name = filename.replace(/\.[^.]+$/, "");
  const stripped = name.replace(/^(\d{1,3})[\s._-]*[-._]?\s*(.+)$/, "$2");
  return stripped || name;
}

function trackFromFilename(filename: string): number | null {
  const match = filename.match(/^(\d{1,3})[\s._-]*[-._]/);
  return match ? Number(match[1]) : null;
}

async function parseAudioFile(absPath: string, musicRoot: string): Promise<ParsedAudioFile> {
  const relPath = path.relative(musicRoot, absPath);
  const dirAbs = path.dirname(absPath);
  const dirRel = path.dirname(relPath);
  const segments = dirRel.split(path.sep).filter((segment) => segment !== "." && segment !== "");
  const parentDir = segments[segments.length - 1] ?? "";
  const grandParentDir = segments.length > 1 ? segments[segments.length - 2] : null;
  const ext = path.extname(absPath).replace(".", "").toLowerCase();

  let title: string | null = null;
  let artist: string | null = null;
  let album: string | null = null;
  let trackNo: number | null = null;
  let year: number | null = null;
  let durationSeconds = 0;
  let picture: Uint8Array | null = null;

  try {
    const metadata = await parseFile(absPath, { duration: true });
    const common = metadata.common;
    title = common.title ?? null;
    artist = common.artist ?? null;
    album = common.album ?? null;
    trackNo = common.track?.no ?? trackFromFilename(path.basename(absPath));
    year = common.year ?? null;
    durationSeconds = metadata.format.duration ?? 0;
    picture = common.picture?.[0]?.data ?? null;
  } catch {
    // Unreadable metadata falls back to filename + folder heuristics below.
  }

  return {
    absPath,
    relPath,
    dirAbs,
    parentDir,
    grandParentDir,
    ext,
    title,
    artist,
    album,
    trackNo,
    year,
    durationSeconds,
    picture,
  };
}

interface AlbumGroup {
  artistName: string;
  albumTitle: string;
  items: ParsedAudioFile[];
}

export interface ScanOptions {
  concurrency?: number;
}

export async function scanLibrary(
  musicRoot: string,
  artworkCacheDir: string,
  options: ScanOptions = {},
): Promise<JukeboxLibrary> {
  const concurrency = options.concurrency ?? 4;

  const files = await fg(AUDIO_PATTERN, {
    cwd: musicRoot,
    absolute: true,
    onlyFiles: true,
    dot: false,
    ignore: ["**/.jukebox/**"],
  });

  const limit = pLimit(concurrency);
  const parsed = await Promise.all(
    files.map((file) => limit(() => parseAudioFile(file, musicRoot))),
  );

  const groupMap = new Map<string, AlbumGroup>();
  for (const item of parsed) {
    const artistName = item.artist ?? item.grandParentDir ?? "Unknown Artist";
    const albumTitle = item.album ?? item.parentDir ?? "Unknown Album";
    const key = `${artistName}\u0000${albumTitle}`;
    let group = groupMap.get(key);
    if (!group) {
      group = { artistName, albumTitle, items: [] };
      groupMap.set(key, group);
    }
    group.items.push(item);
  }

  const groups = Array.from(groupMap.values());
  const artists = new Map<string, JukeboxArtist>();

  for (const group of groups) {
    group.items.sort((a, b) => {
      const trackA = a.trackNo ?? Number.MAX_SAFE_INTEGER;
      const trackB = b.trackNo ?? Number.MAX_SAFE_INTEGER;
      if (trackA !== trackB) return trackA - trackB;
      return a.relPath.localeCompare(b.relPath);
    });

    const id = albumId(group.artistName, group.albumTitle);

    const songs: JukeboxSong[] = group.items.map((item, index) => ({
      id: songId(id, item.trackNo ?? index + 1),
      title: item.title ?? titleFromFilename(path.basename(item.absPath)),
      track: item.trackNo ?? index + 1,
      durationSeconds: Math.round(item.durationSeconds),
      format: item.ext,
      filePath: item.relPath,
    }));

    let artworkPath: string | null = null;
    const embeddedPicture = group.items.find((item) => item.picture)?.picture ?? null;
    if (embeddedPicture) {
      await fs.mkdir(artworkCacheDir, { recursive: true });
      const cachePath = path.join(artworkCacheDir, `${id}.jpg`);
      await fs.writeFile(cachePath, embeddedPicture);
      artworkPath = path.relative(musicRoot, cachePath);
    } else {
      const firstDir = group.items[0]?.dirAbs;
      if (firstDir) {
        for (const candidate of ARTWORK_FILENAMES) {
          const candidatePath = path.join(firstDir, candidate);
          if (existsSync(candidatePath)) {
            artworkPath = path.relative(musicRoot, candidatePath);
            break;
          }
        }
      }
    }

    const album: JukeboxAlbum = {
      id,
      title: group.albumTitle,
      artistName: group.artistName,
      year: group.items.find((item) => item.year)?.year ?? null,
      artworkPath,
      songs,
    };

    const idArtist = artistId(group.artistName);
    let artist = artists.get(idArtist);
    if (!artist) {
      artist = { id: idArtist, name: group.artistName, albums: [] };
      artists.set(idArtist, artist);
    }
    artist.albums.push(album);
  }

  const artistList = Array.from(artists.values()).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  for (const artist of artistList) {
    artist.albums.sort((a, b) => a.title.localeCompare(b.title));
  }

  return {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    musicRoot,
    artists: artistList,
  };
}

export async function saveLibrary(
  libraryPath: string,
  library: JukeboxLibrary,
): Promise<void> {
  const tmpPath = `${libraryPath}.tmp`;
  await fs.writeFile(tmpPath, JSON.stringify(library, null, 2) + "\n");
  await fs.rename(tmpPath, libraryPath);
}

export async function loadLibrary(libraryPath: string): Promise<JukeboxLibrary | null> {
  try {
    const raw = await fs.readFile(libraryPath, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    if ((parsed as JukeboxLibrary).schemaVersion !== 2) return null;
    return parsed as JukeboxLibrary;
  } catch {
    return null;
  }
}
