# RenaultMMI — Agent Guide

An npm workspace with three areas: a **C CAN decoder** (`can-decoder/`), the **Node.js service backends** (`services/`), and an **Electron + React infotainment UI** (`frontend/`).
Target hardware: Raspberry Pi 5 driving a Waveshare 8.8" **1920×480 portrait** display.

> **How to use this file:** skim §1–§3 for orientation, then jump to the section for the code you touch.
> Deep dives live in `docs/` — see §9.

---

## 1. Quick reference

| Goal | Command |
| --- | --- |
| Install (both workspaces) | `npm install` (repo root) |
| Build CAN decoder | `cd can-decoder && make` |
| Run CAN decoder | `cd can-decoder && ./can-decoder` (needs `vcan0`, see §4) |
| Build service bundles | `npm run build --workspace services` → `services/dist/<name>/index.js` |
| Dev app (services watch + renderer + Electron) | `npm run dev` (repo root) |
| Typecheck + bundle + package | `npm run build --workspace frontend` |
| Lint | `npm run lint` |
| Run all tests | `npm test` (native `node:test`, ~1.5s) |
| Run one workspace's tests | `npm test --workspace services` / `npm test --workspace frontend` |
| Run a TS script | `npm run tsx --workspace frontend -- <file>` (or `--workspace services`) |
| Debug a service standalone | `npm run bluetooth:debug --workspace services` / `cd:debug` (jukebox has no script) |

**Definition of done.** For `frontend/` changes: `npm test --workspace frontend`, `npm run lint` *and* `npm run typecheck --workspace frontend` all pass. For `services/` changes: `npm test --workspace services`, `npm run typecheck --workspace services` and `npm run build --workspace services` all pass. `tsc` runs with `strict` + `noUnusedLocals` + `noUnusedParameters`; lint is `--max-warnings 0`.

**Tests:** service suites live in `services/test/*.test.ts`, renderer/electron suites in `frontend/test/*.test.ts`, both on the native `node:test` runner (see §5.7). The CAN decoder has no tests at all.

---

## 2. Repo map

```
can-decoder/                C daemon — CAN bus in, UDP out (see §4)
services/                   Node backends — built to services/dist, spawned by Electron
  package.json              @renault-mmi/services: service deps + build/watch/test scripts
  scripts/build.mjs         bundles the five services with vite-plugin-electron's build()
  tsconfig.json             strict, includes shared + the five services + test
  jukebox-service/          standalone Node service :4100 — mpv + music library
    service.ts              JukeboxService extends BaseMediaService (HTTP + routes)
    player.ts               mpv wrapper + suspend/resume snapshot
  bluetooth-service/        standalone Node service :4200 — BlueZ over D-Bus
    service.ts              BluetoothService extends BaseMediaService (routes only)
    phone.ts                PhoneManager: state + primary-phone policy (the deep module)
    bluez.ts agent.ts       D-Bus client / Agent1 pairing prompts
    pairing.ts devices.ts   pairing state machine / CoD classification + filter
    media.ts calls.ts       active-phone AVRCP read model / reserved HFP seam
    artwork.ts volume.ts ports.ts
  cd-service/               standalone Node service :4300 — optical drive + mpv
    service.ts              CdService extends BaseMediaService (drive orchestration)
    drive.ts                udev-event drive monitor
    disc.ts player.ts       disc identification / mpv wrapper
  settings-service/         standalone Node service :4400 — settings schema + JSON store
    service.ts              SettingsService extends BaseMediaService (routes only)
    registry.ts             CATEGORY_ORDER + schema validation (cross-category refs throw)
    fields.ts store.ts      field normalisation / per-category JSON persistence
    categories/*.ts         one CategoryDef per macrocategory — add a setting here only
  trip-service/             standalone Node service :4500 — trips, fuel, trajectories (SQLite)
    service.ts routes.ts    TripService + the HTTP surface (thin; no arithmetic)
    ports.ts                TelemetrySource / LocationSource / SettingsPort — the whole
                            hardware surface; no CAN and no GPS adapter exists yet
    trip/engine.ts          ingestion + the segmentation state machine
    trip/{consumption,cost,buckets,trajectory}.ts   pure calculation modules
    query.ts                the read model: windows, trends, buckets, trip lists, map payload
    store/{schema,store}.ts node:sqlite DDL + migrations, TripWriter, the read model
    telemetry/simulator.ts  deterministic dev drive generator (dev-only)
  shared/                   imported by services + (types) the renderer
    service-http.ts         HTTP helpers, SSE hub + **BaseMediaService**
    logger.ts               createLogger(scope) — the one service logger
    mpv.ts                  MpvLike / MpvFactory — the injectable mpv contract
    jukebox-types.ts        library/playback types
    system-info.ts          SystemInfo type (debug panel)
  test/                     service node:test suites + doubles (see §5.7)
frontend/
  electron/                 Electron main process
    main.ts                 windows + ALL IPC handlers + service lifecycle
    preload.ts              contextBridge surface exposed to the renderer
    entertainment-audio.ts  EntertainmentVolumeController (0–30)
    udp-probe.ts            the only UDP listener (debug window only)
  src/                      React renderer
    main.tsx                renders provider stack → <App/>
    App.tsx                 view switch + #/debug branch + hash routing
    components/
      home/ media-view/ views/ Navbar.tsx Background.tsx VolumeIndicator.tsx
      debug/                DebugPanel + Resources/Udp/Volume/Language/MediaFeed/About
      settings/             SettingsView + category rail + field controls
      ui/                   shadcn primitives (button, card, slider, tabs, switch, segmented)
    context/                provider + context pairs: jukebox, bluetooth, cd, settings
    hooks/                  use* data + input hooks (see §5.4)
    services/               HTTP/SSE clients for the five local services
    data/                   static defaults + *.mock.ts browser fallbacks
    types/  constants/  lib/  styles/  i18n/  assets/  references/
  test/                     renderer/electron node:test suites (see §5.7)
  vite.config.ts            main + preload electron entries + alias + plugins
  tsconfig.json             strict, paths, include list
```

