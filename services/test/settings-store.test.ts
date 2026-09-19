import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createSilentLogger, type Logger } from "../shared/logger.js";
import { audioCategory } from "../settings-service/categories/audio.js";
import { connectivityCategory } from "../settings-service/categories/connectivity.js";
import { vehicleCategory } from "../settings-service/categories/vehicle.js";
import { createRegistry, type SettingsRegistry } from "../settings-service/registry.js";
import { SettingsStore } from "../settings-service/store.js";
import type { SettingsCategoryId, SettingsValues } from "../settings-service/types.js";
import { sleep } from "./support.js";

/* -------------------------------------------------------------------------- */
/* Fixture: a private schema for the store tests (no service, no production    */
/* module involved)                                                            */
/* -------------------------------------------------------------------------- */

const registry: SettingsRegistry = createRegistry(
  [
    vehicleCategory, // toggle, default true
    audioCategory, // slider 0..10 step 1, default 5
    connectivityCategory, // toggle false + stepper 1..5 step 1 default 2
  ],
  ["vehicle", "audio", "connectivity"],
);

const DEFAULTS: Record<SettingsCategoryId, SettingsValues> = {
  vehicle: { demoToggle: true },
  audio: { demoLevel: 5 },
  connectivity: { demoToggle: false, demoRetries: 2 },
};

interface StoreContext {
  root: string;
  file: string;
}

async function withStore(
  run: (store: SettingsStore, ctx: StoreContext, logger: Logger) => Promise<void>,
): Promise<void> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "renault-mmi-settings-store-"));
  const file = path.join(root, "nested", "settings.json");
  const logger = createSilentLogger();
  const store = new SettingsStore({ path: file, logger, registry });

  try {
    await run(store, { root, file }, logger);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function writeFile(file: string, contents: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, contents, "utf8");
}

async function listTempFiles(directory: string): Promise<string[]> {
  const entries = await fs.readdir(directory);
  return entries.filter((entry) => entry.endsWith(".tmp"));
}

/* -------------------------------------------------------------------------- */

test("a missing file loads every category at its schema defaults", async () => {
  await withStore(async (store, { file }) => {
    const loaded = await store.load();
    assert.deepEqual(loaded, DEFAULTS);
    await assert.rejects(fs.stat(file), /ENOENT/);
  });
});

test("values round-trip through the file", async () => {
  await withStore(async (store, { file }) => {
    await store.load();
    store.setCategory("audio", { demoLevel: 8 });
    store.setCategory("connectivity", { demoToggle: true, demoRetries: 4 });
    await store.flush();

    const raw = JSON.parse(await fs.readFile(file, "utf8"));
    assert.equal(raw.version, 1);
    assert.deepEqual(raw.categories.audio, { demoLevel: 8 });
    assert.deepEqual(raw.categories.connectivity, { demoToggle: true, demoRetries: 4 });
    assert.deepEqual(raw.categories.vehicle, { demoToggle: true });
  });
});

test("a fresh store reads back what the first one wrote", async () => {
  await withStore(async (store, { file }) => {
    await store.load();
    store.setCategory("audio", { demoLevel: 3 });
    await store.flush();

    const reopened = new SettingsStore({ path: file, logger: createSilentLogger(), registry });
    const loaded = await reopened.load();
    assert.equal(loaded.audio.demoLevel, 3);
    assert.deepEqual(loaded.vehicle, DEFAULTS.vehicle);
  });
});

test("a corrupt category blob falls back to defaults for that category alone (I6)", async () => {
  await withStore(async (store, { file }, logger) => {
    const warnings: string[] = [];
    logger.warn = (...args: unknown[]) => {
      warnings.push(args.map(String).join(" "));
    };

    await writeFile(
      file,
      JSON.stringify({
        version: 1,
        categories: {
          vehicle: { demoToggle: false },
          audio: "definitely not an object",
          connectivity: { demoToggle: true, demoRetries: 5 },
        },
      }),
    );

    const loaded = await store.load();
    assert.deepEqual(loaded.audio, DEFAULTS.audio, "the corrupt category is at defaults");
    assert.deepEqual(loaded.vehicle, { demoToggle: false }, "the others keep their values");
    assert.deepEqual(loaded.connectivity, { demoToggle: true, demoRetries: 5 });
    assert.equal(
      warnings.some((warning) => warning.includes("audio")),
      true,
      "the corruption is logged",
    );
  });
});

