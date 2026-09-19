import http from "node:http";
import { createLogger, errorMessage, type Logger } from "./logger.js";

/* -------------------------------------------------------------------------- */
/* HTTP primitives                                                            */
/* -------------------------------------------------------------------------- */

export const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  // PATCH is listed because the Settings service writes with PATCH, which is not
  // a CORS-simple method: the browser preflights it. In `npm run dev` the
  // renderer (Vite, :5173) is a different origin from the service (:4400), so
  // omitting PATCH here silently broke every settings write in browser dev.
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

/**
 * Error carrying the HTTP status it should be reported with.
 *
 * Route handlers `throw` these instead of writing responses by hand, which is
 * what lets the shared router own every error response in one place.
 */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export function sendJson(
  res: http.ServerResponse,
  status: number,
  body: unknown,
): void {
  if (res.headersSent) return;
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    ...CORS_HEADERS,
  });
  res.end(JSON.stringify(body));
}

export function sendNotFound(res: http.ServerResponse): void {
  sendJson(res, 404, { error: "Not found" });
}

export function readJsonBody(
  req: http.IncomingMessage,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.setEncoding("utf8");
    req.on("data", (chunk: string) => {
      data += chunk;
    });
    req.on("end", () => {
      if (!data) {
        resolve({});
        return;
      }
      try {
        const parsed: unknown = JSON.parse(data);
        if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
          reject(new HttpError(400, "JSON body must be an object"));
          return;
        }
        resolve(parsed as Record<string, unknown>);
      } catch {
        reject(new HttpError(400, "Invalid JSON body"));
      }
    });
    req.on("error", (error) => reject(error));
  });
}

/* -------------------------------------------------------------------------- */
/* Routing                                                                    */
/* -------------------------------------------------------------------------- */

export interface RouteContext {
  readonly req: http.IncomingMessage;
  readonly res: http.ServerResponse;
  readonly url: URL;
  /** Path segments, e.g. `/api/artwork/al_x` -> ["api", "artwork", "al_x"]. */
  readonly parts: readonly string[];
  readonly method: string;
  /** Lazily parsed JSON body (memoised per request). */
  body(): Promise<Record<string, unknown>>;
}

export type RouteHandler = (ctx: RouteContext) => void | Promise<void>;
export type RouteTable = Record<string, RouteHandler>;

/** Throws a 405 unless the request used `method`. */
export function requireMethod(ctx: RouteContext, method: string): void {
  if (ctx.method !== method) throw new HttpError(405, `${method} required`);
}

/** Reads a required non-empty string field, or throws a 400. */
export function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new HttpError(400, `Invalid ${field}`);
  }
  return value;
}

/** Reads a required finite number field, or throws a 400. */
export function requireNumber(value: unknown, field: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new HttpError(400, `Invalid ${field}`);
  return parsed;
}

/** Reads a required integer field (`min` inclusive), or throws a 400. */
export function requireInteger(value: unknown, field: string, min = 0): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min) {
    throw new HttpError(400, `Invalid ${field}`);
  }
  return parsed;
}

/** Reads a required boolean field, or throws a 400. */
export function requireBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") throw new HttpError(400, `${field} must be a boolean`);
  return value;
}

/* -------------------------------------------------------------------------- */
/* Server-sent events                                                         */
/* -------------------------------------------------------------------------- */

export interface SseHub<T> {
  broadcast(state: T): void;
  /** Registers a subscriber. Disconnection is detected on the response. */
  addClient(res: http.ServerResponse, initialState: T): void;
  clientCount(): number;
  closeAll(): void;
}

