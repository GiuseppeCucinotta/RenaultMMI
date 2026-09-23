/**
 * The trip engine: ingestion plus the segmentation state machine.
 *
 * It is the only place that decides *what a trip is*. Everything it needs comes
 * in through ports (`TripWriter`, `SettingsPort`, samples), so the same code
 * runs against a literal array of samples in a test and against a CAN bus or a
 * GPS module in the vehicle, with no branch anywhere for "which source is this".
 *
 * State machine
 * -------------
 * ```
 *   no trip            ignition on + movement            ignition off ≥ dwell
 *     │  ──────────────────────────────────────►  driving  ──────────────►  parked
 *     │                                            ▲   │                      │
 *     │  layover > limit, or at the home fence     │   └── ignition on ───────┘
 *     └──────────────── finalize ◄─────────────────┘        (same stage resumes)
 * ```
 * Details that matter:
 *  - An engine that starts and never moves never becomes a stage.
 *  - A stop shorter than the dwell threshold is *inside* the stage; a long
 *    motorway halt is not two trips.
 *  - A stop longer than the dwell threshold but shorter than the layover limit
 *    closes the stage and, away from home, keeps the trip open so the next
 *    ignition appends a leg — that is the road-trip case.
 *  - Only `ignition` off for longer than the dwell threshold closes a stage.
 */

import { createLogger, errorMessage, type Logger } from "../../shared/logger.js";
import type { SettingsPort, TelemetrySource, LocationSource } from "../ports.js";
import type { RefuelInput, StagePatch, TripWriter } from "../store/store.js";
import type {
  Consumption,
  LocationSample,
  StoredCoordinate,
  TripPreferences,
  VehicleSample,
} from "../types.js";
import { DEFAULT_PREFERENCES } from "../types.js";
import { computeTrend, type TrendInput } from "./buckets.js";
import {
  classifyTankDelta,
  consumptionFrom,
  formatMetric,
  litersFromFlow,
  odometerStep,
  round,
} from "./consumption.js";
import { TrajectoryCollector, haversineMeters } from "./trajectory.js";

/** Notified whenever something worth broadcasting changed. */
export type ChangeListener = () => void;

/**
 * The stage currently being driven.
 *
 * `baselineOdometerKm` is what distance integrates from: it is reset after
 * every parking break (which the odometer counts but the trip did not drive)
 * and after an ignition-off layover inside the same stage, so a stage's
 * distance is always "wheels that turned while the engine was running".
 */
interface DraftStage {
  /**
   * Stage row id, or `0` while the stage exists only in RAM. Nothing is written
   * until the car actually moves, so an idling engine leaves no trace at all.
   */
  id: number;
  tripId: number;
  startTime: number;
  startOdometerKm: number | null;
  baselineOdometerKm: number | null;
  lastOdometerKm: number | null;
  lastTimestamp: number;
  distanceKm: number;
  movingSeconds: number;
  idleSeconds: number;
  maxSpeedKmh: number | null;
  startLat: number | null;
  startLon: number | null;
  endLat: number | null;
  endLon: number | null;
  moved: boolean;
  flowSamples: { timestamp: number; flowLph: number }[];
  flowLiters: number;
  tankLiters: number;
  tankLevel: number | null;
  pendingCoordinates: StoredCoordinate[];
  /** Set while the engine is off inside one continuous stage. */
  parkedAt: number | null;
}

export interface TripEngineOptions {
  writer: TripWriter;
  preferences: SettingsPort;
  logger?: Logger;
  currency?: string;
  movementEpsilonKmh: number;
  maxOdometerJumpKm: number;
  refuelDeltaLiters: number;
  /** How often the open stage's live totals are written to SQLite. */
  flushIntervalMs?: number;
  onChange?: ChangeListener;
}

export interface IngestStatus {
  lastSampleAt: number | null;
  vehicleSamples: number;
  locationSamples: number;
  activeTripId: number | null;
  activeStageId: number | null;
}

export interface ActiveStageTotals {
  tripId: number;
  stageId: number;
  startTime: number;
  distanceKm: number;
  liters: number;
  movingSeconds: number;
}

