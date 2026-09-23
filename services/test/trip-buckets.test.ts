/**
 * Windows, buckets and trends — the Trip Computer's calendar.
 *
 * The two rules worth defending, both from the spec: a trend compares against the
 * *immediately preceding window of equal length*, and a period with nothing to
 * compare against reports "not comparable" rather than a `+0` that would read as
 * a real "unchanged" month.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildBuckets,
  bucketStartFor,
  computeTrend,
  granularityFor,
  isPeriodPreset,
  previousWindow,
  startOfLocalDay,
  startOfLocalWeek,
  windowFor,
} from "../trip-service/trip/buckets.js";

const HOUR = 3_600_000;
const DAY = 86_400_000;

/** A fixed local noon, so day boundaries are unambiguous. */
const NOON = new Date(2024, 8, 15, 12, 0, 0, 0).getTime();

/* --------------------------------- windows --------------------------------- */

test("the today preset is the local calendar day, not the last 24 hours", () => {
  const window = windowFor("today", NOON);
  assert.equal(window.from, startOfLocalDay(NOON));
  assert.equal(window.to, NOON);
  const span = window.to - window.from;
  assert.equal(span, 12 * HOUR, "noon is twelve hours into the day");
});

test("rolling presets include today and count whole days", () => {
  const seven = windowFor("7d", NOON);
  assert.equal(seven.from, startOfLocalDay(NOON) - 6 * DAY);
  assert.equal((seven.to - seven.from) / DAY, 6.5);

  const thirty = windowFor("30d", NOON);
  assert.equal(thirty.from, startOfLocalDay(NOON) - 29 * DAY);
});

test("presets are recognised, and anything else is rejected", () => {
  for (const preset of ["today", "7d", "30d", "90d", "year", "all"]) {
    assert.equal(isPeriodPreset(preset), true, `${preset} should be valid`);
  }
  assert.equal(isPeriodPreset("fortnight"), false);
  assert.equal(isPeriodPreset(30), false);
});

test("all-time starts at the earliest data, or falls back to today", () => {
  const earliest = NOON - 400 * DAY;
  assert.equal(windowFor("all", NOON, earliest).from, earliest);
  assert.equal(windowFor("all", NOON, null).from, startOfLocalDay(NOON));
});

test("the previous window is the same length, immediately before", () => {
  const window = { from: NOON - 7 * DAY, to: NOON };
  const before = previousWindow(window);
  assert.equal(before.to, window.from, "the windows must be adjacent, not overlapping");
  assert.equal(before.to - before.from, window.to - window.from);
});

/* -------------------------------- granularity ------------------------------ */

test("granularity adapts to the window length", () => {
  const from = NOON - 100 * DAY;
  assert.equal(granularityFor({ from: NOON - HOUR, to: NOON }), "hour");
  assert.equal(granularityFor({ from: NOON - 2 * DAY, to: NOON }), "hour");
  assert.equal(granularityFor({ from: NOON - 10 * DAY, to: NOON }), "day");
  assert.equal(granularityFor({ from, to: NOON }), "week");
});

test("bucket starts align to the calendar, not to the window", () => {
  assert.equal(bucketStartFor(NOON, "day"), startOfLocalDay(NOON));
  const hourStart = bucketStartFor(NOON, "hour");
  assert.equal(new Date(hourStart).getMinutes(), 0);
  assert.equal(new Date(hourStart).getSeconds(), 0);
  assert.equal(bucketStartFor(NOON, "week"), startOfLocalWeek(NOON));
});

test("a week starts on Monday", () => {
  // 2024-09-15 is a Sunday; its week starts on Monday the 9th.
  const monday = startOfLocalWeek(NOON);
  assert.equal(new Date(monday).getDay(), 1, "Monday");
  assert.ok(monday <= NOON);
  assert.ok(NOON - monday < 7 * DAY);
});

/* ---------------------------------- buckets -------------------------------- */

