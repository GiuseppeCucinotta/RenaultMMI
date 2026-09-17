/**
 * Mirror of the bluetooth service state (`bluetooth-service/types.ts`).
 *
 * The state is device-centric: `devices` is the phone list and `media` always
 * belongs to the active phone, which is the one flagged `primary`.
 */

export type BluetoothStatus = "none" | "stopped" | "playing" | "paused";

export interface BluetoothAdapter {
  path: string | null;
  name: string | null;
  address: string | null;
  powered: boolean;
  discoverable: boolean;
  pairable: boolean;
  discovering: boolean;
}

export interface BluetoothCapabilities {
  audio: boolean;
  remoteControl: boolean;
  handsFree: boolean;
  battery: boolean;
}

export type BluetoothDeviceKind = "phone" | "audio" | "computer" | "other";

export interface BluetoothDevice {
  /** BlueZ object path; the id every API call uses. */
  id: string;
  address: string;
  name: string;
  kind: BluetoothDeviceKind;
  paired: boolean;
  connected: boolean;
  trusted: boolean;
  /** True for the phone backing `state.media`. */
  primary: boolean;
  rssi: number | null;
  batteryPercent: number | null;
  capabilities: BluetoothCapabilities;
}

export type BluetoothPairingMethod =
  | "just-works"
  | "passkey-display"
  | "passkey-entry"
  | "confirm";

export type BluetoothPairingStage = "idle" | "pairing" | "awaiting-confirmation" | "failed";

export type BluetoothPairingError =
  | "failed"
  | "rejected"
  | "timeout"
  | "unknown-device"
  | "unavailable";

export interface BluetoothPairing {
  stage: BluetoothPairingStage;
  deviceId: string | null;
  deviceName: string | null;
  method: BluetoothPairingMethod | null;
  /** Code to compare/type, when the method involves one. */
  passkey: string | null;
  error: BluetoothPairingError | null;
}

export interface BluetoothTrack {
  title: string | null;
  artist: string | null;
  album: string | null;
  durationMs: number | null;
  /** Relative URL of the cover art, resolved against the service base URL. */
  artworkUrl: string | null;
  artworkState: "none" | "loading" | "ready";
}

export interface BluetoothMedia {
  deviceId: string | null;
  status: BluetoothStatus;
  track: BluetoothTrack | null;
  positionMs: number;
  durationMs: number | null;
}

export type BluetoothCallState = "idle" | "incoming" | "dialing" | "active" | "held";

export interface BluetoothCall {
  id: string;
  number: string | null;
  contactName: string | null;
  state: BluetoothCallState;
  active: boolean;
}

/** Reserved for hands-free telephony; `supported` is false until HFP lands. */
export interface BluetoothCalls {
  supported: boolean;
  activeCallId: string | null;
  calls: BluetoothCall[];
  recentNumbers: string[];
}

export interface BluetoothState {
  available: boolean;
  adapter: BluetoothAdapter;
  discovering: boolean;
  devices: BluetoothDevice[];
  pairing: BluetoothPairing;
  media: BluetoothMedia;
  calls: BluetoothCalls;
}

export interface BluetoothHealth {
  ok: boolean;
  bluezAvailable: boolean;
  connected: boolean;
  playerAvailable: boolean;
  adapterPowered: boolean;
  discovering: boolean;
  pairable: boolean;
  pairedDevices: number;
  visibleDevices: number;
  pairingStage: BluetoothPairingStage;
  callsSupported: boolean;
}

export type BluetoothPlaybackAction =
  | "play"
  | "pause"
  | "toggle"
  | "next"
  | "previous"
  | "stop";

/** `POST /api/scan`. */
export type BluetoothScanAction = "start" | "stop" | "refresh";

/** `POST /api/phone`. */
export type BluetoothPhoneAction = "connect" | "disconnect" | "forget" | "trust" | "untrust";

/** `POST /api/pairing`. `submit` carries a typed code in `value`. */
export type BluetoothPairingAction = "pair" | "confirm" | "reject" | "cancel" | "submit";

export type BluetoothMode = "loading" | "service" | "mock";
