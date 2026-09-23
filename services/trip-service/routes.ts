/**
 * HTTP routes for the trip service.
 *
 * Handlers stay thin on purpose: they validate, delegate to the engine or the
 * query service, and hand back what those return. Nothing here computes a metric
 * — that is the whole point of the split, because a route that "just adjusts a
 * number" is how the backend stops being the single source of truth.
 *
 * Errors are thrown as `HttpError` and rendered by the shared router, per the
 * house convention: no handler writes an error body itself.
 */

import {
  HttpError,
  requireBoolean,
  requireInteger,
  requireMethod,
  requireNumber,
  requireString,
  sendJson,
  type RouteContext,
  type RouteTable,
} from "../shared/service-http.js";
import { isPeriodPreset, type PeriodPreset } from "./trip/buckets.js";
import type { BucketGranularity } from "./types.js";
import type { TripQueryService } from "./query.js";
import type { TripEngine } from "./trip/engine.js";
import type { TripStore } from "./store/store.js";
import type { TripPreferences } from "./types.js";
import {
  SCENARIOS,
  DriveSimulator,
  isScenarioId,
  scenarioDurationMs,
  type SimulationScenarioId,
} from "./telemetry/simulator.js";

export interface TripRouteDeps {
  store: TripStore;
  query: TripQueryService;
  engine: TripEngine;
  /** The live simulator, or `null` when running without one. */
  simulator: () => DriveSimulator | null;
  setSimulator: (simulator: DriveSimulator | null) => void;
  devMode: boolean;
  preferences: () => TripPreferences;
  /** Price the dev seed confirms generated refuels with. */
  defaultFuelPrice: number;
  currency: string;
  broadcast: () => void;
  logger: { log(message: string): void; warn(message: string): void };
}

/* ------------------------------ query parsing ------------------------------ */

function optionalTimestamp(ctx: RouteContext, key: string): number | undefined {
  const raw = ctx.url.searchParams.get(key);
  if (raw === null || raw === "") return undefined;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new HttpError(400, `${key} must be an epoch millisecond timestamp`);
  }
  return parsed;
}

function readPreset(ctx: RouteContext): PeriodPreset | undefined {
  const raw = ctx.url.searchParams.get("preset");
  if (raw === null || raw === "") return undefined;
  if (!isPeriodPreset(raw)) throw new HttpError(400, `unknown period preset "${raw}"`);
  return raw;
}

function readGranularity(ctx: RouteContext): BucketGranularity | undefined {
  const raw = ctx.url.searchParams.get("granularity");
  if (raw === null || raw === "") return undefined;
  if (raw !== "hour" && raw !== "day" && raw !== "week") {
    throw new HttpError(400, `unknown granularity "${raw}"`);
  }
  return raw;
}

function readRange(ctx: RouteContext): { from?: number; to?: number } {
  const from = optionalTimestamp(ctx, "from");
  const to = optionalTimestamp(ctx, "to");
  if ((from === undefined) !== (to === undefined)) {
    throw new HttpError(400, "from and to must be provided together");
  }
  if (from !== undefined && to !== undefined && to <= from) {
    throw new HttpError(400, "to must be after from");
  }
  return { from, to };
}

function integerParam(ctx: RouteContext, key: string, fallback: number): number {
  const raw = ctx.url.searchParams.get(key);
  if (raw === null || raw === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new HttpError(400, `${key} must be a non-negative integer`);
  }
  return parsed;
}

/** `/api/trips/:id` and deeper paths. */
function tripIdFrom(ctx: RouteContext, index = 2): number {
  const raw = ctx.parts[index];
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, `invalid trip id "${raw ?? ""}"`);
  return id;
}

function requireTrip(deps: TripRouteDeps, id: number) {
  const trip = deps.store.getTrip(id);
  if (!trip) throw new HttpError(404, `trip ${id} not found`);
  return trip;
}

/* --------------------------------- routes ---------------------------------- */

