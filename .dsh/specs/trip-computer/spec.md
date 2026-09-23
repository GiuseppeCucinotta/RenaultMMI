# Trip Computer

The "how much have I spent, and am I improving" app. Four numbers, four trends and a graph over
a period the user picks.

Reference layout: `./Trip Computer.png`.

## 1. Where it lives

Opened from the **Fuel** tile on the Home grid (`DEFAULT_APPS` → `fuel`) as a full-screen view,
the same mechanism Settings uses. It is deliberately **not** in `NAV_ORDER`: the bottom rail
stays three items. See `frontend/src/App.tsx`.

## 2. The four cards

| Card | Value | Unit |
| --- | --- | --- |
| Spent so far | total cost of the fuel burned | currency symbol |
| Avg. consumption | average over the period, in the unit from **Settings → Trips** | `l/100km` or `km/l` |
| Liter consumed | total litres | `l` |
| Total distance | total kilometres | `km` |

Each card carries a **trend**: an arrow and a one-line comparison, e.g. `+2.00 l vs last
period`. The comparison is against the **immediately preceding period of the same length** —
"last 30 days" compares with the 30 days before that, not with "last month".

Every value, unit, formatted string and trend direction arrives from the service. The renderer
**performs no calculation**: it does not aggregate, convert units, round, or decide what a
period means. That is the invariant the whole feature is built on, and it is why a card can
never disagree with the graph beside it.

## 3. No data

- A period with no trips shows **`--`** in every card and **no arrow**.
- A period that *has* data but whose comparison period does not shows a value **without an
  arrow**, with "No previous period" beneath it. A `+0` would read as a real "unchanged"
  month, so it is never shown.
- The graph draws an explicit empty state rather than a flat line at zero.

## 4. The graph

Distance bars with consumption overlaid, in the project's amber palette, drawn as inline SVG
with no charting dependency.

Buckets come from the service at a granularity it picks for the window (hourly for a day or
two, daily up to ~2 months, weekly beyond). **Empty buckets are included**, so a gap where the
car sat still is visible as a gap rather than smoothed over by a line connecting two distant
points.

## 5. Period selection

The pill in the header shows the **resolved range** (`01/09/2026 - 30/09/2026`) exactly as the
service reported it, followed by the presets: Today, Last 7 days, Last 30 days, Last 90 days,
Last 12 months, All time.

The range text is printed from the service's own `from`/`to` — the renderer never derives a
date, because a renderer that computes dates is a renderer that can disagree with the window
the numbers came from.

## 6. Layout

At the 1920×480 stage, following the reference:

- Header row: the app title, then the period selector.
- Left: a 2×2 grid of cards — Spent / Avg. consumption on the first row, Litres / Distance on
  the second.
- Right: the graph, filling the remaining width.

## 7. Files

| Path | Role |
| --- | --- |
| `src/components/views/trip-computer/TripComputerView.tsx` | Composition and layout |
| `…/MetricCard.tsx` | One card: label, value, arrow, comparison line |
| `…/TrendArrow.tsx` | The inline triangle; `neutral` draws nothing |
| `…/PeriodSelector.tsx` | The resolved range plus the preset buttons |
| `…/ConsumptionChart.tsx` | The SVG graph and its empty state |
| `src/hooks/useTripComputer.ts` | Endpoint, health poll, mock fallback, refetch on a new trip |
| `src/services/trip.ts` | Thin fetch wrappers |
| `src/data/trip.mock.ts` | Browser-dev fallback so `npm run dev` renders without Electron |
| `src/lib/trip-view.ts` | The renderer's only logic: wording a delta, formatting a date |

## 8. Tests

- `frontend/test/trip-view.test.ts` — delta wording (including money and the "not comparable"
  case), arrow decisions, date and duration formatting.
- `frontend/test/trip-service-integration.test.ts` — drives a real service through the
  renderer's own client and asserts on what a card would show, including the `--` cases and
  the "no previous period" rule.

## 9. What this app must not do

- Do not add aggregation, unit conversion or bucketing to the renderer. If a card needs a new
  number, compute it in the service.
- Do not print a trend when `trend.comparable` is false.
- Do not derive a period label from a preset name; use the range the service resolved.
