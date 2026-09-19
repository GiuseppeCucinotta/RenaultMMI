import { defineConfig, mergeConfig } from "vite";
import path from "node:path";
import { createRequire } from "node:module";
import electron from "vite-plugin-electron";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const ROOT = process.cwd();
const esmodule = true;

const require = createRequire(path.join(ROOT, "package.json"));
// vite-plugin-electron resolves `electron` from its own location, but npm
// workspaces hoist the plugin to the repo root while `electron` stays under
// frontend/node_modules. Resolve the package from here and hand the absolute
// entry path to the plugin's startup() so the launch never depends on layout.
const ELECTRON_ENTRY = require.resolve("electron");

interface ElectronOnstartArgs {
  reload: () => void;
  startup: (
    argv?: string[],
    options?: import("node:child_process").SpawnOptions,
    customElectronPkg?: string,
  ) => Promise<void>;
}

// vite-plugin-electron only launches Electron from whichever entry finishes
// building LAST (its onstart). Both entries share this guarded starter so the
// startup order does not matter: the first call launches Electron, later calls
// only hot-reload the renderer.
//
// The four service bundles are built separately by the `services` workspace
// (`services/scripts/build.mjs`); Electron spawns them from `services/dist`.
let electronLaunched = false;

function startOrReload(args: ElectronOnstartArgs): void {
  if (!electronLaunched) {
    electronLaunched = true;
    void args.startup([".", "--no-sandbox"], {}, ELECTRON_ENTRY);
    return;
  }
  // `reload()` falls back to a bare `startup()` when the app is not running yet,
  // which would resolve the plugin-relative `electron` again — only reload once
  // the child exists.
  if ((process as unknown as { electronApp?: unknown }).electronApp) {
    args.reload();
  }
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

  return electron([main, preload]);
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
