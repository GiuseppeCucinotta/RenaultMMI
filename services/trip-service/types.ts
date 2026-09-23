/**
 * The trip domain's vocabulary.
 *
 * Two layers live here on purpose, and keeping them apart is what makes the
 * module testable without hardware:
 *
 *  - **Samples** (`VehicleSample`, `LocationSample`) are what the outside world
 *    produces. They arrive through the ports in `ports.ts` and are the *only*
 *    thing the engine knows about its sources.
 *  - **Records and bodies** are what the store persists and what the HTTP API
 *    answers with. The renderer mirrors these shapes.
 */

/* -------------------------------------------------------------------------- */
/* Input samples                                                              */
/* -------------------------------------------------------------------------- */

/**
 * One instant of vehicle telemetry.
 *
 * Every field except `timestamp` and `ignition` may be `null` when the source
 * cannot measure it. The engine degrades per-field instead of per-sample: a
 * vehicle with no fuel sensor still gets distance, speed and time.
 *
 * `odometerKm` is the primary distance source. It is cumulative kilometres and
 * is *assumed present* — the CAN signal has not been located yet, so today only
 * the development simulator produces it (see `telemetry/simulator.ts`).
 */
export interface VehicleSample {
  timestamp: number;
  odometerKm: number | null;
  speedKmh: number | null;
  /** Tank contents in litres; level *decreases* measure fuel burned. */
  fuelLevelLiters: number | null;
  /** Instantaneous flow in litres/hour; preferred over the level when present. */
  fuelFlowLph: number | null;
  ignition: boolean;
  engineRpm: number | null;
}

/** One GPS fix. Arrives through the same port shape as vehicle samples. */
export interface LocationSample {
  timestamp: number;
  lat: number;
  lon: number;
  speedKmh: number | null;
  headingDeg: number | null;
  fixQuality: number | null;
}

/* -------------------------------------------------------------------------- */
/* Calculated metrics                                                         */
/* -------------------------------------------------------------------------- */

/** Average consumption expressed both ways; the renderer picks by preference. */
export interface Consumption {
  lPer100km: number | null;
  kmPerL: number | null;
}

export type TrendDirection = "up" | "down" | "neutral";

/**
 * Comparison of a period against the immediately preceding period of equal
 * length. `comparable` is false when the previous period has no data at all, so
 * the UI can show `--` instead of inventing a `+0` that looks like a real
 * "unchanged".
 */
export interface Trend {
  delta: number | null;
  direction: TrendDirection;
  comparable: boolean;
  previousValue: number | null;
}

/** One Trip Computer card: value plus its comparison. */
export interface Metric {
  value: number | null;
  /** Canonical unit id the renderer maps to a label: km, l, l_per_100km, … */
  unit: string;
  /** Backend-formatted display string, or "--" when there is no data. */
  formatted: string;
  trend: Trend;
}

export interface SummaryCardSet {
  distance: Metric;
  liters: Metric;
  spent: Metric;
  avgConsumption: Metric;
}

/** One aggregated bucket of the consumption/distance graph. */
export interface SeriesBucket {
  start: number;
  end: number;
  distanceKm: number;
  liters: number;
  cost: number | null;
}

export type BucketGranularity = "hour" | "day" | "week";

export interface Series {
  from: number;
  to: number;
  granularity: BucketGranularity;
  buckets: SeriesBucket[];
  /** True when every bucket is empty — the renderer draws an empty state. */
  empty: boolean;
}

/* -------------------------------------------------------------------------- */
/* Trips                                                                      */
/* -------------------------------------------------------------------------- */

export type TripStatus = "active" | "completed";

/** Aggregates of one driving stage, as persisted in `trip_stages`. */
export interface StageAggregates {
  distanceKm: number;
  fuelLiters: number;
  avgConsumptionLPer100km: number | null;
  idleSeconds: number;
  movingSeconds: number;
  maxSpeedKmh: number | null;
  avgSpeedKmh: number | null;
  startOdometerKm: number | null;
  endOdometerKm: number | null;
}

