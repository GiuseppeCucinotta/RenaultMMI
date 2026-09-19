import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isFieldVisible,
  planCategories,
  type Translate,
} from "@/lib/settings-layout";
import type {
  CategoryDef,
  FieldDef,
  SettingsValues,
} from "@/types/settings";

/**
 * Identity translate: mimics `t()` when a message is missing (it returns the
 * key). Every label therefore arrives through the last-segment fallback, which
 * is exactly the degradation we want to pin down.
 */
const identityT: Translate = (key) => key;

/** Translate with an explicit dictionary, for the "real message" case. */
function dictionaryT(messages: Record<string, string>): Translate {
  return (key) => messages[key] ?? key;
}

function toggle(id: string, extra: Partial<FieldDef> = {}): FieldDef {
  return {
    id,
    kind: "toggle",
    labelKey: `settings.test.${id}.label`,
    default: false,
    ...extra,
  } as FieldDef;
}

function category(overrides: Partial<CategoryDef> = {}): CategoryDef {
  return {
    id: "alpha",
    labelKey: "settings.category.alpha.label",
    titleKey: "settings.category.alpha.title",
    icon: { kind: "asset", src: "src/assets/icons/homeIcons/home.svg" },
    fields: [],
    ...overrides,
  };
}

/** Deep-freezes so any accidental mutation of the inputs throws in strict mode. */
function frozen<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const nested of Object.values(value as Record<string, unknown>)) frozen(nested);
    Object.freeze(value);
  }
  return value;
}

/* ------------------------------ rail & active ------------------------------ */

test("rail preserves the backend category order and marks exactly one active", () => {
  const categories = [category({ id: "one" }), category({ id: "two" }), category({ id: "three" })];

  const plan = planCategories(categories, "two", {}, identityT);

  assert.deepEqual(
    plan.rail.map((item) => item.id),
    ["one", "two", "three"],
  );
  assert.deepEqual(
    plan.rail.filter((item) => item.active).map((item) => item.id),
    ["two"],
  );
});

test("the plan carries one section title, resolved from titleKey", () => {
  const translated = planCategories(
    [category({ id: "one" })],
    "one",
    {},
    dictionaryT({ "settings.title": "Impostazioni" }),
  );
  const untranslated = planCategories([category({ id: "one" })], "one", {}, identityT);

  assert.equal(translated.title, "Impostazioni");
  // Fallback drops the role suffix, so an untranslated header is never a raw path.
  assert.equal(untranslated.title, "settings");
});

test("the rail item is text only — no icon, no extra weight in the plan", () => {
  const plan = planCategories([category({ id: "one" })], "one", {}, identityT);

  assert.deepEqual(Object.keys(plan.rail[0]).sort(), ["active", "id", "label"]);
  // The label comes from `labelKey` (default "alpha"), never from the id.
  assert.equal(plan.rail[0].label, "alpha");
});

test("the active category no longer carries a per-category icon", () => {
  const plan = planCategories([category({ id: "one" })], "one", {}, identityT);

  assert.ok(plan.active);
  assert.equal("icon" in plan.active, false);
});

test("an unknown or null active id falls back to the first category", () => {
  const categories = [category({ id: "one" }), category({ id: "two" })];

  for (const activeId of [null, "does-not-exist"]) {
    const plan = planCategories(categories, activeId, {}, identityT);
    assert.equal(plan.active?.id, "one");
    assert.equal(plan.rail[0].active, true);
  }
});

test("an empty schema yields an empty rail and no active category", () => {
  const plan = planCategories([], "one", {}, identityT);
  assert.deepEqual(plan.rail, []);
  assert.equal(plan.active, null);
});

/* ----------------------------- label fallbacks ----------------------------- */

test("labels resolve through the dictionary when a message exists", () => {
  const t = dictionaryT({
    "settings.category.alpha.title": "Alpha",
    "settings.category.alpha.label": "Alpha",
    "settings.test.f1.label": "First",
  });

  const plan = planCategories([category({ fields: [toggle("f1")] })], "alpha", {}, t);

  assert.equal(plan.active?.title, "Alpha");
  assert.equal(plan.rail[0].label, "Alpha");
  assert.equal(plan.active?.groups[0].fields[0].label, "First");
});

test("a missing message falls back to the id inside the key, never the raw path", () => {
  const plan = planCategories(
    [category({ fields: [toggle("powerSaver", { helpKey: "settings.test.powerSaver.help" })] })],
    "alpha",
    {},
    identityT,
  );

  const field = plan.active!.groups[0].fields[0];
  assert.equal(field.label, "powerSaver");
  assert.equal(field.help, "powerSaver");
  assert.equal(plan.active!.title, "alpha");
  assert.equal(plan.rail[0].label, "alpha");
});

