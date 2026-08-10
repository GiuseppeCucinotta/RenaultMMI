import { resolveConfig } from "./config.js";
import { BlueZClient } from "./bluez.js";
import { BluetoothPlayer } from "./player.js";
import { createServer } from "./server.js";
import { logger } from "./logger.js";

async function main(): Promise<void> {
  const config = resolveConfig();
  const bluez = new BlueZClient();
  const player = new BluetoothPlayer(bluez);
  const { server } = createServer(config, bluez, player);

  server.listen(config.port, "127.0.0.1", () => {
    logger.log(`listening on http://127.0.0.1:${config.port}`);
  });

  try {
    await player.start();
  } catch (error) {
    logger.error(
      "BlueZ unavailable (staying up so /api/health can report it):",
      error instanceof Error ? error.message : error,
    );
  }
}

main().catch((error: unknown) => {
  logger.error("failed to start:", error);
  process.exit(1);
});