**Workspaces:** the root `package.json` declares the `services` and `frontend` workspaces; run `npm install` once at the repo root. `npm run dev` builds the services, then watches them alongside the frontend.
**Import alias:** `@/* → src/*`. Declared in **both** `frontend/tsconfig.json` and `frontend/vite.config.ts` — keep them in sync.
**tsconfig includes:** `frontend/` = `src`, `electron`, `test`; `services/` = `shared`, the five `*-service/`, `test`. The renderer and `electron/preload.ts` type-import `services/shared/*` by relative path.
**Gitignored:** `node_modules/`, `build/`, `dist/`, `dist-electron/`, `release/`, `compile_commands.json`, `.cache/`, `.npm-cache/`.

---

## 3. Architecture

```
┌──────────────────────────────────────────────────────────┐
│ can-decoder/ (C11, pthreads, raw CAN socket) on vcan0     │
│ receiver → ring_buf(4096) → decoder(x4) → udp_sender      │
│ → UDP 127.0.0.1:4000 every 16666 µs (~60 Hz)              │
└───────────────────────────┬──────────────────────────────┘
                            │ UDP: VehiclePayloadState (packed, ~21 B)
                            ▼
┌──────────────────────────────────────────────────────────┐
│ Electron main (electron/main.ts)                          │
│  • main window 1920×480 frameless fullscreen              │
│  • debug window on Ctrl+Shift+D or #/debug → udp-probe    │
│  • spawns jukebox/bluetooth/cd/settings/trip services (ELECTRON_RUN_AS_NODE)
│  • owns entertainment volume                              │
└───────┬──────────────────────────────────────────────────┘
        │ IPC (contextBridge → window.*)
        ▼
┌──────────────────────────────────────────────────────────┐
│ React renderer (src/)                                     │
│  views: home|phone|media|settings        debug: #/debug   │
│  full-screen apps: settings, trip-computer, trip-history   │
│  ← HTTP + SSE → 127.0.0.1:{4100 jukebox, 4200 bt,         │
│                    4300 cd, 4400 settings, 4500 trip}     │
└──────────────────────────────────────────────────────────┘
```

### Data-flow invariants

- The **CAN decoder is the only telemetry producer**; the renderer does **not** decode vehicle state yet. `VehiclePayloadState` is a `#pragma pack(1)` struct (~21 B). Global `VehicleState` is mutex-guarded: the UDP sender locks/copies/sends; decoder threads lock to update.
- `electron/udp-probe.ts` is the **only** UDP listener. It emits raw hex frames to the **debug window only**; the main UI has no vehicle data. Debug framing: "Raw frames — decoding pending (future consumer process)".
- Every service is **loopback-only** (`127.0.0.1`) and speaks the same shape: `GET /api/health`, `GET /api/state`, `GET /api/events` (SSE) and `GET`/`POST /api/settings`, plus its own routes (see §5.3).

---

## 4. CAN decoder (`can-decoder/`)

- Pipeline: `receiver_can.c` → `ring_buffer.c` → `can_decoder.c` (×4 threads) → `udp_sender.c`; `main.c` wires it up.
- **Auto-generated, do not hand-edit:** `include/grand_modus.h` + `src/grand_modus.c` come from `can-decoder/grand_modus.dbc` via **cantools 41.4.1** (`can-decoder/venv/`). Regenerate from the DBC, never patch the generated files.
- CAN IDs: ENGINE `0x181`, GEARBOX `0x215`, CLIMATE `0x374`, BRAKES `0x5C5`, LIGHTS_AND_DOORS `0x60D`, SAFETY `0x651`.
- `make` builds `can-decoder/can-decoder`; `make clean` removes `build/` and the binary. No run target, no unit tests.
- `test/` holds candump-format log simulators only: `modus_sim_city.py` → `urbano.log`, `modus_sim_highway.py` → `autostrada.log`.

**Binds `vcan0` and exits if the interface is missing:**

```bash
sudo ip link add name vcan0 type vcan && sudo ip link set up vcan0
canplayer -I test/urbano.log            # replay a simulator log
# or: cansend vcan0 181#1910000000000000
```

---

## 5. Frontend (`frontend/`)

React 18 + Electron 40 + Vite 7 + Tailwind v4 + shadcn/ui + framer-motion. TypeScript strict.

### 5.1 Process model — `electron/main.ts`

- Creates the main window (1920×480, frameless, non-resizable, fullscreen) and, lazily, the debug window.
- **Ctrl+Shift+D** is intercepted via `before-input-event` in the **main** window → `toggleDebugWindow()`. The debug window loads the renderer with hash `#/debug`.
- `app.whenReady` starts all five services; `will-quit` stops them.

**IPC surface** (handlers in `main.ts`, exposed by `preload.ts`):

| Channel | Direction | Purpose |
| --- | --- | --- |
| `jukebox:get-endpoint` / `bluetooth:get-endpoint` / `cd:get-endpoint` / `settings:get-endpoint` / `trip:get-endpoint` | invoke | `{ baseUrl }` for each service |
| `entertainment:get-state` / `:set-volume` / `:set-source` | invoke | volume + active source |
| `entertainment:state-changed` | main → renderer | volume/source broadcast to both windows |
| `get-app-info` | invoke | name/version for the debug About panel |
| `udp-packet` | main → renderer | UDP hex frames → debug UDP panel |
| `debug-media-feed` / `debug-media-source` | renderer(main) → renderer(debug) relays | debug panel drives media state |
| `main-process-message` | main → renderer | logged in `src/main.tsx` |
| `debug-log`, `debug-channels`, `test-message` | renderer → main | wired in preload; not driven by main |

`window.entertainmentAudio`, `window.jukebox`, `window.bluetooth`, `window.cd`, `window.settings`, `window.trip`, `window.debugAPI`, `window.ipcRenderer` are the renderer-facing globals (`electron/preload.ts`). `window.debugAPI.getSystemInfo/getEnvVars` are computed **in preload**, not over IPC.

### 5.2 vite.config.ts — the entry trap

The frontend builds only two electron entries: `main` (→ `dist-electron/main.js`) and `preload` (→ `dist-electron/preload.mjs`, CJS). The five service bundles are built by the **services workspace** (`npm run build --workspace services` → `services/dist/<name>/index.js`, ESM).

