# Music view

The Media view is split by audio source. The source selector is rendered by
`SourceSelector` and the active source is stored in `SourceFeed.selectedSourceId`.
The router view `MediaView` renders `MusicApp`, which branches on the selected
source id.

This is currently the only fully working feature of the frontend. Two of the
four sources (Bluetooth, CD, FM) are placeholders; only the **Jukebox** source
has a real implementation.

## Sources

The available sources are defined in `src/data/media.ts`
(`DEFAULT_SOURCES`): Bluetooth, CD, FM and Jukebox. The selected one lives in
the `SourceFeed` state at the top of the app.

| Source | Status |
| --- | --- |
| Bluetooth | Not implemented yet |
| CD | Not implemented yet |
| FM | Not implemented yet |
| Jukebox | Implemented |

## Now playing (home screen)

The home `MediaPlayer` is fed by a single now-playing hub so it always shows
what is really playing, independent of which view is open:

- `JukeboxProvider` (`src/context/JukeboxProvider.tsx`) mounts the jukebox
  service connection once at the app root — one SSE socket, one library fetch —
  and is shared by the home player and `MusicApp` via `useJukeboxContext`.
- `useNowPlaying` (`src/hooks/useNowPlaying.ts`) composes
  `{ trackName, source, albumArt, isPlaying, onPlayPause, onSkip }` for the
  home player. It prefers whichever source `isActive()` (i.e. actually has
  media loaded); when nothing is playing it falls back to the selected source
  with "No Media". Controls are no-ops unless the resolved source can act.
- `useMediaSourceAdapters` (`src/hooks/useMediaSourceAdapters.ts`) is the
  **extension point**. Each source id in `DEFAULT_SOURCES` gets a
  `MediaSourceAdapter` implementing a small contract
  (`getNowPlaying`, `isActive`, `togglePlayPause`, `skipToNext`).

Adding a new source (Bluetooth, CD, FM) means adding a real adapter to the
`SOURCE_ADAPTER_FACTORIES` map — the home player and any future consumer pick
it up with no further changes. Until then they fall back to `EMPTY_ADAPTER`
(a no-op that reports "No Media").

## Jukebox

Local music library player with an Apple-style CoverFlow. It scans a folder,
builds a JSON library, and plays albums through `mpv`.

### Architecture

```
Electron main process (electron/main.ts)
  └─ spawns the jukebox service (dist-electron/jukebox/index.js)
       └─ HTTP + SSE API on http://127.0.0.1:4100 (JUKEBOX_PORT)
            └─ renderer consumes it via src/services/jukebox.ts + useJukebox hook
```

The jukebox is a standalone Node service, not an Electron process. The main
process spawns it on startup by running Electron's embedded Node:

```ts
spawn(process.execPath, [entry], { env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" } })
```

It exposes the service base URL to the renderer through the IPC channel
`jukebox:get-endpoint` (bridged as `window.jukebox.getEndpoint()` in
`electron/preload.ts`). When the app quits, the service is terminated.

### Service (`jukebox-service/`)

| File | Responsibility |
| --- | --- |
| `config.ts` | Configuration and defaults (music root, mpv binary, port). |
| `scanner.ts` | Disc scan: glob audio files, read tags, extract artwork, write `library.json`. |
| `player.ts` | `node-mpv` wrapper: playlist playback, transport, seek, progress events. |
| `server.ts` | HTTP + SSE server exposing the API. |
| `library.ts` | Library helpers (find albums, flatten artists). |
| `index.ts` | Entry point / CLI runner. |

Configuration (environment variables):

| Variable | Default | Purpose |
| --- | --- | --- |
| `JUKEBOX_MUSIC_ROOT` | `~/Music` | Folder scanned for audio files. |
| `JUKEBOX_MPV_BINARY` | `which mpv` | Path to the `mpv` binary. |
| `JUKEBOX_PORT` | `4100` | HTTP/SSE port, bound to 127.0.0.1. |

### Scanning

