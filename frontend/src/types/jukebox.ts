export type {
  JukeboxAlbum,
  JukeboxArtist,
  JukeboxLibrary,
  JukeboxPlaybackState,
  JukeboxSong,
} from "../../shared/jukebox-types";

export interface JukeboxHealth {
  ok: boolean;
  libraryLoaded: boolean;
  mpvAvailable: boolean;
}

export type JukeboxPlaybackAction =
  | "play"
  | "pause"
  | "toggle"
  | "next"
  | "previous"
  | "stop";

export type JukeboxMode = "loading" | "service" | "mock" | "error";