- `vite-plugin-electron` launches Electron from **whichever entry's `onstart` runs LAST**. Both entries route through the guarded `startOrReload` helper.
- **Never make an entry's `onstart` a no-op** — the app may then never open.
- `main.ts` resolves the children as `path.join(SERVICES_DIST, '<name>', 'index.js')`, where `SERVICES_DIST` is `../../services/dist` in dev and `resources/services` when packaged. Changing either output layout silently breaks service spawning.
- `services/scripts/build.mjs` writes `services/dist/package.json` (`{"type":"module"}`) so the bundles stay ESM after `extraResources` copies them out of the workspace.

**Dev restarts (`electron/dev-watch.ts`).** The services are rebuilt by their own watch process, but `vite-plugin-electron`'s `reload()` only refreshes the *renderer*, so the Electron main process and its service children would otherwise keep running the previous code — a stale main process could even keep an old behaviour alive for a whole session. In dev (`VITE_DEV_SERVER_URL` set) main watches the build outputs and closes the loop:

| Rebuilt artifact | Reaction |
| --- | --- |
| `services/dist/<service>/index.js` | that child process is killed and respawned (waiting for the old pid to exit, so it never races for the port) |
| `dist-electron/main.js` | the app relaunches (`app.relaunch()` + `app.quit()`), which stops the services through `will-quit` |
| `preload.mjs` / anything else | ignored — the plugin's renderer reload already covers it |

Bursts are debounced (300 ms). The root `npm run dev` starts the services in watch mode alongside the frontend. The watcher is pure and its behaviour is unit-tested (`frontend/test/dev-watch.test.ts`).

### 5.3 The five local services

All five are plain Node (`http` module, no framework) and **extend `BaseMediaService`**
(`services/shared/service-http.ts`), which owns the server, routing, SSE fan-out, graceful shutdown, process
fault tolerance and the suspend/resume state machine. A service only implements `getState()`,
`createRoutes()` and the `onStart` / `onStop` / `onSuspend` / `onResume` hooks.

Electron main spawns them via
`spawn(process.execPath, [entry], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'ignore' })`;
the renderer reaches them through `window.<name>.getEndpoint()` + `src/services/<name>.ts`.

| Service | Dir | Port (env) | External deps | Notes |
| --- | --- | --- | --- | --- |
| Jukebox | `services/jukebox-service/` | 4100 (`JUKEBOX_PORT`) | **mpv** via `node-mpv` | scan: `fast-glob` + `music-metadata` + `p-limit` |
| Bluetooth | `services/bluetooth-service/` | 4200 (`BLUETOOTH_PORT`) | BlueZ ≥ 5.79 `--experimental` + `obexd` | `dbus-next`; discovery + pairing agent + A2DP/AVRCP, audio is system-side |
| CD | `services/cd-service/` | 4300 (`CD_PORT`) | **mpv** (`cdda://`, libcdio-paranoia); udisks2 for data discs | drive detection is udev-event driven |
| Settings | `services/settings-service/` | 4400 (`SETTINGS_PORT`) | none | schema registry + JSON store only; owns no hardware, so it is always safe to suspend |
| Trip | `services/trip-service/` | 4500 (`TRIP_PORT`) | none (SQLite via the **`node:sqlite` builtin**) | trip segmentation, fuel/cost, trajectory decimation; the only service with a persistent database. No CAN or GPS adapter exists yet — samples arrive through ports, and a dev-only simulator feeds them |

**Identical endpoints on every service** (provided by the base class):

| Path | Notes |
| --- | --- |
| `GET /api/health` | `{ ok, service, phase, suspended, uptimeSeconds, clients, ...healthDetails() }` |
| `GET /api/state` | service state; also the SSE initial frame |
| `GET /api/events` | SSE stream of state frames |
| `GET` / `POST /api/settings` | `{ autoSuspend?, idleTimeoutMs?, suspended? }` — **process lifecycle only** |

**Service-specific routes** (`createRoutes()`):

| Path | Jukebox | Bluetooth | CD | Settings |
| --- | --- | --- | --- | --- |
| `POST /api/playback` | ✓ `play`/`pause`/`toggle`/`next`/`previous`/`stop` | ✓ same set | ✓ same set | — |
| `POST /api/volume` | ✓ (`{volume: 0..100}`) | ✓ | ✓ | — |
| `POST /api/seek` | ✓ | — | ✓ | — |
| `POST /api/track` | ✓ (0-based) | — | ✓ (**1-based**) | — |
| `GET /api/library`, `POST /api/scan`, `POST /api/play` | ✓ (`{albumId, paused?}` — `paused` loads without playing) | — | — | — |
| `POST /api/scan` | — | ✓ (`start`/`stop`/`refresh` — inquiry + discoverability) | — | — |
| `POST /api/phone` | — | ✓ (`connect`/`disconnect`/`forget`/`trust`/`untrust`) | — | — |
| `POST /api/pairing` | — | ✓ (`pair`/`confirm`/`reject`/`cancel`/`submit`) | — | — |
| `POST /api/calls` | — | ✓ reserved — answers **501** until an HFP backend exists | — | — |
| `GET /api/artwork/:id` | ✓ `:albumId` | ✓ `:name.jpg` | — | — |
| `GET /api/categories` | — | — | — | ✓ schema only (no values) |
| `GET /api/values` | — | — | — | ✓ every category's values |
| `GET /api/values/:categoryId` | — | — | — | ✓ unknown id → 404 |
| `PATCH /api/values/:categoryId` | — | — | — | ✓ partial merge, returns the full normalised set |
| `POST /api/values/:categoryId/reset` | — | — | — | ✓ back to schema defaults |

**Trip-specific routes** (`services/trip-service/routes.ts`):

