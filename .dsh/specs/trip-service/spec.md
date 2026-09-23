# Unified Telemetry & Trip Service (Backend)

The shared backend daemon powering the **Trip Computer** and **Trip History** applications.
One service, one database, one notion of "a trip" — the two apps are two views of the same
numbers, so they can never disagree.

- **Port:** `4500` (`TRIP_PORT`)
- **Runtime:** Node.js + TypeScript, bundled to `services/dist/trip/index.js`
- **Database:** embedded SQLite via **`node:sqlite`** (a Node builtin, not `better-sqlite3`)
- **Lives in:** `services/trip-service/`

## 1. What this service is, and what it is not

It is the **single source of truth for every number** either app displays. A card, an arrow,
a graph bucket and a map polyline all come from here, already formatted and already
attributed to a period. Neither app aggregates, converts units or buckets anything.

It is **not** a telemetry driver. It never reads a CAN socket and never opens a serial port.
It consumes *samples* through two narrow ports, and the shipped state of the world is that
neither real adapter exists yet (§4).

## 2. Why one service instead of two

Trip History and Trip Computer read the same drives. Two services would mean two copies of
the segmenter, two definitions of "this month", and a real risk of the history showing a trip
the computer does not count. A single service with two read surfaces makes that impossible
by construction rather than by discipline.

## 3. Module layout

```
services/trip-service/
  index.ts              entry: resolveConfig() → TripService.start()
  config.ts             ports, paths, thresholds, the dev gate
  types.ts              samples, records, wire bodies
  ports.ts              TelemetrySource / LocationSource / SettingsPort + doubles
  query.ts              the read model: windows, trends, buckets, trip lists, map payload
  routes.ts             HTTP handlers (thin; no arithmetic)
  service.ts            TripService extends BaseMediaService<TripState>
  store/schema.ts       DDL + user_version migrations
  store/store.ts        TripWriter (what the engine may do) + the read model
  trip/engine.ts        ingestion + the segmentation state machine
  trip/consumption.ts   pure arithmetic: litres, distance, averages
  trip/cost.ts          pure: attributing litres to the price in force
  trip/buckets.ts       pure: windows, buckets, trends
  trip/trajectory.ts    pure: decimation, RDP, projection
  settings/client.ts    HttpSettingsProvider — the only HTTP-out file
  telemetry/simulator.ts  deterministic dev drive generator
```

## 4. The ports: the entire hardware surface

**This is the module's whole external dependency surface.** The engine is constructed with
nothing else, so it cannot tell a simulated drive from a CAN bus.

```ts
interface VehicleSample {
  timestamp: number;
  odometerKm: number | null;   // the assumed CAN signal; primary distance source
  speedKmh: number | null;
  fuelLevelLiters: number | null;
  fuelFlowLph: number | null;  // preferred over the level when present
  ignition: boolean;
  engineRpm: number | null;
}

interface LocationSample {
  timestamp: number; lat: number; lon: number;
  speedKmh: number | null; headingDeg: number | null; fixQuality: number | null;
}
```

- **Odometer is assumed present.** The CAN packet carrying it has not been located, so no
  adapter decodes it yet. The domain is built around the odometer delta because that is the
  objective; a mock feeds it until the packet is found.
- **There is no GPS code.** A `LocationSource` implementation does not exist. What *does*
  exist is the whole pipeline that consumes its samples — decimation, storage, the map
  payload and the projection — all tested with injected fixes. Changing the GPS adapter
  therefore cannot change a single plotted point: it only has to produce these samples.
- **There is no CAN adapter, and no byte offsets are guessed.** `SimulatedTelemetrySource`
  is the only implementation, and it is wired in only when `TRIP_DEV_SIMULATE=1`.

Replacing either device is a new class plus one binding in `index.ts`.

## 5. Trip segmentation

States: `no trip → driving → parked → (append a leg | finalize)`.

| Rule | Behaviour |
| --- | --- |
| Stage starts | ignition on **and** speed above `TRIP_MOVEMENT_EPSILON_KMH` |
| Stage ends | ignition off, and the next sample is ≥ `stageDwellMinutes` later |
| Layover | a stop between the dwell threshold and `layoverHours` **away from home** continues the same trip as a new stage |
| At home | a stop inside the configured home fence always ends the trip |
| Too long | a stop beyond `layoverHours` always ends the trip |
| No fence configured | a layover continues the trip (the engine will not *guess* "home") |
| An engine that never moves | produces no rows at all: no trip, no stage, no history |
| A stop shorter than the dwell | stays inside the same stage |

