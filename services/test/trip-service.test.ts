/**
 * The HTTP surface, exercised against a real service on a real (ephemeral) port.
 *
 * The point of this suite is the contract the two apps depend on: windowed
 * metrics that agree with the trips they are summed from, trends that are honest
 * about a missing comparison period, money that is `null` until a price is known,
 * and manual edits that refuse to do something the user could not undo.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ManualLocationSource,
  ManualTelemetrySource,
  StaticSettingsProvider,
} from "../trip-service/ports.js";
import { TripService } from "../trip-service/service.js";
import { TripStore } from "../trip-service/store/store.js";
import type { TripConfig } from "../trip-service/config.js";
import type { TripPreferences } from "../trip-service/types.js";
import { DEFAULT_PREFERENCES } from "../trip-service/types.js";
import { apiGet, apiPost } from "./support.js";

const T0 = 1_718_000_000_000;
const MINUTE = 60_000;
const SECOND = 1000;
const MODENA = { lat: 44.6471, lon: 10.9252 };

interface Harness {
  service: TripService;
  store: TripStore;
  source: ManualTelemetrySource;
  /** The GPS side. A real deployment has no adapter here yet; tests inject one. */
  gps: ManualLocationSource;
  preferences: StaticSettingsProvider;
  baseUrl: string;
  /** Closes whatever is open, the way a service shutdown does. */
  park(): void;
  stop(): Promise<void>;
}

function config(overrides: Partial<TripConfig> = {}): TripConfig {
  return {
    port: 0,
    dbPath: ":memory:",
    simulate: false,
    devMode: true,
    defaultFuelPrice: 1.85,
    currency: "EUR",
    movementEpsilonKmh: 2,
    maxOdometerJumpKm: 500,
    refuelDeltaLiters: 2,
    flushIntervalMs: 1000,
    ...overrides,
  };
}

async function withService(
  run: (harness: Harness) => Promise<void>,
  options: { preferences?: Partial<TripPreferences>; devMode?: boolean } = {},
): Promise<void> {
  const store = new TripStore(":memory:");
  const source = new ManualTelemetrySource();
  const gps = new ManualLocationSource();
  const preferences = new StaticSettingsProvider({
    ...DEFAULT_PREFERENCES,
    ...options.preferences,
  });
  const service = new TripService(config({ devMode: options.devMode ?? true }), {
    store,
    preferences,
    telemetry: source,
    location: gps,
    installProcessHandlers: false,
  });
  await service.start();
  const baseUrl = `http://127.0.0.1:${service.port}`;
  try {
    await run({
      service,
      store,
      source,
      gps,
      preferences,
      baseUrl,
      // `BaseMediaService` keeps the engine private; reaching it in a test is
      // the honest way to simulate a shutdown without a second public API.
      // Shut down at the last thing the trip actually recorded, not at
      // `Date.now()`: these drives are timestamped in a fixed past window, and
      // stamping "now" would put every trip's end two years after its start and
      // make adjacent trips look like they overlap.
      park: () => {
        const latest = store
          .listActiveTrips()
          .flatMap((trip) => store.listStages(trip.id))
          .reduce((max, stage) => Math.max(max, stage.endTime ?? stage.startTime), 0);
        (service as unknown as { engine: { closeOpenStage(at: number): void } }).engine.closeOpenStage(
          latest || T0,
        );
      },
      stop: () => service.stop(),
    });
  } finally {
    await service.stop();
    store.close();
  }
}

/**
 * Emits a synthetic drive straight into the engine through the injected source,
 * so the tests never depend on a timer or on the dev simulator.
 */
class Driver {
  private at: number;
  private odoKm = 10_000;
  private fuelL = 40;
  private lat = MODENA.lat;
  private lon = MODENA.lon;

  constructor(
    private readonly source: ManualTelemetrySource,
    private readonly gps: ManualLocationSource,
    startTime = T0,
  ) {
    this.at = startTime;
  }