| Path | Notes |
| --- | --- |
| `GET /api/periods` | Period presets with their resolved `from`/`to` and labels |
| `GET /api/summary` | The four Trip Computer cards, each `{ value, unit, formatted, trend }` |
| `GET /api/series` | Graph buckets at a granularity the service picks for the window |
| `GET /api/trips`, `GET /api/trips/:id`, `GET /api/trips/:id/coordinates` | List, detail + stats, and the decimated map payload |
| `POST /api/trips/merge` | Adjacent trips only — a non-adjacent pair is a 400 with the reason |
| `POST /api/trips/:id/split` | That stage and later ones move to a new trip; both totals are recomputed |
| `GET`/`POST /api/fuel/events`, `GET /api/fuel/prices` | Detected refuels, price confirmation, price history |
| `GET /api/status` | Ingest liveness: last sample, counters, active trip/stage, simulation flag |
| `POST /api/dev/simulation` | **dev only** (`TRIP_DEV`/`TRIP_DEV_SIMULATE`) — `start`/`stop`/`seed`; 404 otherwise |

**The Settings service deliberately does not overload `/api/settings`.** That route is taken by the base
class for process lifecycle; user-facing settings live under `/api/values/*`, which is what keeps the two
concerns from colliding. Its `PATCH` auto-resumes a suspended service like any other mutating request.

Handlers validate by **throwing `HttpError`** (400/404/405/…); the base router renders it, so no handler
writes an error body itself. Unknown route → 404, wrong method → 405, invalid JSON body → 400.

**Suspend / resume (RAM snapshots).** `phase` is the state machine:
`starting → running ⇄ suspended → stopping → stopped`.

| | `onSuspend()` | `onResume()` |
| --- | --- | --- |
| Jukebox | snapshot `{albumId, trackIndex, positionSeconds, wasPlaying}`, kill mpv | relaunch mpv, reload album, `jump` + `seek`, and **stay paused** |
| Bluetooth | stop the inquiry + AVRCP **pause** + stop the position tick; **BlueZ, the device list and the pairing agent stay live** (pairing and future calls) | restart the tick, AVRCP play if it was playing |
| CD | snapshot `{discId, trackIndex, positionSeconds, wasPlaying}`, kill mpv | re-identify the physical disc: same id → reload + seek back; different or empty → reset and load what is there now |
| Trip | stop ingestion (sources + dev simulator) only; the SQLite handle and the **open trip stay open** | restart ingestion; the same stage continues instead of a new trip starting |

- Auto-suspend fires after `idleTimeoutMs` only when **no SSE client is attached and `isBusy()` is false**
  (playing audio blocks it).
- `GET /api/health` and `/api/state` are **not** activity and never wake a service — the renderer polls
  health every 5 s, so counting it would keep everything awake forever.
- Any **mutating** request auto-resumes first: a "play" press on a sleeping source just works. A new SSE
  subscriber does *not* wake the service — it only cancels the idle timer while it stays attached.
- `POST /api/settings {suspended: true|false}` forces the transition (tests and manual control rely on it).
- All timers are `unref()`ed; a suspended service holds a handful of numbers, no audio buffers.
- **A Jukebox restore never auto-plays.** Coming back to the source puts the album, track and position back but holds playback; `wasPlaying` is recorded in the snapshot and deliberately *not* acted on (the listener presses play). mpv is launched with `--pause=yes` and is paused before the playlist loads, so no audio bleeds out. Do not "fix" this by resuming playback.
- `started` from mpv means *the file was loaded*, not that playback began — a held load fires it too. `JukeboxPlayer` therefore reads mpv's `pause` property instead of assuming playback, otherwise the UI reports "playing" for held audio.

**CD specifics:** drive detection is event-driven — `udevadm monitor --subsystem-match=block --udev` is
spawned and its stdout parsed for `add`/`remove`/`change` on `/dev/srN`, debounced 250 ms, then re-probed
from `/proc/sys/dev/cdrom/info` + `/sys/block/srN` + the udev database. If `udevadm` is missing the monitor
degrades to a 30 s poll instead of going blind. There is **no mpv health-watchdog timer**: crashes arrive
as mpv's `crashed` event and `onActivity()` re-checks liveness on demand.

**Jukebox artifacts:** library cache `$JUKEBOX_MUSIC_ROOT/library.json`, extracted covers
`$JUKEBOX_MUSIC_ROOT/.jukebox/artwork`. Discs autoplay on insertion; no disc → graceful "No disc"
placeholder and controls that are no-ops.

### 5.4 Renderer structure

- **Provider stack** (`src/main.tsx`, inside `React.StrictMode`): `I18nProvider > BluetoothProvider > JukeboxProvider > CdProvider > SettingsProvider > App`.
- **Views** (`src/App.tsx`): `home` → `HomeView`, `phone` → `PhoneView`, `media` → `MediaView`, `settings` → `SettingsView`, `trip-computer` → `TripComputerView`, `trip-history` → `TripHistoryView`. `NAV_ORDER` in `src/constants/navigation.ts` is the rotary/scroll order and deliberately stays three items: `settings` and both trip apps are full-screen views opened from a Home tile (`fuel`, `nav-history`, `settings`).
- **`#/debug`**: if `window.location.hash` starts with `#/debug`, `App` renders `DebugPanel` instead of the shell. The debug window uses this; the main window can too.
- **Phone view** (`src/components/views/PhoneView.tsx` + `src/components/phone/`): two states switched on "is a phone connected". With none it renders the connect screen (hero render + `DeviceListCard`, driven by `useBluetooth().scan/phoneAction`); with one it renders `ConnectedPhoneScreen` (connection summary + placeholder cards for contacts/messages/calls). `primary` decides who is connected. `useScanWindow` starts the inquiry while the screen is up and stops it on unmount; the pairing prompt is `PairingModal`, shown whenever `state.pairing.stage === "awaiting-confirmation"`.
- **Media view** (`src/components/media-view/MusicApp.tsx`): branches per `sourceFeed.selectedSourceId`. Jukebox has a two-mode flow (`library` CoverFlow ↔ `player` + queue drawer); `JukeboxProvider` keeps the selected mode in RAM across screen and source changes. The queue drawer remains local. Other sources render a single player.
- **The player view needs an album.** `inPlayer` requires `state.albumId`, so a jukebox that lost its state falls back to the library instead of rendering an empty player (no track/album/artist). `useJukebox` also keeps a recovery memory (`src/lib/lastPlayback.ts`, pure + unit-tested): returning to the Jukebox source with nothing loaded reloads the last album/track **paused** (same rule as a snapshot restore: it never starts audio). An explicit `stop()` clears that memory — that is the only case where the album must *not* come back.
- **Hooks** (`src/hooks/`): `useJukebox` / `useBluetooth` / `useCd` / `useSettings` / `useTripComputer` / `useTripHistory` (service-or-mock state), `useNowPlaying` (home hub), `useMediaSourceAdapters`, `useEntertainmentVolume`, `useRotaryNavigation`, `useCoverFlowNavigation`, `useSettingsNavigation`.
- **Bluetooth state is device-centric.** `state.devices` is the phone list and `state.media` is the *active* phone's media — the media view reads `state.media`, not a flat top-level player. See `docs/bluetooth.md`.
- **Transport layer** (`src/services/{jukebox,bluetooth,cd,settings,trip,health}.ts`): thin `fetch` + `EventSource` wrappers; endpoint resolution falls back to the hard-coded default URL when the preload bridge is absent (`VITE_BLUETOOTH_BASE_URL` overrides it for browser dev).
- **Mock fallback:** each data hook probes `/api/health`; when the service is unreachable it switches to `src/data/*.mock.ts` (`mode: "service" | "mock" | "loading"`). Bluetooth/CD/settings/trip re-probe every 5 s; jukebox decides once on mount. This is what keeps a plain browser (`npm run dev`, no Electron) usable.

