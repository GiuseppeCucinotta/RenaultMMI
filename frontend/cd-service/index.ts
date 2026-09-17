import { createLogger } from "../shared/logger.js";
import { resolveConfig } from "./config.js";
import { CdService } from "./service.js";

const logger = createLogger("cd");

async function main(): Promise<void> {
  const config = resolveConfig();
  const service = new CdService(config, { logger });
  await service.start();
  logger.log(config.device ? `device: ${config.device}` : "device: auto-detect (/dev/sr*)");
}

main().catch((error: unknown) => {
  logger.error("failed to start:", error);
  process.exit(1);
});
