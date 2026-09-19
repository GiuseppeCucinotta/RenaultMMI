# Bluetooth source

The Bluetooth source does two jobs for one phone: it plays the phone's audio
(A2DP + AVRCP) and it manages the phone connection itself (discovery, pairing,
forgetting). Both are driven by BlueZ over D-Bus; the renderer talks to a small
HTTP/SSE API and never sees D-Bus.

```
Phone (A2DP source / AVRCP controller / HFP handset)
  │  audio  ──────────►  ALSA / PulseAudio (system side)
  └─ AVRCP metadata ──►  BlueZ (D-Bus, org.bluez.*)
       │                    ▲
       └ cover art (BIP)    │  MediaPlayer1 / Device1 / Adapter1 / Agent1
            ▲               │
Electron main process spawns the bluetooth service
  └─ bluetooth-service (Node, D-Bus via dbus-next)
       └─ HTTP + SSE API on http://127.0.0.1:4200 (BLUETOOTH_PORT)
            └─ renderer consumes it via src/services/bluetooth.ts + useBluetooth
```

## The state model

One device-centric state tree, published on `/api/state` and over SSE. `devices`
is the phone list and `media` always belongs to the active phone.

```jsonc
{
  "available": true,
  "adapter": { "path", "name", "address", "powered", "discoverable", "pairable", "discovering" },
  "discovering": false,
  "devices": [
    {
      "id": "/org/bluez/hci0/dev_60_06_E3_15_F2_B7",  // BlueZ object path = API id
      "address": "60:06:E3:15:F2:B7",
      "name": "Giuseppe's iPhone 15 Pro",
      "kind": "phone",            // phone | audio | computer | other
      "paired": true, "connected": true, "trusted": true, "primary": true,
      "rssi": -48, "batteryPercent": 72,
      "capabilities": { "audio": true, "remoteControl": true, "handsFree": true, "battery": true }
    }
  ],
  "pairing": { "stage", "deviceId", "deviceName", "method", "passkey", "error" },
  "media": { "deviceId", "status", "track", "positionMs", "durationMs" },
  "calls": { "supported": false, "activeCallId", "calls": [], "recentNumbers": [] }
}
```

- `primary` marks the phone that owns `media` and (later) calls.
- `media.deviceId` is never a disconnected phone, so a stale player cannot leak
  into the UI.
- `pairing.stage` drives the prompt: `idle → pairing → awaiting-confirmation`,
  or `failed` with a machine-readable `error`. The renderer maps `error` to a
  translated message and keeps the row tappable for a retry.

## One phone at a time

BlueZ happily keeps several phones connected at once, so "last connected wins":
when a phone connects it becomes primary and the other connected phones are
disconnected. That keeps media and calls unambiguous without a settings screen.

## Service (`services/bluetooth-service/`)

| File | Responsibility |
| --- | --- |
| `index.ts` | Entry point. |
| `service.ts` | HTTP/SSE routes; maps them onto `PhoneManager` verbs. |
| `phone.ts` | **The deep module.** Owns the published state, the primary-phone policy and the lifecycle. |
| `bluez.ts` | The only file that talks to D-Bus (ObjectManager, Adapter1, Device1, MediaPlayer1, Battery1). |
| `agent.ts` | `org.bluez.Agent1` implementation: turns BlueZ pairing prompts into events the UI answers. |
| `pairing.ts` | The pairing state machine (pair, prompts, cancel, error mapping). |
| `devices.ts` | Pure helpers: Class-of-Device classification, phone filtering, capability mapping. |
| `media.ts` | AVRCP read model for the active phone + position interpolation. |
| `artwork.ts` | Cover art downloader (OBEX `bip-avrcp` client, see below). |
| `calls.ts` | Reserved telephony seam; see "Phone calls" below. |
| `volume.ts` | Applies volume to the BlueZ A2DP sink. |
| `ports.ts` | Structural port types so the managers are testable with fakes. |
| `config.ts` | Configuration and defaults. |

Configuration (environment variables):

| Variable | Default | Purpose |
| --- | --- | --- |
| `BLUETOOTH_PORT` | `4200` | HTTP/SSE port, bound to 127.0.0.1. |
| `BLUETOOTH_ARTWORK_DIR` | `$TMPDIR/renault-mmi-artwork` | Cover art cache folder. |
| `BLUETOOTH_SHOW_ALL_DEVICES` | unset | `1` lists computers/headsets too, for a phone that hides its class. |

### API

Base URL `http://127.0.0.1:4200`. Responses are JSON; CORS is open for the
renderer. Errors are `{ "error": "..." }` with 400/404/409/501.

