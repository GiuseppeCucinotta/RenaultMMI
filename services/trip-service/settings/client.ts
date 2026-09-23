/**
 * Reads the shared user preferences from the Settings service.
 *
 * The trip service never imports settings code: it speaks HTTP to it, exactly
 * like the renderer does. That keeps the two services independently deployable
 * and lets the engine run with a `StaticSettingsProvider` when no settings
 * service exists (tests, or a bare-metal start before the settings bundle is up).
 *
 * Polling, not SSE: `EventSource` is not a global in Node *or* in the Node
 * runtime electron exposes for spawned children, so a stream would need a
 * dependency. A 15 s poll of one small JSON document costs nothing and keeps
 * this module dependency-free.
 *
 * Two robustness rules, both earned by an appliance that boots in any order:
 *  - The last successfully parsed preferences are cached in the trip store, so a
 *    boot with the settings service still starting computes with yesterday's
 *    values instead of silently reverting to defaults.
 *  - Any failure keeps the current value. Preferences are not worth crashing
 *    for; the next poll tries again.
 */

import { errorMessage, type Logger } from "../../shared/logger.js";
import type { SettingsPort } from "../ports.js";
import { StaticSettingsProvider } from "../ports.js";
import type { ConsumptionUnit, TripPreferences } from "../types.js";
import { DEFAULT_PREFERENCES } from "../types.js";

/**
 * Where the settings values live inside `/api/values`.
 *
 * This mirrors `settings-service/categories/trip.ts`. It is the one place the
 * trip service names a settings field, and those names are a wire contract —
 * the same one the renderer reads — not an import of another module.
 */
export const TRIP_CATEGORY = "trip";

/** Field ids inside the `trip` settings category, named once. */
export const TRIP_SETTINGS_FIELDS = {
  consumptionUnit: "consumptionUnit",
  currency: "currency",
  homeGeofenceLat: "homeGeofenceLat",
  homeGeofenceLon: "homeGeofenceLon",
  homeGeofenceRadiusM: "homeGeofenceRadiusM",
  stageDwellMinutes: "stageDwellMinutes",
  layoverHours: "layoverHours",
} as const;

export const DEFAULT_SETTINGS_POLL_MS = 15_000;

type RawValues = Record<string, unknown>;

function asNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Maps settings wire values onto the engine's typed preferences.
 *
 * Tolerant by design: an unknown `consumptionUnit`, a missing geofence or a
 * nonsense dwell all fall back field-by-field. A settings schema that grows a
 * field cannot break the trip engine, and one that drops a field cannot either.
 */
export function preferencesFromValues(
  values: RawValues,
  base: TripPreferences = DEFAULT_PREFERENCES,
): TripPreferences {
  const unit = asString(values[TRIP_SETTINGS_FIELDS.consumptionUnit]);
  const radius = asNumber(values[TRIP_SETTINGS_FIELDS.homeGeofenceRadiusM]);
  const dwell = asNumber(values[TRIP_SETTINGS_FIELDS.stageDwellMinutes]);
  const layover = asNumber(values[TRIP_SETTINGS_FIELDS.layoverHours]);
  const lat = asNumber(values[TRIP_SETTINGS_FIELDS.homeGeofenceLat]);
  const lon = asNumber(values[TRIP_SETTINGS_FIELDS.homeGeofenceLon]);

  return {
    consumptionUnit:
      unit === "km_per_l" || unit === "l_per_100km"
        ? (unit as ConsumptionUnit)
        : base.consumptionUnit,
    currency: asString(values[TRIP_SETTINGS_FIELDS.currency]) ?? base.currency,
    // A zero coordinate is a real place (the Gulf of Guinea); only a *missing*
    // or non-numeric one falls back, otherwise "unset" and "0,0" are
    // indistinguishable.
    homeGeofenceLat: lat ?? base.homeGeofenceLat,
    homeGeofenceLon: lon ?? base.homeGeofenceLon,
    homeGeofenceRadiusM: radius !== null && radius >= 0 ? radius : base.homeGeofenceRadiusM,
    stageDwellMinutes: dwell !== null && dwell > 0 ? dwell : base.stageDwellMinutes,
    layoverHours: layover !== null && layover > 0 ? layover : base.layoverHours,
  };
}

export interface HttpSettingsOptions {
  baseUrl: string;
  logger?: Logger;
  pollIntervalMs?: number;
  /** Called after each successful load, so the store can keep a snapshot. */
  onLoaded?: (prefs: TripPreferences) => void;
  /** Cache loaded before the first HTTP attempt. */
  initial?: TripPreferences;
}

export class HttpSettingsProvider implements SettingsPort {
  private readonly static: StaticSettingsProvider;
  private readonly baseUrl: string;
  private readonly logger: Logger | undefined;
  private readonly pollIntervalMs: number;
  private readonly onLoaded: ((prefs: TripPreferences) => void) | undefined;
  private timer: NodeJS.Timeout | null = null;

  constructor(options: HttpSettingsOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.logger = options.logger;
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_SETTINGS_POLL_MS;
    this.onLoaded = options.onLoaded;
    this.static = new StaticSettingsProvider(options.initial ?? DEFAULT_PREFERENCES);
  }

  get(): TripPreferences {
    return this.static.get();
  }

  subscribe(listener: (prefs: TripPreferences) => void): () => void {
    return this.static.subscribe(listener);
  }

  dispose(): void {
    this.stop();
    this.static.dispose();
  }

  /** Starts polling. The first load happens immediately. */
  start(): void {
    if (this.timer) return;
    void this.load();
    this.timer = setInterval(() => void this.load(), this.pollIntervalMs);
    this.timer.unref(); // never keep the process alive just for a poll
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** One refresh. Never throws: a settings outage keeps the previous values. */
  async load(): Promise<TripPreferences> {
    try {
      const response = await fetch(`${this.baseUrl}/api/values/${TRIP_CATEGORY}`);
      if (!response.ok) throw new Error(`status ${response.status}`);
      const body = (await response.json()) as { values?: RawValues };
      const prefs = preferencesFromValues(body.values ?? {}, this.static.get());
      this.apply(prefs);
      return prefs;
    } catch (error) {
      this.logger?.warn(
        `settings unavailable (${errorMessage(error)}): keeping current preferences`,
      );
      return this.static.get();
    }
  }

  /** Pushes values in without HTTP, for tests and for the cached snapshot. */
  apply(prefs: TripPreferences): void {
    this.static.set(prefs);
    this.onLoaded?.(prefs);
  }
}

/** Fallback used when no settings base URL is configured. */
export function staticPreferences(prefs?: TripPreferences): SettingsPort {
  return new StaticSettingsProvider(prefs ?? DEFAULT_PREFERENCES);
}
