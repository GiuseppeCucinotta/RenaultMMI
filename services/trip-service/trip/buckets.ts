/**
 * Time windows, graph buckets and trends — all pure.
 *
 * Two rules from the specs are encoded here rather than in the renderer:
 *
 *  1. A trend compares a window against the **immediately preceding window of
 *     equal length**, which is why the previous window is derived from the
 *     selected one instead of from "last calendar week".
 *  2. When the previous window has no data at all, the trend is *not comparable*
 *     and the value is `null`. The UI then shows `--` instead of a `+0` that
 *     would read as a real "unchanged".
 */

import type {
  BucketGranularity,
  SeriesBucket,
  Trend,
  TrendDirection,
} from "../types.js";

export interface Window {
  from: number;
  to: number;
}

/** Named windows the Trip Computer offers, resolved against "now". */
export type PeriodPreset = "today" | "7d" | "30d" | "90d" | "year" | "all";

export const PERIOD_PRESETS: readonly PeriodPreset[] = [
  "today",
  "7d",
  "30d",
  "90d",
  "year",
  "all",
];

export function isPeriodPreset(value: unknown): value is PeriodPreset {
  return typeof value === "string" && (PERIOD_PRESETS as readonly string[]).includes(value);
}

const DAY_MS = 86_400_000;

/** Start of the local day containing `timestamp`. */
export function startOfLocalDay(timestamp: number): number {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/**
 * Resolves a preset to a half-open window `[from, to)`.
 *
 * "today" means the local calendar day; the rolling presets are whole days
 * *including* today, so "last 7 days" covers today and the six before it. The
 * window end is exclusive, which keeps bucket boundaries from double-counting
 * the instant a period ends.
 */
export function windowFor(
  preset: PeriodPreset,
  now: number,
  earliest: number | null = null,
): Window {
  const todayStart = startOfLocalDay(now);
  const to = now;
  switch (preset) {
    case "today":
      return { from: todayStart, to };
    case "7d":
      return { from: todayStart - 6 * DAY_MS, to };
    case "30d":
      return { from: todayStart - 29 * DAY_MS, to };
    case "90d":
      return { from: todayStart - 89 * DAY_MS, to };
    case "year":
      return { from: todayStart - 364 * DAY_MS, to };
    case "all":
      return { from: earliest ?? todayStart, to };
  }
}

/** The equally long window immediately before `window`. */
export function previousWindow(window: Window): Window {
  const span = window.to - window.from;
  return { from: window.from - span, to: window.from };
}

/**
 * Picks a granularity that keeps the graph readable: an hour-by-hour series is
 * only useful for a single day, and a year of daily bars is noise.
 */
export function granularityFor(window: Window): BucketGranularity {
  const spanDays = (window.to - window.from) / DAY_MS;
  if (spanDays <= 2) return "hour";
  if (spanDays <= 62) return "day";
  return "week";
}

/** Monday-based start of the local week containing `timestamp`. */
export function startOfLocalWeek(timestamp: number): number {
  const day = startOfLocalDay(timestamp);
  const weekday = (new Date(day).getDay() + 6) % 7; // Monday = 0
  return day - weekday * DAY_MS;
}

export function bucketStartFor(timestamp: number, granularity: BucketGranularity): number {
  if (granularity === "hour") {
    const date = new Date(timestamp);
    date.setMinutes(0, 0, 0);
    return date.getTime();
  }
  if (granularity === "week") return startOfLocalWeek(timestamp);
  return startOfLocalDay(timestamp);
}

function bucketEnd(start: number, granularity: BucketGranularity): number {
  if (granularity === "hour") return start + 3_600_000;
  if (granularity === "week") return start + 7 * DAY_MS;
  return start + DAY_MS;
}

/** One row of the aggregation query the buckets are built from. */
export interface BucketRow {
  timestamp: number;
  distanceKm: number;
  liters: number;
  cost: number | null;
}

/**
 * Builds the complete bucket list for a window.
 *
 * Empty buckets are emitted rather than skipped: a graph with a gap where the
 * car sat still for three days must show three zeros, otherwise the line lies
 * about *when* the driving happened.
 */
export function buildBuckets(
  rows: readonly BucketRow[],
  window: Window,
  granularity: BucketGranularity,
): SeriesBucket[] {
  const buckets = new Map<number, SeriesBucket>();
  for (
    let start = bucketStartFor(window.from, granularity);
    start < window.to;
    start = bucketEnd(start, granularity)
  ) {
    buckets.set(start, {
      start,
      end: bucketEnd(start, granularity),
      distanceKm: 0,
      liters: 0,
      cost: 0,
    });
  }

  for (const row of rows) {
    if (row.timestamp < window.from || row.timestamp >= window.to) continue;
    const start = bucketStartFor(row.timestamp, granularity);
    const bucket = buckets.get(start);
    if (!bucket) continue;
    bucket.distanceKm += row.distanceKm;
    bucket.liters += row.liters;
    // `null` cost means "no price is known": it must not turn into a real 0.
    if (row.cost !== null) bucket.cost = (bucket.cost ?? 0) + row.cost;
  }

  // A bucket list where nothing carried a price reports `null` rather than 0.
  const anyCost = rows.some((row) => row.cost !== null);
  const list = [...buckets.values()];
  for (const bucket of list) {
    if (!anyCost) bucket.cost = null;
  }
  return list;
}

export interface TrendInput {
  current: number | null;
  previous: number | null;
  /** Whether the *previous* window contained any trip data at all. */
  previousHasData: boolean;
  /** Lower is better (consumption, cost) or higher is better (distance). */
  epsilon?: number;
}

/**
 * Direction of a change.
 *
 * `direction` describes which way the *number* moved, not whether that is good:
 * the card decides how to colour "+2 l". A change within `epsilon` is neutral,
 * so float noise on an unchanged period does not draw an arrow.
 */
export function computeTrend({
  current,
  previous,
  previousHasData,
  epsilon = 0.005,
}: TrendInput): Trend {
  if (current === null || previous === null || !previousHasData) {
    return { delta: null, direction: "neutral", comparable: false, previousValue: previous };
  }
  const delta = current - previous;
  const direction: TrendDirection =
    Math.abs(delta) <= epsilon ? "neutral" : delta > 0 ? "up" : "down";
  return { delta, direction, comparable: true, previousValue: previous };
}
