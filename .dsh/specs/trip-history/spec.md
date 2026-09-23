# Trip History

Every journey the car has taken: the list, the legs of a road trip, the detail behind a trip and
the route on a map.

Reference layout: `./Trip History.png`.

## 1. Where it lives

Opened from the **History** tile on the Home grid (`DEFAULT_APPS` → `nav-history`) as a
full-screen view. Like the Trip Computer it is deliberately **not** in `NAV_ORDER`.

It shares the [trip service](../trip-service/spec.md) with the Trip Computer, which is what
guarantees the history shows exactly the drives the computer counted.

## 2. Trip list

- Reverse chronological, newest first, **scrollable**.
- Each card shows: date and time, distance (km), duration, litres, average consumption and the
  estimated cost — as in the reference, as large tabular numbers separated by a square bullet.
- A value the service could not compute (typically cost, with no fuel price recorded yet) shows
  as `--` rather than `0.00`.
- **Multi-stage journeys** (road trips) are one card with a leg count and an expandable detail
  row per stage. The service decides what a road trip is; the list only shows the `legs` count
  it was given.
- An **in-progress** drive is labelled rather than silently mixed in with finished trips.

## 3. Trip detail and map

Selecting a trip loads its detail and its trajectory:

- **Map** — the stored breadcrumb as a polyline with start and end markers and a scale bar.
  Fully offline: it is drawn from stored coordinates, with no tile source and no network.

  The projection is a plain equirectangular scale over the trip's own bounding box, done in
  `src/lib/trip-view.ts`. It lives in the renderer rather than the service because it is a
  function of the *viewport*, which only the renderer knows.

  **Map tiles are a deliberate later step.** The layout reserves the map's box, and the route
  drawn in it is real stored data, so adding a basemap later changes only this component.

- **Stats bar** — start, end, idle, moving, average speed, maximum speed and cost. All of it
  comes from the service's `stats`, computed over the same stage rows the list row is summed
  from.

- **Legs** — for a road trip, one row per stage with its own distance, litres and a *split
  here* action.

Before a trip is selected the map shows the reference's **"Select a trip to show map"** state.
A trip with no stored trajectory says so, rather than rendering an empty box.

## 4. Manual edits

The list is not read-only, but the app only offers edits it can justify:

- **Merge** — a merge action appears on a card when there is a *next* card to merge with, and
  the service refuses anything that is not an adjacent pair. A refusal is shown with the
  service's own wording (`trips overlap and cannot be merged`).
- **Split** — available on a road trip's stage rows. Splitting moves that stage and every later
  one into a new trip, and the totals of both are recomputed so no kilometre is created or lost.

Neither edit is optimistic: the list is refetched after the service confirms, because the
service is the authority on what the edit produced.

## 5. Files

| Path | Role |
| --- | --- |
| `src/components/views/trip-history/TripHistoryView.tsx` | Composition: list | map + detail |
| `…/TripListItemCard.tsx` | One list card, with its merge action |
| `…/TripDetailPanel.tsx` | Stats bar and the leg rows with split actions |
| `…/RouteMap.tsx` | The SVG trajectory, markers, scale bar and empty states |
| `src/hooks/useTripHistory.ts` | List, selection, detail/route fetch, merge, split |
| `src/lib/trip-view.ts` | Projection, scale bar, formatting |

## 6. Tests

- `frontend/test/trip-view.test.ts` — the projection: bounds, aspect ratio, a north–south route
  that must not lean, a single point that must not divide by zero, and the scale bar rounding
  up so it never overstates distance.
- `frontend/test/trip-service-integration.test.ts` — a road trip arriving as one trip with two
  legs, a trip with no trajectory reporting an empty map, and merge/split preserving every
  kilometre.

## 7. Development / mock playback

With no vehicle there is no telemetry, so the service ships a deterministic replay generator
(`POST /api/dev/simulation {action: "seed", scenario}`) covering a short urban commute, a
highway run and a multi-stage road trip with a layover. It is **dev-only** and answers 404
unless `TRIP_DEV` (or `TRIP_DEV_SIMULATE`) is set.

Seeded drives stack backwards in time before the earliest existing trip, so seeding repeatedly
produces a coherent history to scroll through instead of overlapping trips. Under
`npm run dev` the Electron main process sets `TRIP_DEV=1` for the spawned service, so a
development build already has these endpoints available:

```bash
curl -X POST http://127.0.0.1:4500/api/dev/simulation \
  -H 'Content-Type: application/json' \
  -d '{"action":"seed","scenario":"road-trip"}'
```

## 8. What this app must not do

- Do not draw a route the service did not send, and do not synthesise map geometry.
- Do not merge or split optimistically; the service renumbers stages and recomputes totals.
- Do not treat a missing cost as zero.
