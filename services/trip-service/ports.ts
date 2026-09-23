/**
 * The service's entire hardware and process surface.
 *
 * This is the "deep module" seam. `TripEngine` is constructed with nothing but
 * these ports, so it cannot tell a simulated drive from a CAN bus, and swapping
 * a GPS device means writing one {@link LocationSource} and changing one binding
 * in `index.ts` — no trip, consumption, storage or map code is touched.
 *
 * Nothing here imports a device library. The shipped state of the world is:
 *
 *  - `SimulatedTelemetrySource` (dev only) — the assumed odometer plus speed,
 *    fuel level and ignition, generated deterministically.
 *  - **no** `LocationSource` — the GPS device is a future adapter. The
 *    trajectory pipeline it feeds is already complete and tested with these
 *    samples, which is the whole point of the seam.
 */

import type {
  LocationSample,
  TripPreferences,
  VehicleSample,
} from "./types.js";
import { DEFAULT_PREFERENCES } from "./types.js";

export type SampleListener<T> = (sample: T) => void;

/** A source of vehicle telemetry. `stop()` must be safe to call twice. */
export interface TelemetrySource {
  readonly name: string;
  start(): void;
  stop(): void;
  /** Registers a listener; returns the unsubscribe function. */
  onSample(listener: SampleListener<VehicleSample>): () => void;
}

/** A source of GPS fixes. See {@link TelemetrySource} for the lifecycle. */
export interface LocationSource {
  readonly name: string;
  start(): void;
  stop(): void;
  onSample(listener: SampleListener<LocationSample>): () => void;
}

/** Reads the shared user preferences owned by the Settings service. */
export interface SettingsPort {
  get(): TripPreferences;
  /**
   * Subscribes to preference changes; returns the unsubscribe function. The
   * initial value is delivered synchronously via {@link SettingsPort.get}, not
   * through the callback, so a subscriber never has to wait for the first tick.
   */
  subscribe(listener: (prefs: TripPreferences) => void): () => void;
  dispose(): void;
}

/* -------------------------------------------------------------------------- */
/* Test / fallback doubles                                                    */
/* -------------------------------------------------------------------------- */

/**
 * A source that emits only what a test or a caller pushes into it.
 *
 * Shipped rather than test-only because the dev simulation endpoint and the
 * service's own boot path both need a source that does nothing until told.
 */
export class ManualTelemetrySource implements TelemetrySource {
  readonly name = "manual";
  private readonly listeners = new Set<SampleListener<VehicleSample>>();
  private running = false;
  /** A caller-managed clock, so a test can keep its own timeline in step. */
  private clock = 0;

  start(): void {
    this.running = true;
  }

  stop(): void {
    this.running = false;
  }

  onSample(listener: SampleListener<VehicleSample>): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Injects a sample. Ignored while the source is stopped. */
  emit(sample: VehicleSample): void {
    if (!this.running) return;
    this.clock = Math.max(this.clock, sample.timestamp);
    for (const listener of this.listeners) listener(sample);
  }

  /** The most recent timestamp seen. */
  get now(): number {
    return this.clock;
  }

  /** Seeds the clock, for a caller that starts a drive at a chosen instant. */
  setClock(timestamp: number): void {
    this.clock = timestamp;
  }
}

/** Mirror of {@link ManualTelemetrySource} for GPS fixes. */
export class ManualLocationSource implements LocationSource {
  readonly name = "manual";
  private readonly listeners = new Set<SampleListener<LocationSample>>();
  private running = false;

  start(): void {
    this.running = true;
  }

  stop(): void {
    this.running = false;
  }

  onSample(listener: SampleListener<LocationSample>): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(sample: LocationSample): void {
    if (!this.running) return;
    for (const listener of this.listeners) listener(sample);
  }
}

/**
 * Fixed preferences. Used by tests and by the service when no Settings service
 * is configured, which keeps the engine runnable with zero external processes.
 */
export class StaticSettingsProvider implements SettingsPort {
  private readonly listeners = new Set<(prefs: TripPreferences) => void>();

  constructor(private prefs: TripPreferences = DEFAULT_PREFERENCES) {}

  get(): TripPreferences {
    return this.prefs;
  }

  /** Replaces the preferences and notifies subscribers. */
  set(prefs: TripPreferences): void {
    this.prefs = prefs;
    for (const listener of this.listeners) listener(prefs);
  }

  subscribe(listener: (prefs: TripPreferences) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  dispose(): void {
    this.listeners.clear();
  }
}
