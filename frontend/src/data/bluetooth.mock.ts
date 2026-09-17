import type { BluetoothState } from "@/types/bluetooth";

/**
 * Browser-development fallback, used when no bluetooth service is reachable
 * (`mode: "mock"`). It mirrors the shape of the real state and the hook's
 * actions mutate it locally, so the Phone view stays interactive without BlueZ.
 */

export const IDLE_BLUETOOTH_STATE: BluetoothState = {
  available: false,
  adapter: {
    path: null,
    name: null,
    address: null,
    powered: false,
    discoverable: false,
    pairable: false,
    discovering: false,
  },
  discovering: false,
  devices: [],
  pairing: {
    stage: "idle",
    deviceId: null,
    deviceName: null,
    method: null,
    passkey: null,
    error: null,
  },
  media: {
    deviceId: null,
    status: "none",
    track: null,
    positionMs: 0,
    durationMs: null,
  },
  calls: {
    supported: false,
    activeCallId: null,
    calls: [],
    recentNumbers: [],
  },
};

const MOCK_PHONE_ID = "/org/bluez/hci0/dev_60_06_E3_15_F2_B7";
const MOCK_SECOND_ID = "/org/bluez/hci0/dev_40_A2_DB_B9_7F_F7";

const MOCK_DEVICES = [
  {
    id: MOCK_PHONE_ID,
    address: "60:06:E3:15:F2:B7",
    name: "Giuseppe's iPhone 15 Pro",
    kind: "phone" as const,
    paired: true,
    connected: true,
    trusted: true,
    primary: true,
    rssi: -48,
    batteryPercent: 72,
    capabilities: { audio: true, remoteControl: true, handsFree: true, battery: true },
  },
  {
    id: MOCK_SECOND_ID,
    address: "40:A2:DB:B9:7F:F7",
    name: "Pixel 9 Pro XL",
    kind: "phone" as const,
    paired: false,
    connected: false,
    trusted: false,
    primary: false,
    rssi: -63,
    batteryPercent: null,
    capabilities: { audio: true, remoteControl: true, handsFree: true, battery: false },
  },
];

/** A connected-phone state, so the Phone view can be developed in a browser. */
export const MOCK_BLUETOOTH_STATE: BluetoothState = {
  ...IDLE_BLUETOOTH_STATE,
  available: true,
  adapter: {
    path: "/org/bluez/hci0",
    name: "renault-mmi",
    address: "00:1A:7D:DA:71:15",
    powered: true,
    discoverable: false,
    pairable: true,
    discovering: false,
  },
  devices: MOCK_DEVICES,
  media: {
    deviceId: MOCK_PHONE_ID,
    status: "playing",
    track: {
      title: "Big Poppa",
      artist: "The Notorious B.I.G.",
      album: "Ready to Die",
      durationMs: 254000,
      artworkUrl: null,
      artworkState: "none",
    },
    positionMs: 62000,
    durationMs: 254000,
  },
};

export const MOCK_PHONE_IDS = { primary: MOCK_PHONE_ID, second: MOCK_SECOND_ID };

/**
 * Demo data is opt-in (`VITE_BLUETOOTH_DEMO=1`): a phantom connected phone in a
 * plain browser would be a lie about the car's state, but it is what makes the
 * Phone view developable without a service running.
 */
export function bluetoothDemoEnabled(): boolean {
  return import.meta.env.VITE_BLUETOOTH_DEMO === "1";
}