  get now(): number {
    return this.at;
  }

  drive(seconds: number, speedKmh = 60): this {
    for (let i = 0; i < seconds; i += 1) {
      this.source.emit({
        timestamp: this.at,
        odometerKm: this.odoKm,
        speedKmh,
        fuelLevelLiters: this.fuelL,
        fuelFlowLph: null,
        ignition: true,
        engineRpm: 1500,
      });
      if (speedKmh > 0) {
        const km = speedKmh / 3600;
        this.odoKm += km;
        this.fuelL = Math.max(0, this.fuelL - km * 0.07);
        this.lat += (km / 111.32) * Math.cos(Math.PI / 4);
        this.lon += (km / (111.32 * Math.cos((this.lat * Math.PI) / 180))) * Math.sin(Math.PI / 4);
        // A real vehicle reports both; a drive with no fixes has no route, and
        // the map payload would be empty for reasons the engine cannot explain.
        this.gps.emit({
          timestamp: this.at,
          lat: this.lat,
          lon: this.lon,
          speedKmh,
          headingDeg: 45,
          fixQuality: 1,
        });
      }
      this.at += SECOND;
    }
    return this;
  }

  minutes(minutes: number, speedKmh = 60): this {
    return this.drive(Math.round(minutes * 60), speedKmh);
  }

  /**
   * Reports a position without moving: the way a test places the car at the
   * home fence after a drive. The engine reads the fix, not the odometer.
   */
  fixAt(where: { lat: number; lon: number }): this {
    this.gps.emit({
      timestamp: this.at,
      lat: where.lat,
      lon: where.lon,
      speedKmh: 0,
      headingDeg: null,
      fixQuality: 1,
    });
    this.at += SECOND;
    return this;
  }

  /** Returns to the home fence, which is what ends a trip. */
  arriveHome(): this {
    return this.fixAt(MODENA);
  }

  park(minutes: number): this {
    for (let i = 0; i < Math.round(minutes * 60); i += 1) {
      this.source.emit({
        timestamp: this.at,
        odometerKm: this.odoKm,
        speedKmh: 0,
        fuelLevelLiters: this.fuelL,
        fuelFlowLph: null,
        ignition: false,
        engineRpm: 0,
      });
      this.at += SECOND;
    }
    return this;
  }

  /**
   * Jumps the clock forward through a layover, emitting a single parked sample
   * at the far end.
   *
   * The engine notices a stop from the samples it receives, so a time jump with
   * no sample at all would leave the previous stage looking as if it were still
   * being driven — the stage would never close and no second leg would appear.
   */
  advance(minutes: number): this {
    this.at += Math.round(minutes * MINUTE);
    this.source.emit({
      timestamp: this.at,
      odometerKm: this.odoKm,
      speedKmh: 0,
      fuelLevelLiters: this.fuelL,
      fuelFlowLph: null,
      ignition: false,
      engineRpm: 0,
    });
    this.at += SECOND;
    return this;
  }
}

/** Runs one completed trip through the service and returns its id. */
async function seedTrip(
  harness: Harness,
  speedKmh = 60,
  minutes = 20,
  startTime = T0,
): Promise<number> {
  const driver = new Driver(harness.source, harness.gps, startTime);
  driver.minutes(minutes, speedKmh).park(20).arriveHome();
  harness.park();
  const trips = harness.store.listTrips({ limit: 10, offset: 0 }).trips;
  return trips[0].id;
}

/* --------------------------------- basics --------------------------------- */

test("health and state report ingest liveness", async () => {
  await withService(async ({ baseUrl }) => {
    const health = await apiGet<{ ok: boolean; service: string; phase: string }>(
      `${baseUrl}/api/health`,
    );
    assert.equal(health.status, 200);
    assert.equal(health.body.ok, true);
    assert.equal(health.body.service, "trip");
    assert.equal(health.body.phase, "running");

    const state = await apiGet<{ status: { vehicleSamples: number }; tripCount: number }>(
      `${baseUrl}/api/state`,
    );
    assert.equal(state.status, 200);
    assert.equal(state.body.tripCount, 0);
  });
});

