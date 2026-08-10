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
| [Music view](/docs/music.md) | The media view and the Jukebox player (the working feature). |
| [Backend](/docs/backend.md) | What the CAN reader does and how it works. |

## Current status

- The **Jukebox** audio source is implemented end to end: library scanning,
  CoverFlow album picker, playback via `mpv`, and a shared now-playing hub on
  the home screen.
- The **Bluetooth**, **CD** and **FM** sources are placeholders.
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

Requirements: Node.js, `mpv` (for the jukebox), and the project dependencies
in `package.json`.