| Method | Path | Description |
| --- | --- | --- |
| GET | `/api/health` | Service health + Bluetooth details (adapter, pairable, prompt availability, paired count). |
| GET | `/api/state` | The state tree above; also the initial SSE frame. |
| GET | `/api/events` | SSE stream of state frames. |
| GET | `/api/artwork/:handle.jpg` | Downloaded cover art image. |
| POST | `/api/scan` | `{ "action": "start" \| "stop" \| "refresh" }`. `start` makes the car discoverable and pairable; the service stops the inquiry itself after 60 s. |
| POST | `/api/phone` | `{ "action": "connect" \| "disconnect" \| "forget" \| "trust" \| "untrust", "deviceId" }`. `connect` pairs when the phone is not paired yet. |
| POST | `/api/pairing` | `{ "action": "pair" \| "confirm" \| "reject" \| "cancel" \| "submit", "deviceId?", "value?" }`. `confirm`/`reject` answer the prompt on screen; `submit` carries a typed passkey/PIN. |
| POST | `/api/playback` | `{ "action": "play" \| "pause" \| "toggle" \| "next" \| "previous" \| "stop" }`. |
| POST | `/api/volume` | `{ "volume": 0-100 }` - set the A2DP sink volume. |
| POST | `/api/calls` | Reserved; answers **501** until an HFP backend exists. |

`GET /api/health` and `/api/state` are not activity and never wake a suspended
service; every mutating request auto-resumes first.

### Pairing

`pairing.ts` registers an `org.bluez.Agent1` with **KeyboardDisplay**
capability. BlueZ blocks inside the agent while a phone is being paired, so each
request stores its D-Bus reply and emits a prompt; the renderer answers it
(`confirm`/`reject`/`submit`) and the stored reply is released. An unanswered
prompt is rejected after 25 s so a lost renderer cannot wedge pairing.

Prompts map to the UI like this:

| BlueZ request | `pairing.method` | UI |
| --- | --- | --- |
| `RequestConfirmation` | `confirm` | shows the 6-digit code, Confirm/Reject |
| `DisplayPasskey` | `confirm` | shows the code being typed on the phone |
| `RequestPasskey` / `RequestPinCode` | `passkey-entry` | numeric input, submitted with `value` |
| `RequestAuthorization` / `AuthorizeService` | `confirm` | Confirm/Reject |

The prompt is the only blocking part of pairing, so **answering it immediately
stops showing it**: the state moves from `awaiting-confirmation` to `pairing`
while `Pair()` runs to completion, and then to `idle` (success) or `failed`
(with a reason). A phone that finishes the pairing by itself — the user taps
"Pair" on the handset — connects without the car answering, which also clears a
prompt that is still on screen. Rejecting or cancelling publishes `idle`/`failed`
the same way, so the modal is never left hanging on a stale prompt.

The agent needs to own no particular bus name — BlueZ keys agents off the
sender's unique name — so a system-bus policy that refuses our well-known name
(`org.renaultmmi.btagent`) only costs introspection, not pairing.

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

## Phone calls (reserved, not implemented)

Answering and placing calls needs Hands-Free Profile, which BlueZ alone cannot
carry: HFP needs a telephony backend (oFono or equivalent) on the D-Bus plus a
separate SCO/PCM audio path. The seam is prepared so adding it stays additive:

- `calls.ts` defines `CallBackend` and `CallManager`; **the service state
  already carries `calls`** and the routes already accept `answer`/`hangup`/
  `dial`/`mute`/`hold`/…, answering 501 while no backend is installed.
- The renderer feature-detects with `state.calls.supported` and shows the
  "Phone calls" placeholder card.
- The pairing agent, device list and `primary` phone are unaffected by adding a
  backend: it only has to implement `CallBackend` and be handed to
  `CallManager`.

## Requirements

- **BlueZ** (>= 5.79 if you want cover art) with a working controller.
- For cover art: `bluetoothd --experimental` (publishes `ObexPort`) **and** a
  running `obexd` (packaged separately on some distros, e.g. `bluez-obex`).
- `pactl` (PulseAudio or pipewire-pulse) for the A2DP sink volume.
- The service must be able to use the **system** D-Bus. If it runs as a
  non-root user, make sure the bus policy allows talking to `org.bluez` and
  registering an agent.

Without a controller the service still starts and `/api/health` reports
`adapterPowered: false` / `visibleDevices: 0`; the UI shows "Bluetooth is turned
off on this system" instead of an empty list.

## Testing without hardware

- `npm test --workspace services` runs the unit suites: device classification/filtering, the pairing
  state machine and error mapping, the primary-phone policy, state mapping and
  the service routes. They use `services/test/fake-bluez.ts`, a structural fake of
  `BlueZClient`, so no D-Bus and no phone are needed.
- `node frontend/scripts/fake-bluetooth-service.mjs [port]` (from the repo root) serves a fake state (and
  SSE) for UI work, including a pairing prompt that resolves after a delay.
  Point the renderer at it with `VITE_BLUETOOTH_BASE_URL`:

  | Env | Effect |
  | --- | --- |
  | `NOPHONE=1` | start disconnected, so the connect screen is shown |
  | `PAIR_DELAY_MS=5000` | keep `pairing` running that long, to see the progress state |
  | `LOG_REQUESTS=1` | log every request the renderer makes |

  To view it in a browser without Electron, run Vite with a config that skips
  the electron plugin and proxies `/api` to the fake service (a browser blocks
  cross-origin calls to loopback).
