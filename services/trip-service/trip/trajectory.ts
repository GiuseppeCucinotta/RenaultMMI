/**
 * Trajectory geometry — decimation, simplification and map projection.
 *
 * Everything here is a pure function of a point array, which is deliberate:
 * the *device* that produces fixes lives behind `LocationSource`, and none of
 * this code knows it exists. A GPX replay, a serial NMEA reader and a real GPS
 * module all end up calling {@link TrajectoryCollector.push} with the same
 * sample shape, so changing the adapter cannot change a single map point.
 */

import type { LocationSample, StoredCoordinate, TripBoundingBox } from "../types.js";

export interface GeoPoint {
  lat: number;
  lon: number;
}

/** Mean Earth radius, metres. Good to ~0.5% for the spans a car covers. */
const EARTH_RADIUS_M = 6_371_008.8;
const DEG_TO_RAD = Math.PI / 180;

/**
 * Below this step length a bearing is noise, not a direction.
 *
 * A consumer GPS is accurate to a few metres, so the bearing between two fixes
 * closer than that is dominated by position error and can point anywhere —
 * including straight sideways, which would look like a 90-degree turn and make a
 * parked car with a live receiver record a trajectory forever.
 *
 * The value must sit **above** the turn threshold and at or below the distance
 * threshold: at or below the turn threshold every slow straight crawl would
 * satisfy the turn test, and above the distance threshold a genuine corner taken
 * at low speed could never be recorded.
 */
const NOISE_FLOOR_METERS = 12;

