import type {
  JukeboxLibrary,
  JukeboxPlaybackAction,
  JukeboxPlaybackState,
} from "@/types/jukebox";

const DEFAULT_BASE_URL = "http://127.0.0.1:4100";
const HEALTH_TIMEOUT_MS = 1200;

export async function getJukeboxEndpoint(): Promise<string> {
  try {
    const endpoint = await window.jukebox?.getEndpoint();
    if (endpoint?.baseUrl) return endpoint.baseUrl;
  } catch {
    // preload bridge unavailable — fall through to the default
  }
  return DEFAULT_BASE_URL;
}

export function jukeboxArtworkUrl(baseUrl: string, albumId: string): string {
  return `${baseUrl}/api/artwork/${albumId}`;
}

export async function checkJukeboxHealth(
  baseUrl: string,
  timeoutMs = HEALTH_TIMEOUT_MS,
): Promise<boolean> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl}/api/health`, { signal: controller.signal });
    return response.ok;
  } catch {
    return false;
  } finally {
    window.clearTimeout(timer);
  }
}

export async function fetchJukeboxLibrary(baseUrl: string): Promise<JukeboxLibrary> {
  const response = await fetch(`${baseUrl}/api/library`);
  if (!response.ok) throw new Error(`Library unavailable (${response.status})`);
  return (await response.json()) as JukeboxLibrary;
}

export async function requestJukeboxScan(baseUrl: string): Promise<JukeboxLibrary> {
  const response = await fetch(`${baseUrl}/api/scan`, { method: "POST" });
  if (!response.ok) throw new Error(`Scan failed (${response.status})`);
  return (await response.json()) as JukeboxLibrary;
}

export async function jukeboxPlay(
  baseUrl: string,
  albumId: string,
): Promise<JukeboxPlaybackState> {
  const response = await fetch(`${baseUrl}/api/play`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ albumId }),
  });
  if (!response.ok) throw new Error(`Play failed (${response.status})`);
  return (await response.json()) as JukeboxPlaybackState;
}

export async function jukeboxPlaybackAction(
  baseUrl: string,
  action: JukeboxPlaybackAction,
): Promise<JukeboxPlaybackState> {
  const response = await fetch(`${baseUrl}/api/playback`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action }),
  });
  if (!response.ok) throw new Error(`Playback action failed (${response.status})`);
  return (await response.json()) as JukeboxPlaybackState;
}

export async function jukeboxSeek(
  baseUrl: string,
  seconds: number,
): Promise<JukeboxPlaybackState> {
  const response = await fetch(`${baseUrl}/api/seek`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ seconds }),
  });
  if (!response.ok) throw new Error(`Seek failed (${response.status})`);
  return (await response.json()) as JukeboxPlaybackState;
}

export async function jukeboxPlayTrack(
  baseUrl: string,
  trackIndex: number,
): Promise<JukeboxPlaybackState> {
  const response = await fetch(`${baseUrl}/api/track`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ trackIndex }),
  });
  if (!response.ok) throw new Error(`Track jump failed (${response.status})`);
  return (await response.json()) as JukeboxPlaybackState;
}

export function subscribeJukebox(
  baseUrl: string,
  onState: (state: JukeboxPlaybackState) => void,
): () => void {
  const source = new EventSource(`${baseUrl}/api/events`);
  source.onmessage = (event) => {
    try {
      const state = JSON.parse(event.data) as JukeboxPlaybackState;
      onState(state);
    } catch {
      // ignore malformed frames
    }
  };
  return () => source.close();
}
