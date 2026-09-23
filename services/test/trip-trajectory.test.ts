/**
 * Trajectory geometry: decimation, simplification, bounds and projection.
 *
 * This whole module is pure, which is the point: the map pipeline is testable
 * with literal arrays, so swapping the GPS adapter later cannot change a single
 * plotted point. The cases below are the geometric degeneracies a real drive
 * produces — a car parked with a live GPS, a perfectly straight motorway run,
 * one lonely fix, and collinear points.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEFAULT_DECIMATION,
  TrajectoryCollector,
  angleDeltaDegrees,
  bearingDegrees,
  boundsOf,
  decimate,
  haversineMeters,
  projectTrajectory,
  simplifyRdp,
} from "../trip-service/trip/trajectory.js";
import type { LocationSample, StoredCoordinate } from "../trip-service/types.js";

const ORIGIN = { lat: 44.6471, lon: 10.9252 };

function fix(
  lat: number,
  lon: number,
  timestamp = 0,
  speedKmh: number | null = 50,
): LocationSample {
  return { timestamp, lat, lon, speedKmh, headingDeg: 45, fixQuality: 1 };
}

/** Moves `meters` metres due north from `ORIGIN`, which keeps the maths obvious. */
function northOf(meters: number): { lat: number; lon: number } {
  return { lat: ORIGIN.lat + meters / 111_320, lon: ORIGIN.lon };
}

function stored(lat: number, lon: number, timestamp = 0): StoredCoordinate {
  return { timestamp, lat, lon, speedKmh: 50, consumptionLPer100km: null };
}

/* --------------------------------- distance -------------------------------- */

test("haversine distance matches a known displacement", () => {
  // One thousandth of a degree of latitude is ~111.2 m.
  const meters = haversineMeters(ORIGIN, northOf(111.2));
  assert.ok(Math.abs(meters - 111.2) < 0.5, `got ${meters}`);
  assert.equal(haversineMeters(ORIGIN, ORIGIN), 0);
});

test("bearing is east of north for an eastward step and reversible", () => {
  const east = { lat: ORIGIN.lat, lon: ORIGIN.lon + 0.001 };
  assert.ok(Math.abs(bearingDegrees(ORIGIN, east) - 90) < 0.5);
  assert.ok(Math.abs(bearingDegrees(east, ORIGIN) - 270) < 0.5);
});

test("angle delta wraps around north instead of reading 359 degrees", () => {
  assert.equal(angleDeltaDegrees(359, 1), 2);
  assert.equal(angleDeltaDegrees(1, 359), 2);
  assert.equal(angleDeltaDegrees(0, 180), 180);
});

/* -------------------------------- decimation ------------------------------- */

test("the first fix is always kept so a trajectory has a start", () => {
  const collector = new TrajectoryCollector();
  const kept = collector.push(fix(ORIGIN.lat, ORIGIN.lon));
  assert.ok(kept);
  assert.equal(kept.lat, ORIGIN.lat);
});

test("a parked car with a live GPS does not accumulate points", () => {
  const collector = new TrajectoryCollector();
  collector.push(fix(ORIGIN.lat, ORIGIN.lon, 0));
  // A stationary receiver reports metre-level noise, which must not become a
  // trajectory: 100 parked fixes keep exactly zero extra points.
  for (let i = 1; i <= 100; i += 1) {
    const drift = i * 1e-6; // ~0.1 m of jitter per fix
    const kept = collector.push(fix(ORIGIN.lat + drift, ORIGIN.lon, i * 1000, 0));
    assert.equal(kept, null, `fix ${i} was kept while parked`);
  }
  assert.equal(collector.lastPoint?.timestamp, 0);
});

