/**
 * The read model: everything the two apps ask for, computed once.
 *
 * This is the layer that makes the specs' central promise true — *the renderer
 * computes nothing*. Windowed aggregates, period-over-period trends, graph
 * buckets, trip lists, detail stats and map geometry all come from here, so a
 * card and a chart can never disagree about what "this month" means.
 *
 * Every method is a function of rows the store already holds, which is why the
 * parity rule from the spec (`SUM(stages) == trip`) reduces to *not summing
 * twice*: trip totals are recomputed from stages on every mutation, and window
 * metrics sum exactly the same stage rows.
 */

import type { TripStore } from "./store/store.js";
import type {
  BucketGranularity,
  Consumption,
  FuelEventRecord,
  FuelPriceRecord,
  Metric,
  Series,
  SeriesBucket,
  StageRecord,
  SummaryCardSet,
  TripDetail,
  TripPreferences,
  TripRecord,
  Trend,
} from "./types.js";
import {
  buildBuckets,
  computeTrend,
  granularityFor,
  previousWindow,
  windowFor,
  type BucketRow,
  type PeriodPreset,
  type Window,
} from "./trip/buckets.js";
import { formatMetric, round, toKmPerL } from "./trip/consumption.js";
import { attributeCosts } from "./trip/cost.js";
import { boundsOf, decimate, simplifyRdp } from "./trip/trajectory.js";

export interface WindowMetrics {
  distanceKm: number;
  liters: number;
  spent: number | null;
  /** True when at least one stage carried a known price. */
  hasPricedData: boolean;
  avgConsumptionLPer100km: number | null;
  avgConsumptionKmPerL: number | null;
  tripCount: number;
  stageCount: number;
  firstStageAt: number | null;
  lastStageAt: number | null;
}

export interface SummaryPeriod {
  preset: PeriodPreset | "custom";
  from: number;
  to: number;
  /** Equally long window immediately before, for the trend. */
  previousFrom: number;
  previousTo: number;
}

export interface SummaryReport {
  period: SummaryPeriod;
  cards: SummaryCardSet;
  hasData: boolean;
}

export interface TripStats {
  idleSeconds: number;
  movingSeconds: number;
  avgSpeedKmh: number | null;
  maxSpeedKmh: number | null;
  avgConsumptionLPer100km: number | null;
  avgConsumptionKmPerL: number | null;
}

export interface TripListItem extends TripRecord {
  legs: number;
  avgConsumptionLPer100km: number | null;
  avgConsumptionKmPerL: number | null;
  /** True when the trip has a stored trajectory to draw. */
  hasRoute: boolean;
}

export interface TripDetailReport extends TripDetail {
  stats: TripStats;
  hasRoute: boolean;
}

/** Rounds that keep five decimals of litres out of the UI. */
const DISTANCE_DIGITS = 1;
const LITRE_DIGITS = 2;
const CONSUMPTION_DIGITS = 2;
const MONEY_DIGITS = 2;

/** Decimation defaults, mirrored from the trajectory module's constants. */
const MAP_MIN_DISTANCE_M = 20;

export class TripQueryService {
  constructor(
    private readonly store: TripStore,
    private readonly now: () => number = Date.now,
  ) {}

  /* ------------------------------ preferences ---------------------------- */

  /**
   * Formats a money amount. The *unit* label is the renderer's job; the digits
   * and the currency symbol are not, because they depend on the preference the
   * service already read.
   */
  formatMoney(value: number | null, currency: string): string {
    if (value === null || !Number.isFinite(value)) return "--";
    const rounded = round(value, MONEY_DIGITS);
    try {
      return new Intl.NumberFormat(undefined, {
        style: "currency",
        currency,
        minimumFractionDigits: MONEY_DIGITS,
        maximumFractionDigits: MONEY_DIGITS,
      }).format(rounded);
    } catch {
      // An unknown ISO code must not blank the card.
      return `${rounded} ${currency}`;
    }
  }

  private consumptionUnit(prefs: TripPreferences): string {
    return prefs.consumptionUnit;
  }

  /* -------------------------------- windows ------------------------------ */

