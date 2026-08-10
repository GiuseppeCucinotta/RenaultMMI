export interface MediaSource {
  id: string;
  name: string;
  iconKey: string;
}

export interface SourceNowPlaying {
  sourceId: string;
  sourceName: string;
  trackTitle: string | null;
  artistName: string | null;
  albumTitle: string | null;
  albumArtUrl: string | null;
  isPlaying: boolean;
}

/**
 * Per-source contract consumed by the now-playing hub. Every audio source
 * (Bluetooth, CD, FM, Jukebox, ...) implements one so consumers stay
 * source-agnostic.
 */
export interface MediaSourceAdapter {
  getNowPlaying(): SourceNowPlaying | null;
  isActive(): boolean;
  togglePlayPause(): void;
  skipToNext(): void;
}

export interface NowPlayingFeed {
  trackName: string;
  source: string;
  albumArt: string | null;
  isPlaying: boolean;
  onPlayPause: () => void;
  onSkip: () => void;
}

export interface SourceFeed {
  sources: MediaSource[];
  selectedSourceId: string;
}

export interface CurrentPlaybackFeed {
  artistName: string;
  trackTitle: string;
  albumTitle: string;
  artworkUrl: string;
  durationSeconds: number;
  currentTimeSeconds: number;
  isPlaying: boolean;
}

export interface WatermarkProps {
  artistName: string;
}

export interface ArtworkProps {
  artworkUrl: string;
  artistName: string;
  trackTitle: string;
  layoutId?: string;
}

export interface TrackMetadataProps {
  trackTitle: string;
  albumTitle: string;
}

export interface PlaybackControlsProps {
  isPlaying: boolean;
  onPrevious?: () => void;
  onPlayPause?: () => void;
  onNext?: () => void;
}

export interface ProgressBarProps {
  currentTimeSeconds: number;
  durationSeconds: number;
  onSeek?: (seconds: number) => void;
  disabled?: boolean;
}

export interface SourceSelectorProps {
  feed: SourceFeed;
  onSelectSource?: (id: string) => void;
}

export interface PlayerDisplayProps {
  playbackFeed: CurrentPlaybackFeed;
  sourceId?: string;
  sharedLayoutId?: string;
  onPrevious?: () => void;
  onPlayPause?: () => void;
  onNext?: () => void;
  onSeek?: (seconds: number) => void;
}

export interface MusicAppProps {
  playbackFeed: CurrentPlaybackFeed;
  sourceFeed: SourceFeed;
  onSelectSource?: (id: string) => void;
  onPrevious?: () => void;
  onPlayPause?: () => void;
  onNext?: () => void;
  onSeek?: (seconds: number) => void;
}

export type MediaViewProps = MusicAppProps;