export class TripEngine {
  private readonly writer: TripWriter;
  private readonly logger: Logger;
  private readonly movementEpsilonKmh: number;
  private readonly maxOdometerJumpKm: number;
  private readonly refuelDeltaLiters: number;
  private readonly flushIntervalMs: number;
  private readonly currency: string;
  private readonly unsubscribePrefs: () => void;

  private changeListener: ChangeListener | undefined;
  private prefs: TripPreferences;
  private stage: DraftStage | null = null;
  private lastSample: VehicleSample | null = null;
  private lastLocation: LocationSample | null = null;
  private lastFlushAt = 0;
  private counters = { vehicle: 0, location: 0 };
  private readonly collector = new TrajectoryCollector();

  constructor(options: TripEngineOptions) {
    this.writer = options.writer;
    this.logger = options.logger ?? createLogger("trip-engine");
    this.movementEpsilonKmh = options.movementEpsilonKmh;
    this.maxOdometerJumpKm = options.maxOdometerJumpKm;
    this.refuelDeltaLiters = options.refuelDeltaLiters;
    this.flushIntervalMs = options.flushIntervalMs ?? 1000;
    this.changeListener = options.onChange;
    this.currency = options.currency ?? DEFAULT_PREFERENCES.currency;
    this.prefs = options.preferences.get();
    this.unsubscribePrefs = options.preferences.subscribe((prefs) => {
      this.prefs = prefs;
    });
  }

  setChangeListener(listener: ChangeListener | undefined): void {
    this.changeListener = listener;
  }

  dispose(): void {
    this.unsubscribePrefs();
  }

  /* ------------------------------- boot ---------------------------------- */

  /**
   * Power-loss recovery. A real car loses battery mid-drive, leaving rows marked
   * `active`. They are closed using the last thing actually known about them —
   * the last stored coordinate — so history never shows a trip running forever.
   */
  recover(): void {
    const openTrips = this.writer.listActiveTrips();
    for (const trip of openTrips) {
      const position = this.writer.lastPosition(trip.id);
      const endTime = position?.timestamp ?? trip.endTime ?? trip.startTime;
      for (const stage of this.writer.listStages(trip.id)) {
        if (stage.endTime !== null) continue;
        this.writer.deleteStage(stage.id);
      }
      this.writer.finishTrip(trip.id, endTime, trip.endOdometerKm);
      this.logger.warn(
        `recovered trip ${trip.id} left active by an unclean shutdown (closed at ${new Date(endTime).toISOString()})`,
      );
    }
    if (openTrips.length > 0) this.emitChange();
  }

  /* ------------------------------ ingestion ------------------------------ */

  /** Accepts one vehicle sample and advances the state machine. */
  ingestSample(sample: VehicleSample): void {
    if (!Number.isFinite(sample.timestamp)) return;
    this.counters.vehicle += 1;
    this.lastSample = sample;

    if (this.stage && !sample.ignition) {
      this.handleIgnitionOff(sample);
      return;
    }

    if (!sample.ignition) return; // parked, no trip open: nothing to do

    if (!this.stage) {
      this.beginStage(sample);
      return;
    }

    if (sample.timestamp >= 1718001200000 && sample.timestamp <= 1718001206000) {
    }
    this.resumeIfParked(sample);
    this.accumulate(sample);
    this.flushIfDue(sample.timestamp);
  }

  /** Accepts one GPS fix. Independent of the vehicle path by construction. */
  ingestLocation(sample: LocationSample): void {
    if (
      !Number.isFinite(sample.timestamp) ||
      !Number.isFinite(sample.lat) ||
      !Number.isFinite(sample.lon)
    ) {
      return;
    }
    this.counters.location += 1;
    this.lastLocation = sample;

    const stage = this.stage;
    if (!stage) return;
    // Same rule as `accumulate`: a fix from the past must not extend the route
    // of a stage that has already moved past it.
    if (sample.timestamp < stage.lastTimestamp) return;

    const point = this.collector.push(sample, this.instantConsumption());
    if (stage.startLat === null) {
      stage.startLat = sample.lat;
      stage.startLon = sample.lon;
    }
    stage.endLat = sample.lat;
    stage.endLon = sample.lon;
    if (point) stage.pendingCoordinates.push(point);
  }

