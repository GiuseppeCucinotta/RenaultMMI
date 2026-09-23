import { useI18n } from "@/i18n";
import { useTripComputer } from "@/hooks/useTripComputer";
import { formatRange } from "@/lib/trip-view";
import { MetricCard } from "./MetricCard";
import { PeriodSelector } from "./PeriodSelector";
import { ConsumptionChart } from "./ConsumptionChart";

export interface TripComputerViewProps {
  /** Injectable for tests; production uses the hook's own default. */
  initialPreset?: string;
}

/**
 * The Trip Computer app.
 *
 * Layout follows the design reference: the app title and the resolved period on
 * the top row, a 2x2 grid of metric cards on the left and the graph filling the
 * right half of the 1920x480 stage.
 *
 * This component computes nothing. Every label, formatted value, trend direction
 * and bucket comes from the service (or the mock), which is what makes the cards
 * and the graph impossible to disagree.
 */
export function TripComputerView({ initialPreset }: TripComputerViewProps) {
  const { t } = useI18n();
  const { periods, preset, selectPreset, summary, series, error } = useTripComputer(
    initialPreset ?? "30d",
  );

  const activePeriod = periods.find((period) => period.preset === preset) ?? periods[0];
  const rangeLabel = activePeriod
    ? formatRange(summary.period.from, summary.period.to)
    : "";

  return (
    <div className="flex h-full w-full flex-col gap-4" data-testid="trip-computer">
      <header className="flex items-center gap-6">
        <h1 className="text-3xl tracking-wide text-warm-100">{t("trip.computer.title")}</h1>
        <PeriodSelector
          periods={periods}
          activePreset={preset}
          rangeLabel={rangeLabel}
          onSelect={selectPreset}
        />
        {error ? (
          <p className="text-xs text-warm-100/40" role="status">
            {t("trip.computer.staleData")}
          </p>
        ) : null}
      </header>

      <div className="flex min-h-0 flex-1 gap-6">
        <div className="grid w-[520px] shrink-0 grid-cols-2 grid-rows-2 gap-4">
          <MetricCard label={t("trip.computer.card.spent")} metric={summary.cards.spent} />
          <MetricCard
            label={t("trip.computer.card.avgConsumption")}
            metric={summary.cards.avgConsumption}
          />
          <MetricCard label={t("trip.computer.card.liters")} metric={summary.cards.liters} />
          <MetricCard label={t("trip.computer.card.distance")} metric={summary.cards.distance} />
        </div>

        <ConsumptionChart series={series} className="min-h-0 min-w-0 flex-1" />
      </div>
    </div>
  );
}
