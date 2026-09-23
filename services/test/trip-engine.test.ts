/**
 * The segmentation state machine, driven by scripted samples.
 *
 * These are the cases the spec calls out by name (a 4-hour stop away from home
 * makes a two-stage trip; a 4-hour stop at home closes one trip and opens
 * another) plus the ones a real vehicle produces and a naive implementation
 * gets wrong: an idling engine, a fuel stop inside a stage, an odometer reset.
 *
 * The engine takes only ports, so there is no clock, database file or hardware
 * here: a literal array of samples is the whole input.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { StaticSettingsProvider } from "../trip-service/ports.js";
import { TripStore } from "../trip-service/store/store.js";
import { TripEngine } from "../trip-service/trip/engine.js";
import type { LocationSample, TripPreferences, VehicleSample } from "../trip-service/types.js";
import { DEFAULT_PREFERENCES } from "../trip-service/types.js";

const T0 = 1_718_000_000_000;
const SECOND = 1000;

const MODENA = { lat: 44.6471, lon: 10.9252 };
const BOLOGNA = { lat: 44.4949, lon: 11.3426 };

interface ScriptOptions {
  preferences?: Partial<TripPreferences>;
}

/** A scripted vehicle: the samples are the only thing the engine ever sees. */
class ScriptedDrive {
  readonly store = new TripStore(":memory:");
  readonly preferences: StaticSettingsProvider;
  readonly engine: TripEngine;

  private odoKm: number;
  private fuelL: number;
  private at: number;
  private lat: number;
  private lon: number;
  private readonly warnings: string[] = [];

  constructor(startOdometerKm = 10_000, options: ScriptOptions = {}) {
    this.odoKm = startOdometerKm;
    this.fuelL = 40;
    this.at = T0;
    this.lat = MODENA.lat;
    this.lon = MODENA.lon;
    this.preferences = new StaticSettingsProvider({
      ...DEFAULT_PREFERENCES,
      ...options.preferences,
    });
    this.engine = new TripEngine({
      writer: this.store,
      preferences: this.preferences,
      movementEpsilonKmh: 2,
      maxOdometerJumpKm: 500,
      refuelDeltaLiters: 2,
      flushIntervalMs: 1000,
    });
  }

  /** Records what a source would have reported, for assertions about noise. */
  get log(): readonly string[] {
    return this.warnings;
  }

  private sample(ignition: boolean, speedKmh: number): VehicleSample {
    return {
      timestamp: this.at,
      odometerKm: this.odoKm,
      speedKmh,
      fuelLevelLiters: this.fuelL,
      fuelFlowLph: null,
      ignition,
      engineRpm: ignition ? 900 : 0,
    };
  }

  /** Drives for `seconds` at `speedKmh`, one sample per second. */
  driveSeconds(seconds: number, speedKmh = 60): this {
    for (let i = 0; i < seconds; i += 1) {
      this.engine.ingestSample(this.sample(true, speedKmh));
      if (speedKmh > 0) {
        const km = speedKmh / 3600;
        this.odoKm += km;
        // Fuel falls while driving; the exact rate does not matter as long as
        // the tank model sees a monotonic decrease.
        this.fuelL = Math.max(0, this.fuelL - km * 0.07);
        const dLat = (km / 111.32) * Math.cos(Math.PI / 4);
        const dLon = (km / (111.32 * Math.cos((this.lat * Math.PI) / 180))) * Math.sin(Math.PI / 4);
        this.lat += dLat;
        this.lon += dLon;
        this.emitLocation(speedKmh);
      }
      this.at += SECOND;
    }
    return this;
  }

  driveMinutes(minutes: number, speedKmh = 60): this {
    return this.driveSeconds(Math.round(minutes * 60), speedKmh);
  }

