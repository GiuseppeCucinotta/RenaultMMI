import { cn } from "@/lib/utils";
import type { TrendDirection } from "@/types/trip";

export interface TrendArrowProps {
  direction: TrendDirection;
  className?: string;
}

/**
 * The card's trend indicator: the filled triangle from the design reference.
 *
 * Drawn inline rather than loaded from an asset so it inherits the amber token
 * and scales with the card. `neutral` renders nothing at all — an arrow is a
 * claim about a change, and there is none to make.
 */
export function TrendArrow({ direction, className }: TrendArrowProps) {
  if (direction === "neutral") return null;

  const points = direction === "up" ? "12,4 22,20 2,20" : "12,20 22,4 2,4";

  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      data-trend-direction={direction}
      className={cn("h-6 w-6 shrink-0", className)}
    >
      <polygon points={points} className="fill-warm-500" />
    </svg>
  );
}
