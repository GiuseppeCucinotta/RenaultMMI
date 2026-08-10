# Backend

The backend is a C application that runs on the Raspberry Pi 5 and reads the
vehicle CAN bus. It decodes the frames that interest the infotainment system
and publishes the resulting vehicle state over UDP, so the frontend can
consume it.

## What it does

The backend listens on a CAN interface (`vcan0` by default, the virtual CAN
bus used during development). Every raw frame that matches a known message is
decoded into a compact `VehiclePayloadState` structure, and a snapshot of that
structure is sent over UDP to `127.0.0.1:4000` roughly 60 times per second.

It does not control the car. It only observes the bus and relays the state.

## Architecture

The program is organised as a pipeline of cooperating threads:

```
CAN bus (vcan0)
   │  raw frames (struct can_frame)
   ▼
receiver thread ──► ring buffer (4096 slots) ──► decoder threads (x4)
                                                        │
                                                        │  decoded fields
                                                        ▼
                                             VehicleState (mutex-guarded)
                                                        │
                                                        │  snapshot every 16666 µs
                                                        ▼
                                             UDP sender thread ──► 127.0.0.1:4000
```

There are three stages, plus one extra thread that owns the UDP socket.

### 1. Receiver thread

`receiver_can.c` opens a raw `AF_CAN` socket bound to `vcan0` and reads
`struct can_frame`s. Each frame is pushed into a bounded ring buffer.

### 2. Ring buffer

`ring_buffer.c` implements a fixed-size, thread-safe buffer of 4096 raw frames
(`N_FRAMES`). It is protected by a mutex plus two condition variables
(`not_full`, `not_empty`), so producers wait when the buffer is full and
consumers wait when it is empty.

### 3. Decoder threads

Four identical decoder threads (defined in `main.c` as `WORKERS`) pull frames
from the ring buffer and dispatch them through `process_can_frame()`.

The dispatch table (`can_table`, sized for the full 11-bit CAN ID range) maps
each known CAN ID to a wrapper decoder and its expected data length (DLC).
A frame is decoded only if its ID is registered **and** its DLC matches the
expected value.

Each wrapper calls the cantools-generated `unpack`/`decode` functions from
`grand_modus.c` (see below) and writes the extracted values into the global
`VehicleState` under a mutex. Values that fail the unpack or fall outside the
physical range are reported to the console and ignored.

### 4. Vehicle state

`VehicleState` (`can_decoder.h`) is a global struct that wraps
`VehiclePayloadState` together with a `pthread_mutex_t`. The decoder threads
lock it to update fields; the UDP sender locks it to read a snapshot. This is
the single source of truth shared by all threads.

### 5. UDP sender thread

`udp_sender.c` opens a `SOCK_DGRAM` socket and, every 16666 microseconds
(`N60_REFRESH_MS`), locks the vehicle state, copies it into a local snapshot
and sends it to `127.0.0.1:4000`.

The payload is the packed `VehiclePayloadState` struct, which is **21 bytes
long**. It is declared with `#pragma pack(1)`, so there is no padding between
fields. The frontend must unpack this byte layout to read the telemetry.

## The CAN messages

The decode/encode layer is generated from `grand_modus.dbc` by
[cantools](https://cantools.github.io/) version 41.4.1, installed in
`backend/venv/`. The generated files are `include/grand_modus.h` and
`src/grand_modus.c` — do not edit them by hand. If the DBC changes, regenerate
them.

The messages defined in the DBC:

| Message | CAN ID | Length | Decoded fields |
| --- | --- | --- | --- |
| ENGINE | 0x181 | 8 | engine RPM, vehicle speed |
| GEARBOX | 0x215 | 6 | reverse gear |
| CLIMATE | 0x374 | 3 | rear defroster, air conditioning, fan active |
| BRAKES | 0x5C5 | 8 | parking brake |
| LIGHTS_AND_DOORS | 0x60D | 8 | lights, fog lights, turn signals, doors, trunk |
| SAFETY | 0x651 | 2 | seatbelt |

Note: the SAFETY message (0x651) is present in the DBC and generated code, but
is **not yet wired into the decoder dispatch table**, so the seatbelt field is
currently never updated.

The `VehiclePayloadState` struct carries the following fields:

- Engine: `engine_rpm` (uint16), `vehicle_speed` (uint8)
- Brakes: `parking_brake`
- Gearbox: `reverse_gear`
- Climate: `rear_defroster`, `air_conditioning`, `fan_active`
- Lights: `parking_lights`, `low_beam`, `high_beam`, `turn_signal_left`,
  `turn_signal_right`, `front_fog_lights`, `rear_fog_light`
- Doors: `door_driver`, `door_passenger`, `door_rear_left`, `door_rear_right`,
  `trunk`
- Safety: `seatbelt`

## Build

The backend uses a `Makefile` with C11, `-Wall -Wextra` and pthreads:

```bash
make           # compile into build/ and produce the backend binary
make clean     # remove build/ and the binary
```

## Run and test

The receiver binds to `vcan0` and exits if the interface is missing. To run
without a real car, create the virtual interface and replay the bundled
simulator logs (candump format):

```bash
sudo ip link add name vcan0 type vcan
sudo ip link set up vcan0

canplayer -I test/urbano.log        # urban driving simulation
# or send a single frame by hand:
cansend vcan0 181#1910000000000000

./backend
```

The `test/` folder contains the log generators `modus_sim_city.py` and
`modus_sim_highway.py`, plus their pre-generated outputs `urbano.log` and
`autostrada.log`. There are no unit tests.

You can verify the UDP stream with any listener on port 4000, for example the
frontend debug window (see [Music view](music.md)).

## Current limitations

- Only the first five messages are decoded; SAFETY (0x651) is not routed.
- The backend has no command-line options; interface name, port and refresh
  rate are compile-time constants.
- The frontend does not yet parse the UDP payload into the main UI. The only
  consumer today is the debug window.
