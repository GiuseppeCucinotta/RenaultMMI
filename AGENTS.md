# RenaultMMI — Agent Guide

Two codebases in one repo: a **C telemetry daemon** (`backend/`) and an **Electron + React infotainment UI** (`frontend/`).
Target hardware: Raspberry Pi 5 driving a Waveshare 8.8" **1920×480 portrait** display.

> **How to use this file:** skim §1–§3 for orientation, then jump to the section for the code you touch.
> Deep dives live in `docs/` — see §9.

---

## 1. Quick reference

| Goal | Command |
| --- | --- |
| Build backend | `cd backend && make` |
| Run backend | `cd backend && ./backend` (needs `vcan0`, see §4) |
| Dev app (renderer + Electron + all 3 services) | `cd frontend && npm i && npm run dev` |
| Typecheck + bundle + package | `cd frontend && npm run build` |
| Lint | `cd frontend && npm run lint` |
| Run tests | `cd frontend && npm test` (native `node:test`, ~1s) |
| Run a TS script | `cd frontend && npm run tsx -- <file>` |
| Debug a service standalone | `npm run bluetooth:debug` / `npm run cd:debug` (jukebox has no script) |

**Definition of done for `frontend/` changes:** `npm test`, `npm run lint` *and* `npm run build` all pass.
`npm run build` runs `tsc` first with `strict` + `noUnusedLocals` + `noUnusedParameters`; lint is `--max-warnings 0`.

**Tests:** `frontend/test/*.test.ts` on the native `node:test` runner (see §5.7). The backend has no tests at all.

---

## 2. Repo map

```
backend/                    C daemon — CAN bus in, UDP out (see §4)
frontend/
  electron/                 Electron main process
    main.ts                 windows + ALL IPC handlers + service lifecycle
    preload.ts              contextBridge surface exposed to the renderer
    entertainment-audio.ts  EntertainmentVolumeController (0–30)
    udp-probe.ts            the only UDP listener (debug window only)
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
  shared/                   imported by services + (types) the renderer
    service-http.ts         HTTP helpers, SSE hub + **BaseMediaService**
    logger.ts               createLogger(scope) — the one service logger
    mpv.ts                  MpvLike / MpvFactory — the injectable mpv contract
    jukebox-types.ts        library/playback types
    system-info.ts          SystemInfo type (debug panel)
  test/                     node:test suites + FakeMpv double (see §5.7)
  src/                      React renderer
    main.tsx                renders provider stack → <App/>
    App.tsx                 view switch + #/debug branch + hash routing
    components/
      home/ media-view/ views/ Navbar.tsx Background.tsx VolumeIndicator.tsx
      debug/                DebugPanel + Resources/Udp/Volume/Language/MediaFeed/About
      ui/                   shadcn primitives (button, card, slider, tabs)
    context/                provider + context pairs: jukebox, bluetooth, cd
    hooks/                  use* data + input hooks (see §5.4)
    services/               HTTP/SSE clients for the three local services
    data/                   static defaults + *.mock.ts browser fallbacks
    types/  constants/  lib/  styles/  i18n/  assets/  references/
  vite.config.ts            electron entries + alias + plugins
  tsconfig.json             strict, paths, include list
```

**Import alias:** `@/* → src/*`. Declared in **both** `tsconfig.json` and `vite.config.ts` — keep them in sync.
**tsconfig includes:** `src`, `electron`, `jukebox-service`, `bluetooth-service`, `cd-service`, `shared`, `test`.
**Gitignored:** `build/`, `compile_commands.json`, `.cache/`, `dist-electron/`, `release/`, `node_modules/`, `dist/`.

---

## 3. Architecture

```
┌──────────────────────────────────────────────────────────┐
│ backend/ (C11, pthreads, raw CAN socket) on vcan0         │
│ receiver → ring_buf(4096) → decoder(x4) → udp_sender      │
│ → UDP 127.0.0.1:4000 every 16666 µs (~60 Hz)              │
└───────────────────────────┬──────────────────────────────┘
                            │ UDP: VehiclePayloadState (packed, ~21 B)
                            ▼
┌──────────────────────────────────────────────────────────┐
│ Electron main (electron/main.ts)                          │
│  • main window 1920×480 frameless fullscreen              │
│  • debug window on Ctrl+Shift+D or #/debug → udp-probe    │
│  • spawns jukebox/bluetooth/cd services (ELECTRON_RUN_AS_NODE)
│  • owns entertainment volume                              │
└───────┬──────────────────────────────────────────────────┘
        │ IPC (contextBridge → window.*)
        ▼
┌──────────────────────────────────────────────────────────┐
│ React renderer (src/)                                     │
│  views: home | phone | media        debug: #/debug        │
│  ← HTTP + SSE → 127.0.0.1:{4100 jukebox, 4200 bt, 4300 cd}│
└──────────────────────────────────────────────────────────┘
```