test("a malformed file yields all defaults and never throws", async () => {
  await withStore(async (store, { file }) => {
    await writeFile(file, "{ this is not json");
    assert.deepEqual(await store.load(), DEFAULTS);

    await writeFile(file, JSON.stringify({ version: 1, categories: [1, 2, 3] }));
    assert.deepEqual(await store.load(), DEFAULTS);

    await writeFile(file, JSON.stringify(["nope"]));
    assert.deepEqual(await store.load(), DEFAULTS);

    await writeFile(file, "");
    assert.deepEqual(await store.load(), DEFAULTS);
  });
});

test("stored values are re-normalised on load and a removed field is dropped", async () => {
  await withStore(async (store, { file }, logger) => {
    const warnings: string[] = [];
    logger.warn = (...args: unknown[]) => {
      warnings.push(args.map(String).join(" "));
    };

    await writeFile(
      file,
      JSON.stringify({
        version: 1,
        categories: {
          vehicle: { demoToggle: true, legacyFlag: "gone" },
          // 7.4 -> snapped to 7 by the slider's own lattice
          audio: { demoLevel: 7.4, removedKnob: 12 },
          // off-lattice -> falls back to the default
          connectivity: { demoToggle: "yes", demoRetries: 2.5 },
        },
      }),
    );

    const loaded = await store.load();
    assert.deepEqual(loaded.vehicle, { demoToggle: true }, "the removed field is dropped");
    assert.deepEqual(loaded.audio, { demoLevel: 7 }, "the stored number is re-normalised");
    assert.deepEqual(
      loaded.connectivity,
      DEFAULTS.connectivity,
      "wrong type and off-lattice values fall back to defaults",
    );
    assert.equal(
      warnings.some((warning) => warning.includes("legacyFlag")),
      true,
      "the drop is logged",
    );

    // The drop is persisted on the next write.
    store.setCategory("audio", { demoLevel: 7 });
    await store.flush();
    const raw = JSON.parse(await fs.readFile(file, "utf8"));
    assert.equal("legacyFlag" in raw.categories.vehicle, false);
    assert.equal("removedKnob" in raw.categories.audio, false);
  });
});

test("saves are atomic and leave no temp file behind", async () => {
  await withStore(async (store, { root, file }) => {
    const directory = path.dirname(file);
    await store.load();

    store.setCategory("audio", { demoLevel: 1 });
    await store.flush();
    assert.deepEqual(await listTempFiles(directory), []);

    store.setCategory("audio", { demoLevel: 2 });
    await store.flush();
    assert.deepEqual(await listTempFiles(directory), []);
    assert.deepEqual(await listTempFiles(root), []);

    // The directory is created on demand even when nested.
    assert.deepEqual(JSON.parse(await fs.readFile(file, "utf8")).categories.audio, {
      demoLevel: 2,
    });
  });
});

test("concurrent writes serialise and the last snapshot wins", async () => {
  await withStore(async (store, { file }) => {
    await store.load();

    store.setCategory("audio", { demoLevel: 1 });
    store.setCategory("audio", { demoLevel: 6 });
    store.setCategory("vehicle", { demoToggle: false });
    await sleep(1);
    store.setCategory("audio", { demoLevel: 9 });
    await store.flush();

    const raw = JSON.parse(await fs.readFile(file, "utf8"));
    assert.equal(raw.categories.audio.demoLevel, 9, "the latest snapshot wins");
    assert.equal(raw.categories.vehicle.demoToggle, false);
    assert.deepEqual(raw.categories.connectivity, DEFAULTS.connectivity);
    assert.deepEqual(await listTempFiles(path.dirname(file)), []);
  });
});

test("a failed save is reported by flush and does not wedge later writes", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "renault-mmi-settings-store-broken-"));
  const blocker = path.join(root, "blocker");
  await fs.writeFile(blocker, "not a directory", "utf8");

  try {
    const store = new SettingsStore({
      path: path.join(blocker, "settings.json"),
      logger: createSilentLogger(),
      registry,
    });
    await store.load();

    store.setCategory("audio", { demoLevel: 4 });
    await assert.rejects(store.flush(), /EEXIST|ENOTDIR|not a directory/i);

    // Sanity: the in-RAM snapshot still holds the attempted value.
    assert.equal(store.snapshot().audio.demoLevel, 4);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("snapshot never leaks the live object", async () => {
  await withStore(async (store) => {
    await store.load();
    const snapshot = store.snapshot();
    snapshot.audio.demoLevel = 10;
    assert.equal(store.snapshot().audio.demoLevel, 5);
  });
});
