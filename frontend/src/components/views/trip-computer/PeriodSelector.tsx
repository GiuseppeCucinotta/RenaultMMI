import { cn } from "@/lib/utils";
import type { TripPeriodDescriptor } from "@/types/trip";

export interface PeriodSelectorProps {
  periods: TripPeriodDescriptor[];
  activePreset: string;
  /** The window the service resolved, shown beside the title as the reference does. */
  rangeLabel: string;
  onSelect: (preset: string) => void;
  className?: string;
}

/**
 * The period pill from the design reference: the resolved date range, with the
 * preset list behind it.
 *
 * The range text is rendered from the service's own `from`/`to`, never computed
 * here — a renderer that derives dates is a renderer that can disagree with the
 * window the numbers came from.
 */
export function PeriodSelector({
  periods,
  activePreset,
  rangeLabel,
  onSelect,
  className,
}: PeriodSelectorProps) {
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <span
        data-testid="trip-period-range"
        className="rounded-full border border-warm-500/40 px-4 py-1.5 text-sm tabular-nums text-warm-500"
      >
        {rangeLabel}
      </span>

      <div role="group" aria-label="Period" className="flex items-center gap-1">
        {periods.map((period) => {
          const active = period.preset === activePreset;
          return (
            <button
              key={period.preset}
              type="button"
              aria-pressed={active}
              onClick={() => onSelect(period.preset)}
              className={cn(
                "rounded-full px-3 py-1 text-xs tracking-wide transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-warm-500/70",
                active
                  ? "bg-warm-500/20 text-warm-500"
                  : "text-warm-100/50 hover:text-warm-100",
              )}
            >
              {period.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