  /**
   * Ignition went off: close the stage once the dwell threshold has elapsed.
   *
   * The engine only closes on *its own clock* — the next sample decides. A
   * "stage open" row is therefore always at most one flush interval stale, and
   * the closed/open transition never depends on a wall-clock timer that could
   * fire while the service is suspended.
   */
  private handleIgnitionOff(sample: VehicleSample): void {
    const stage = this.stage;
    if (!stage) return;

    if (stage.parkedAt === null) {
      stage.parkedAt = sample.timestamp;
      // Count the sample itself so a stage does not silently drop its idle tail.
      const elapsed = sample.timestamp - stage.lastTimestamp;
      if (elapsed > 0) stage.idleSeconds += elapsed / 1000;
      stage.lastTimestamp = sample.timestamp;
      return;
    }

    const parkedFor = sample.timestamp - stage.parkedAt;
    const dwellMs = this.prefs.stageDwellMinutes * 60_000;
    if (parkedFor >= dwellMs) {
      // The stop is long enough that this *stage* is over — but whether the
      // *trip* is over is a different question that only the next ignition can
      // answer (home fence, or a layover past the limit). So the stage closes
      // here and the trip is left open, which is what makes a road trip a road
      // trip. A trip that never gets another ignition stays open until boot
      // recovery closes it, which is exactly the "parked for the night" case.
      this.closeStage(stage.parkedAt);
    }
  }

  /**
   * Ignition came back on while a stage is still open: this was a pause, not a
   * departure. Re-baseline the odometer so the kilometres covered by the
   * vehicle's movement during the stop are not credited to the trip.
   */
  private resumeIfParked(sample: VehicleSample): void {
    const stage = this.stage;
    if (!stage || stage.parkedAt === null) return;
    stage.baselineOdometerKm = sample.odometerKm;
    stage.lastOdometerKm = sample.odometerKm;
    stage.parkedAt = null;
    this.logger.log(`stage ${stage.id} resumed after a stop`);
  }

  /**
   * True when the car sits somewhere it is allowed to leave again: inside the
   * home fence. With no location source the engine cannot claim "away from
   * home", so it stays conservative. Guessing here would silently merge
   * unrelated commutes into one road trip.
   */
  private isAwayFromHome(reference: { lat: number; lon: number } | null): boolean {
    const { homeGeofenceLat, homeGeofenceLon, homeGeofenceRadiusM } = this.prefs;
    if (homeGeofenceLat === null || homeGeofenceLon === null) return false;
    const anchor = reference ?? this.lastStagePosition();
    if (!anchor) return false;
    return (
      haversineMeters(anchor, { lat: homeGeofenceLat, lon: homeGeofenceLon }) >
      homeGeofenceRadiusM
    );
  }

  private lastStagePosition(): { lat: number; lon: number } | null {
    const stage = this.stage;
    if (!stage || stage.endLat === null || stage.endLon === null) return null;
    return { lat: stage.endLat, lon: stage.endLon };
  }

  /* ------------------------------ stage flow ----------------------------- */

