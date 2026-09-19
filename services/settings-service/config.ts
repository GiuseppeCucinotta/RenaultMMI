import os from "node:os";
import path from "node:path";

export interface SettingsConfig {
  port: number;
  storePath: string;
}

export function resolveConfig(env: NodeJS.ProcessEnv = process.env): SettingsConfig {
  return {
    port: Number(env.SETTINGS_PORT ?? 4400),
    storePath: path.resolve(
      env.SETTINGS_STORE_PATH ??
        path.join(os.homedir(), ".config", "renault-mmi", "settings.json"),
    ),
  };
}
