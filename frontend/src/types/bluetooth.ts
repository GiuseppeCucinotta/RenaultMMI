export type BluetoothStatus = "none" | "stopped" | "playing" | "paused";

export interface BluetoothTrack {
  title: string;
  artist: string | null;
  album: string | null;
  durationMs: number | null;
  /** Absolute or service-relative URL of the cover art, if downloaded */
  artworkUrl?: string | null;
  /** Cover art availability for the current track */
  artworkState?: "none" | "loading" | "ready";
}

export interface BluetoothState {
  connected: boolean;
  deviceName: string | null;
  deviceAddress: string | null;
  status: BluetoothStatus;
  track: BluetoothTrack | null;
  positionMs: number;
  durationMs: number | null;
}

export interface BluetoothHealth {
  ok: boolean;
  bluezAvailable: boolean;
  connected: boolean;
  playerAvailable: boolean;
}

export type BluetoothPlaybackAction =
  | "play"
  | "pause"
  | "toggle"
  | "next"
  | "previous"
  | "stop";

export type BluetoothMode = "loading" | "service" | "mock";