/* ------------------------------- showWhen (I3) ----------------------------- */

test("isFieldVisible requires every comparator on the same category's values", () => {
  const gated = toggle("gated", {
    showWhen: { field: "master", equals: true },
  });
  const ranged = toggle("ranged", {
    showWhen: { field: "level", greaterThan: 2, lessThan: 8 },
  });
  const excluded = toggle("excluded", {
    showWhen: { field: "mode", notEquals: "off" },
  });

  assert.equal(isFieldVisible(gated, { master: true }), true);
  assert.equal(isFieldVisible(gated, { master: false }), false);

  assert.equal(isFieldVisible(ranged, { level: 5 }), true);
  assert.equal(isFieldVisible(ranged, { level: 2 }), false);
  assert.equal(isFieldVisible(ranged, { level: 8 }), false);
  assert.equal(isFieldVisible(ranged, { level: "5" }), false);

  assert.equal(isFieldVisible(excluded, { mode: "auto" }), true);
  assert.equal(isFieldVisible(excluded, { mode: "off" }), false);
});

test("a showWhen referencing an absent value is hidden, not a crash", () => {
  const orphan = toggle("orphan", { showWhen: { field: "missing" } });
  assert.equal(isFieldVisible(orphan, {}), false);

  const plan = planCategories([category({ fields: [orphan] })], "alpha", {}, identityT);
  assert.equal(plan.active?.empty, true);
});

test("a field with no showWhen is always visible", () => {
  assert.equal(isFieldVisible(toggle("plain"), {}), true);
});

/* ------------------------------ groups & order ----------------------------- */

test("ungrouped fields land in one implicit group placed last", () => {
  const grouped = toggle("grouped");
  const loose = toggle("loose");
  const another = toggle("another");

  const plan = planCategories(
    [
      category({
        fields: [grouped, loose, another],
        groups: [{ id: "explicit", labelKey: "settings.test.group.one", fields: [grouped] }],
      }),
    ],
    "alpha",
    {},
    identityT,
  );

  const groups = plan.active!.groups;
  assert.equal(groups.length, 2);
  assert.equal(groups[0].id, "explicit");
  assert.deepEqual(groups[0].fields.map((entry) => entry.field.id), ["grouped"]);
  assert.deepEqual(groups[1].fields.map((entry) => entry.field.id), ["loose", "another"]);
});

test("a group whose fields are all hidden is dropped entirely", () => {
  const plan = planCategories(
    [
      category({
        fields: [toggle("hidden", { showWhen: { field: "nope", equals: true } })],
        groups: [{ id: "only", fields: [toggle("hidden", { showWhen: { field: "nope", equals: true } })] }],
      }),
    ],
    "alpha",
    {},
    identityT,
  );

  assert.deepEqual(plan.active!.groups, []);
  assert.equal(plan.active!.empty, true);
});

test("a visible field is never listed twice when a group also names it", () => {
  const shared = toggle("shared");
  const plan = planCategories(
    [category({ fields: [shared], groups: [{ id: "g", fields: [shared] }] })],
    "alpha",
    {},
    identityT,
  );

  const ids = plan.active!.groups.flatMap((group) => group.fields.map((entry) => entry.field.id));
  assert.deepEqual(ids, ["shared"]);
});

test("select option labels are resolved by the planner, not the component", () => {
  const select: FieldDef = {
    id: "mode",
    kind: "select",
    labelKey: "settings.test.mode.label",
    default: "a",
    options: [
      { value: "a", labelKey: "settings.test.mode.a" },
      { value: "b", labelKey: "settings.test.mode.b" },
    ],
  };

  const translated = planCategories(
    [category({ fields: [select] })],
    "alpha",
    {},
    dictionaryT({ "settings.test.mode.a": "Alpha mode" }),
  );
  const untranslated = planCategories([category({ fields: [select] })], "alpha", {}, identityT);

  assert.deepEqual(translated.active!.groups[0].fields[0].options, [
    { value: "a", label: "Alpha mode" },
    { value: "b", label: "b" },
  ]);
  assert.deepEqual(untranslated.active!.groups[0].fields[0].options, [
    { value: "a", label: "a" },
    { value: "b", label: "b" },
  ]);
});

