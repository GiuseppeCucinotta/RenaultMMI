/**
 * Development telemetry simulator.
 *
 * This module is the *placeholder for the vehicle*. The trip engine assumes an
 * odometer (that is the signal still to be located on the bus), so until it is
 * found this source produces the same shape of data a real adapter will: a
 * cumulative odometer, speed, a fuel level that drops while driving and jumps at
 * a refuel, and an ignition flag.
 *
 * Deliberate properties:
 *  - **Deterministic.** A seeded PRNG, no `Math.random`, no wall clock inside
 *    the generator: the same scenario produces the same samples, so tests and
 *    screenshots are reproducible.
 *  - **Time-driven, not timer-driven.** `advanceTo(timestamp)` is pure with
 *    respect to the simulation clock, so a test can replay a three-day road
 *    trip in microseconds while the live mode just steps the clock in real time.
 *  - **Separate location source.** Route playback is its own class behind its
 *    own port, so the map pipeline can be exercised with or without it and a
 *    real GPS adapter replaces exactly one of the two.
 *
 * It is wired in only when `TRIP_DEV_SIMULATE=1` (see `config.ts`), and the
 * service exposes its control endpoint only in that case.
 */

import type { LocationSource, SampleListener, TelemetrySource } from "../ports.js";
import type { LocationSample, VehicleSample } from "../types.js";

/* -------------------------------------------------------------------------- */
/* Scenarios                                                                  */
/* -------------------------------------------------------------------------- */

export type SimulationScenarioId = "urban" | "highway" | "road-trip";

export type PhaseBehaviour = "idle" | "driving" | "refuel" | "layover";

export interface ScenarioPhase {
  behaviour: PhaseBehaviour;
  /** How long this phase lasts, in simulated milliseconds. */
  durationMs: number;
  /** Target speed while driving, km/h. */
  speedKmh?: number;
  /** Litres added during a `refuel` phase. */
  refuelLiters?: number;
}

export interface Scenario {
  id: SimulationScenarioId;
  label: string;
  phases: ScenarioPhase[];
  /** Tank contents at the start, litres. */
  startFuelLiters: number;
  /** Tank capacity, litres — a refuel never tops past it. */
  tankCapacityLiters: number;
  /** Same shape at all speeds for clarity; a real vehicle would vary. */
  baseConsumptionLPer100km: number;
}

const MINUTE = 60_000;
const HOUR = 3_600_000;

/**
 * Short city commute: cold start, stop-go traffic, one halt longer than the
 * layover limit-free dwell window but inside it, then home.
 */
const URBAN: Scenario = {
  id: "urban",
  label: "Urban commute",
  startFuelLiters: 40,
  tankCapacityLiters: 45,
  baseConsumptionLPer100km: 7.4,
  phases: [
    { behaviour: "idle", durationMs: 40_000 },
    { behaviour: "driving", durationMs: 6 * MINUTE, speedKmh: 24 },
    { behaviour: "idle", durationMs: 3 * MINUTE },
    { behaviour: "driving", durationMs: 9 * MINUTE, speedKmh: 31 },
    { behaviour: "idle", durationMs: 90_000 },
  ],
};

/** Motorway run: sustained speed, a single pause, then a refuel. */
const HIGHWAY: Scenario = {
  id: "highway",
  label: "Highway run",
  startFuelLiters: 38,
  tankCapacityLiters: 45,
  baseConsumptionLPer100km: 5.1,
  phases: [
    { behaviour: "idle", durationMs: 30_000 },
    { behaviour: "driving", durationMs: 52 * MINUTE, speedKmh: 118 },
    { behaviour: "idle", durationMs: 7 * MINUTE },
    { behaviour: "driving", durationMs: 41 * MINUTE, speedKmh: 124 },
    { behaviour: "refuel", durationMs: 5 * MINUTE, refuelLiters: 26 },
  ],
};

/**
 * Multi-stage road trip: drive, a four-hour layover away from home, drive again,
 * a refuel, a short break, then the final leg. Exercises the stage/layover logic
 * end to end when the geofence is set to the route's start.
 */
