import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { IDLE_CD_STATE } from "@/data/cd.mock";
import {
  cdPlaybackAction,
  checkCdHealth,
  fetchCdState,
  getCdEndpoint,
  subscribeCd,
} from "@/services/cd";
import type { CdMode, CdPlaybackAction, CdState } from "@/types/cd";
import type { CurrentPlaybackFeed } from "@/types/media";
import { useI18n } from "@/i18n";

export interface UseCdResult {
  mode: CdMode;
  state: CdState;
  isService: boolean;
  playbackFeed: CurrentPlaybackFeed;
  toggle: () => Promise<void>;
  next: () => Promise<void>;
  previous: () => Promise<void>;
  stop: () => Promise<void>;
}

export function useCd(): UseCdResult {
  const { t } = useI18n();
  const [mode, setMode] = useState<CdMode>("loading");
  const [state, setState] = useState<CdState>(IDLE_CD_STATE);
  const endpointRef = useRef<string | null>(null);
  const modeRef = useRef<CdMode>("loading");

  const setModeSafe = useCallback((next: CdMode) => {
    modeRef.current = next;
    setMode(next);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let pollTimer: number | undefined;

    const check = async (baseUrl: string) => {
      const healthy = await checkCdHealth(baseUrl);
      if (cancelled) return;
      const current = modeRef.current;

      if (healthy && current !== "service") {
        try {
          const loaded = await fetchCdState(baseUrl);
          if (cancelled) return;
          setState(loaded);
          setModeSafe("service");
        } catch {
          if (cancelled) return;
          setModeSafe("mock");
        }
      } else if (!healthy && current === "service") {
        setState(IDLE_CD_STATE);
        setModeSafe("mock");
      }
    };

    (async () => {
      let baseUrl: string;
      try {
        baseUrl = await getCdEndpoint();
      } catch {
        if (!cancelled) setModeSafe("mock");
        return;
      }
      endpointRef.current = baseUrl;
      await check(baseUrl);
      if (cancelled) return;
      pollTimer = window.setInterval(() => void check(baseUrl), 5000);
    })();

    return () => {
      cancelled = true;
      if (pollTimer) window.clearInterval(pollTimer);
    };
  }, [setModeSafe]);

  useEffect(() => {
    if (mode !== "service" || !endpointRef.current) return;
    return subscribeCd(endpointRef.current, setState);
  }, [mode]);

  const isService = mode === "service";

  const sendAction = useCallback(
    async (action: CdPlaybackAction) => {
      const baseUrl = endpointRef.current;
      if (!isService || !baseUrl) return;
      try {
        await cdPlaybackAction(baseUrl, action);
      } catch {
        // SSE will correct state if the command raced with an event
      }
    },
    [isService],
  );

  const noDisc = t("media.cd.noDisc");

  const playbackFeed = useMemo<CurrentPlaybackFeed>(() => {
    if (!state.hasDisc) {
      return {
        artistName: "",
        trackTitle: noDisc,
        albumTitle: "",
        artworkUrl: null,
        artworkStatus: "unknown",
        durationSeconds: 0,
        currentTimeSeconds: 0,
        isPlaying: false,
      };
    }
    const track =
      state.tracks.find((candidate) => candidate.index === state.currentTrackIndex) ??
      null;
    return {
      artistName: "",
      trackTitle: track?.title ?? noDisc,
      albumTitle: state.discTitle ?? "",
      artworkUrl: null,
      artworkStatus: "unknown",
      durationSeconds: state.durationSeconds ?? 0,
      currentTimeSeconds: state.currentTimeSeconds,
      isPlaying: state.isPlaying,
    };
  }, [state, noDisc]);

  return {
    mode,
    state,
    isService,
    playbackFeed,
    toggle: () => sendAction("toggle"),
    next: () => sendAction("next"),
    previous: () => sendAction("previous"),
    stop: () => sendAction("stop"),
  };
}
