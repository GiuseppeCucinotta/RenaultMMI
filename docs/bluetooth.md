# Bluetooth source

The Bluetooth source lets a phone play audio through the system. The phone
streams over A2DP; the app shows track metadata and cover art and exposes
play/pause/skip controls, all driven by AVRCP.

## How it works

```
Phone (A2DP source / AVRCP controller)
  │  audio  ──────────►  ALSA / PulseAudio (system side)
  └─ AVRCP metadata ──►  BlueZ (D-Bus, org.bluez.MediaPlayer1)
       │                    ▲
       └ cover art (BIP)    │ org.bluez.MediaPlayer1 ObexPort + ImgHandle
            ▲               │
Electron main process spawns the bluetooth service
  └─ bluetooth-service (Node, D-Bus via dbus-next)
       └─ HTTP + SSE API on http://127.0.0.1:4200 (BLUETOOTH_PORT)
            └─ renderer consumes it via src/services/bluetooth.ts + useBluetooth
```

- The service watches `org.bluez.MediaPlayer1` for track changes and forwards
  playback commands back to the phone.
- Playback position is interpolated locally (500 ms tick): AVRCP only reports
  position changes well under 1 Hz, so the last reported value is anchored and
  advanced while the track is playing.
- When no service is reachable (e.g. plain-browser dev without Electron),
  `useBluetooth` falls back to `src/data/bluetooth.mock.ts`.

## Service (`bluetooth-service/`)

| File | Responsibility |
| --- | --- |
| `bluez.ts` | D-Bus client: discovers devices/players, tracks live property changes. |
| `player.ts` | Single source of truth for playback state served to the renderer. |
| `artwork.ts` | Cover art downloader (OBEX `bip-avrcp` client, see below). |
| `volume.ts` | Applies volume to the BlueZ A2DP sink. |
| `server.ts` | HTTP + SSE server exposing the API. |
| `config.ts` | Configuration and defaults. |
| `index.ts` | Entry point. |

Configuration (environment variables):

| Variable | Default | Purpose |
| --- | --- | --- |
| `BLUETOOTH_PORT` | `4200` | HTTP/SSE port, bound to 127.0.0.1. |
| `BLUETOOTH_ARTWORK_DIR` | `$TMPDIR/renault-mmi-artwork` | Cover art cache folder. |

### API

Base URL `http://127.0.0.1:4200`. Responses are JSON; CORS is open for the
renderer.

| Method | Path | Description |
| --- | --- | --- |
| GET | `/api/health` | Service health, BlueZ availability. |
| GET | `/api/state` | Current playback state (device, track, position). |
| POST | `/api/playback` | `{ "action": "play" \| "pause" \| "toggle" \| "next" \| "previous" \| "stop" }`. |
| POST | `/api/volume` | `{ "volume": 0-100 }` - set the A2DP sink volume. |
| GET | `/api/artwork/:handle.jpg` | Downloaded cover art image. |
| GET | `/api/events` | SSE stream of state updates. |

The state's `track.artworkState` is `"ready"` once the art file is cached
(`artworkUrl` points at it), `"loading"` while downloading, or `"none"` when
the phone did not provide an image handle.

## Cover art (AVRCP 1.6)

Cover art travels out-of-band from the rest of the metadata:

1. The phone advertises a BIP OBEX port (`ObexPort`) on its media player.
2. The service opens an OBEX session to that port (target `bip-avrcp`).
3. Every track then carries an image handle (`ImgHandle`); the service pulls
   the 200x200 JPEG thumbnail for each new handle and caches it on disk.
4. The renderer loads it from `/api/artwork/:handle.jpg`. While a download is
   in flight the UI shows a spinner; when the phone provides no art it falls
   back to a generated cover (music icon).

Works on both Android (12+, may need Developer Options -> AVRCP version ->
1.6) and iOS (13+). The phone must stay connected; the OBEX session is closed
when the device disconnects.

Cache: one JPEG per handle in the artwork dir, capped at 64 files (oldest
evicted first).

## Requirements

The cover art feature needs a recent Linux Bluetooth stack:

- **BlueZ >= 5.79** running as `bluetoothd --experimental` (this publishes the
  `ObexPort` property).
- **obexd** running (packaged separately on some distros, e.g. `bluez-obex`).

Without them the service stays up but cover art never downloads and the UI
shows the fallback cover. See the README for setup commands.