  private beginStage(sample: VehicleSample): void {
    // If a previous idle never moved, it has no row and must be discarded before
    // the new one can look at "the open trip".
    this.discardUnpersistedStage();

    const previous = this.writer.getOpenTrip();
    let tripId: number;
    let continuing = false;

    if (!previous) {
      tripId = 0;
    } else {
      const stoppedFor =
        this.parkedAt === null ? 0 : Math.max(0, sample.timestamp - this.parkedAt);
      const dwellMs = this.prefs.stageDwellMinutes * 60_000;
      const layoverMs = this.prefs.layoverHours * 3_600_000;
      // A stop inside a *configured* home fence is always a trip boundary: the
      // journey is over. With no fence configured there is no evidence of being
      // home, so a stop within the layover window continues the journey — that
      // is the road-trip case (drive, sleep, drive on).
      const homeConfigured =
        this.prefs.homeGeofenceLat !== null && this.prefs.homeGeofenceLon !== null;
      const atHome = homeConfigured && !this.isAwayFromHome(this.lastLocation);
      const tooLong = stoppedFor > layoverMs;

      if (tooLong || atHome) {
        this.finalizeTrip(previous.id, this.parkedAt ?? sample.timestamp);
        tripId = 0;
      } else if (stoppedFor > dwellMs) {
        // Past the dwell threshold but still within the layover: the driving
        // stage is over, the journey is not. This is the road-trip case.
        tripId = previous.id;
        continuing = true;
        this.writer.markRoadTrip(tripId);
        this.logger.log(`road trip ${tripId}: a new stage begins after a layover`);
      } else {
        // Shorter than the dwell threshold: the same driving stage resumes.
        tripId = previous.id;
        continuing = true;
      }
    }

    this.collector.reset();
    this.stage = {
      // No row yet: `ensurePersisted` creates the trip and stage on the first
      // moving sample. An engine that starts and stalls therefore never appears
      // in history, and the odometer baseline cannot be corrupted by it.
      id: 0,
      tripId,
      startTime: sample.timestamp,
      startOdometerKm: sample.odometerKm,
      baselineOdometerKm: sample.odometerKm,
      lastOdometerKm: sample.odometerKm,
      lastTimestamp: sample.timestamp,
      distanceKm: 0,
      movingSeconds: 0,
      idleSeconds: 0,
      maxSpeedKmh: sample.speedKmh,
      startLat: this.lastLocation?.lat ?? null,
      startLon: this.lastLocation?.lon ?? null,
      endLat: this.lastLocation?.lat ?? null,
      endLon: this.lastLocation?.lon ?? null,
      moved: (sample.speedKmh ?? 0) > this.movementEpsilonKmh,
      flowSamples:
        sample.fuelFlowLph === null ? [] : [{ timestamp: sample.timestamp, flowLph: sample.fuelFlowLph }],
      flowLiters: 0,
      tankLiters: 0,
      tankLevel: sample.fuelLevelLiters,
      pendingCoordinates: [],
      parkedAt: null,
    };

    if (!continuing) {
      this.logger.log(`trip ${tripId} starting (awaiting movement)`);
    }
    this.emitChange();
  }

  private accumulate(sample: VehicleSample): void {
    const stage = this.stage;
    if (!stage) return;

    // A sample older than what this stage has already recorded is not an
    // observation of the present. Letting it through would corrupt the stage:
    // a negative elapsed time, and an odometer baseline that walks backwards.
    // This happens for real when a replay or a backlog is fed to a live stage —
    // and it is why a seeded history can never contaminate a drive in progress.
    if (sample.timestamp < stage.lastTimestamp) return;

    const moving = (sample.speedKmh ?? 0) > this.movementEpsilonKmh;
    if (moving) stage.moved = true;
    if (stage.moved) this.ensurePersisted(stage, sample);

    const elapsed = sample.timestamp - stage.lastTimestamp;
    if (elapsed > 0) {
      if (moving) stage.movingSeconds += elapsed / 1000;
      else stage.idleSeconds += elapsed / 1000;
    }

    const step = odometerStep(
      stage.baselineOdometerKm,
      sample.odometerKm,
      this.maxOdometerJumpKm,
    );
    if (step !== null && step > 0) stage.distanceKm += step;

    if (sample.speedKmh !== null) {
      stage.maxSpeedKmh =
        stage.maxSpeedKmh === null
          ? sample.speedKmh
          : Math.max(stage.maxSpeedKmh, sample.speedKmh);
    }

    this.accumulateFuel(sample, stage);
    stage.baselineOdometerKm = sample.odometerKm;
    stage.lastOdometerKm = sample.odometerKm;
    stage.lastTimestamp = sample.timestamp;
  }