test("a straight run keeps a point only once it has travelled the threshold", () => {
  const collector = new TrajectoryCollector();
  collector.push(fix(ORIGIN.lat, ORIGIN.lon, 0));
  const kept: StoredCoordinate[] = [];
  // 5 m per fix: the fourth crosses the 20 m threshold and is kept.
  for (let i = 1; i <= 12; i += 1) {
    const point = collector.push(fix(northOf(i * 5).lat, ORIGIN.lon, i * 1000, 18));
    if (point) kept.push(point);
  }
  // 20 m is crossed by the 5th fix at 25 m, then again at 50 and 75 m.
  assert.deepEqual(
    kept.map((point) => point.timestamp),
    [5000, 10_000],
  );
});

test("a turn keeps a point without covering the distance threshold", () => {
  const collector = new TrajectoryCollector();
  collector.push(fix(ORIGIN.lat, ORIGIN.lon, 0));

  // 30 m due north establishes a heading and crosses the distance threshold.
  const north = northOf(30);
  assert.ok(collector.push(fix(north.lat, north.lon, 1000, 30)), "the leg itself is kept");

  // Now 15 m due east: still under the 20 m keep-threshold, so distance alone
  // would drop it — but it is a 90-degree turn and the route shape must survive.
  const metersPerDegreeLon = 111_320 * Math.cos((north.lat * Math.PI) / 180);
  const turned = collector.push(
    fix(north.lat, north.lon + 15 / metersPerDegreeLon, 2000, 30),
  );
  assert.ok(turned, "a 90-degree turn 15 m after the last point must be kept");
});

test("turn detection needs enough displacement to be geometrically real", () => {
  // Documented limit: the bearing between two fixes only means something once
  // they are far enough apart that coordinate quantization stops dominating it.
  // A 1 m step at 44.6 degrees north has its bearing swamped by double rounding,
  // so a hairpin at walking pace is not claimed as a turn. That is the honest
  // trade: no false corners on a parked car, at the cost of very tight ones.
  const collector = new TrajectoryCollector();
  collector.push(fix(ORIGIN.lat, ORIGIN.lon, 0));
  const north = northOf(30);
  collector.push(fix(north.lat, north.lon, 1000, 30));

  const metersPerDegreeLon = 111_320 * Math.cos((north.lat * Math.PI) / 180);
  const tiny = collector.push(fix(north.lat, north.lon + 1 / metersPerDegreeLon, 2000, 30));
  assert.equal(tiny, null, "a 1 m step is below the geometric noise floor");
});

test("decimate() is the offline equivalent of the streaming collector", () => {
  const points = Array.from({ length: 20 }, (_, i) =>
    stored(northOf(i * 5).lat, ORIGIN.lon, i * 1000),
  );
  const kept = decimate(points);
  assert.ok(kept.length > 0 && kept.length < points.length);
  // No two kept points are closer than the threshold.
  for (let i = 1; i < kept.length; i += 1) {
    const meters = haversineMeters(kept[i - 1], kept[i]);
    assert.ok(
      meters >= DEFAULT_DECIMATION.minDistanceM - 0.5,
      `kept points ${i - 1}/${i} are ${meters.toFixed(1)} m apart`,
    );
  }
});

test("consumption travels with each kept point for the map overlay", () => {
  const collector = new TrajectoryCollector();
  collector.push(fix(ORIGIN.lat, ORIGIN.lon, 0), 6.4);
  const kept = collector.push(fix(northOf(25).lat, ORIGIN.lon, 1000, 50), 7.1);
  assert.equal(kept?.consumptionLPer100km, 7.1);
});

/* ------------------------------- simplification ---------------------------- */

test("RDP keeps the endpoints and removes collinear interior points", () => {
  const line = [0, 1, 2, 3, 4].map((i) => ({ lat: ORIGIN.lat + i * 0.001, lon: ORIGIN.lon }));
  const simplified = simplifyRdp(line, 5);
  assert.equal(simplified.length, 2, "a perfectly straight line is two points");
  assert.deepEqual(simplified[0], line[0]);
  assert.deepEqual(simplified[simplified.length - 1], line[4]);
});

