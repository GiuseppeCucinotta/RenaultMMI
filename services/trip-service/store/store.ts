/**
 * The persistence and read model.
 *
 * One class, two faces:
 *
 *  - `TripWriter` is the narrow slice the engine is allowed to touch —
 *    open/advance/finish, coordinates, refuels. The engine cannot run a query,
 *    which is what keeps "compute" and "report" from bleeding into each other.
 *  - The public methods are the read model the HTTP layer builds responses from.
 *
 * All money and consumption derived here is aggregated from stage rows, never
 * patched incrementally, so the spec's parity invariants (`SUM(stages) == trip`)
 * hold by construction rather than by discipline.
 */

import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import type {
  FuelEventRecord,
  FuelEventSource,
  FuelPriceRecord,
  StageRecord,
  StoredCoordinate,
  TripBoundingBox,
  TripDetail,
  TripRecord,
  TripStatus,
} from "../types.js";
import { migrate } from "./schema.js";

/* -------------------------------------------------------------------------- */
/* Row shapes                                                                 */
/* -------------------------------------------------------------------------- */

interface TripRow {
  id: number;
  title: string | null;
  start_time: number;
  end_time: number | null;
  total_distance_km: number;
  total_fuel_liters: number;
  fuel_cost: number | null;
  is_road_trip: number;
  status: string;
  start_odometer_km: number | null;
  end_odometer_km: number | null;
}

interface StageRow {
  id: number;
  trip_id: number;
  stage_number: number;
  start_time: number;
  end_time: number | null;
  start_lat: number | null;
  start_lon: number | null;
  end_lat: number | null;
  end_lon: number | null;
  distance_km: number;
  fuel_liters: number;
  avg_consumption_l_per_100km: number | null;
  idle_seconds: number;
  moving_seconds: number;
  max_speed_kmh: number | null;
  avg_speed_kmh: number | null;
  start_odometer_km: number | null;
  end_odometer_km: number | null;
  status: string;
  point_count: number;
}

interface FuelEventRow {
  id: number;
  trip_id: number | null;
  stage_id: number | null;
  timestamp: number;
  liters_added: number;
  level_before_l: number | null;
  level_after_l: number | null;
  source: string;
  confirmed: number;
}

interface CoordinateRow {
  timestamp: number;
  lat: number;
  lon: number;
  speed_kmh: number | null;
  instant_consumption_l_per_100km: number | null;
}

interface FuelPriceRow {
  id: number;
  timestamp: number;
  price_per_liter: number;
  currency: string;
}

/**
 * `node:sqlite` statically types a result row as `Record<string, SQLOutputValue>`,
 * which is not structurally comparable to a declared row interface. The schema in
 * `schema.ts` is the authority for these shapes and `migrate()` guarantees the
 * columns exist, so the narrowing is deliberate and lives in these two helpers
 * rather than being sprinkled across every query.
 */
function asRows<T>(result: unknown): T[] {
  return result as T[];
}

function asRow<T>(result: unknown): T | undefined {
  return result as T | undefined;
}

function toTripRecord(row: TripRow): TripRecord {
  return {
    id: row.id,
    title: row.title,
    startTime: row.start_time,
    endTime: row.end_time,
    totalDistanceKm: row.total_distance_km,
    totalFuelLiters: row.total_fuel_liters,
    fuelCost: row.fuel_cost,
    isRoadTrip: row.is_road_trip === 1,
    status: row.status as TripStatus,
    startOdometerKm: row.start_odometer_km,
    endOdometerKm: row.end_odometer_km,
  };
}

function toStageRecord(row: StageRow): StageRecord {
  return {
    id: row.id,
    tripId: row.trip_id,
    stageNumber: row.stage_number,
    startTime: row.start_time,
    endTime: row.end_time,
    startLat: row.start_lat,
    startLon: row.start_lon,
    endLat: row.end_lat,
    endLon: row.end_lon,
    distanceKm: row.distance_km,
    fuelLiters: row.fuel_liters,
    avgConsumptionLPer100km: row.avg_consumption_l_per_100km,
    idleSeconds: row.idle_seconds,
    movingSeconds: row.moving_seconds,
    maxSpeedKmh: row.max_speed_kmh,
    avgSpeedKmh: row.avg_speed_kmh,
    startOdometerKm: row.start_odometer_km,
    endOdometerKm: row.end_odometer_km,
    status: row.status as TripStatus,
    pointCount: row.point_count ?? 0,
  };
}

