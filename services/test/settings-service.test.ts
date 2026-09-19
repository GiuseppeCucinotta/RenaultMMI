import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createSilentLogger } from "../shared/logger.js";
import type { ServiceSettings } from "../shared/service-http.js";
import { vehicleCategory } from "../settings-service/categories/vehicle.js";
import { createRegistry } from "../settings-service/registry.js";
import { SettingsStore } from "../settings-service/store.js";
import type {
  CategoryDef,
  FieldDef,
  SettingsValues,
} from "../settings-service/types.js";
import { testFixtureCategory } from "./settings-fixture.js";
import {
  apiPatch,
  apiPostRaw,
  FIXTURE_REGISTRY,
  PRODUCTION_CATEGORY_IDS,
  PRODUCTION_CATEGORIES,
  uniqueStorePath,
  withFixtureService,
  withSettingsService,
} from "./settings-support.js";
import { apiGet, apiPost } from "./support.js";

/* -------------------------------------------------------------------------- */
/* Body shapes                                                                */
/* -------------------------------------------------------------------------- */

interface CategoriesBody {
  categories: CategoryDef[];
}

interface ValuesBody {
  values: Record<string, SettingsValues>;
}

interface CategoryValuesBody {
  categoryId: string;
  values: SettingsValues;
}

interface SettingsBody {
  settings: ServiceSettings;
  phase: string;
  suspended: boolean;
}

interface HealthBody {
  ok: boolean;
  service: string;
  phase: string;
  suspended: boolean;
}

interface ErrorBody {
  error: string;
}

/* -------------------------------------------------------------------------- */
/* Registry construction                                                      */
/* -------------------------------------------------------------------------- */

/** A field definition with every required key, so overrides stay typed. */
function field(overrides: Partial<FieldDef> & Pick<FieldDef, "id" | "kind">): FieldDef {
  return {
    labelKey: `settings.test.${overrides.id}`,
    default: true,
    ...overrides,
  } as FieldDef;
}

function fixture(overrides: Partial<CategoryDef> = {}): CategoryDef {
  return {
    id: "test-fixture",
    labelKey: "settings.category.test-fixture.label",
    titleKey: "settings.category.test-fixture.title",
    icon: { kind: "lucide", name: "flask-conical" },
    fields: [field({ id: "toggle", kind: "toggle" })],
    ...overrides,
  };
}

function rejectsFixture(overrides: Partial<CategoryDef>, pattern: RegExp): void {
  assert.throws(
    () => createRegistry([fixture(overrides)], ["test-fixture"]),
    pattern,
  );
}

test("registry accepts the five shipped categories in order", () => {
  const registry = createRegistry(PRODUCTION_CATEGORIES);
  assert.deepEqual(
    registry.categories.map((category) => category.id),
    [...PRODUCTION_CATEGORY_IDS],
  );
  assert.equal(registry.byId.size, 5);
  assert.equal(registry.byId.get("audio")?.titleKey, "settings.category.audio.title");
});

test("registry rejects an empty category list", () => {
  assert.throws(() => createRegistry([], ["vehicle"]), /at least one category/);
});

test("registry rejects a duplicate category id", () => {
  assert.throws(
    () => createRegistry([vehicleCategory, vehicleCategory], ["vehicle"]),
    /duplicate settings category id "vehicle"/,
  );
});

test("registry rejects a category outside the allowed set", () => {
  assert.throws(
    () => createRegistry([fixture()], PRODUCTION_CATEGORY_IDS),
    /unknown settings category id "test-fixture"/,
  );
});

test("registry rejects a missing category", () => {
  assert.throws(
    () => createRegistry([vehicleCategory], ["vehicle", "audio"]),
    /missing settings category "audio"/,
  );
});

test("registry rejects a duplicate field id", () => {
  rejectsFixture(
    {
      fields: [
        field({ id: "dup", kind: "toggle" }),
        field({ id: "dup", kind: "toggle" }),
      ],
    },
    /duplicate field id "dup" in category "test-fixture"/,
  );
});

