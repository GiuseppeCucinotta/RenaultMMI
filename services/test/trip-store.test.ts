/**
 * The persistence and read model.
 *
 * The spec's parity invariants (`SUM(stages) == trip`) are asserted after every
 * mutation that can break them, because that is the real contract of this file:
 * aggregates are recomputed from stage rows rather than patched, so a merge or a
 * delete can never leave a total describing data that is gone.
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { TripStore } from "../trip-service/store/store.js";
import { SCHEMA_VERSION, migrate } from "../trip-service/store/schema.js";
import type { StagePatch } from "../trip-service/store/store.js";

const T0 = 1_718_000_000_000;
const MINUTE = 60_000;

function patch(overrides: Partial<StagePatch> = {}): StagePatch {
  return {
    endTime: T0 + MINUTE,
    distanceKm: 10,
    fuelLiters: 0.7,
    idleSeconds: 30,
    movingSeconds: 600,
    maxSpeedKmh: 90,
    avgSpeedKmh: 60,
    status: "completed",
    ...overrides,
  };
}

/** Opens a trip with `n` completed stages, each 10 km / 0.7 l. */
function tripWithStages(store: TripStore, n: number, startTime = T0): number {
  const tripId = store.openTrip(startTime, 1_000);
  for (let i = 0; i < n; i += 1) {
    const stageId = store.openStage(tripId, startTime + i * MINUTE, 1_000 + i * 10);
    store.finishStage(
      stageId,
      patch({ endTime: startTime + (i + 1) * MINUTE, distanceKm: 10, fuelLiters: 0.7 }),
    );
  }
  return tripId;
}

/* --------------------------------- schema --------------------------------- */

test("a fresh store is created at the current schema version", () => {
  const store = new TripStore(":memory:");
  const version = store.database.prepare("PRAGMA user_version").get() as {
    user_version: number;
  };
  assert.equal(Number(version.user_version), SCHEMA_VERSION);
  store.close();
});

test("migrating twice is a no-op", () => {
  const store = new TripStore(":memory:");
  assert.equal(migrate(store.database), SCHEMA_VERSION);
  assert.equal(migrate(store.database), SCHEMA_VERSION);
  store.close();
});

test("foreign keys are enforced so deleting a trip cannot orphan stages", () => {
  const store = new TripStore(":memory:");
  const tripId = tripWithStages(store, 2);
  store.database.exec(`DELETE FROM trips WHERE id = ${tripId}`);
  assert.equal(store.listStages(tripId).length, 0, "stages must cascade with their trip");
  store.close();
});

/* ------------------------------- aggregates -------------------------------- */

test("finishing a stage recomputes its trip totals", () => {
  const store = new TripStore(":memory:");
  const tripId = tripWithStages(store, 3);
  const trip = store.getTrip(tripId);
  assert.ok(Math.abs((trip?.totalDistanceKm ?? 0) - 30) < 1e-9);
  assert.ok(Math.abs((trip?.totalFuelLiters ?? 0) - 2.1) < 1e-9);
  store.close();
});

test("an in-progress stage contributes nothing to the trip totals", () => {
  const store = new TripStore(":memory:");
  const tripId = store.openTrip(T0, 1_000);
  const first = store.openStage(tripId, T0, 1_000);
  store.finishStage(first, patch({ distanceKm: 10, fuelLiters: 0.7 }));

  const open = store.openStage(tripId, T0 + MINUTE, 1_010);
  store.updateStage(open, patch({ endTime: null, distanceKm: 5, fuelLiters: 0.4, status: "active" }));

  const trip = store.getTrip(tripId);
  assert.ok(Math.abs((trip?.totalDistanceKm ?? 0) - 10) < 1e-9, "live progress is not history");
  store.close();
});

test("SUM(stages) equals the trip totals after every mutation", () => {
  const store = new TripStore(":memory:");
  const tripId = tripWithStages(store, 3);
  const extras = store.openTrip(T0 + 10 * MINUTE, 2_000);
  const extrasStage = store.openStage(extras, T0 + 10 * MINUTE, 2_000);
  store.finishStage(extrasStage, patch({ distanceKm: 4, fuelLiters: 0.3 }));

  const check = (id: number) => {
    const trip = store.getTrip(id);
    const stages = store.listStages(id);
    const distance = stages.reduce((sum, stage) => sum + stage.distanceKm, 0);
    const liters = stages.reduce((sum, stage) => sum + stage.fuelLiters, 0);
    assert.ok(
      Math.abs((trip?.totalDistanceKm ?? 0) - distance) < 1e-9,
      `trip ${id} distance drifted`,
    );
    assert.ok(
      Math.abs((trip?.totalFuelLiters ?? 0) - liters) < 1e-9,
      `trip ${id} litres drifted`,
    );
  };

  check(tripId);
  check(extras);

  store.mergeTrips(tripId, extras);
  check(tripId);

  const merged = store.listStages(tripId);
  store.splitTrip(tripId, merged[merged.length - 1].id);
  for (const trip of store.listTrips({ limit: 50, offset: 0 }).trips) check(trip.id);

  store.close();
});

