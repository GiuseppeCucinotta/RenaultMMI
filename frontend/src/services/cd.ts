import type { CdPlaybackAction, CdState } from "@/types/cd";
import { checkServiceHealth } from "@/services/health";

const DEFAULT_BASE_URL = "http://127.0.0.1:4300";

export async function getCdEndpoint(): Promise<string> {
  try {
    const endpoint = await window.cd?.getEndpoint();
    if (endpoint?.baseUrl) return endpoint.baseUrl;
  } catch {
    // preload bridge unavailable — fall through to the default
  }
  return DEFAULT_BASE_URL;
}

export const checkCdHealth = checkServiceHealth;

export async function fetchCdState(baseUrl: string): Promise<CdState> {
  const response = await fetch(`${baseUrl}/api/state`);
  if (!response.ok) throw new Error(`CD state unavailable (${response.status})`);
  return (await response.json()) as CdState;
}

export async function cdPlaybackAction(
  baseUrl: string,
  action: CdPlaybackAction,
): Promise<void> {
  await fetch(`${baseUrl}/api/playback`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action }),
  });
}

export function subscribeCd(
  baseUrl: string,
  onState: (state: CdState) => void,
): () => void {
  const source = new EventSource(`${baseUrl}/api/events`);
  source.onmessage = (event) => {
    try {
      const state = JSON.parse(event.data) as CdState;
      onState(state);
    } catch {
      // ignore malformed frames
    }
  };
  return () => source.close();
}
