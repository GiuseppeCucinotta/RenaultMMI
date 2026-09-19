import { createLogger } from "../shared/logger.js";
import { resolveConfig } from "./config.js";
import { SettingsService } from "./service.js";

const logger = createLogger("settings");

async function main(): Promise<void> {
  const config = resolveConfig();
  const service = new SettingsService(config, { logger });
  await service.start();
  logger.log(`store: ${config.storePath}`);
  logger.log(`port: ${config.port}`);
}

main().catch((error: unknown) => {
  logger.error("failed to start:", error);
  process.exit(1);
});
