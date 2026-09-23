/**
 * End-to-end: a real trip service, the renderer's real HTTP client, a scripted
 * drive.
 *
 * This is the test that proves the two apps can be built on this service without
 * a mapping layer: it drives ingestion, then reads every endpoint through
 * `src/services/trip.ts` and asserts on the values a card or the map would show.
 * It also pins the rule the whole feature rests on — the renderer receives
 * finished, formatted values, not raw material to aggregate.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { TripService } from "../../services/trip-service/service.js";
import { TripStore } from "../../services/trip-service/store/store.js";
import {
  ManualLocationSource,
  ManualTelemetrySource,
  StaticSettingsProvider,
} from "../../services/trip-service/ports.js";
import type { TripConfig } from "../../services/trip-service/config.js";
import { DEFAULT_PREFERENCES } from "../../services/trip-service/types.js";
import {
  fetchTripCoordinates,
  fetchTripDetail,
  fetchTripPeriods,
  fetchTripSeries,
  fetchTripStatus,
  fetchTripSummary,
  fetchTrips,
  mergeTrips,
  splitTrip,
} from "@/services/trip";
import { formatDelta, formatDay, projectRoute } from "@/lib/trip-view";
import { TRIP_MAP_VIEWPORT } from "@/constants/trip";

/** A fixed past instant, so no assertion depends on when the suite runs. */
const T0 = new Date(2025, 3, 14, 8, 0, 0, 0).getTime();
const SECOND = 1000;
const MINUTE = 60_000;
const HOME = { lat: 44.6471, lon: 10.9252 };

function config(): TripConfig {
  return {
    port: 0,
    dbPath: ":memory:",
    simulate: false,
    devMode: false,
    defaultFuelPrice: 1.85,
    currency: "EUR",
    movementEpsilonKmh: 2,
    maxOdometerJumpKm: 500,
    refuelDeltaLiters: 2,
    flushIntervalMs: 1000,
  };
}

/**
 * A scripted vehicle.
 *
 * `park(minutes, true)` reports a fix at home *before* sleeping, because that is
 * what makes the engine treat the next ignition as a new journey rather than
 * another stage of a road trip — and it is also what a returning car does.
 */
class ScriptedDrive {
  private clock: number;
  private odometerKm: number;
  private fuelLiters = 38;
  private lat = HOME.lat;
  private lon = HOME.lon;

  constructor(
    private readonly telemetry: ManualTelemetrySource,
    private readonly gps: ManualLocationSource,
    startTime: number,
    startOdometerKm = 20_000,
  ) {
    this.clock = startTime;
    this.odometerKm = startOdometerKm;
  }

  get now(): number {
    return this.clock;
  }

  /**
   * Reports the car sitting at the home fence.
   *
   * Used before a second journey: the engine decides "home or away" from the
   * last fix, so this is what separates two trips from two legs of one.
   */
  startAtHome(): this {
    this.gps.emit({
      timestamp: this.clock,
      lat: HOME.lat,
      lon: HOME.lon,
      speedKmh: 0,
      headingDeg: null,
      fixQuality: 1,
    });
    this.lat = HOME.lat;
    this.lon = HOME.lon;
    this.clock += SECOND;
    return this;
  }

  /** Drives for `seconds`, emitting one vehicle sample and one fix per second. */
  drive(seconds: number, speedKmh: number): this {
    for (let index = 0; index < seconds; index += 1) {
      this.telemetry.emit({
        timestamp: this.clock,
        odometerKm: this.odometerKm,
        speedKmh,
        fuelLevelLiters: this.fuelLiters,
        fuelFlowLph: null,
        ignition: true,
        engineRpm: 1800,
      });
      const step = speedKmh / 3600;
      this.odometerKm += step;
      this.fuelLiters = Math.max(0, this.fuelLiters - step * 0.066);
      this.lat += (step / 111.32) * Math.cos(Math.PI / 4);
      this.lon += (step / (111.32 * Math.cos((this.lat * Math.PI) / 180))) * Math.sin(Math.PI / 4);
      this.gps.emit({
        timestamp: this.clock,
        lat: this.lat,
        lon: this.lon,
        speedKmh,
        headingDeg: 45,
        fixQuality: 1,
      });
      this.clock += SECOND;
    }
    return this;
  }

  minutes(minutes: number, speedKmh: number): this {
    return this.drive(Math.round(minutes * 60), speedKmh);
  }