### Data-flow invariants

- The **backend is the only telemetry producer**; the renderer does **not** decode vehicle state yet. `VehiclePayloadState` is a `#pragma pack(1)` struct (~21 B). Global `VehicleState` is mutex-guarded: the UDP sender locks/copies/sends; decoder threads lock to update.
- `electron/udp-probe.ts` is the **only** UDP listener. It emits raw hex frames to the **debug window only**; the main UI has no vehicle data. Debug framing: "Raw frames — decoding pending (future consumer process)".
- Every service is **loopback-only** (`127.0.0.1`) and speaks the same shape: `GET /api/health`, `GET /api/state`, `GET /api/events` (SSE) and `GET`/`POST /api/settings`, plus its own routes (see §5.3).

---

## 4. Backend (`backend/`)

- Pipeline: `receiver_can.c` → `ring_buffer.c` → `can_decoder.c` (×4 threads) → `udp_sender.c`; `main.c` wires it up.
- **Auto-generated, do not hand-edit:** `include/grand_modus.h` + `src/grand_modus.c` come from `backend/grand_modus.dbc` via **cantools 41.4.1** (`backend/venv/`). Regenerate from the DBC, never patch the generated files.
- CAN IDs: ENGINE `0x181`, GEARBOX `0x215`, CLIMATE `0x374`, BRAKES `0x5C5`, LIGHTS_AND_DOORS `0x60D`, SAFETY `0x651`.
- `make` builds `backend/backend`; `make clean` removes `build/` and the binary. No run target, no unit tests.
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
- `app.whenReady` starts all three services; `will-quit` stops them.

**IPC surface** (handlers in `main.ts`, exposed by `preload.ts`):

| Channel | Direction | Purpose |
| --- | --- | --- |
| `jukebox:get-endpoint` / `bluetooth:get-endpoint` / `cd:get-endpoint` | invoke | `{ baseUrl }` for each service |
| `entertainment:get-state` / `:set-volume` / `:set-source` | invoke | volume + active source |
| `entertainment:state-changed` | main → renderer | volume/source broadcast to both windows |
| `get-app-info` | invoke | name/version for the debug About panel |
| `udp-packet` | main → renderer | UDP hex frames → debug UDP panel |
| `debug-media-feed` / `debug-media-source` | renderer(main) → renderer(debug) relays | debug panel drives media state |
| `main-process-message` | main → renderer | logged in `src/main.tsx` |
| `debug-log`, `debug-channels`, `test-message` | renderer → main | wired in preload; not driven by main |

`window.entertainmentAudio`, `window.jukebox`, `window.bluetooth`, `window.cd`, `window.debugAPI`, `window.ipcRenderer` are the renderer-facing globals (`electron/preload.ts`). `window.debugAPI.getSystemInfo/getEnvVars` are computed **in preload**, not over IPC.

### 5.2 vite.config.ts — the entry trap

Five electron entries are built: `main`, `jukebox`, `bluetooth`, `cd` (→ `dist-electron/<name>/index.js`) and `preload` (→ `dist-electron/preload.mjs`, CJS).

- `vite-plugin-electron` launches Electron from **whichever entry's `onstart` runs LAST** (usually the largest bundle). All entries therefore route through the shared guarded `startOrReload` helper.
- **Never make an entry's `onstart` a no-op** — the app may then never open.
- `main.ts` resolves children as `path.join(__dirname, '<name>', 'index.js')`; changing an `outDir` silently breaks service spawning.

**Dev restarts (`electron/dev-watch.ts`).** `vite-plugin-electron` rebuilds the bundles on every edit but its `reload()` only refreshes the *renderer*, so the Electron main process and its service children would keep running the previous code until the app was restarted — a stale main process could even keep an old behaviour alive for a whole session. In dev (`VITE_DEV_SERVER_URL` set) main watches the build outputs and closes the loop:

| Rebuilt artifact | Reaction |
| --- | --- |
| `dist-electron/<service>/index.js` | that child process is killed and respawned (waiting for the old pid to exit, so it never races for the port) |
| `dist-electron/main.js` | the app relaunches (`app.relaunch()` + `app.quit()`), which stops the services through `will-quit` |
| `preload.mjs` / anything else | ignored — the plugin's renderer reload already covers it |

Bursts are debounced (300 ms). The watcher is pure and its behaviour is unit-tested (`test/dev-watch.test.ts`).

