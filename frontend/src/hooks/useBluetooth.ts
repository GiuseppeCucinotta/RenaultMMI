import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  bluetoothDemoEnabled,
  IDLE_BLUETOOTH_STATE,
  MOCK_BLUETOOTH_STATE,
  MOCK_PHONE_IDS,
} from "@/data/bluetooth.mock";
import {
  bluetoothPairingAction,
  bluetoothPhoneAction,
  bluetoothPlaybackAction,
  bluetoothScanAction,
  checkBluetoothHealth,
  fetchBluetoothState,
  getBluetoothEndpoint,
  subscribeBluetooth,
} from "@/services/bluetooth";
import type {
  BluetoothMode,
  BluetoothPairing,
  BluetoothPairingAction,
  BluetoothPhoneAction,
  BluetoothPlaybackAction,
  BluetoothScanAction,
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
  /** Phone management (discovery + device actions). */
  scan: (action: BluetoothScanAction) => Promise<void>;
  phoneAction: (action: BluetoothPhoneAction, deviceId: string) => Promise<void>;
  pairingAction: (
    action: BluetoothPairingAction,
    payload?: { deviceId?: string; value?: string },
  ) => Promise<void>;
  /** Device currently being paired/connected, for per-row spinners. */
  busyDeviceId: string | null;
  /** Last action error, shown inline on the affected device row. */
  actionError: { deviceId: string | null; message: string } | null;
  clearActionError: () => void;
  pairing: BluetoothPairing;
}

