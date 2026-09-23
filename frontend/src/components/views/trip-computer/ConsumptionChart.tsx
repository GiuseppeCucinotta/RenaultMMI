import { useMemo } from "react";

import { TRIP_GRAPH_HEIGHT } from "@/constants/trip";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import type { TripSeries } from "@/types/trip";

export interface ConsumptionChartProps {
  series: TripSeries;
  className?: string;
}

/** Internal drawing coordinates; the SVG scales to whatever box it is given. */
const WIDTH = 640;
const HEIGHT = TRIP_GRAPH_HEIGHT;
const PAD_X = 14;
const PAD_TOP = 16;
const PAD_BOTTOM = 22;

/**
 * Distance bars with consumption overlaid, drawn by hand.
 *
 * No charting dependency: the shape is simple, and the project's design system
 * already owns the colours. The component plots only what the service sent —
 * it does not bucket, aggregate or interpolate, so the graph cannot disagree
 * with the cards above it.
 */
export function ConsumptionChart({ series, className }: ConsumptionChartProps) {
  const { t } = useI18n();

  const drawn = useMemo(() => {
    const plotWidth = WIDTH - PAD_X * 2;
    const plotHeight = HEIGHT - PAD_TOP - PAD_BOTTOM;
    const buckets = series.buckets;
    if (buckets.length === 0) return null;

    const maxDistance = Math.max(...buckets.map((bucket) => bucket.distanceKm), 1);
    // Consumption per bucket, derived from the two numbers the service sent.
    const consumption = buckets.map((bucket) =>
      bucket.distanceKm > 0 ? (bucket.liters / bucket.distanceKm) * 100 : null,
    );
    const present = consumption.filter((value): value is number => value !== null);
    const maxConsumption = present.length > 0 ? Math.max(...present) : 0;

    const slot = plotWidth / buckets.length;
    const barWidth = Math.max(2, slot * 0.55);

    const bars = buckets.map((bucket, index) => {
      const height = (bucket.distanceKm / maxDistance) * plotHeight;
      return {
        key: bucket.start,
        x: PAD_X + index * slot + (slot - barWidth) / 2,
        y: PAD_TOP + plotHeight - height,
        width: barWidth,
        height: Math.max(bucket.distanceKm > 0 ? 2 : 0, height),
        distanceKm: bucket.distanceKm,
        start: bucket.start,
      };
    });

    const linePoints = consumption
      .map((value, index) => {
        if (value === null || maxConsumption === 0) return null;
        const x = PAD_X + index * slot + slot / 2;
        const y = PAD_TOP + plotHeight - (value / maxConsumption) * plotHeight;
        return `${x},${y}`;
      })
      .filter((point): point is string => point !== null);

    return {
      bars,
      linePoints: linePoints.join(" "),
      baselineY: PAD_TOP + plotHeight,
      plotHeight,
      maxDistance,
      maxConsumption,
    };
  }, [series]);

  if (!drawn) {
    return (
      <div
        data-testid="trip-chart-empty"
        className={cn(
          "flex items-center justify-center rounded-[20px] border border-white/10",
          "bg-white/[0.02] text-base text-warm-100/40",
          className,
        )}
      >
        {t("trip.computer.noData")}
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col gap-2", className)} data-testid="trip-chart">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={t("trip.computer.graphLabel")}
        className="w-full flex-1"
        style={{ minHeight: 0 }}
      >
        {/* Baseline: without it, three flat days look like a broken axis. */}
        <line
          x1={PAD_X}
          x2={WIDTH - PAD_X}
          y1={drawn.baselineY}
          y2={drawn.baselineY}
          className="stroke-white/15"
          strokeWidth={1}
        />

        {drawn.bars.map((bar) => (
          <rect
            key={bar.key}
            x={bar.x}
            y={bar.y}
            width={bar.width}
            height={bar.height}
            rx={2}
            data-bucket-distance={bar.distanceKm}
            className="fill-warm-500/35"
          />
        ))}

        {drawn.linePoints ? (
          <polyline
            points={drawn.linePoints}
            fill="none"
            strokeWidth={2.5}
            strokeLinejoin="round"
            strokeLinecap="round"
            className="stroke-warm-500"
          />
        ) : null}
      </svg>

      {/* The x axis is described in words: at this size, tick labels would be
          unreadable, and the reader already knows the period from the pill. */}
      <p className="px-1 text-xs text-warm-100/40">
        {t("trip.computer.graphCaption", {
          granularity: t(`trip.computer.granularity.${series.granularity}`),
          count: series.buckets.length,
        })}
      </p>
    </div>
  );
}
