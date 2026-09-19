import assert from "node:assert/strict";
import { test } from "node:test";
import { createSilentLogger } from "../shared/logger.js";
import {
  BaseMediaService,
  HttpError,
  requireMethod,
  sendJson,
  type RouteContext,
  type RouteTable,
  type ServiceSettings,
} from "../shared/service-http.js";
import { apiGet, apiPost, sleep, waitFor } from "./support.js";

interface ProbeState {
  count: number;
}

interface SettingsBody {
  settings: ServiceSettings;
  phase: string;
  suspended: boolean;
}

interface HealthBody {
  ok: boolean;
  service: string;
  phase: string;
  suspended: boolean;
  clients: number;
  probe?: boolean;
}

/** Smallest possible concrete service: exercises the shared runtime only. */
class ProbeService extends BaseMediaService<ProbeState> {
  count = 0;
  suspendCalls = 0;
  resumeCalls = 0;
  activityCalls = 0;

  constructor(settings?: Partial<ServiceSettings>) {
    super({
      name: "probe",
      port: 0, // ephemeral: tests never collide on a fixed port
      logger: createSilentLogger(),
      settings: { autoSuspend: false, ...settings },
      installProcessHandlers: false,
    });
  }

  protected getState(): ProbeState {
    return { count: this.count };
  }

  protected onSuspend(): void {
    this.suspendCalls += 1;
  }

  protected onResume(): void {
    this.resumeCalls += 1;
  }

  protected onActivity(): void {
    this.activityCalls += 1;
  }

  protected healthDetails(): Record<string, unknown> {
    return { probe: true };
  }

  protected createRoutes(): RouteTable {
    return {
      bump: (ctx) => this.handleBump(ctx),
      boom: () => {
        throw new Error("kaboom");
      },
      bad: () => {
        throw new HttpError(418, "teapot");
      },
    };
  }

  private async handleBump(ctx: RouteContext): Promise<void> {
    requireMethod(ctx, "POST");
    this.count += 1;
    this.broadcast();
    sendJson(ctx.res, 200, this.getState());
  }
}

async function withService<T>(
  settings: Partial<ServiceSettings> | undefined,
  run: (service: ProbeService, base: string) => Promise<T>,
): Promise<T> {
  const service = new ProbeService(settings);
  await service.start();
  try {
    return await run(service, `http://127.0.0.1:${service.port}`);
  } finally {
    await service.stop();
  }
}

test("serves the four shared endpoints", async () => {
  await withService(undefined, async (service, base) => {
    const health = await apiGet<HealthBody>(`${base}/api/health`);
    assert.equal(health.status, 200);
    assert.equal(health.body.ok, true);
    assert.equal(health.body.service, "probe");
    assert.equal(health.body.phase, "running");
    assert.equal(health.body.suspended, false);
    assert.equal(health.body.clients, 0);
    assert.equal(health.body.probe, true);

    const state = await apiGet<ProbeState>(`${base}/api/state`);
    assert.deepEqual(state.body, { count: 0 });

    const settings = await apiGet<SettingsBody>(`${base}/api/settings`);
    assert.equal(settings.status, 200);
    assert.deepEqual(settings.body.settings, { autoSuspend: false, idleTimeoutMs: 60_000 });

    assert.equal(service.port > 0, true, "ephemeral port is reported back");
  });
});

test("returns 404 for unknown routes and 405 for the wrong method", async () => {
  await withService(undefined, async (_service, base) => {
    assert.equal((await apiGet(`${base}/api/nope`)).status, 404);
    assert.equal((await apiGet(`${base}/`)).status, 404);
    assert.equal((await apiGet(`${base}/api/bump`)).status, 405);
    assert.equal((await apiPost(`${base}/api/unknown`, {})).status, 404);

    const preflight = await fetch(`${base}/api/bump`, { method: "OPTIONS" });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get("access-control-allow-origin"), "*");
  });
});

test("the CORS preflight advertises PATCH", async () => {
  // PATCH is not a CORS-simple method, so the browser preflights it. In
  // `npm run dev` the renderer (:5173) and a service (:4xxx) are different
  // origins, so a missing allow-method makes every settings write fail there
  // while tests over direct fetch keep passing — hence this explicit guard.
  await withService(undefined, async (_service, base) => {
    const preflight = await fetch(`${base}/api/values/anything`, {
      method: "OPTIONS",
      headers: { "Access-Control-Request-Method": "PATCH" },
    });
    assert.equal(preflight.status, 204);

    const allowed = (preflight.headers.get("access-control-allow-methods") ?? "")
      .split(",")
      .map((method) => method.trim().toUpperCase());
    assert.ok(allowed.includes("PATCH"), `PATCH missing from "${allowed.join(", ")}"`);
    assert.equal(preflight.headers.get("access-control-allow-headers"), "Content-Type");
  });
});