/* ------------------------------- merge / split ----------------------------- */

test("merging two adjacent trips combines their stages and renumbers them", () => {
  const store = new TripStore(":memory:");
  const first = tripWithStages(store, 2, T0);
  const second = tripWithStages(store, 2, T0 + 30 * MINUTE);

  store.mergeTrips(first, second);

  assert.equal(store.getTrip(second), null, "the merged trip is gone");
  const stages = store.listStages(first);
  assert.deepEqual(
    stages.map((stage) => stage.stageNumber),
    [1, 2, 3, 4],
    "stage numbers are renumbered in chronological order",
  );
  assert.equal(store.getTrip(first)?.isRoadTrip, true, "a merge produces a multi-stage trip");
  assert.ok(Math.abs((store.getTrip(first)?.totalDistanceKm ?? 0) - 40) < 1e-9);
  store.close();
});

test("splitting a trip moves the chosen stage and everything after it", () => {
  const store = new TripStore(":memory:");
  const tripId = tripWithStages(store, 4);
  const stages = store.listStages(tripId);
  const newTripId = store.splitTrip(tripId, stages[2].id);

  assert.deepEqual(
    store.listStages(tripId).map((stage) => stage.id),
    [stages[0].id, stages[1].id],
  );
  assert.deepEqual(
    store.listStages(newTripId).map((stage) => stage.stageNumber),
    [1, 2],
  );
  assert.ok(Math.abs((store.getTrip(tripId)?.totalDistanceKm ?? 0) - 20) < 1e-9);
  assert.ok(Math.abs((store.getTrip(newTripId)?.totalDistanceKm ?? 0) - 20) < 1e-9);
  store.close();
});

test("splitting before the first stage is refused", () => {
  const store = new TripStore(":memory:");
  const tripId = tripWithStages(store, 2);
  const first = store.listStages(tripId)[0];
  assert.throws(() => store.splitTrip(tripId, first.id), /cannot split before the first stage/);
  store.close();
});

test("deleting a stage drops its coordinates and recomputes the trip", () => {
  const store = new TripStore(":memory:");
  const tripId = store.openTrip(T0, 1_000);
  const keep = store.openStage(tripId, T0, 1_000);
  store.finishStage(keep, patch({ distanceKm: 10 }));
  store.appendCoordinates(keep, [
    { timestamp: T0, lat: 44.6, lon: 10.9, speedKmh: 50, consumptionLPer100km: null },
  ]);

  const discard = store.openStage(tripId, T0 + MINUTE, 1_010);
  store.updateStage(discard, patch({ endTime: null, distanceKm: 8, status: "active" }));

  store.deleteStage(discard);

  assert.equal(store.listStages(tripId).length, 1);
  assert.ok(Math.abs((store.getTrip(tripId)?.totalDistanceKm ?? 0) - 10) < 1e-9);
  assert.equal(store.listCoordinates(tripId).length, 1);
  store.close();
});

/* ------------------------------- coordinates ------------------------------- */

test("coordinates round-trip in timestamp order with speed and consumption", () => {
  const store = new TripStore(":memory:");
  const tripId = store.openTrip(T0, 1_000);
  const stageId = store.openStage(tripId, T0, 1_000);
  store.finishStage(stageId, patch());

  store.appendCoordinates(stageId, [
    { timestamp: T0 + 2000, lat: 44.6, lon: 10.9, speedKmh: 60, consumptionLPer100km: 6.1 },
    { timestamp: T0, lat: 44.5, lon: 10.8, speedKmh: 50, consumptionLPer100km: null },
  ]);

  const points = store.listCoordinates(tripId);
  assert.equal(points.length, 2);
  assert.equal(points[0].timestamp, T0, "points come back ordered");
  assert.equal(points[0].speedKmh, 50);
  assert.equal(points[0].consumptionLPer100km, null);
  assert.equal(points[1].consumptionLPer100km, 6.1);

  assert.deepEqual(store.coordinatesBounds(tripId), {
    minLat: 44.5,
    minLon: 10.8,
    maxLat: 44.6,
    maxLon: 10.9,
  });
  assert.equal(store.lastPosition(tripId)?.timestamp, T0 + 2000);
  store.close();
});

