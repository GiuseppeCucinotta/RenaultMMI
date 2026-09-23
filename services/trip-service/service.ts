/**
 * The trip service.
 *
 * HTTP, SSE, routing, graceful shutdown and the running ⇄ suspended state
 * machine all come from {@link BaseMediaService}. This class only assembles the
 * pieces and owns the two lifecycle questions that are genuinely its own:
 *
 *  - **What to release on suspend.** The trip engine is pure computation over
 *    samples, so it holds no hardware; what must stop is *ingestion*. Suspending
 *    detaches the sources and keeps the SQLite handle and the open trip, so a
 *    resume continues the same stage instead of starting a new one.
 *  - **What to report in `/api/health`.** Ingest liveness, sample counters and
 *    whether a development simulator is driving.
 *
 * Everything is injectable so the suite runs with no database file, no sources
 * and no clock of its own.
 */

import {
  BaseMediaService,
  type RouteTable,
  type ServiceSettings,
} from "../shared/service-http.js";
import type { Logger } from "../shared/logger.js";
import { createLogger } from "../shared/logger.js";
import type { TripConfig } from "./config.js";
import type { SettingsPort } from "./ports.js";
import { staticPreferences } from "./settings/client.js";
import { HttpSettingsProvider } from "./settings/client.js";
import { TripQueryService } from "./query.js";
import { createTripRoutes } from "./routes.js";
import { TripStore } from "./store/store.js";
import { TripEngine, shutdownEngine } from "./trip/engine.js";
import { createSimulatedSources, DriveSimulator } from "./telemetry/simulator.js";
import type { TelemetrySource, LocationSource } from "./ports.js";
import type { TripIngestStatus, TripState } from "./types.js";
import { DEFAULT_PREFERENCES } from "./types.js";

export interface TripServiceOptions {
  logger?: Logger;
  /** Tests inject a store pointed at `:memory:`. */
  store?: TripStore;
  /** Tests inject fixed preferences instead of an HTTP settings client. */
  preferences?: SettingsPort;
  telemetry?: TelemetrySource | null;
  location?: LocationSource | null;
  /**
   * Replaces the built-in drive generator. Tests point this at a manual source
   * so ingestion can be driven deterministically instead of on a timer.
   */
  simulatorFactory?: () => DriveSimulator | null;
  settings?: Partial<ServiceSettings>;
  installProcessHandlers?: boolean;
  settingsBaseUrl?: string;
  /** Overrides the config's simulation flag, for tests. */
  simulate?: boolean;
}

/** The child process must not outlive its own ingestion on shutdown. */
export class TripService extends BaseMediaService<TripState> {
  private readonly store: TripStore;
  private readonly query: TripQueryService;
  private readonly engine: TripEngine;
  private readonly preferences: SettingsPort;
  private readonly settingsClient: HttpSettingsProvider | null;
  private readonly config: TripConfig;
  /** Named to avoid shadowing the base class's own `options`. */
  private readonly serviceOptions: TripServiceOptions;
  private telemetry: TelemetrySource | null;
  private location: LocationSource | null;
  private simulator: DriveSimulator | null = null;
  private readonly ownsStore: boolean;
  private ingestStatus: TripIngestStatus;

  constructor(config: TripConfig, options: TripServiceOptions = {}) {
    const logger = options.logger ?? createLogger("trip");
    super({
      name: "trip",
      port: config.port,
      logger,
      ...(options.settings ? { settings: options.settings } : {}),
      installProcessHandlers: options.installProcessHandlers,
    });

    this.config = config;
    this.serviceOptions = options;
    this.store = options.store ?? new TripStore(config.dbPath);
    this.ownsStore = options.store === undefined;
    this.query = new TripQueryService(this.store);

    if (options.preferences) {
      this.preferences = options.preferences;
      this.settingsClient = null;
    } else if (options.settingsBaseUrl) {
      // A snapshot from the last run, so a boot that races the settings service
      // still computes with the user's unit and geofence.
      const cached = this.loadCachedPreferences();
      const client = new HttpSettingsProvider({
        baseUrl: options.settingsBaseUrl,
        logger,
        initial: cached ?? DEFAULT_PREFERENCES,
        onLoaded: (prefs) => this.store.savePreferences(JSON.stringify(prefs)),
      });
      this.settingsClient = client;
      this.preferences = client;
    } else {
      this.preferences = staticPreferences();
      this.settingsClient = null;
    }

    this.engine = new TripEngine({
      writer: this.store,
      preferences: this.preferences,
      logger,
      currency: config.currency,
      movementEpsilonKmh: config.movementEpsilonKmh,
      maxOdometerJumpKm: config.maxOdometerJumpKm,
      refuelDeltaLiters: config.refuelDeltaLiters,
      flushIntervalMs: config.flushIntervalMs,
      onChange: () => this.broadcast(),
    });

    this.telemetry = options.telemetry ?? null;
    this.location = options.location ?? null;

    const simulate = options.simulate ?? config.simulate;
    this.ingestStatus = {
      lastSampleAt: null,
      simulation: simulate,
      locationAttached: false,
      vehicleSamples: 0,
      locationSamples: 0,
      activeTripId: null,
      activeStageId: null,
      pendingRefuels: 0,
    };

    if (simulate) this.attachSimulator();
  }

