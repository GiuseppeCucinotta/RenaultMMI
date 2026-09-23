/**
 * HTTP client for the trip service.
 *
 * Thin `fetch` wrappers only: no aggregation, no unit conversion and no
 * formatting. Every number the UI shows is produced by the service, which is the
 * single-source-of-truth rule the two apps are built on.
 */

import { checkServiceHealth } from "@/services/health";
import { TRIP_DEFAULT_BASE_URL } from "@/constants/trip";
import type {
  TripCoordinates,
  TripDetail,
  TripIngestStatus,
  TripListBody,
  TripPeriodDescriptor,
  TripSeries,
  TripState,
  TripSummary,
  TripWindowQuery,
} from "@/types/trip";

export async function getTripEndpoint(): Promise<string> {
  try {
    const endpoint = await window.trip?.getEndpoint();
    if (endpoint?.baseUrl) return endpoint.baseUrl;
  } catch {
    // preload bridge unavailable — fall through to the default
  }
  return TRIP_DEFAULT_BASE_URL;
}

export const checkTripHealth = checkServiceHealth;

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Trip request failed (${response.status})`);
  return (await response.json()) as T;
}

function windowParams(query: TripWindowQuery): string {
  const params = new URLSearchParams();
  if (query.from !== undefined && query.to !== undefined) {
    params.set("from", String(query.from));
    params.set("to", String(query.to));
  } else if (query.preset) {
    params.set("preset", query.preset);
  }
  const serialised = params.toString();
  return serialised ? `?${serialised}` : "";
}

export async function fetchTripState(baseUrl: string): Promise<TripState> {
  return getJson<TripState>(`${baseUrl}/api/state`);
}

export async function fetchTripStatus(baseUrl: string): Promise<TripIngestStatus> {
  return getJson<TripIngestStatus>(`${baseUrl}/api/status`);
}

export async function fetchTripPeriods(baseUrl: string): Promise<TripPeriodDescriptor[]> {
  const body = await getJson<{ periods: TripPeriodDescriptor[] }>(`${baseUrl}/api/periods`);
  return Array.isArray(body.periods) ? body.periods : [];
}

export async function fetchTripSummary(
  baseUrl: string,
  query: TripWindowQuery,
): Promise<TripSummary> {
  return getJson<TripSummary>(`${baseUrl}/api/summary${windowParams(query)}`);
}

export async function fetchTripSeries(
  baseUrl: string,
  query: TripWindowQuery,
): Promise<TripSeries> {
  return getJson<TripSeries>(`${baseUrl}/api/series${windowParams(query)}`);
}

export async function fetchTrips(
  baseUrl: string,
  options: { limit?: number; offset?: number } = {},
): Promise<TripListBody> {
  const params = new URLSearchParams();
  if (options.limit !== undefined) params.set("limit", String(options.limit));
  if (options.offset !== undefined) params.set("offset", String(options.offset));
  const serialised = params.toString();
  return getJson<TripListBody>(`${baseUrl}/api/trips${serialised ? `?${serialised}` : ""}`);
}

export async function fetchTripDetail(baseUrl: string, tripId: number): Promise<TripDetail> {
  return getJson<TripDetail>(`${baseUrl}/api/trips/${tripId}`);
}

export async function fetchTripCoordinates(
  baseUrl: string,
  tripId: number,
): Promise<TripCoordinates> {
  return getJson<TripCoordinates>(`${baseUrl}/api/trips/${tripId}/coordinates`);
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    // Surface the service's own message: it explains *why* a merge or split was
    // refused (not adjacent, first stage, …), which the UI shows verbatim.
    let message = `Trip request failed (${response.status})`;
    try {
      const parsed = (await response.json()) as { error?: string };
      if (parsed?.error) message = parsed.error;
    } catch {
      // nothing to add
    }
    throw new Error(message);
  }
  return (await response.json()) as T;
}

export async function mergeTrips(
  baseUrl: string,
  tripIds: [number, number],
): Promise<TripDetail> {
  return postJson<TripDetail>(`${baseUrl}/api/trips/merge`, { tripIds });
}

export async function splitTrip(
  baseUrl: string,
  tripId: number,
  stageId: number,
): Promise<{ trip: TripDetail; trips: TripListBody }> {
  return postJson<{ trip: TripDetail; trips: TripListBody }>(
    `${baseUrl}/api/trips/${tripId}/split`,
    { stageId },
  );
}

/** SSE subscription to the service's small state frame. */
export function subscribeTrip(
  baseUrl: string,
  onState: (state: TripState) => void,
): () => void {
  const source = new EventSource(`${baseUrl}/api/events`);
  source.onmessage = (event) => {
    try {
      onState(JSON.parse(event.data) as TripState);
    } catch {
      // ignore malformed frames
    }
  };
  return () => source.close();
}
