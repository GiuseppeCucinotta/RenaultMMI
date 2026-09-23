/**
 * Costing — attributing litres to the price that was in force when they burned.
 *
 * A single "total spend" number is easy and wrong. Fuel is bought at a price,
 * then burned over the following days, so the honest attribution is: the litres
 * burned before refuel *N* cost whatever price the *previous* refuel charged.
 * That is what a user means by "what did this trip cost", and it is also why the
 * result is computed at read time from the fuel-event history rather than stored
 * on a stage — correcting a mistyped price then re-costs history correctly
 * instead of leaving stale totals behind.
 *
 * Pure: it takes stages, refuels and prices and returns numbers.
 */

/** One stage as costing needs to see it. */
export interface CostStageInput {
  startTime: number;
  endTime: number | null;
  fuelLiters: number;
}

/** One confirmed refuel, already resolved to the price it was bought at. */
export interface CostRefuelInput {
  timestamp: number;
  pricePerLiter: number | null;
}

/**
 * Assigns a price to each stage's litres, and returns one entry per stage.
 *
 * The price in force is the most recent refuel at or before the stage's end.
 * Fuel burned before any refuel was recorded has no known price and yields
 * `null`, which the API turns into `--`; it is never `0`, because "free" and
 * "unknown" are very different claims to make about someone's money.
 */
export function attributeCosts(
  stages: readonly CostStageInput[],
  refuels: readonly CostRefuelInput[],
  fallbackPricePerLiter: number | null = null,
): (number | null)[] {
  const orderedRefuels = [...refuels].sort((a, b) => a.timestamp - b.timestamp);

  return stages.map((stage) => {
    if (stage.fuelLiters <= 0) return 0;

    const at = stage.endTime ?? stage.startTime;
    let price: number | null = fallbackPricePerLiter;
    for (const refuel of orderedRefuels) {
      if (refuel.timestamp > at) break;
      if (refuel.pricePerLiter !== null) price = refuel.pricePerLiter;
    }

    return price === null ? null : stage.fuelLiters * price;
  });
}
