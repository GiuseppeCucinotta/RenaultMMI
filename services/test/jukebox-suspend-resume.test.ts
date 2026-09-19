import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import type { JukeboxLibrary, JukeboxPlaybackState } from "../shared/jukebox-types.js";
import { JukeboxPlayer } from "../jukebox-service/player.js";
import { createFakeMpvFactory } from "./fake-mpv.js";
import {
  ALBUM_ID,
  MUSIC_ROOT,
  TRACK_FILES,
  makeLibrary,
  withJukeboxService,
  type JukeboxHealthBody,
  type SuspendedBody,
} from "./jukebox-harness.js";
import { apiGet, apiPost, waitFor } from "./support.js";

/* -------------------------------------------------------------------------- */
/* Example: mocking node-mpv and testing player suspend/resume                 */
/* -------------------------------------------------------------------------- */

test("suspend snapshots the position in RAM and kills the mpv process", async () => {
  const mpvFactory = createFakeMpvFactory();
  const player = new JukeboxPlayer(MUSIC_ROOT, "/usr/bin/mpv", {
    createMpv: mpvFactory.createMpv,
  });
  player.setLibrary(makeLibrary());

  await player.start();
  await player.playAlbum(ALBUM_ID);
  assert.equal(mpvFactory.instances.length, 1);

  // Drive the injected mpv exactly like the real one would.
  const mpv = mpvFactory.instances[0];
  mpv.emit("status", { property: "playlist-pos", value: 1 });
  mpv.emit("timeposition", 42);

  const snapshot = await player.suspend();

  assert.deepEqual(snapshot, {
    albumId: ALBUM_ID,
    trackIndex: 1,
    positionSeconds: 42,
    wasPlaying: true,
  });
  assert.equal(mpv.running, false, "mpv process was released");
  assert.equal(mpv.callsTo("quit").length, 1);

  // The UI keeps showing what was loaded, minus the playback flag.
  const state = player.getState();
  assert.equal(state.albumId, ALBUM_ID);
  assert.equal(state.trackIndex, 1);
  assert.equal(state.currentTimeSeconds, 42);
  assert.equal(state.isPlaying, false);
  assert.equal(player.isRunning(), false);
});

test("resume relaunches mpv at the snapshot position without starting playback", async () => {
  const mpvFactory = createFakeMpvFactory();
  const player = new JukeboxPlayer(MUSIC_ROOT, "/usr/bin/mpv", {
    createMpv: mpvFactory.createMpv,
  });
  player.setLibrary(makeLibrary());

  await player.start();
  await player.playAlbum(ALBUM_ID);
  const first = mpvFactory.instances[0];
  first.emit("status", { property: "playlist-pos", value: 2 });
  first.emit("timeposition", 88);
  await player.suspend();

  assert.equal(await player.resume(), true);

  assert.equal(mpvFactory.instances.length, 2, "a fresh mpv instance was spawned");
  const restored = mpvFactory.instances[1];
  assert.equal(restored.running, true);
  assert.deepEqual(restored.lastCall("load")?.args, [
    path.join(MUSIC_ROOT, TRACK_FILES[0]),
    "replace",
  ]);
  assert.deepEqual(
    restored.callsTo("append").map((call) => call.args[0]),
    [path.join(MUSIC_ROOT, TRACK_FILES[1]), path.join(MUSIC_ROOT, TRACK_FILES[2])],
  );
  assert.deepEqual(restored.lastCall("jump")?.args, [2]);
  assert.deepEqual(restored.lastCall("seek")?.args, [88, "absolute"]);
  assert.equal(restored.callsTo("play").length, 0, "restoring a snapshot never starts audio");
  assert.ok(restored.callsTo("pause").length >= 1, "playback is actively held");
  assert.ok(restored.args.includes("--pause=yes"), "mpv is launched paused, so nothing bleeds out");

  const state = player.getState();
  assert.equal(state.trackIndex, 2);
  assert.equal(state.currentTimeSeconds, 88);
  assert.equal(state.isPlaying, false, "the listener presses play when they are ready");
  assert.equal(player.getSnapshot(), null, "snapshot is consumed by resume");
});

