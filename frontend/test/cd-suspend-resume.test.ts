import assert from "node:assert/strict";
import { test } from "node:test";
import { createSilentLogger } from "../shared/logger.js";
import type { CdConfig } from "../cd-service/config.js";
import type { DiscIdentity } from "../cd-service/disc.js";
import { DriveMonitor, type DriveSnapshot } from "../cd-service/drive.js";
import { CdPlayer } from "../cd-service/player.js";
import { CdService } from "../cd-service/service.js";
import type { CdState } from "../cd-service/types.js";
import { createFakeMpvFactory, type FakeMpvFactory } from "./fake-mpv.js";
import { apiGet, apiPost, waitFor } from "./support.js";

/** Drive watcher that never spawns udevadm; tests emit transitions directly. */
class ScriptedDriveMonitor extends DriveMonitor {
  override start(): void {
    /* no udev monitor, no fallback poll */
  }

  override stop(): void {
    /* nothing to tear down */
  }

  emitDrive(snapshot: DriveSnapshot): void {
    this.emit("changed", snapshot);
  }
}

const DEVICE = "/dev/sr0";
const CONFIG: CdConfig = { port: 0, device: null, mpvBinary: "/usr/bin/mpv" };

interface SuspendedBody {
  suspended: boolean;
  phase: string;
}

interface CdHealthBody {
  suspended: boolean;
  driveConnected: boolean;
  hasDisc: boolean;
  mpvAvailable: boolean;
}

interface CdContext {
  service: CdService;
  base: string;
  drive: ScriptedDriveMonitor;
  mpvFactory: FakeMpvFactory;
  /** Mutable: what the (fake) hardware reports on the next identification. */
  disc: { current: DiscIdentity | null };
}

async function withCdService(run: (ctx: CdContext) => Promise<void>): Promise<void> {
  const drive = new ScriptedDriveMonitor(null, createSilentLogger());
  const mpvFactory = createFakeMpvFactory();
  const disc: { current: DiscIdentity | null } = {
    current: { kind: "audio", discId: "disc-A", trackCount: 2 },
  };

  const service = new CdService(CONFIG, {
    logger: createSilentLogger(),
    createMpv: mpvFactory.createMpv,
    drive,
    identifyDisc: () => disc.current,
    settings: { autoSuspend: false },
    installProcessHandlers: false,
  });

  await service.start();
  try {
    await run({ service, base: `http://127.0.0.1:${service.port}`, drive, mpvFactory, disc });
  } finally {
    await service.stop();
  }
}

async function insertDisc(ctx: CdContext): Promise<void> {
  ctx.drive.emitDrive({ device: DEVICE, hasMedia: true });
  await waitFor(async () => (await apiGet<CdState>(`${ctx.base}/api/state`)).body.hasDisc, "disc load");
}

/* -------------------------------------------------------------------------- */
/* Player level                                                               */
/* -------------------------------------------------------------------------- */

test("suspend keeps the disc id and position, and drops the mpv process", async () => {
  const mpvFactory = createFakeMpvFactory();
  const player = new CdPlayer("/usr/bin/mpv", { createMpv: mpvFactory.createMpv });

  await player.loadAudioDisc(DEVICE, "disc-A", 2, null);
  await player.playFromStart();
  const mpv = mpvFactory.instances[0];
  mpv.emit("timeposition", 30);

  const snapshot = await player.suspend();

  assert.deepEqual(snapshot, {
    discId: "disc-A",
    trackIndex: 0,
    positionSeconds: 30,
    wasPlaying: true,
  });
  assert.equal(mpv.running, false);
  assert.equal(player.getState().discId, "disc-A", "state still describes the loaded disc");
  assert.equal(player.getState().isPlaying, false);
});

