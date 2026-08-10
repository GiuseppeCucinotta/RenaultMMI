export type BluetoothStatus = "none" | "stopped" | "playing" | "paused";

export interface BluetoothTrack {
  title: string;
  artist: string | null;
  album: string | null;
  durationMs: number | null;
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
