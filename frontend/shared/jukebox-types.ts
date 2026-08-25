export interface JukeboxSong {
  id: string;
  title: string;
  track: number;
  durationSeconds: number;
  format: string;
  filePath: string;
}

export interface JukeboxAlbum {
  id: string;
  title: string;
  artistName: string;
  year: number | null;
  artworkPath: string | null;
  songs: JukeboxSong[];
}

export interface JukeboxArtist {
  id: string;
  name: string;
  albums: JukeboxAlbum[];
}

export interface JukeboxLibrary {
  schemaVersion: 2;
  generatedAt: string;
  musicRoot: string;
  artists: JukeboxArtist[];
}

export interface JukeboxPlaybackState {
  albumId: string | null;
  trackIndex: number;
  artistName: string | null;
  albumTitle: string | null;
  trackTitle: string | null;
  durationSeconds: number | null;
  currentTimeSeconds: number;
  isPlaying: boolean;
}