### 5.3 The three local services

All three are plain Node (`http` module, no framework) and **extend `BaseMediaService`**
(`shared/service-http.ts`), which owns the server, routing, SSE fan-out, graceful shutdown, process
fault tolerance and the suspend/resume state machine. A service only implements `getState()`,
`createRoutes()` and the `onStart` / `onStop` / `onSuspend` / `onResume` hooks.

Electron main spawns them via
`spawn(process.execPath, [entry], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'ignore' })`;
the renderer reaches them through `window.<name>.getEndpoint()` + `src/services/<name>.ts`.

| Service | Dir | Port (env) | External deps | Notes |
| --- | --- | --- | --- | --- |
| Jukebox | `jukebox-service/` | 4100 (`JUKEBOX_PORT`) | **mpv** via `node-mpv` | scan: `fast-glob` + `music-metadata` + `p-limit` |
| Bluetooth | `bluetooth-service/` | 4200 (`BLUETOOTH_PORT`) | BlueZ ≥ 5.79 `--experimental` + `obexd` | `dbus-next`; discovery + pairing agent + A2DP/AVRCP, audio is system-side |
| CD | `cd-service/` | 4300 (`CD_PORT`) | **mpv** (`cdda://`, libcdio-paranoia); udisks2 for data discs | drive detection is udev-event driven |

**Identical endpoints on every service** (provided by the base class):

| Path | Notes |
| --- | --- |
| `GET /api/health` | `{ ok, service, phase, suspended, uptimeSeconds, clients, ...healthDetails() }` |
| `GET /api/state` | service state; also the SSE initial frame |
| `GET /api/events` | SSE stream of state frames |
| `GET` / `POST /api/settings` | `{ autoSuspend?, idleTimeoutMs?, suspended? }` |

**Service-specific routes** (`createRoutes()`):

| Path | Jukebox | Bluetooth | CD |
| --- | --- | --- | --- |
| `POST /api/playback` | ✓ `play`/`pause`/`toggle`/`next`/`previous`/`stop` | ✓ same set | ✓ same set |
| `POST /api/volume` | ✓ (`{volume: 0..100}`) | ✓ | ✓ |
| `POST /api/seek` | ✓ | — | ✓ |
| `POST /api/track` | ✓ (0-based) | — | ✓ (**1-based**) |
| `GET /api/library`, `POST /api/scan`, `POST /api/play` | ✓ (`{albumId, paused?}` — `paused` loads without playing) | — | — |
| `POST /api/scan` | — | ✓ (`start`/`stop`/`refresh` — inquiry + discoverability) | — |
| `POST /api/phone` | — | ✓ (`connect`/`disconnect`/`forget`/`trust`/`untrust`) | — |
| `POST /api/pairing` | — | ✓ (`pair`/`confirm`/`reject`/`cancel`/`submit`) | — |
| `POST /api/calls` | — | ✓ reserved — answers **501** until an HFP backend exists | — |
| `GET /api/artwork/:id` | ✓ `:albumId` | ✓ `:name.jpg` | — |

Handlers validate by **throwing `HttpError`** (400/404/405/…); the base router renders it, so no handler
writes an error body itself. Unknown route → 404, wrong method → 405, invalid JSON body → 400.

**Suspend / resume (RAM snapshots).** `phase` is the state machine:
`starting → running ⇄ suspended → stopping → stopped`.

| | `onSuspend()` | `onResume()` |
| --- | --- | --- |
| Jukebox | snapshot `{albumId, trackIndex, positionSeconds, wasPlaying}`, kill mpv | relaunch mpv, reload album, `jump` + `seek`, and **stay paused** |
| Bluetooth | stop the inquiry + AVRCP **pause** + stop the position tick; **BlueZ, the device list and the pairing agent stay live** (pairing and future calls) | restart the tick, AVRCP play if it was playing |
| CD | snapshot `{discId, trackIndex, positionSeconds, wasPlaying}`, kill mpv | re-identify the physical disc: same id → reload + seek back; different or empty → reset and load what is there now |

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

