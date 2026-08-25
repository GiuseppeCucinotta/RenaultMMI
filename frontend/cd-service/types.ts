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

export type CdPlaybackAction =
  | "play"
  | "pause"
  | "toggle"
  | "next"
  | "previous"
  | "stop";

export const IDLE_CD_STATE: CdState = {
  driveConnected: false,
  device: null,
  hasDisc: false,
  discType: null,
  discId: null,
  discTitle: null,
  tracks: [],
  currentTrackIndex: null,
  currentTimeSeconds: 0,
  durationSeconds: null,
  isPlaying: false,
};