test("restoreSnapshot seeks back to the saved position on a freshly loaded disc", async () => {
  const mpvFactory = createFakeMpvFactory();
  const player = new CdPlayer("/usr/bin/mpv", { createMpv: mpvFactory.createMpv });

  await player.loadAudioDisc(DEVICE, "disc-A", 2, null);
  await player.playFromStart();
  mpvFactory.instances[0].emit("timeposition", 30);
  await player.suspend();

  // A new mpv is spawned and the disc is re-loaded by the caller.
  await player.loadAudioDisc(DEVICE, "disc-A", 2, null);
  assert.equal(await player.restoreSnapshot(), true);

  const restored = mpvFactory.instances[1];
  assert.deepEqual(restored.lastCall("seek")?.args, [30, "absolute"]);
  assert.equal(restored.callsTo("play").length, 1);
  assert.equal(player.getState().isPlaying, true);
  assert.equal(player.getSnapshot(), null);
});

/* -------------------------------------------------------------------------- */
/* Service level: disc identity decides resume vs reset                       */
/* -------------------------------------------------------------------------- */

test("resume with the same disc restores the track and position", async () => {
  await withCdService(async (ctx) => {
    await insertDisc(ctx);
    assert.equal((await apiGet<CdState>(`${ctx.base}/api/state`)).body.isPlaying, true);

    ctx.mpvFactory.instances[0].emit("timeposition", 45);

    const suspended = await apiPost<SuspendedBody>(`${ctx.base}/api/settings`, { suspended: true });
    assert.equal(suspended.body.phase, "suspended");
    assert.equal(ctx.mpvFactory.instances[0].running, false);

    const health = await apiGet<CdHealthBody>(`${ctx.base}/api/health`);
    assert.equal(health.body.suspended, true);
    assert.equal(health.body.hasDisc, true, "the disc is still described while suspended");
    assert.equal(health.body.mpvAvailable, false);

    const resumed = await apiPost<SuspendedBody>(`${ctx.base}/api/settings`, { suspended: false });

    assert.equal(resumed.body.phase, "running");
    assert.equal(ctx.mpvFactory.instances.length, 2);
    assert.deepEqual(ctx.mpvFactory.instances[1].lastCall("seek")?.args, [45, "absolute"]);

    const state = await apiGet<CdState>(`${ctx.base}/api/state`);
    assert.equal(state.body.discId, "disc-A");
    assert.equal(state.body.isPlaying, true);
  });
});

test("resume after the disc was swapped resets instead of seeking into the old stream", async () => {
  await withCdService(async (ctx) => {
    await insertDisc(ctx);
    ctx.mpvFactory.instances[0].emit("timeposition", 45);
    await apiPost(`${ctx.base}/api/settings`, { suspended: true });

    // The disc is ejected and another one is inserted while suspended.
    ctx.disc.current = { kind: "audio", discId: "disc-B", trackCount: 3 };
    ctx.drive.emitDrive({ device: DEVICE, hasMedia: false });
    ctx.drive.emitDrive({ device: DEVICE, hasMedia: true });

    // Suspended services ignore drive events: nothing was loaded behind our back.
    assert.equal(ctx.mpvFactory.instances.length, 1);

    const resumed = await apiPost<SuspendedBody>(`${ctx.base}/api/settings`, { suspended: false });
    assert.equal(resumed.body.phase, "running");

    await waitFor(
      async () => (await apiGet<CdState>(`${ctx.base}/api/state`)).body.discId === "disc-B",
      "the new disc to be loaded",
    );

    const state = await apiGet<CdState>(`${ctx.base}/api/state`);
    assert.equal(state.body.discId, "disc-B");
    assert.equal(state.body.tracks.length, 3);
    assert.equal(state.body.isPlaying, true, "the new disc autoplays");
    // The stale position from disc-A must never be seeked into disc-B.
    assert.equal(ctx.mpvFactory.instances.length, 2);
    assert.equal(ctx.mpvFactory.instances[1].callsTo("seek").length, 0);
  });
});

test("resume with an empty drive resets the service", async () => {
  await withCdService(async (ctx) => {
    await insertDisc(ctx);
    await apiPost(`${ctx.base}/api/settings`, { suspended: true });

    ctx.drive.emitDrive({ device: DEVICE, hasMedia: false });
    await apiPost(`${ctx.base}/api/settings`, { suspended: false });

    const state = await apiGet<CdState>(`${ctx.base}/api/state`);
    assert.equal(state.body.hasDisc, false);
    assert.equal(state.body.discId, null);
  });
});
