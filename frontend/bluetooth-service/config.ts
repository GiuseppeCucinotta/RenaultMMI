import os from "node:os";
import path from "node:path";

export interface BluetoothConfig {
  port: number;
  artworkDir: string;
}

export function resolveConfig(env: NodeJS.ProcessEnv = process.env): BluetoothConfig {
  return {
    port: Number(env.BLUETOOTH_PORT ?? 4200),
    artworkDir: env.BLUETOOTH_ARTWORK_DIR ?? path.join(os.tmpdir(), "renault-mmi-artwork"),
  };
}
