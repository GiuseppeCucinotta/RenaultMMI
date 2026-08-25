export type CdDiscType = "audio" | "data";

export interface CdTrack {
  /** 1-based track number as printed on the disc */
  index: number;
  title: string;
  durationSeconds: number | null;
}

export type CdStatus = "playing" | "paused" | "stopped" | "none";

export interface CdState {
  driveConnected: boolean;
  device: string | null;
  hasDisc: boolean;
  discType: CdDiscType | null;
  discId: string | null;
  discTitle: string | null;
  tracks: CdTrack[];
  currentTrackIndex: number | null;
  currentTimeSeconds: number;
  durationSeconds: number | null;
  isPlaying: boolean;
}

export interface CdHealth {
  ok: boolean;
  driveConnected: boolean;
  hasDisc: boolean;
  mpvAvailable: boolean;
}

export type CdPlaybackAction =
  | "play"
  | "pause"
  | "toggle"
  | "next"
  | "previous"
  | "stop";

export type CdMode = "loading" | "service" | "mock";
