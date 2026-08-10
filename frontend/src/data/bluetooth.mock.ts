import type { BluetoothState } from "@/types/bluetooth";

export const IDLE_BLUETOOTH_STATE: BluetoothState = {
  connected: false,
  deviceName: null,
  deviceAddress: null,
  status: "none",
  track: null,
  positionMs: 0,
  durationMs: null,
};
