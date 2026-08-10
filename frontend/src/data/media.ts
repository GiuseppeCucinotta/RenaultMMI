import type { CurrentPlaybackFeed, MediaSource, SourceFeed } from "@/types/media";
import demoArtwork from "@/assets/icons/apps/Music.png";

export const DEFAULT_PLAYBACK_FEED: CurrentPlaybackFeed = {
  artistName: "",
  trackTitle: "",
  albumTitle: "",
  artworkUrl: demoArtwork,
  durationSeconds: 0,
  currentTimeSeconds: 0,
  isPlaying: false,
};

export const DEFAULT_SOURCES: MediaSource[] = [
  { id: "bluetooth", name: "Bluetooth", iconKey: "bluetooth" },
  { id: "cd", name: "CD", iconKey: "cd" },
  { id: "fm", name: "FM", iconKey: "fm" },
  { id: "jukebox", name: "Jukebox", iconKey: "jukebox" },
];

export const DEFAULT_SOURCE_FEED: SourceFeed = {
  sources: DEFAULT_SOURCES,
  selectedSourceId: "bluetooth",
};
