export type BluetoothStatus = "playing" | "paused" | "stopped" | "none";

export interface BluetoothTrack {
  title: string | null;
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

export type BluetoothPlaybackAction =
  | "play"
  | "pause"
  | "toggle"
  | "next"
  | "previous"
  | "stop";

export interface BluetoothHealth {
  ok: boolean;
  bluezAvailable: boolean;
  connected: boolean;
  playerAvailable: boolean;
}

export const IDLE_BLUETOOTH_STATE: BluetoothState = {
  connected: false,
  deviceName: null,
  deviceAddress: null,
  status: "none",
  track: null,
  positionMs: 0,
  durationMs: null,
};
