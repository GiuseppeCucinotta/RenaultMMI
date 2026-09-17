import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  IDLE_PLAYBACK_STATE,
  MOCK_LIBRARY,
  findAlbumById,
  flattenAlbums,
} from "@/data/jukebox.mock";
import {
  checkJukeboxHealth,
  fetchJukeboxLibrary,
  getJukeboxEndpoint,
  jukeboxArtworkUrl,
  jukeboxPlay,
  jukeboxPlaybackAction,
  jukeboxPlayTrack,
  jukeboxSeek,
  requestJukeboxScan,
  subscribeJukebox,
} from "@/services/jukebox";
import type {
  JukeboxAlbum,
  JukeboxLibrary,
  JukeboxMode,
  JukeboxPlaybackAction,
  JukeboxPlaybackState,
} from "@/types/jukebox";
import type { CurrentPlaybackFeed } from "@/types/media";
import { rememberPlayback, type LastPlayback } from "@/lib/lastPlayback";

export interface UseJukeboxResult {
  mode: JukeboxMode;
  error: string | null;
  library: JukeboxLibrary | null;
  albums: JukeboxAlbum[];
  state: JukeboxPlaybackState;
  playbackFeed: CurrentPlaybackFeed | null;
  /** Last album the service actually had loaded (survives a service restart). */
  lastPlayback: LastPlayback | null;
  scan: () => Promise<void>;
  artworkUrlFor: (albumId: string) => string | null;
  /** Loads an album; `paused` restores it without starting playback. */
  playAlbum: (albumId: string, options?: { paused?: boolean }) => Promise<boolean>;
  playTrack: (trackIndex: number) => Promise<void>;
  /**
   * Re-loads {@link UseJukeboxResult.lastPlayback} when the service reports
   * nothing loaded, restoring the track and play/pause state. Returns true
   * when something was restored.
   */
  restoreLastPlayback: () => Promise<boolean>;
  toggle: () => Promise<void>;
  next: () => Promise<void>;
  previous: () => Promise<void>;
  seek: (seconds: number) => Promise<void>;
  stop: () => Promise<void>;
}

