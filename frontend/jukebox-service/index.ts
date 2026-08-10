import { resolveConfig } from "./config.js";
import { createServer } from "./server.js";

async function main(): Promise<void> {
  const config = resolveConfig();
  const { server } = await createServer(config);
  server.listen(config.port, "127.0.0.1", () => {
    console.log(`[jukebox] listening on http://127.0.0.1:${config.port}`);
    console.log(`[jukebox] music root: ${config.musicRoot}`);
  });
}

main().catch((error: unknown) => {
  console.error("[jukebox] failed to start:", error);
  process.exit(1);
});
