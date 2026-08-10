import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import demoArtwork from "@/assets/icons/apps/Music.png";
import { IDLE_BLUETOOTH_STATE } from "@/data/bluetooth.mock";
import {
  bluetoothPlaybackAction,
  checkBluetoothHealth,
  fetchBluetoothState,
  getBluetoothEndpoint,
  subscribeBluetooth,
} from "@/services/bluetooth";
import type {
  BluetoothMode,
  BluetoothPlaybackAction,
  BluetoothState,
} from "@/types/bluetooth";
import type { CurrentPlaybackFeed } from "@/types/media";
import { useI18n } from "@/i18n";

export interface UseBluetoothResult {
  mode: BluetoothMode;
  state: BluetoothState;
  isService: boolean;
  playbackFeed: CurrentPlaybackFeed;
  toggle: () => Promise<void>;
  next: () => Promise<void>;
  previous: () => Promise<void>;
  stop: () => Promise<void>;
}

export function useBluetooth(): UseBluetoothResult {
  const { t } = useI18n();
  const [mode, setMode] = useState<BluetoothMode>("loading");
  const [state, setState] = useState<BluetoothState>(IDLE_BLUETOOTH_STATE);
  const endpointRef = useRef<string | null>(null);
  const modeRef = useRef<BluetoothMode>("loading");

  const setModeSafe = useCallback((next: BluetoothMode) => {
    modeRef.current = next;
    setMode(next);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let pollTimer: number | undefined;

    const check = async (baseUrl: string) => {
      const healthy = await checkBluetoothHealth(baseUrl);
      if (cancelled) return;
      const current = modeRef.current;

      if (healthy && current !== "service") {
        try {
          const loaded = await fetchBluetoothState(baseUrl);
          if (cancelled) return;
          setState(loaded);
          setModeSafe("service");
        } catch {
          if (cancelled) return;
          setModeSafe("mock");
        }
      } else if (!healthy && current === "service") {
        setState(IDLE_BLUETOOTH_STATE);
        setModeSafe("mock");
      }
    };

    (async () => {
      let baseUrl: string;
      try {
        baseUrl = await getBluetoothEndpoint();
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
    return subscribeBluetooth(endpointRef.current, setState);
  }, [mode]);

  const isService = mode === "service";

  const sendAction = useCallback(
    async (action: BluetoothPlaybackAction) => {
      const baseUrl = endpointRef.current;
      if (!isService || !baseUrl) return;
      try {
        await bluetoothPlaybackAction(baseUrl, action);
      } catch {
        // SSE will correct state if the command raced with an event
      }
    },
    [isService],
  );

  const noPhoneConnected = t("media.bluetooth.noPhoneConnected");

  const playbackFeed = useMemo<CurrentPlaybackFeed>(() => {
    const track = state.track;
    if (!state.connected || !track) {
      return {
        artistName: "",
        trackTitle: noPhoneConnected,
        albumTitle: "",
        artworkUrl: demoArtwork,
        durationSeconds: 0,
        currentTimeSeconds: 0,
        isPlaying: false,
      };
    }
    return {
      artistName: track.artist ?? "",
      trackTitle: track.title,
      albumTitle: track.album ?? "",
      artworkUrl: demoArtwork,
      durationSeconds: Math.round((state.durationMs ?? 0) / 1000),
      currentTimeSeconds: Math.round(state.positionMs / 1000),
      isPlaying: state.status === "playing",
    };
  }, [state, noPhoneConnected]);

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