test("registry rejects showWhen referencing a field in another category (I2)", () => {
  const vehicle = {
    ...vehicleCategory,
    fields: [field({ id: "vehicleOnly", kind: "toggle" })],
  };

  assert.throws(
    () =>
      createRegistry(
        [
          vehicle,
          fixture({
            fields: [
              field({ id: "toggle", kind: "toggle" }),
              field({
                id: "gated",
                kind: "toggle",
                showWhen: { field: "vehicleOnly", equals: true },
              }),
            ],
          }),
        ],
        [vehicle.id, "test-fixture"],
      ),
    /references unknown field "vehicleOnly"/,
  );
});

test("registry accepts a same-category showWhen", () => {
  const registry = createRegistry(
    [
      fixture({
        fields: [
          field({ id: "toggle", kind: "toggle" }),
          field({ id: "gated", kind: "toggle", showWhen: { field: "toggle", equals: true } }),
        ],
      }),
    ],
    ["test-fixture"],
  );
  assert.equal(registry.byId.get("test-fixture")?.fields.length, 2);
});

test("registry rejects an invalid default value", () => {
  rejectsFixture(
    { fields: [field({ id: "level", kind: "slider", default: 99, min: 0, max: 10, step: 1 })] },
    /must be between 0 and 10/,
  );
  rejectsFixture(
    { fields: [field({ id: "level", kind: "slider", default: 2.5, min: 0, max: 10, step: 1 })] },
    /not on its step lattice/,
  );
  rejectsFixture(
    { fields: [field({ id: "toggle", kind: "toggle", default: "yes" as unknown as boolean })] },
    /expects a boolean/,
  );
});

test("registry rejects min > max", () => {
  rejectsFixture(
    { fields: [field({ id: "level", kind: "slider", default: 5, min: 10, max: 0, step: 1 })] },
    /min > max/,
  );
});

test("registry rejects a non-positive step", () => {
  rejectsFixture(
    { fields: [field({ id: "level", kind: "slider", default: 0, min: 0, max: 10, step: 0 })] },
    /non-positive step/,
  );
  rejectsFixture(
    { fields: [field({ id: "count", kind: "stepper", default: 0, min: 0, max: 10, step: -1 })] },
    /non-positive step/,
  );
});

test("registry rejects empty select options", () => {
  rejectsFixture(
    { fields: [field({ id: "mode", kind: "select", default: "a", options: [] })] },
    /has no options/,
  );
});

test("registry rejects a select default that is not an option", () => {
  rejectsFixture(
    {
      fields: [
        field({
          id: "mode",
          kind: "select",
          default: "nope",
          options: [{ value: "a", labelKey: "a" }],
        }),
      ],
    },
    /expects one of: a/,
  );
});

test("registry rejects a group entry that is not in the flat field list", () => {
  rejectsFixture(
    {
      groups: [
        {
          id: "g",
          fields: [field({ id: "stray", kind: "toggle" })],
        },
      ],
    },
    /references unknown field "stray"/,
  );
});

/* -------------------------------------------------------------------------- */
/* Schema endpoints                                                           */
/* -------------------------------------------------------------------------- */

test("GET /api/categories returns the schema with constraints and no values", async () => {
  await withSettingsService({}, async ({ base }) => {
    const response = await apiGet<CategoriesBody>(`${base}/api/categories`);
    assert.equal(response.status, 200);
    assert.deepEqual(
      response.body.categories.map((category) => category.id),
      [...PRODUCTION_CATEGORY_IDS],
    );

    const audio = response.body.categories.find((category) => category.id === "audio");
    const slider = audio?.fields.find((candidate) => candidate.id === "demoLevel");
    assert.deepEqual(slider, {
      id: "demoLevel",
      kind: "slider",
      labelKey: "settings.audio.demoLevel.label",
      helpKey: "settings.audio.demoLevel.help",
      default: 5,
      min: 0,
      max: 10,
      step: 1,
    });

    const display = response.body.categories.find((category) => category.id === "display");
    const select = display?.fields.find((candidate) => candidate.id === "demoTheme");
    assert.equal(select?.kind, "select");
    assert.deepEqual(
      select?.kind === "select" ? select.options.map((option) => option.value) : [],
      ["dark", "light", "auto"],
    );

    const system = response.body.categories.find((category) => category.id === "system");
    assert.equal(system?.fields[0]?.readOnly, true);

    assert.equal("values" in response.body, false, "the schema carries no values");
  });
});

