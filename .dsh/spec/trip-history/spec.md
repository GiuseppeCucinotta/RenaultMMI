# Trip History

The Trip History application provides route archiving, historical driving analysis, and leg-by-leg consumption metrics for every journey taken by the vehicle.

## Frontend

* **Trip List View:**
* Displays historical trips in reverse chronological order (newest first).
* Each list item card displays: date/time, total distance (km), total driving duration, total fuel burned (L), average consumption (L/100km or km/L), and estimated trip cost (currency).
* Multi-stage journeys (road trips) appear as a single clustered parent card with an expandable dropdown showing individual legs/stages.
* Quick action to manually merge two adjacent trips or split a trip into multiple stages.
* Every trip can be expanded to show more details
* The selected trip shows in the map

* **Trip Detail / Map View:**
* An interactive map on the right side displaying the full GPS trajectory (breadcrumb trail) of the selected trip.
* Route line colored or overlaid with driving metrics (e.g., speed variations or localized high consumption points).
* Summary stats bar detailing start/end timestamps, idle time, moving time, average speed, max speed, and total cost calculated from fuel pricing records.
* Offline capability: Map tiles must render from local storage without requiring active internet connectivity.


## Backend

* **Data Aggregation & Shared Architecture:**
* Operates within the unified telemetry engine shared with the Trip Computer.
* Ingests CAN metrics (vehicle speed, fuel rate, odometer) via UDP from `can-decoder` alongside incoming NMEA/GPS daemon data.
* Stores data in the shared SQLite database (`trips`, `stages`, and `trip_coordinates`).


* **Trip Segmentation State Machine:**
* **Engine State Trigger:** Monitored via ignition state/engine RPM from CAN.
* **Stage Finalization:** An active driving stage transitions to "Parked/Completed" when the engine is off for longer than a configurable dwell threshold (default: $15\text{ minutes}$).
* **Journey Consolidation (Road Trip Logic):**
* A stop between $15\text{ minutes}$ and $18\text{ hours}$ marks the end of a *Stage*, not necessarily the entire *Trip*.
* If the stop occurs away from the defined "Home Geofence" radius, the next ignition cycle automatically appends as a new *Stage* of the ongoing *Trip*.
* If the stop occurs within the "Home Geofence" or exceeds the maximum layover threshold ($18\text{ hours}$), the master *Trip* is marked closed.


* **Coordinate Decimation:**
* To prevent database bloat, downsample raw $1\text{ Hz}$ GPS logs using the Ramer-Douglas-Peucker (RDP) algorithm or distance-threshold logging (record points only on heading change $> 5^\circ$ or delta distance $> 20\text{ meters}$).

- **Database Engine:** Embedded **SQLite** via `better-sqlite3` (no client-server daemon, zero network overhead).
- **Concurrency & Journaling:** Must be initialized with `PRAGMA journal_mode = WAL;` and `PRAGMA synchronous = NORMAL;` to allow non-blocking concurrent reads (UI) and high-frequency writes (CAN/UDP ingest).
- **Environment Handling:** In development, mount the `.db` file locally; do NOT spin up a separate database container service.


* **Cost & Consumption Calculation:**
* Binds the fuel burned during the trip window to the latest recorded fuel price from the Trip Computer refuel notification service.



## Storage Schema (Draft)

```sql
CREATE TABLE trips (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT, -- e.g., "Messina to Catania" or custom user name
    start_time INTEGER NOT NULL,
    end_time INTEGER,
    total_distance_km REAL DEFAULT 0.0,
    total_fuel_liters REAL DEFAULT 0.0,
    fuel_cost REAL DEFAULT 0.0,
    is_road_trip BOOLEAN DEFAULT 0
);

CREATE TABLE trip_stages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    trip_id INTEGER REFERENCES trips(id) ON DELETE CASCADE,
    stage_number INTEGER NOT NULL,
    start_time INTEGER NOT NULL,
    end_time INTEGER,
    start_lat REAL,
    start_lon REAL,
    end_lat REAL,
    end_lon REAL,
    distance_km REAL DEFAULT 0.0,
    fuel_liters REAL DEFAULT 0.0
);

CREATE TABLE trip_coordinates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    stage_id INTEGER REFERENCES trip_stages(id) ON DELETE CASCADE,
    timestamp INTEGER NOT NULL,
    lat REAL NOT NULL,
    lon REAL NOT NULL,
    speed_kmh REAL,
    instant_consumption REAL
);

```

## Tests

* **Mock Playback:**
* Include a deterministic GPX/NMEA + CAN log replay tool running only in development mode to simulate full drives (e.g., short urban commute vs. long multi-stage drive with simulated sleep intervals).


* **Segmentation Engine Tests:**
* Verify that a 4-hour stop at a non-home location creates a two-stage single trip, while a 4-hour stop at the defined home geofence closes Trip 1 and initiates Trip 2.
* Verify mathematical parity: ensure `SUM(stages.fuel_liters) == trips.total_fuel_liters` and matches the Trip Computer's windowed aggregation.


* **Edge Cases:**
* GPS fix dropouts (tunnel driving, cold start) must extrapolate distance using vehicle wheel-speed/odometer CAN packets rather than dropping distance calculation.
* Sudden shutdown/power loss: Unclosed trips must recover gracefully on next boot by closing open records using the last known timestamp.