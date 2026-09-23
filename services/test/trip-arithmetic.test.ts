/**
 * Consumption and cost arithmetic.
 *
 * These are the numbers a user reads as their fuel bill, so the cases that get
 * asserted are the ones where a plausible implementation lies: a tank that rose
 * (a refuel, not negative consumption), a distance of zero (no average, not
 * infinity), an odometer that went backwards (a reset, not negative distance),
 * and litres burned before any price was known (unknown, not free).
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  classifyTankDelta,
  consumptionFrom,
  formatMetric,
  litersFromFlow,
  odometerStep,
  round,
  toKmPerL,
  toLPer100km,
} from "../trip-service/trip/consumption.js";
import { attributeCosts } from "../trip-service/trip/cost.js";

/* ------------------------------- consumption ------------------------------- */

test("consumption is reported in both units and they are reciprocals", () => {
  const { lPer100km, kmPerL } = consumptionFrom(6.5, 100);
  assert.ok(Math.abs((lPer100km ?? 0) - 6.5) < 1e-9);
  assert.ok(Math.abs((kmPerL ?? 0) - 100 / 6.5) < 1e-9);
  assert.ok(Math.abs((toKmPerL(lPer100km) ?? 0) - (kmPerL ?? 0)) < 1e-9);
  assert.ok(Math.abs((toLPer100km(kmPerL) ?? 0) - (lPer100km ?? 0)) < 1e-9);
});

test("a zero distance has no average consumption, not an infinite one", () => {
  const result = consumptionFrom(3, 0);
  assert.equal(result.lPer100km, null);
  assert.equal(result.kmPerL, null);
});

test("zero litres burned is no data, not infinite efficiency", () => {
  // Stopped with the engine off: 0 litres over 0 km is unknown, and over some
  // kilometres it is "no fuel measured", which must not read as 0 l/100km.
  assert.deepEqual(consumptionFrom(0, 10), { lPer100km: 0, kmPerL: null });
  assert.equal(consumptionFrom(0, 0).lPer100km, null);
});

test("a tank rise is a refuel: zero litres burned, never negative", () => {
  const rise = classifyTankDelta(30, 55);
  assert.equal(rise.isRise, true);
  assert.equal(rise.litersBurned, 0, "a refuel must not count as negative consumption");
  assert.equal(rise.deltaLiters, 25);
});

test("a tank fall burns its litres", () => {
  const fall = classifyTankDelta(40, 37.5);
  assert.equal(fall.isRise, false);
  assert.ok(Math.abs(fall.litersBurned - 2.5) < 1e-9);
  assert.ok(Math.abs(fall.deltaLiters + 2.5) < 1e-9);
});

test("a flow series integrates trapezoidally over time", () => {
  // 2 l/h held for 30 minutes is 1 l.
  const liters = litersFromFlow([
    { timestamp: 0, flowLph: 2 },
    { timestamp: 1_800_000, flowLph: 2 },
  ]);
  assert.ok(Math.abs(liters - 1) < 1e-9);

  // A ramp from 0 to 4 l/h over an hour averages 2 l/h, so 2 l.
  const ramp = litersFromFlow([
    { timestamp: 0, flowLph: 0 },
    { timestamp: 3_600_000, flowLph: 4 },
  ]);
  assert.ok(Math.abs(ramp - 2) < 1e-9);
});

test("a flow series with no time step contributes nothing", () => {
  assert.equal(
    litersFromFlow([
      { timestamp: 5, flowLph: 10 },
      { timestamp: 5, flowLph: 10 },
    ]),
    0,
  );
});

/* -------------------------------- odometer -------------------------------- */

test("an odometer step is the difference between two readings", () => {
  assert.equal(odometerStep(1_000, 1_012.5, 500), 12.5);
});

test("an odometer that did not advance contributes zero distance", () => {
  assert.equal(odometerStep(1_000, 1_000, 500), 0);
});

test("an odometer that went backwards is a reset, not negative distance", () => {
  assert.equal(odometerStep(50_000, 10, 500), 0);
});

test("an implausible single step is treated as a reset", () => {
  assert.equal(odometerStep(1_000, 11_000, 500), 0);
});

test("a missing reading means the distance is unknown", () => {
  assert.equal(odometerStep(null, 1_000, 500), null);
  assert.equal(odometerStep(1_000, null, 500), null);
});

/* ---------------------------------- cost ---------------------------------- */

test("litres are priced at the refuel in force when they burned", () => {
  const costs = attributeCosts(
    [
      { startTime: 0, endTime: 100, fuelLiters: 10 },
      { startTime: 200, endTime: 300, fuelLiters: 5 },
    ],
    [{ timestamp: 150, pricePerLiter: 2 }],
    null,
  );
  // The first stage burned before the refuel at t=150, so its price is unknown.
  assert.equal(costs[0], null, "fuel burned before any known price is not free");
  assert.equal(costs[1], 10);
});

test("a later refuel does not re-price earlier fuel", () => {
  const costs = attributeCosts(
    [{ startTime: 0, endTime: 100, fuelLiters: 8 }],
    [
      { timestamp: 50, pricePerLiter: 1.5 },
      { timestamp: 500, pricePerLiter: 1.9 },
    ],
    null,
  );
  assert.ok(Math.abs((costs[0] ?? 0) - 12) < 1e-9, `got ${costs[0]}`);
});

test("a fallback price covers fuel burned before the first known refuel", () => {
  const costs = attributeCosts(
    [{ startTime: 0, endTime: 100, fuelLiters: 10 }],
    [],
    1.8,
  );
  assert.ok(Math.abs((costs[0] ?? 0) - 18) < 1e-9);
});

test("a stage that burned nothing costs zero, not null", () => {
  const costs = attributeCosts(
    [{ startTime: 0, endTime: 100, fuelLiters: 0 }],
    [],
    null,
  );
  assert.equal(costs[0], 0, "no litres genuinely costs nothing");
});

test("an unpriced refuel leaves the cost unknown", () => {
  const costs = attributeCosts(
    [{ startTime: 0, endTime: 100, fuelLiters: 5 }],
    [{ timestamp: 10, pricePerLiter: null }],
    null,
  );
  assert.equal(costs[0], null);
});

/* --------------------------------- display -------------------------------- */

test("a metric with no value renders as a double dash", () => {
  assert.equal(formatMetric(null, "km"), "--");
  assert.equal(formatMetric(null, "l_per_100km"), "--");
  assert.equal(formatMetric(Number.NaN, "km"), "--");
});

test("a metric renders its unit and a sensible number of digits", () => {
  assert.equal(formatMetric(266.06, "km"), "266.1 km");
  assert.equal(formatMetric(16.504, "l"), "16.5 l");
  assert.equal(formatMetric(6.2, "l_per_100km"), "6.2 l/100km");
  assert.equal(formatMetric(16.13, "km_per_l"), "16.13 km/l");
});

test("rounding keeps a bounded number of decimals", () => {
  assert.equal(round(1.2345, 2), 1.23);
  assert.equal(round(1.0049, 2), 1);
  assert.equal(round(1234.5678, 1), 1234.6);
  assert.equal(round(1234.5678, 0), 1235);
});