export function createTripRoutes(deps: TripRouteDeps): RouteTable {
  const routes: RouteTable = {
    /* --------------------------- trip computer --------------------------- */

    periods: (ctx) => {
      requireMethod(ctx, "GET");
      sendJson(ctx.res, 200, { periods: deps.query.periods() });
    },

    summary: (ctx) => {
      requireMethod(ctx, "GET");
      const range = readRange(ctx);
      const preset = readPreset(ctx);
      sendJson(ctx.res, 200, deps.query.summary(deps.preferences(), { ...range, preset }));
    },

    series: (ctx) => {
      requireMethod(ctx, "GET");
      const range = readRange(ctx);
      const preset = readPreset(ctx);
      const granularity = readGranularity(ctx);
      sendJson(ctx.res, 200, deps.query.series({ ...range, preset, granularity }));
    },

    /* ---------------------------- trip history --------------------------- */

    trips: (ctx) => {
      // `/api/trips` is the collection; deeper paths are handled by the
      // dedicated route keys below, so this one only accepts the collection and
      // the two write verbs from the spec.
      const sub = ctx.parts[2];

      if (sub === undefined) {
        requireMethod(ctx, "GET");
        const limit = Math.min(integerParam(ctx, "limit", 50), 500);
        const offset = integerParam(ctx, "offset", 0);
        const range = readRange(ctx);
        sendJson(ctx.res, 200, deps.query.listTrips({ limit, offset, ...range }));
        return;
      }

      if (sub === "merge") {
        requireMethod(ctx, "POST");
        return handleMerge(ctx, deps);
      }

      // `/api/trips/<id>`
      const id = tripIdFrom(ctx);
      if (ctx.parts[3] === undefined) {
        requireMethod(ctx, "GET");
        const detail = deps.query.tripDetail(id);
        if (!detail) throw new HttpError(404, `trip ${id} not found`);
        sendJson(ctx.res, 200, detail);
        return;
      }

      if (ctx.parts[3] === "coordinates") {
        requireMethod(ctx, "GET");
        requireTrip(deps, id);
        sendJson(ctx.res, 200, deps.query.tripCoordinates(id));
        return;
      }

      if (ctx.parts[3] === "split") {
        requireMethod(ctx, "POST");
        return handleSplit(ctx, deps, id);
      }

      throw new HttpError(404, `unknown trips sub-resource "${ctx.parts[3]}"`);
    },

    /* -------------------------------- fuel ------------------------------- */

    fuel: (ctx) => {
      const sub = ctx.parts[2];

      if (sub === "events") {
        if (ctx.method === "GET") {
          const pendingOnly = ctx.url.searchParams.get("pending") === "1";
          const limit = Math.min(integerParam(ctx, "limit", 100), 500);
          sendJson(ctx.res, 200, {
            events: deps.query.listFuelEvents({ pendingOnly, limit }),
          });
          return;
        }
        requireMethod(ctx, "POST");
        return handleConfirmRefuel(ctx, deps);
      }

      if (sub === "prices") {
        requireMethod(ctx, "GET");
        sendJson(ctx.res, 200, { prices: deps.query.listFuelPrices() });
        return;
      }

      throw new HttpError(404, `unknown fuel sub-resource "${sub ?? ""}"`);
    },

    /* ------------------------------- status ------------------------------ */

    status: (ctx) => {
      requireMethod(ctx, "GET");
      const ingest = deps.engine.status();
      sendJson(ctx.res, 200, {
        ...ingest,
        simulation: deps.simulator() !== null,
        locationAttached: true,
        pendingRefuels: deps.store.countPendingRefuels(),
        tripCount: deps.store.tripCount(),
        preferences: deps.preferences(),
        live: deps.engine.activeTotals(),
      });
    },
  };

  if (deps.devMode) {
    routes.dev = (ctx) => handleDev(ctx, deps);
  }

  return routes;
}

/* -------------------------------- handlers --------------------------------- */

async function handleMerge(ctx: RouteContext, deps: TripRouteDeps): Promise<void> {
  const body = await ctx.body();
  const raw = body.tripIds;
  if (!Array.isArray(raw) || raw.length !== 2) {
    throw new HttpError(400, "tripIds must be exactly two trip ids");
  }
  const [first, second] = raw.map((value) => requireNumber(value, "tripIds"));
  if (!Number.isInteger(first) || !Number.isInteger(second) || first === second) {
    throw new HttpError(400, "tripIds must be two distinct trip ids");
  }

  const target = requireTrip(deps, first);
  const source = requireTrip(deps, second);

  // Only *adjacent* trips may be merged: anything else would silently reorder
  // history, and the user cannot undo that from the UI.
  const [earlier, later] =
    target.startTime <= source.startTime ? [target, source] : [source, target];

  const earlierStages = deps.store.listStages(earlier.id);
  const earlierEnd = earlierStages.reduce(
    (latest, stage) => Math.max(latest, stage.endTime ?? stage.startTime),
    earlier.endTime ?? earlier.startTime,
  );
  if (later.startTime < earlierEnd) {
    throw new HttpError(400, "trips overlap and cannot be merged");
  }
  if (deps.store.listStages(later.id).length === 0) {
    throw new HttpError(400, "cannot merge a trip with no stages");
  }

  deps.store.mergeTrips(earlier.id, later.id);
  deps.broadcast();
  sendJson(ctx.res, 200, deps.query.tripDetail(earlier.id));
}

async function handleSplit(
  ctx: RouteContext,
  deps: TripRouteDeps,
  tripId: number,
): Promise<void> {
  requireTrip(deps, tripId);
  const body = await ctx.body();
  const stageId = requireInteger(body.stageId, "stageId", 1);

  const stages = deps.store.listStages(tripId);
  if (!stages.some((stage) => stage.id === stageId)) {
    throw new HttpError(400, `stage ${stageId} does not belong to trip ${tripId}`);
  }
  if (stages[0].id === stageId) {
    throw new HttpError(400, "cannot split before the first stage");
  }

  deps.store.splitTrip(tripId, stageId);
  deps.broadcast();
  sendJson(ctx.res, 200, {
    trip: deps.query.tripDetail(tripId),
    trips: deps.query.listTrips({ limit: 50, offset: 0 }),
  });
}