  /** Resolves a preset (or an explicit range) into a half-open window. */
  resolvePeriod(options: { preset?: PeriodPreset; from?: number; to?: number }): Window {
    if (options.from !== undefined && options.to !== undefined) {
      return { from: options.from, to: options.to };
    }
    const preset = options.preset ?? "30d";
    const earliest = this.store.earliestStageTime();
    return windowFor(preset, this.now(), earliest);
  }

  /**
   * Money is derived, never stored.
   *
   * A litre costs whatever the price in force when it burned was, so the answer
   * depends on the refuel history — including refuels later than the stage. The
   * costing pass therefore runs over the whole history but is reported for the
   * requested window only, which is also why correcting a price re-costs
   * history correctly instead of leaving stale totals behind.
   */
  private costLedger(): {
    costOf: (stage: StageRecord) => number | null;
    pricedStages: number;
  } {
    const stages = this.store.listTrips({ limit: 100_000, offset: 0 }).trips.flatMap((trip) =>
      this.store.listStages(trip.id),
    );
    const refuels = this.store
      .listFuelEvents({ limit: 100_000 })
      .filter((event) => event.confirmed)
      .map((event) => ({ timestamp: event.timestamp, pricePerLiter: this.priceAt(event.timestamp) }));

    const costs = attributeCosts(
      stages.map((stage) => ({
        startTime: stage.startTime,
        endTime: stage.endTime,
        fuelLiters: stage.fuelLiters,
      })),
      refuels,
      null,
    );

    const byStage = new Map<number, number | null>();
    stages.forEach((stage, index) => byStage.set(stage.id, costs[index]));
    let pricedStages = 0;
    for (const cost of costs) if (cost !== null && cost > 0) pricedStages += 1;

    return { costOf: (stage) => byStage.get(stage.id) ?? null, pricedStages };
  }

  /** Price per litre recorded at or before `timestamp`, or `null`. */
  private priceAt(timestamp: number): number | null {
    const prices = this.store.listFuelPrices();
    let price: number | null = null;
    for (const record of prices) {
      if (record.timestamp > timestamp) break;
      price = record.pricePerLiter;
    }
    return price;
  }

  /** Aggregates one window from the stage rows that started inside it. */
  metricsFor(_prefs: TripPreferences, window: Window): WindowMetrics {
    const stages = this.store.listStagesInWindow(window.from, window.to);
    const distanceKm = stages.reduce((sum, stage) => sum + stage.distanceKm, 0);
    const liters = stages.reduce((sum, stage) => sum + stage.fuelLiters, 0);

    const ledger = this.costLedger();
    const costs = stages.map((stage) => ledger.costOf(stage));
    const priced = costs.filter((cost): cost is number => cost !== null);
    const hasPricedData = priced.length > 0;
    const spent = hasPricedData ? priced.reduce((sum, cost) => sum + cost, 0) : null;

    const consumption: Consumption =
      distanceKm > 0
        ? { lPer100km: (liters / distanceKm) * 100, kmPerL: toKmPerL((liters / distanceKm) * 100) }
        : { lPer100km: null, kmPerL: null };

    const tripIds = new Set(stages.map((stage) => stage.tripId));
    const times = stages.map((stage) => stage.startTime);

    return {
      distanceKm,
      liters,
      spent,
      hasPricedData,
      avgConsumptionLPer100km: consumption.lPer100km,
      avgConsumptionKmPerL: consumption.kmPerL,
      tripCount: tripIds.size,
      stageCount: stages.length,
      firstStageAt: times.length > 0 ? Math.min(...times) : null,
      lastStageAt: times.length > 0 ? Math.max(...times) : null,
    };
  }

