# RenaultMMI — Agent Instructions

Dual-codebase infotainment project (Raspberry Pi target, 1920×480 portrait).

## Architecture

```
┌─────────────────────────────────────────────┐  vcan0 (Linux virtual CAN)
│  backend/ (C, pthreads, C11, CAN raw socket) │
│  receiver → ring_buf(4096) → decoder(x4)    │
│  → udp_sender → UDP 127.0.0.1:4000 @ 60Hz  │
└──────────────┬──────────────────────────────┘
               │ UDP datagram (VehiclePayloadState, 64-bit packed)
               ▼
┌─────────────────────────────────────────────┐
│  frontend/ (React 18 + Electron 30 + Vite)  │
│  IPC bridge (contextBridge → ipcRenderer)   │
│  TODO: consume UDP, render infotainment UI  │
└─────────────────────────────────────────────┘
```

- Backend auto-generates DBC decode/encode from `backend/grand_modus.dbc` via `cantools` Python.
- CAN IDs in use: ENGINE 0x181, GEARBOX 0x215, CLIMATE 0x374, BRAKES 0x5C5, LIGHTS_AND_DOORS 0x60D, SAFETY 0x651.
- No frontend tests exist. Backend has no unit tests (only log-file simulators in `test/`).

## Commands

### Backend (`backend/`)
```bash
make           # build
make clean     # remove build/ and binary
```

### Frontend (`frontend/`)
```bash
cd frontend && npm i            # install deps
npm run dev                     # Vite dev server + Electron
npm run build                   # tsc → vite build → electron-builder
npm run lint                    # ESLint (strict, 0 warnings)
npm run preview                 # Vite preview build
```

## Gotchas

- **Backend requires vcan0:** The CAN receiver binds to `vcan0`. To test without a real car, pipe log files:
  ```bash
  sudo ip link add name vcan0 type vcan && sudo ip link set up vcan0
  candump vcan0 | cannal2eth -i vcan0    # or use canDrive GUI
  ```
  Simulators in `test/` generate `.log` files. Use `cansend vcan0` or `candump` piping to feed them.
- **Backend uses a global mutable `VehicleState`** with a mutex. The UDP sender locks it, copies, and sends. Decoder threads lock it to update fields.
- **Frontend is a Vite+Electron scaffold** with only a counter demo in `App.tsx`. Real infotainment UI needs to be built.
- **Frontend consumes UDP data on port 4000** — currently no UDP receiver in the frontend. This is a missing integration point.
- **electron-builder config is placeholder** (`YourAppID`, `YourAppName`) — needs updating before packaging.
- **Build artifacts:** backend `build/`, `compile_commands.json`, `.cache/` are in backend/ subdirectory (root `.gitignore` does not cover them).
- **Frontend target platform:** Raspberry Pi 5 with Waveshare 8.8" 1920×480 DSI display. Keep UI in mind when designing components.
