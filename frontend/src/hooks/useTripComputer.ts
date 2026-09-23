import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { TRIP_HEALTH_POLL_MS } from "@/constants/trip";
import {
  MOCK_TRIP_PERIODS,
  MOCK_TRIP_SERIES,
  MOCK_TRIP_SUMMARY,
  mockWindowFor,
} from "@/data/trip.mock";
import {
  checkTripHealth,
  fetchTripPeriods,
  fetchTripSeries,
  fetchTripSummary,
  getTripEndpoint,
  subscribeTrip,
} from "@/services/trip";
import type {
  TripPeriodDescriptor,
  TripSeries,
  TripState,
  TripSummary,
  TripWindowQuery,
} from "@/types/trip";

export interface UseTripComputerResult {
  mode: "service" | "mock" | "loading";
  isService: boolean;
  periods: TripPeriodDescriptor[];
  /** The selected preset; `null` while the first summary is loading. */
  preset: string;
  selectPreset: (preset: string) => void;
  summary: TripSummary;
  series: TripSeries;
  /** Set when the service rejected a request, for a quiet inline message. */
  error: string | null;
}

/**
 * Trip Computer data.
 *
 * Loads on mount and reloads whenever the period changes — the service resolves
 * the window, so the renderer never asks "what does 30d mean". Falls back to
 * plausible mock data when no service is reachable, which is what keeps a plain
 * browser usable (the same rule as `useCd`/`useSettings`).
 */
export function useTripComputer(initialPreset = "30d"): UseTripComputerResult {
  const [mode, setMode] = useState<"service" | "mock" | "loading">("loading");
  const [preset, setPreset] = useState(initialPreset);
  const [summary, setSummary] = useState<TripSummary>(MOCK_TRIP_SUMMARY);
  const [series, setSeries] = useState<TripSeries>(MOCK_TRIP_SERIES);
  const [periods, setPeriods] = useState<TripPeriodDescriptor[]>(MOCK_TRIP_PERIODS);
  const [error, setError] = useState<string | null>(null);
  const endpointRef = useRef<string | null>(null);
  const modeRef = useRef<"service" | "mock" | "loading">("loading");

  const setModeSafe = useCallback((next: "service" | "mock" | "loading") => {
    modeRef.current = next;
    setMode(next);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let pollTimer: number | undefined;

    const check = async (baseUrl: string) => {
      const healthy = await checkTripHealth(baseUrl);
      if (cancelled) return;
      if (healthy && modeRef.current !== "service") {
        try {
          const [loadedPeriods] = await Promise.all([fetchTripPeriods(baseUrl)]);
          if (cancelled) return;
          if (loadedPeriods.length > 0) setPeriods(loadedPeriods);
          setModeSafe("service");
        } catch {
          if (!cancelled) setModeSafe("mock");
        }
      } else if (!healthy && modeRef.current === "service") {
        setModeSafe("mock");
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
  }, [setModeSafe]);

  // Fetch the selected window. Both requests go together so the cards and the
  // graph can never describe two different periods.
  useEffect(() => {
    const baseUrl = endpointRef.current;
    if (mode !== "service" || !baseUrl) {
      // Mock mode still honours the selected preset, so the picker is not inert.
      const window = mockWindowFor(preset);
      setSummary({ ...MOCK_TRIP_SUMMARY, period: { ...MOCK_TRIP_SUMMARY.period, ...window, preset } });
      setSeries({ ...MOCK_TRIP_SERIES, from: window.from, to: window.to });
      setError(null);
      return;
    }

    let cancelled = false;
    const query: TripWindowQuery = { preset };
    void (async () => {
      try {
        const [nextSummary, nextSeries] = await Promise.all([
          fetchTripSummary(baseUrl, query),
          fetchTripSeries(baseUrl, query),
        ]);
        if (cancelled) return;
        setSummary(nextSummary);
        setSeries(nextSeries);
        setError(null);
      } catch (caught) {
        if (cancelled) return;
        setError(caught instanceof Error ? caught.message : "Trip service unavailable");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [mode, preset]);

  // A new trip appearing is the one thing worth refetching on a live stream.
  useEffect(() => {
    const baseUrl = endpointRef.current;
    if (mode !== "service" || !baseUrl) return;
    let trips = -1;
    return subscribeTrip(baseUrl, (state: TripState) => {
      if (trips === -1) {
        trips = state.tripCount;
        return;
      }
      if (state.tripCount !== trips) {
        trips = state.tripCount;
        void (async () => {
          try {
            const [nextSummary, nextSeries] = await Promise.all([
              fetchTripSummary(baseUrl, { preset }),
              fetchTripSeries(baseUrl, { preset }),
            ]);
            setSummary(nextSummary);
            setSeries(nextSeries);
          } catch {
            // The health poll will switch to mock if the service really went away.
          }
        })();
      }
    });
  }, [mode, preset]);

  const selectPreset = useCallback((next: string) => setPreset(next), []);

  return useMemo(
    () => ({
      mode,
      isService: mode === "service",
      periods,
      preset,
      selectPreset,
      summary,
      series,
      error,
    }),
    [mode, periods, preset, selectPreset, summary, series, error],
  );
}
