import assert from "node:assert/strict";
import { test } from "node:test";
import { rememberPlayback, type LastPlayback } from "../src/lib/lastPlayback.js";

const PLAYING: LastPlayback = { albumId: "al_a", trackIndex: 1, wasPlaying: true };

test("remembers the album, track and playback state", () => {
  assert.deepEqual(rememberPlayback(null, { albumId: "al_a", trackIndex: 1, isPlaying: true }), {
    albumId: "al_a",
    trackIndex: 1,
    wasPlaying: true,
  });
});

test("a state without an album never erases the memory", () => {
  // This is the state the service reports after it lost its RAM snapshot
  // (restart, crash, or a stop from an older build): the UI must still be able
  // to bring the album back.
  assert.deepEqual(
    rememberPlayback(PLAYING, { albumId: null, trackIndex: 0, isPlaying: false }),
    PLAYING,
  );
});

test("position ticks do not allocate a new memory object", () => {
  const first = rememberPlayback(PLAYING, { albumId: "al_a", trackIndex: 1, isPlaying: true });
  assert.equal(first, PLAYING, "unchanged state reuses the previous object");

  // Same track and playback state, only the elapsed time moved on.
  const second = rememberPlayback(first, { albumId: "al_a", trackIndex: 1, isPlaying: true });
  assert.equal(second, first, "identity is stable, so React state updates bail out");
});

test("tracks album, track and pause/resume transitions", () => {
  const nextAlbum = rememberPlayback(PLAYING, {
    albumId: "al_b",
    trackIndex: 0,
    isPlaying: true,
  });
  assert.deepEqual(nextAlbum, { albumId: "al_b", trackIndex: 0, wasPlaying: true });

  const nextTrack = rememberPlayback(PLAYING, { albumId: "al_a", trackIndex: 2, isPlaying: true });
  assert.deepEqual(nextTrack, { albumId: "al_a", trackIndex: 2, wasPlaying: true });

  const paused = rememberPlayback(PLAYING, { albumId: "al_a", trackIndex: 1, isPlaying: false });
  assert.deepEqual(paused, { albumId: "al_a", trackIndex: 1, wasPlaying: false });
});

test("an empty memory stays empty", () => {
  assert.equal(rememberPlayback(null, { albumId: null, trackIndex: 0, isPlaying: false }), null);
});