  /**
   * The four Trip Computer cards, each with its comparison.
   *
   * A trend whose previous window holds no data is not comparable, and the card
   * value stays a number while `formatted` alone degrades to `--` when the value
   * itself is unknown.
   */
  summary(
    prefs: TripPreferences,
    options: { preset?: PeriodPreset; from?: number; to?: number },
  ): SummaryReport {
    const window = this.resolvePeriod(options);
    const previous = previousWindow(window);
    const current = this.metricsFor(prefs, window);
    const before = this.metricsFor(prefs, previous);
    const previousHasData = this.store.hasDataInWindow(previous.from, previous.to);

    const trend = (currentValue: number | null, previousValue: number | null): Trend =>
      computeTrend({ current: currentValue, previous: previousValue, previousHasData });

    const unit = this.consumptionUnit(prefs);

    // A window with no trips has no metrics at all. Reporting `0 km` would be a
    // claim about the user's driving; `--` is the truth, and the comparison is
    // not comparable rather than a flat zero.
    if (current.stageCount === 0) {
      const empty = (metricUnit: string): Metric => ({
        value: null,
        unit: metricUnit,
        formatted:
          metricUnit === prefs.currency
            ? this.formatMoney(null, prefs.currency)
            : formatMetric(null, metricUnit),
        trend: { delta: null, direction: "neutral", comparable: false, previousValue: null },
      });
      return {
        period: {
          preset: options.preset ?? (options.from !== undefined ? "custom" : "30d"),
          from: window.from,
          to: window.to,
          previousFrom: previous.from,
          previousTo: previous.to,
        },
        cards: {
          distance: empty("km"),
          liters: empty("l"),
          spent: empty(prefs.currency),
          avgConsumption: empty(unit),
        },
        hasData: false,
      };
    }

    const distance = this.metric(
      current.distanceKm,
      "km",
      trend(current.distanceKm, before.distanceKm),
      DISTANCE_DIGITS,
    );
    const liters = this.metric(
      current.liters,
      "l",
      trend(current.liters, before.liters),
      LITRE_DIGITS,
    );
    const spent = this.metric(
      current.spent,
      prefs.currency,
      trend(current.spent, before.spent),
      MONEY_DIGITS,
      (value) => this.formatMoney(value, prefs.currency),
    );

    const currentConsumption =
      unit === "km_per_l" ? current.avgConsumptionKmPerL : current.avgConsumptionLPer100km;
    const previousConsumption =
      unit === "km_per_l" ? before.avgConsumptionKmPerL : before.avgConsumptionLPer100km;
    const avgConsumption = this.metric(
      currentConsumption,
      unit,
      trend(currentConsumption, previousConsumption),
      CONSUMPTION_DIGITS,
    );

    return {
      period: {
        preset: options.preset ?? (options.from !== undefined ? "custom" : "30d"),
        from: window.from,
        to: window.to,
        previousFrom: previous.from,
        previousTo: previous.to,
      },
      cards: { distance, liters, spent, avgConsumption },
      hasData: current.stageCount > 0,
    };
  }

  private metric(
    value: number | null,
    unit: string,
    trend: Trend,
    digits: number,
    formatter?: (value: number | null) => string,
  ): Metric {
    const rounded = value === null ? null : round(value, digits);
    return {
      value: rounded,
      unit,
      formatted: formatter ? formatter(rounded) : formatMetric(rounded, unit, digits),
      trend,
    };
  }

  /* --------------------------------- series ------------------------------ */

  /** Graph buckets for the selected window. */
  series(
    options: {
      preset?: PeriodPreset;
      from?: number;
      to?: number;
      granularity?: BucketGranularity;
    },
  ): Series {
    const window = this.resolvePeriod(options);
    const granularity = options.granularity ?? granularityFor(window);
    const stages = this.store.listStagesInWindow(window.from, window.to);

    const ledger = this.costLedger();
    const rows: BucketRow[] = stages.map((stage) => ({
      timestamp: stage.startTime,
      distanceKm: stage.distanceKm,
      liters: stage.fuelLiters,
      cost: ledger.costOf(stage),
    }));

    // `buildBuckets` never invents money, but a window with no priced stage at
    // all must report `null` rather than a confident zero.
    const anyPriced = rows.some((row) => row.cost !== null);
    const buckets = buildBuckets(rows, window, granularity).map<SeriesBucket>((bucket) => ({
      ...bucket,
      cost: anyPriced ? bucket.cost : null,
    }));

    // A window with no driving has nothing to draw. Returning an axis of empty
    // buckets would render a chart that looks like real data at zero, so the
    // list is genuinely empty and the renderer shows its own empty state.
    const empty = rows.length === 0;
    if (empty) return { from: window.from, to: window.to, granularity, buckets: [], empty };

    return {
      from: window.from,
      to: window.to,
      granularity,
      buckets,
      empty,
    };
  }

