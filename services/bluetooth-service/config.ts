import os from "node:os";
import path from "node:path";

export interface BluetoothConfig {
  port: number;
  artworkDir: string;
  /** List computers/headsets too, for debugging a phone that hides its class. */
  showAllDevices: boolean;
}

export function resolveConfig(env: NodeJS.ProcessEnv = process.env): BluetoothConfig {
  return {
    port: Number(env.BLUETOOTH_PORT ?? 4200),
    artworkDir: env.BLUETOOTH_ARTWORK_DIR ?? path.join(os.tmpdir(), "renault-mmi-artwork"),
    showAllDevices: env.BLUETOOTH_SHOW_ALL_DEVICES === "1",
  };
}