  /* ------------------------------ lifecycle ------------------------------ */

  protected onStart(): void {
    // Power-loss recovery first: closing what a dead battery left open must
    // happen before new samples start appending to it.
    this.engine.recover();

    this.settingsClient?.start();

    this.telemetry?.onSample((sample) => this.engine.ingestSample(sample));
    this.location?.onSample((sample) => this.engine.ingestLocation(sample));
    this.telemetry?.start();
    this.location?.start();
    this.ingestStatus = {
      ...this.ingestStatus,
      locationAttached: this.location !== null,
    };
    this.logger.log(
      `database: ${this.config.dbPath}${this.config.simulate ? " (dev simulator attached)" : ""}`,
    );
  }

  protected onStop(): void {
    this.settingsClient?.stop();
    shutdownEngine(
      this.engine,
      {
        ...(this.telemetry ? { telemetry: this.telemetry } : {}),
        ...(this.location ? { location: this.location } : {}),
      },
      this.logger,
    );
    this.simulator?.stop();
    this.simulator = null;
    this.engine.dispose();
    this.preferences.dispose();
    if (this.ownsStore) this.store.close();
  }

  /**
   * Suspending stops ingestion and nothing else: the open trip stays open and
   * the database handle stays valid, so resuming continues the same stage. A
   * trip engine has no hardware to release, which is why this is so small.
   */
  protected onSuspend(): void {
    this.telemetry?.stop();
    this.location?.stop();
    this.simulator?.stop();
  }

  protected onResume(): void {
    this.telemetry?.start();
    this.location?.start();
    this.simulator?.start();
  }

  /**
   * Ingestion *is* the work, so a running simulator keeps the service awake even
   * with no client attached — otherwise a drive would stop being recorded
   * because nobody was looking at the screen.
   */
  protected isBusy(): boolean {
    return this.simulator !== null;
  }

  protected healthDetails(): Record<string, unknown> {
    // Always derived from live fields: a health endpoint reporting a stale
    // boot-time snapshot is worse than reporting nothing.
    const status = this.engine.status();
    return {
      database: this.config.dbPath,
      simulation: this.simulator !== null,
      locationAttached: this.location !== null,
      vehicleSamples: status.vehicleSamples,
      locationSamples: status.locationSamples,
      lastSampleAt: status.lastSampleAt,
      tripCount: this.store.tripCount(),
      pendingRefuels: this.store.countPendingRefuels(),
    };
  }

  protected getState(): TripState {
    const ingest = this.engine.status();
    this.ingestStatus = {
      ...this.ingestStatus,
      ...ingest,
      locationAttached: this.location !== null,
      simulation: this.simulator !== null,
      pendingRefuels: this.store.countPendingRefuels(),
    };
    return {
      status: this.ingestStatus,
      preferences: this.engine.preferencesSnapshot,
      tripCount: this.store.tripCount(),
    };
  }

  protected createRoutes(): RouteTable {
    return createTripRoutes({
      store: this.store,
      query: this.query,
      engine: this.engine,
      simulator: () => this.simulator,
      setSimulator: (simulator) => {
        this.simulator = simulator;
      },
      devMode: this.config.devMode,
      preferences: () => this.engine.preferencesSnapshot,
      defaultFuelPrice: this.config.defaultFuelPrice,
      currency: this.config.currency,
      broadcast: () => this.broadcast(),
      logger: this.logger,
    });
  }

  /* ------------------------------- internals ----------------------------- */

  /** Preferences cached from the previous run, or `null` on a first boot. */
  private loadCachedPreferences() {
    const raw = this.store.loadPreferences();
    if (!raw) return null;
    try {
      return JSON.parse(raw) as ReturnType<SettingsPort["get"]>;
    } catch {
      return null;
    }
  }

  /** Attaches the development drive; the only path that fabricates telemetry. */
  private attachSimulator(): void {
    const simulator =
      this.serviceOptions.simulatorFactory?.() ??
      new DriveSimulator({ scenario: "urban", withLocation: true });
    if (!simulator) {
      this.logger.log("no development simulator configured");
      return;
    }
    simulator.onSample((sample) => this.engine.ingestSample(sample));
    simulator.onLocationSample((sample) => this.engine.ingestLocation(sample));
    const sources = createSimulatedSources(simulator);
    simulator.start();
    this.simulator = simulator;
    this.telemetry = sources.telemetry;
    this.location = sources.location;
    this.logger.warn(
      `development simulator running "${simulator.scenarioLabel}" — no real telemetry is being read`,
    );
  }
}
