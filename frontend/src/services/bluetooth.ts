import type {
  BluetoothPlaybackAction,
  BluetoothState,
} from "@/types/bluetooth";
import { checkServiceHealth } from "@/services/health";

const DEFAULT_BASE_URL = "http://127.0.0.1:4200";

export async function getBluetoothEndpoint(): Promise<string> {
  try {
    const endpoint = await window.bluetooth?.getEndpoint();
    if (endpoint?.baseUrl) return endpoint.baseUrl;
  } catch {
    // preload bridge unavailable — fall through to the default
  }
  return DEFAULT_BASE_URL;
}

export const checkBluetoothHealth = checkServiceHealth;

export async function fetchBluetoothState(baseUrl: string): Promise<BluetoothState> {
  const response = await fetch(`${baseUrl}/api/state`);
  if (!response.ok) throw new Error(`Bluetooth state unavailable (${response.status})`);
  return (await response.json()) as BluetoothState;
}

export async function bluetoothPlaybackAction(
  baseUrl: string,
  action: BluetoothPlaybackAction,
): Promise<void> {
  await fetch(`${baseUrl}/api/playback`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action }),
  });
}

export function subscribeBluetooth(
  baseUrl: string,
  onState: (state: BluetoothState) => void,
): () => void {
  const source = new EventSource(`${baseUrl}/api/events`);
  source.onmessage = (event) => {
    try {
      const state = JSON.parse(event.data) as BluetoothState;
      onState(state);
    } catch {
      // ignore malformed frames
    }
  };
  return () => source.close();
}