  /** Engine off for `minutes`; `arriveHome` reports a fix at the home fence. */
  park(minutes: number, arriveHome = false): this {
    if (arriveHome) {
      this.gps.emit({
        timestamp: this.clock,
        lat: HOME.lat,
        lon: HOME.lon,
        speedKmh: 0,
        headingDeg: null,
        fixQuality: 1,
      });
      this.lat = HOME.lat;
      this.lon = HOME.lon;
    }
    for (let index = 0; index < Math.round(minutes * 60); index += 1) {
      this.telemetry.emit({
        timestamp: this.clock,
        odometerKm: this.odometerKm,
        speedKmh: 0,
        fuelLevelLiters: this.fuelLiters,
        fuelFlowLph: null,
        ignition: false,
        engineRpm: 0,
      });
      this.clock += SECOND;
    }
    return this;
  }
}

/** A vehicle with no GPS at all: distance still accumulates, route does not. */
class ScriptedDriveNoGps {
  private clock: number;
  private odometerKm: number;
  private fuelLiters = 30;

  constructor(
    private readonly telemetry: ManualTelemetrySource,
    startTime: number,
  ) {
    this.clock = startTime;
    this.odometerKm = 30_000;
  }

  get now(): number {
    return this.clock;
  }

  minutes(minutes: number, speedKmh: number): this {
    for (let index = 0; index < Math.round(minutes * 60); index += 1) {
      this.telemetry.emit({
        timestamp: this.clock,
        odometerKm: this.odometerKm,
        speedKmh,
        fuelLevelLiters: this.fuelLiters,
        fuelFlowLph: null,
        ignition: true,
        engineRpm: 1500,
      });
      const step = speedKmh / 3600;
      this.odometerKm += step;
      this.fuelLiters = Math.max(0, this.fuelLiters - step * 0.07);
      this.clock += SECOND;
    }
    return this;
  }

  park(minutes: number): this {
    for (let index = 0; index < Math.round(minutes * 60); index += 1) {
      this.telemetry.emit({
        timestamp: this.clock,
        odometerKm: this.odometerKm,
        speedKmh: 0,
        fuelLevelLiters: this.fuelLiters,
        fuelFlowLph: null,
        ignition: false,
        engineRpm: 0,
      });
      this.clock += SECOND;
    }
    return this;
  }
}

interface Harness {
  baseUrl: string;
  telemetry: ManualTelemetrySource;
  gps: ManualLocationSource;
  park(at: number): void;
}

async function withTripService(run: (harness: Harness) => Promise<void>): Promise<void> {
  const store = new TripStore(":memory:");
  const telemetry = new ManualTelemetrySource();
  const gps = new ManualLocationSource();
  const service = new TripService(config(), {
    store,
    // A configured home fence is what lets the engine tell "arrived home" (the
    // journey is over) from "stopped away" (another leg of a road trip). Without
    // it the engine deliberately refuses to guess and never splits a journey.
    preferences: new StaticSettingsProvider({
      ...DEFAULT_PREFERENCES,
      homeGeofenceLat: HOME.lat,
      homeGeofenceLon: HOME.lon,
      homeGeofenceRadiusM: 300,
    }),
    telemetry,
    location: gps,
    installProcessHandlers: false,
  });
  await service.start();

  // A trip is only meant to end on the next ignition, so tests close it the way
  // a shutdown would — at the last instant the drive actually recorded.
  const park = (at: number) =>
    (
      service as unknown as { engine: { closeOpenStage(timestamp: number): void } }
    ).engine.closeOpenStage(at);

  try {
    await run({ baseUrl: `http://127.0.0.1:${service.port}`, telemetry, gps, park });
  } finally {
    await service.stop();
    store.close();
  }
}

/* -------------------------------------------------------------------------- */

test("no data yet: the cards say -- and the graph has nothing to draw", async () => {
  await withTripService(async ({ baseUrl }) => {
    const summary = await fetchTripSummary(baseUrl, { preset: "30d" });
    assert.equal(summary.hasData, false);
    for (const card of Object.values(summary.cards)) {
      assert.equal(card.formatted, "--");
      assert.equal(card.trend.comparable, false, "there is no previous period to compare");
      assert.equal(formatDelta(card), null, "so there is no delta to word");
    }

    const series = await fetchTripSeries(baseUrl, { preset: "30d" });
    assert.equal(series.empty, true);
    assert.equal(series.buckets.length, 0, "an empty window must not draw a flat line at zero");
  });
});

