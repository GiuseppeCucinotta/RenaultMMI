import { defineConfig, mergeConfig } from "vite";
import path from "node:path";
import electron from "vite-plugin-electron";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const ROOT = process.cwd();
const esmodule = true;

// vite-plugin-electron only launches Electron from whichever entry finishes
// building LAST (its onstart). The jukebox service is the biggest bundle and
// usually finishes last, so a no-op onstart there would leave the app never
// opening. Routing every entry through the guarded `reload()` (launches
// Electron on first build, hot-reloads the renderer afterwards) makes the
// startup order-independent.
function startOrReload(args: { reload: () => void }) {
  args.reload();
}

function buildMainProcesses() {
  // Preload entry, mirroring the `electronSimple` helper config so it keeps
  // producing `dist-electron/preload.mjs` with sandbox-compatible CJS output.
  const preload = {
    onstart: startOrReload,
    vite: mergeConfig(
      {
        build: {
          rollupOptions: {
            input: path.join(ROOT, "electron/preload.ts"),
            output: {
              format: "cjs",
              inlineDynamicImports: true,
              entryFileNames: `[name].${esmodule ? "mjs" : "js"}`,
              chunkFileNames: `[name].${esmodule ? "mjs" : "js"}`,
              assetFileNames: "[name].[ext]",
            },
          },
        },
      },
      {},
    ),
  };

  const main = {
    entry: "electron/main.ts",
    onstart: startOrReload,
  };

  // Standalone jukebox service (scan + mpv playback + HTTP/SSE API).
  const jukebox = {
    entry: { index: path.join(ROOT, "jukebox-service/index.ts") },
    onstart: startOrReload,
    vite: {
      build: {
        outDir: "dist-electron/jukebox",
        minify: false,
      },
    },
  };

  // Standalone bluetooth service (BlueZ D-Bus bridge + HTTP/SSE API).
  const bluetooth = {
    entry: { index: path.join(ROOT, "bluetooth-service/index.ts") },
    onstart: startOrReload,
    vite: {
      build: {
        outDir: "dist-electron/bluetooth",
        minify: false,
      },
    },
  };

  // Standalone CD service (optical drive watcher + mpv playback + HTTP/SSE API).
  const cd = {
    entry: { index: path.join(ROOT, "cd-service/index.ts") },
    onstart: startOrReload,
    vite: {
      build: {
        outDir: "dist-electron/cd",
        minify: false,
      },
    },
  };

  return electron([main, jukebox, bluetooth, cd, preload]);
}

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(ROOT, "./src"),
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    buildMainProcesses(),
  ],
});
