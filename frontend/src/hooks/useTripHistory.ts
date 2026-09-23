import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { TRIP_HEALTH_POLL_MS, TRIP_HISTORY_PAGE_SIZE } from "@/constants/trip";
import {
  MOCK_TRIP_COORDINATES,
  MOCK_TRIP_DETAILS,
  MOCK_TRIPS,
} from "@/data/trip.mock";
import {
  checkTripHealth,
  fetchTripCoordinates,
  fetchTripDetail,
  fetchTrips,
  getTripEndpoint,
  mergeTrips,
  splitTrip,
  subscribeTrip,
} from "@/services/trip";
import type {
  TripCoordinates,
  TripDetail,
  TripListItem,
  TripState,
} from "@/types/trip";

export interface UseTripHistoryResult {
  mode: "service" | "mock" | "loading";
  isService: boolean;
  trips: TripListItem[];
  total: number;
  /** Selected trip id, or `null` when the map shows its "select a trip" state. */
  selectedTripId: number | null;
  selectTrip: (tripId: number | null) => void;
  detail: TripDetail | null;
  coordinates: TripCoordinates | null;
  /** True while the selected trip's detail/route is in flight. */
  loadingDetail: boolean;
  error: string | null;
  /** Adjacent merge; refuses anything the service refuses, with its message. */
  merge: (firstId: number, secondId: number) => Promise<void>;
  split: (tripId: number, stageId: number) => Promise<void>;
  refresh: () => Promise<void>;
}

/**
 * Trip History data.
 *
 * The list loads once and is paged from the service; detail and route geometry
 * are fetched **only for the selected trip**, because a trajectory is the one
 * genuinely large payload in this service and fetching it for the whole list
 * would be wasteful.
 */
export function useTripHistory(): UseTripHistoryResult {
  const [mode, setMode] = useState<"service" | "mock" | "loading">("loading");
  const [trips, setTrips] = useState<TripListItem[]>(MOCK_TRIPS);
  const [total, setTotal] = useState(MOCK_TRIPS.length);
  const [selectedTripId, setSelectedTripId] = useState<number | null>(null);
  const [detail, setDetail] = useState<TripDetail | null>(null);
  const [coordinates, setCoordinates] = useState<TripCoordinates | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endpointRef = useRef<string | null>(null);
  const modeRef = useRef<"service" | "mock" | "loading">("loading");

  const setModeSafe = useCallback((next: "service" | "mock" | "loading") => {
    modeRef.current = next;
    setMode(next);
  }, []);

  /** Reloads the list from the service (or the mock) and clears the error. */
  const loadList = useCallback(async (): Promise<void> => {
    const baseUrl = endpointRef.current;
    if (modeRef.current !== "service" || !baseUrl) {
      setTrips(MOCK_TRIPS);
      setTotal(MOCK_TRIPS.length);
      setError(null);
      return;
    }
    try {
      const body = await fetchTrips(baseUrl, { limit: TRIP_HISTORY_PAGE_SIZE, offset: 0 });
      setTrips(body.trips);
      setTotal(body.total);
      setError(null);
      // A selection that no longer exists must not leave a stale map on screen.
      setSelectedTripId((current) =>
        current !== null && body.trips.some((trip) => trip.id === current) ? current : null,
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Trip service unavailable");
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let pollTimer: number | undefined;

    const check = async (baseUrl: string) => {
      const healthy = await checkTripHealth(baseUrl);
      if (cancelled) return;
      if (healthy && modeRef.current !== "service") {
        setModeSafe("service");
        await loadList();
      } else if (!healthy && modeRef.current === "service") {
        setModeSafe("mock");
        setTrips(MOCK_TRIPS);
        setSelectedTripId(null);
      }
    };

    (async () => {
      let baseUrl: string;
      try {
        baseUrl = await getTripEndpoint();
      } catch {
        if (!cancelled) setModeSafe("mock");
        return;
      }
      endpointRef.current = baseUrl;
      await check(baseUrl);
      if (cancelled) return;
      pollTimer = window.setInterval(() => void check(baseUrl), TRIP_HEALTH_POLL_MS);
    })();

    return () => {
      cancelled = true;
      if (pollTimer) window.clearInterval(pollTimer);
    };
  }, [loadList, setModeSafe]);

  // Detail and geometry for the selected trip only.
  useEffect(() => {
    if (selectedTripId === null) {
      setDetail(null);
      setCoordinates(null);
      return;
    }

    const baseUrl = endpointRef.current;
    if (mode !== "service" || !baseUrl) {
      setDetail(MOCK_TRIP_DETAILS[selectedTripId] ?? null);
      setCoordinates(MOCK_TRIP_COORDINATES[selectedTripId] ?? null);
      return;
    }

    let cancelled = false;
    setLoadingDetail(true);
    void (async () => {
      try {
        const [nextDetail, nextCoordinates] = await Promise.all([
          fetchTripDetail(baseUrl, selectedTripId),
          fetchTripCoordinates(baseUrl, selectedTripId),
        ]);
        if (cancelled) return;
        setDetail(nextDetail);
        setCoordinates(nextCoordinates);
      } catch (caught) {
        if (cancelled) return;
        setError(caught instanceof Error ? caught.message : "Trip unavailable");
        setDetail(null);
        setCoordinates(null);
      } finally {
        if (!cancelled) setLoadingDetail(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [mode, selectedTripId]);

  // A finished drive should appear without the user reopening the app.
  useEffect(() => {
    const baseUrl = endpointRef.current;
    if (mode !== "service" || !baseUrl) return;
    let known = -1;
    return subscribeTrip(baseUrl, (state: TripState) => {
      if (known === -1) {
        known = state.tripCount;
        return;
      }
      if (state.tripCount !== known) {
        known = state.tripCount;
        void loadList();
      }
    });
  }, [mode, loadList]);

  const selectTrip = useCallback((tripId: number | null) => setSelectedTripId(tripId), []);

  const merge = useCallback(
    async (firstId: number, secondId: number) => {
      const baseUrl = endpointRef.current;
      if (mode !== "service" || !baseUrl) return;
      try {
        const merged = await mergeTrips(baseUrl, [firstId, secondId]);
        await loadList();
        setSelectedTripId(merged.id);
        setError(null);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Merge failed");
      }
    },
    [loadList, mode],
  );

  const split = useCallback(
    async (tripId: number, stageId: number) => {
      const baseUrl = endpointRef.current;
      if (mode !== "service" || !baseUrl) return;
      try {
        await splitTrip(baseUrl, tripId, stageId);
        await loadList();
        setSelectedTripId(tripId);
        setError(null);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Split failed");
      }
    },
    [loadList, mode],
  );

  const refresh = useCallback(async () => {
    await loadList();
  }, [loadList]);

  return useMemo(
    () => ({
      mode,
      isService: mode === "service",
      trips,
      total,
      selectedTripId,
      selectTrip,
      detail,
      coordinates,
      loadingDetail,
      error,
      merge,
      split,
      refresh,
    }),
    [
      mode,
      trips,
      total,
      selectedTripId,
      selectTrip,
      detail,
      coordinates,
      loadingDetail,
      error,
      merge,
      split,
      refresh,
    ],
  );
}
