/**
 * Throwaway sixth category used only by the settings tests.
 *
 * It is the adaptivity proof: the registry, the store and the routes must
 * handle it with zero production code changes. It must never be imported by a
 * production module — only files under `test/` may use it.
 */

import type {
  CategoryDef,
  SettingsCategoryId,
} from "../settings-service/types.js";

/**
 * The shipped ids, spelled out on purpose: the fixture must not import the
 * production constant, or the test would follow a change it is meant to notice.
 */
const PRODUCTION_CATEGORY_IDS: readonly SettingsCategoryId[] = [
  "vehicle",
  "trip",
  "audio",
  "connectivity",
  "display",
  "system",
];

/** Complete allowed-id set a registry needs to accept the fixture. */
export const FIXTURE_ALLOWED_IDS: readonly SettingsCategoryId[] = [
  ...PRODUCTION_CATEGORY_IDS,
  "test-fixture",
];

/**
 * Every control kind, a read-only field, and a field gated by `showWhen` on its
 * own toggle. The `step: 0.5` slider and the `step: 5` stepper make snapping
 * and the lattice rule observable.
 */
export const testFixtureCategory: CategoryDef = {
  id: "test-fixture",
  labelKey: "settings.category.test-fixture.label",
  titleKey: "settings.category.test-fixture.title",
  icon: { kind: "lucide", name: "flask-conical" },
  fields: [
    {
      id: "fixtureToggle",
      kind: "toggle",
      labelKey: "settings.test-fixture.fixtureToggle.label",
      helpKey: "settings.test-fixture.fixtureToggle.help",
      default: true,
    },
    {
      id: "fixtureLevel",
      kind: "slider",
      labelKey: "settings.test-fixture.fixtureLevel.label",
      default: 5,
      min: 0,
      max: 10,
      step: 0.5,
    },
    {
      id: "fixtureMode",
      kind: "select",
      labelKey: "settings.test-fixture.fixtureMode.label",
      default: "auto",
      options: [
        { value: "auto", labelKey: "settings.test-fixture.fixtureMode.auto" },
        { value: "manual", labelKey: "settings.test-fixture.fixtureMode.manual" },
      ],
    },
    {
      id: "fixtureRetries",
      kind: "stepper",
      labelKey: "settings.test-fixture.fixtureRetries.label",
      default: 1,
      min: 0,
      max: 4,
      step: 1,
    },
    {
      id: "fixtureLocked",
      kind: "toggle",
      labelKey: "settings.test-fixture.fixtureLocked.label",
      default: false,
      readOnly: true,
    },
    {
      id: "fixtureAdvanced",
      kind: "toggle",
      labelKey: "settings.test-fixture.fixtureAdvanced.label",
      default: false,
      showWhen: { field: "fixtureToggle", equals: true },
    },
  ],
};
