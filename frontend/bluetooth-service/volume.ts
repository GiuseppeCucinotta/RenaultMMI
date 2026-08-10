import { spawn } from "node:child_process";

/**
 * The entertainment volume is applied to the A2DP sink that the phone's audio
 * lands on. This only touches the Bluetooth source's own sink (never the
 * system master), so it keeps working regardless of whether the phone supports
 * AVRCP absolute volume. Requires an audio server exposing `pactl`
 * (PulseAudio, or pipewire-pulse which ships with PipeWire on Raspberry Pi OS).
 */

function runPactl(args: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn("pactl", args, { stdio: "ignore" });
    child.on("error", () => resolve(false));
    child.on("close", (code) => resolve(code === 0));
  });
}

async function findBluezSinkName(): Promise<string | null> {
  return new Promise((resolve) => {
    const child = spawn("pactl", ["list", "sinks", "short"]);
    let stdout = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.on("error", () => resolve(null));
    child.on("close", (code) => {
      if (code !== 0) {
        resolve(null);
        return;
      }
      for (const line of stdout.split("\n")) {
        if (line.includes("bluez_output") || line.includes("bluez_sink")) {
          const name = line.split("\t")[1] ?? null;
          if (name) {
            resolve(name);
            return;
          }
        }
      }
      resolve(null);
    });
  });
}

export async function setBluetoothVolume(percent: number): Promise<boolean> {
  const clamped = Math.max(0, Math.min(100, Math.round(percent)));
  const sink = await findBluezSinkName();
  if (!sink) return false;
  return runPactl(["set-sink-volume", sink, `${clamped}%`]);
}