test("GET /api/values returns every category and GET /api/values/:id one", async () => {
  await withSettingsService({}, async ({ base }) => {
    const all = await apiGet<ValuesBody>(`${base}/api/values`);
    assert.equal(all.status, 200);
    assert.deepEqual(Object.keys(all.body.values), [...PRODUCTION_CATEGORY_IDS]);
    assert.deepEqual(all.body.values.audio, { demoLevel: 5 });
    assert.deepEqual(all.body.values.display, { demoTheme: "dark" });

    const one = await apiGet<CategoryValuesBody>(`${base}/api/values/connectivity`);
    assert.equal(one.status, 200);
    assert.equal(one.body.categoryId, "connectivity");
    assert.deepEqual(one.body.values, { demoToggle: false, demoRetries: 2 });

    const unknown = await apiGet<ErrorBody>(`${base}/api/values/nope`);
    assert.equal(unknown.status, 404);
    assert.match(unknown.body.error, /nope/);
  });
});

test("GET /api/state exposes schema plus values, GET /api/health is the settings service", async () => {
  await withSettingsService({}, async ({ base }) => {
    const state = await apiGet<{ categories: CategoryDef[]; values: ValuesBody["values"] }>(
      `${base}/api/state`,
    );
    assert.equal(state.status, 200);
    assert.equal(state.body.categories.length, 5);
    assert.deepEqual(state.body.values.vehicle, { demoToggle: true });

    const health = await apiGet<HealthBody>(`${base}/api/health`);
    assert.equal(health.body.ok, true);
    assert.equal(health.body.service, "settings");
    assert.equal(health.body.phase, "running");
  });
});

/* -------------------------------------------------------------------------- */
/* PATCH validation matrix                                                    */
/* -------------------------------------------------------------------------- */

test("PATCH rejects an unknown category with 404", async () => {
  await withSettingsService({}, async ({ base }) => {
    const response = await apiPatch<ErrorBody>(`${base}/api/values/nope`, { values: {} });
    assert.equal(response.status, 404);
  });
});

test("PATCH rejects an unknown field id with 400 naming it", async () => {
  await withSettingsService({}, async ({ base }) => {
    const response = await apiPatch<ErrorBody>(`${base}/api/values/audio`, {
      values: { ghost: 1 },
    });
    assert.equal(response.status, 400);
    assert.match(response.body.error, /ghost/);
  });
});

test("PATCH rejects a read-only field with 400 naming it", async () => {
  await withSettingsService({}, async ({ base }) => {
    const response = await apiPatch<ErrorBody>(`${base}/api/values/system`, {
      values: { demoBuildLocked: true },
    });
    assert.equal(response.status, 400);
    assert.match(response.body.error, /demoBuildLocked/);
    assert.equal(
      (await apiGet<CategoryValuesBody>(`${base}/api/values/system`)).body.values.demoBuildLocked,
      false,
    );
  });
});

test("PATCH rejects wrong types with 400 and never mutates", async () => {
  await withSettingsService({}, async ({ base }) => {
    assert.equal(
      (await apiPatch<ErrorBody>(`${base}/api/values/vehicle`, { values: { demoToggle: "yes" } }))
        .status,
      400,
    );
    assert.equal(
      (await apiPatch<ErrorBody>(`${base}/api/values/audio`, { values: { demoLevel: "5" } }))
        .status,
      400,
    );
    assert.equal(
      (await apiPatch<ErrorBody>(`${base}/api/values/audio`, { values: { demoLevel: null } }))
        .status,
      400,
    );
    assert.equal(
      (await apiPatch<ErrorBody>(`${base}/api/values/audio`, { values: { demoLevel: Infinity } }))
        .status,
      400,
    );
    assert.equal(
      (await apiPatch<ErrorBody>(`${base}/api/values/display`, { values: { demoTheme: 7 } })).status,
      400,
    );

    assert.deepEqual((await apiGet<CategoryValuesBody>(`${base}/api/values/vehicle`)).body.values, {
      demoToggle: true,
    });
    assert.deepEqual((await apiGet<CategoryValuesBody>(`${base}/api/values/audio`)).body.values, {
      demoLevel: 5,
    });
  });
});