test("a trip with no coordinates has no bounds and no last position", () => {
  const store = new TripStore(":memory:");
  const tripId = tripWithStages(store, 1);
  assert.equal(store.coordinatesBounds(tripId), null);
  assert.equal(store.lastPosition(tripId), null);
  store.close();
});

/* ---------------------------------- fuel ---------------------------------- */

test("a refuel is pending until it is priced, and pricing it records the price", () => {
  const store = new TripStore(":memory:");
  const tripId = store.openTrip(T0, 1_000);
  const stageId = store.openStage(tripId, T0, 1_000);
  store.finishStage(stageId, patch());

  const eventId = store.recordRefuel({
    timestamp: T0 + MINUTE,
    litersAdded: 22.4,
    levelBeforeL: 12,
    levelAfterL: 34.4,
    tripId,
    stageId,
  });

  assert.equal(store.countPendingRefuels(), 1);
  assert.equal(store.listFuelEvents({ pendingOnly: true }).length, 1);

  const price = store.confirmRefuel(eventId, 1.799, "EUR");
  assert.equal(price?.pricePerLiter, 1.799);
  assert.equal(store.countPendingRefuels(), 0);
  assert.equal(store.listFuelPrices().length, 1);
  assert.equal(store.listFuelEvents()[0].confirmed, true);
  store.close();
});

test("confirming an unknown refuel returns null instead of inventing one", () => {
  const store = new TripStore(":memory:");
  assert.equal(store.confirmRefuel(999, 1.8, "EUR"), null);
  assert.equal(store.listFuelPrices().length, 0);
  store.close();
});

/* ------------------------------- trip lists -------------------------------- */

test("trips are listed newest first and paged", () => {
  const store = new TripStore(":memory:");
  tripWithStages(store, 1, T0);
  tripWithStages(store, 1, T0 + MINUTE);
  tripWithStages(store, 1, T0 + 2 * MINUTE);

  const page = store.listTrips({ limit: 2, offset: 0 });
  assert.equal(page.total, 3);
  assert.equal(page.trips.length, 2);
  assert.ok(page.trips[0].startTime > page.trips[1].startTime, "newest first");

  const second = store.listTrips({ limit: 2, offset: 2 });
  assert.equal(second.trips.length, 1);
  store.close();
});

test("window queries select stages by start time", () => {
  const store = new TripStore(":memory:");
  tripWithStages(store, 3, T0);
  assert.equal(store.listStagesInWindow(T0, T0 + 3 * MINUTE).length, 3);
  assert.equal(store.listStagesInWindow(T0 + MINUTE, T0 + 2 * MINUTE).length, 1);
  assert.equal(store.hasDataInWindow(T0, T0 + MINUTE), true);
  assert.equal(store.hasDataInWindow(T0 - 10 * MINUTE, T0 - MINUTE), false);
  assert.equal(store.earliestStageTime(), T0);
  store.close();
});

/* ------------------------------- durability -------------------------------- */

test("a store reopens with its data, and totals survive the round trip", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "trip-store-"));
  const file = path.join(dir, "trips.db");
  try {
    const first = new TripStore(file);
    const tripId = tripWithStages(first, 2);
    first.savePreferences(JSON.stringify({ consumptionUnit: "km_per_l" }));
    first.close();

    const reopened = new TripStore(file);
    assert.equal(reopened.tripCount(), 1);
    assert.ok(Math.abs((reopened.getTrip(tripId)?.totalDistanceKm ?? 0) - 20) < 1e-9);
    assert.equal(
      reopened.loadPreferences(),
      JSON.stringify({ consumptionUnit: "km_per_l" }),
      "the settings snapshot must outlive a restart",
    );
    reopened.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the settings snapshot is overwritten, not duplicated", () => {
  const store = new TripStore(":memory:");
  store.savePreferences('{"a":1}');
  store.savePreferences('{"a":2}');
  assert.equal(store.loadPreferences(), '{"a":2}');
  store.close();
});

test("a failed transaction rolls back completely", () => {
  const store = new TripStore(":memory:");
  try {
    store.transaction(() => {
      store.openTrip(T0, 1_000);
      throw new Error("boom");
    });
  } catch {
    // expected
  }
  assert.equal(store.tripCount(), 0, "a rolled-back trip must not exist");
  store.close();
});
