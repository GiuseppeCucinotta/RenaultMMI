import path from "node:path";
import type {
  JukeboxAlbum,
  JukeboxArtist,
  JukeboxLibrary,
  JukeboxPlaybackState,
  JukeboxSong,
} from "../shared/jukebox-types.js";

export type {
  JukeboxAlbum,
  JukeboxArtist,
  JukeboxLibrary,
  JukeboxPlaybackState,
  JukeboxSong,
};

export function findAlbum(
  library: JukeboxLibrary,
  albumId: string,
): JukeboxAlbum | null {
  for (const artist of library.artists) {
    for (const album of artist.albums) {
      if (album.id === albumId) return album;
    }
  }
  return null;
}

export function resolveMusicPath(musicRoot: string, relativePath: string): string {
  return path.join(musicRoot, relativePath);
}
