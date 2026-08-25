import { resolveConfig } from "./config.js";
import { CdService } from "./service.js";
import { createServer } from "./server.js";
import { logger } from "./logger.js";

const LISTEN_RETRY_MS = 3000;
const LISTEN_MAX_RETRIES = 10;

// An infotainment appliance must not die on a stray rejection bubbling out of
// a dependency (e.g. node-mpv IPC races while mpv is quitting). Log and stay.
// NOTE: server listen failures bypass this via the explicit handler below —
// a zombie without an HTTP listener would autoplay discs nobody can control.
process.on("unhandledRejection", (reason) => {
  logger.error(
    "unhandled rejection (ignored):",
    reason instanceof Error ? reason.stack : reason,
  );
});
process.on("uncaughtException", (error) => {
  logger.error("uncaught exception (ignored):", error.stack ?? error.message);
});

async function main(): Promise<void> {
  const config = resolveConfig();
  const service = new CdService(config);
  const { server } = createServer(service);

  // Retry instead of dying instantly: during development another instance
  // (npm run cd:debug) may briefly hold the port; the Electron-spawned copy
  // should take over once it frees up rather than linger half-alive.
  let attempt = 0;
  server.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code !== "EADDRINUSE") {
      logger.error("server error:", error.message);
      process.exit(1);
    }
    attempt += 1;
    if (attempt > LISTEN_MAX_RETRIES) {
      logger.error(
        `port ${config.port} still busy after ${LISTEN_MAX_RETRIES} retries — exiting`,
      );
      process.exit(1);
    }
    logger.warn(
      `port ${config.port} in use (another cd-service running?) — retry ${attempt}/${LISTEN_MAX_RETRIES}`,
    );
    setTimeout(() => server.listen(config.port, "127.0.0.1"), LISTEN_RETRY_MS);
  });

  server.listen(config.port, "127.0.0.1", () => {
    logger.log(`listening on http://127.0.0.1:${config.port}`);
    logger.log(
      config.device
        ? `device: ${config.device}`
        : "device: auto-detect (/dev/sr*)",
    );
  });

  const shutdown = (signal: string): void => {
    logger.log(`${signal} received — shutting down`);
    void service.stop().finally(() => process.exit(0));
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  try {
    await service.start();
  } catch (error) {
    logger.error(
      "startup error (staying up so /api/health can report it):",
      error instanceof Error ? error.message : error,
    );
  }
}

main().catch((error: unknown) => {
  logger.error("failed to start:", error);
  process.exit(1);
});
