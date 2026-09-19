import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { EntertainmentVolumeController } from "../electron/entertainment-audio.js";
import type { JukeboxPlaybackState } from "../../services/shared/jukebox-types.js";
import { readJsonBody, sendJson } from "../../services/shared/service-http.js";
import type { JukeboxService } from "../../services/jukebox-service/service.js";
import type { FakeMpvFactory } from "../../services/test/fake-mpv.js";
import {
  ALBUM_ID,
  withJukeboxService,
  type JukeboxHealthBody,
} from "../../services/test/jukebox-harness.js";
import { apiGet, apiPost, waitFor } from "../../services/test/support.js";

/**
 * Integration tests for the Electron-side source switch: the controller drives
 * the real jukebox service (and its fake mpv) through suspension/resume, so the
 * orchestration in `electron/entertainment-audio.ts` is exercised end to end.
 */

interface NoopLifecycleServer {
  port: number;
  close(): Promise<void>;
}

function startNoopLifecycleServer(): Promise<NoopLifecycleServer> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      void (async () => {
        const url = req.url ?? "/";
        if (req.method === "POST" && url.startsWith("/api/volume")) {
          await readJsonBody(req);
          sendJson(res, 200, { ok: true });
          return;
        }
        sendJson(res, 404, { error: "Not found" });
      })().catch((error) => {
        sendJson(res, 500, { error: error instanceof Error ? error.message : "error" });
      });
    });
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({
        port: typeof address === "object" && address !== null ? address.port : 0,
        close: () =>
          new Promise<void>((resolveClose, rejectClose) => {
            server.closeAllConnections();
            server.close(() => resolveClose());
            server.once("error", rejectClose);
          }),
      });
    });
  });
}

interface ControllerHarness {
  controller: EntertainmentVolumeController;
  base: string;
  service: JukeboxService;
  mpvFactory: FakeMpvFactory;
  lifecycleCalls: Array<{ sourceId: string; suspended: boolean }>;
  failNextSuspend: (sourceId: string) => void;
}

async function withControllerOverJukebox(
  run: (ctx: ControllerHarness) => Promise<void>,
): Promise<void> {
  await withJukeboxService(async ({ service, base, mpvFactory }) => {
    const lifecycleCalls: Array<{ sourceId: string; suspended: boolean }> = [];
    let failingSource: string | null = null;
    const jukeboxPort = Number(new URL(base).port);

    const noopServer = await startNoopLifecycleServer();

    const controller = new EntertainmentVolumeController({
      jukeboxPort,
      bluetoothPort: noopServer.port,
      cdPort: noopServer.port,
      defaultSourceId: "jukebox",
      setSourceSuspended: async (sourceId, suspended) => {
        if (failingSource === sourceId) {
          failingSource = null;
          throw new Error(`simulated failure for ${sourceId}`);
        }
        lifecycleCalls.push({ sourceId, suspended });
        if (sourceId !== "jukebox") return;
        const response = await fetch(`${base}/api/settings`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ suspended }),
        });
        if (!response.ok) throw new Error(`jukebox settings returned ${response.status}`);
        await response.arrayBuffer();
      },
    });

    try {
      await run({
        controller,
        base,
        service,
        mpvFactory,
        lifecycleCalls,
        failNextSuspend: (sourceId) => {
          failingSource = sourceId;
        },
      });
    } finally {
      await noopServer.close();
    }
  });
}

test("setActiveSource suspends the jukebox, kills its mpv and applies the volume", async () => {
  await withControllerOverJukebox(async ({ controller, base, mpvFactory }) => {
    await apiPost(`${base}/api/play`, { albumId: ALBUM_ID });
    const mpv = mpvFactory.instances[0];
    mpv.emit("status", { property: "playlist-pos", value: 1 });
    mpv.emit("timeposition", 42);

    const state = await controller.setActiveSource("bluetooth");

    assert.deepEqual(state, { volume: 25, activeSourceId: "bluetooth" });
    assert.equal(mpv.running, false, "the outgoing jukebox mpv was killed");
    assert.equal(mpv.callsTo("quit").length, 1);
    assert.equal((await apiGet<JukeboxHealthBody>(`${base}/api/health`)).body.suspended, true);

    const frozen = await apiGet<JukeboxPlaybackState>(`${base}/api/state`);
    assert.equal(frozen.body.albumId, ALBUM_ID);
    assert.equal(frozen.body.trackIndex, 1);
    assert.equal(frozen.body.currentTimeSeconds, 42);
    assert.equal(frozen.body.isPlaying, false);

    const restored = await controller.setActiveSource("jukebox");

    assert.equal(mpvFactory.instances.length, 2, "resume spawned a fresh mpv");
    const fresh = mpvFactory.instances[1];
    assert.equal(fresh.running, true);
    assert.deepEqual(fresh.lastCall("seek")?.args, [42, "absolute"]);
    assert.equal(fresh.callsTo("play").length, 0, "returning to the source does not start audio");
    assert.ok(fresh.callsTo("pause").length >= 1, "the restored album is held paused");
    assert.deepEqual(restored, { volume: 25, activeSourceId: "jukebox" });
  });
});

