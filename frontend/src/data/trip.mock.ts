/**
 * Browser-dev fallback data for both trip apps.
 *
 * `npm run dev` in a plain browser has no Electron preload bridge and no service,
 * so these shapes keep the UI renderable — and they are deliberately *plausible*
 * rather than zeroed, because a screen full of `--` cannot show whether a card,
 * an arrow or a chart is actually wired up.
 *
 * Timestamps are relative to load so the graph always has recent buckets.
 */

import type {
  TripCoordinate,
  TripDetail,
  TripIngestStatus,
  TripListItem,
  TripPeriodDescriptor,
  TripSeries,
  TripState,
  TripSummary,
} from "@/types/trip";

const DAY = 86_400_000;
const NOW = Date.now();

/** Pseudo-random but stable: the mock must not flicker between renders. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

export const MOCK_TRIP_PREFERENCES = {
  consumptionUnit: "l_per_100km",
  currency: "EUR",
  homeGeofenceLat: 44.6471,
  homeGeofenceLon: 10.9252,
  homeGeofenceRadiusM: 200,
  stageDwellMinutes: 15,
  layoverHours: 18,
};

export const MOCK_TRIP_PERIODS: TripPeriodDescriptor[] = [
  { preset: "today", label: "Today", from: NOW - DAY, to: NOW },
  { preset: "7d", label: "Last 7 days", from: NOW - 7 * DAY, to: NOW },
  { preset: "30d", label: "Last 30 days", from: NOW - 30 * DAY, to: NOW },
  { preset: "90d", label: "Last 90 days", from: NOW - 90 * DAY, to: NOW },
  { preset: "year", label: "Last 12 months", from: NOW - 365 * DAY, to: NOW },
  { preset: "all", label: "All time", from: NOW - 400 * DAY, to: NOW },
];

export const MOCK_TRIP_SUMMARY: TripSummary = {
  period: {
    preset: "30d",
    from: NOW - 30 * DAY,
    to: NOW,
    previousFrom: NOW - 60 * DAY,
    previousTo: NOW - 30 * DAY,
  },
  cards: {
    distance: {
      value: 334,
      unit: "km",
      formatted: "334 km",
      trend: { delta: 154, direction: "up", comparable: true, previousValue: 180 },
    },
    liters: {
      value: 7.23,
      unit: "l",
      formatted: "7.23 l",
      trend: { delta: 3, direction: "up", comparable: true, previousValue: 4.23 },
    },
    spent: {
      value: 15.54,
      unit: "EUR",
      formatted: "15,54 €",
      trend: { delta: 2, direction: "up", comparable: true, previousValue: 13.54 },
    },
    avgConsumption: {
      value: 27.43,
      unit: "km_per_l",
      formatted: "27.43 km/l",
      trend: { delta: 2.3, direction: "up", comparable: true, previousValue: 25.13 },
    },
  },
  hasData: true,
};

/** An empty summary, so the mock can also demonstrate the `--` state. */
export const MOCK_TRIP_SUMMARY_EMPTY: TripSummary = {
  period: {
    preset: "today",
    from: NOW - DAY,
    to: NOW,
    previousFrom: NOW - 2 * DAY,
    previousTo: NOW - DAY,
  },
  cards: {
    distance: {
      value: null,
      unit: "km",
      formatted: "--",
      trend: { delta: null, direction: "neutral", comparable: false, previousValue: null },
    },
    liters: {
      value: null,
      unit: "l",
      formatted: "--",
      trend: { delta: null, direction: "neutral", comparable: false, previousValue: null },
    },
    spent: {
      value: null,
      unit: "EUR",
      formatted: "--",
      trend: { delta: null, direction: "neutral", comparable: false, previousValue: null },
    },
    avgConsumption: {
      value: null,
      unit: "l_per_100km",
      formatted: "--",
      trend: { delta: null, direction: "neutral", comparable: false, previousValue: null },
    },
  },
  hasData: false,
};