export function useBluetooth(): UseBluetoothResult {
  const { t } = useI18n();
  const [mode, setMode] = useState<BluetoothMode>("loading");
  const [state, setState] = useState<BluetoothState>(IDLE_BLUETOOTH_STATE);
  const [busyDeviceId, setBusyDeviceId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<{
    deviceId: string | null;
    message: string;
  } | null>(null);
  const endpointRef = useRef<string | null>(null);
  const modeRef = useRef<BluetoothMode>("loading");
  const demo = useMemo(() => bluetoothDemoEnabled(), []);

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
        setState(demo ? MOCK_BLUETOOTH_STATE : IDLE_BLUETOOTH_STATE);
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
  }, [demo, setModeSafe]);

  useEffect(() => {
    if (mode === "mock") setState(demo ? MOCK_BLUETOOTH_STATE : IDLE_BLUETOOTH_STATE);
  }, [demo, mode]);

  useEffect(() => {
    if (mode !== "service" || !endpointRef.current) return;
    return subscribeBluetooth(endpointRef.current, setState);
  }, [mode]);

  const isService = mode === "service";

  /**
   * A simulated scan: it stops itself after {@link SCAN_WINDOW_MS} so a browser
   * session behaves like the service's 60 s radio timeout.
   */
  const mockScan = useCallback(async (action: BluetoothScanAction) => {
    if (action === "refresh") return;
    const discovering = action === "start";
    setState((prev) => {
      const devices = [...prev.devices];
      if (discovering && !devices.some((device) => device.id === MOCK_PHONE_IDS.second)) {
        devices.push(MOCK_BLUETOOTH_STATE.devices[1]);
      }
      return {
        ...prev,
        available: true,
        discovering,
        adapter: { ...prev.adapter, discovering, discoverable: discovering, powered: true },
        devices,
      };
    });
  }, []);

  const mockPhoneAction = useCallback((action: BluetoothPhoneAction, deviceId: string) => {
    setState((prev) => {
      let devices = prev.devices.map((device) => ({ ...device }));
      const target = devices.find((device) => device.id === deviceId);

      switch (action) {
        case "forget":
          devices = devices.filter((device) => device.id !== deviceId);
          break;
        case "connect":
          // Mirror the service policy: connecting a phone makes it primary and
          // drops the others.
          devices = devices.map((device) => {
            const isTarget = device.id === deviceId;
            return {
              ...device,
              connected: isTarget,
              primary: isTarget,
              paired: isTarget ? true : device.paired,
            };
          });
          break;
        case "disconnect":
          if (target) {
            target.connected = false;
            target.primary = false;
          }
          break;
        case "trust":
          if (target) target.trusted = true;
          break;
        case "untrust":
          if (target) target.trusted = false;
          break;
      }

      const primary = devices.find((device) => device.primary) ?? null;
      const media =
        action === "connect" && primary
          ? {
              ...MOCK_BLUETOOTH_STATE.media,
              deviceId: primary.id,
            }
          : action === "disconnect" || action === "forget"
            ? IDLE_BLUETOOTH_STATE.media
            : prev.media;

      return { ...prev, devices, media };
    });
  }, []);

  const mockPairingAction = useCallback(
    (action: BluetoothPairingAction, payload?: { deviceId?: string; value?: string }) => {
      setState((prev) => {
        const idle: BluetoothPairing = {
          ...IDLE_BLUETOOTH_STATE.pairing,
        };
        if (action === "cancel" || action === "reject") {
          return { ...prev, pairing: idle };
        }
        if (action === "pair") {
          const device = prev.devices.find((candidate) => candidate.id === payload?.deviceId);
          return {
            ...prev,
            pairing: {
              stage: "awaiting-confirmation",
              deviceId: payload?.deviceId ?? null,
              deviceName: device?.name ?? null,
              method: "confirm",
              passkey: "123456",
              error: null,
            },
          };
        }
        // `confirm` / `submit`: the pair succeeds.
        const deviceId = prev.pairing.deviceId;
        const devices = prev.devices.map((device) =>
          device.id === deviceId
            ? { ...device, paired: true, trusted: true, connected: true, primary: true }
            : { ...device, connected: false, primary: false },
        );
        return {
          ...prev,
          pairing: idle,
          devices,
          media: { ...MOCK_BLUETOOTH_STATE.media, deviceId: deviceId ?? null },
        };
      });
    },
    [],
  );

  const runServiceCall = useCallback(
    async (deviceId: string | null, call: (baseUrl: string) => Promise<void>) => {
      const baseUrl = endpointRef.current;
      if (!baseUrl) return;
      setBusyDeviceId(deviceId);
      setActionError(null);
      try {
        await call(baseUrl);
      } catch (error) {
        setActionError({
          deviceId,
          message: error instanceof Error ? error.message : "Bluetooth action failed",
        });
      } finally {
        setBusyDeviceId(null);
      }
    },
    [],
  );

  const scan = useCallback(
    async (action: BluetoothScanAction) => {
      if (!isService) {
        await mockScan(action);
        return;
      }
      await runServiceCall(null, async (baseUrl) => {
        const next = await bluetoothScanAction(baseUrl, action);
        setState(next);
      });
    },
    [isService, mockScan, runServiceCall],
  );

  const phoneAction = useCallback(
    async (action: BluetoothPhoneAction, deviceId: string) => {
      if (!isService) {
        mockPhoneAction(action, deviceId);
        return;
      }
      await runServiceCall(deviceId, async (baseUrl) => {
        const next = await bluetoothPhoneAction(baseUrl, action, deviceId);
        setState(next);
      });
    },
    [isService, mockPhoneAction, runServiceCall],
  );

  const pairingAction = useCallback(
    async (
      action: BluetoothPairingAction,
      payload: { deviceId?: string; value?: string } = {},
    ) => {
      if (!isService) {
        mockPairingAction(action, payload);
        return;
      }
      await runServiceCall(payload.deviceId ?? null, async (baseUrl) => {
        const pairing = await bluetoothPairingAction(baseUrl, action, payload);
        setState((prev) => ({ ...prev, pairing }));
      });
    },
    [isService, mockPairingAction, runServiceCall],
  );

  const clearActionError = useCallback(() => setActionError(null), []);

  const sendAction = useCallback(
    async (action: BluetoothPlaybackAction) => {
      if (isService) {
        await runServiceCall(null, async (baseUrl) => {
          const media = await bluetoothPlaybackAction(baseUrl, action);
          setState((prev) => ({ ...prev, media }));
        });
        return;
      }
      const status = action === "pause" ? "paused" : action === "stop" ? "stopped" : "playing";
      setState((prev) => ({ ...prev, media: { ...prev.media, status } }));
    },
    [isService, runServiceCall],
  );

  const noPhoneConnected = t("media.bluetooth.noPhoneConnected");

  const playbackFeed = useMemo<CurrentPlaybackFeed>(() => {
    const { media } = state;
    const track = media.track;
    if (!media.deviceId || !track) {
      return {
        artistName: "",
        trackTitle: noPhoneConnected,
        albumTitle: "",
        artworkUrl: null,
        artworkStatus: "unknown",
        durationSeconds: 0,
        currentTimeSeconds: 0,
        isPlaying: false,
      };
    }
    const baseUrl = endpointRef.current;
    let artworkUrl: string | null = null;
    if (track.artworkState === "ready" && track.artworkUrl) {
      try {
        artworkUrl = new URL(track.artworkUrl, baseUrl ?? undefined).toString();
      } catch {
        artworkUrl = null;
      }
    }
    const artworkStatus: CurrentPlaybackFeed["artworkStatus"] =
      track.artworkState === "ready"
        ? "ready"
        : track.artworkState === "loading"
          ? "loading"
          : "unknown";
    return {
      artistName: track.artist ?? "",
      trackTitle: track.title ?? noPhoneConnected,
      albumTitle: track.album ?? "",
      artworkUrl,
      artworkStatus,
      durationSeconds: Math.round((media.durationMs ?? 0) / 1000),
      currentTimeSeconds: Math.round(media.positionMs / 1000),
      isPlaying: media.status === "playing",
    };
  }, [state, noPhoneConnected]);

  return {
    mode,
    state,
    isService,
    playbackFeed,
    scan,
    phoneAction,
    pairingAction,
    busyDeviceId,
    actionError,
    clearActionError,
    pairing: state.pairing,
    toggle: () => sendAction("toggle"),
    next: () => sendAction("next"),
    previous: () => sendAction("previous"),
    stop: () => sendAction("stop"),
  };
}