/** Great-circle distance in metres. */
export function haversineMeters(a: GeoPoint, b: GeoPoint): number {
  const dLat = (b.lat - a.lat) * DEG_TO_RAD;
  const dLon = (b.lon - a.lon) * DEG_TO_RAD;
  const lat1 = a.lat * DEG_TO_RAD;
  const lat2 = b.lat * DEG_TO_RAD;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial bearing from `a` to `b`, degrees clockwise from north. */
export function bearingDegrees(a: GeoPoint, b: GeoPoint): number {
  const lat1 = a.lat * DEG_TO_RAD;
  const lat2 = b.lat * DEG_TO_RAD;
  const dLon = (b.lon - a.lon) * DEG_TO_RAD;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (Math.atan2(y, x) / DEG_TO_RAD + 360) % 360;
}

/** Smallest absolute angle between two bearings, in [0, 180]. */
export function angleDeltaDegrees(a: number, b: number): number {
  const raw = Math.abs(a - b) % 360;
  return raw > 180 ? 360 - raw : raw;
}

export interface DecimationOptions {
  /** Keep a point when it is at least this far from the last kept one. */
  minDistanceM: number;
  /** Keep a point when the heading changed by at least this much. */
  minHeadingDeltaDeg: number;
}

export const DEFAULT_DECIMATION: DecimationOptions = {
  minDistanceM: 20,
  minHeadingDeltaDeg: 5,
};

/**
 * Streaming decimator.
 *
 * Rejects a fix only when it is both too close *and* too straight — a car
 * turning through a roundabout keeps its shape even at low speed, and a
 * straight motorway run collapses to its corners. The first point of a stage is
 * always kept so a trajectory never starts in the middle of nowhere.
 */
export class TrajectoryCollector {
  /** Last *accepted* point. The keep-test is measured from here. */
  private lastAccepted: StoredCoordinate | null = null;
  /** Last fix seen, accepted or not, so the turn test has a real bearing. */
  private previous: StoredCoordinate | null = null;
  private heading: number | null = null;

  constructor(private readonly options: DecimationOptions = DEFAULT_DECIMATION) {}

  /**
   * Offers a fix. Returns the point to store, or `null` when it is redundant.
   * The stored coordinate carries the speed and consumption the map colours by.
   */
  push(
    sample: LocationSample,
    consumptionLPer100km: number | null = null,
  ): StoredCoordinate | null {
    const current: StoredCoordinate = {
      timestamp: sample.timestamp,
      lat: sample.lat,
      lon: sample.lon,
      speedKmh: sample.speedKmh,
      consumptionLPer100km,
    };

    const accepted = this.lastAccepted;
    if (!accepted) {
      this.lastAccepted = current;
      this.previous = current;
      return current;
    }

    // Distance is measured from the last *accepted* point, never from the last
    // fix. Advancing a shared cursor on rejection would let small rejected steps
    // add up and then accept a point barely any distance from the last stored
    // one, which is exactly the drift that makes a "20 m" filter emit a 5 m gap.
    const distance = haversineMeters(accepted, current);
    const previous = this.previous ?? accepted;

    // A bearing needs two *distinct* points, so it is measured between the last
    // two fixes rather than from the last accepted one: otherwise a corner taken
    // slowly could never satisfy the turn test, because the step that turns is
    // by definition shorter than the keep-threshold. A stationary vehicle
    // reports its position with metre-level noise, and `bearingDegrees` on two
    // nearly identical fixes returns a meaningless 0/90/180 — so below the
    // noise floor the heading is simply unknown and no turn is claimed.
    const stepMeters = haversineMeters(previous, current);
    const heading = stepMeters >= NOISE_FLOOR_METERS ? bearingDegrees(previous, current) : null;
    const turn =
      heading === null
        ? // Still parked: there is no bearing to compare, so no turn can be
          // claimed. (The very first fix never reaches here — it is accepted
          // above — so a null heading here always means "no movement".)
          0
        : this.heading === null
          ? 180
          : angleDeltaDegrees(this.heading, heading);

    const farEnough = distance >= this.options.minDistanceM;
    const turnedEnough = turn >= this.options.minHeadingDeltaDeg;
    if (!farEnough && !turnedEnough) {
      // Remember where we are so the *next* bearing is a real one, but keep the
      // distance reference anchored on the last accepted point.
      this.previous = current;
      return null;
    }

    if (heading !== null) this.heading = heading;
    this.lastAccepted = current;
    this.previous = current;
    return current;
  }

  /** The most recent accepted point, or `null` before the first fix. */
  get lastPoint(): StoredCoordinate | null {
    return this.lastAccepted;
  }

  reset(): void {
    this.lastAccepted = null;
    this.previous = null;
    this.heading = null;
  }
}

/** Offline equivalent of {@link TrajectoryCollector} for an existing array. */
export function decimate(
  points: readonly StoredCoordinate[],
  options: DecimationOptions = DEFAULT_DECIMATION,
): StoredCoordinate[] {
  const collector = new TrajectoryCollector(options);
  const kept: StoredCoordinate[] = [];
  for (const point of points) {
    const accepted = collector.push(
      {
        timestamp: point.timestamp,
        lat: point.lat,
        lon: point.lon,
        speedKmh: point.speedKmh,
        headingDeg: null,
        fixQuality: null,
      },
      point.consumptionLPer100km,
    );
    if (accepted) kept.push(accepted);
  }
  return kept;
}

/**
 * Perpendicular distance in metres from `point` to the segment `a`→`b`.
 *
 * Everything happens in one local equirectangular frame anchored at `a`, so the
 * numbers are metres and consistent with {@link haversineMeters}. Distances are
 * *not* mixed: converting degrees with one scale and then measuring with
 * `haversine` would treat a metre as a degree and make every epsilon 100 000×
 * too large, which silently disables simplification.
 */
function perpendicularMeters(point: GeoPoint, a: GeoPoint, b: GeoPoint): number {
  const latScale = Math.cos(a.lat * DEG_TO_RAD);
  const toXY = (p: GeoPoint): { x: number; y: number } => ({
    x: (p.lon - a.lon) * DEG_TO_RAD * EARTH_RADIUS_M * latScale,
    y: (p.lat - a.lat) * DEG_TO_RAD * EARTH_RADIUS_M,
  });

  const p = toXY(point);
  const bp = toXY(b);
  const lengthSq = bp.x * bp.x + bp.y * bp.y;
  if (lengthSq === 0) return Math.hypot(p.x, p.y);

  const t = Math.max(0, Math.min(1, (p.x * bp.x + p.y * bp.y) / lengthSq));
  return Math.hypot(p.x - bp.x * t, p.y - bp.y * t);
}

/**
 * Ramer–Douglas–Peucker simplification.
 *
 * Used to thin a *completed* stage as a batch, where the streaming decimator
 * had no way to know which points would turn out to be corners. Iterative, not
 * recursive: a long motorway stage is tens of thousands of points.
 */
export function simplifyRdp<T extends GeoPoint>(
  points: readonly T[],
  epsilonMeters: number,
): T[] {
  if (points.length <= 2) return [...points];

  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;

  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [first, last] = stack.pop() as [number, number];
    if (last <= first + 1) continue;

    let farthest = -1;
    let farthestDistance = -1;
    for (let i = first + 1; i < last; i += 1) {
      const distance = perpendicularMeters(points[i], points[first], points[last]);
      if (distance > farthestDistance) {
        farthestDistance = distance;
        farthest = i;
      }
    }

    if (farthest > first && farthestDistance > epsilonMeters) {
      keep[farthest] = true;
      stack.push([first, farthest], [farthest, last]);
    }
  }

  return points.filter((_, index) => keep[index]);
}