  /** Engine off for `seconds`, optionally at a given place. */
  ignitionOffSeconds(seconds: number, where?: { lat: number; lon: number }): this {
    if (where) {
      this.lat = where.lat;
      this.lon = where.lon;
    }
    for (let i = 0; i < seconds; i += 1) {
      this.engine.ingestSample(this.sample(false, 0));
      this.at += SECOND;
    }
    return this;
  }

  ignitionOffMinutes(minutes: number, where?: { lat: number; lon: number }): this {
    return this.ignitionOffSeconds(Math.round(minutes * 60), where);
  }

  ignitionOffHours(hours: number, where?: { lat: number; lon: number }): this {
    return this.ignitionOffSeconds(Math.round(hours * 3600), where);
  }

  /** Adds fuel: a tank rise large enough to be detected as a refuel. */
  refuel(liters: number): this {
    this.fuelL += liters;
    return this;
  }

  /** A single sample with fuel added, while the engine is running. */
  refuelNow(liters: number): this {
    this.refuel(liters);
    this.engine.ingestSample(this.sample(true, 0));
    this.at += SECOND;
    return this;
  }

  /** Simulates an odometer reset (or a replaced cluster). */
  resetOdometer(toKm: number): this {
    this.odoKm = toKm;
    return this;
  }

  private emitLocation(speedKmh: number): void {
    const location: LocationSample = {
      timestamp: this.at,
      lat: this.lat,
      lon: this.lon,
      speedKmh,
      headingDeg: 45,
      fixQuality: 1,
    };
    this.engine.ingestLocation(location);
  }

  /** Feeds a GPS fix without a vehicle sample, for location-only tests. */
  gpsFix(where: { lat: number; lon: number }, speedKmh = 0): this {
    this.lat = where.lat;
    this.lon = where.lon;
    this.engine.ingestLocation({
      timestamp: this.at,
      lat: where.lat,
      lon: where.lon,
      speedKmh,
      headingDeg: null,
      fixQuality: 1,
    });
    return this;
  }

  /** Closes whatever is open, the way a shutdown does. */
  park(): this {
    this.engine.closeOpenStage(this.at);
    return this;
  }

  trips() {
    return this.store.listTrips({ limit: 100, offset: 0 }).trips;
  }

  stagesOf(tripId: number) {
    return this.store.listStages(tripId);
  }
}

/* -------------------------------------------------------------------------- */

test("a stage starts only once the car actually moves", () => {
  const drive = new ScriptedDrive();
  // Ignition on, engine idling, wheels still: no trip should exist yet.
  drive.driveSeconds(120, 0);
  assert.equal(drive.trips().length, 0, "an idling engine must not create a trip");

  drive.driveSeconds(300, 40);
  drive.ignitionOffMinutes(20);
  assert.equal(drive.trips().length, 1);

  const stages = drive.stagesOf(drive.trips()[0].id);
  assert.equal(stages.length, 1);
  assert.ok(stages[0].distanceKm > 0);
});

test("a stop shorter than the dwell threshold stays inside one stage", () => {
  const drive = new ScriptedDrive();
  drive.driveMinutes(10, 50);
  drive.ignitionOffMinutes(5, MODENA); // well under the 15-minute default
  drive.driveMinutes(10, 50);
  drive.ignitionOffMinutes(20);
  drive.park();

  assert.equal(drive.trips().length, 1);
  assert.equal(drive.stagesOf(drive.trips()[0].id).length, 1, "a fuel stop is not a new stage");
});

