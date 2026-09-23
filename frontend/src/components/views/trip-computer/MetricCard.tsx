import { Card, CardContent } from "@/components/ui/card";
import { useI18n } from "@/i18n";
import type { TripMetric } from "@/types/trip";
import { formatDelta } from "@/lib/trip-view";
import { cn } from "@/lib/utils";
import { TrendArrow } from "./TrendArrow";

export interface MetricCardProps {
  label: string;
  metric: TripMetric;
  className?: string;
}

/**
 * One Trip Computer metric: label, value, trend arrow and a one-line comparison.
 *
 * Carries no knowledge of which metric it is — the label, the formatted value and
 * the trend direction all arrive from the service, so a new card is a data change
 * rather than a new component. When there is nothing to compare against, the
 * footer says so instead of printing a `+0` that would read as a real change.
 */
export function MetricCard({ label, metric, className }: MetricCardProps) {
  const { t } = useI18n();
  const delta = formatDelta(metric);
  const hasValue = metric.value !== null;

  return (
    <Card
      className={cn(
        "border border-white/10 bg-white/[0.03] backdrop-blur-sm",
        "rounded-[20px] py-0",
        className,
      )}
    >
      <CardContent className="flex h-full flex-col justify-between px-5 py-4">
        <p className="text-sm tracking-wide text-warm-100/60">{label}</p>

        <div className="flex items-center justify-between gap-3">
          <p
            className={cn(
              "text-3xl font-medium tabular-nums",
              hasValue ? "text-warm-500" : "text-warm-100/30",
            )}
          >
            {metric.formatted}
          </p>
          <TrendArrow direction={metric.trend.direction} />
        </div>

        <p className="h-4 text-xs text-warm-100/45">
          {delta ? t("trip.computer.vsLastPeriod", { delta }) : t("trip.computer.noComparison")}
        </p>
      </CardContent>
    </Card>
  );
}