test("PATCH snaps a slider step, rejects a half step and rejects out-of-range", async () => {
  await withSettingsService({}, async ({ base }) => {
    const exact = await apiPatch<CategoryValuesBody>(`${base}/api/values/audio`, {
      values: { demoLevel: 7 },
    });
    assert.equal(exact.status, 200);
    assert.equal(exact.body.values.demoLevel, 7);

    // 7.4 -> 7: a slider track legitimately lands between steps.
    const snapped = await apiPatch<CategoryValuesBody>(`${base}/api/values/audio`, {
      values: { demoLevel: 7.4 },
    });
    assert.equal(snapped.status, 200);
    assert.equal(snapped.body.values.demoLevel, 7);

    // Out of range is rejected, never clamped: a caller must not be able to
    // learn that "42" became "10" (spec §6.5).
    const low = await apiPatch<{ error: string }>(`${base}/api/values/audio`, {
      values: { demoLevel: -3 },
    });
    assert.equal(low.status, 400);
    assert.match(low.body.error, /demoLevel/);

    const high = await apiPatch<{ error: string }>(`${base}/api/values/audio`, {
      values: { demoLevel: 42 },
    });
    assert.equal(high.status, 400);

    // A rejected write changes nothing.
    const after = await apiGet<CategoryValuesBody>(`${base}/api/values/audio`);
    assert.equal(after.body.values.demoLevel, 7);
  });
});

test("PATCH rejects a stepper value off the lattice with 400", async () => {
  await withSettingsService({}, async ({ base }) => {
    const offLattice = await apiPatch<ErrorBody>(`${base}/api/values/connectivity`, {
      values: { demoRetries: 2.5 },
    });
    assert.equal(offLattice.status, 400);
    assert.match(offLattice.body.error, /demoRetries/);

    const outOfRange = await apiPatch<ErrorBody>(`${base}/api/values/connectivity`, {
      values: { demoRetries: 9 },
    });
    assert.equal(outOfRange.status, 400);

    const onLattice = await apiPatch<CategoryValuesBody>(`${base}/api/values/connectivity`, {
      values: { demoRetries: 4 },
    });
    assert.equal(onLattice.status, 200);
    assert.equal(onLattice.body.values.demoRetries, 4);
  });
});

test("PATCH rejects a select value outside its options with 400", async () => {
  await withSettingsService({}, async ({ base }) => {
    const response = await apiPatch<ErrorBody>(`${base}/api/values/display`, {
      values: { demoTheme: "neon" },
    });
    assert.equal(response.status, 400);
    assert.match(response.body.error, /demoTheme/);
  });
});

test("PATCH rejects a missing or non-object `values` with 400", async () => {
  await withSettingsService({}, async ({ base }) => {
    assert.equal((await apiPatch<ErrorBody>(`${base}/api/values/audio`, {})).status, 400);
    assert.equal(
      (await apiPatch<ErrorBody>(`${base}/api/values/audio`, { values: 5 })).status,
      400,
    );
    assert.equal(
      (await apiPatch<ErrorBody>(`${base}/api/values/audio`, { values: [1, 2] })).status,
      400,
    );
    assert.equal(
      (await apiPatch<ErrorBody>(`${base}/api/values/audio`, { values: null })).status,
      400,
    );
  });
});

test("PATCH with malformed JSON is a 400 from the shared router", async () => {
  await withSettingsService({}, async ({ base }) => {
    // `/api/settings` is the base router's body-reading POST surface; the
    // settings routes are PATCH/POST-without-body, so this is where a caller's
    // broken JSON is exercised end to end.
    const response = await apiPostRaw<ErrorBody>(`${base}/api/settings`, "{nope");
    assert.equal(response.status, 400);
    assert.equal(
      (await apiGet<SettingsBody>(`${base}/api/settings`)).body.settings.autoSuspend,
      false,
    );
  });
});

test("GET on the reset route is a 405 and an unknown route is a 404", async () => {
  await withSettingsService({}, async ({ base }) => {
    assert.equal((await apiGet<ErrorBody>(`${base}/api/values/audio/reset`)).status, 405);
    assert.equal((await apiGet<ErrorBody>(`${base}/api/unknown`)).status, 404);
    assert.equal((await apiGet<ErrorBody>(`${base}/api/values/audio/extra`)).status, 404);
    assert.equal((await apiPatch<ErrorBody>(`${base}/api/values`, { values: {} })).status, 405);
  });
});