test("empty buckets are emitted so the graph does not lie about timing", () => {
  const from = startOfLocalDay(NOON) - 2 * DAY;
  const buckets = buildBuckets([], { from, to: NOON }, "day");
  assert.equal(buckets.length, 3);
  assert.ok(buckets.every((bucket) => bucket.distanceKm === 0 && bucket.liters === 0));
});

test("rows land in the bucket that contains their timestamp", () => {
  const start = startOfLocalDay(NOON) - DAY;
  const rows = [
    { timestamp: start + HOUR, distanceKm: 10, liters: 0.7, cost: 1.4 },
    { timestamp: start + 2 * HOUR, distanceKm: 5, liters: 0.35, cost: 0.7 },
    { timestamp: start + DAY + HOUR, distanceKm: 20, liters: 1.4, cost: 2.8 },
  ];
  const buckets = buildBuckets(rows, { from: start, to: NOON }, "day");

  assert.equal(buckets.length, 2);
  assert.ok(Math.abs(buckets[0].distanceKm - 15) < 1e-9, "two rows share the first day");
  assert.ok(Math.abs(buckets[0].liters - 1.05) < 1e-9);
  assert.ok(Math.abs((buckets[0].cost ?? 0) - 2.1) < 1e-9);
  assert.ok(Math.abs(buckets[1].distanceKm - 20) < 1e-9);
});

test("rows outside the window are ignored", () => {
  const from = startOfLocalDay(NOON);
  const buckets = buildBuckets(
    [
      { timestamp: from - HOUR, distanceKm: 100, liters: 7, cost: 14 },
      { timestamp: from + HOUR, distanceKm: 1, liters: 0.1, cost: 0.2 },
    ],
    { from, to: NOON },
    "hour",
  );
  assert.ok(buckets.every((bucket) => bucket.distanceKm <= 1));
});

test("an unpriced bucket reports null money, never zero", () => {
  const from = startOfLocalDay(NOON);
  const buckets = buildBuckets(
    [{ timestamp: from + HOUR, distanceKm: 10, liters: 0.7, cost: null }],
    { from, to: NOON },
    "day",
  );
  assert.equal(buckets[0].cost, null, "unknown cost must not look like free fuel");
});

/* ---------------------------------- trends --------------------------------- */

test("a rise compares against the previous window and points up", () => {
  const trend = computeTrend({ current: 15.54, previous: 13.5, previousHasData: true });
  assert.equal(trend.direction, "up");
  assert.equal(trend.comparable, true);
  assert.ok(Math.abs((trend.delta ?? 0) - 2.04) < 1e-9);
  assert.equal(trend.previousValue, 13.5);
});

test("a fall points down and reports a negative delta", () => {
  const trend = computeTrend({ current: 5, previous: 8, previousHasData: true });
  assert.equal(trend.direction, "down");
  assert.equal(trend.delta, -3);
});

test("no data in the previous window means not comparable rather than zero", () => {
  const trend = computeTrend({ current: 15.54, previous: 0, previousHasData: false });
  assert.equal(trend.comparable, false);
  assert.equal(trend.delta, null);
  assert.equal(trend.direction, "neutral");
});

test("an unknown current value is not comparable even with history", () => {
  const trend = computeTrend({ current: null, previous: 8, previousHasData: true });
  assert.equal(trend.comparable, false);
  assert.equal(trend.delta, null);
});

test("an unchanged period is neutral, and float noise does not draw an arrow", () => {
  const flat = computeTrend({ current: 10, previous: 10, previousHasData: true });
  assert.equal(flat.direction, "neutral");
  assert.equal(flat.comparable, true);

  const noisy = computeTrend({ current: 10.0000001, previous: 10, previousHasData: true });
  assert.equal(noisy.direction, "neutral", "a 1e-7 difference is not a trend");
});

test("a real change just past the epsilon does draw an arrow", () => {
  const trend = computeTrend({ current: 10.02, previous: 10, previousHasData: true });
  assert.equal(trend.direction, "up");
});
