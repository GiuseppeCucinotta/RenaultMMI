import { useI18n } from "@/i18n";
import { formatClock, formatMoney, formatSeconds } from "@/lib/trip-view";
import { cn } from "@/lib/utils";
import type { TripDetail, TripStage } from "@/types/trip";

export interface TripDetailPanelProps {
  detail: TripDetail;
  onSplitAt: (stageId: number) => void;
  className?: string;
}

/**
 * The detail panel under the map: the stats bar the spec asks for, plus one row
 * per stage with a "split here" action.
 *
 * All figures come from the service's `stats`, which is computed over the same
 * stage rows the trip totals are summed from — so the bar can never contradict
 * the list row above it.
 */
export function TripDetailPanel({ detail, onSplitAt, className }: TripDetailPanelProps) {
  const { t } = useI18n();
  const { stats } = detail;

  const entries: { label: string; value: string }[] = [
    { label: t("trip.history.stats.start"), value: formatClock(detail.startTime) },
    { label: t("trip.history.stats.end"), value: detail.endTime ? formatClock(detail.endTime) : "--" },
    { label: t("trip.history.stats.idle"), value: formatSeconds(stats.idleSeconds) },
    { label: t("trip.history.stats.moving"), value: formatSeconds(stats.movingSeconds) },
    {
      label: t("trip.history.stats.avgSpeed"),
      value: stats.avgSpeedKmh === null ? "--" : `${stats.avgSpeedKmh.toFixed(1)} km/h`,
    },
    {
      label: t("trip.history.stats.maxSpeed"),
      value: stats.maxSpeedKmh === null ? "--" : `${Math.round(stats.maxSpeedKmh)} km/h`,
    },
    {
      label: t("trip.history.stats.cost"),
      value: detail.fuelCost === null ? "--" : formatMoney(detail.fuelCost),
    },
  ];

  return (
    <section className={cn("flex flex-col gap-3", className)}>
      <dl className="grid grid-cols-4 gap-x-6 gap-y-2">
        {entries.map((entry) => (
          <div key={entry.label} className="flex flex-col">
            <dt className="text-[11px] uppercase tracking-wide text-warm-100/40">
              {entry.label}
            </dt>
            <dd className="text-sm tabular-nums text-warm-100">{entry.value}</dd>
          </div>
        ))}
      </dl>

      {detail.stages.length > 1 ? (
        <ol className="flex flex-col gap-1" data-testid="trip-legs">
          {detail.stages.map((stage) => (
            <StageRow key={stage.id} stage={stage} onSplit={() => onSplitAt(stage.id)} />
          ))}
        </ol>
      ) : null}
    </section>
  );
}

function StageRow({ stage, onSplit }: { stage: TripStage; onSplit: () => void }) {
  const { t } = useI18n();
  return (
    <li className="flex items-center justify-between rounded-xl bg-white/[0.03] px-3 py-1.5 text-sm">
      <span className="flex items-baseline gap-3 tabular-nums text-warm-100/80">
        <span className="text-warm-100/40">#{stage.stageNumber}</span>
        <span>{formatClock(stage.startTime)}</span>
        <span className="text-warm-500">{stage.distanceKm.toFixed(1)} km</span>
        <span>{stage.fuelLiters.toFixed(2)} l</span>
      </span>
      <button
        type="button"
        onClick={onSplit}
        className={cn(
          "rounded-full px-2 py-0.5 text-[11px] text-warm-100/50",
          "hover:text-warm-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-warm-500/70",
        )}
      >
        {t("trip.history.split")}
      </button>
    </li>
  );
}