test("resume keeps a paused album paused and preserves the volume", async () => {
  const mpvFactory = createFakeMpvFactory();
  const player = new JukeboxPlayer(MUSIC_ROOT, "/usr/bin/mpv", {
    createMpv: mpvFactory.createMpv,
  });
  player.setLibrary(makeLibrary());

  await player.start();
  await player.playAlbum(ALBUM_ID);
  await player.setVolume(40);

  const first = mpvFactory.instances[0];
  first.emit("paused");
  await player.suspend();
  assert.deepEqual(player.getSnapshot(), {
    albumId: ALBUM_ID,
    trackIndex: 0,
    positionSeconds: 0,
    wasPlaying: false,
  });

  assert.equal(await player.resume(), true);
  const restored = mpvFactory.instances[1];
  assert.equal(restored.callsTo("play").length, 0, "a paused album stays paused");
  assert.ok(restored.callsTo("pause").length >= 1);
  assert.deepEqual(restored.callsTo("volume"), []);
  assert.match(restored.args.join(" "), /--volume=40/);
  assert.equal(restored.callsTo("seek").length, 0, "no seek for a zero position");
  assert.equal(player.getState().isPlaying, false);
});

test("playAlbum({paused:true}) holds a freshly spawned mpv before it can sound", async () => {
  const mpvFactory = createFakeMpvFactory();
  const player = new JukeboxPlayer(MUSIC_ROOT, "/usr/bin/mpv", {
    createMpv: mpvFactory.createMpv,
  });
  player.setLibrary(makeLibrary());

  await player.playAlbum(ALBUM_ID, { paused: true });

  const mpv = mpvFactory.instances[0];
  assert.ok(mpv.args.includes("--pause=yes"), "the launch flag prevents any blip");
  assert.equal(mpv.callsTo("play").length, 0);
  assert.equal(mpv.lastCall("load")?.args[0], path.join(MUSIC_ROOT, TRACK_FILES[0]));
  assert.equal(player.getState().isPlaying, false);
});

test("suspend and resume without a loaded album are safe no-ops", async () => {
  const mpvFactory = createFakeMpvFactory();
  const player = new JukeboxPlayer(MUSIC_ROOT, "/usr/bin/mpv", {
    createMpv: mpvFactory.createMpv,
  });

  assert.equal(await player.suspend(), null);
  assert.equal(await player.resume(), false);
  assert.equal(mpvFactory.instances.length, 0, "mpv is only spawned when needed");
});

/* -------------------------------------------------------------------------- */
/* Service level: the same behaviour through HTTP + /api/settings              */
/* -------------------------------------------------------------------------- */

test("POST /api/settings suspends the service and resume restores the track", async () => {
  await withJukeboxService(async ({ service, base, mpvFactory }) => {
    const play = await apiPost<JukeboxPlaybackState>(`${base}/api/play`, { albumId: ALBUM_ID });
    assert.equal(play.status, 200);
    assert.equal(play.body.isPlaying, true);
    assert.equal(play.body.albumId, ALBUM_ID);

    const mpv = mpvFactory.instances[0];
    mpv.emit("status", { property: "playlist-pos", value: 1 });
    mpv.emit("timeposition", 42);

    const suspended = await apiPost<SuspendedBody>(`${base}/api/settings`, { suspended: true });
    assert.equal(suspended.status, 200);
    assert.equal(suspended.body.phase, "suspended");
    assert.equal(mpv.running, false, "mpv was released while suspended");

    const health = await apiGet<JukeboxHealthBody>(`${base}/api/health`);
    assert.equal(health.body.suspended, true);
    assert.equal(health.body.mpvAvailable, false);
    assert.equal(health.body.libraryLoaded, true);

    // Health polling while suspended must not wake the service up.
    await apiGet<JukeboxHealthBody>(`${base}/api/health`);
    assert.equal(service.suspended, true);

    const frozen = await apiGet<JukeboxPlaybackState>(`${base}/api/state`);
    assert.equal(frozen.body.albumId, ALBUM_ID);
    assert.equal(frozen.body.trackIndex, 1);
    assert.equal(frozen.body.currentTimeSeconds, 42);
    assert.equal(frozen.body.isPlaying, false);

    const resumed = await apiPost<SuspendedBody>(`${base}/api/settings`, { suspended: false });
    assert.equal(resumed.body.phase, "running");
    assert.equal(mpvFactory.instances.length, 2);
    assert.deepEqual(mpvFactory.instances[1].lastCall("seek")?.args, [42, "absolute"]);

    const restored = await apiGet<JukeboxPlaybackState>(`${base}/api/state`);
    assert.equal(restored.body.isPlaying, false, "the restored album stays paused");
    assert.equal(restored.body.currentTimeSeconds, 42);
    assert.equal(restored.body.trackIndex, 1);
  });
});