const ROAD_TRIP: Scenario = {
  id: "road-trip",
  label: "Multi-stage road trip",
  startFuelLiters: 42,
  tankCapacityLiters: 50,
  baseConsumptionLPer100km: 6.2,
  phases: [
    { behaviour: "idle", durationMs: 45_000 },
    { behaviour: "driving", durationMs: 68 * MINUTE, speedKmh: 96 },
    { behaviour: "layover", durationMs: 4 * HOUR },
    { behaviour: "driving", durationMs: 51 * MINUTE, speedKmh: 104 },
    { behaviour: "refuel", durationMs: 6 * MINUTE, refuelLiters: 24 },
    { behaviour: "idle", durationMs: 12 * MINUTE },
    { behaviour: "driving", durationMs: 47 * MINUTE, speedKmh: 88 },
    { behaviour: "idle", durationMs: 60_000 },
  ],
};

export const SCENARIOS: Record<SimulationScenarioId, Scenario> = {
  urban: URBAN,
  highway: HIGHWAY,
  "road-trip": ROAD_TRIP,
};

export function isScenarioId(value: unknown): value is SimulationScenarioId {
  return typeof value === "string" && value in SCENARIOS;
}

/** Total simulated length of a scenario, in milliseconds. */
export function scenarioDurationMs(scenario: Scenario): number {
  return scenario.phases.reduce((total, phase) => total + phase.durationMs, 0);
}

/* -------------------------------------------------------------------------- */
/* Deterministic generator                                                    */
/* -------------------------------------------------------------------------- */

/** mulberry32 — small, fast, and fully determined by its seed. */
function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface SimulatorState {
  /** Position along the scenario's total duration. */
  elapsedMs: number;
  odometerKm: number;
  fuelLiters: number;
  speedKmh: number;
  ignition: boolean;
  lat: number;
  lon: number;
}

export interface SimulatorOptions {
  scenario: SimulationScenarioId;
  /**
   * Wall-clock instant the drive "starts". Defaults to now; a seed passes an
   * earlier instant so a seeded history lands where a user would expect it.
   */
  startedAt?: number;
  seed?: number;
  /** Where the route starts. Defaults to central Modena. */
  origin?: { lat: number; lon: number };
  /** Emit GPS fixes as well as vehicle samples. Default: true. */
  withLocation?: boolean;
}

/**
 * Generates a drive sample by sample.
 *
 * `advanceTo(timestamp)` is the whole engine-facing surface: the live timer and
 * a test both drive it the same way, and the generated values depend only on
 * the simulated clock, never on how fast the caller moved it.
 */
export class DriveSimulator {
  readonly name = "simulator";

  private readonly scenario: Scenario;
  private readonly random: () => number;
  /** Wall-clock instant that corresponds to simulated time zero. */
  private baseTimestamp: number;
  private readonly origin: { lat: number; lon: number };
  private readonly withLocation: boolean;
  private readonly vehicleListeners = new Set<SampleListener<VehicleSample>>();
  private readonly locationListeners = new Set<SampleListener<LocationSample>>();

  private state: SimulatorState;
  private running = false;
  private timer: NodeJS.Timeout | null = null;

  constructor(options: SimulatorOptions) {
    this.scenario = SCENARIOS[options.scenario];
    this.random = createRandom(options.seed ?? 0x5eed);
    this.baseTimestamp = options.startedAt ?? Date.now();
    this.origin = options.origin ?? { lat: 44.6471, lon: 10.9252 };
    this.withLocation = options.withLocation !== false;
    this.state = {
      elapsedMs: 0,
      odometerKm: 12_450,
      fuelLiters: this.scenario.startFuelLiters,
      speedKmh: 0,
      ignition: false,
      lat: this.origin.lat,
      lon: this.origin.lon,
    };
  }

  get scenarioId(): SimulationScenarioId {
    return this.scenario.id;
  }

  get scenarioLabel(): string {
    return this.scenario.label;
  }

  get totalDurationMs(): number {
    return scenarioDurationMs(this.scenario);
  }

  /** True once the scenario has played to its end. */
  get finished(): boolean {
    return this.state.elapsedMs >= this.totalDurationMs;
  }