test("a completed drive fills the cards, the graph and the list", async () => {
  await withTripService(async ({ baseUrl, telemetry, gps, park }) => {
    const drive = new ScriptedDrive(telemetry, gps, T0);
    drive.minutes(30, 80).park(20, true);
    park(drive.now);

    const summary = await fetchTripSummary(baseUrl, { preset: "all" });
    assert.equal(summary.hasData, true);
    // 30 minutes at 80 km/h is 40 km; the card must report a real number.
    assert.ok((summary.cards.distance.value ?? 0) > 35, `got ${summary.cards.distance.value}`);
    assert.ok((summary.cards.liters.value ?? 0) > 0);
    assert.match(summary.cards.distance.formatted, /km$/);

    // No price has been recorded, so money is unknown rather than zero.
    assert.equal(summary.cards.spent.value, null);
    assert.equal(summary.cards.spent.formatted, "--");

    const series = await fetchTripSeries(baseUrl, { preset: "all" });
    assert.equal(series.empty, false);
    const bucketed = series.buckets.reduce((sum, bucket) => sum + bucket.distanceKm, 0);
    assert.ok(bucketed > 35, "the graph must account for the same distance as the card");

    const list = await fetchTrips(baseUrl);
    assert.equal(list.total, 1);
    assert.equal(list.trips[0].legs, 1);
    assert.ok(list.trips[0].totalDistanceKm > 35);
    assert.equal(list.trips[0].status, "completed");
  });
});

test("the period range comes back resolved, ready to print verbatim", async () => {
  await withTripService(async ({ baseUrl }) => {
    const periods = await fetchTripPeriods(baseUrl);
    assert.deepEqual(
      periods.map((period) => period.preset),
      ["today", "7d", "30d", "90d", "year", "all"],
    );

    const summary = await fetchTripSummary(baseUrl, { preset: "7d" });
    // The pill renders these two days, formatted by the renderer only.
    assert.ok(formatDay(summary.period.from).length === 10);
    assert.ok(summary.period.previousTo <= summary.period.from);
    assert.equal(
      summary.period.from - summary.period.previousFrom,
      summary.period.to - summary.period.from,
      "the comparison window must be the same length",
    );
  });
});

test("a road trip arrives as one trip with expandable legs", async () => {
  await withTripService(async ({ baseUrl, telemetry, gps, park }) => {
    const drive = new ScriptedDrive(telemetry, gps, T0);
    drive.minutes(25, 90);
    drive.park(20); // away from home: a layover, not the end of the journey
    drive.minutes(25, 90);
    drive.park(20, true);
    park(drive.now);

    const list = await fetchTrips(baseUrl);
    assert.equal(list.total, 1, "a layover away from home must not split the journey");
    assert.equal(list.trips[0].legs, 2);
    assert.equal(list.trips[0].isRoadTrip, true);

    const detail = await fetchTripDetail(baseUrl, list.trips[0].id);
    assert.equal(detail.stages.length, 2);
    assert.deepEqual(
      detail.stages.map((stage) => stage.stageNumber),
      [1, 2],
    );
    // The stats bar is computed over the same rows the totals are summed from.
    assert.ok(detail.stats.movingSeconds > 0);
    assert.ok((detail.stats.maxSpeedKmh ?? 0) >= 90);
    assert.ok((detail.stats.avgConsumptionLPer100km ?? 0) > 0);
  });
});

test("the map payload projects into the viewport with both markers inside", async () => {
  await withTripService(async ({ baseUrl, telemetry, gps, park }) => {
    const drive = new ScriptedDrive(telemetry, gps, T0);
    drive.minutes(30, 70).park(20, true);
    park(drive.now);

    const list = await fetchTrips(baseUrl);
    const coordinates = await fetchTripCoordinates(baseUrl, list.trips[0].id);

    assert.ok(coordinates.points.length > 0, "a drive must leave a trajectory");
    assert.ok(coordinates.bounds, "and its bounds");

    const projected = projectRoute(coordinates.points, TRIP_MAP_VIEWPORT);
    assert.ok(projected, "the route must project");
    for (const point of [projected.start, projected.end]) {
      assert.ok(point.x >= TRIP_MAP_VIEWPORT.padding, `x ${point.x} inside the box`);
      assert.ok(point.y >= TRIP_MAP_VIEWPORT.padding, `y ${point.y} inside the box`);
    }
    // The drive ends at home, so the geometry is a there-and-back: assert that
    // the polyline is a real path inside the box rather than a direction.
    assert.ok(projected.points.length > 1);
    const ys = projected.points.map((point) => point.y);
    assert.ok(Math.max(...ys) - Math.min(...ys) > 1, "the route must span some height");
  });
});

