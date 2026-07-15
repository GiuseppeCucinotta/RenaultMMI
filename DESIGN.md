# DESIGN.md - Linux Infotainment System

## 1. System Overview

This project is a custom Infotainment System built with **Electron**, running on a **Linux** environment (specifically optimized for **Raspberry Pi 5**).

The system serves as the central digital cockpit for a vehicle, providing media playback, vehicle telemetry, and navigation controls. The design philosophy prioritizes readability, low latency, and a distinct "warm" digital aesthetic that differentiates it from the standard "cold" blue/black themes common in automotive UIs.

## 2. Typography

The entire interface utilizes a single typeface to maintain consistency and a futuristic, geometric feel.

- **Primary Font:** `Chakra Petch` (Regular weight)
- **Usage:**
  - **Headers/Labels:** Uppercase, tracked out slightly for a technical readout feel.
  - **Media Info:** Bold weights for Song Title/Artist.
  - **Monospaced elements:** Used for numerical data (Time, Temperature, Consumption) to align digits vertically.

## 3. Color Palette (Amber Scale)

The design relies on a monochromatic Amber scale, similar to Tailwind CSS. The interface uses **Amber 950** (or near-black) for the background to reduce eye strain, with **Amber 500** as the primary accent color for interactions and active states.

### Palette Reference (50-950)

- **50 (HSL: 39, 100, 96%):** Primary Text, Highlights.
- **100 (HSL: 38, 96, 89%):** Secondary Text (Weather, Time).
- **200 (HSL: 38, 97, 77%):** Borders, Dividers.
- **300 (HSL: 38, 97, 65%):** Status Icons (Fuel, Consumption).
- **400 (HSL: 38, 96, 56%):** Secondary Icons.
- **500 (Primary) (HSL: 38, 92, 50%):** **Main Action Color.** Used for active navigation icons, play buttons, and key data points.
- **600 (HSL: 38, 95, 44%):** Pressed states.
- **700 (HSL: 38, 90, 37%):** Inactive Icons (low opacity).
- **800 (HSL: 38, 83, 31%):** Shadows, Depth.
- **900 (HSL: 38, 78, 26%):** Darker surfaces.
- **950 (HSL: 37, 92, 14%):** **Base Background.**