/** Bounding box of a point list, or `null` when there is nothing to bound. */
export function boundsOf(points: readonly GeoPoint[]): TripBoundingBox | null {
  if (points.length === 0) return null;
  let minLat = points[0].lat;
  let maxLat = points[0].lat;
  let minLon = points[0].lon;
  let maxLon = points[0].lon;
  for (const point of points) {
    if (point.lat < minLat) minLat = point.lat;
    if (point.lat > maxLat) maxLat = point.lat;
    if (point.lon < minLon) minLon = point.lon;
    if (point.lon > maxLon) maxLon = point.lon;
  }
  return { minLat, minLon, maxLat, maxLon };
}

export interface Viewport {
  width: number;
  height: number;
  padding: number;
}

export interface ProjectedTrajectory {
  points: { x: number; y: number }[];
  /** Metres covered by one viewport unit, for a scale bar. */
  metersPerUnit: number;
  /** Great-circle length of the projected path, metres. */
  totalMeters: number;
}

/**
 * Projects a trajectory into a viewport as SVG-ready coordinates.
 *
 * Equirectangular around the box centre: at the scale of a single trip the
 * error is invisible, and it keeps the map free of a projection library. A
 * single point (or a stationary trip) would divide by zero, so the degenerate
 * case is centred instead of scaled.
 */
export function projectTrajectory(
  points: readonly GeoPoint[],
  viewport: Viewport,
): ProjectedTrajectory {
  const inner = {
    width: Math.max(1, viewport.width - viewport.padding * 2),
    height: Math.max(1, viewport.height - viewport.padding * 2),
  };
  const bounds = boundsOf(points);
  if (!bounds) return { points: [], metersPerUnit: 0, totalMeters: 0 };

  const centerLat = (bounds.minLat + bounds.maxLat) / 2;
  const latScale = Math.max(0.05, Math.cos(centerLat * DEG_TO_RAD));

  // Span in metres, so latitude and longitude share one unit.
  const spanY = Math.max(
    1,
    (bounds.maxLat - bounds.minLat) * DEG_TO_RAD * EARTH_RADIUS_M,
  );
  const spanX = Math.max(
    1,
    (bounds.maxLon - bounds.minLon) * DEG_TO_RAD * EARTH_RADIUS_M * latScale,
  );

  const scale = Math.min(inner.width / spanX, inner.height / spanY);
  const renderedWidth = spanX * scale;
  const renderedHeight = spanY * scale;
  const offsetX = viewport.padding + (inner.width - renderedWidth) / 2;
  const offsetY = viewport.padding + (inner.height - renderedHeight) / 2;

  // SVG y grows downward while latitude grows north, hence the inversion.
  const project = (point: GeoPoint): { x: number; y: number } => ({
    x:
      offsetX +
      (point.lon - bounds.minLon) * DEG_TO_RAD * EARTH_RADIUS_M * latScale * scale,
    y:
      offsetY +
      renderedHeight -
      (point.lat - bounds.minLat) * DEG_TO_RAD * EARTH_RADIUS_M * scale,
  });

  let totalMeters = 0;
  for (let i = 1; i < points.length; i += 1) {
    totalMeters += haversineMeters(points[i - 1], points[i]);
  }

  return {
    points: points.map(project),
    metersPerUnit: scale > 0 ? 1 / scale : 0,
    totalMeters,
  };
}