  /* ------------------------------ lifecycle ------------------------------ */

  /**
   * Starts live playback. `at` becomes the drive's zero, so a restart after a
   * pause does not replay the scenario from a shifted clock.
   */
  start(at: number = Date.now()): void {
    if (this.running) return;
    // Keep the drive exactly where the clock left it: the elapsed simulated
    // time is what must be preserved, not the wall-clock offset.
    this.baseTimestamp = at - this.state.elapsedMs;
    this.running = true;
    this.timer = setInterval(() => this.tick(), 1000);
    this.timer.unref();
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  onSample(listener: SampleListener<VehicleSample>): () => void {
    this.vehicleListeners.add(listener);
    return () => this.vehicleListeners.delete(listener);
  }

  onLocationSample(listener: SampleListener<LocationSample>): () => void {
    this.locationListeners.add(listener);
    return () => this.locationListeners.delete(listener);
  }

  /** Restarts the scenario from its beginning. */
  reset(): void {
    this.state = {
      elapsedMs: 0,
      odometerKm: this.state.odometerKm,
      fuelLiters: this.scenario.startFuelLiters,
      speedKmh: 0,
      ignition: false,
      lat: this.origin.lat,
      lon: this.origin.lon,
    };
  }

  /* -------------------------------- clock -------------------------------- */

  private tick(): void {
    if (this.finished) {
      this.stop();
      return;
    }
    const steps = Math.max(
      1,
      Math.round((Date.now() - this.baseTimestamp - this.state.elapsedMs) / 1000),
    );
    this.advance(steps);
  }

  /**
   * Advances the drive by `steps` simulated seconds, emitting each sample.
   *
   * The step is a label, not a promise: a caller may pass 10 or 100_000, and the
   * odometer and tank integrate identically. That is what lets the live timer,
   * a test and a fast-forward seed all share one generator.
   */
  advance(steps = 1): VehicleSample[] {
    const emitted: VehicleSample[] = [];
    for (let i = 0; i < steps && !this.finished; i += 1) {
      this.state.elapsedMs = Math.min(this.state.elapsedMs + 1000, this.totalDurationMs);
      const sample = this.step();
      emitted.push(sample);
      this.emit(sample);
    }
    return emitted;
  }

  /** Advances to a wall-clock instant, so a caller can catch up after a pause. */
  advanceTo(timestamp: number): VehicleSample[] {
    if (!Number.isFinite(timestamp)) return [];
    const steps = Math.max(
      1,
      Math.round((timestamp - this.baseTimestamp - this.state.elapsedMs) / 1000),
    );
    return this.advance(steps);
  }

  /** Every remaining sample, ignoring the clock: used by the seed endpoint. */
  drain(): VehicleSample[] {
    const remaining = Math.ceil((this.totalDurationMs - this.state.elapsedMs) / 1000);
    return this.advance(remaining + 1);
  }

  /** Computes the state at the current elapsed time and emits one sample. */
  private step(): VehicleSample {
    const phase = this.phaseAt(this.state.elapsedMs);
    const behaviour = phase?.behaviour ?? "idle";
    const targetSpeed = behaviour === "driving" ? (phase?.speedKmh ?? 0) : 0;

    // A gentle deterministic wobble so the graph and speed stats are not flat.
    const wobble = targetSpeed > 0 ? (this.random() - 0.5) * 4 : 0;
    const nextSpeed = Math.max(0, targetSpeed + wobble);

    const hours = 1 / 3600;
    const distanceKm = (nextSpeed * hours) * 1; // 1 s of travel
    const liters = (this.scenario.baseConsumptionLPer100km / 100) * distanceKm;

    this.state.ignition = behaviour !== "layover";
    if (behaviour === "refuel" && phase?.refuelLiters) {
      // One-shot: the tank only takes the top-up once.
      const before = this.state.fuelLiters;
      this.state.fuelLiters = Math.min(
        this.scenario.tankCapacityLiters,
        this.state.fuelLiters + phase.refuelLiters,
      );
      if (this.state.fuelLiters > before) phase.refuelLiters = undefined;
    } else {
      this.state.fuelLiters = Math.max(0, this.state.fuelLiters - liters);
    }

    this.state.odometerKm += distanceKm;
    this.state.speedKmh = nextSpeed;

    // Straight-line breadcrumb: enough to exercise decimation, bounds and the
    // projection with real numbers, without pretending to be a road network.
    if (distanceKm > 0) {
      const bearing = Math.PI / 4; // north-east
      const dLat = (distanceKm / 111.32) * Math.cos(bearing);
      const dLon =
        (distanceKm / (111.32 * Math.cos((this.state.lat * Math.PI) / 180))) *
        Math.sin(bearing);
      this.state.lat += dLat;
      this.state.lon += dLon;
    }

    return {
      timestamp: this.baseTimestamp + this.state.elapsedMs,
      odometerKm: this.state.odometerKm,
      speedKmh: this.state.speedKmh,
      fuelLevelLiters: this.state.fuelLiters,
      // No flow signal: this is exactly the "level only" vehicle the tank model
      // exists for. A real bus with a flow sensor sets this and takes the other
      // branch in the engine.
      fuelFlowLph: null,
      ignition: this.state.ignition,
      engineRpm: this.state.ignition ? 800 + this.state.speedKmh * 22 : 0,
    };
  }

  private phaseAt(elapsedMs: number): ScenarioPhase | null {
    let cursor = 0;
    for (const phase of this.scenario.phases) {
      cursor += phase.durationMs;
      // Strictly before the boundary: at exactly `cursor` the *next* phase has
      // begun, which is what makes a phase sequence deterministic at its seams.
      if (elapsedMs < cursor) return phase;
    }
    return null;
  }

  private emit(sample: VehicleSample): void {
    for (const listener of this.vehicleListeners) listener(sample);
    if (!this.withLocation) return;

    const location: LocationSample = {
      timestamp: sample.timestamp,
      lat: this.state.lat,
      lon: this.state.lon,
      speedKmh: sample.speedKmh,
      headingDeg: (sample.speedKmh ?? 0) > 0 ? 45 : null,
      // No fix while the ignition is off, which is how a real receiver behaves
      // in a garage — and it exercises the engine's missing-location path.
      fixQuality: sample.ignition ? 1 : 0,
    };
    for (const listener of this.locationListeners) listener(location);
  }
}

/* -------------------------------------------------------------------------- */
/* Port adapters                                                              */
/* -------------------------------------------------------------------------- */

/**
 * The simulator as a vehicle telemetry source.
 *
 * Wrapped rather than implemented side by side on `DriveSimulator`, because a
 * single object cannot carry two incompatible `onSample` overloads for two
 * different sample shapes. These two thin adapters are what keeps
 * `DriveSimulator` a plain generator, and what makes "swap the GPS adapter"
 * a one-class change at the call site.
 */
export class SimulatedTelemetrySource implements TelemetrySource {
  readonly name = "simulator";

  constructor(private readonly simulator: DriveSimulator) {}

  start(): void {
    this.simulator.start();
  }

  stop(): void {
    this.simulator.stop();
  }

  onSample(listener: SampleListener<VehicleSample>): () => void {
    return this.simulator.onSample(listener);
  }
}

/** The simulator's GPS side, behind {@link LocationSource}. */
export class SimulatedLocationSource implements LocationSource {
  readonly name = "simulator";

  constructor(private readonly simulator: DriveSimulator) {}

  start(): void {
    this.simulator.start();
  }

  stop(): void {
    this.simulator.stop();
  }

  onSample(listener: SampleListener<LocationSample>): () => void {
    return this.simulator.onLocationSample(listener);
  }
}

/** Both faces of one simulated drive, sharing a single clock. */
export interface SimulatedSources {
  simulator: DriveSimulator;
  telemetry: SimulatedTelemetrySource;
  location: SimulatedLocationSource;
}

export function createSimulatedSources(simulator: DriveSimulator): SimulatedSources {
  return {
    simulator,
    telemetry: new SimulatedTelemetrySource(simulator),
    location: new SimulatedLocationSource(simulator),
  };
}