export const MOCK_TRIP_SERIES: TripSeries = {
  from: NOW - 14 * DAY,
  to: NOW,
  granularity: "day",
  empty: false,
  buckets: Array.from({ length: 14 }, (_, index) => {
    const random = seeded(index * 977 + 13);
    // Two idle days in the middle, so the chart has a visible gap.
    const idle = index === 5 || index === 6;
    const distanceKm = idle ? 0 : Math.round(random() * 60 + 8);
    return {
      start: NOW - (13 - index) * DAY,
      end: NOW - (12 - index) * DAY,
      distanceKm,
      liters: Math.round(distanceKm * 0.062 * 100) / 100,
      cost: Math.round(distanceKm * 0.062 * 1.785 * 100) / 100,
    };
  }),
};

/** A GPX-shaped breadcrumb: a short loop around Modena with a corner or two. */
function routePoints(count: number, startLat: number, startLon: number): TripCoordinate[] {
  const random = seeded(count * 31 + Math.round(startLat * 1000));
  let lat = startLat;
  let lon = startLon;
  let bearing = Math.PI / 5;
  return Array.from({ length: count }, (_, index) => {
    bearing += (random() - 0.5) * 0.14;
    const step = 0.35 + random() * 0.4;
    lat += (step / 111.32) * Math.cos(bearing);
    lon += (step / (111.32 * Math.cos((lat * Math.PI) / 180))) * Math.sin(bearing);
    return {
      timestamp: NOW - (count - index) * 12_000,
      lat,
      lon,
      speedKmh: Math.round(30 + random() * 70),
      consumptionLPer100km: Math.round((5 + random() * 4) * 100) / 100,
    };
  });
}

/** Wraps a route in the `{ points, bounds }` payload the map consumes. */
function coordinatesFor(tripId: number, count: number, offset: number) {
  const points = routePoints(count, 44.6471 + offset, 10.9252 + offset);
  const lats = points.map((point) => point.lat);
  const lons = points.map((point) => point.lon);
  return {
    tripId,
    points,
    bounds: {
      minLat: Math.min(...lats),
      minLon: Math.min(...lons),
      maxLat: Math.max(...lats),
      maxLon: Math.max(...lons),
    },
  };
}

interface MockTripSeed {
  id: number;
  startTime: number;
  distanceKm: number;
  liters: number;
  cost: number;
  legs: number;
  roadTrip: boolean;
  stageOffsets: number[];
}

const MOCK_TRIP_SEEDS: MockTripSeed[] = [
  {
    id: 41,
    startTime: NOW - 2 * DAY,
    distanceKm: 339,
    liters: 14.3,
    cost: 25.52,
    legs: 2,
    roadTrip: true,
    stageOffsets: [0, 4],
  },
  {
    id: 40,
    startTime: NOW - 3 * DAY,
    distanceKm: 92.4,
    liters: 5.98,
    cost: 10.67,
    legs: 1,
    roadTrip: false,
    stageOffsets: [6],
  },
  {
    id: 39,
    startTime: NOW - 5 * DAY,
    distanceKm: 128.7,
    liters: 7.42,
    cost: 13.24,
    legs: 3,
    roadTrip: true,
    stageOffsets: [10, 13, 17],
  },
  {
    id: 38,
    startTime: NOW - 9 * DAY,
    distanceKm: 7,
    liters: 0.52,
    cost: 0.93,
    legs: 1,
    roadTrip: false,
    stageOffsets: [20],
  },
];

function stageFor(seed: MockTripSeed, index: number, offset: number) {
  const legDistance = seed.distanceKm / seed.legs;
  const legLiters = seed.liters / seed.legs;
  return {
    id: seed.id * 10 + index + 1,
    tripId: seed.id,
    stageNumber: index + 1,
    startTime: seed.startTime + offset * 60_000,
    endTime: seed.startTime + offset * 60_000 + 42 * 60_000,
    startLat: 44.6471 + offset / 1000,
    startLon: 10.9252 + offset / 1000,
    endLat: 44.6471 + offset / 1000 + 0.05,
    endLon: 10.9252 + offset / 1000 + 0.05,
    distanceKm: Math.round(legDistance * 10) / 10,
    fuelLiters: Math.round(legLiters * 100) / 100,
    avgConsumptionLPer100km:
      legDistance > 0 ? Math.round((legLiters / legDistance) * 100 * 100) / 100 : null,
    idleSeconds: 240 + index * 60,
    movingSeconds: 2100 + index * 120,
    maxSpeedKmh: 110 + index * 6,
    avgSpeedKmh: 68 + index * 3,
    startOdometerKm: 12_000 + index * 100,
    endOdometerKm: 12_000 + index * 100 + legDistance,
    status: "completed" as const,
    pointCount: 180 + index * 20,
  };
}

