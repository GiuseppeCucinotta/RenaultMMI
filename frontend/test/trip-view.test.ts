import assert from "node:assert/strict";
import { test } from "node:test";

import {
  arrowDirection,
  formatDateTime,
  formatDay,
  formatDelta,
  formatDistanceKm,
  formatDuration,
  formatLiters,
  formatMoney,
  formatRange,
  formatScaleBar,
  formatSeconds,
  isCurrencyUnit,
  niceScaleBarMeters,
  projectRoute,
} from "@/lib/trip-view";
import type { TripCoordinate, TripMetric } from "@/types/trip";

/**
 * The renderer's own decisions.
 *
 * Everything the two trip apps *compute* lives in the service, so what is left
 * here is presentation: how a delta is worded, how long a drive reads, and where
 * a stored coordinate lands inside the map box. Those are exactly the things a
 * component would get subtly wrong and no service test would catch.
 */

function metric(overrides: Partial<TripMetric> = {}): TripMetric {
  return {
    value: 10,
    unit: "l",
    formatted: "10 l",
    trend: { delta: 2, direction: "up", comparable: true, previousValue: 8 },
    ...overrides,
  };
}

/* --------------------------------- deltas --------------------------------- */

test("a positive delta is signed and carries the metric's unit", () => {
  assert.equal(formatDelta(metric()), "+2.00 l");
});

test("a negative delta is signed without a double negative", () => {
  const negative = metric({
    trend: { delta: -1.5, direction: "down", comparable: true, previousValue: 11.5 },
  });
  assert.equal(formatDelta(negative), "-1.50 l");
});

test("a distance delta keeps one decimal, matching the card's own precision", () => {
  const distance = metric({
    unit: "km",
    trend: { delta: 154, direction: "up", comparable: true, previousValue: 180 },
  });
  assert.equal(formatDelta(distance), "+154.0 km");
});

test("a non-comparable trend has no delta to word", () => {
  const incomparable = metric({
    trend: { delta: null, direction: "neutral", comparable: false, previousValue: null },
  });
  assert.equal(formatDelta(incomparable), null);
});

test("money is formatted as currency, not as a bare number", () => {
  const spent = metric({
    unit: "EUR",
    trend: { delta: 2, direction: "up", comparable: true, previousValue: 13.54 },
  });
  const formatted = formatDelta(spent);
  assert.ok(formatted);
  assert.match(formatted, /^\+/);
  // ICU decides the symbol placement per locale; assert on the number only.
  assert.match(formatted, /2[.,]00/);
});

test("currency units are distinguished from metric units", () => {
  assert.equal(isCurrencyUnit("EUR"), true);
  assert.equal(isCurrencyUnit("USD"), true);
  assert.equal(isCurrencyUnit("km"), false);
  assert.equal(isCurrencyUnit("l_per_100km"), false);
  assert.equal(isCurrencyUnit("eur"), false);
});

test("only a comparable, non-neutral trend draws an arrow", () => {
  assert.equal(arrowDirection({ delta: 2, direction: "up", comparable: true, previousValue: 1 }), "up");
  assert.equal(
    arrowDirection({ delta: -2, direction: "down", comparable: true, previousValue: 1 }),
    "down",
  );
  assert.equal(
    arrowDirection({ delta: null, direction: "neutral", comparable: false, previousValue: null }),
    "none",
    "no comparison period means no arrow to draw",
  );
  assert.equal(
    arrowDirection({ delta: 0, direction: "neutral", comparable: true, previousValue: 3 }),
    "none",
    "an unchanged period is not a direction",
  );
});

/* ---------------------------------- dates --------------------------------- */

test("a day renders day-first, as the design reference does", () => {
  const timestamp = new Date(2024, 8, 5, 14, 30).getTime();
  assert.equal(formatDay(timestamp), "05/09/2024");
});

test("a range joins two days with a hyphen", () => {
  const from = new Date(2024, 0, 1, 0, 0).getTime();
  const to = new Date(2024, 8, 30, 23, 59).getTime();
  assert.equal(formatRange(from, to), "01/01/2024 - 30/09/2024");
});