export function useJukebox(): UseJukeboxResult {
  const [mode, setMode] = useState<JukeboxMode>("loading");
  const [library, setLibrary] = useState<JukeboxLibrary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<JukeboxPlaybackState>(IDLE_PLAYBACK_STATE);
  const [lastPlayback, setLastPlayback] = useState<LastPlayback | null>(null);
  const endpointRef = useRef<string | null>(null);
  const lastPlaybackRef = useRef<LastPlayback | null>(null);
  const stateRef = useRef<JukeboxPlaybackState>(IDLE_PLAYBACK_STATE);
  stateRef.current = state;

  /**
   * Single entry point for states that come from the service: keeps the
   * recovery memory in sync with what the service really has loaded.
   */
  const applyServiceState = useCallback((next: JukeboxPlaybackState) => {
    const remembered = rememberPlayback(lastPlaybackRef.current, next);
    lastPlaybackRef.current = remembered;
    setLastPlayback(remembered);
    setState(next);
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      let baseUrl: string;
      try {
        baseUrl = await getJukeboxEndpoint();
      } catch {
        if (!cancelled) {
          setLibrary(MOCK_LIBRARY);
          setMode("mock");
        }
        return;
      }

      const healthy = await checkJukeboxHealth(baseUrl);
      if (cancelled) return;

      if (!healthy) {
        setLibrary(MOCK_LIBRARY);
        setMode("mock");
        return;
      }

      endpointRef.current = baseUrl;
      try {
        const loaded = await fetchJukeboxLibrary(baseUrl);
        if (cancelled) return;
        setLibrary(loaded);
        setMode("service");
      } catch {
        if (cancelled) return;
        setLibrary(null);
        setMode("service");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (mode !== "service" || !endpointRef.current) return;
    return subscribeJukebox(endpointRef.current, applyServiceState);
  }, [mode, applyServiceState]);

  const advanceMock = useCallback(() => {
    setState((prev) => {
      if (!prev.albumId || !prev.isPlaying) return prev;
      const album = findAlbumById(MOCK_LIBRARY, prev.albumId);
      const duration =
        prev.durationSeconds ?? album?.songs[prev.trackIndex]?.durationSeconds ?? 0;
      const nextTime = prev.currentTimeSeconds + 0.5;

      if (duration > 0 && nextTime >= duration) {
        const songCount = album?.songs.length ?? 1;
        const nextIndex = (prev.trackIndex + 1) % songCount;
        const song = album?.songs[nextIndex];
        return {
          ...prev,
          trackIndex: nextIndex,
          currentTimeSeconds: 0,
          durationSeconds: song?.durationSeconds ?? prev.durationSeconds,
          trackTitle: song?.title ?? prev.trackTitle,
        };
      }

      return { ...prev, currentTimeSeconds: nextTime };
    });
  }, []);

  useEffect(() => {
    if (mode !== "mock") return;
    if (!state.albumId || !state.isPlaying) return;
    const timer = window.setInterval(advanceMock, 500);
    return () => window.clearInterval(timer);
  }, [mode, state.albumId, state.isPlaying, advanceMock]);

  const isService = mode === "service";

  const mockPlay = useCallback((albumId: string) => {
    const album = findAlbumById(MOCK_LIBRARY, albumId);
    if (!album || album.songs.length === 0) return;
    const song = album.songs[0];
    setState({
      albumId,
      trackIndex: 0,
      artistName: album.artistName,
      albumTitle: album.title,
      trackTitle: song.title,
      durationSeconds: song.durationSeconds,
      currentTimeSeconds: 0,
      isPlaying: true,
    });
  }, []);

  const mockStepTrack = useCallback((direction: 1 | -1) => {
    setState((prev) => {
      if (!prev.albumId) return prev;
      const album = findAlbumById(MOCK_LIBRARY, prev.albumId);
      const songCount = album?.songs.length ?? 0;
      if (songCount === 0) return prev;
      const nextIndex = (prev.trackIndex + direction + songCount) % songCount;
      const song = album?.songs[nextIndex];
      return {
        ...prev,
        trackIndex: nextIndex,
        trackTitle: song?.title ?? prev.trackTitle,
        durationSeconds: song?.durationSeconds ?? prev.durationSeconds,
        currentTimeSeconds: 0,
      };
    });
  }, []);

  const mockSeek = useCallback((seconds: number) => {
    setState((prev) => {
      const album = prev.albumId ? findAlbumById(MOCK_LIBRARY, prev.albumId) : null;
      const max =
        prev.durationSeconds ?? album?.songs[prev.trackIndex]?.durationSeconds ?? 0;
      return {
        ...prev,
        currentTimeSeconds: Math.max(0, Math.min(seconds, max)),
      };
    });
  }, []);

  const jumpToTrack = useCallback(
    (trackIndex: number) => {
      setState((prev) => {
        if (!prev.albumId) return prev;
        const album = findAlbumById(library, prev.albumId);
        const songCount = album?.songs.length ?? 0;
        if (trackIndex < 0 || trackIndex >= songCount) return prev;
        const song = album?.songs[trackIndex];
        return {
          ...prev,
          trackIndex,
          trackTitle: song?.title ?? prev.trackTitle,
          durationSeconds: song?.durationSeconds ?? prev.durationSeconds,
          currentTimeSeconds: 0,
        };
      });
    },
    [library],
  );

  const playAlbum = useCallback(
    async (albumId: string, options: { paused?: boolean } = {}): Promise<boolean> => {
      const baseUrl = endpointRef.current;
      if (isService && baseUrl) {
        try {
          applyServiceState(await jukeboxPlay(baseUrl, albumId, options));
          return true;
        } catch {
          return false;
        }
      }
      mockPlay(albumId);
      return true;
    },
    [applyServiceState, isService, mockPlay],
  );

  const sendAction = useCallback(
    async (action: JukeboxPlaybackAction) => {
      const baseUrl = endpointRef.current;
      if (isService && baseUrl) {
        try {
          await jukeboxPlaybackAction(baseUrl, action);
        } catch {
          // SSE will correct state if the command raced with an event
        }
      } else if (action === "next") {
        mockStepTrack(1);
      } else if (action === "previous") {
        mockStepTrack(-1);
      } else if (action === "toggle") {
        setState((prev) => ({ ...prev, isPlaying: !prev.isPlaying }));
      } else if (action === "stop") {
        setState(IDLE_PLAYBACK_STATE);
      }
    },
    [isService, mockStepTrack],
  );

  const playTrack = useCallback(
    async (trackIndex: number) => {
      const baseUrl = endpointRef.current;
      if (isService && baseUrl) {
        jumpToTrack(trackIndex);
        try {
          const nextState = await jukeboxPlayTrack(baseUrl, trackIndex);
          applyServiceState(nextState);
        } catch {
          // keep the optimistic position; the next SSE event reconciles it
        }
      } else {
        jumpToTrack(trackIndex);
      }
    },
    [applyServiceState, isService, jumpToTrack],
  );

  /**
   * Brings back what the service no longer has loaded.
   *
   * The service keeps a RAM snapshot while suspended, so this normally has
   * nothing to do; it matters when the state was lost (process restart,
   * crash, or an explicit stop issued by an older main process), where the
   * media screen would otherwise stay blank for good.
   */
  const restoreLastPlayback = useCallback(async (): Promise<boolean> => {
    const target = lastPlaybackRef.current;
    const baseUrl = endpointRef.current;
    if (!target || !isService || !baseUrl) return false;
    if (stateRef.current.albumId) return false; // something is already loaded

    try {
      // Load paused and stay paused: rebuilding the state must not start audio
      // any more than a snapshot restore does.
      applyServiceState(await jukeboxPlay(baseUrl, target.albumId, { paused: true }));
      if (target.trackIndex > 0) {
        applyServiceState(await jukeboxPlayTrack(baseUrl, target.trackIndex));
      }
      await jukeboxPlaybackAction(baseUrl, "pause");
      return true;
    } catch {
      return false;
    }
  }, [applyServiceState, isService]);

  const stop = useCallback(async () => {
    // An explicit stop is the one thing that must forget the album: otherwise
    // returning to the source would restart what the listener just stopped.
    lastPlaybackRef.current = null;
    setLastPlayback(null);
    await sendAction("stop");
  }, [sendAction]);

  const seek = useCallback(
    async (seconds: number) => {
      const baseUrl = endpointRef.current;
      if (isService && baseUrl) {
        try {
          await jukeboxSeek(baseUrl, seconds);
        } catch {
          // progress events will settle the position
        }
      } else {
        mockSeek(seconds);
      }
    },
    [isService, mockSeek],
  );

  const scan = useCallback(async () => {
    const baseUrl = endpointRef.current;
    if (mode !== "service" || !baseUrl) return;
    try {
      setError(null);
      setLibrary(await requestJukeboxScan(baseUrl));
    } catch (scanError) {
      setError(scanError instanceof Error ? scanError.message : String(scanError));
    }
  }, [mode]);

  const albums = useMemo(() => (library ? flattenAlbums(library) : []), [library]);

  const artworkUrlFor = useCallback(
    (albumId: string): string | null => {
      const album = findAlbumById(library, albumId);
      if (!album) return null;
      if (mode === "service" && endpointRef.current && album.artworkPath) {
        return jukeboxArtworkUrl(endpointRef.current, albumId);
      }
      return null;
    },
    [library, mode],
  );

  const playbackFeed = useMemo<CurrentPlaybackFeed | null>(() => {
    if (!state.albumId) return null;
    const artworkUrl = artworkUrlFor(state.albumId);
    return {
      artistName: state.artistName ?? "",
      trackTitle: state.trackTitle ?? "",
      albumTitle: state.albumTitle ?? "",
      artworkUrl,
      artworkStatus: artworkUrl ? "ready" : "unknown",
      durationSeconds: state.durationSeconds ?? 0,
      currentTimeSeconds: state.currentTimeSeconds,
      isPlaying: state.isPlaying,
    };
  }, [state, artworkUrlFor]);

  return {
    mode,
    error,
    library,
    albums,
    state,
    playbackFeed,
    lastPlayback,
    scan,
    artworkUrlFor,
    playAlbum,
    playTrack,
    restoreLastPlayback,
    toggle: () => sendAction("toggle"),
    next: () => sendAction("next"),
    previous: () => sendAction("previous"),
    seek,
    stop,
  };
}