test("an unknown route is a 404 and a wrong method is a 405", async () => {
  await withService(async ({ baseUrl }) => {
    assert.equal((await apiGet(`${baseUrl}/api/nope`)).status, 404);
    assert.equal((await apiPost(`${baseUrl}/api/status`, {})).status, 405);
  });
});

test("an invalid JSON body is a 400", async () => {
  await withService(async ({ baseUrl }) => {
    const response = await fetch(`${baseUrl}/api/fuel/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{not json",
    });
    assert.equal(response.status, 400);
  });
});

/* -------------------------------- trip computer ---------------------------- */

test("with no data the cards report nulls and --, and the trend is not comparable", async () => {
  await withService(async ({ baseUrl }) => {
    const summary = await apiGet<{
      cards: Record<
        string,
        {
          value: number | null;
          formatted: string;
          trend: { comparable: boolean; delta: number | null };
        }
      >;
      hasData: boolean;
    }>(`${baseUrl}/api/summary?preset=all`);

    assert.equal(summary.status, 200);
    assert.equal(summary.body.hasData, false);
    for (const card of Object.values(summary.body.cards)) {
      assert.equal(card.formatted, "--");
      assert.equal(card.trend.comparable, false);
      assert.equal(card.trend.delta, null);
    }
  });
});

test("the summary aggregates a window and exposes a null-safe money card", async () => {
  await withService(async (harness) => {
    const { baseUrl } = harness;
    await seedTrip(harness);

    const summary = await apiGet<{
      cards: {
        distance: { value: number; formatted: string };
        liters: { value: number };
        spent: { value: number | null; formatted: string };
        avgConsumption: { value: number; unit: string };
      };
      hasData: boolean;
      period: { from: number; to: number };
    }>(`${baseUrl}/api/summary?preset=all`);

    assert.equal(summary.body.hasData, true);
    assert.ok((summary.body.cards.distance.value ?? 0) > 19, "20 minutes at 60 km/h is ~20 km");
    assert.ok((summary.body.cards.liters.value ?? 0) > 0);
    // No price has been recorded, so money is unknown rather than zero.
    assert.equal(summary.body.cards.spent.value, null);
    assert.equal(summary.body.cards.spent.formatted, "--");
    assert.ok((summary.body.cards.avgConsumption.value ?? 0) > 0);
  });
});

test("the consumption unit comes from preferences", async () => {
  await withService(
    async (harness) => {
      await seedTrip(harness);
      const summary = await apiGet<{
        cards: { avgConsumption: { unit: string; value: number } };
      }>(`${harness.baseUrl}/api/summary?preset=all`);
      assert.equal(summary.body.cards.avgConsumption.unit, "km_per_l");
      // ~7 l/100km is ~14 km/l: a different unit must be a different number.
      assert.ok((summary.body.cards.avgConsumption.value ?? 0) > 5);
    },
    { preferences: { consumptionUnit: "km_per_l" } },
  );
});

test("a window with no previous period reports a non-comparable trend", async () => {
  await withService(async (harness) => {
    await seedTrip(harness);
    const summary = await apiGet<{
      cards: { distance: { trend: { comparable: boolean; delta: number | null } } };
    }>(`${harness.baseUrl}/api/summary?preset=7d`);
    assert.equal(summary.body.cards.distance.trend.comparable, false);
    assert.equal(summary.body.cards.distance.trend.delta, null);
  });
});

test("series buckets cover the window and can be empty", async () => {
  await withService(async (harness) => {
    const empty = await apiGet<{ empty: boolean; buckets: unknown[] }>(
      `${harness.baseUrl}/api/series?preset=all`,
    );
    assert.equal(empty.body.empty, true);
    assert.equal(empty.body.buckets.length, 0, "no data means no buckets to draw");

    await seedTrip(harness);
    const series = await apiGet<{
      granularity: string;
      buckets: { distanceKm: number; liters: number; cost: number | null }[];
      empty: boolean;
    }>(`${harness.baseUrl}/api/series?preset=all`);

    assert.equal(series.body.empty, false);
    assert.ok(["hour", "day", "week"].includes(series.body.granularity));
    const total = series.body.buckets.reduce((sum, bucket) => sum + bucket.distanceKm, 0);
    assert.ok(total > 19, `buckets must add up to the window total, got ${total}`);
    assert.ok(
      series.body.buckets.every((bucket) => bucket.cost === null),
      "an unpriced window must not report zero money",
    );
  });
});

test("an explicit range overrides the preset and rejects a backwards range", async () => {
  await withService(async (harness) => {
    await seedTrip(harness);
    const ok = await apiGet<{ period: { from: number; to: number } }>(
      `${harness.baseUrl}/api/summary?from=${T0}&to=${T0 + 30 * MINUTE}`,
    );
    assert.equal(ok.status, 200);
    assert.equal(ok.body.period.from, T0);

    const bad = await apiGet(`${harness.baseUrl}/api/summary?from=${T0}&to=${T0 - 1}`);
    assert.equal(bad.status, 400);

    const half = await apiGet(`${harness.baseUrl}/api/summary?from=${T0}`);
    assert.equal(half.status, 400, "a half-specified range is a client error");

    const unknown = await apiGet(`${harness.baseUrl}/api/summary?preset=fortnight`);
    assert.equal(unknown.status, 400);
  });
});

test("periods are described by the service, not guessed by the renderer", async () => {
  await withService(async ({ baseUrl }) => {
    const periods = await apiGet<{ periods: { preset: string; label: string }[] }>(
      `${baseUrl}/api/periods`,
    );
    assert.equal(periods.status, 200);
    assert.deepEqual(
      periods.body.periods.map((period) => period.preset),
      ["today", "7d", "30d", "90d", "year", "all"],
    );
    assert.ok(periods.body.periods.every((period) => period.label.length > 0));
  });
});

/* -------------------------------- trip history ----------------------------- */

test("trips are listed newest first with their derived per-trip averages", async () => {
  await withService(async (harness) => {
    await seedTrip(harness);
    // The second drive must also end at home, or the engine correctly treats it
    // as another leg of one road trip.
    const driver = new Driver(harness.source, harness.gps, T0 + 2 * 60 * MINUTE);
    driver.minutes(30, 80).park(20).arriveHome();
    // A trip is finalized by the *next* ignition, so this leaves the second trip
    // open; close it the way a shutdown would.
    harness.park();

    const list = await apiGet<{
      trips: {
        id: number;
        totalDistanceKm: number;
        legs: number;
        avgConsumptionLPer100km: number | null;
        hasRoute: boolean;
      }[];
      total: number;
    }>(`${harness.baseUrl}/api/trips`);

    assert.equal(list.status, 200);
    assert.equal(list.body.total, 2);
    assert.ok(list.body.trips[0].totalDistanceKm > list.body.trips[1].totalDistanceKm);
    assert.equal(list.body.trips[0].legs, 1);
    assert.ok((list.body.trips[0].avgConsumptionLPer100km ?? 0) > 0);
  });
});

test("a trip detail carries the stats bar and one entry per leg", async () => {
  await withService(async (harness) => {
    const tripId = await seedTrip(harness, 90, 30);
    const detail = await apiGet<{
      stats: { avgSpeedKmh: number; maxSpeedKmh: number; idleSeconds: number; movingSeconds: number };
      stages: { stageNumber: number }[];
      legs: number;
    }>(`${harness.baseUrl}/api/trips/${tripId}`);

    assert.equal(detail.status, 200);
    assert.equal(detail.body.legs, 1);
    assert.equal(detail.body.stages.length, 1);
    assert.ok(detail.body.stats.movingSeconds > 1700);
    assert.ok(detail.body.stats.idleSeconds > 0, "the 20-minute park is idle time");
    assert.ok(detail.body.stats.maxSpeedKmh >= 90);
  });
});

test("trip coordinates come back with bounds for the map", async () => {
  await withService(async (harness) => {
    const tripId = await seedTrip(harness, 90, 30);
    const coordinates = await apiGet<{
      points: { lat: number; lon: number; speedKmh: number | null }[];
      bounds: { minLat: number; minLon: number; maxLat: number; maxLon: number } | null;
    }>(`${harness.baseUrl}/api/trips/${tripId}/coordinates`);

    assert.equal(coordinates.status, 200);
    assert.ok(coordinates.body.points.length > 0, "a drive must leave a trajectory");
    assert.ok(coordinates.body.bounds, "a trajectory must carry its bounds");
    assert.ok(coordinates.body.bounds.maxLat >= coordinates.body.bounds.minLat);
    assert.ok(coordinates.body.bounds.maxLon >= coordinates.body.bounds.minLon);
    assert.ok(
      coordinates.body.points.every((point) => Number.isFinite(point.lat)),
      "every point must be plottable",
    );
  });
});

test("an unknown trip is a 404 rather than an empty object", async () => {
  await withService(async ({ baseUrl }) => {
    assert.equal((await apiGet(`${baseUrl}/api/trips/4242`)).status, 404);
    assert.equal((await apiGet(`${baseUrl}/api/trips/4242/coordinates`)).status, 404);
    assert.equal((await apiGet(`${baseUrl}/api/trips/not-a-number`)).status, 400);
  });
});

test("paging parameters are validated and bounded", async () => {
  await withService(async ({ baseUrl }) => {
    assert.equal((await apiGet(`${baseUrl}/api/trips?limit=-1`)).status, 400);
    assert.equal((await apiGet(`${baseUrl}/api/trips?offset=abc`)).status, 400);
    const paged = await apiGet<{ trips: unknown[] }>(`${baseUrl}/api/trips?limit=10&offset=0`);
    assert.equal(paged.status, 200);
  });
});

/* ------------------------------- manual edits ------------------------------ */

/** Two adjacent trips, each ending with a return to the home fence. */
async function seedTwoTrips(harness: Harness): Promise<{ first: number; second: number }> {
  const first = await seedTrip(harness, 60, 20, T0);
  const second = await seedTrip(harness, 50, 15, T0 + 60 * MINUTE);
  return { first, second };
}

test("merging two adjacent trips combines them into one road trip", async () => {
  await withService(async (harness) => {
    const { first, second } = await seedTwoTrips(harness);

    const merged = await apiPost<{ id: number; legs: number; isRoadTrip: boolean }>(
      `${harness.baseUrl}/api/trips/merge`,
      { tripIds: [first, second] },
    );

    assert.equal(merged.status, 200, JSON.stringify(merged.body));
    assert.equal(merged.body.id, first);
    assert.equal(merged.body.legs, 2);
    assert.equal(merged.body.isRoadTrip, true);
    assert.equal(harness.store.tripCount(), 1);
  });
});

test("merging refuses anything other than exactly two distinct trips", async () => {
  await withService(async (harness) => {
    const { first } = await seedTwoTrips(harness);
    assert.equal(
      (await apiPost(`${harness.baseUrl}/api/trips/merge`, { tripIds: [first] })).status,
      400,
    );
    assert.equal(
      (await apiPost(`${harness.baseUrl}/api/trips/merge`, { tripIds: [first, first] })).status,
      400,
    );
    assert.equal((await apiPost(`${harness.baseUrl}/api/trips/merge`, {})).status, 400);
  });
});

test("splitting a trip produces two trips whose totals still add up", async () => {
  await withService(async (harness) => {
    // A road trip with two legs, so there is a boundary to split on. Both legs
    // are driven away from the fence, so the 30-minute layover continues the
    // same journey as a second stage rather than starting a new trip.
    const driver = new Driver(harness.source, harness.gps, T0);
    driver.minutes(20, 70);
    driver.park(20);
    driver.advance(30);
    driver.minutes(20, 70);
    harness.park();

    const trip = harness.store.listTrips({ limit: 10, offset: 0 }).trips[0];
    assert.equal(harness.store.listStages(trip.id).length, 2, "expected a two-stage trip");
    const stages = harness.store.listStages(trip.id);

    const split = await apiPost<{
      trip: { totalDistanceKm: number };
      trips: { trips: { totalDistanceKm: number }[] };
    }>(`${harness.baseUrl}/api/trips/${trip.id}/split`, { stageId: stages[1].id });

    assert.equal(split.status, 200);
    assert.equal(harness.store.tripCount(), 2);
    const total = harness.store
      .listTrips({ limit: 10, offset: 0 })
      .trips.reduce((sum, entry) => sum + entry.totalDistanceKm, 0);
    assert.ok(
      Math.abs(total - trip.totalDistanceKm) < 1e-6,
      "splitting must not create or lose distance",
    );
  });
});

test("splitting refuses an unknown stage and a first-stage boundary", async () => {
  await withService(async (harness) => {
    const tripId = await seedTrip(harness);
    const stages = harness.store.listStages(tripId);
    const bad = await apiPost(`${harness.baseUrl}/api/trips/${tripId}/split`, { stageId: 9999 });
    assert.equal(bad.status, 400);
    const first = await apiPost(`${harness.baseUrl}/api/trips/${tripId}/split`, {
      stageId: stages[0].id,
    });
    assert.equal(first.status, 400);
  });
});

/* ----------------------------------- fuel ---------------------------------- */

test("a confirmed refuel price prices the fuel that was already burned", async () => {
  await withService(async (harness) => {
    await seedTrip(harness);

    // The summary is unpriced before any price is recorded.
    const before = await apiGet<{ cards: { spent: { value: number | null } } }>(
      `${harness.baseUrl}/api/summary?preset=all`,
    );
    assert.equal(before.body.cards.spent.value, null);

    const events = await apiGet<{ events: { id: number }[] }>(
      `${harness.baseUrl}/api/fuel/events?pending=1`,
    );

    // A drive that burned fuel without refuelling leaves nothing to price, so
    // inject a refuel the way the tank model would have.
    const tripId = harness.store.listTrips({ limit: 1, offset: 0 }).trips[0].id;
    const stageId = harness.store.listStages(tripId)[0].id;
    const eventId =
      events.body.events[0]?.id ??
      harness.store.recordRefuel({
        timestamp: T0 + MINUTE,
        litersAdded: 20,
        levelBeforeL: 10,
        levelAfterL: 30,
        tripId,
        stageId,
      });

    const confirmed = await apiPost<{ ok: boolean; price: { pricePerLiter: number } }>(
      `${harness.baseUrl}/api/fuel/events`,
      { eventId, pricePerLiter: 1.75, currency: "EUR" },
    );
    assert.equal(confirmed.status, 200);
    assert.equal(confirmed.body.price.pricePerLiter, 1.75);

    const after = await apiGet<{ cards: { spent: { value: number | null; formatted: string } } }>(
      `${harness.baseUrl}/api/summary?preset=all`,
    );
    assert.ok(
      after.body.cards.spent.value !== null,
      "with a price recorded the money must be known",
    );
    assert.match(after.body.cards.spent.formatted, /[0-9]/);

    const prices = await apiGet<{ prices: { pricePerLiter: number }[] }>(
      `${harness.baseUrl}/api/fuel/prices`,
    );
    assert.equal(prices.body.prices.length, 1);
  });
});

test("confirming a refuel validates the price and the event", async () => {
  await withService(async ({ baseUrl }) => {
    assert.equal(
      (await apiPost(`${baseUrl}/api/fuel/events`, { eventId: 1, pricePerLiter: -1 })).status,
      400,
    );
    assert.equal(
      (await apiPost(`${baseUrl}/api/fuel/events`, { eventId: 1, pricePerLiter: 999 })).status,
      400,
    );
    assert.equal(
      (await apiPost(`${baseUrl}/api/fuel/events`, { eventId: 4242, pricePerLiter: 1.8 })).status,
      404,
    );
    assert.equal((await apiPost(`${baseUrl}/api/fuel/events`, { pricePerLiter: 1.8 })).status, 400);
  });
});

test("fuel events can be filtered to the pending ones", async () => {
  await withService(async (harness) => {
    const tripId = harness.store.openTrip(T0, 1_000);
    const stageId = harness.store.openStage(tripId, T0, 1_000);
    harness.store.recordRefuel({
      timestamp: T0,
      litersAdded: 10,
      levelBeforeL: 5,
      levelAfterL: 15,
      tripId,
      stageId,
    });

    const pending = await apiGet<{ events: { confirmed: boolean }[] }>(
      `${harness.baseUrl}/api/fuel/events?pending=1`,
    );
    assert.equal(pending.body.events.length, 1);
    assert.equal(pending.body.events[0].confirmed, false);

    const all = await apiGet<{ events: unknown[] }>(`${harness.baseUrl}/api/fuel/events`);
    assert.equal(all.body.events.length, 1);
  });
});

/* ---------------------------------- status --------------------------------- */

test("status reports ingest counters and the live stage", async () => {
  await withService(async (harness) => {
    await seedTrip(harness);
    const status = await apiGet<{
      vehicleSamples: number;
      lastSampleAt: number | null;
      simulation: boolean;
      locationAttached: boolean;
      pendingRefuels: number;
      tripCount: number;
    }>(`${harness.baseUrl}/api/status`);

    assert.equal(status.status, 200);
    assert.ok(status.body.vehicleSamples > 1000);
    assert.ok((status.body.lastSampleAt ?? 0) > T0);
    assert.equal(status.body.simulation, false, "a manual source is not a simulation");
    assert.equal(
      status.body.locationAttached,
      true,
      "the injected GPS source is what the field reports",
    );
    assert.equal(status.body.tripCount, 1);
  });
});

/* ------------------------------ suspend / resume --------------------------- */

test("suspending stops ingestion and resuming continues the same trip", async () => {
  await withService(async (harness) => {
    const { baseUrl } = harness;
    const driver = new Driver(harness.source, harness.gps, T0);
    driver.minutes(10, 60);

    await apiPost(`${baseUrl}/api/settings`, { suspended: true });
    const openBefore = harness.store.getOpenTrip();

    // A sample while suspended must not reach the engine.
    const samplesBefore = (
      await apiGet<{ vehicleSamples: number }>(`${baseUrl}/api/status`)
    ).body.vehicleSamples;
    driver.minutes(5, 60);
    const samplesWhileSuspended = (
      await apiGet<{ vehicleSamples: number }>(`${baseUrl}/api/status`)
    ).body.vehicleSamples;
    assert.equal(samplesWhileSuspended, samplesBefore, "a suspended service must not ingest");

    await apiPost(`${baseUrl}/api/settings`, { suspended: false });
    driver.park(20);

    assert.ok(openBefore, "a trip was open when the service was suspended");
    assert.equal(harness.store.tripCount(), 1, "the resume must not start a second trip");
    assert.equal(
      harness.store.listStages(openBefore.id).length,
      1,
      "the pause and resume stayed inside one stage",
    );
  });
});

test("a mutating request wakes a suspended service", async () => {
  await withService(async (harness) => {
    await apiPost(`${harness.baseUrl}/api/settings`, { suspended: true });
    const confirmed = await apiPost(`${harness.baseUrl}/api/fuel/events`, {
      eventId: 999,
      pricePerLiter: 1.8,
    });
    // 404 for the unknown event proves the handler ran, i.e. the service woke up.
    assert.equal(confirmed.status, 404);
    const health = await apiGet<{ suspended: boolean }>(`${harness.baseUrl}/api/health`);
    assert.equal(health.body.suspended, false);
  });
});

/* ---------------------------------- dev mode ------------------------------- */

test("the simulation is controlled only when dev endpoints are enabled", async () => {
  await withService(
    async (harness) => {
      const scenarios = await apiGet<{ scenarios: { id: string }[]; active: string | null }>(
        `${harness.baseUrl}/api/dev/scenarios`,
      );
      assert.equal(scenarios.status, 200);
      assert.ok(scenarios.body.scenarios.some((scenario) => scenario.id === "road-trip"));

      const seeded = await apiPost<{ ok: boolean; seeded: string; tripCount: number }>(
        `${harness.baseUrl}/api/dev/simulation`,
        { action: "seed", scenario: "road-trip" },
      );
      assert.equal(seeded.status, 200);
      assert.equal(seeded.body.ok, true);
      assert.ok(seeded.body.tripCount > 0, "seeding must produce a history");
    },
    { devMode: true },
  );
});

test("the dev endpoints are absent in production", async () => {
  await withService(
    async ({ baseUrl }) => {
      assert.equal((await apiGet(`${baseUrl}/api/dev/scenarios`)).status, 404);
      assert.equal(
        (await apiPost(`${baseUrl}/api/dev/simulation`, { action: "start" })).status,
        404,
      );
    },
    { devMode: false },
  );
});

test("a seed cannot contaminate a drive that was already in progress", async () => {
  await withService(async (harness) => {
    const { baseUrl } = harness;

    // Leave an *open* trip from a drive that is still in progress — exactly the
    // state a developer is in when they reach for the seed button.
    const driver = new Driver(harness.source, harness.gps, T0);
    driver.minutes(10, 60);
    assert.ok(harness.store.getOpenTrip(), "expected an open trip from the live drive");

    // The seeded drive's samples are timestamped in the past. Without an
    // out-of-order guard they are fed into that live stage — which is how this
    // used to fail with a FOREIGN KEY error, attributing a refuel to a stage
    // that had no row yet.
    const seeded = await apiPost<{ ok: boolean; tripCount: number; refuelsPriced: number }>(
      `${baseUrl}/api/dev/simulation`,
      { action: "seed", scenario: "road-trip" },
    );
    assert.equal(seeded.status, 200, "seeding over a live drive must succeed");
    assert.equal(seeded.body.ok, true);

    const trips = harness.store.listTrips({ limit: 50, offset: 0 }).trips;
    const seededTrip = trips.find((trip) => trip.isRoadTrip);
    assert.ok(seededTrip, "the road-trip scenario must produce a two-leg trip");
    assert.equal(harness.store.listStages(seededTrip.id).length, 2);
    assert.ok(
      seededTrip.totalDistanceKm > 100,
      `the seeded trip must be intact, got ${seededTrip.totalDistanceKm} km`,
    );

    // And the live drive's own distance is not inflated by the seeded samples.
    const liveTrip = trips.find((trip) => trip.id !== seededTrip.id);
    if (liveTrip) {
      assert.ok(
        liveTrip.totalDistanceKm < 60,
        `the live trip absorbed seeded distance: ${liveTrip.totalDistanceKm} km`,
      );
    }
  });
});

test("a dev seed refuses an unknown action", async () => {
  await withService(async ({ baseUrl }) => {
    assert.equal(
      (await apiPost(`${baseUrl}/api/dev/simulation`, { action: "launch" })).status,
      400,
    );
  });
});
