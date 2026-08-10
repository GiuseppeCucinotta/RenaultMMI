import type {
  JukeboxAlbum,
  JukeboxArtist,
  JukeboxLibrary,
  JukeboxPlaybackState,
} from "@/types/jukebox";

export const IDLE_PLAYBACK_STATE: JukeboxPlaybackState = {
  albumId: null,
  trackIndex: 0,
  artistName: null,
  albumTitle: null,
  trackTitle: null,
  durationSeconds: null,
  currentTimeSeconds: 0,
  isPlaying: false,
};

export const MOCK_LIBRARY: JukeboxLibrary = {
  schemaVersion: 2,
  generatedAt: new Date(0).toISOString(),
  musicRoot: "mock",
  artists: [
    {
      id: "ar_radiohead",
      name: "Radiohead",
      albums: [
        {
          id: "al_radiohead-the-bends",
          title: "The Bends",
          artistName: "Radiohead",
          year: 1995,
          artworkPath: null,
          songs: [
            { id: "so_1", title: "Planet Telex", track: 1, durationSeconds: 259, format: "wav", filePath: "mock" },
            { id: "so_2", title: "The Bends", track: 2, durationSeconds: 246, format: "wav", filePath: "mock" },
            { id: "so_3", title: "High and Dry", track: 3, durationSeconds: 258, format: "wav", filePath: "mock" },
            { id: "so_4", title: "Fake Plastic Trees", track: 4, durationSeconds: 290, format: "wav", filePath: "mock" },
          ],
        },
        {
          id: "al_radiohead-hail-to-the-thief",
          title: "Hail To The Thief",
          artistName: "Radiohead",
          year: 2003,
          artworkPath: null,
          songs: [
            { id: "so_1", title: "2 + 2 = 5", track: 1, durationSeconds: 199, format: "wav", filePath: "mock" },
            { id: "so_2", title: "Sit Down. Stand Up", track: 2, durationSeconds: 260, format: "wav", filePath: "mock" },
            { id: "so_3", title: "Sail To The Moon", track: 3, durationSeconds: 258, format: "wav", filePath: "mock" },
          ],
        },
      ],
    },
    {
      id: "ar_muse",
      name: "Muse",
      albums: [
        {
          id: "al_muse-black-holes-and-revelations",
          title: "Black Holes & Revelations",
          artistName: "Muse",
          year: 2006,
          artworkPath: null,
          songs: [
            { id: "so_1", title: "Knights of Cydonia", track: 1, durationSeconds: 366, format: "flac", filePath: "mock" },
            { id: "so_2", title: "Starlight", track: 2, durationSeconds: 240, format: "flac", filePath: "mock" },
          ],
        },
      ],
    },
  ],
};

function compareArtists(a: JukeboxArtist, b: JukeboxArtist): number {
  return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
}

function compareAlbums(a: JukeboxAlbum, b: JukeboxAlbum): number {
  if (a.year !== b.year) {
    if (a.year === null) return 1;
    if (b.year === null) return -1;
    return a.year - b.year;
  }
  return a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
}

export function flattenAlbums(library: JukeboxLibrary): JukeboxAlbum[] {
  const albums: JukeboxAlbum[] = [];
  const artists = [...library.artists].sort(compareArtists);
  for (const artist of artists) {
    albums.push(...[...artist.albums].sort(compareAlbums));
  }
  return albums;
}

export function findAlbumById(
  library: JukeboxLibrary | null,
  albumId: string,
): JukeboxAlbum | null {
  if (!library) return null;
  for (const artist of library.artists) {
    const album = artist.albums.find((candidate) => candidate.id === albumId);
    if (album) return album;
  }
  return null;
}