- **Provider stack** (`src/main.tsx`, inside `React.StrictMode`): `I18nProvider > BluetoothProvider > JukeboxProvider > CdProvider > App`.
- **Views** (`src/App.tsx`): `home` → `HomeView`, `phone` → `PhoneView`, `media` → `MediaView`. `NAV_ORDER` in `src/constants/navigation.ts` is the rotary/scroll order.
- **`#/debug`**: if `window.location.hash` starts with `#/debug`, `App` renders `DebugPanel` instead of the shell. The debug window uses this; the main window can too.
- **Phone view** (`src/components/views/PhoneView.tsx` + `src/components/phone/`): two states switched on "is a phone connected". With none it renders the connect screen (hero render + `DeviceListCard`, driven by `useBluetooth().scan/phoneAction`); with one it renders `ConnectedPhoneScreen` (connection summary + placeholder cards for contacts/messages/calls). `primary` decides who is connected. `useScanWindow` starts the inquiry while the screen is up and stops it on unmount; the pairing prompt is `PairingModal`, shown whenever `state.pairing.stage === "awaiting-confirmation"`.
- **Media view** (`src/components/media-view/MusicApp.tsx`): branches per `sourceFeed.selectedSourceId`. Jukebox has a two-mode flow (`library` CoverFlow ↔ `player` + queue drawer); `JukeboxProvider` keeps the selected mode in RAM across screen and source changes. The queue drawer remains local. Other sources render a single player.
- **The player view needs an album.** `inPlayer` requires `state.albumId`, so a jukebox that lost its state falls back to the library instead of rendering an empty player (no track/album/artist). `useJukebox` also keeps a recovery memory (`src/lib/lastPlayback.ts`, pure + unit-tested): returning to the Jukebox source with nothing loaded reloads the last album/track **paused** (same rule as a snapshot restore: it never starts audio). An explicit `stop()` clears that memory — that is the only case where the album must *not* come back.
- **Hooks** (`src/hooks/`): `useJukebox` / `useBluetooth` / `useCd` (service-or-mock state), `useNowPlaying` (home hub), `useMediaSourceAdapters`, `useEntertainmentVolume`, `useRotaryNavigation`, `useCoverFlowNavigation`.
- **Bluetooth state is device-centric.** `state.devices` is the phone list and `state.media` is the *active* phone's media — the media view reads `state.media`, not a flat top-level player. See `docs/bluetooth.md`.
- **Transport layer** (`src/services/{jukebox,bluetooth,cd,health}.ts`): thin `fetch` + `EventSource` wrappers; endpoint resolution falls back to the hard-coded default URL when the preload bridge is absent (`VITE_BLUETOOTH_BASE_URL` overrides it for browser dev).
- **Mock fallback:** each data hook probes `/api/health`; when the service is unreachable it switches to `src/data/*.mock.ts` (`mode: "service" | "mock" | "loading"`). Bluetooth/CD re-probe every 5 s; jukebox decides once on mount. This is what keeps a plain browser (`npm run dev`, no Electron) usable.

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
`node --import tsx --test test/*.test.ts` (tsx is already a devDependency; it resolves the `.js` ESM
specifiers used across the services to their `.ts` sources).

| File | Covers |
| --- | --- |
| `test/fake-mpv.ts` | `FakeMpv implements MpvLike`: records commands (`callsTo("seek")`, `lastCall("jump")`), mirrors mpv's `paused`/`resumed`/`stopped` events, stores properties |
| `test/support.ts` | `apiGet` / `apiPost`, `sleep`, `waitFor` |
| `test/base-media-service.test.ts` | shared routing, 404/405, `HttpError` mapping, settings validation, SSE frames, suspend/resume, idle auto-suspend, `stop()` releasing the port |
| `test/jukebox-suspend-resume.test.ts` | **the reference example**: mocking mpv + player-level snapshot/restore, then the same flow through `POST /api/settings` |
| `test/cd-suspend-resume.test.ts` | disc-id verification (same disc restores, swapped disc resets, empty drive resets) via a `ScriptedDriveMonitor` |
| `test/last-playback.test.ts` | the renderer recovery memory: a state without an album must not erase it, position ticks must not re-allocate it |
| `test/dev-watch.test.ts` | the dev restart watcher: bursts coalesce into one restart, filters and dispose are honoured, a failing watch does not drop the others |
| `test/fake-bluez.ts` | `FakeBluez` / `FakeAgent`: structural doubles for `BlueZClient`/`PairingAgent` — record calls, drive `changed`/`device-connected`, raise agent prompts |
| `test/bluetooth-devices.test.ts` | Class-of-Device classification, the phone-candidate filter (paired always listed, CoD/UUID rules, `showAll` escape hatch, blocked devices), capabilities, adapter snapshot |
| `test/bluetooth-phone.test.ts` | `PhoneManager`: state mapping, media follows the primary phone, scan/phone/pairing actions, "last connected wins" (the previous phone is disconnected), pairing failure → error mapping, reserved calls answering 501 |

Services take injected collaborators, so no hardware is needed: `createMpv`, `drive`, `identifyDisc`,
`settings`, `installProcessHandlers: false`, `logger: createSilentLogger()`. Tests bind port `0`
(ephemeral), never a fixed port.