  /** Preset descriptors, so the renderer need not know what "30d" means. */
  periods(): { preset: PeriodPreset; label: string; from: number; to: number }[] {
    const presets: PeriodPreset[] = ["today", "7d", "30d", "90d", "year", "all"];
    const labels: Record<PeriodPreset, string> = {
      today: "Today",
      "7d": "Last 7 days",
      "30d": "Last 30 days",
      "90d": "Last 90 days",
      year: "Last 12 months",
      all: "All time",
    };
    return presets.map((preset) => {
      const window = this.resolvePeriod({ preset });
      return { preset, label: labels[preset], from: window.from, to: window.to };
    });
  }

  /* --------------------------------- trips ------------------------------- */

  listTrips(options: { limit: number; offset: number; from?: number; to?: number }): {
    trips: TripListItem[];
    total: number;
  } {
    const { trips, total } = this.store.listTrips(options);
    return {
      trips: trips.map((trip) => {
        const stages = this.store.listStages(trip.id);
        const consumption =
          trip.totalDistanceKm > 0
            ? (trip.totalFuelLiters / trip.totalDistanceKm) * 100
            : null;
        return {
          ...trip,
          legs: stages.length,
          avgConsumptionLPer100km: consumption,
          avgConsumptionKmPerL: toKmPerL(consumption),
          hasRoute: stages.some((stage) => stage.pointCount > 0),
        };
      }),
      total,
    };
  }

  tripDetail(tripId: number): TripDetailReport | null {
    const detail = this.store.getTripDetail(tripId);
    if (!detail) return null;
    const stats = this.statsFor(detail.stages, detail.totalDistanceKm, detail.totalFuelLiters);
    const hasRoute = detail.stages.some((stage) => stage.pointCount > 0);
    return { ...detail, stats, hasRoute };
  }

  private statsFor(
    stages: readonly StageRecord[],
    totalDistanceKm: number,
    totalLiters: number,
  ): TripStats {
    const idleSeconds = stages.reduce((sum, stage) => sum + stage.idleSeconds, 0);
    const movingSeconds = stages.reduce((sum, stage) => sum + stage.movingSeconds, 0);
    const maxSpeeds = stages
      .map((stage) => stage.maxSpeedKmh)
      .filter((value): value is number => value !== null);
    const consumption =
      totalDistanceKm > 0 ? (totalLiters / totalDistanceKm) * 100 : null;

    return {
      idleSeconds: round(idleSeconds, 0),
      movingSeconds: round(movingSeconds, 0),
      avgSpeedKmh: movingSeconds > 0 ? round(totalDistanceKm / (movingSeconds / 3600), 1) : null,
      maxSpeedKmh: maxSpeeds.length > 0 ? Math.max(...maxSpeeds) : null,
      avgConsumptionLPer100km: consumption,
      avgConsumptionKmPerL: toKmPerL(consumption),
    };
  }

  /**
   * The map payload.
   *
   * Points are decimated again on read — cheap, and it means a stage stored
   * before a decimation tweak still draws at the current density. An RDP pass
   * with a generous epsilon runs last for very long trips, where the stream
   * filter alone still leaves a dense polyline.
   */
  tripCoordinates(
    tripId: number,
    options: { maxPoints?: number; epsilonMeters?: number } = {},
  ): { tripId: number; points: ReturnType<typeof decimate>; bounds: ReturnType<typeof boundsOf> } {
    const stored = this.store.listCoordinates(tripId);
    const decimated = decimate(stored, {
      minDistanceM: MAP_MIN_DISTANCE_M,
      minHeadingDeltaDeg: 5,
    });
    const maxPoints = options.maxPoints ?? 2_000;
    const simplified =
      decimated.length > maxPoints
        ? simplifyRdp(decimated, options.epsilonMeters ?? 25)
        : decimated;

    return {
      tripId,
      points: simplified,
      bounds: boundsOf(simplified),
    };
  }

  /* --------------------------------- fuel -------------------------------- */

  listFuelEvents(options: { pendingOnly?: boolean; limit?: number } = {}): FuelEventRecord[] {
    return this.store.listFuelEvents(options);
  }

  listFuelPrices(): FuelPriceRecord[] {
    return this.store.listFuelPrices();
  }
}
