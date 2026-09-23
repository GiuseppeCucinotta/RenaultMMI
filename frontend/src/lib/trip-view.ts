/**
 * The trip views' pure presentation logic.
 *
 * Everything here is a function of its arguments: no hooks, no DOM, no service.
 * That is deliberate and follows `settings-layout.ts` — the components stay dumb
 * renderers, and the two decisions that are genuinely the renderer's (how a delta
 * is *worded*, and how a bounding box maps into a viewport) are testable without
 * a browser.
 *
 * Note what is **not** here: no aggregation, no unit conversion, no bucketing.
 * Those live in the service, so a card and the graph above it cannot disagree.
 */

import type { TripCoordinate, TripMetric, TripTrend } from "@/types/trip";

/* -------------------------------------------------------------------------- */
/* Money and units                                                            */
/* -------------------------------------------------------------------------- */

/** ISO 4217 codes are three uppercase letters; metric units never are. */
export function isCurrencyUnit(unit: string): boolean {
  return /^[A-Z]{3}$/.test(unit);
}

/**
 * Words the signed change in the metric's own unit.
 *
 * Money goes through `Intl` so it matches the card's own formatting; a plain
 * number plus the unit the service chose covers everything else. `null` means
 * there is nothing honest to say — either no comparison period, or no delta.
 */
export function formatDelta(metric: TripMetric): string | null {
  const { trend, unit } = metric;
  if (!trend.comparable || trend.delta === null) return null;

  const magnitude = Math.abs(trend.delta);
  const sign = trend.delta > 0 ? "+" : "-";

  if (isCurrencyUnit(unit)) {
    try {
      return (
        sign +
        new Intl.NumberFormat(undefined, { style: "currency", currency: unit }).format(magnitude)
      );
    } catch {
      return `${sign}${magnitude.toFixed(2)} ${unit}`;
    }
  }

  const digits = unit === "km" ? 1 : 2;
  return `${sign}${magnitude.toFixed(digits)} ${unit}`;
}

/** The arrow a card should draw. A non-comparable trend never draws one. */
export function arrowDirection(trend: TripTrend): "up" | "down" | "none" {
  if (!trend.comparable) return "none";
  return trend.direction === "neutral" ? "none" : trend.direction;
}

/* -------------------------------------------------------------------------- */
/* Dates and durations                                                        */
/* -------------------------------------------------------------------------- */

/** `DD/MM/YYYY`, the component order the design reference uses. */
export function formatDay(timestamp: number): string {
  const date = new Date(timestamp);
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${day}/${month}/${date.getFullYear()}`;
}

/** `DD/MM/YYYY - DD/MM/YYYY`, as printed in the period pill. */
export function formatRange(from: number, to: number): string {
  return `${formatDay(from)} - ${formatDay(to)}`;
}

/** `HH:MM`, in the local zone the trip was recorded in. */
export function formatClock(timestamp: number): string {
  const date = new Date(timestamp);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

/** `DD/MM HH:MM`, the list-row timestamp. */
export function formatDateTime(timestamp: number): string {
  const date = new Date(timestamp);
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${day}/${month} ${formatClock(timestamp)}`;
}

/**
 * `2h 05m` / `45m`, from a start and end.
 *
 * An open trip reports `activeLabel` instead of a duration that keeps growing
 * while the user reads it.
 */
export function formatDuration(start: number, end: number | null, activeLabel: string): string {
  if (end === null) return activeLabel;
  return formatSeconds(Math.max(0, Math.round((end - start) / 1000)));
}

/** `2h 05m` / `45m`, from a number of seconds. */
export function formatSeconds(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours > 0 ? `${hours}h ${String(rest).padStart(2, "0")}m` : `${rest}m`;
}

/* -------------------------------------------------------------------------- */
/* Numbers                                                                    */
/* -------------------------------------------------------------------------- */

export function formatDistanceKm(km: number): string {
  return `${km.toFixed(km < 100 ? 1 : 0)} km`;
}

export function formatLiters(liters: number): string {
  return `${liters.toFixed(2)} l`;
}

export function formatMoney(value: number, currency = "EUR"): string {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency}`;
  }
}

/* -------------------------------------------------------------------------- */
/* Map projection                                                             */
/* -------------------------------------------------------------------------- */

export interface MapViewport {
  width: number;
  height: number;
  padding: number;
}

export interface ProjectedRoute {
  /** SVG `points` attribute: `x,y x,y …`. */
  path: string;
  points: { x: number; y: number }[];
  start: { x: number; y: number };
  end: { x: number; y: number };
  /** How many metres one viewport unit covers, for the scale bar. */
  metersPerUnit: number;
}

/**
 * Projects stored coordinates into a viewport.
 *
 * Equirectangular over the route's own bounding box: correct enough for a single
 * journey, and it means the map needs no projection library and no tile source.
 * Latitude is scaled by `cos(lat)` so the route is not stretched, and the aspect
 * ratio is preserved by taking the tighter of the two scales.
 *
 * Returns `null` when there is nothing to draw, so the caller renders its empty
 * state instead of a degenerate line.
 */
export function projectRoute(
  points: readonly TripCoordinate[],
  viewport: MapViewport,
): ProjectedRoute | null {
  if (points.length === 0) return null;

  const minLat = Math.min(...points.map((point) => point.lat));
  const maxLat = Math.max(...points.map((point) => point.lat));
  const minLon = Math.min(...points.map((point) => point.lon));
  const maxLon = Math.max(...points.map((point) => point.lon));

  const innerWidth = Math.max(1, viewport.width - viewport.padding * 2);
  const innerHeight = Math.max(1, viewport.height - viewport.padding * 2);

  const centerLat = (minLat + maxLat) / 2;
  const latScale = Math.max(0.05, Math.cos((centerLat * Math.PI) / 180));

  const spanY = Math.max(1, (maxLat - minLat) * 111_320);
  const spanX = Math.max(1, (maxLon - minLon) * 111_320 * latScale);
  const scale = Math.min(innerWidth / spanX, innerHeight / spanY);

  const renderedWidth = spanX * scale;
  const renderedHeight = spanY * scale;
  const offsetX = viewport.padding + (innerWidth - renderedWidth) / 2;
  const offsetY = viewport.padding + (innerHeight - renderedHeight) / 2;

  const projected = points.map((point) => ({
    x: offsetX + (point.lon - minLon) * 111_320 * latScale * scale,
    // SVG y grows downward while latitude grows north, hence the inversion.
    y: offsetY + renderedHeight - (point.lat - minLat) * 111_320 * scale,
  }));

  const rounded = projected.map((point) => ({
    x: Math.round(point.x * 10) / 10,
    y: Math.round(point.y * 10) / 10,
  }));

  return {
    path: rounded.map((point) => `${point.x},${point.y}`).join(" "),
    points: rounded,
    start: rounded[0],
    end: rounded[rounded.length - 1],
    metersPerUnit: scale > 0 ? 1 / scale : 0,
  };
}

/**
 * A round distance for the scale bar.
 *
 * Rounds *up* to the next nice value so the bar never claims to represent more
 * distance than it draws.
 */
export function niceScaleBarMeters(metersPerUnit: number, targetUnits = 120): number {
  const target = metersPerUnit * targetUnits;
  const candidates = [50, 100, 250, 500, 1000, 2000, 5000, 10_000, 25_000, 50_000];
  return candidates.find((value) => value >= target) ?? candidates[candidates.length - 1];
}

export function formatScaleBar(meters: number): string {
  return meters >= 1000 ? `${meters / 1000} km` : `${meters} m`;
}