---

## 6. Environment variables

| Variable | Default | Used by |
| --- | --- | --- |
| `JUKEBOX_PORT` | `4100` | `electron/main.ts`, `jukebox-service/config.ts` |
| `JUKEBOX_MUSIC_ROOT` | `~/Music` | library root (+ `library.json`, `.jukebox/artwork`) |
| `JUKEBOX_MPV_BINARY` | `which mpv` → `/usr/bin/mpv` | jukebox playback |
| `BLUETOOTH_PORT` | `4200` | `electron/main.ts`, `bluetooth-service/config.ts` |
| `BLUETOOTH_ARTWORK_DIR` | `$TMPDIR/renault-mmi-artwork` | AVRCP/BIP cover-art cache |
| `BLUETOOTH_SHOW_ALL_DEVICES` | unset | `1` = list computers/headsets too (phone hiding its class) |
| `VITE_BLUETOOTH_BASE_URL` | unset | renderer only: point browser dev at another bluetooth service or a fake |
| `CD_PORT` | `4300` | `electron/main.ts`, `cd-service/config.ts` |
| `CD_DEVICE` | auto-detect `/dev/sr*` | accepts `sr0` or `/dev/sr0` |
| `CD_MPV_BINARY` | `which mpv` → `/usr/bin/mpv` | CD playback |
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
- **`shared/service-http.ts` is load-bearing for all three services.** Route handlers `throw` instead of
  writing responses; changing `dispatch` changes every endpoint contract at once. `test/base-media-service.test.ts`
  is the safety net.
- **Service handlers must stay injectable.** `createMpv` / `drive` / `identifyDisc` exist so the suite runs
  without mpv, udev or a CD drive. Add new hardware touchpoints the same way rather than importing a
  spawn at the call site. The bluetooth side does this with ports (`bluetooth-service/ports.ts`), an
  injected `bluez`/`agent`, and a bus factory for `ArtworkService` (`() => null` in tests) — a real
  session bus there would keep the event loop alive and hang `npm test`.
- **Docs drift:** `docs/music.md` still claims Bluetooth and CD are unimplemented — both now have real services. Verify against code, not that doc.
- **`dist-electron/` is stale-tolerant** — Electron loads the built `dist-electron/*`, so a running dev app after a service change needs the entry rebuilt (dev mode handles this automatically).
- **Custom opencode agents** live in `.opencode/agents/`: `infotainment-ux-architect` (UI components), `react-architect` (refactors), `electron-react-auditor` (review), `test-suite-architect` (tests, see §5.7).

---

## 8. Where to make common changes

| Change | Touch these |
| --- | --- |
| Add/modify a UI screen | `src/components/views/*` + `src/App.tsx` switch + `NAV_ORDER` |
| Add a media source | `src/data/media.ts` → `SOURCE_ADAPTER_FACTORIES` (§5.5); a service module if it needs a backend |
| Add a service | new `*-service/` class extending `BaseMediaService` + `createRoutes()` + entry in `vite.config.ts` + spawn/stop in `electron/main.ts` + preload global + `src/services/*` |
| Add an endpoint | a handler in that service's `createRoutes()`; `throw new HttpError(...)` for errors, `sendJson(res, …)` for success |
| Change bluetooth discovery/pairing | `bluetooth-service/pairing.ts` / `phone.ts` (policy) — keep `bluez.ts` the only D-Bus file |
| Add phone-call support | implement `CallBackend` (`bluetooth-service/calls.ts`) and hand it to `CallManager`; state, routes and the UI already reserve the shape |
| Change suspend/resume | the service's `onSuspend`/`onResume` + its player snapshot type; keep the base state machine untouched |
| Add a string | `src/i18n/locales/en.ts` **and** `it.ts` |
| Add vehicle telemetry to the UI | build on `electron/udp-probe.ts` (main-process decode → IPC) — the renderer has no CAN knowledge today |
| Add a CAN signal | regenerate from `backend/grand_modus.dbc`; never edit generated C |

---

## 9. Reference docs

| File | Contents |
| --- | --- |
| `README.md` | project overview / requirements |
| `DESIGN.md` | typography, amber palette, layout rules |
| `REQUIRMENTS.MD`, `USEFUL_SOURCE.MD` | original requirements and references |
| `docs/backend.md` | backend pipeline and threading detail |
| `docs/music.md` | media view design (**stale** on source status) |
| `docs/bluetooth.md` | bluetooth state model, pairing flow, AVRCP/BIP cover art, BlueZ setup |

When you change architecture, ports, env vars, or an invariant above, update this file in the same change.