  /**
   * Two independent fuel models, because a vehicle may expose either.
   *
   * The tank level needs care: a *rise* is a refuel, recorded as a fuel event
   * with zero burned litres. Counting it as negative consumption would silently
   * cancel real consumption elsewhere in the same stage.
   */
  private accumulateFuel(sample: VehicleSample, stage: DraftStage): void {
    if (sample.fuelFlowLph !== null) {
      stage.flowSamples.push({ timestamp: sample.timestamp, flowLph: sample.fuelFlowLph });
      stage.flowLiters = litersFromFlow(stage.flowSamples);
    }

    if (sample.fuelLevelLiters === null) return;

    if (stage.tankLevel === null) {
      stage.tankLevel = sample.fuelLevelLiters;
      return;
    }

    const delta = classifyTankDelta(stage.tankLevel, sample.fuelLevelLiters);
    if (delta.isRise && delta.deltaLiters >= this.refuelDeltaLiters) {
      const input: RefuelInput = {
        timestamp: sample.timestamp,
        litersAdded: delta.deltaLiters,
        levelBeforeL: stage.tankLevel,
        levelAfterL: sample.fuelLevelLiters,
        tripId: stage.tripId,
        stageId: stage.id,
      };
      const eventId = this.writer.recordRefuel(input);
      this.logger.log(
        `refuel detected: +${round(delta.deltaLiters, 2)} l (event ${eventId}) — price required`,
      );
      this.emitChange();
    } else if (!delta.isRise) {
      stage.tankLiters += delta.litersBurned;
    }

    stage.tankLevel = sample.fuelLevelLiters;
  }

  /** Litres burned so far: flow when available, tank level otherwise. */
  private litersBurned(stage: DraftStage): number {
    if (stage.flowSamples.length >= 2) return Math.max(0, stage.flowLiters);
    return Math.max(0, stage.tankLiters);
  }

  /**
   * Localized consumption for a trajectory point.
   *
   * `null` until the stage has both litres and distance to divide: a point must
   * never claim a consumption that has not been measured yet.
   */
  private instantConsumption(): number | null {
    const stage = this.stage;
    if (!stage) return null;
    const liters = this.litersBurned(stage);
    if (liters <= 0 || stage.distanceKm <= 0) return null;
    return round((liters / stage.distanceKm) * 100, 3);
  }

  private flushIfDue(timestamp: number): void {
    if (timestamp - this.lastFlushAt < this.flushIntervalMs) return;
    this.flushStage(timestamp);
  }

  private flushStage(timestamp: number): void {
    const stage = this.stage;
    if (!stage || stage.id === 0) return;
    this.lastFlushAt = timestamp;
    this.writeStage(stage, timestamp, "active");
  }

  /** Closes the current stage, discarding it when it was never a real drive. */
  private closeStage(endTime: number): void {
    const stage = this.stage;
    if (!stage) return;
    this.stage = null;
    this.collector.reset();
    this.parkedAt = endTime;

    if (!stage.moved) {
      // Ignition on, doors opened, nothing happened. Nothing was ever written,
      // so this only clears the RAM state — but a stage that *was* persisted and
      // then stopped without moving (possible if the first sample already crept
      // past the epsilon) is removed so history stays clean.
      this.logger.log(`discarding stage ${stage.id}: no movement`);
      if (stage.id !== 0) this.writer.deleteStage(stage.id);
      this.emitChange();
      return;
    }

    this.writeStage(stage, endTime, "completed");
    this.logger.log(
      `stage ${stage.id} completed: ${round(stage.distanceKm, 2)} km, ${round(this.litersBurned(stage), 2)} l`,
    );
    this.emitChange();
  }

  /**
   * Creates the trip and stage rows the first time the car moves.
   *
   * Deferring this is what keeps "ignition on, engine idling, nobody moved" out
   * of the database entirely — and it means the odometer baseline is taken from
   * a real moving sample rather than from a cold start.
   */
  private ensurePersisted(stage: DraftStage, sample: VehicleSample): void {
    if (stage.id !== 0) return;
    if (stage.tripId === 0) {
      stage.tripId = this.writer.openTrip(stage.startTime, stage.startOdometerKm);
    }
    stage.id = this.writer.openStage(stage.tripId, stage.startTime, stage.startOdometerKm);
    stage.baselineOdometerKm = sample.odometerKm;
    stage.lastOdometerKm = sample.odometerKm;
    this.logger.log(`trip ${stage.tripId} started (stage ${stage.id})`);
  }