test("a non-select field carries no options", () => {
  const plan = planCategories([category({ fields: [toggle("plain")] })], "alpha", {}, identityT);
  assert.equal(plan.active!.groups[0].fields[0].options, undefined);
});

/* ------------------------------- value lookup ------------------------------ */

test("a stored value wins; a missing one falls back to the schema default", () => {
  const level = {
    id: "level",
    kind: "slider",
    labelKey: "settings.test.level.label",
    default: 5,
    min: 0,
    max: 10,
    step: 1,
  } as FieldDef;

  const withStored = planCategories(
    [category({ fields: [level] })],
    "alpha",
    { alpha: { level: 9 } },
    identityT,
  );
  const withoutStored = planCategories([category({ fields: [level] })], "alpha", {}, identityT);

  assert.equal(withStored.active!.groups[0].fields[0].value, 9);
  assert.equal(withoutStored.active!.groups[0].fields[0].value, 5);
});

/* --------------------------- purity & immutability ------------------------- */

test("inputs are never mutated and the planner is referentially transparent", () => {
  const categories = frozen([
    category({
      fields: frozen([
        toggle("master", { default: true }),
        toggle("child", { showWhen: { field: "master", equals: true } }),
      ]),
    }),
  ]);
  const values = frozen<Record<string, SettingsValues>>({ alpha: { master: true } });

  const first = planCategories(categories, "alpha", values, identityT);
  const second = planCategories(categories, "alpha", values, identityT);

  assert.deepEqual(first, second);
  assert.notEqual(first, second, "each call returns a fresh plan");
  assert.deepEqual(values, { alpha: { master: true } });
});

/* ---------------------- adaptation proof (spec invariant I1) ---------------- */

/** Builds a synthetic schema the production code has never seen. */
function syntheticCategory(fieldCount: number): CategoryDef {
  const fields: FieldDef[] = [];
  for (let index = 0; index < fieldCount; index += 1) {
    fields.push(toggle(`toggle-${index}`));
    fields.push({
      id: `slider-${index}`,
      kind: "slider",
      labelKey: `settings.synthetic.slider-${index}.label`,
      default: index,
      min: 0,
      max: 100,
      step: 5,
    });
  }
  fields.push({
    id: "mode",
    kind: "select",
    labelKey: "settings.synthetic.mode.label",
    default: "a",
    options: [
      { value: "a", labelKey: "settings.synthetic.mode.a" },
      { value: "b", labelKey: "settings.synthetic.mode.b" },
    ],
  });
  fields.push(toggle("gated", { showWhen: { field: "toggle-0", equals: true } }));
  return category({ id: "synthetic", fields });
}

test("an unseen schema renders completely, with hidden fields omitted", () => {
  const categories = [syntheticCategory(3)];

  const hiddenOff = planCategories(categories, "synthetic", { synthetic: {} }, identityT);
  const hiddenOn = planCategories(
    categories,
    "synthetic",
    { synthetic: { "toggle-0": true } },
    identityT,
  );

  const flatten = (plan: ReturnType<typeof planCategories>) =>
    plan.active!.groups.flatMap((group) => group.fields);

  // 3 toggles + 3 sliders + 1 select, and the gated toggle only when enabled.
  assert.equal(flatten(hiddenOff).length, 7);
  assert.equal(flatten(hiddenOn).length, 8);
  assert.ok(!flatten(hiddenOff).some((entry) => entry.field.id === "gated"));
  assert.ok(flatten(hiddenOn).some((entry) => entry.field.id === "gated"));
  assert.equal(hiddenOff.active!.empty, false);
});

test("field count scales with the schema, not with any frontend constant", () => {
  const countFor = (n: number) => {
    const plan = planCategories([syntheticCategory(n)], "synthetic", { synthetic: {} }, identityT);
    return plan.active!.groups.flatMap((group) => group.fields).length;
  };

  assert.equal(countFor(1), 1 + 1 + 1);
  assert.equal(countFor(5), 5 + 5 + 1);
  assert.equal(countFor(11), 11 + 11 + 1);
});

test("a second unseen category appears in the rail and becomes selectable", () => {
  const categories = [
    category({ id: "first", fields: [toggle("a")] }),
    category({ id: "second", fields: [toggle("b")] }),
  ];

  const plan = planCategories(categories, "second", {}, identityT);

  assert.deepEqual(
    plan.rail.map((item) => item.id),
    ["first", "second"],
  );
  assert.equal(plan.active?.id, "second");
  assert.deepEqual(plan.active!.groups[0].fields.map((entry) => entry.field.id), ["b"]);
});