async function handleConfirmRefuel(
  ctx: RouteContext,
  deps: TripRouteDeps,
): Promise<void> {
  const body = await ctx.body();
  const eventId = requireInteger(body.eventId, "eventId", 1);
  const pricePerLiter = requireNumber(body.pricePerLiter, "pricePerLiter");
  if (pricePerLiter < 0 || pricePerLiter > 100) {
    throw new HttpError(400, "pricePerLiter is outside a plausible range");
  }
  const currency = body.currency === undefined
    ? deps.preferences().currency
    : requireString(body.currency, "currency");

  const price = deps.store.confirmRefuel(eventId, pricePerLiter, currency);
  if (!price) throw new HttpError(404, `fuel event ${eventId} not found`);
  deps.broadcast();
  sendJson(ctx.res, 200, { ok: true, price });
}

/** Development-only simulation control. Never registered in production. */
async function handleDev(ctx: RouteContext, deps: TripRouteDeps): Promise<void> {
  const action = ctx.parts[2] ?? "";

  if (action === "scenarios") {
    requireMethod(ctx, "GET");
    sendJson(ctx.res, 200, {
      scenarios: Object.values(SCENARIOS).map((scenario) => ({
        id: scenario.id,
        label: scenario.label,
        durationMs: scenarioDurationMs(scenario),
      })),
      active: deps.simulator()?.scenarioId ?? null,
    });
    return;
  }

  if (action === "simulation") {
    requireMethod(ctx, "POST");
    const body = await ctx.body();
    const verb = requireString(body.action, "action");

    if (verb === "stop") {
      deps.simulator()?.stop();
      deps.setSimulator(null);
      deps.broadcast();
      sendJson(ctx.res, 200, { ok: true, running: false });
      return;
    }

    if (verb === "start" || verb === "seed") {
      const scenarioId: SimulationScenarioId = isScenarioId(body.scenario)
        ? body.scenario
        : "urban";
      const seed = body.seed === undefined ? undefined : requireInteger(body.seed, "seed", 0);
      const withLocation = body.withLocation === undefined
        ? true
        : requireBoolean(body.withLocation, "withLocation");
      // Where a seeded drive belongs on the timeline.
      //
      // Two things go wrong with a naive `now - duration`: the longest scenario
      // still lands partly *after* `now` (so its later legs fall outside every
      // window query), and repeated seeds overlap each other, which makes
      // "merge two adjacent trips" untestable from the UI. So a seed is placed
      // before the earliest trip already stored — the history stacks backwards.
      const duration = scenarioDurationMs(SCENARIOS[scenarioId]);
      const seededStart =
        verb === "seed"
          ? Math.min(
              Date.now() - duration - 10 * 60_000,
              (deps.store.earliestStageTime() ?? Number.POSITIVE_INFINITY) - 60 * 60_000 - duration,
            )
          : undefined;
      const startedAt =
        body.startedAt === undefined
          ? seededStart
          : requireNumber(body.startedAt, "startedAt");

      deps.simulator()?.stop();
      const simulator = new DriveSimulator({
        scenario: scenarioId,
        seed,
        withLocation,
        ...(startedAt === undefined ? {} : { startedAt }),
      });
      simulator.onSample((sample) => deps.engine.ingestSample(sample));
      simulator.onLocationSample((sample) => deps.engine.ingestLocation(sample));

      if (verb === "seed") {
        // Fast-forward the whole scenario through the engine and stop: this is
        // how a machine with no vehicle still gets a populated history, and it
        // is the same generator, so the shapes match a live drive exactly.
        try {
          simulator.drain();
        } catch (error) {
          deps.logger.warn(`seed drain failed: ${(error as Error).stack ?? String(error)}`);
          throw error;
        }
        deps.setSimulator(null);

        // Close what the drive left open. A trip only ends on the *next*
        // ignition, so a seeded history would otherwise sit "active" until some
        // later boot recovered it — and history should never contain a drive
        // that looks like it is still happening.
        deps.engine.closeOpenStage((startedAt ?? Date.now()) + duration);

        // A simulated drive detects refuels but nobody can type a price, so the
        // seed confirms them at the configured default. Without this every cost
        // in the seeded history is `--`, which makes it impossible to check the
        // costing path from the UI at all.
        let priced = 0;
        for (const event of deps.store.listFuelEvents({ pendingOnly: true, limit: 500 })) {
          deps.store.confirmRefuel(event.id, deps.defaultFuelPrice, deps.currency);
          priced += 1;
        }

        deps.broadcast();
        sendJson(ctx.res, 200, {
          ok: true,
          seeded: scenarioId,
          refuelsPriced: priced,
          tripCount: deps.store.tripCount(),
        });
        return;
      }

      simulator.start();
      deps.setSimulator(simulator);
      deps.broadcast();
      sendJson(ctx.res, 200, { ok: true, running: true, scenario: scenarioId });
      return;
    }

    throw new HttpError(400, `unknown simulation action "${verb}"`);
  }

  throw new HttpError(404, `unknown dev resource "${action}"`);
}