test("setActiveSource restores track and time from the snapshot, paused", async () => {
  await withControllerOverJukebox(async ({ controller, base, mpvFactory }) => {
    await apiPost(`${base}/api/play`, { albumId: ALBUM_ID });
    const first = mpvFactory.instances[0];
    first.emit("status", { property: "playlist-pos", value: 2 });
    first.emit("timeposition", 88);

    await controller.setActiveSource("cd");
    assert.equal(mpvFactory.instances[0].running, false);

    const restored = await controller.setActiveSource("jukebox");
    assert.equal(restored.activeSourceId, "jukebox");

    const fresh = mpvFactory.instances[1];
    assert.deepEqual(fresh.lastCall("jump")?.args, [2]);
    assert.deepEqual(fresh.lastCall("seek")?.args, [88, "absolute"]);
    assert.equal(fresh.callsTo("play").length, 0);

    const state = await apiGet<JukeboxPlaybackState>(`${base}/api/state`);
    assert.equal(state.body.albumId, ALBUM_ID);
    assert.equal(state.body.trackIndex, 2);
    assert.equal(state.body.currentTimeSeconds, 88);
    assert.equal(state.body.isPlaying, false);
  });
});

test("setActiveSource keeps a paused album paused after the roundtrip", async () => {
  await withControllerOverJukebox(async ({ controller, base, mpvFactory }) => {
    await apiPost(`${base}/api/play`, { albumId: ALBUM_ID });
    await apiPost(`${base}/api/playback`, { action: "pause" });

    await controller.setActiveSource("fm");
    assert.equal(mpvFactory.instances[0].running, false);

    await controller.setActiveSource("jukebox");
    const fresh = mpvFactory.instances[1];
    assert.equal(fresh.callsTo("play").length, 0, "a paused album stays paused");
    assert.ok(fresh.callsTo("pause").length >= 1);
    assert.equal(fresh.callsTo("seek").length, 0, "zero position does not seek");

    const state = await apiGet<JukeboxPlaybackState>(`${base}/api/state`);
    assert.equal(state.body.isPlaying, false);
  });
});

test("rapid source switches serialise and leave the jukebox restored", async () => {
  await withControllerOverJukebox(async ({ controller, base, mpvFactory }) => {
    await apiPost(`${base}/api/play`, { albumId: ALBUM_ID });
    const first = mpvFactory.instances[0];
    first.emit("status", { property: "playlist-pos", value: 1 });
    first.emit("timeposition", 42);

    const switches = await Promise.all([
      controller.setActiveSource("bluetooth"),
      controller.setActiveSource("cd"),
      controller.setActiveSource("fm"),
      controller.setActiveSource("jukebox"),
    ]);

    assert.equal(
      switches[switches.length - 1]?.activeSourceId,
      "jukebox",
      "the last requested source wins",
    );
    await waitFor(() => mpvFactory.instances.length === 2, "resume mpv");
    const fresh = mpvFactory.instances[1];
    assert.equal(fresh.running, true);
    assert.deepEqual(fresh.lastCall("seek")?.args, [42, "absolute"]);
    assert.equal(fresh.callsTo("play").length, 0);

    const state = await apiGet<JukeboxPlaybackState>(`${base}/api/state`);
    assert.equal(state.body.isPlaying, false);
    assert.equal(state.body.trackIndex, 1);
    assert.equal(state.body.currentTimeSeconds, 42);
  });
});

test("volume set during suspension lands once the source resumes", async () => {
  await withControllerOverJukebox(async ({ controller, base, mpvFactory }) => {
    await apiPost(`${base}/api/play`, { albumId: ALBUM_ID });

    await controller.setActiveSource("bluetooth");
    assert.equal(mpvFactory.instances[0].running, false);

    controller.setVolume(30);
    assert.deepEqual(controller.getState(), { volume: 30, activeSourceId: "bluetooth" });

    await controller.setActiveSource("jukebox");
    const fresh = mpvFactory.instances[1];
    assert.deepEqual(fresh.callsTo("volume").map((call) => call.args[0]), [100]);

    const state = await apiGet<JukeboxPlaybackState>(`${base}/api/state`);
    assert.equal(state.body.isPlaying, false);
  });
});

test("a failed suspend does not block the switch to the selected source", async () => {
  await withControllerOverJukebox(
    async ({ controller, base, mpvFactory, failNextSuspend, lifecycleCalls }) => {
      await apiPost(`${base}/api/play`, { albumId: ALBUM_ID });
      const mpv = mpvFactory.instances[0];

      failNextSuspend("jukebox");
      const state = await controller.setActiveSource("bluetooth");

      // The switch must commit. Rolling back would leave main reporting one
      // source while the UI shows another, with the source the user picked
      // still asleep — a blank media screen. A suspend only fails when the
      // outgoing service is unreachable, i.e. when nothing is playing there.
      assert.deepEqual(state, { volume: 25, activeSourceId: "bluetooth" });
      assert.equal(mpv.running, true, "the unreachable service was left untouched");
      assert.equal((await apiGet<JukeboxHealthBody>(`${base}/api/health`)).body.suspended, false);

      // ...and the incoming source was still woken up.
      assert.ok(
        lifecycleCalls.some((call) => call.sourceId === "bluetooth" && call.suspended === false),
        "the selected source was woken even though the outgoing one failed",
      );

      await controller.setActiveSource("jukebox");
      assert.equal(
        mpvFactory.instances.length,
        1,
        "the jukebox never went to sleep, so nothing had to be restored",
      );
      assert.equal(mpv.running, true);
    },
  );
});
