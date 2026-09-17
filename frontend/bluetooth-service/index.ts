import { createLogger } from "../shared/logger.js";
import { resolveConfig } from "./config.js";
import { BluetoothService } from "./service.js";

const logger = createLogger("bluetooth");

async function main(): Promise<void> {
  const config = resolveConfig();
  const service = new BluetoothService(config, { logger });
  await service.start();
}

main().catch((error: unknown) => {
  logger.error("failed to start:", error);
  process.exit(1);
});