export const MOCK_TRIPS: TripListItem[] = MOCK_TRIP_SEEDS.map((seed) => ({
  id: seed.id,
  title: null,
  startTime: seed.startTime,
  endTime: seed.startTime + 3 * 3_600_000,
  totalDistanceKm: seed.distanceKm,
  totalFuelLiters: seed.liters,
  fuelCost: seed.cost,
  isRoadTrip: seed.roadTrip,
  status: "completed",
  startOdometerKm: 11_000 + seed.id,
  endOdometerKm: 11_000 + seed.id + seed.distanceKm,
  legs: seed.legs,
  avgConsumptionLPer100km: Math.round((seed.liters / seed.distanceKm) * 100 * 100) / 100,
  avgConsumptionKmPerL: Math.round((seed.distanceKm / seed.liters) * 100) / 100,
  hasRoute: true,
}));

export const MOCK_TRIP_DETAILS: Record<number, TripDetail> = Object.fromEntries(
  MOCK_TRIP_SEEDS.map((seed) => {
    const stages = seed.stageOffsets.map((offset, index) => stageFor(seed, index, offset));
    const movingSeconds = stages.reduce((sum, stage) => sum + stage.movingSeconds, 0);
    const idleSeconds = stages.reduce((sum, stage) => sum + stage.idleSeconds, 0);
    const list = MOCK_TRIPS.find((trip) => trip.id === seed.id);
    const detail: TripDetail = {
      ...(list as TripListItem),
      stages,
      stats: {
        idleSeconds,
        movingSeconds,
        avgSpeedKmh: Math.round((seed.distanceKm / (movingSeconds / 3600)) * 10) / 10,
        maxSpeedKmh: Math.max(...stages.map((stage) => stage.maxSpeedKmh ?? 0)),
        avgConsumptionLPer100km:
          Math.round((seed.liters / seed.distanceKm) * 100 * 100) / 100,
        avgConsumptionKmPerL: Math.round((seed.distanceKm / seed.liters) * 100) / 100,
      },
      legs: stages.length,
    };
    return [seed.id, detail];
  }),
);

export const MOCK_TRIP_COORDINATES: Record<number, ReturnType<typeof coordinatesFor>> =
  Object.fromEntries(
    MOCK_TRIP_SEEDS.map((seed, index) => [
      seed.id,
      coordinatesFor(seed.id, 220 + seed.legs * 40, index * 0.02),
    ]),
  );

export const MOCK_TRIP_STATUS: TripIngestStatus = {
  lastSampleAt: NOW - 1000,
  simulation: true,
  locationAttached: true,
  vehicleSamples: 18_420,
  locationSamples: 18_420,
  activeTripId: null,
  activeStageId: null,
  pendingRefuels: 0,
  tripCount: MOCK_TRIPS.length,
  preferences: MOCK_TRIP_PREFERENCES,
};

export const MOCK_TRIP_STATE: TripState = {
  status: {
    lastSampleAt: MOCK_TRIP_STATUS.lastSampleAt,
    simulation: true,
    locationAttached: true,
    vehicleSamples: MOCK_TRIP_STATUS.vehicleSamples,
    locationSamples: MOCK_TRIP_STATUS.locationSamples,
    activeTripId: null,
    activeStageId: null,
    pendingRefuels: 0,
  },
  preferences: MOCK_TRIP_PREFERENCES,
  tripCount: MOCK_TRIPS.length,
};

/** The window a mock request resolves to, for the period the user picked. */
export function mockWindowFor(preset: string): { from: number; to: number } {
  const descriptor =
    MOCK_TRIP_PERIODS.find((period) => period.preset === preset) ?? MOCK_TRIP_PERIODS[2];
  return { from: descriptor.from, to: descriptor.to };
}