### 5.4.1 Settings app (the adaptive-layout deep module)

Two rules make "add a setting" a backend-only change; break either and the module loses its point.

1. **The renderer must never name a category, a field, a label or a control kind.** `SettingsView` hands
   the schema from `useSettings` to `planCategories` (`src/lib/settings-layout.ts`, pure and unit-tested)
   and renders the result. `planCategories` is the *only* place that resolves `showWhen` visibility,
   drops empty groups, orders the category list, resolves select-option labels and resolves i18n keys
   (with an id fallback: `…balance.label` → `balance`, `…demoTheme.dark` → `dark`).
2. **One `CategoryDef` per macrocategory**, in `services/settings-service/categories/*.ts`. Adding a setting means
   editing that one file plus the two locale files. `registry.ts` rejects a `showWhen` that points at
   another category, which is how cross-category coupling is stopped mechanically rather than by review.

- **One header, not per-category.** The left column prints the section title (`settings.title`) and then
  the categories as **plain text lines** — no icons, no pill, no container. The selected line is the
  only amber item. The center column prints **no heading at all**, so switching category never swaps a
  title. `CategoryDef.icon`/`titleKey` still travel in the schema but are not rendered; a test pins the
  rail entry's exact key set so an icon cannot creep back in.
- **Left column sizing.** Header `text-3xl`, category lines `text-2xl` (matches the reference: 24px
  against a measured 144px-wide "Connettività" on the 1920px stage), rail `w-[240px]`, labels
  `whitespace-nowrap`. The nav is `h-full` and `justify-around` inside a `flex-1` list so the categories
  spread over the available height. A longer label must not wrap — widen the rail instead.
- **Right column:** a fixed `420×420` box containing the literal text `PLACEHOLDER`
  (`src/components/settings/CategoryArtworkSlot.tsx`). No placeholder artwork is generated or committed —
  the box only reserves the size of the future per-category asset so nothing reflows later. Do not point
  it at `modus_wireframe.png`.
- **Controls:** one dumb component per `kind` in `src/components/settings/fields.tsx`; `FieldRenderer`
  maps `kind` → component and renders a disabled row for an unknown kind. `ui/switch.tsx` (toggle) and
  `ui/segmented.tsx` (select) are the primitives; `ui/slider.tsx` is reused.
- **Wiring:** the Home tile (`DEFAULT_APPS` → `settings`) switches the view; `NAV_ORDER` deliberately stays
  three items. `SETTINGS_PORT` / `SETTINGS_STORE_PATH` are forwarded when main spawns the service.
- **Input:** the Settings view uses `useSettingsNavigation`, **not** `useRotaryNavigation`. The shared hook
  maps every arrow key to focus movement, which would fight a slider; the settings hook steps
  `slider`/`stepper` rows and moves focus everywhere else. Do not "unify" them without solving that.

### 5.5 Media sources are pluggable

1. Source ids are declared in `DEFAULT_SOURCES` (`src/data/media.ts`) — currently `bluetooth`, `cd`, `fm`, `jukebox`.
2. A source becomes real by adding an entry to `SOURCE_ADAPTER_FACTORIES` in **`src/hooks/useMediaSourceAdapters.ts`** implementing `MediaSourceAdapter` (`src/types/media.ts`).
3. The home now-playing player and every other consumer pick it up automatically; unknown ids fall back to `EMPTY_ADAPTER`.
   `fm` is the remaining placeholder (no adapter, no audio backend).

### 5.6 Entertainment volume & input

- **Volume:** `EntertainmentVolumeController` in `electron/entertainment-audio.ts` is the single source of truth: range **0–30**, default **25**, default source **`bluetooth`**. It maps to `round(volume / 30 × 100)` percent and POSTs it to the **active source's** `/api/volume` only (`jukebox`, `bluetooth`, `cd` are wired; `fm` uses `NoopVolumeBackend`).
- **Never touch system/master volume** — unrelated alerts (parking sensors, navigation) must keep independent levels.
- **Source switching** (`entertainment:set-source` in `main.ts`) delegates to `EntertainmentVolumeController`, which serializes source transitions and volume requests. It suspends the outgoing service and resumes the incoming service via `POST /api/settings`, preserving RAM snapshots and keeping service processes (including Bluetooth/BlueZ) alive. Explicit playback `stop` remains destructive.
- **A switch always commits.** Suspending the outgoing source is best effort (one attempt, errors logged); waking the incoming one is retried (4 × 250 ms) because a freshly spawned service may still be binding its port. A failure never rolls the source back: main and the renderer must agree on the active source, and a sleeping service is woken by its next mutating request. Never reintroduce a `playback: stop` on source change — that is what wiped the jukebox state (blank player) before.
- **Rotary/keyboard input:** `useRotaryNavigation` (wheel + arrows + Enter/Space + middle-click) is attached per view. In `MediaView` it is **disabled while the jukebox source is selected** because the CoverFlow owns wheel/keys.
- **i18n:** `src/i18n/locales/en.ts` exports the `Messages` type; `it.ts` is typed against it, and `TranslationKey` is derived. Adding a key to `en.ts` without `it.ts` is a **type error** (`npm run build` catches it). Use `t("...")` from `useI18n()`.

