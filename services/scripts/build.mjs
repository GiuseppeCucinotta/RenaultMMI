/**
 * Builds the four service bundles into `services/dist/<name>/index.js`.
 *
 * Uses vite-plugin-electron's programmatic `build()` so the services get the
 * exact same Node bundling rules as the Electron main process (node builtins
 * external, npm dependencies bundled) without launching anything.
 *
 * `node scripts/build.mjs --watch` keeps rebuilding on change; the Electron
 * dev watcher (`frontend/electron/dev-watch.ts`) restarts the affected child.
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite-plugin-electron";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// vite-plugin-electron decides ESM vs CJS from the cwd package.json.
process.chdir(root);

const watch = process.argv.includes("--watch");

// dbus-next requires the optional, uninstalled `x11` package from a code path it
// expects to be null; without the alias the bundler hoists it to a top-level
// import and the bluetooth service dies at load. See scripts/x11-stub.mjs.
const X11_STUB = path.join(root, "scripts", "x11-stub.mjs");

const services = [
  { name: "jukebox", entry: "jukebox-service/index.ts" },
  { name: "bluetooth", entry: "bluetooth-service/index.ts" },
  { name: "cd", entry: "cd-service/index.ts" },
  { name: "settings", entry: "settings-service/index.ts" },
];

for (const { name, entry } of services) {
  const result = await build({
    entry: { index: path.join(root, entry) },
    vite: {
      resolve: {
        alias: { x11: X11_STUB },
      },
      build: {
        outDir: path.join(root, "dist", name),
        emptyOutDir: true,
        minify: false,
        watch: watch ? {} : null,
      },
    },
  });

  if (watch && result && typeof result.on === "function") {
    result.on("event", (event) => {
      if (event.code === "ERROR") {
        console.error(`[services] ${name}: build failed`, event.error);
      } else if (event.code === "BUNDLE_END") {
        console.log(`[services] ${name}: rebuilt`);
      }
    });
  }
}

// The bundles are ESM. The packaged app copies `dist/` to `resources/services`,
// outside any workspace, so the module marker has to travel with them or Node
// parses `index.js` as CommonJS.
writeFileSync(
  path.join(root, "dist", "package.json"),
  `${JSON.stringify({ type: "module" }, null, 2)}\n`,
);

console.log(`[services] ${watch ? "watching" : "built"} ${services.length} bundles in services/dist`);