/* -------------------------------------------------------------------------- */
/* Merge, hidden fields, reset                                                */
/* -------------------------------------------------------------------------- */

test("a partial PATCH merges and always returns the full normalised set", async () => {
  await withSettingsService({}, async ({ base }) => {
    const first = await apiPatch<CategoryValuesBody>(`${base}/api/values/connectivity`, {
      values: { demoToggle: true },
    });
    assert.equal(first.status, 200);
    assert.deepEqual(first.body.values, { demoToggle: true, demoRetries: 2 });

    const second = await apiPatch<CategoryValuesBody>(`${base}/api/values/connectivity`, {
      values: { demoRetries: 5 },
    });
    assert.deepEqual(second.body.values, { demoToggle: true, demoRetries: 5 });
  });
});

test("a hidden showWhen field is still writable", async () => {
  await withFixtureService(async ({ base }) => {
    // `fixtureAdvanced` is gated on `fixtureToggle === true`; turn the gate off.
    await apiPatch(`${base}/api/values/test-fixture`, { values: { fixtureToggle: false } });

    const hidden = await apiPatch<CategoryValuesBody>(`${base}/api/values/test-fixture`, {
      values: { fixtureAdvanced: true },
    });
    assert.equal(hidden.status, 200);
    assert.equal(hidden.body.values.fixtureAdvanced, true);
  });
});

test("reset restores exactly the schema defaults", async () => {
  await withSettingsService({}, async ({ base }) => {
    await apiPatch(`${base}/api/values/display`, { values: { demoTheme: "light" } });
    await apiPatch(`${base}/api/values/audio`, { values: { demoLevel: 9 } });

    const reset = await apiPost<CategoryValuesBody>(`${base}/api/values/display/reset`, {});
    assert.equal(reset.status, 200);
    assert.deepEqual(reset.body.values, { demoTheme: "dark" });

    // The other category is untouched.
    assert.deepEqual((await apiGet<CategoryValuesBody>(`${base}/api/values/audio`)).body.values, {
      demoLevel: 9,
    });

    const unknown = await apiPost<ErrorBody>(`${base}/api/values/nope/reset`, {});
    assert.equal(unknown.status, 404);
  });
});

/* -------------------------------------------------------------------------- */
/* Persistence, lifecycle, adaptivity                                         */
/* -------------------------------------------------------------------------- */

test("values persist across a service restart on the same store path", async () => {
  const storePath = uniqueStorePath("restart");
  try {
    await withSettingsService({ storePath }, async ({ base }) => {
      await apiPatch(`${base}/api/values/audio`, { values: { demoLevel: 9 } });
      await apiPatch(`${base}/api/values/display`, { values: { demoTheme: "auto" } });
    });

    await withSettingsService({ storePath }, async ({ base }) => {
      assert.deepEqual((await apiGet<CategoryValuesBody>(`${base}/api/values/audio`)).body.values, {
        demoLevel: 9,
      });
      assert.deepEqual((await apiGet<CategoryValuesBody>(`${base}/api/values/display`)).body.values, {
        demoTheme: "auto",
      });
    });
  } finally {
    await fs.rm(storePath, { force: true });
  }
});

test("POST /api/settings {suspended:true} works and a PATCH auto-resumes", async () => {
  await withSettingsService({}, async ({ service, base }) => {
    const suspended = await apiPost<SettingsBody>(`${base}/api/settings`, { suspended: true });
    assert.equal(suspended.status, 200);
    assert.equal(suspended.body.suspended, true);
    assert.equal(suspended.body.phase, "suspended");

    // Health polling must never wake it.
    await apiGet(`${base}/api/health`);
    assert.equal(service.currentPhase, "suspended");

    const patched = await apiPatch<CategoryValuesBody>(`${base}/api/values/audio`, {
      values: { demoLevel: 3 },
    });
    assert.equal(patched.status, 200);
    assert.equal(patched.body.values.demoLevel, 3);
    assert.equal(service.currentPhase, "running");
  });
});