test("a 4-hour stop away from home creates a two-stage road trip", () => {
  const drive = new ScriptedDrive(10_000, {
    preferences: { homeGeofenceLat: MODENA.lat, homeGeofenceLon: MODENA.lon, homeGeofenceRadiusM: 300 },
  });

  drive.driveMinutes(60, 90); // to Bologna
  drive.ignitionOffHours(4, BOLOGNA); // 4 h layover, away from home
  drive.driveMinutes(45, 90);
  drive.ignitionOffMinutes(20, BOLOGNA);
  drive.park();

  const trips = drive.trips();
  assert.equal(trips.length, 1, "an away-from-home layover must not split the journey");
  assert.equal(trips[0].isRoadTrip, true, "a two-stage trip is a road trip");

  const stages = drive.stagesOf(trips[0].id);
  assert.equal(stages.length, 2, "the second leg is a new stage of the same trip");
  assert.deepEqual(
    stages.map((stage) => stage.stageNumber),
    [1, 2],
  );
  assert.ok(
    Math.abs(
      stages.reduce((sum, stage) => sum + stage.distanceKm, 0) - trips[0].totalDistanceKm,
    ) < 1e-6,
    "SUM(stages.distance) must equal the trip total",
  );
});

test("a 4-hour stop at home closes the trip and the next drive opens a new one", () => {
  const drive = new ScriptedDrive(20_000, {
    preferences: { homeGeofenceLat: MODENA.lat, homeGeofenceLon: MODENA.lon, homeGeofenceRadiusM: 300 },
  });

  // Out, back, then park at home. The return leg has to actually arrive: the
  // fence decision is about where the car *is*, so a test that stops 25 km away
  // is testing a layover, not a homecoming.
  drive.driveMinutes(30, 50);
  drive.driveSeconds(1, 0);
  drive.gpsFix(MODENA);
  drive.ignitionOffHours(4, MODENA);
  drive.driveMinutes(30, 50);
  drive.gpsFix(MODENA);
  drive.ignitionOffMinutes(20, MODENA);
  drive.park();

  const trips = drive.trips();
  assert.equal(trips.length, 2, "a stop at home ends the journey");
  assert.equal(trips.every((trip) => trip.isRoadTrip === false), true);
  assert.equal(drive.stagesOf(trips[0].id).length, 1);
  assert.equal(drive.stagesOf(trips[1].id).length, 1);
});

test("a stop longer than the layover limit ends the journey even away from home", () => {
  const drive = new ScriptedDrive(30_000, {
    preferences: { layoverHours: 18 },
  });

  drive.driveMinutes(60, 90);
  drive.ignitionOffHours(20, BOLOGNA); // past the 18 h limit
  drive.driveMinutes(60, 90);
  drive.ignitionOffMinutes(20, BOLOGNA);
  drive.park();

  assert.equal(drive.trips().length, 2, "beyond the layover limit the trip is finalized");
});

test("with no home fence configured a layover continues the trip", () => {
  const drive = new ScriptedDrive(40_000, { preferences: { homeGeofenceLat: null, homeGeofenceLon: null } });

  drive.driveMinutes(30, 80);
  drive.ignitionOffHours(5, BOLOGNA);
  drive.driveMinutes(30, 80);
  drive.ignitionOffMinutes(20);
  drive.park();

  const trips = drive.trips();
  assert.equal(trips.length, 1, "no fence means no evidence of being home, so the journey continues");
  assert.equal(drive.stagesOf(trips[0].id).length, 2);
});

test("an odometer reset never produces negative or absurd distance", () => {
  const drive = new ScriptedDrive(50_000);
  drive.driveMinutes(10, 60);
  const beforeReset = drive.stagesOf(drive.trips()[0]?.id ?? 1);
  void beforeReset;

  drive.resetOdometer(0); // cluster replaced mid-stage
  drive.driveMinutes(10, 60);
  drive.ignitionOffMinutes(20);
  drive.park();

  const trip = drive.trips()[0];
  assert.ok(trip.totalDistanceKm > 0, "distance must stay positive across a reset");
  // 20 minutes at 60 km/h is ~20 km; a reset must not add 50 000 km.
  assert.ok(trip.totalDistanceKm < 40, `distance exploded across the reset: ${trip.totalDistanceKm}`);
});

