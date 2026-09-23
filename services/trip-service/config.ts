import path from "node:path";
import os from "node:os";

/**
 * Process configuration, resolved once at boot.
 *
 * Every threshold the trip engine uses lives here rather than in the engine, so
 * the machine that owns the vehicle can be retuned through the environment
 * without a code change. Runtime *user* preferences (consumption unit, currency,
 * geofence, dwell, layover) come from the Settings service instead — these are
 * only the fallbacks used before, or without, a settings service.
 */
export interface TripConfig {
  port: number;
  /** SQLite file path, or `:memory:` for ephemeral (tests). */
  dbPath: string;
  /** Dev-only simulator: enabled by `TRIP_DEV_SIMULATE=1`. */
  simulate: boolean;
  devMode: boolean;
  /**
   * Price per litre the development seed uses to confirm the refuels it
   * generates. Real prices always arrive from the user through
   * `POST /api/fuel/events`; this exists only so a simulated history has a
   * populated cost column instead of a screen full of `--`.
   */
  defaultFuelPrice: number;
  currency: string;
  /** A speed at or below this is "not moving" — an idling car is not a stage. */
  movementEpsilonKmh: number;
  /** Odometer jump above this between samples is treated as a counter reset. */
  maxOdometerJumpKm: number;
  /** A fuel-level rise of at least this much is a refuel, not measurement noise. */
  refuelDeltaLiters: number;
  /** How often the open stage's live totals are flushed to SQLite. */
  flushIntervalMs: number;
}

function positiveNumber(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** A non-negative number from the environment, or `null` when unset/invalid. */
function optionalNumber(raw: string | undefined): number | null {
  if (raw == null || raw.trim() === "") return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function defaultDatabasePath(): string {
  return path.join(os.homedir(), ".config", "renault-mmi", "trips.db");
}

export function resolveConfig(env: NodeJS.ProcessEnv = process.env): TripConfig {
  const simulate = env.TRIP_DEV_SIMULATE === "1";
  return {
    port: Number(env.TRIP_PORT ?? 4500),
    dbPath: env.TRIP_DB_PATH?.trim() || defaultDatabasePath(),
    simulate,
    // Independent of `simulate` on purpose: the simulation endpoints should be
    // mounted whenever a developer asks for them, even if no drive is running
    // yet, and a test needs to drive ingestion without a wall-clock timer.
    devMode: simulate || env.TRIP_DEV === "1",
    defaultFuelPrice: optionalNumber(env.TRIP_DEFAULT_FUEL_PRICE) ?? 1.85,
    currency: env.TRIP_CURRENCY?.trim() || "EUR",
    movementEpsilonKmh: positiveNumber(env.TRIP_MOVEMENT_EPSILON_KMH, 2),
    maxOdometerJumpKm: positiveNumber(env.TRIP_MAX_ODOMETER_JUMP_KM, 500),
    refuelDeltaLiters: positiveNumber(env.TRIP_REFUEL_DELTA_L, 2),
    flushIntervalMs: positiveNumber(env.TRIP_FLUSH_INTERVAL_MS, 1000),
  };
}
