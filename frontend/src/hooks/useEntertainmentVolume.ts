import { useCallback, useEffect, useRef, useState } from "react";
import {
  ENTERTAINMENT_VOLUME_DEFAULT,
  ENTERTAINMENT_VOLUME_MAX,
} from "@/constants/entertainment";
import type { EntertainmentVolumeState } from "@/types/entertainment";

const DEFAULT_STATE: EntertainmentVolumeState = {
  volume: ENTERTAINMENT_VOLUME_DEFAULT,
  activeSourceId: "bluetooth",
};

export interface UseEntertainmentVolumeResult {
  volume: number;
  activeSourceId: string;
  setVolume: (volume: number) => Promise<void>;
  setActiveSource: (sourceId: string) => Promise<void>;
  adjustVolume: (delta: number) => Promise<void>;
}

/**
 * Subscribe to the entertainment volume owned by the Electron main process.
 * Because the value lives in main, the debug window and the main window stay
 * in sync: pressing −/+ in the debug panel animates the OSD on the main UI.
 */
export function useEntertainmentVolume(): UseEntertainmentVolumeResult {
  const [state, setState] = useState<EntertainmentVolumeState>(DEFAULT_STATE);
  const volumeRef = useRef(state.volume);
  volumeRef.current = state.volume;

  useEffect(() => {
    const api = window.entertainmentAudio;
    if (!api) return;

    let disposed = false;
    api
      .getState()
      .then((next) => {
        if (!disposed) setState(next);
      })
      .catch(() => undefined);

    const unsubscribe = api.onStateChanged((next) => setState(next));
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, []);

  const setVolume = useCallback(async (volume: number) => {
    const api = window.entertainmentAudio;
    if (!api) return;
    try {
      setState(await api.setVolume(volume));
    } catch {
      // main will broadcast the authoritative state if it differs
    }
  }, []);

  const setActiveSource = useCallback(async (sourceId: string) => {
    const api = window.entertainmentAudio;
    if (!api) return;
    try {
      setState(await api.setActiveSource(sourceId));
    } catch {
      // main will broadcast the authoritative state if it differs
    }
  }, []);

  const adjustVolume = useCallback(
    async (delta: number) => {
      const next = Math.max(
        0,
        Math.min(ENTERTAINMENT_VOLUME_MAX, volumeRef.current + delta),
      );
      await setVolume(next);
    },
    [setVolume],
  );

  return {
    volume: state.volume,
    activeSourceId: state.activeSourceId,
    setVolume,
    setActiveSource,
    adjustVolume,
  };
}