test("an odometer jump larger than the guard is treated as a reset, not a drive", () => {
  const drive = new ScriptedDrive(1_000);
  drive.driveMinutes(5, 60);
  // A single-sample jump of 10 000 km, e.g. a reflash.
  drive.resetOdometer(11_000);
  drive.driveMinutes(5, 60);
  drive.ignitionOffMinutes(20);
  drive.park();

  const trip = drive.trips()[0];
  assert.ok(trip.totalDistanceKm < 20, `guarded jump leaked into the total: ${trip.totalDistanceKm}`);
});

test("a tank rise is recorded as a refuel and is not counted as burned fuel", () => {
  const drive = new ScriptedDrive();
  drive.driveMinutes(20, 70);
  drive.refuelNow(25); // +25 l while stopped
  drive.driveMinutes(20, 70);
  drive.ignitionOffMinutes(20);
  drive.park();

  assert.equal(drive.store.countPendingRefuels(), 1, "the refuel is pending until priced");

  const events = drive.store.listFuelEvents();
  assert.equal(events.length, 1);
  assert.ok(events[0].litersAdded > 24 && events[0].litersAdded < 26);

  const trip = drive.trips()[0];
  // 40 minutes at 70 km/h ≈ 46.7 km, at ~7 l/100km ≈ 3.3 l. The +25 l refuel
  // must not appear in the burned total, and must not cancel real burn either.
  assert.ok(
    trip.totalFuelLiters > 0 && trip.totalFuelLiters < 6,
    `refuelled litres leaked into consumption: ${trip.totalFuelLiters}`,
  );
});

test("a small tank rise is not a refuel", () => {
  const drive = new ScriptedDrive();
  drive.driveMinutes(10, 60);
  drive.refuelNow(0.4); // below the 2 l threshold: sensor noise
  drive.driveMinutes(10, 60);
  drive.ignitionOffMinutes(20);
  drive.park();

  assert.equal(drive.store.countPendingRefuels(), 0, "noise must not raise a refuel prompt");
});

test("average consumption is derived from distance and litres, not from speed", () => {
  const drive = new ScriptedDrive();
  drive.driveSeconds(3600, 100); // exactly one hour at 100 km/h → 100 km
  drive.ignitionOffMinutes(20);
  drive.park();

  const trip = drive.trips()[0];
  assert.ok(Math.abs(trip.totalDistanceKm - 100) < 1, `expected ~100 km, got ${trip.totalDistanceKm}`);

  const stage = drive.stagesOf(trip.id)[0];
  assert.ok(stage.avgConsumptionLPer100km !== null);
  const expected = (stage.fuelLiters / stage.distanceKm) * 100;
  assert.ok(Math.abs((stage.avgConsumptionLPer100km ?? 0) - expected) < 1e-9);
  assert.ok(Math.abs((stage.avgSpeedKmh ?? 0) - 100) < 2, `avg speed ${stage.avgSpeedKmh}`);
  assert.ok(Math.abs((stage.maxSpeedKmh ?? 0) - 100) < 5);
  assert.ok(stage.movingSeconds > 3500, `moving seconds ${stage.movingSeconds}`);
});

test("power-loss recovery closes trips left active and keeps their totals", () => {
  const drive = new ScriptedDrive(60_000);
  drive.driveMinutes(15, 60);
  // No park(): the battery is cut mid-stage.

  assert.equal(drive.store.getOpenTrip()?.status, "active");
  const tripId = drive.store.getOpenTrip()?.id ?? 0;
  assert.ok(tripId > 0);

  // A fresh engine over the same store is what a reboot looks like.
  const revived = new TripEngine({
    writer: drive.store,
    preferences: drive.preferences,
    movementEpsilonKmh: 2,
    maxOdometerJumpKm: 500,
    refuelDeltaLiters: 2,
  });
  revived.recover();

  const trip = drive.store.getTrip(tripId);
  assert.equal(trip?.status, "completed", "recovery must close the trip");
  assert.ok((trip?.endTime ?? 0) > 0, "recovery must stamp an end time");
  assert.ok((trip?.totalDistanceKm ?? 0) > 0, "recovered totals must be recomputed");
});