**A trip only ends on the next ignition.** That is why a car parked for the night keeps an
open trip until it either drives again (appending a leg) or the service restarts and
[power-loss recovery](#9-power-loss-recovery) closes it.

### Odometer handling

Distance integrates the odometer delta from a baseline that is **reset after every parking
break**, so kilometres driven by someone else while the car sat are not credited to the trip.
A non-positive or implausibly large step (over `TRIP_MAX_ODOMETER_JUMP_KM`) is treated as a
counter reset and contributes `0`, never negative distance.

### Fuel and refuels

Two models, because a vehicle may expose either: an explicit flow rate (`fuelFlowLph`,
integrated trapezoidally) or the tank level. With the level model a **rise is a refuel**: it
is recorded as a `fuel_events` row and contributes *zero* burned litres. Counting it as
negative consumption would silently cancel real consumption elsewhere.

## 6. Costing

Money is **derived at read time, never stored on a trip**. A litre costs whatever price was in
force when it burned: the litres burned before refuel *N* cost what the previous known price
charged. Recording a price therefore re-costs history correctly, and a mis-typed price can be
corrected rather than baked in.

Fuel burned before any price is known is **`null`**, rendered `--`. It is never `0`: "free" and
"unknown" are very different claims about someone's money.

## 7. Windows, trends and buckets

- Presets: `today`, `7d`, `30d`, `90d`, `year`, `all`, resolved server-side against the local
  calendar day. Rolling presets include today and count whole days.
- A trend compares against the **immediately preceding window of equal length**.
- A comparison window with no data is **not comparable**: `delta: null` and no arrow, rather
  than a `+0` that would read as a real "unchanged" month.
- Bucket granularity follows the window (hourly ≤ 2 days, daily ≤ 62, weekly beyond).
  **Empty buckets are emitted**, so a three-day gap shows as three zeros instead of a line
  that lies about *when* the driving happened.
- A window with **no** stages returns `buckets: []` and `empty: true`, not an axis of zeroes.

## 8. HTTP API

Built on `BaseMediaService`, so these come for free and behave exactly like the other services:
`GET /api/health`, `GET /api/state`, `GET /api/events` (SSE), `GET|POST /api/settings`.

| Route | Returns |
| --- | --- |
| `GET /api/periods` | The presets, each with its resolved `from`/`to` and label |
| `GET /api/summary?preset=\|from&to` | The four Trip Computer cards, each `{ value, unit, formatted, trend }` |
| `GET /api/series?preset=\|from&to&granularity` | Graph buckets `{ start, end, distanceKm, liters, cost }` |
| `GET /api/trips?limit&offset&from&to` | Reverse-chronological page + `total` |
| `GET /api/trips/:id` | Detail: record, `stages[]`, `stats` (idle/moving/avg/max) |
| `GET /api/trips/:id/coordinates` | Decimated `points[]` + `bounds` — the map payload |
| `POST /api/trips/merge` | `{ tripIds: [a, b] }` — **adjacent** trips only |
| `POST /api/trips/:id/split` | `{ stageId }` — that stage and later ones move to a new trip |
| `GET /api/fuel/events?pending=1` | Refuels, pending ones first in spirit |
| `POST /api/fuel/events` | `{ eventId, pricePerLiter, currency }` → records the price |
| `GET /api/fuel/prices` | The price history |
| `GET /api/status` | Ingest liveness: last sample, counters, active trip/stage, simulation flag |
| `POST /api/dev/simulation` | **dev only** — `start` / `stop` / `seed` |

Errors are thrown as `HttpError`; a refused merge or split carries the reason in the body and
the renderer shows it verbatim. A merge of non-adjacent trips is a `400`: silently reordering
history is not something a user can undo from the UI.

### Development endpoints

Registered only when `TRIP_DEV=1` or `TRIP_DEV_SIMULATE=1`; they answer **404** otherwise.

- `POST /api/dev/simulation {action: "start", scenario}` — play a drive in real time.
- `POST /api/dev/simulation {action: "seed", scenario}` — fast-forward a whole scenario into
  the database, price its refuels, and close it. This is how a machine with no vehicle gets a
  populated history to look at.
- Scenarios: `urban`, `highway`, `road-trip` (the last one produces a two-leg road trip).

A seeded drive is placed **before the earliest existing trip**, so repeated seeds stack into a
coherent history instead of overlapping each other. `Date.now()` is never used as a trip's end
time for a seeded drive, or every seeded trip would look as though it were still running.

## 9. Power-loss recovery

An infotainment unit loses power when the ignition does. On boot the engine looks for trips
left `active`, drops their unfinished stages, and closes each using its **last stored
coordinate timestamp** — so history never shows a drive that ran forever. It also refuses to
finalize an active trip merely because it was open: a stage closed cleanly is kept, and only a
genuinely unfinished one is removed.

## 10. Settings integration

The three user preferences that affect computation (`consumptionUnit`, the home fence, the
dwell/layover thresholds, `currency`) live in the **Settings service** under the `trip`
category. This service reads them over HTTP through `HttpSettingsProvider` — poll plus a
cached snapshot — and **never imports settings code**. The last successfully parsed values are
cached in the trip database, so a boot that races the settings service computes with
yesterday's values instead of silently reverting to defaults.

Field ids are a **wire contract**: `services/settings-service/categories/trip.ts` and
`services/test/settings-trip-category.test.ts` pin them, because this client degrades to
defaults on a field it cannot find.

> `EventSource` is not a global in Node or in the Node runtime Electron uses for spawned
> children, so the settings feed is polled rather than streamed. That also keeps the service
> dependency-free.

## 11. Schema

`user_version`-gated, append-only migrations. `PRAGMA journal_mode = WAL`,
`synchronous = NORMAL`, `foreign_keys = ON`.

Tables: `trips`, `trip_stages`, `trip_coordinates`, `fuel_events`, `fuel_prices`,
`settings_snapshot`.

Notes that differ from an earlier draft of this spec:

- **`fuel_events` and `fuel_prices` are separate.** A refuel is the physical event (litres,
  tank before/after); a price is what the litre cost at a moment in time. Prices timestamped
  independently are what let a corrected price re-cost history.
- **`trip_stages` carries the odometer**, which is the primary distance source.
- **No per-stage `fuel_cost`.** Cost is derived at read time (§6), so a price change cannot
  leave a stale total behind.
- `trip_coordinates` stores the decimated stream with per-point speed and consumption for the
  route overlay.

Trip totals are **recomputed from stage rows** on every mutation, inside a transaction, so
`SUM(stages.distance_km) == trips.total_distance_km` holds by construction. An in-progress
stage contributes zero: live progress belongs to `/api/status`, and history must not show a
number that has not finished happening.

## 12. Environment

| Variable | Default | Purpose |
| --- | --- | --- |
| `TRIP_PORT` | `4500` | HTTP port |
| `TRIP_DB_PATH` | `~/.config/renault-mmi/trips.db` | SQLite file |
| `TRIP_DEV` | unset | `1` mounts the dev endpoints |
| `TRIP_DEV_SIMULATE` | unset | `1` attaches the drive simulator and mounts them |
| `SETTINGS_BASE_URL` | unset | Where to read preferences; unset runs on defaults + cache |
| `TRIP_DEFAULT_FUEL_PRICE` | `1.85` | Price the dev seed uses to confirm generated refuels |
| `TRIP_CURRENCY` | `EUR` | Fallback currency |
| `TRIP_MOVEMENT_EPSILON_KMH` | `2` | Speed at or below which the car is not moving |
| `TRIP_MAX_ODOMETER_JUMP_KM` | `500` | Above this, an odometer step is a reset |
| `TRIP_REFUEL_DELTA_L` | `2` | Tank rise that counts as a refuel |
| `TRIP_FLUSH_INTERVAL_MS` | `1000` | How often an open stage's totals are written |
| `SERVICE_AUTO_SUSPEND` / `SERVICE_IDLE_TIMEOUT_MS` | shared | Standard service lifecycle |

## 13. Tests

`services/test/`:

| File | Covers |
| --- | --- |
| `trip-arithmetic.test.ts` | Consumption both ways, tank rises, odometer resets, flow integration, cost attribution, `--` rendering |
| `trip-buckets.test.ts` | Window/preset resolution, adjacency of the comparison window, bucket boundaries and empty buckets, trend comparability |
| `trip-trajectory.test.ts` | Decimation (including a parked car with a live receiver), RDP, bounds, projection degeneracies |
| `trip-engine.test.ts` | The state machine: idling, short stops, 4 h away → two legs, 4 h at home → two trips, > 18 h, odometer resets, refuel detection, recovery, no-GPS |
| `trip-store.test.ts` | Migrations, cascade deletes, atomic recompute, parity after merge/split, persistence, rollback |
| `trip-service.test.ts` | Every route over HTTP, validation, paging, merge/split refusals, fuel pricing, suspend/resume, dev-endpoint gating |

Because the engine takes only ports, every one of those runs with no database file, no clock
and no hardware.