test("a trip with no trajectory reports an empty map rather than a broken one", async () => {
  await withTripService(async ({ baseUrl, telemetry, park }) => {
    const drive = new ScriptedDriveNoGps(telemetry, T0);
    drive.minutes(10, 60).park(20);
    park(drive.now);

    const list = await fetchTrips(baseUrl);
    assert.equal(list.total, 1);
    assert.ok(list.trips[0].totalDistanceKm > 8, "the odometer still measured the drive");
    assert.equal(list.trips[0].hasRoute, false);

    const coordinates = await fetchTripCoordinates(baseUrl, list.trips[0].id);
    assert.deepEqual(coordinates.points, []);
    assert.equal(coordinates.bounds, null);
    // This is the branch `RouteMap` renders its "no route recorded" state from.
    assert.equal(projectRoute(coordinates.points, TRIP_MAP_VIEWPORT), null);
  });
});

test("merging two adjacent trips produces one trip whose distance is their sum", async () => {
  await withTripService(async ({ baseUrl, telemetry, gps, park }) => {
    const first = new ScriptedDrive(telemetry, gps, T0, 20_000);
    first.minutes(20, 60).park(20, true);
    const second = new ScriptedDrive(telemetry, gps, first.now + 40 * MINUTE, 20_500);
    // Report the car at home before setting off, so this is a second journey
    // rather than a second leg of the first one.
    second.startAtHome();
    second.minutes(15, 50).park(20, true);
    park(second.now);

    const before = await fetchTrips(baseUrl);
    assert.equal(before.total, 2);
    const totalBefore = before.trips.reduce((sum, trip) => sum + trip.totalDistanceKm, 0);
    const [newest, older] = before.trips;

    const merged = await mergeTrips(baseUrl, [newest.id, older.id]);
    assert.equal(merged.legs, 2);
    assert.ok(Math.abs(merged.totalDistanceKm - totalBefore) < 1e-6, "a merge must not lose distance");

    const after = await fetchTrips(baseUrl);
    assert.equal(after.total, 1);
  });
});

test("merged trips can be split back into two, preserving every kilometre", async () => {
  await withTripService(async ({ baseUrl, telemetry, gps, park }) => {
    const drive = new ScriptedDrive(telemetry, gps, T0);
    drive.minutes(20, 70);
    drive.park(20);
    drive.minutes(20, 70);
    drive.park(20, true);
    park(drive.now);

    const list = await fetchTrips(baseUrl);
    const trip = list.trips[0];
    assert.equal(trip.legs, 2);
    const detail = await fetchTripDetail(baseUrl, trip.id);

    const result = await splitTrip(baseUrl, trip.id, detail.stages[1].id);
    assert.ok(Math.abs(result.trip.totalDistanceKm - detail.stages[0].distanceKm) < 1e-6);

    const after = await fetchTrips(baseUrl);
    assert.equal(after.total, 2);
    const total = after.trips.reduce((sum, entry) => sum + entry.totalDistanceKm, 0);
    assert.ok(
      Math.abs(total - trip.totalDistanceKm) < 1e-6,
      "a split must neither create nor lose distance",
    );
  });
});

test("a refused merge reports the service's own reason", async () => {
  await withTripService(async ({ baseUrl, telemetry, gps, park }) => {
    const drive = new ScriptedDrive(telemetry, gps, T0);
    drive.minutes(20, 60).park(20, true);
    park(drive.now);
    const list = await fetchTrips(baseUrl);
    const only = list.trips[0];

    await assert.rejects(
      () => mergeTrips(baseUrl, [only.id, only.id]),
      /two distinct trip ids/,
      "the renderer surfaces the service's message to the user",
    );
  });
});

test("status explains a machine with no telemetry, for the empty state", async () => {
  await withTripService(async ({ baseUrl }) => {
    const status = await fetchTripStatus(baseUrl);
    // No simulator, no GPS adapter: the apps can say *why* there is no data
    // instead of showing a bare "no trips".
    assert.equal(status.simulation, false);
    assert.equal(status.vehicleSamples, 0);
    assert.equal(status.tripCount, 0);
    assert.equal(status.preferences.consumptionUnit, "l_per_100km");
  });
});

test("every card arrives complete, so the renderer never aggregates", async () => {
  await withTripService(async ({ baseUrl, telemetry, gps, park }) => {
    const drive = new ScriptedDrive(telemetry, gps, T0);
    drive.minutes(40, 90).park(20, true);
    park(drive.now);

    const summary = await fetchTripSummary(baseUrl, { preset: "all" });
    for (const card of Object.values(summary.cards)) {
      assert.equal(typeof card.formatted, "string");
      assert.ok(card.formatted.length > 0, "a card is always displayable");
      assert.equal(typeof card.unit, "string");
      assert.ok(card.trend, "a card always carries its trend, even when not comparable");
    }
  });
});
