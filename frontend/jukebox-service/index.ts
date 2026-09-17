import { createLogger } from "../shared/logger.js";
import { resolveConfig } from "./config.js";
import { JukeboxService } from "./service.js";

const logger = createLogger("jukebox");

async function main(): Promise<void> {
  const config = resolveConfig();
  const service = new JukeboxService(config, { logger });
  await service.start();
}

main().catch((error: unknown) => {
  logger.error("failed to start:", error);
  process.exit(1);
});
