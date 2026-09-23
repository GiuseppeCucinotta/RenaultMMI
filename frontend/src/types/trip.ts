/**
 * Renderer-side mirror of the trip service's wire contract.
 *
 * The backend owns these shapes (`services/trip-service/types.ts` and
 * `query.ts`); this is a structural copy on purpose, the same split the repo
 * already uses for jukebox and settings types. Nothing here computes a metric —
 * every number, unit, formatted string and trend direction arrives from the
 * service, because that is the whole point of having one.
 */

export type TripMode = "service" | "mock" | "loading";

export type TrendDirection = "up" | "down" | "neutral";

/** Comparison against the immediately preceding period of equal length. */
export interface TripTrend {
  delta: number | null;
  direction: TrendDirection;
  /** False when the previous period held no data: the card shows no arrow. */
  comparable: boolean;
  previousValue: number | null;
}

export interface TripMetric {
  value: number | null;
  /** Canonical unit: km, l, l_per_100km, km_per_l, or a currency code. */
  unit: string;
  /** Backend-formatted display string, `--` when there is no data. */
  formatted: string;
  trend: TripTrend;
}

export interface TripSummaryCards {
  distance: TripMetric;
  liters: TripMetric;
  spent: TripMetric;
  avgConsumption: TripMetric;
}

export interface TripPeriod {
  preset: string;
  from: number;
  to: number;
  previousFrom: number;
  previousTo: number;
}

export interface TripSummary {
  period: TripPeriod;
  cards: TripSummaryCards;
  hasData: boolean;
}

export interface TripSeriesBucket {
  start: number;
  end: number;
  distanceKm: number;
  liters: number;
  cost: number | null;
}

export type BucketGranularity = "hour" | "day" | "week";

export interface TripSeries {
  from: number;
  to: number;
  granularity: BucketGranularity;
  buckets: TripSeriesBucket[];
  /** True when there is nothing to plot; the chart draws its empty state. */
  empty: boolean;
}

export interface TripPeriodDescriptor {
  preset: string;
  /** Human label resolved by the service, so the renderer never guesses. */
  label: string;
  from: number;
  to: number;
}

export type TripStatus = "active" | "completed";

export interface TripListItem {
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
  /** Number of stages; more than one means an expandable road trip. */
  legs: number;
  avgConsumptionLPer100km: number | null;
  avgConsumptionKmPerL: number | null;
  hasRoute: boolean;
}

export interface TripStage {
  id: number;
  tripId: number;
  stageNumber: number;
  startTime: number;
  endTime: number | null;
  startLat: number | null;
  startLon: number | null;
  endLat: number | null;
  endLon: number | null;
  distanceKm: number;
  fuelLiters: number;
  avgConsumptionLPer100km: number | null;
  idleSeconds: number;
  movingSeconds: number;
  maxSpeedKmh: number | null;
  avgSpeedKmh: number | null;
  startOdometerKm: number | null;
  endOdometerKm: number | null;
  status: TripStatus;
  pointCount: number;
}

export interface TripStats {
  idleSeconds: number;
  movingSeconds: number;
  avgSpeedKmh: number | null;
  maxSpeedKmh: number | null;
  avgConsumptionLPer100km: number | null;
  avgConsumptionKmPerL: number | null;
}

export interface TripDetail extends TripListItem {
  stages: TripStage[];
  stats: TripStats;
}

export interface TripCoordinate {
  timestamp: number;
  lat: number;
  lon: number;
  speedKmh: number | null;
  consumptionLPer100km: number | null;
}

export interface TripBounds {
  minLat: number;
  minLon: number;
  maxLat: number;
  maxLon: number;
}

export interface TripCoordinates {
  tripId: number;
  points: TripCoordinate[];
  bounds: TripBounds | null;
}

export interface TripListBody {
  trips: TripListItem[];
  total: number;
}

/** A window is either a named preset or an explicit `[from, to)` range. */
export interface TripWindowQuery {
  preset?: string;
  from?: number;
  to?: number;
}

export interface TripPreferences {
  consumptionUnit: string;
  currency: string;
  homeGeofenceLat: number | null;
  homeGeofenceLon: number | null;
  homeGeofenceRadiusM: number;
  stageDwellMinutes: number;
  layoverHours: number;
}

/** `/api/status`: ingestion liveness, for the "no data yet" explanation. */
export interface TripIngestStatus {
  lastSampleAt: number | null;
  simulation: boolean;
  locationAttached: boolean;
  vehicleSamples: number;
  locationSamples: number;
  activeTripId: number | null;
  activeStageId: number | null;
  pendingRefuels: number;
  tripCount: number;
  preferences: TripPreferences;
}

export interface TripState {
  status: {
    lastSampleAt: number | null;
    simulation: boolean;
    locationAttached: boolean;
    vehicleSamples: number;
    locationSamples: number;
    activeTripId: number | null;
    activeStageId: number | null;
    pendingRefuels: number;
  };
  preferences: TripPreferences;
  tripCount: number;
}