export function createSseHub<T>(
  onClientCountChange?: (count: number) => void,
): SseHub<T> {
  const clients = new Set<http.ServerResponse>();
  const notify = (): void => onClientCountChange?.(clients.size);

  return {
    broadcast(state: T): void {
      if (clients.size === 0) return; // no subscribers -> no stringify, no write
      const payload = `data: ${JSON.stringify(state)}\n\n`;
      for (const client of clients) client.write(payload);
    },
    addClient(res: http.ServerResponse, initialState: T): void {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        ...CORS_HEADERS,
      });
      res.write(`data: ${JSON.stringify(initialState)}\n\n`);
      clients.add(res);
      notify();
      // The RESPONSE closing is what means "subscriber gone". Listening on the
      // request instead would drop the client as soon as the request stream is
      // drained (GET requests have no body), i.e. immediately.
      res.on("close", () => {
        clients.delete(res);
        notify();
      });
    },
    clientCount: (): number => clients.size,
    closeAll(): void {
      for (const client of clients) client.end();
      clients.clear();
      notify();
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Service lifecycle types                                                    */
/* -------------------------------------------------------------------------- */

export type ServicePhase = "starting" | "running" | "suspended" | "stopping" | "stopped";

export type SuspendReason = "manual" | "idle" | "settings" | "shutdown";
export type ResumeReason = "manual" | "settings" | "request";

export interface ServiceSettings {
  /** Suspend automatically once the service has been idle for `idleTimeoutMs`. */
  autoSuspend: boolean;
  /** Idle window before auto-suspend. 0 disables the timer. */
  idleTimeoutMs: number;
}

export const DEFAULT_SERVICE_SETTINGS: ServiceSettings = {
  autoSuspend: true,
  idleTimeoutMs: 60_000,
};

/** `SERVICE_AUTO_SUSPEND=0` / `SERVICE_IDLE_TIMEOUT_MS=30000` process defaults. */
export function settingsFromEnv(env: NodeJS.ProcessEnv = process.env): ServiceSettings {
  const rawAuto = env.SERVICE_AUTO_SUSPEND;
  const rawIdle = Number(env.SERVICE_IDLE_TIMEOUT_MS);
  return {
    autoSuspend:
      rawAuto == null ? DEFAULT_SERVICE_SETTINGS.autoSuspend : rawAuto !== "0" && rawAuto !== "false",
    idleTimeoutMs:
      Number.isFinite(rawIdle) && rawIdle >= 0
        ? Math.round(rawIdle)
        : DEFAULT_SERVICE_SETTINGS.idleTimeoutMs,
  };
}

export interface ServiceHealth {
  ok: boolean;
  service: string;
  phase: ServicePhase;
  suspended: boolean;
  uptimeSeconds: number;
  clients: number;
  [detail: string]: unknown;
}

export interface SettingsPayload {
  ok: boolean;
  settings: ServiceSettings;
  phase: ServicePhase;
  suspended: boolean;
}

export interface BaseMediaServiceOptions {
  /** Service id, used in logs and `/api/health`. */
  name: string;
  port: number;
  host?: string;
  /** Overrides {@link settingsFromEnv}. */
  settings?: Partial<ServiceSettings>;
  logger?: Logger;
  /** Install SIGTERM/SIGINT + process fault handlers. Disable in tests. */
  installProcessHandlers?: boolean;
  /** Log every request line (handy for D-Bus/hardware debugging). */
  logRequests?: boolean;
}

/** Listen retry budget when the port is momentarily taken by a dev instance. */
const LISTEN_RETRY_MS = 3000;
const LISTEN_MAX_RETRIES = 10;
/** Grace period between SIGTERM and a forced exit. */
const SHUTDOWN_GRACE_MS = 5000;

/* -------------------------------------------------------------------------- */
/* Base service                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Shared host-service runtime: native `http` server, SSE fan-out, generic
 * routing, graceful shutdown, process fault tolerance and the
 * running ⇄ suspended state machine.
 *
 * Subclasses implement {@link BaseMediaService.createRoutes} (service-specific
 * endpoints), {@link BaseMediaService.getState} (the SSE payload) and the
 * suspend/resume hooks that snapshot and free their own resources.
 *
 * Built-in endpoints, identical on every service:
 *   GET  /api/health    — phase, suspension flag, uptime, subclass details
 *   GET  /api/state     — service state (also the SSE initial frame)
 *   GET  /api/events    — SSE stream of state frames
 *   GET  /api/settings  — current settings
 *   POST /api/settings  — { autoSuspend?, idleTimeoutMs?, suspended? }
 */
export abstract class BaseMediaService<TState> {
  protected readonly logger: Logger;
  protected readonly settings: ServiceSettings;

  private readonly options: BaseMediaServiceOptions;
  private readonly sse: SseHub<TState>;
  private startedAt = 0;
  private server: http.Server | null = null;
  private routes: RouteTable | null = null;
  private idleTimer: NodeJS.Timeout | null = null;
  private transitions: Promise<unknown> = Promise.resolve();
  private phase: ServicePhase = "stopped";
  private closing = false;

  constructor(options: BaseMediaServiceOptions) {
    this.options = options;
    this.logger = options.logger ?? createLogger(options.name);
    this.settings = { ...settingsFromEnv(), ...options.settings };
    this.sse = createSseHub<TState>((count) => this.onClientCountChanged(count));
  }

  /** Service id as reported by `/api/health`. */
  get name(): string {
    return this.options.name;
  }

  /** The port actually bound (resolves `0` to the ephemeral port). */
  get port(): number {
    const address = this.server?.address();
    return typeof address === "object" && address !== null ? address.port : this.options.port;
  }

  get currentPhase(): ServicePhase {
    return this.phase;
  }

  get suspended(): boolean {
    return this.phase === "suspended";
  }

  /* ----------------------------- lifecycle ------------------------------- */

  /**
   * Binds the HTTP server first, then runs the subclass startup hook: a
   * broken hardware dependency (no BlueZ, no mpv, no drive) must never make
   * `/api/health` unreachable.
   */
  async start(): Promise<void> {
    if (this.server) return;
    if (this.options.installProcessHandlers !== false) this.installProcessHandlers();

    this.phase = "starting";
    const server = http.createServer((req, res) => {
      void this.dispatch(req, res);
    });
    server.requestTimeout = 0; // SSE responses are never "done"
    this.server = server;

    await this.listen(this.options.port);
    server.on("error", (error) => this.logger.error("server error:", errorMessage(error)));

    this.startedAt = Date.now();
    this.phase = "running";
    this.logger.log(`listening on http://${this.options.host ?? "127.0.0.1"}:${this.port}`);

    try {
      await this.onStart();
    } catch (error) {
      this.logger.error("startup error (staying up so /api/health can report it):", errorMessage(error));
    }
    this.armIdleTimer();
  }

  /** Graceful teardown: stop accepting, close SSE, release subclass resources. */
  async stop(): Promise<void> {
    if (this.closing) return;
    this.closing = true;
    this.phase = "stopping";
    this.clearIdleTimer();
    this.sse.closeAll();

    try {
      await this.onStop();
    } catch (error) {
      this.logger.error("shutdown error:", errorMessage(error));
    }

    const server = this.server;
    this.server = null;
    if (server) {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      });
    }

    this.startedAt = 0;
    this.phase = "stopped";
    this.closing = false;
  }

  /* -------------------------- suspend / resume --------------------------- */

  /**
   * Frees resources (mpv process, timers, ...) while keeping a small in-RAM
   * snapshot so {@link resume} can restore playback. Idempotent: a second call
   * while suspended does nothing and the transition is serialised against
   * concurrent resumes.
   */
  suspend(reason: SuspendReason = "manual"): Promise<boolean> {
    return this.enqueueTransition(async () => {
      if (this.phase !== "running") return false;
      this.phase = "suspended";
      this.clearIdleTimer();
      try {
        await this.onSuspend();
      } catch (error) {
        this.logger.error(`suspend failed (${reason}):`, errorMessage(error));
      }
      this.logger.log(`suspended (${reason})`);
      this.broadcast();
      return true;
    });
  }

  resume(reason: ResumeReason = "manual"): Promise<boolean> {
    return this.enqueueTransition(async () => {
      if (this.phase !== "suspended") return false;
      this.phase = "running";
      try {
        await this.onResume();
      } catch (error) {
        this.logger.error(`resume failed (${reason}):`, errorMessage(error));
      }
      this.logger.log(`resumed (${reason})`);
      this.touch();
      this.broadcast();
      return true;
    });
  }

  /* ------------------------------ subclass API --------------------------- */

  /** Current service state; also the payload of `/api/state` and SSE frames. */
  protected abstract getState(): TState;

  /** Extra `/api/<route>` handlers merged under the built-in endpoints. */
  protected abstract createRoutes(): RouteTable;

  /** Startup hook, after the HTTP server is already accepting connections. */
  protected onStart(): void | Promise<void> {
    /* optional */
  }

  /** Teardown hook, before the HTTP server is closed. */
  protected onStop(): void | Promise<void> {
    /* optional */
  }

  /**
   * Capture the RAM snapshot and release resources held while active. The
   * reason is logged by {@link suspend}; subclasses only need to act.
   */
  protected onSuspend(): void | Promise<void> {
    /* optional */
  }

  /** Restore from the RAM snapshot captured by `onSuspend`. */
  protected onResume(): void | Promise<void> {
    /* optional */
  }

  /** Extra fields merged into `/api/health` (hardware availability, ...). */
  protected healthDetails(): Record<string, unknown> {
    return {};
  }

  /** True while the service must not auto-suspend (audio still playing). */
  protected isBusy(): boolean {
    return false;
  }

  /** Called on mutating requests and new SSE subscribers; never on polls. */
  protected onActivity(): void {
    /* optional */
  }

  /** Pushes the current state to every SSE subscriber. */
  protected broadcast(): void {
    this.sse.broadcast(this.getState());
  }

  /* -------------------------------- routing ------------------------------ */

  private get routeTable(): RouteTable {
    this.routes ??= this.createRoutes();
    return this.routes;
  }

  private async dispatch(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    if (req.method === "OPTIONS") {
      res.writeHead(204, CORS_HEADERS);
      res.end();
      return;
    }

    let url: URL;
    try {
      url = new URL(req.url ?? "/", "http://127.0.0.1");
    } catch {
      sendNotFound(res);
      return;
    }

    const parts = url.pathname.split("/").filter(Boolean);
    const route = parts[0] === "api" ? (parts[1] ?? "") : "";
    if (this.options.logRequests && route !== "events") {
      this.logger.log(`${req.method ?? "GET"} ${url.pathname}`);
    }

    const body = memoizedBody(req);
    const ctx: RouteContext = {
      req,
      res,
      url,
      parts,
      method: req.method ?? "GET",
      body,
    };

    try {
      if (parts[0] !== "api" || !route) {
        sendNotFound(res);
        return;
      }

      switch (route) {
        case "health":
          sendJson(res, 200, this.healthPayload());
          return;
        case "state":
          sendJson(res, 200, this.getState());
          return;
        case "events":
          this.sse.addClient(res, this.getState());
          return;
        case "settings":
          await this.handleSettings(ctx);
          return;
        default:
          break;
      }

      const handler = this.routeTable[route];
      if (!handler) {
        sendNotFound(res);
        return;
      }

      // Any mutating request wakes a suspended service up first: the renderer
      // can hit "play" on a suspended source and get the expected result.
      if (ctx.method !== "GET" && ctx.method !== "HEAD") {
        await this.resume("request");
        this.touch();
        this.onActivity();
      }
      await handler(ctx);
    } catch (error) {
      if (error instanceof HttpError) {
        sendJson(res, error.status, { error: error.message });
        return;
      }
      this.logger.error(`${ctx.method} ${url.pathname} failed:`, errorMessage(error));
      sendJson(res, 500, { error: errorMessage(error) });
    } finally {
      // A handler that ignores the body must not leave it unread on a
      // keep-alive socket, otherwise the next request on that connection stalls.
      req.resume();
    }
  }

  private healthPayload(): ServiceHealth {
    return {
      ok: true,
      service: this.options.name,
      phase: this.phase,
      suspended: this.suspended,
      uptimeSeconds: this.startedAt > 0 ? Math.round((Date.now() - this.startedAt) / 1000) : 0,
      clients: this.sse.clientCount(),
      ...this.healthDetails(),
    };
  }

  private settingsPayload(): SettingsPayload {
    return {
      ok: true,
      settings: { ...this.settings },
      phase: this.phase,
      suspended: this.suspended,
    };
  }

  private async handleSettings(ctx: RouteContext): Promise<void> {
    if (ctx.method === "GET" || ctx.method === "HEAD") {
      sendJson(ctx.res, 200, this.settingsPayload());
      return;
    }
    requireMethod(ctx, "POST");

    const body = await ctx.body();
    const patch: Partial<ServiceSettings> = {};
    let forced: boolean | null = null;

    // Validate everything before mutating anything: a rejected request must
    // not leave the settings half-applied.
    if ("autoSuspend" in body) {
      patch.autoSuspend = requireBoolean(body.autoSuspend, "autoSuspend");
    }
    if ("idleTimeoutMs" in body) {
      const idle = Number(body.idleTimeoutMs);
      if (!Number.isFinite(idle) || idle < 0) {
        throw new HttpError(400, "idleTimeoutMs must be a non-negative number");
      }
      patch.idleTimeoutMs = Math.round(idle);
    }
    if ("suspended" in body) {
      forced = requireBoolean(body.suspended, "suspended");
    }

    Object.assign(this.settings, patch);

    if (forced === true) await this.suspend("settings");
    else if (forced === false) await this.resume("settings");
    else this.armIdleTimer();

    sendJson(ctx.res, 200, this.settingsPayload());
  }

  /* ------------------------------ idle timer ----------------------------- */

  /**
   * Re-arms the auto-suspend timer. Only *activity* calls this: `/api/health`
   * and `/api/state` polls deliberately do not, otherwise the 5s renderer
   * health poll would keep every service awake forever.
   */
  private touch(): void {
    if (!this.settings.autoSuspend || this.phase !== "running") return;
    this.armIdleTimer();
  }

  private armIdleTimer(): void {
    this.clearIdleTimer();
    if (!this.settings.autoSuspend || this.phase !== "running") return;
    if (this.settings.idleTimeoutMs <= 0) return;
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      void this.onIdle();
    }, this.settings.idleTimeoutMs);
    this.idleTimer.unref(); // never keep the process alive just for this
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }

  private async onIdle(): Promise<void> {
    if (this.phase !== "running") return;
    if (this.sse.clientCount() > 0 || this.isBusy()) {
      this.armIdleTimer(); // someone is watching or listening: stay up
      return;
    }
    await this.suspend("idle");
  }

  private onClientCountChanged(count: number): void {
    if (count > 0) {
      this.clearIdleTimer();
      this.onActivity();
      return;
    }
    this.touch();
  }

  /* ------------------------------- plumbing ------------------------------ */

  private enqueueTransition<T>(task: () => Promise<T>): Promise<T> {
    const result = this.transitions.then(task, task);
    this.transitions = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private listen(port: number, attempt = 0): Promise<void> {
    const server = this.server;
    if (!server) return Promise.reject(new Error("server not created"));

    return new Promise<void>((resolve, reject) => {
      const onError = (error: NodeJS.ErrnoException): void => {
        server.off("listening", onListening);
        if (error.code === "EADDRINUSE" && attempt < LISTEN_MAX_RETRIES) {
          this.logger.warn(
            `port ${port} in use (another ${this.options.name}-service running?) — retry ${attempt + 1}/${LISTEN_MAX_RETRIES}`,
          );
          setTimeout(() => {
            this.listen(port, attempt + 1).then(resolve, reject);
          }, LISTEN_RETRY_MS).unref();
          return;
        }
        reject(error);
      };
      const onListening = (): void => {
        server.off("error", onError);
        resolve();
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(port, this.options.host ?? "127.0.0.1");
    });
  }

  /**
   * An infotainment appliance must not die on a stray rejection bubbling out
   * of a dependency (e.g. node-mpv IPC races while mpv is quitting): log and
   * stay alive. Listen failures are excluded from this — a zombie without an
   * HTTP listener would control nothing, so `start()` still rejects.
   */
  private installProcessHandlers(): void {
    process.on("unhandledRejection", (reason) => {
      this.logger.error(
        "unhandled rejection (ignored):",
        reason instanceof Error ? (reason.stack ?? reason.message) : reason,
      );
    });
    process.on("uncaughtException", (error) => {
      this.logger.error("uncaught exception (ignored):", error.stack ?? error.message);
    });

    const shutdown = (signal: NodeJS.Signals): void => {
      this.logger.log(`${signal} received — shutting down`);
      const force = setTimeout(() => process.exit(1), SHUTDOWN_GRACE_MS);
      force.unref();
      void this.stop().finally(() => process.exit(0));
    };
    process.once("SIGTERM", () => shutdown("SIGTERM"));
    process.once("SIGINT", () => shutdown("SIGINT"));
  }
}

/** Per-request body parse, shared by every handler that reads it. */
function memoizedBody(
  req: http.IncomingMessage,
): () => Promise<Record<string, unknown>> {
  let pending: Promise<Record<string, unknown>> | null = null;
  return () => (pending ??= readJsonBody(req));
}
