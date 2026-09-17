import type {
  BluetoothMedia,
  BluetoothPairing,
  BluetoothPairingAction,
  BluetoothPhoneAction,
  BluetoothPlaybackAction,
  BluetoothScanAction,
  BluetoothState,
} from "@/types/bluetooth";
import { checkServiceHealth } from "@/services/health";

const DEFAULT_BASE_URL = "http://127.0.0.1:4200";

/**
 * Where to look when the preload bridge is absent (plain browser dev). Set to
 * a fake or remote service to preview a view without the real one running.
 */
function defaultBaseUrl(): string {
  return import.meta.env.VITE_BLUETOOTH_BASE_URL || DEFAULT_BASE_URL;
}

export async function getBluetoothEndpoint(): Promise<string> {
  try {
    const endpoint = await window.bluetooth?.getEndpoint();
    if (endpoint?.baseUrl) return endpoint.baseUrl;
  } catch {
    // preload bridge unavailable — fall through to the default
  }
  return defaultBaseUrl();
}

export const checkBluetoothHealth = checkServiceHealth;

export async function fetchBluetoothState(baseUrl: string): Promise<BluetoothState> {
  const response = await fetch(`${baseUrl}/api/state`);
  if (!response.ok) throw new Error(`Bluetooth state unavailable (${response.status})`);
  return (await response.json()) as BluetoothState;
}

async function postJson<T>(baseUrl: string, route: string, body: unknown): Promise<T> {
  const response = await fetch(`${baseUrl}${route}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    // The service answers errors as `{ error }`; surface it so the UI can
    // show a reason instead of a generic failure.
    const detail = await response
      .json()
      .then((parsed: { error?: string }) => parsed.error)
      .catch(() => null);
    throw new Error(detail ?? `Bluetooth request failed (${response.status})`);
  }
  return (await response.json()) as T;
}

export async function bluetoothPlaybackAction(
  baseUrl: string,
  action: BluetoothPlaybackAction,
): Promise<BluetoothMedia> {
  return postJson<BluetoothMedia>(baseUrl, "/api/playback", { action });
}

export async function bluetoothScanAction(
  baseUrl: string,
  action: BluetoothScanAction,
): Promise<BluetoothState> {
  return postJson<BluetoothState>(baseUrl, "/api/scan", { action });
}

export async function bluetoothPhoneAction(
  baseUrl: string,
  action: BluetoothPhoneAction,
  deviceId: string,
): Promise<BluetoothState> {
  return postJson<BluetoothState>(baseUrl, "/api/phone", { action, deviceId });
}

export async function bluetoothPairingAction(
  baseUrl: string,
  action: BluetoothPairingAction,
  payload: { deviceId?: string; value?: string } = {},
): Promise<BluetoothPairing> {
  return postJson<BluetoothPairing>(baseUrl, "/api/pairing", { action, ...payload });
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