test("a slow drive is decimated below the raw fix rate, keeping points >=20 m apart", () => {
  const drive = new ScriptedDrive();
  // 20 km/h is ~5.6 m/s, so consecutive one-per-second fixes are inside the 20 m
  // keep-threshold and the straight line never satisfies the turn test. Fixes are
  // therefore only accepted once enough of them have accumulated to cross it.
  // The ignition-off prefix is the real-world case this protects: a parked car
  // still reports fixes, and they must not become a trajectory.
  drive.ignitionOffMinutes(30); // parked, but the receiver keeps reporting fixes
  drive.driveSeconds(1, 20); // first movement: starts the stage
  drive.driveMinutes(29, 20);
  drive.ignitionOffMinutes(20);
  drive.park();

  const trip = drive.trips()[0];
  const coordinates = drive.store.listCoordinates(trip.id);
  assert.ok(coordinates.length > 1);
  assert.ok(
    coordinates.length < 900,
    `expected decimation below the 1800 raw fixes, got ${coordinates.length}`,
  );

  // The contract the decimator promises: no two stored points are closer than
  // the 20 m threshold. A tolerance of 1 m absorbs the equirectangular error in
  // the test's own position stepping.
  for (let i = 1; i < coordinates.length; i += 1) {
    const previous = coordinates[i - 1];
    const current = coordinates[i];
    const meters = Math.hypot(
      (current.lat - previous.lat) * 111_320,
      (current.lon - previous.lon) * 111_320 * Math.cos((current.lat * Math.PI) / 180),
    );
    assert.ok(meters >= 19, `stored points ${i - 1}/${i} are only ${meters.toFixed(1)} m apart`);
  }
  assert.ok(
    coordinates.every((point) => Number.isFinite(point.lat) && Number.isFinite(point.lon)),
  );
});

test("every stored trajectory point keeps its speed for the map overlay", () => {
  const drive = new ScriptedDrive();
  drive.driveMinutes(30, 90);
  drive.ignitionOffMinutes(20);
  drive.park();

  const trip = drive.trips()[0];
  const coordinates = drive.store.listCoordinates(trip.id);
  // At 90 km/h each fix moves ~25 m, past the 20 m threshold, so nothing is
  // dropped: the decimator must not be *losing* points it should keep.
  assert.equal(coordinates.length, 1800, `expected the whole stream, got ${coordinates.length}`);
  assert.ok(coordinates.every((point) => point.speedKmh === 90));
  assert.equal(coordinates[0].timestamp < coordinates[coordinates.length - 1].timestamp, true);
});

test("location can arrive without any vehicle samples", () => {
  const drive = new ScriptedDrive();
  // A GPS-only start (service booted, CAN silent) must not crash and must not
  // invent a trip.
  drive.gpsFix(MODENA);
  drive.gpsFix(BOLOGNA);
  assert.equal(drive.trips().length, 0);
});

test("ignition off with no trip open is a no-op", () => {
  const drive = new ScriptedDrive();
  drive.ignitionOffMinutes(30);
  assert.equal(drive.trips().length, 0);
  assert.equal(drive.engine.status().vehicleSamples, 1800);
});

test("segmentation thresholds come from preferences, not from constants", () => {
  const driven = (dwellMinutes: number) => {
    const drive = new ScriptedDrive(70_000, {
      preferences: { stageDwellMinutes: dwellMinutes, layoverHours: 18 },
    });
    drive.driveMinutes(10, 60);
    drive.ignitionOffMinutes(20, BOLOGNA);
    drive.driveMinutes(10, 60);
    drive.ignitionOffMinutes(dwellMinutes + 5, BOLOGNA);
    drive.park();
    return drive.store.listTrips({ limit: 10, offset: 0 }).trips.length;
  };

  // With a 60-minute dwell the 20-minute stop stays inside one stage and the
  // journey continues, so a single trip results.
  assert.equal(driven(60), 1);
});
