/**
 * Renderer-side memory of what the jukebox last had loaded.
 *
 * The host service keeps its own RAM snapshot while it is suspended, but that
 * snapshot dies with the process: a restart, a crash, or a `playback: stop`
 * from an older build leaves the service reporting "nothing loaded". The media
 * screen then rendered an empty player (no track, no album, no artist) with no
 * way back.
 *
 * Folding the service state into this memory gives the UI a safety net: it can
 * reload what the listener had, and it never treats "service lost its state"
 * as "the user stopped the music".
 */
export interface LastPlayback {
  albumId: string;
  /** Zero-based track index inside the album. */
  trackIndex: number;
  wasPlaying: boolean;
}

/** The subset of the jukebox state this memory cares about. */
export interface PlaybackSnapshot {
  albumId: string | null;
  trackIndex: number;
  isPlaying: boolean;
}

/**
 * Folds one service state into the memory.
 *
 * - A state **without** an album never erases the memory — that is exactly the
 *   state loss this memory exists to recover from. Only an explicit stop
 *   clears it (the caller does that on purpose).
 * - The previous object is returned unchanged when nothing meaningful moved,
 *   so it can live in React state without re-rendering on every position tick.
 */
export function rememberPlayback(
  previous: LastPlayback | null,
  state: PlaybackSnapshot,
): LastPlayback | null {
  if (!state.albumId) return previous;
  if (
    previous &&
    previous.albumId === state.albumId &&
    previous.trackIndex === state.trackIndex &&
    previous.wasPlaying === state.isPlaying
  ) {
    return previous;
  }
  return {
    albumId: state.albumId,
    trackIndex: state.trackIndex,
    wasPlaying: state.isPlaying,
  };
}
