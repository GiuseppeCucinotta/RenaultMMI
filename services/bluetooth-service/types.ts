/**
 * The state served to the renderer, and the small vocabulary shared by the
 * internal managers (adapter, discovery, pairing, media, calls).
 *
 * It is device-centric: `devices` is the phone list, and `media` always
 * describes the *active* phone's AVRCP player. A phone is the unit of truth —
 * anything that is not about a phone (mpv processes, AVRCP interpolation
 * timers) stays an implementation detail behind {@link PhoneManager}.
 */

/* --------------------------------- adapter -------------------------------- */

export interface BluetoothAdapter {
  /** BlueZ path, `null` when no controller exists at all. */
  path: string | null;
  /** Human readable controller name (`hci0` alias). */
  name: string | null;
  address: string | null;
  /** Radio power. Everything else is meaningless while this is false. */
  powered: boolean;
  /** True while the controller announces itself to nearby phones. */
  discoverable: boolean;
  /** True while the controller is pairable. */
  pairable: boolean;
  /** True while an inquiry (scan) is running. */
  discovering: boolean;
}

/* --------------------------------- devices -------------------------------- */

export interface BluetoothCapabilities {
  /** Advanced Audio Distribution Profile — phone can stream audio. */
  audio: boolean;
  /** Audio/Video Remote Control Profile — we can drive its player. */
  remoteControl: boolean;
  /** Hands-Free Profile — the phone can take calls through the car (future). */
  handsFree: boolean;
  /** Phone exposes battery level over Battery1 or HFP (battery indicator). */
  battery: boolean;
}

export type BluetoothDeviceKind = "phone" | "audio" | "computer" | "other";

export interface BluetoothDevice {
  /** Stable id used by every API call: the BlueZ object path. */
  id: string;
  address: string;
  /** Best available label: BlueZ `Alias`, falling back to `Name`. */
  name: string;
  kind: BluetoothDeviceKind;
  paired: boolean;
  connected: boolean;
  trusted: boolean;
  /** True when this is the phone backing `state.media`. */
  primary: boolean;
  /** Signal strength in dBm, `null` when unknown or not paired. */
  rssi: number | null;
  /** Battery percentage 0–100 when the phone reports one. */
  batteryPercent: number | null;
  capabilities: BluetoothCapabilities;
}

/* --------------------------------- pairing -------------------------------- */

/**
 * How the user on the phone has to confirm the pairing. Drives which prompt
 * the UI shows.
 */
export type BluetoothPairingMethod =
  | "just-works"
  | "passkey-display"
  | "passkey-entry"
  | "confirm";

export type BluetoothPairingStage = "idle" | "pairing" | "awaiting-confirmation" | "failed";

export interface BluetoothPairing {
  stage: BluetoothPairingStage;
  /** Device being paired, `null` when stage is `idle`. */
  deviceId: string | null;
  deviceName: string | null;
  method: BluetoothPairingMethod | null;
  /** 6-digit code to show on the car screen (`passkey-display` / `confirm`). */
  passkey: string | null;
  /** Short translated-ready machine reason when stage is `failed`. */
  error: string | null;
}

/* ---------------------------------- media --------------------------------- */

export type BluetoothStatus = "playing" | "paused" | "stopped" | "none";

export type ArtworkState = "none" | "loading" | "ready";

export interface BluetoothTrack {
  title: string | null;
  artist: string | null;
  album: string | null;
  durationMs: number | null;
  /** Relative URL of the downloaded cover art, set only when ready */
  artworkUrl: string | null;
  /** Cover art availability for the current track */
  artworkState: ArtworkState;
}

/** The active phone's media player. Never refers to a disconnected phone. */
export interface BluetoothMedia {
  /** BlueZ path of the phone that owns this player, `null` when idle. */
  deviceId: string | null;
  status: BluetoothStatus;
  track: BluetoothTrack | null;
  positionMs: number;
  durationMs: number | null;
}

/* ---------------------------------- calls --------------------------------- */

export type BluetoothCallState = "idle" | "incoming" | "dialing" | "active" | "held";

export interface BluetoothCall {
  id: string;
  /** Number as reported by the modem, may be absent. */
  number: string | null;
  /** Contact name when the phone/module resolves one. */
  contactName: string | null;
  state: BluetoothCallState;
  /** True for the audio-active call when several are up. */
  active: boolean;
}

/**
 * Reserved slice for hands-free telephony. `supported` stays false until an
 * HFP backend (oFono or equivalent) is wired in; the shape exists now so the
 * renderer, routes and state never need a breaking change to add calling.
 */
export interface BluetoothCalls {
  supported: boolean;
  /** Call currently owning the audio path, `null` when none. */
  activeCallId: string | null;
  calls: BluetoothCall[];
  /** Last dialed/received number, capped short history for the UI. */
  recentNumbers: string[];
}

/* --------------------------------- state ---------------------------------- */

export interface BluetoothState {
  /** BlueZ reachable on the system bus. */
  available: boolean;
  adapter: BluetoothAdapter;
  discovering: boolean;
  /** Paired devices first, then nearby candidates, stable within a run. */
  devices: BluetoothDevice[];
  pairing: BluetoothPairing;
  media: BluetoothMedia;
  calls: BluetoothCalls;
}

/* ------------------------------- api payloads ----------------------------- */

export type BluetoothPlaybackAction =
  | "play"
  | "pause"
  | "toggle"
  | "next"
  | "previous"
  | "stop";

/** `POST /api/phone` actions. */
export type BluetoothPhoneAction = "start-scan" | "stop-scan" | "refresh";

/** `POST /api/pairing` actions. `submit` carries a typed passkey/PIN. */
export type BluetoothPairingAction = "pair" | "confirm" | "reject" | "cancel" | "submit";

/** Why a paring attempt failed, mapped to a message by the renderer. */
export type BluetoothPairingError =
  | "failed"
  | "rejected"
  | "timeout"
  | "unknown-device"
  | "unavailable";

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

export const NO_ADAPTER: BluetoothAdapter = {
  path: null,
  name: null,
  address: null,
  powered: false,
  discoverable: false,
  pairable: false,
  discovering: false,
};

export const EMPTY_CAPABILITIES: BluetoothCapabilities = {
  audio: false,
  remoteControl: false,
  handsFree: false,
  battery: false,
};

export const IDLE_PAIRING: BluetoothPairing = {
  stage: "idle",
  deviceId: null,
  deviceName: null,
  method: null,
  passkey: null,
  error: null,
};

export const IDLE_MEDIA: BluetoothMedia = {
  deviceId: null,
  status: "none",
  track: null,
  positionMs: 0,
  durationMs: null,
};

export const IDLE_CALLS: BluetoothCalls = {
  supported: false,
  activeCallId: null,
  calls: [],
  recentNumbers: [],
};

export const IDLE_BLUETOOTH_STATE: BluetoothState = {
  available: false,
  adapter: NO_ADAPTER,
  discovering: false,
  devices: [],
  pairing: IDLE_PAIRING,
  media: IDLE_MEDIA,
  calls: IDLE_CALLS,
};