test("RDP keeps a point that is genuinely off the line", () => {
  // A straight east-west run with one lateral excursion. Note that the
  // intermediate points *on* the line become far from the *simplified* segment
  // once the spike is kept, so RDP legitimately retains them too: the correct
  // expectation is every point, with the spike among them.
  const points = [
    { lat: 0, lon: 0 },
    { lat: 0, lon: 0.001 },
    { lat: 0.002, lon: 0.002 }, // ~222 m off the east-west line
    { lat: 0, lon: 0.003 },
    { lat: 0, lon: 0.004 },
  ];
  const simplified = simplifyRdp(points, 50);
  assert.equal(simplified.length, 5);
  assert.ok(simplified.includes(points[2]), "the excursion must survive");
});

test("RDP collapses a straight line even when a spike sits on it", () => {
  // No lateral deviation at all: only the endpoints survive.
  const points = Array.from({ length: 200 }, (_, i) => ({
    lat: 44.6471,
    lon: 10.9 + i * 0.0001,
  }));
  assert.equal(simplifyRdp(points, 20).length, 2);
});

test("RDP on two or fewer points returns them unchanged", () => {
  const pair = [{ lat: 1, lon: 2 }, { lat: 3, lon: 4 }];
  assert.deepEqual(simplifyRdp(pair, 1), pair);
  assert.deepEqual(simplifyRdp([], 1), []);
  assert.deepEqual(simplifyRdp([{ lat: 1, lon: 2 }], 1), [{ lat: 1, lon: 2 }]);
});

test("RDP handles a long straight run without recursing to death", () => {
  const points = Array.from({ length: 20_000 }, (_, i) => ({
    lat: ORIGIN.lat + i * 1e-6,
    lon: ORIGIN.lon,
  }));
  const simplified = simplifyRdp(points, 1);
  assert.equal(simplified.length, 2);
});

/* ---------------------------------- bounds --------------------------------- */

test("bounds cover every point", () => {
  const bounds = boundsOf([
    { lat: 45, lon: 9 },
    { lat: 44, lon: 11 },
    { lat: 44.5, lon: 10 },
  ]);
  assert.deepEqual(bounds, { minLat: 44, minLon: 9, maxLat: 45, maxLon: 11 });
});

test("an empty point list has no bounds", () => {
  assert.equal(boundsOf([]), null);
});

/* -------------------------------- projection ------------------------------- */

test("projection keeps every point inside the viewport and preserves order", () => {
  const path = [
    { lat: ORIGIN.lat, lon: ORIGIN.lon },
    { lat: ORIGIN.lat + 0.01, lon: ORIGIN.lon + 0.01 },
    { lat: ORIGIN.lat + 0.02, lon: ORIGIN.lon },
  ];
  const projected = projectTrajectory(path, { width: 400, height: 300, padding: 10 });
  assert.equal(projected.points.length, 3);

  for (const point of projected.points) {
    assert.ok(point.x >= 10 && point.x <= 390, `x out of bounds: ${point.x}`);
    assert.ok(point.y >= 10 && point.y <= 290, `y out of bounds: ${point.y}`);
  }

  // North is up: the northernmost point must have the smallest y.
  const ys = projected.points.map((point) => point.y);
  assert.ok(ys[2] < ys[0]);
  assert.ok(projected.metersPerUnit > 0);
});

test("projecting a single point centres it instead of dividing by zero", () => {
  const projected = projectTrajectory([ORIGIN], { width: 100, height: 100, padding: 10 });
  assert.equal(projected.points.length, 1);
  assert.ok(Number.isFinite(projected.points[0].x));
  assert.ok(Number.isFinite(projected.points[0].y));
  assert.equal(projected.totalMeters, 0);
});

test("projecting nothing yields nothing rather than throwing", () => {
  const projected = projectTrajectory([], { width: 100, height: 100, padding: 10 });
  assert.deepEqual(projected.points, []);
  assert.equal(projected.totalMeters, 0);
});

test("projected path length matches the geodesic distance", () => {
  const path = [ORIGIN, northOf(1000)];
  const projected = projectTrajectory(path, { width: 200, height: 200, padding: 5 });
  assert.ok(Math.abs(projected.totalMeters - 1000) < 5, `got ${projected.totalMeters}`);
});
