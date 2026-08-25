import type { CdState } from "@/types/cd";

/**
 * State shown when the cd-service is unreachable (plain-browser dev, service
 * crash). Mirrors the service's idle state so the UI degrades gracefully.
 */
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