test("maps thrown errors onto status codes", async () => {
  await withService(undefined, async (_service, base) => {
    const boom = await apiPost<{ error: string }>(`${base}/api/boom`, {});
    assert.equal(boom.status, 500);
    assert.equal(boom.body.error, "kaboom");

    const bad = await apiPost<{ error: string }>(`${base}/api/bad`, {});
    assert.equal(bad.status, 418);
    assert.equal(bad.body.error, "teapot");
  });
});

test("validates /api/settings payloads before applying them", async () => {
  await withService(undefined, async (_service, base) => {
    assert.equal((await apiPost(`${base}/api/settings`, { autoSuspend: "yes" })).status, 400);
    assert.equal((await apiPost(`${base}/api/settings`, { idleTimeoutMs: -1 })).status, 400);
    assert.equal((await apiPost(`${base}/api/settings`, { suspended: "nope" })).status, 400);

    // A rejected request must not have applied the valid half of the patch.
    const rejected = await apiPost<SettingsBody>(`${base}/api/settings`, {
      autoSuspend: true,
      idleTimeoutMs: -5,
    });
    assert.equal(rejected.status, 400);
    const settings = await apiGet<SettingsBody>(`${base}/api/settings`);
    assert.equal(settings.body.settings.autoSuspend, false);

    const ok = await apiPost<SettingsBody>(`${base}/api/settings`, {
      autoSuspend: true,
      idleTimeoutMs: 1234,
    });
    assert.equal(ok.status, 200);
    assert.deepEqual(ok.body.settings, { autoSuspend: true, idleTimeoutMs: 1234 });
  });
});

test("suspends and resumes, and a mutating request wakes the service", async () => {
  await withService(undefined, async (service, base) => {
    const suspended = await apiPost<SettingsBody>(`${base}/api/settings`, { suspended: true });
    assert.equal(suspended.body.suspended, true);
    assert.equal(suspended.body.phase, "suspended");
    assert.equal(service.suspendCalls, 1);

    const again = await apiPost<SettingsBody>(`${base}/api/settings`, { suspended: true });
    assert.equal(again.body.suspended, true);
    assert.equal(service.suspendCalls, 1, "suspend is idempotent");

    // Health/state polling must never wake a suspended service up.
    const health = await apiGet<HealthBody>(`${base}/api/health`);
    assert.equal(health.body.suspended, true);
    assert.equal((await apiGet<ProbeState>(`${base}/api/state`)).status, 200);
    assert.equal(service.resumeCalls, 0);

    const bump = await apiPost<ProbeState>(`${base}/api/bump`, {});
    assert.equal(bump.status, 200);
    assert.deepEqual(bump.body, { count: 1 });
    assert.equal(service.resumeCalls, 1);
    assert.equal(service.currentPhase, "running");
    assert.equal(service.activityCalls, 1);

    // Explicit resume while already running is a no-op.
    const running = await apiPost<SettingsBody>(`${base}/api/settings`, { suspended: false });
    assert.equal(running.body.suspended, false);
    assert.equal(service.resumeCalls, 1);
  });
});

test("streams state frames over SSE", async () => {
  await withService(undefined, async (_service, base) => {
    const response = await fetch(`${base}/api/events`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "text/event-stream");
    assert.ok(response.body);

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    const initial = await reader.read();
    assert.equal(decoder.decode(initial.value), 'data: {"count":0}\n\n');

    await apiPost(`${base}/api/bump`, {});

    const update = await reader.read();
    assert.equal(decoder.decode(update.value), 'data: {"count":1}\n\n');

    await reader.cancel();
  });
});

test("auto-suspends when idle and stays awake while a client is attached", async () => {
  await withService({ autoSuspend: true, idleTimeoutMs: 60 }, async (service, base) => {
    await waitFor(() => service.suspended, "idle auto-suspend", 3000);
    assert.equal(service.suspendCalls, 1);

    await service.resume();

    const response = await fetch(`${base}/api/events`);
    assert.ok(response.body);
    const reader = response.body.getReader();
    await reader.read(); // initial frame

    // Several idle windows pass while the subscriber is attached.
    await sleep(250);
    assert.equal(service.suspended, false, "a connected client keeps the service up");

    await reader.cancel();
    await waitFor(() => service.suspended, "auto-suspend after the client left", 3000);
  });
});

test("stop() releases the port and reports the stopped phase", async () => {
  const service = new ProbeService();
  await service.start();
  const base = `http://127.0.0.1:${service.port}`;
  assert.equal((await apiGet<ProbeState>(`${base}/api/state`)).status, 200);

  await service.stop();
  assert.equal(service.currentPhase, "stopped");
  await assert.rejects(fetch(`${base}/api/state`));
});
