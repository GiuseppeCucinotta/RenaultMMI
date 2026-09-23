import { createLogger } from "../shared/logger.js";
import { resolveConfig } from "./config.js";
import { TripService } from "./service.js";

const logger = createLogger("trip");

/**
 * Entry point for the bundled service.
 *
 * The settings service is discovered through `SETTINGS_BASE_URL`; when it is
 * absent the engine runs on defaults plus its own cached snapshot, so the trip
 * service is useful on its own.
 */
async function main(): Promise<void> {
  const config = resolveConfig();
  const settingsBaseUrl = process.env.SETTINGS_BASE_URL?.trim() || undefined;

  const service = new TripService(config, {
    logger,
    ...(settingsBaseUrl ? { settingsBaseUrl } : {}),
  });

  await service.start();
  logger.log(`listening on http://127.0.0.1:${service.port}`);
  if (config.devMode) logger.log("dev endpoints enabled: POST /api/dev/simulation");
}

main().catch((error: unknown) => {
  logger.error("failed to start:", error);
  process.exit(1);
});
