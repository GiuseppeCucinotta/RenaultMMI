/**
 * Schema and migrations.
 *
 * `node:sqlite` rather than `better-sqlite3`: it is a Node builtin, verified
 * present in both the system Node and the Node bundled in Electron (which is
 * what actually runs a spawned service), so the service keeps its "no native
 * dependency, nothing to rebuild per target" property.
 *
 * Migrations are `user_version`-gated and append-only. Adding a feature means
 * adding a step with the next version number — never editing an earlier one,
 * because a deployed appliance has already run it.
 */

import type { DatabaseSync } from "node:sqlite";

interface Migration {
  version: number;
  label: string;
  sql: string;
}

const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    label: "trips, stages, coordinates, fuel and settings snapshot",
    sql: `
      CREATE TABLE trips (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT,
        start_time INTEGER NOT NULL,
        end_time INTEGER,
        total_distance_km REAL NOT NULL DEFAULT 0,
        total_fuel_liters REAL NOT NULL DEFAULT 0,
        fuel_cost REAL,
        is_road_trip INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'active',
        start_odometer_km REAL,
        end_odometer_km REAL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE trip_stages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        trip_id INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
        stage_number INTEGER NOT NULL,
        start_time INTEGER NOT NULL,
        end_time INTEGER,
        start_lat REAL,
        start_lon REAL,
        end_lat REAL,
        end_lon REAL,
        distance_km REAL NOT NULL DEFAULT 0,
        fuel_liters REAL NOT NULL DEFAULT 0,
        avg_consumption_l_per_100km REAL,
        idle_seconds REAL NOT NULL DEFAULT 0,
        moving_seconds REAL NOT NULL DEFAULT 0,
        max_speed_kmh REAL,
        avg_speed_kmh REAL,
        start_odometer_km REAL,
        end_odometer_km REAL,
        status TEXT NOT NULL DEFAULT 'active'
      );

      CREATE TABLE trip_coordinates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        stage_id INTEGER NOT NULL REFERENCES trip_stages(id) ON DELETE CASCADE,
        timestamp INTEGER NOT NULL,
        lat REAL NOT NULL,
        lon REAL NOT NULL,
        speed_kmh REAL,
        instant_consumption_l_per_100km REAL
      );

      CREATE TABLE fuel_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        trip_id INTEGER REFERENCES trips(id) ON DELETE SET NULL,
        stage_id INTEGER REFERENCES trip_stages(id) ON DELETE SET NULL,
        timestamp INTEGER NOT NULL,
        liters_added REAL NOT NULL,
        level_before_l REAL,
        level_after_l REAL,
        source TEXT NOT NULL DEFAULT 'detected',
        confirmed INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE fuel_prices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        price_per_liter REAL NOT NULL,
        currency TEXT NOT NULL
      );

      CREATE TABLE settings_snapshot (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        prefs_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX idx_trips_start_time ON trips(start_time DESC);
      CREATE INDEX idx_trips_status ON trips(status);
      CREATE INDEX idx_stages_trip ON trip_stages(trip_id, stage_number);
      CREATE INDEX idx_stages_start ON trip_stages(start_time);
      CREATE INDEX idx_coords_stage ON trip_coordinates(stage_id, timestamp);
      CREATE INDEX idx_fuel_events_time ON fuel_events(timestamp);
      CREATE INDEX idx_fuel_events_confirmed ON fuel_events(confirmed);
      CREATE INDEX idx_fuel_prices_time ON fuel_prices(timestamp);
    `,
  },
];

/**
 * Applies every pending migration and returns the resulting schema version.
 * Idempotent: a database already at the latest version is untouched.
 */
export function migrate(db: DatabaseSync): number {
  const row = db.prepare("PRAGMA user_version").get() as
    | { user_version?: number | bigint }
    | undefined;
  const current = Number(row?.user_version ?? 0);

  for (const migration of MIGRATIONS) {
    if (migration.version <= current) continue;
    db.exec("BEGIN");
    try {
      db.exec(migration.sql);
      // `PRAGMA user_version = ?` cannot be parameterised, and the value is a
      // compile-time integer from the list above, never user input.
      db.exec(`PRAGMA user_version = ${migration.version}`);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  const after = db.prepare("PRAGMA user_version").get() as
    | { user_version?: number | bigint }
    | undefined;
  return Number(after?.user_version ?? 0);
}

/** The newest schema version this build knows about. */
export const SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;