### 5.7 Tests (`npm test`)

Native `node:test` — no jest/vitest, no new dependency. The script is
`node --import tsx --test test/*.test.ts` per workspace (tsx is already a devDependency; it resolves the
`.js` ESM specifiers used across the services to their `.ts` sources). Service suites live in
`services/test/`, renderer/electron suites in `frontend/test/`; the root `npm test` runs both.

| File | Covers |
| --- | --- |
| `services/test/fake-mpv.ts` | `FakeMpv implements MpvLike`: records commands (`callsTo("seek")`, `lastCall("jump")`), mirrors mpv's `paused`/`resumed`/`stopped` events, stores properties |
| `services/test/support.ts` | `apiGet` / `apiPost`, `sleep`, `waitFor` |
| `services/test/base-media-service.test.ts` | shared routing, 404/405, `HttpError` mapping, settings validation, SSE frames, suspend/resume, idle auto-suspend, `stop()` releasing the port |
| `services/test/jukebox-suspend-resume.test.ts` | **the reference example**: mocking mpv + player-level snapshot/restore, then the same flow through `POST /api/settings` |
| `services/test/cd-suspend-resume.test.ts` | disc-id verification (same disc restores, swapped disc resets, empty drive resets) via a `ScriptedDriveMonitor` |
| `frontend/test/last-playback.test.ts` | the renderer recovery memory: a state without an album must not erase it, position ticks must not re-allocate it |
| `frontend/test/dev-watch.test.ts` | the dev restart watcher: bursts coalesce into one restart, filters and dispose are honoured, a failing watch does not drop the others |
| `services/test/fake-bluez.ts` | `FakeBluez` / `FakeAgent`: structural doubles for `BlueZClient`/`PairingAgent` — record calls, drive `changed`/`device-connected`, raise agent prompts |
| `services/test/bluetooth-devices.test.ts` | Class-of-Device classification, the phone-candidate filter (paired always listed, CoD/UUID rules, `showAll` escape hatch, blocked devices), capabilities, adapter snapshot |
| `services/test/bluetooth-phone.test.ts` | `PhoneManager`: state mapping, media follows the primary phone, scan/phone/pairing actions, "last connected wins" (the previous phone is disconnected), pairing failure → error mapping, reserved calls answering 501 |
| `frontend/test/settings-layout.test.ts` | the pure planner: rail order + active fallback, `showWhen` semantics, hidden/empty groups, i18n key fallback, input immutability, and the adaptation proof (a synthetic category renders completely with no `.tsx` change) |
| `services/test/settings-service.test.ts` | registry rejection (duplicates, bad ranges, **cross-category `showWhen`**), the full PATCH validation matrix, partial merge, hidden-but-writable, reset, restart persistence, auto-resume on PATCH, the injected sixth fixture category |
| `services/test/settings-store.test.ts` | round-trip, per-category corruption isolation, malformed file → all defaults, removed-field drop, re-normalisation on load, atomic write (no `*.tmp`), serialised concurrent writes |
| `services/test/settings-fixture.ts` / `settings-support.ts` | the tests-only `test-fixture` category and the `apiPatch` + start/stop harness — never imported by production code |
| `services/test/jukebox-harness.ts` | shared jukebox fixture (`withJukeboxService`, `makeLibrary`) used by the service suite and the frontend entertainment-volume suite |
| `frontend/test/entertainment-volume.test.ts` | the Electron `EntertainmentVolumeController` driving a real jukebox service through source switches, suspend and resume |
| `services/test/trip-arithmetic.test.ts` | litres from a tank or a flow, odometer resets, cost attribution, `--` rendering |
| `services/test/trip-buckets.test.ts` | window/preset resolution, the comparison window being adjacent and equal, bucket boundaries, trend comparability |
| `services/test/trip-trajectory.test.ts` | decimation (including a parked car with a live receiver), RDP, bounds, projection degeneracies |
| `services/test/trip-engine.test.ts` | the segmentation state machine: idling, short stops, 4 h away → two legs, 4 h at home → two trips, > 18 h, odometer resets, refuel detection, power-loss recovery, no GPS |
| `services/test/trip-store.test.ts` | `node:sqlite` migrations, cascade deletes, atomic recompute, parity after merge/split, restart persistence |
| `services/test/trip-service.test.ts` | every trip route over HTTP, validation, merge/split refusals, refuel pricing, suspend/resume, dev-endpoint gating |
| `services/test/settings-trip-category.test.ts` | pins the `trip` settings **field ids**, which the trip service reads by name over HTTP |
| `frontend/test/trip-view.test.ts` | the renderer's own logic: wording a delta, arrow decisions, date/duration formatting |
| `frontend/test/trip-service-integration.test.ts` | the renderer's real client against a real trip service: cards, graph, road-trip legs, map payload, merge/split |

Services take injected collaborators, so no hardware is needed: `createMpv`, `drive`, `identifyDisc`,
`settings`, `installProcessHandlers: false`, `logger: createSilentLogger()`. Tests bind port `0`
(ephemeral), never a fixed port.

---

## 6. Environment variables