test("a playback command on a suspended service resumes it first", async () => {
  await withJukeboxService(async ({ service, base, mpvFactory }) => {
    await apiPost(`${base}/api/play`, { albumId: ALBUM_ID });
    await apiPost(`${base}/api/settings`, { suspended: true });
    assert.equal(service.suspended, true);

    const paused = await apiPost<JukeboxPlaybackState>(`${base}/api/playback`, { action: "pause" });

    assert.equal(paused.status, 200);
    assert.equal(service.suspended, false);
    assert.equal(mpvFactory.instances.length, 2, "the service woke up before handling the command");
    assert.ok(
      mpvFactory.instances[1].callsTo("pause").length >= 1,
      "the album was restored paused",
    );
    assert.equal(paused.body.isPlaying, false);
  });
});

test("auto-suspend frees mpv after the idle window", async () => {
  await withJukeboxService(
    async ({ service, base, mpvFactory }) => {
      await apiPost(`${base}/api/play`, { albumId: ALBUM_ID });
      // Stop playback so the service counts as idle.
      mpvFactory.instances[0].emit("paused");

      await waitFor(() => service.suspended, "idle auto-suspend", 3000);
      assert.equal(mpvFactory.instances[0].running, false);
      assert.equal((await apiGet<JukeboxHealthBody>(`${base}/api/health`)).body.suspended, true);
    },
    { autoSuspend: true, idleTimeoutMs: 60 },
  );
});

test("POST /api/play {paused:true} loads an album without starting playback", async () => {
  await withJukeboxService(async ({ base, mpvFactory }) => {
    const play = await apiPost<JukeboxPlaybackState>(`${base}/api/play`, {
      albumId: ALBUM_ID,
      paused: true,
    });

    assert.equal(play.status, 200);
    assert.equal(play.body.albumId, ALBUM_ID);
    assert.equal(play.body.isPlaying, false, "loaded paused");

    // mpv was already started by the service, so the pause has to be applied
    // through the IPC property (the `--pause=yes` launch flag only covers a
    // freshly spawned process, which is the resume path).
    const mpv = mpvFactory.instances[0];
    assert.equal(mpv.callsTo("play").length, 0);
    assert.ok(mpv.callsTo("pause").length >= 1, "playback was held");

    // A non-boolean flag is rejected instead of being coerced.
    const invalid = await apiPost<{ error: string }>(`${base}/api/play`, {
      albumId: ALBUM_ID,
      paused: "yes",
    });
    assert.equal(invalid.status, 400);
  });
});

test("the music endpoints keep their contract", async () => {
  await withJukeboxService(async ({ base }) => {
    const library = await apiGet<JukeboxLibrary>(`${base}/api/library`);
    assert.equal(library.status, 200);
    assert.equal(library.body.schemaVersion, 2);
    assert.equal(library.body.artists[0]?.albums.length, 1);

    assert.equal((await apiGet(`${base}/api/artwork/${ALBUM_ID}`)).status, 404);

    const missing = await apiPost<{ error: string }>(`${base}/api/play`, { albumId: "nope" });
    assert.equal(missing.status, 404);

    const badAction = await apiPost<{ error: string }>(`${base}/api/playback`, { action: "warp" });
    assert.equal(badAction.status, 400);

    const badTrack = await apiPost<{ error: string }>(`${base}/api/track`, { trackIndex: -1 });
    assert.equal(badTrack.status, 400);
  });
});

