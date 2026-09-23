import { useI18n } from "@/i18n";
import {
  formatDateTime,
  formatDistanceKm,
  formatDuration,
  formatLiters,
  formatMoney,
} from "@/lib/trip-view";
import { cn } from "@/lib/utils";
import type { TripListItem } from "@/types/trip";

export interface TripListItemCardProps {
  trip: TripListItem;
  selected: boolean;
  onSelect: (tripId: number) => void;
  /** Shown when this trip can be merged with the following one. */
  onMergeWithNext?: () => void;
  className?: string;
}

/**
 * One row of the history list.
 *
 * Mirrors the reference card: a small "Trip" caption, then the two headline
 * numbers separated by a square bullet. A road trip additionally shows its leg
 * count, and an unfinished drive is labelled rather than looking like history.
 */
export function TripListItemCard({
  trip,
  selected,
  onSelect,
  onMergeWithNext,
  className,
}: TripListItemCardProps) {
  const { t } = useI18n();

  return (
    <div
      data-testid={`trip-item-${trip.id}`}
      data-selected={selected ? "true" : "false"}
      className={cn(
        "rounded-[20px] border transition-colors",
        selected
          ? "border-warm-500/60 bg-warm-500/[0.07]"
          : "border-white/10 bg-white/[0.03] hover:border-white/20",
        className,
      )}
    >
      <button
        type="button"
        aria-pressed={selected}
        onClick={() => onSelect(trip.id)}
        className={cn(
          "flex w-full flex-col gap-1 px-5 py-3 text-left",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-warm-500/70 rounded-[20px]",
        )}
      >
        <span className="flex items-center gap-2 text-xs text-warm-100/50">
          <span>{formatDateTime(trip.startTime)}</span>
          {trip.isRoadTrip ? (
            <span className="rounded-full bg-warm-500/20 px-2 text-[10px] uppercase tracking-wide text-warm-500">
              {t("trip.history.roadTrip")}
            </span>
          ) : null}
          {trip.status === "active" ? (
            <span className="rounded-full bg-white/10 px-2 text-[10px] uppercase tracking-wide text-warm-100/60">
              {t("trip.history.active")}
            </span>
          ) : null}
        </span>

        <span className="flex items-baseline gap-3 text-2xl tabular-nums text-warm-500">
          <span>{formatDistanceKm(trip.totalDistanceKm)}</span>
          <span aria-hidden="true" className="text-[0.6em] text-warm-500/70">
            ■
          </span>
          <span>{formatLiters(trip.totalFuelLiters)}</span>
          {trip.fuelCost !== null ? (
            <>
              <span aria-hidden="true" className="text-[0.6em] text-warm-500/70">
                ■
              </span>
              <span>{formatMoney(trip.fuelCost)}</span>
            </>
          ) : null}
        </span>

        <span className="text-xs text-warm-100/40">
          {trip.legs > 1
            ? `${t("trip.history.legs", { count: trip.legs })} · `
            : ""}
          {formatDuration(trip.startTime, trip.endTime, t("trip.history.active"))}
          {trip.avgConsumptionLPer100km !== null
            ? ` · ${trip.avgConsumptionLPer100km.toFixed(2)} l/100km`
            : ""}
        </span>
      </button>

      {onMergeWithNext ? (
        <div className="border-t border-white/5 px-3 py-1.5">
          <button
            type="button"
            onClick={onMergeWithNext}
            className={cn(
              "rounded-full px-2 py-0.5 text-[11px] text-warm-100/50",
              "hover:text-warm-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-warm-500/70",
            )}
          >
            {t("trip.history.merge")}
          </button>
        </div>
      ) : null}
    </div>
  );
}