| Variable | Default | Used by |
| --- | --- | --- |
| `JUKEBOX_PORT` | `4100` | `electron/main.ts`, `services/jukebox-service/config.ts` |
| `JUKEBOX_MUSIC_ROOT` | `~/Music` | library root (+ `library.json`, `.jukebox/artwork`) |
| `JUKEBOX_MPV_BINARY` | `which mpv` → `/usr/bin/mpv` | jukebox playback |
| `BLUETOOTH_PORT` | `4200` | `electron/main.ts`, `services/bluetooth-service/config.ts` |
| `BLUETOOTH_ARTWORK_DIR` | `$TMPDIR/renault-mmi-artwork` | AVRCP/BIP cover-art cache |
| `BLUETOOTH_SHOW_ALL_DEVICES` | unset | `1` = list computers/headsets too (phone hiding its class) |
| `VITE_BLUETOOTH_BASE_URL` | unset | renderer only: point browser dev at another bluetooth service or a fake |
| `CD_PORT` | `4300` | `electron/main.ts`, `services/cd-service/config.ts` |
| `CD_DEVICE` | auto-detect `/dev/sr*` | accepts `sr0` or `/dev/sr0` |
| `CD_MPV_BINARY` | `which mpv` → `/usr/bin/mpv` | CD playback |
| `SETTINGS_PORT` | `4400` | `electron/main.ts`, `services/settings-service/config.ts` |
| `SETTINGS_STORE_PATH` | `~/.config/renault-mmi/settings.json` | settings persistence (tests always pass a temp path) |
| `TRIP_PORT` | `4500` | `electron/main.ts`, `services/trip-service/config.ts` |
| `TRIP_DB_PATH` | `~/.config/renault-mmi/trips.db` | trip database (SQLite, WAL) |
| `TRIP_DEV` | unset | trip service: `1` mounts `POST /api/dev/simulation` |
| `TRIP_DEV_SIMULATE` | unset | trip service: `1` attaches the drive simulator as well |
| `SETTINGS_BASE_URL` | unset | trip service: where to read preferences; unset runs on defaults + its cached snapshot |
| `TRIP_DEFAULT_FUEL_PRICE` | `1.85` | trip service: price the dev seed uses on the refuels it generates |
| `SERVICE_AUTO_SUSPEND` | `1` (on) | every service: `0` disables idle auto-suspend |
| `SERVICE_IDLE_TIMEOUT_MS` | `60000` | every service: idle window before auto-suspend (`0` = never) |
| `VITE_DEV_SERVER_URL` | unset in build | set by vite-plugin-electron in dev |

---

## 7. Gotchas checklist

- **Unused code fails the build.** `noUnusedLocals`/`noUnusedParameters` + `--max-warnings 0`. Keep imports and params clean.
- **Don't break the electron entry `onstart`** (§5.2) — symptom is "dev server runs but no window opens".
- **Jukebox and CD need `mpv` on PATH**; audio CDs additionally need libcdio-paranoia. Bluetooth cover art needs BlueZ ≥ 5.79 with `bluetoothd --experimental` (adds MediaPlayer1 `ObexPort`) **and** a running `obexd`; otherwise the service stays idle and the UI shows placeholder art. Many Android phones need AVRCP 1.6 enabled in Developer Options; iOS 13+ works out of the box.
- **`electron-builder.json5` is a placeholder** (`YourAppID` / `YourAppName`) and `npm run build` invokes electron-builder — update it before packaging for real.
- **No `tailwind.config.js`** — Tailwind v4 is configured CSS-first; theme tokens live in `src/styles/*.css` and `src/index.css`. `components.json` marks shadcn "new-york", icons lucide, alias `@/components/ui`.
- **Design system:** see `DESIGN.md` (repo root — *not* `frontend/`): Chakra Petch typeface (loaded via Google Fonts in `index.html`), amber-950 background / amber-500 accent (`warm-*` tokens are used throughout components), no horizontal overflow, rotary + keyboard + touch input. `src/references/*.png` are design reference screenshots.
- **Never track SSE clients with `req.on("close")`.** In modern Node that fires as soon as the *request*
  stream is drained (immediately, for a bodyless GET). The SSE hub listens on the **response** `close`
  instead; changing it back silently drops every subscriber.
- **`services/shared/service-http.ts` is load-bearing for all five services.** Route handlers `throw` instead of
  writing responses; changing `dispatch` changes every endpoint contract at once. `services/test/base-media-service.test.ts`
  is the safety net. Its `CORS_HEADERS` allow-list must keep including `PATCH`: it is not a CORS-simple
  method, so in `npm run dev` (renderer on Vite `:5173`, service on `:4xxx`) every settings write is
  preflighted, and a missing entry fails there while direct-`fetch` tests still pass.
- **The Settings renderer must not learn any settings names.** No category id, field id, label or control
  kind may appear in `src/components/**`; the schema drives everything through `planCategories`, which is
  also the only place `showWhen` and i18n fallback are resolved (`frontend/test/settings-layout.test.ts` guards it).
  Adding a setting is one file in `services/settings-service/categories/` plus the two locale files — if a change
  needs a `.tsx` edit, the schema is being bypassed.
- **Service handlers must stay injectable.** `createMpv` / `drive` / `identifyDisc` exist so the suite runs
  without mpv, udev or a CD drive. Add new hardware touchpoints the same way rather than importing a
  spawn at the call site. The bluetooth side does this with ports (`services/bluetooth-service/ports.ts`), an
  injected `bluez`/`agent`, and a bus factory for `ArtworkService` (`() => null` in tests) — a real
  session bus there would keep the event loop alive and hang `npm test`.
