/**
 * Consumption and cost arithmetic — pure functions of their arguments.
 *
 * The rule that shapes this module: *a litre is only counted once, and it is
 * never invented*. Distance comes from the odometer (the assumed signal);
 * litres come from either an explicit flow reading or the tank level, and a rise
 * in the tank is a refuel, not negative consumption. When a source cannot
 * measure fuel at all, the answer is `null` — never `0`, which would silently
 * claim the car burned nothing.
 */

import type { Consumption } from "../types.js";

/** Litres per 100 km to km per litre (and back) is a reciprocal. */
export function toKmPerL(lPer100km: number | null): number | null {
  if (lPer100km === null || lPer100km <= 0) return null;
  return 100 / lPer100km;
}

export function toLPer100km(kmPerL: number | null): number | null {
  if (kmPerL === null || kmPerL <= 0) return null;
  return 100 / kmPerL;
}

/**
 * Average consumption from a distance and a volume.
 *
 * A zero distance has no meaningful average, and neither does a zero volume
 * (that is "no data", not "infinitely efficient"), so both yield `null`.
 */
export function consumptionFrom(liters: number, distanceKm: number): Consumption {
  if (!Number.isFinite(liters) || !Number.isFinite(distanceKm) || distanceKm <= 0) {
    return { lPer100km: null, kmPerL: null };
  }
  const lPer100km = (liters / distanceKm) * 100;
  return { lPer100km, kmPerL: toKmPerL(lPer100km) };
}

/** One tank-level observation, used to walk a level series. */
export interface TankReading {
  timestamp: number;
  levelLiters: number;
}

export interface TankDelta {
  /** Litres burned between the two readings; never negative. */
  litersBurned: number;
  /** True when the level rose, i.e. fuel was added rather than burned. */
  isRise: boolean;
  /** Signed change, so the caller can compare it against its refuel threshold. */
  deltaLiters: number;
}

/**
 * Classifies a tank-level change.
 *
 * Any rise at all is "not consumption": it is either a refuel or the tank
 * settling, and counting it as negative burn would corrupt every average that
 * follows. Whether a rise is *large enough to be a refuel* is the caller's
 * decision — it owns the threshold, and this function stays a pure classifier.
 */
export function classifyTankDelta(
  previousLiters: number,
  nextLiters: number,
): TankDelta {
  const delta = nextLiters - previousLiters;
  return {
    litersBurned: delta > 0 ? 0 : Math.max(0, -delta),
    isRise: delta > 0,
    deltaLiters: delta,
  };
}

/** Integral of a flow series (litres/hour) over time, in litres. */
export function litersFromFlow(
  samples: readonly { timestamp: number; flowLph: number }[],
): number {
  let liters = 0;
  for (let i = 1; i < samples.length; i += 1) {
    const previous = samples[i - 1];
    const current = samples[i];
    const hours = (current.timestamp - previous.timestamp) / 3_600_000;
    if (hours <= 0) continue;
    liters += ((previous.flowLph + current.flowLph) / 2) * hours;
  }
  return liters;
}

/**
 * Distance from two cumulative odometer readings.
 *
 * `null` means "cannot tell" (either reading missing). A non-positive step is
 * `0`: an odometer can roll over, be replaced, or be reflashed, and a negative
 * distance would poison every total that sums it. A step larger than
 * `maxJumpKm` is likewise treated as a reset rather than a real 900 km hop
 * between two samples.
 */
export function odometerStep(
  previousKm: number | null,
  nextKm: number | null,
  maxJumpKm: number,
): number | null {
  if (previousKm === null || nextKm === null) return null;
  const step = nextKm - previousKm;
  if (step <= 0 || step > maxJumpKm) return 0;
  return step;
}

/** Rounds for display without turning a real value into a different one. */
export function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/**
 * Formats a metric for a card. `--` is the only representation of "no data",
 * and it is produced here so every consumer shows the same thing.
 */
export function formatMetric(
  value: number | null,
  unit: string,
  digits = 2,
): string {
  if (value === null || !Number.isFinite(value)) return "--";
  const rounded = round(value, digits);
  switch (unit) {
    case "km":
      return `${round(rounded, 1)} km`;
    case "l":
      return `${round(rounded, 2)} l`;
    case "l_per_100km":
      return `${round(rounded, 2)} l/100km`;
    case "km_per_l":
      return `${round(rounded, 2)} km/l`;
    default:
      return `${rounded}`;
  }
}
