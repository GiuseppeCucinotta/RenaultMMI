import { useCallback } from "react";

import { useI18n } from "@/i18n";
import { useTripHistory } from "@/hooks/useTripHistory";
import { cn } from "@/lib/utils";
import { RouteMap } from "./RouteMap";
import { TripDetailPanel } from "./TripDetailPanel";
import { TripListItemCard } from "./TripListItemCard";

/**
 * The Trip History app.
 *
 * Layout follows the design reference: a scrollable reverse-chronological list on
 * the left, the map filling the right. Selecting a trip loads its detail and
 * trajectory; before that the map shows the reference's "Select a trip to show
 * map" state rather than an empty box.
 *
 * The merge and split actions are the only writes this view performs, and each is
 * a single service call — the service decides whether the edit is legal and says
 * why when it is not.
 */
export function TripHistoryView() {
  const { t } = useI18n();
  const {
    trips,
    selectedTripId,
    selectTrip,
    detail,
    coordinates,
    loadingDetail,
    error,
    merge,
    split,
  } = useTripHistory();

  const handleSplit = useCallback(
    (stageId: number) => {
      if (selectedTripId === null) return;
      void split(selectedTripId, stageId);
    },
    [selectedTripId, split],
  );

  return (
    <div className="flex h-full w-full flex-col gap-4" data-testid="trip-history">
      <header className="flex items-baseline gap-4">
        <h1 className="text-3xl tracking-wide text-warm-100">{t("trip.history.title")}</h1>
        {error ? (
          <p role="status" className="text-xs text-warm-100/50">
            {error}
          </p>
        ) : null}
      </header>

      <div className="flex min-h-0 flex-1 gap-6">
        <div
          data-testid="trip-list"
          className="flex w-[46%] min-w-0 shrink-0 flex-col gap-3 overflow-y-auto pr-2"
        >
          {trips.length === 0 ? (
            <p className="mt-8 text-base text-warm-100/40">{t("trip.history.empty")}</p>
          ) : (
            trips.map((trip, index) => {
              // Only an *adjacent* pair can be merged, and the list is newest
              // first, so the merge target is the next row.
              const next = trips[index + 1];
              return (
                <TripListItemCard
                  key={trip.id}
                  trip={trip}
                  selected={trip.id === selectedTripId}
                  onSelect={selectTrip}
                  {...(next ? { onMergeWithNext: () => void merge(trip.id, next.id) } : {})}
                />
              );
            })
          )}
        </div>

        <div className={cn("flex min-h-0 min-w-0 flex-1 flex-col gap-3")}>
          <RouteMap
            coordinates={coordinates}
            loading={loadingDetail}
            className="min-h-0 flex-1"
          />
          {detail ? <TripDetailPanel detail={detail} onSplitAt={handleSplit} /> : null}
        </div>
      </div>
    </div>
  );
}