- **Docs drift:** `docs/music.md` still claims Bluetooth and CD are unimplemented — both now have real services. Verify against code, not that doc.
- **Build outputs are separate.** `dist-electron/` holds the Electron main/preload bundles; `services/dist/` holds the service bundles (packaged to `resources/services`). A running dev app after a service change needs the service bundle rebuilt — the root `npm run dev` watch handles this automatically; running only `npm run dev --workspace frontend` does not.
- **`electron` is resolved explicitly in `frontend/vite.config.ts`.** npm workspaces hoist `vite-plugin-electron` to the repo root while `electron` stays in `frontend/node_modules`, so the plugin's own `startup()` fails with `ERR_MODULE_NOT_FOUND`. `startOrReload` resolves the package with `createRequire(<frontend>/package.json)` and hands the absolute entry to `startup()`; keep it that way instead of calling the plugin's bare `reload()` on first launch.
- **`x11` is aliased in the services build.** `dbus-next` does an unconditional `require('x11')` for the *session* bus path; the package is not installed and a bundler hoists it to a top-level ESM import, so the bluetooth service dies at load with `Cannot find package 'x11'`. `services/scripts/build.mjs` aliases it to `services/scripts/x11-stub.mjs` (default `null`), which restores dbus-next's intended fallback. Removing the alias re-breaks bluetooth startup.
- **A service is not wired by `frontend/vite.config.ts`.** Adding/renaming one means editing `services/scripts/build.mjs`, `frontend/electron/main.ts` (`SERVICES_DIST` child paths + dev-watch target), `preload.ts` and `src/services/*`.
- **The trip service has no telemetry adapter, on purpose.** `VehiclePayloadState` carries **no odometer, no fuel level and no flow rate** — only speed, RPM, gear, brake, climate, light, door and seatbelt flags. The trip domain is therefore written against an assumed odometer behind `TelemetrySource`, and a **dev-only** simulator is the only implementation. Do not "fix" this by reading the UDP frames: there is nothing in them to read. The same applies to GPS — `LocationSource` has no implementation, while the trajectory pipeline that consumes it is complete and tested.
- **The trip database directory is created by `TripStore`, not by `node:sqlite`.** `node:sqlite` creates the *file* but not the directory holding it, and the default location is `~/.config/renault-mmi/trips.db`. Without the explicit `mkdirSync` the service dies at boot with `unable to open database file` — and because Electron spawns services with `stdio: 'ignore'`, it dies **silently**: the four other services come up and only `:4500` is missing. Keep the `mkdirSync` in the `TripStore` constructor.
- **Services are spawned through `spawnService`, which waits out a dev build.** `app.whenReady()` runs while the services watch is still writing bundles, so an entry can be missing (or briefly absent while its output directory is emptied and rewritten). A child spawned against a missing `index.js` exits at once, and with `stdio: 'ignore'` nothing is printed — the only symptom is that one port never opens. Do not replace `spawnService` with a bare `spawn`.
- **`isDev` in `electron/main.ts` is declared with the other constants, above `startTripService`.** A `const` read from a function that runs during `app.whenReady()` is in its temporal dead zone if it is declared further down the file, so the spawn throws and is skipped — again silently.
- **`node:sqlite`, not `better-sqlite3`.** It is a Node builtin and was verified working in both the system Node and the Node Electron exposes to spawned children (`ELECTRON_RUN_AS_NODE=1`). A native module here would need externalising in `build.mjs` and shipping prebuilt per target. `services/test/trip-service.test.ts` and `trip-store.test.ts` are the safety net.
- **Trip money is derived at read time, never stored per trip.** A litre costs whatever price was in force when it burned, so a corrected price re-costs history. Storing a per-trip cost would leave stale totals behind after a price correction, which is why there is no `fuel_cost` column on `trip_stages`.
- **A trip only ends on the next ignition.** A car parked for the night keeps an open trip until it drives again (appending a leg) or the service restarts and boot recovery closes it. Do not "simplify" this by finalizing on the dwell timeout — that is exactly what turns a road trip into two trips.
- **`EventSource` is not a global in the service runtime.** Not in Node, and not in the Node Electron runs for spawned children. The trip service polls the settings service instead; do not reach for a stream there without checking `typeof EventSource` first.
- **Custom opencode agents** live in `.opencode/agents/`: `infotainment-ux-architect` (UI components), `react-architect` (refactors), `electron-react-auditor` (review), `test-suite-architect` (tests, see §5.7).

---

## 8. Where to make common changes

| Change | Touch these |
| --- | --- |
| Add/modify a UI screen | `src/components/views/*` + `src/App.tsx` switch + `NAV_ORDER` |
| Add a full-screen app reachable from a Home tile | a `NavId` in `src/types/navigation.ts`, a target in the `targets` map in `src/App.tsx`, and the view component — leave `NAV_ORDER` alone |
| Change trip segmentation / fuel / cost | `services/trip-service/trip/*.ts` (pure) + `engine.ts` for the state machine; keep the arithmetic out of `routes.ts` |
| Add a trip metric or graph series | `services/trip-service/query.ts` + `types.ts`, then render it — the renderer must not aggregate |
| Change how a drive is simulated | `services/trip-service/telemetry/simulator.ts` (deterministic; no `Math.random`, no wall clock inside the generator) |
| Add a media source | `src/data/media.ts` → `SOURCE_ADAPTER_FACTORIES` (§5.5); a service module if it needs a backend |
| Add a service | new `services/*-service/` class extending `BaseMediaService` + `createRoutes()` + entry in `services/scripts/build.mjs` + spawn/stop and dev-watch in `frontend/electron/main.ts` + preload global + `src/services/*` |
| Add an endpoint | a handler in that service's `createRoutes()`; `throw new HttpError(...)` for errors, `sendJson(res, …)` for success |
| Change bluetooth discovery/pairing | `services/bluetooth-service/pairing.ts` / `phone.ts` (policy) — keep `bluez.ts` the only D-Bus file |
| Add phone-call support | implement `CallBackend` (`services/bluetooth-service/calls.ts`) and hand it to `CallManager`; state, routes and the UI already reserve the shape |
| Change suspend/resume | the service's `onSuspend`/`onResume` + its player snapshot type; keep the base state machine untouched |
| Add a string | `src/i18n/locales/en.ts` **and** `it.ts` |
| Add vehicle telemetry to the UI | build on `electron/udp-probe.ts` (main-process decode → IPC) — the renderer has no CAN knowledge today |
| Add a CAN signal | regenerate from `can-decoder/grand_modus.dbc`; never edit generated C |

---

## 9. Reference docs

| File | Contents |
| --- | --- |
| `README.md` | project overview / requirements |
| `DESIGN.md` | typography, amber palette, layout rules |
| `REQUIRMENTS.MD`, `USEFUL_SOURCE.MD` | original requirements and references |
| `docs/can-decoder.md` | CAN decoder pipeline and threading detail |
| `docs/music.md` | media view design (**stale** on source status) |
| `docs/bluetooth.md` | bluetooth state model, pairing flow, AVRCP/BIP cover art, BlueZ setup |
| `.dsh/specs/trip-service/spec.md` | trip backend: ports, segmentation, costing, windows, API, schema, env |
| `.dsh/specs/trip-computer/spec.md` / `.dsh/specs/trip-history/spec.md` | the two trip apps |

When you change architecture, ports, env vars, or an invariant above, update this file in the same change.