`scanner.ts` walks the music root with `fast-glob` and reads audio tags with
`music-metadata` (parallelized with `p-limit`). Results are grouped as
Artist -> Album -> Songs:

- Album and song metadata comes from tags, falling back to folder and file
  names.
- Embedded cover art is extracted to `.jukebox/artwork/<albumId>.jpg` inside
  the music root (falls back to a `cover.jpg` / `artwork.jpg` file in the
  album folder).
- The library is persisted as `library.json` (schema version 2, written
  atomically) next to the artwork folder, so subsequent startups load without
  a rescan.

### API

Base URL `http://127.0.0.1:4100`. Responses are JSON; CORS is open for the
renderer.

| Method | Path | Description |
| --- | --- | --- |
| GET | `/api/health` | Service health, library loaded flag, mpv availability. |
| GET | `/api/library` | The parsed library. |
| POST | `/api/scan` | Trigger a rescan, returns the updated library. |
| POST | `/api/play` | `{ "albumId": "..." }` - queue and play an album. |
| POST | `/api/playback` | `{ "action": "play" \| "pause" \| "toggle" \| "next" \| "previous" \| "stop" }`. |
| POST | `/api/seek` | `{ "seconds": 42 }` - seek in the current track. |
| GET | `/api/state` | Current playback state. |
| GET | `/api/artwork/:albumId` | Streaming album artwork image. |
| GET | `/api/events` | SSE stream of playback state updates. |

### Playback

`player.ts` drives `mpv` through `node-mpv` with the album queued as a playlist
in loop mode. The player emits state updates on `timeposition` (every 500 ms),
`playlist-pos`, `pause`, and `duration`, which the service fans out over the
SSE endpoint. The emitted state is a JSON object (`JukeboxPlaybackState`):
`albumId`, `trackIndex`, `artistName`, `albumTitle`, `trackTitle`,
`durationSeconds`, `currentTimeSeconds`, and `isPlaying`.

### Renderer

- `src/services/jukebox.ts` - HTTP client and `EventSource` subscriber.
- `src/hooks/useJukebox.ts` - React hook owning library and playback state. It
  resolves the endpoint through the preload bridge (defaults to
  `127.0.0.1:4100`) and health-checks the service. If the service is
  unreachable (e.g. plain-browser dev without Electron), it falls back to
  `src/data/jukebox.mock.ts`, which simulates the library and playback so the
  UI stays usable.
- `src/types/jukebox.ts` - shared types (`JukeboxAlbum`, `JukeboxPlaybackState`,
  `JukeboxMode`, etc.).

### UI

`MusicApp` branches on `sourceFeed.selectedSourceId === "jukebox"`:

- **Library mode** (`JukeboxView`): the CoverFlow carousel. `CoverFlowItem`
  renders each album as a 3D card (translation + `rotateY` + scale + opacity by
  distance from the focused index) with a mirrored reflection and a warm glow
  on the focused card. `useCoverFlowNavigation` binds wheel, arrow keys, drag
  and Enter to focus/select.
- **Player mode**: selecting an album calls `playAlbum`, which starts playback
  and switches to the existing `PlayerDisplay`, with the transport controls
  (`previous` / `toggle` / `next` / `seek`) wired to the service actions and a
  back button returning to the library.

In jukebox mode the global rotary navigation (`useRotaryNavigation`) is
disabled in `MediaView`, so the CoverFlow owns wheel and keyboard input.

### Building and running

The service is bundled by `vite-plugin-electron` as a third entry (see
`vite.config.ts`), which produces `dist-electron/jukebox/`. Every electron
entry routes its `onstart` through a shared `startOrReload` helper: the plugin
only launches Electron from whichever entry finishes building last, so a no-op
handler on the largest (jukebox) bundle would leave the app never opening.

```bash
npm run dev      # dev server + Electron + jukebox service
npm run build    # typecheck, build renderer + electron entries
```

To test the service without the app:

```bash
node dist-electron/jukebox/index.js
curl http://127.0.0.1:4100/api/health
```