test("a list timestamp shows the day and the clock", () => {
  const timestamp = new Date(2024, 8, 5, 9, 5).getTime();
  assert.equal(formatDateTime(timestamp), "05/09 09:05");
});

/* -------------------------------- durations ------------------------------- */

test("a duration reads as hours and minutes, or minutes alone", () => {
  assert.equal(formatSeconds(2 * 3600 + 5 * 60), "2h 05m");
  assert.equal(formatSeconds(45 * 60), "45m");
  assert.equal(formatSeconds(0), "0m");
});

test("an open trip reports its label instead of a growing duration", () => {
  assert.equal(formatDuration(1000, null, "In progress"), "In progress");
  assert.equal(formatDuration(1000, 61_000, "In progress"), "1m");
});

/* --------------------------------- numbers -------------------------------- */

test("distance and litres use the precision the reference shows", () => {
  assert.equal(formatDistanceKm(7.04), "7.0 km");
  assert.equal(formatDistanceKm(339.2), "339 km");
  assert.equal(formatLiters(14.3), "14.30 l");
});

test("money falls back gracefully for an unknown currency code", () => {
  const formatted = formatMoney(15.54, "EUR");
  assert.match(formatted, /15[.,]54/);
  // An invalid ISO code must not throw into render.
  assert.ok(formatMoney(3, "NOPE").length > 0);
});

/* ----------------------------------- map ---------------------------------- */

/** A short north-eastward breadcrumb, in metres of real displacement. */
function route(count: number, stepMeters = 40): TripCoordinate[] {
  return Array.from({ length: count }, (_, index) => ({
    timestamp: index * 1000,
    lat: 44.6471 + (index * stepMeters) / 111_320,
    lon: 10.9252 + (index * stepMeters) / (111_320 * Math.cos((44.6471 * Math.PI) / 180)),
    speedKmh: 50,
    consumptionLPer100km: 6,
  }));
}

const VIEWPORT = { width: 400, height: 300, padding: 10 };

test("a projected route stays inside the viewport", () => {
  const projected = projectRoute(route(20), VIEWPORT);
  assert.ok(projected);
  for (const point of projected.points) {
    assert.ok(point.x >= 10 && point.x <= 390, `x out of bounds: ${point.x}`);
    assert.ok(point.y >= 10 && point.y <= 290, `y out of bounds: ${point.y}`);
  }
});

test("north is up: the northernmost point has the smallest y", () => {
  const projected = projectRoute(route(10), VIEWPORT);
  assert.ok(projected);
  assert.ok(projected.end.y < projected.start.y, "the route heads north-east");
  assert.ok(projected.end.x > projected.start.x, "and east");
});

test("the route keeps its aspect ratio instead of stretching to the box", () => {
  // A perfectly north-south route must render as a vertical line.
  const straightNorth = route(12).map((point) => ({ ...point, lon: 10.9252 }));
  const projected = projectRoute(straightNorth, VIEWPORT);
  assert.ok(projected);
  const xs = projected.points.map((point) => point.x);
  assert.equal(Math.max(...xs) - Math.min(...xs), 0, "a north-south route must not lean");
});

test("an empty route has nothing to draw", () => {
  assert.equal(projectRoute([], VIEWPORT), null);
});

test("a single point projects to a finite coordinate rather than dividing by zero", () => {
  const projected = projectRoute(route(1), VIEWPORT);
  assert.ok(projected);
  assert.ok(Number.isFinite(projected.start.x));
  assert.ok(Number.isFinite(projected.start.y));
  // A degenerate route falls back to the metre span guard; nothing may be NaN.
  assert.ok(Number.isFinite(projected.metersPerUnit));
});

test("the scale bar rounds up so it never overstates the distance", () => {
  // 2.5 m per unit over 120 units is 300 m, so the next round value is 500 m.
  assert.equal(niceScaleBarMeters(2.5), 500);
  assert.equal(niceScaleBarMeters(0.5), 100);
  assert.equal(formatScaleBar(500), "500 m");
  assert.equal(formatScaleBar(2000), "2 km");
});
