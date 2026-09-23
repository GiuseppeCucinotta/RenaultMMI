import { useMemo } from "react";

import { TRIP_MAP_VIEWPORT } from "@/constants/trip";
import { useI18n } from "@/i18n";
import { formatScaleBar, niceScaleBarMeters, projectRoute } from "@/lib/trip-view";
import { cn } from "@/lib/utils";
import type { TripCoordinates } from "@/types/trip";

export interface RouteMapProps {
  coordinates: TripCoordinates | null;
  loading?: boolean;
  className?: string;
}

const { width: WIDTH, height: HEIGHT, padding: PADDING } = TRIP_MAP_VIEWPORT;

/**
 * The trajectory view: the stored breadcrumb as a polyline, with start and end
 * markers.
 *
 * Projection happens here rather than in the service because it is a function of
 * the *viewport*, which only the renderer knows. The geometry is a plain
 * equirectangular scale over the trip's own bounding box — enough for a single
 * journey, and it keeps the map free of a tile source, a basemap and a network
 * dependency. Tiles are a deliberate later step; this draws real stored data
 * today, offline, with no new dependency.
 */
export function RouteMap({ coordinates, loading = false, className }: RouteMapProps) {
  const { t } = useI18n();

  const projected = useMemo(
    () => projectRoute(coordinates?.points ?? [], TRIP_MAP_VIEWPORT),
    [coordinates],
  );

  if (loading) {
    return (
      <div
        className={cn(
          "flex items-center justify-center rounded-[20px] border border-white/10",
          "bg-white/[0.02] text-base text-warm-100/40",
          className,
        )}
      >
        {t("trip.history.loading")}
      </div>
    );
  }

  if (!projected) {
    return (
      <div
        data-testid="trip-map-empty"
        className={cn(
          "flex items-center justify-center rounded-[20px] border border-white/10",
          "bg-white/[0.02] text-base text-warm-100/40",
          className,
        )}
      >
        {coordinates
          ? t("trip.history.noRoute")
          : t("trip.history.selectTrip")}
      </div>
    );
  }

  const scaleBarMeters = niceScaleBarMeters(projected.metersPerUnit);
  const scaleBarWidth = scaleBarMeters / projected.metersPerUnit;

  return (
    <div
      className={cn(
        "relative rounded-[20px] border border-white/10 bg-white/[0.02]",
        className,
      )}
    >
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={t("trip.history.mapLabel")}
        data-testid="trip-map"
        className="h-full w-full"
      >
        <polyline
          points={projected.path}
          fill="none"
          strokeWidth={2.5}
          strokeLinejoin="round"
          strokeLinecap="round"
          className="stroke-warm-500"
        />

        <circle cx={projected.start.x} cy={projected.start.y} r={5} className="fill-warm-500" />
        <circle
          cx={projected.end.x}
          cy={projected.end.y}
          r={5}
          className="fill-warm-100 stroke-warm-500"
          strokeWidth={2}
        />

        {/* Scale bar: without it the polyline has no sense of size at all. */}
        <g transform={`translate(${PADDING}, ${HEIGHT - PADDING + 2})`}>
          <line
            x1={0}
            x2={scaleBarWidth}
            y1={0}
            y2={0}
            className="stroke-warm-100/40"
            strokeWidth={2}
          />
          <text x={scaleBarWidth + 6} y={4} className="fill-warm-100/50 text-[10px]">
            {formatScaleBar(scaleBarMeters)}
          </text>
        </g>
      </svg>
    </div>
  );
}