test("a failed save is a 500 and rolls the in-RAM values back", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "renault-mmi-settings-broken-"));
  // A regular file where the store's parent directory should be: mkdir fails.
  const blocker = path.join(directory, "blocker");
  await fs.writeFile(blocker, "not a directory", "utf8");

  try {
    await withSettingsService(
      { storePath: path.join(blocker, "settings.json") },
      async ({ base }) => {
        assert.deepEqual((await apiGet<ValuesBody>(`${base}/api/values`)).body.values.audio, {
          demoLevel: 5,
        });

        const failed = await apiPatch<ErrorBody>(`${base}/api/values/audio`, {
          values: { demoLevel: 2 },
        });
        assert.equal(failed.status, 500);
        assert.match(failed.body.error, /could not save settings/);

        // Nothing changed: the request is atomic even when persistence fails.
        assert.deepEqual((await apiGet<CategoryValuesBody>(`${base}/api/values/audio`)).body.values, {
          demoLevel: 5,
        });
      },
    );
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("an injected store is used as-is and flushed on stop", async () => {
  const storePath = uniqueStorePath("injected");
  const store = new SettingsStore({
    path: storePath,
    logger: createSilentLogger(),
    registry: FIXTURE_REGISTRY,
  });

  try {
    await withSettingsService({ store, registry: FIXTURE_REGISTRY }, async ({ base }) => {
      const patched = await apiPatch<CategoryValuesBody>(`${base}/api/values/test-fixture`, {
        values: { fixtureRetries: 4 },
      });
      assert.equal(patched.status, 200);
      assert.equal(patched.body.values.fixtureRetries, 4);
    });

    // `onStop` flushed the pending write into the injected store's file.
    const raw = JSON.parse(await fs.readFile(storePath, "utf8"));
    assert.equal(raw.categories["test-fixture"].fixtureRetries, 4);
  } finally {
    await fs.rm(storePath, { force: true });
  }
});

test("the sixth fixture category flows through every route unchanged", async () => {
  await withSettingsService({ registry: FIXTURE_REGISTRY }, async ({ base }) => {
    const categories = await apiGet<CategoriesBody>(`${base}/api/categories`);
    assert.deepEqual(
      categories.body.categories.map((category) => category.id),
      [...PRODUCTION_CATEGORY_IDS, "test-fixture"],
    );

    const all = await apiGet<ValuesBody>(`${base}/api/values`);
    assert.deepEqual(all.body.values["test-fixture"], {
      fixtureToggle: true,
      fixtureLevel: 5,
      fixtureMode: "auto",
      fixtureRetries: 1,
      fixtureLocked: false,
      fixtureAdvanced: false,
    });

    const patched = await apiPatch<CategoryValuesBody>(`${base}/api/values/test-fixture`, {
      values: { fixtureLevel: 7.26, fixtureMode: "manual", fixtureRetries: 3 },
    });
    assert.equal(patched.status, 200);
    assert.equal(patched.body.values.fixtureLevel, 7.5, "slider snapped to its own lattice");
    assert.equal(patched.body.values.fixtureMode, "manual");
    assert.equal(patched.body.values.fixtureRetries, 3);
    assert.equal(patched.body.values.fixtureLocked, false);

    const locked = await apiPatch<ErrorBody>(`${base}/api/values/test-fixture`, {
      values: { fixtureLocked: true },
    });
    assert.equal(locked.status, 400);
  });
});

/* -------------------------------------------------------------------------- */
/* Store unit level (registry-driven behaviour lives in settings-store.test)  */
/* -------------------------------------------------------------------------- */

test("the registry drops unknown ids and keeps registered ones", () => {
  const registry = createRegistry(PRODUCTION_CATEGORIES);
  const filtered = registry.values({
    vehicle: { demoToggle: false },
    ghost: { whatever: 1 },
  });
  assert.deepEqual(filtered, { vehicle: { demoToggle: false } });

  // A copy, never the live object.
  filtered.vehicle.demoToggle = true;
  assert.equal(
    registry.values({ vehicle: { demoToggle: false } }).vehicle.demoToggle,
    false,
  );
});

test("fixture category definition stays valid and isolated", () => {
  assert.equal(testFixtureCategory.id, "test-fixture");
  assert.equal(
    testFixtureCategory.fields.some((candidate) => candidate.readOnly === true),
    true,
  );
  assert.equal(
    testFixtureCategory.fields.some((candidate) => candidate.showWhen !== undefined),
    true,
  );
});