function toFuelEvent(row: FuelEventRow): FuelEventRecord {
  return {
    id: row.id,
    tripId: row.trip_id,
    stageId: row.stage_id,
    timestamp: row.timestamp,
    litersAdded: row.liters_added,
    levelBeforeL: row.level_before_l,
    levelAfterL: row.level_after_l,
    source: row.source as FuelEventSource,
    confirmed: row.confirmed === 1,
  };
}

/* -------------------------------------------------------------------------- */
/* Writer contract (all the engine may do)                                    */
/* -------------------------------------------------------------------------- */

export interface StagePatch {
  startTime?: number;
  endTime: number | null;
  startLat?: number | null;
  startLon?: number | null;
  endLat?: number | null;
  endLon?: number | null;
  distanceKm: number;
  fuelLiters: number;
  avgConsumptionLPer100km?: number | null;
  idleSeconds: number;
  movingSeconds: number;
  maxSpeedKmh: number | null;
  avgSpeedKmh: number | null;
  startOdometerKm?: number | null;
  endOdometerKm?: number | null;
  status: TripStatus;
}

export interface RefuelInput {
  timestamp: number;
  litersAdded: number;
  levelBeforeL: number | null;
  levelAfterL: number | null;
  tripId: number | null;
  stageId: number | null;
}

export interface TripWriter {
  openTrip(startTime: number, startOdometerKm: number | null): number;
  getOpenTrip(): TripRecord | null;
  finishTrip(tripId: number, endTime: number, endOdometerKm: number | null): void;
  markRoadTrip(tripId: number): void;
  openStage(tripId: number, startTime: number, startOdometerKm: number | null): number;
  updateStage(stageId: number, patch: StagePatch): void;
  finishStage(stageId: number, patch: StagePatch): void;
  /** Removes a stage that never became a real drive. */
  deleteStage(stageId: number): void;
  appendCoordinates(stageId: number, points: readonly StoredCoordinate[]): void;
  recordRefuel(input: RefuelInput): number;
  listActiveTrips(): TripRecord[];
  listStages(tripId: number): StageRecord[];
  /** Last known position of a trip, for power-loss recovery. */
  lastPosition(tripId: number): { lat: number; lon: number; timestamp: number } | null;
}

/** Directory holding a database file, or `.` for a bare filename. */
function dirnameOf(filePath: string): string {
  const resolved = path.dirname(filePath);
  return resolved.length > 0 ? resolved : ".";
}

const STAGE_SELECT = `
  SELECT s.*,
         (SELECT COUNT(*) FROM trip_coordinates c WHERE c.stage_id = s.id) AS point_count
  FROM trip_stages s`;

/* -------------------------------------------------------------------------- */
/* Store                                                                     */
/* -------------------------------------------------------------------------- */

