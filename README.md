# RenaultMMI

RenaultMMI is a custom in-car infotainment system built for a Raspberry Pi 5
and a Waveshare 8.8" 1920x480 touch display. It reads the vehicle CAN bus,
decodes the relevant signals and presents them through an Electron-based
interface, together with local media playback.

The project is split into two codebases:

- **`backend/`** — a C application that listens on the CAN bus and streams the
  decoded vehicle state over UDP.
- **`frontend/`** — the user interface: React, Electron, Vite and Tailwind.

## Documentation

The detailed documentation is kept in the `docs/` folder:

| Section | Content |
| --- | --- |
| [Music view](/docs/music.md) | The media view and the Jukebox player. |
| [Bluetooth source](/docs/bluetooth.md) | Phone playback, metadata and cover art over AVRCP. |
| [Backend](/docs/backend.md) | What the CAN reader does and how it works. |

## Current status

- The **Jukebox** audio source is implemented end to end: library scanning,
  CoverFlow album picker, playback via `mpv`, and a shared now-playing hub on
  the home screen.
- The **Bluetooth** source is implemented: playback control, track metadata
  and cover art (AVRCP 1.6) from a connected phone.
- The **CD** and **FM** sources are placeholders.
- The **backend** decodes the engine, gearbox, climate, brakes and lights and
  doors messages and publishes them over UDP. The frontend does not parse that
  stream into the main UI yet; only the debug window shows the raw frames.

## Getting started

```bash
npm install
npm run dev      # Vite dev server + Electron + jukebox service
npm run lint     # ESLint strict
npm run build    # typecheck, build renderer + electron entries, package
```

## Requirements

Software versions and packages needed to build and run the project.

### Frontend

| Requirement | Version | Purpose |
| --- | --- | --- |
| Node.js | >= 20 | Build tooling and the sidecar services. |
| `mpv` | any recent | Audio playback for the Jukebox (`node-mpv`). |

### Bluetooth source

Cover art requires a recent Linux Bluetooth stack on the target machine:

| Requirement | Version | Purpose |
| --- | --- | --- |
| BlueZ | >= 5.79 | AVRCP 1.6 metadata and cover art client role. |
| `obexd` | same as BlueZ | OBEX daemon used to pull cover art from the phone. |

`bluetoothd` must run with the `--experimental` flag so BlueZ publishes the
cover-art port of the connected phone. On systemd distros:

```bash
sudo tee /etc/systemd/system/bluetooth.service.d/override.conf >/dev/null <<'EOF'
[Service]
ExecStart=
ExecStart=/usr/lib/bluetooth/bluetoothd --experimental
EOF
sudo systemctl daemon-reload && sudo systemctl restart bluetooth
```

(`obexd` ships in the `bluez-obex` package on some distros; start it with
`systemctl --user enable --now obex`.)

Phones: Android 12+ (on many devices set Developer Options -> AVRCP version ->
1.6) and iOS 13+ work out of the box. Without BlueZ >= 5.79 / obexd everything
else still works, but the UI shows a fallback cover instead of artwork.

### Backend

| Requirement | Version | Purpose |
| --- | --- | --- |
| gcc | C11 support | Building the CAN reader (`make`). |
| Linux CAN | kernel modules | `vcan0` interface for development. |
| Python 3 + cantools | cantools 41.x | Regenerating `src/grand_modus.c` from the DBC. |
| `can-utils` | - | `canplayer` / `cansend` to replay the simulator logs. |