export interface StageRecord extends StageAggregates {
  id: number;
  tripId: number;
  stageNumber: number;
  startTime: number;
  endTime: number | null;
  startLat: number | null;
  startLon: number | null;
  endLat: number | null;
  endLon: number | null;
  status: TripStatus;
  /** Decimated point count, for "does this stage have a trajectory". */
  pointCount: number;
}

export interface TripRecord {
  id: number;
  title: string | null;
  startTime: number;
  endTime: number | null;
  totalDistanceKm: number;
  totalFuelLiters: number;
  fuelCost: number | null;
  isRoadTrip: boolean;
  status: TripStatus;
  startOdometerKm: number | null;
  endOdometerKm: number | null;
}

/** A trip as the list endpoint returns it: totals plus its legs. */
export interface TripDetail extends TripRecord {
  stages: StageRecord[];
  legs: number;
  avgConsumptionLPer100km: number | null;
  avgConsumptionKmPerL: number | null;
}

export interface TripBoundingBox {
  minLat: number;
  minLon: number;
  maxLat: number;
  maxLon: number;
}

/**
 * One stored trajectory point. Decimated before insertion, so this is what the
 * map draws without further processing; `speedKmh` and `consumption` travel
 * along for the route's heat overlay.
 */
export interface StoredCoordinate {
  timestamp: number;
  lat: number;
  lon: number;
  speedKmh: number | null;
  consumptionLPer100km: number | null;
}

export interface CoordinatePayload {
  tripId: number;
  points: StoredCoordinate[];
  bounds: TripBoundingBox | null;
}

/* -------------------------------------------------------------------------- */
/* Fuel                                                                       */
/* -------------------------------------------------------------------------- */

/** How a recorded refuel was learned about. */
export type FuelEventSource = "detected" | "manual";

export interface FuelEventRecord {
  id: number;
  tripId: number | null;
  stageId: number | null;
  timestamp: number;
  litersAdded: number;
  levelBeforeL: number | null;
  levelAfterL: number | null;
  source: FuelEventSource;
  confirmed: boolean;
}

export interface FuelPriceRecord {
  id: number;
  timestamp: number;
  pricePerLiter: number;
  currency: string;
}

/* -------------------------------------------------------------------------- */
/* Preferences (from the Settings service)                                    */
/* -------------------------------------------------------------------------- */

export type ConsumptionUnit = "l_per_100km" | "km_per_l";

export interface TripPreferences {
  consumptionUnit: ConsumptionUnit;
  currency: string;
  homeGeofenceLat: number | null;
  homeGeofenceLon: number | null;
  homeGeofenceRadiusM: number;
  /** Ignition-off dwell that closes a driving stage. */
  stageDwellMinutes: number;
  /** Maximum layover that still counts as one multi-stage road trip. */
  layoverHours: number;
}

export const DEFAULT_PREFERENCES: TripPreferences = {
  consumptionUnit: "l_per_100km",
  currency: "EUR",
  homeGeofenceLat: null,
  homeGeofenceLon: null,
  homeGeofenceRadiusM: 200,
  stageDwellMinutes: 15,
  layoverHours: 18,
};

/* -------------------------------------------------------------------------- */
/* Service state (SSE payload)                                                */
/* -------------------------------------------------------------------------- */

export interface TripIngestStatus {
  /** Epoch ms of the most recent accepted sample, or null before the first. */
  lastSampleAt: number | null;
  /** True when a development simulator is driving the engine. */
  simulation: boolean;
  /** False when no location source is attached (the shipped state today). */
  locationAttached: boolean;
  vehicleSamples: number;
  locationSamples: number;
  /** Trip/stage currently open, if the vehicle is in one. */
  activeTripId: number | null;
  activeStageId: number | null;
  /** Pending refuels waiting for a price. */
  pendingRefuels: number;
}

/**
 * The SSE/`/api/state` frame. Deliberately small and stable: trip lists and
 * trajectories are fetched on demand rather than pushed on every sample.
 */
export interface TripState {
  status: TripIngestStatus;
  preferences: TripPreferences;
  /** Counts, so an open app notices a new trip without refetching the list. */
  tripCount: number;
}