export class TripStore implements TripWriter {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    // `node:sqlite` will create the file but **not** the directory holding it,
    // and the default location lives under `~/.config/renault-mmi`, which does
    // not exist on a fresh machine. Without this the service dies at boot with
    // "unable to open database file" — and, spawned with `stdio: 'ignore'` by
    // Electron, it dies silently.
    if (path !== ":memory:") {
      try {
        mkdirSync(dirnameOf(path), { recursive: true });
      } catch (error) {
        // Report the path in the failure: this is the difference between a
        // read-only home and a typo, and the log is all a developer gets.
        throw new Error(
          `cannot create the trip database directory ${dirnameOf(path)}: ${(error as Error).message}`,
        );
      }
    }
    try {
      this.db = new DatabaseSync(path);
    } catch (error) {
      throw new Error(`${(error as Error).message} (trip database: ${path})`);
    }
    if (path !== ":memory:") {
      // WAL lets the UI read while samples are being written; NORMAL is the
      // right durability trade for a device that can lose power at any moment.
      this.db.exec("PRAGMA journal_mode = WAL");
      this.db.exec("PRAGMA synchronous = NORMAL");
    }
    this.db.exec("PRAGMA foreign_keys = ON");
    migrate(this.db);
  }

  get database(): DatabaseSync {
    return this.db;
  }

  /** Runs `fn` inside a transaction, rolling back on any throw. */
  transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  close(): void {
    this.db.close();
  }

  /* -------------------------------- trips -------------------------------- */

  openTrip(startTime: number, startOdometerKm: number | null): number {
    const now = Date.now();
    const result = this.db
      .prepare(
        `INSERT INTO trips (start_time, status, start_odometer_km, created_at, updated_at)
         VALUES (?, 'active', ?, ?, ?)`,
      )
      .run(startTime, startOdometerKm, now, now);
    return Number(result.lastInsertRowid);
  }

  getOpenTrip(): TripRecord | null {
    const found = this.db
      .prepare("SELECT * FROM trips WHERE status = 'active' ORDER BY start_time DESC LIMIT 1")
      .get();
    const record = asRow<TripRow>(found);
    return record ? toTripRecord(record) : null;
  }

  /**
   * Closes a trip. Totals are recomputed here rather than left to the engine,
   * so no caller can complete a trip and leave its stored totals stale — which
   * is exactly what happened before this was in one place.
   */
  finishTrip(tripId: number, endTime: number, endOdometerKm: number | null): void {
    this.transaction(() => {
      this.db
        .prepare(
          `UPDATE trips
           SET end_time = ?, end_odometer_km = COALESCE(?, end_odometer_km),
               status = 'completed', updated_at = ?
           WHERE id = ?`,
        )
        .run(endTime, endOdometerKm, Date.now(), tripId);
      this.recomputeTrip(tripId);
    });
  }

  markRoadTrip(tripId: number): void {
    this.db.prepare("UPDATE trips SET is_road_trip = 1 WHERE id = ?").run(tripId);
  }

  getTrip(id: number): TripRecord | null {
    const found = this.db.prepare("SELECT * FROM trips WHERE id = ?").get(id);
    const record = asRow<TripRow>(found);
    return record ? toTripRecord(record) : null;
  }

  listActiveTrips(): TripRecord[] {
    const found = this.db
      .prepare("SELECT * FROM trips WHERE status = 'active' ORDER BY start_time")
      .all();
    return asRows<TripRow>(found).map(toTripRecord);
  }

  /**
   * Recomputes a trip's stored totals from its stages.
   *
   * The open stage is projected to zero on purpose: live progress belongs to
   * `/api/status`, while trip history must not show a number that has not
   * finished happening yet.
   */
  recomputeTrip(tripId: number): void {
    const stages = this.listStages(tripId);
    const completed = stages.map((stage) => {
      // A stage with no end time is still being driven: contribute nothing yet.
      const progress = stage.endTime === null ? 0 : 1;
      return {
        distanceKm: stage.distanceKm * progress,
        fuelLiters: stage.fuelLiters * progress,
      };
    });

    const distanceKm = completed.reduce((sum, stage) => sum + stage.distanceKm, 0);
    const fuelLiters = completed.reduce((sum, stage) => sum + stage.fuelLiters, 0);
    // Money is *not* stored: it depends on the refuel price history, so it is
    // derived at read time from the same stage rows. Storing it here would mean
    // a corrected fuel price silently left stale costs behind.

    const odometers = stages
      .map((stage) => stage.endOdometerKm)
      .filter((value): value is number => value !== null);

    this.db
      .prepare(
        `UPDATE trips
         SET total_distance_km = ?, total_fuel_liters = ?, fuel_cost = ?,
             end_odometer_km = COALESCE(?, end_odometer_km), updated_at = ?
         WHERE id = ?`,
      )
      .run(
        distanceKm,
        fuelLiters,
        // Trip-level money is derived at read time (see `query.ts`); the column
        // stays null so nothing can present it as an authoritative total.
        null,
        odometers.length > 0 ? Math.max(...odometers) : null,
        Date.now(),
        tripId,
      );
  }

  /* -------------------------------- stages ------------------------------- */

  openStage(tripId: number, startTime: number, startOdometerKm: number | null): number {
    const maxFound = this.db
      .prepare("SELECT COALESCE(MAX(stage_number), 0) AS n FROM trip_stages WHERE trip_id = ?")
      .get(tripId);
    const maxNumber = asRow<{ n: number }>(maxFound)?.n ?? 0;
    const result = this.db
      .prepare(
        `INSERT INTO trip_stages
           (trip_id, stage_number, start_time, start_odometer_km, status)
         VALUES (?, ?, ?, ?, 'active')`,
      )
      .run(tripId, Number(maxNumber) + 1, startTime, startOdometerKm);
    return Number(result.lastInsertRowid);
  }

  updateStage(stageId: number, patch: StagePatch): void {
    this.writeStage(stageId, patch);
  }

  /** Late-binds the stage's trip, so finalizing always recomputes the right one. */
  private tripIdOf(stageId: number): number | null {
    const found = this.db
      .prepare("SELECT trip_id FROM trip_stages WHERE id = ?")
      .get(stageId);
    return asRow<{ trip_id: number }>(found)?.trip_id ?? null;
  }

  /**
   * Finalizes a stage and recomputes its trip in one transaction, so the stored
   * totals can never describe a stage set that no longer exists.
   */
  finishStage(stageId: number, patch: StagePatch): void {
    this.transaction(() => {
      this.writeStage(stageId, patch);
      const tripId = this.tripIdOf(stageId);
      if (tripId !== null) this.recomputeTrip(tripId);
    });
  }

  private writeStage(stageId: number, patch: StagePatch): void {
    this.db
      .prepare(
        `UPDATE trip_stages SET
           start_time = COALESCE(?, start_time),
           end_time = ?,
           start_lat = COALESCE(?, start_lat),
           start_lon = COALESCE(?, start_lon),
           end_lat = COALESCE(?, end_lat),
           end_lon = COALESCE(?, end_lon),
           distance_km = ?,
           fuel_liters = ?,
           avg_consumption_l_per_100km = COALESCE(?, avg_consumption_l_per_100km),
           idle_seconds = ?,
           moving_seconds = ?,
           max_speed_kmh = ?,
           avg_speed_kmh = ?,
           start_odometer_km = COALESCE(?, start_odometer_km),
           end_odometer_km = COALESCE(?, end_odometer_km),
           status = ?
         WHERE id = ?`,
      )
      .run(
        patch.startTime ?? null,
        patch.endTime,
        patch.startLat ?? null,
        patch.startLon ?? null,
        patch.endLat ?? null,
        patch.endLon ?? null,
        patch.distanceKm,
        patch.fuelLiters,
        patch.avgConsumptionLPer100km ?? null,
        patch.idleSeconds,
        patch.movingSeconds,
        patch.maxSpeedKmh,
        patch.avgSpeedKmh,
        patch.startOdometerKm ?? null,
        patch.endOdometerKm ?? null,
        patch.status,
        stageId,
      );
  }

  getStage(stageId: number): StageRecord | null {
    const found = this.db.prepare(`${STAGE_SELECT} WHERE s.id = ?`).get(stageId);
    const record = asRow<StageRow>(found);
    return record ? toStageRecord(record) : null;
  }

  /**
   * Drops a stage that never became a drive, coordinates included, then
   * recomputes its trip so no stale total survives.
   */
  deleteStage(stageId: number): void {
    this.transaction(() => {
      const found = this.db
        .prepare("SELECT trip_id FROM trip_stages WHERE id = ?")
        .get(stageId);
      const owner = asRow<{ trip_id: number }>(found);
      this.db.prepare("DELETE FROM trip_coordinates WHERE stage_id = ?").run(stageId);
      this.db.prepare("DELETE FROM trip_stages WHERE id = ?").run(stageId);
      if (owner) this.recomputeTrip(owner.trip_id);
    });
  }

  listStages(tripId: number): StageRecord[] {
    const found = this.db
      .prepare(`${STAGE_SELECT} WHERE s.trip_id = ? ORDER BY s.stage_number`)
      .all(tripId);
    return asRows<StageRow>(found).map(toStageRecord);
  }

  /** Every stage that started inside `[from, to)` — the read model of a window. */
  listStagesInWindow(from: number, to: number): StageRecord[] {
    const found = this.db
      .prepare(
        `${STAGE_SELECT} WHERE s.start_time >= ? AND s.start_time < ? ORDER BY s.start_time`,
      )
      .all(from, to);
    return asRows<StageRow>(found).map(toStageRecord);
  }

  /** True when any stage started in the window, used for trend comparability. */
  hasDataInWindow(from: number, to: number): boolean {
    const found = this.db
      .prepare(
        "SELECT 1 AS present FROM trip_stages WHERE start_time >= ? AND start_time < ? LIMIT 1",
      )
      .get(from, to);
    return asRow<{ present?: number }>(found) !== undefined;
  }

  /** Start time of the oldest stage, for the "all time" period preset. */
  earliestStageTime(): number | null {
    const found = this.db.prepare("SELECT MIN(start_time) AS t FROM trip_stages").get();
    return asRow<{ t: number | null }>(found)?.t ?? null;
  }

  /* ----------------------------- coordinates ----------------------------- */

  appendCoordinates(stageId: number, points: readonly StoredCoordinate[]): void {
    if (points.length === 0) return;
    const statement = this.db.prepare(
      `INSERT INTO trip_coordinates
         (stage_id, timestamp, lat, lon, speed_kmh, instant_consumption_l_per_100km)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    this.transaction(() => {
      for (const point of points) {
        statement.run(
          stageId,
          point.timestamp,
          point.lat,
          point.lon,
          point.speedKmh,
          point.consumptionLPer100km,
        );
      }
    });
  }

  listCoordinates(tripId: number): StoredCoordinate[] {
    const found = this.db
      .prepare(
        `SELECT c.timestamp, c.lat, c.lon, c.speed_kmh, c.instant_consumption_l_per_100km
         FROM trip_coordinates c
         JOIN trip_stages s ON s.id = c.stage_id
         WHERE s.trip_id = ?
         ORDER BY c.timestamp`,
      )
      .all(tripId);
    return asRows<CoordinateRow>(found).map((row) => ({
      timestamp: row.timestamp,
      lat: row.lat,
      lon: row.lon,
      speedKmh: row.speed_kmh,
      consumptionLPer100km: row.instant_consumption_l_per_100km,
    }));
  }

  coordinatesBounds(tripId: number): TripBoundingBox | null {
    const found = this.db
      .prepare(
        `SELECT MIN(c.lat) AS minLat, MIN(c.lon) AS minLon,
                MAX(c.lat) AS maxLat, MAX(c.lon) AS maxLon
         FROM trip_coordinates c
         JOIN trip_stages s ON s.id = c.stage_id
         WHERE s.trip_id = ?`,
      )
      .get(tripId);
    const bounds = asRow<{
      minLat: number | null;
      minLon: number | null;
      maxLat: number | null;
      maxLon: number | null;
    }>(found);
    if (
      !bounds ||
      bounds.minLat === null ||
      bounds.minLon === null ||
      bounds.maxLat === null ||
      bounds.maxLon === null
    ) {
      return null;
    }
    return {
      minLat: bounds.minLat,
      minLon: bounds.minLon,
      maxLat: bounds.maxLat,
      maxLon: bounds.maxLon,
    };
  }

  /** Last known position of a trip, for power-loss recovery and geofencing. */
  lastPosition(tripId: number): { lat: number; lon: number; timestamp: number } | null {
    const found = this.db
      .prepare(
        `SELECT c.timestamp, c.lat, c.lon
         FROM trip_coordinates c
         JOIN trip_stages s ON s.id = c.stage_id
         WHERE s.trip_id = ?
         ORDER BY c.timestamp DESC LIMIT 1`,
      )
      .get(tripId);
    return asRow<{ timestamp: number; lat: number; lon: number }>(found) ?? null;
  }

  /* ------------------------------- trip lists ---------------------------- */

  listTrips(options: { limit: number; offset: number; from?: number; to?: number }): {
    trips: TripRecord[];
    total: number;
  } {
    const conditions: string[] = [];
    const params: number[] = [];
    if (options.from !== undefined) {
      conditions.push("start_time >= ?");
      params.push(options.from);
    }
    if (options.to !== undefined) {
      conditions.push("start_time < ?");
      params.push(options.to);
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const totalFound = this.db
      .prepare(`SELECT COUNT(*) AS n FROM trips ${where}`)
      .get(...params);
    const total = asRow<{ n: number }>(totalFound)?.n ?? 0;

    const found = this.db
      .prepare(`SELECT * FROM trips ${where} ORDER BY start_time DESC LIMIT ? OFFSET ?`)
      .all(...params, options.limit, options.offset);

    return { trips: asRows<TripRow>(found).map(toTripRecord), total: Number(total) };
  }

  tripCount(): number {
    const found = this.db.prepare("SELECT COUNT(*) AS n FROM trips").get();
    return Number(asRow<{ n: number }>(found)?.n ?? 0);
  }

  /** Assembles a trip detail: the record, its stages and its averages. */
  getTripDetail(tripId: number): TripDetail | null {
    const trip = this.getTrip(tripId);
    if (!trip) return null;
    const stages = this.listStages(tripId);
    const distance = trip.totalDistanceKm;
    const liters = trip.totalFuelLiters;
    const lPer100km = distance > 0 ? (liters / distance) * 100 : null;
    return {
      ...trip,
      stages,
      legs: stages.length,
      avgConsumptionLPer100km: lPer100km,
      avgConsumptionKmPerL: lPer100km && lPer100km > 0 ? 100 / lPer100km : null,
    };
  }

  /**
   * Merges `sourceId` into `targetId`.
   *
   * The caller has already proven adjacency; this only rewires rows. Stage
   * numbers are renumbered by start time so a merged trip reads as one
   * continuous journey rather than two interleaved ones.
   */
  mergeTrips(targetId: number, sourceId: number): void {
    this.transaction(() => {
      const source = this.getTrip(sourceId);
      if (!source) throw new Error(`trip ${sourceId} not found`);

      this.db
        .prepare("UPDATE trip_stages SET trip_id = ? WHERE trip_id = ?")
        .run(targetId, sourceId);

      const stages = this.listStages(targetId);
      const renumber = this.db.prepare("UPDATE trip_stages SET stage_number = ? WHERE id = ?");
      stages
        .slice()
        .sort((a, b) => a.startTime - b.startTime)
        .forEach((stage, index) => renumber.run(index + 1, stage.id));

      this.db
        .prepare(
          `UPDATE trips SET end_time = COALESCE(?, end_time), is_road_trip = 1, updated_at = ?
           WHERE id = ?`,
        )
        .run(source.endTime, Date.now(), targetId);
      this.db.prepare("DELETE FROM trips WHERE id = ?").run(sourceId);
      this.recomputeTrip(targetId);
    });
  }

  /**
   * Splits `tripId` at `stageId`: that stage and every later one move to a new
   * trip. Returns the new trip's id.
   */
  splitTrip(tripId: number, stageId: number, now = Date.now()): number {
    return this.transaction(() => {
      const stages = this.listStages(tripId);
      const splitIndex = stages.findIndex((stage) => stage.id === stageId);
      if (splitIndex < 0) throw new Error(`stage ${stageId} not in trip ${tripId}`);
      if (splitIndex === 0) throw new Error("cannot split before the first stage");

      const moving = stages.slice(splitIndex);
      const kept = stages.slice(0, splitIndex);
      const keptLast = kept[kept.length - 1];
      const movedLast = moving[moving.length - 1];

      const newTripId = this.openTrip(moving[0].startTime, moving[0].startOdometerKm);
      const move = this.db.prepare(
        "UPDATE trip_stages SET trip_id = ?, stage_number = ? WHERE id = ?",
      );
      moving.forEach((stage, index) => move.run(newTripId, index + 1, stage.id));

      this.db
        .prepare("UPDATE trips SET end_time = ?, updated_at = ? WHERE id = ?")
        .run(keptLast.endTime, now, tripId);
      this.db
        .prepare(
          `UPDATE trips
           SET end_time = ?, end_odometer_km = ?, status = 'completed', updated_at = ?
           WHERE id = ?`,
        )
        .run(movedLast.endTime, movedLast.endOdometerKm, now, newTripId);

      this.recomputeTrip(tripId);
      this.recomputeTrip(newTripId);
      return newTripId;
    });
  }

  /* --------------------------------- fuel -------------------------------- */

  recordRefuel(input: RefuelInput): number {
    const result = this.db
      .prepare(
        `INSERT INTO fuel_events
           (trip_id, stage_id, timestamp, liters_added, level_before_l, level_after_l, source, confirmed)
         VALUES (?, ?, ?, ?, ?, ?, 'detected', 0)`,
      )
      .run(
        input.tripId,
        input.stageId,
        input.timestamp,
        input.litersAdded,
        input.levelBeforeL,
        input.levelAfterL,
      );
    return Number(result.lastInsertRowid);
  }

  listFuelEvents(options: { pendingOnly?: boolean; limit?: number } = {}): FuelEventRecord[] {
    const where = options.pendingOnly ? "WHERE confirmed = 0" : "";
    const found = this.db
      .prepare(`SELECT * FROM fuel_events ${where} ORDER BY timestamp DESC LIMIT ?`)
      .all(options.limit ?? 100);
    return asRows<FuelEventRow>(found).map(toFuelEvent);
  }

  countPendingRefuels(): number {
    const found = this.db
      .prepare("SELECT COUNT(*) AS n FROM fuel_events WHERE confirmed = 0")
      .get();
    return Number(asRow<{ n: number }>(found)?.n ?? 0);
  }

  getFuelEvent(id: number): FuelEventRecord | null {
    const found = this.db.prepare("SELECT * FROM fuel_events WHERE id = ?").get(id);
    const record = asRow<FuelEventRow>(found);
    return record ? toFuelEvent(record) : null;
  }

  /**
   * Confirms a refuel and records the price that was paid.
   *
   * The litre amount already lives on the event; pricing it separately means a
   * corrected price re-costs every trip that burned that fuel.
   */
  confirmRefuel(id: number, pricePerLiter: number, currency: string): FuelPriceRecord | null {
    return this.transaction(() => {
      const event = this.getFuelEvent(id);
      if (!event) return null;

      this.db.prepare("UPDATE fuel_events SET confirmed = 1 WHERE id = ?").run(id);
      const result = this.db
        .prepare("INSERT INTO fuel_prices (timestamp, price_per_liter, currency) VALUES (?, ?, ?)")
        .run(event.timestamp, pricePerLiter, currency);

      // Re-cost the trip the refuel belongs to, so the UI sees the new money on
      // its next read rather than after some later mutation.
      if (event.tripId !== null) {
        this.recomputeTrip(event.tripId);
      } else if (event.stageId !== null) {
        const ownerFound = this.db
          .prepare("SELECT trip_id FROM trip_stages WHERE id = ?")
          .get(event.stageId);
        const owner = asRow<{ trip_id: number }>(ownerFound);
        if (owner) this.recomputeTrip(owner.trip_id);
      }

      return {
        id: Number(result.lastInsertRowid),
        timestamp: event.timestamp,
        pricePerLiter,
        currency,
      };
    });
  }

  listFuelPrices(): FuelPriceRecord[] {
    const found = this.db.prepare("SELECT * FROM fuel_prices ORDER BY timestamp").all();
    return asRows<FuelPriceRow>(found).map((row) => ({
      id: row.id,
      timestamp: row.timestamp,
      pricePerLiter: row.price_per_liter,
      currency: row.currency,
    }));
  }

  /* --------------------------- settings snapshot ------------------------- */

  savePreferences(json: string): void {
    this.db
      .prepare(
        `INSERT INTO settings_snapshot (id, prefs_json, updated_at) VALUES (1, ?, ?)
         ON CONFLICT(id) DO UPDATE SET prefs_json = excluded.prefs_json,
                                       updated_at = excluded.updated_at`,
      )
      .run(json, Date.now());
  }

  loadPreferences(): string | null {
    const found = this.db
      .prepare("SELECT prefs_json FROM settings_snapshot WHERE id = 1")
      .get();
    return asRow<{ prefs_json: string }>(found)?.prefs_json ?? null;
  }
}
