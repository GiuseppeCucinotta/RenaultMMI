export interface BluetoothConfig {
  port: number;
}

export function resolveConfig(env: NodeJS.ProcessEnv = process.env): BluetoothConfig {
  return {
    port: Number(env.BLUETOOTH_PORT ?? 4200),
  };
}