  /** Throws away an in-RAM stage that never moved, without touching the store. */
  private discardUnpersistedStage(): void {
    const stage = this.stage;
    if (!stage) return;
    this.stage = null;
    this.collector.reset();
    if (stage.id === 0) return;
    this.writer.deleteStage(stage.id);
  }

  private writeStage(
    stage: DraftStage,
    endTime: number,
    status: "active" | "completed",
  ): void {
    // A stage that never moved has no row: writing one would create the very
    // empty stage the deferral exists to avoid.
    if (stage.id === 0) return;

    const liters = this.litersBurned(stage);
    if (stage.pendingCoordinates.length > 0) {
      this.writer.appendCoordinates(stage.id, stage.pendingCoordinates);
      stage.pendingCoordinates = [];
    }

    const consumption: Consumption = consumptionFrom(liters, stage.distanceKm);
    const patch: StagePatch = {
      startTime: stage.startTime,
      endTime,
      startLat: stage.startLat,
      startLon: stage.startLon,
      endLat: stage.endLat,
      endLon: stage.endLon,
      distanceKm: stage.distanceKm,
      fuelLiters: liters,
      avgConsumptionLPer100km: consumption.lPer100km,
      idleSeconds: stage.idleSeconds,
      movingSeconds: stage.movingSeconds,
      maxSpeedKmh: stage.maxSpeedKmh,
      avgSpeedKmh:
        stage.movingSeconds > 0 ? stage.distanceKm / (stage.movingSeconds / 3600) : null,
      startOdometerKm: stage.startOdometerKm,
      endOdometerKm: stage.lastOdometerKm,
      status,
    };

    if (status === "completed") this.writer.finishStage(stage.id, patch);
    else this.writer.updateStage(stage.id, patch);
  }

  private finalizeTrip(tripId: number, endTime: number): void {
    this.writer.finishTrip(tripId, endTime, this.lastSample?.odometerKm ?? null);
    this.logger.log(`trip ${tripId} completed`);
  }

  /** Closes whatever is open, for shutdown and for a forced end. */
  closeOpenStage(endTime: number): void {
    if (this.stage) this.closeStage(endTime);
    const open = this.writer.getOpenTrip();
    if (open) this.finalizeTrip(open.id, endTime);
  }

  /* ------------------------------- reports ------------------------------- */

  status(): IngestStatus {
    return {
      lastSampleAt: this.lastSample?.timestamp ?? null,
      vehicleSamples: this.counters.vehicle,
      locationSamples: this.counters.location,
      activeTripId: this.stage?.tripId ?? this.writer.getOpenTrip()?.id ?? null,
      activeStageId: this.stage?.id ?? null,
    };
  }

  activeTotals(): ActiveStageTotals | null {
    const stage = this.stage;
    if (!stage) return null;
    return {
      tripId: stage.tripId,
      stageId: stage.id,
      startTime: stage.startTime,
      distanceKm: stage.distanceKm,
      liters: this.litersBurned(stage),
      movingSeconds: stage.movingSeconds,
    };
  }

  get preferencesSnapshot(): TripPreferences {
    return this.prefs;
  }

  get currencyCode(): string {
    return this.currency;
  }

  /** Timestamp the previous stage ended, i.e. when this journey paused. */
  private parkedAt: number | null = null;
  private emitChange(): void {
    this.changeListener?.();
  }
}

/**
 * Flushes and closes whatever is open on shutdown. Without it the last
 * `flushIntervalMs` of the current stage is lost, which on an appliance that
 * gets switched off at the ignition is every drive.
 */
export function shutdownEngine(
  engine: TripEngine,
  sources: { telemetry?: TelemetrySource; location?: LocationSource },
  logger: Logger = createLogger("trip-engine"),
): void {
  try {
    sources.telemetry?.stop();
    sources.location?.stop();
    const totals = engine.activeTotals();
    engine.closeOpenStage(Date.now());
    if (totals) {
      logger.log(
        `shutdown: closed stage ${totals.stageId} at ${round(totals.distanceKm, 2)} km`,
      );
    }
  } catch (error) {
    logger.error("shutdown flush failed:", errorMessage(error));
  }
}

/** Re-exported so the service imports one module, not three. */
export { computeTrend, formatMetric, type TrendInput };
