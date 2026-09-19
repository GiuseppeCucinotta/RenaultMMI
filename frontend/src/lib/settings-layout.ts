/**
 * The adaptive layout planner — the heart of the Settings feature.
 *
 * `planCategories` is a **pure function** and the only place layout decisions
 * are made. It is referentially transparent (same inputs → deep-equal output,
 * inputs never mutated) and it never branches on a category id, a field id or a
 * label: the render model is derived entirely from the backend schema.
 *
 * Because every rule below is testable without a DOM, the renderer components
 * stay dumb and `test/settings-layout.test.ts` can prove that a brand-new
 * setting (or a whole new category) renders with zero `.tsx` changes.
 */

import type {
  CategoryDef,
  FieldDef,
  FieldValue,
  SettingsCategoryId,
  SettingsValues,
} from "@/types/settings";

export interface PlannedField {
  field: FieldDef;
  value: FieldValue;
  /** Resolved label; falls back to the key's last segment when untranslated. */
  label: string;
  help?: string;
  /** For `select` fields: options with their labels already resolved. */
  options?: { value: string; label: string }[];
}

export interface PlannedGroup {
  id: string;
  label?: string;
  fields: PlannedField[];
}

export interface PlannedCategory {
  id: SettingsCategoryId;
  /** Category name; the view no longer prints it as its own heading. */
  title: string;
  groups: PlannedGroup[];
  /** True when no field of this category is currently visible. */
  empty: boolean;
}

export interface PlannedRailItem {
  id: SettingsCategoryId;
  label: string;
  active: boolean;
}

export interface SettingsPlan {
  /** The single header shown above the category list. */
  title: string;
  rail: PlannedRailItem[];
  active: PlannedCategory | null;
}

export type Translate = (key: string) => string;

/** Groups without an explicit id get this stable, key-free identifier. */
const IMPLICIT_GROUP_ID = "__ungrouped__";

/** Trailing key segments that name a *role* rather than the item's id. */
const ROLE_SUFFIXES = new Set(["label", "help", "title", "unit"]);

/**
 * Resolves a translation, degrading gracefully.
 *
 * `t()` returns the key itself when a message is missing, so an untranslated
 * schema must never surface as a raw dotted path. The key convention is
 * `...<id>.<role>`, so a trailing role segment (`label`, `help`, `title`,
 * `unit`) is dropped and the segment before it is shown — `…balance.label` →
 * `balance`. Without a role suffix the last segment already *is* the id, so
 * `…demoTheme.dark` → `dark`. Only a missing suffix is ever dropped: this never
 * truncates an id that happens to look like one.
 */
function resolveLabel(t: Translate, key: string): string {
  const translated = t(key);
  if (translated && translated !== key) return translated;

  const segments = key.split(".").filter(Boolean);
  if (segments.length === 0) return key;
  if (segments.length === 1) return segments[0];

  const last = segments[segments.length - 1];
  if (ROLE_SUFFIXES.has(last)) {
    return segments[segments.length - 2] || key;
  }
  return last;
}

/**
 * Evaluates a field's `showWhen` against its own category's values.
 *
 * Contract: every comparator present must pass. A `showWhen` whose referenced
 * field has no value is **false** — never a crash, never a fallthrough to true.
 * Cross-category references cannot occur here: `values` is always the bucket of
 * the field's own category.
 */
export function isFieldVisible(field: FieldDef, values: SettingsValues): boolean {
  const condition = field.showWhen;
  if (!condition) return true;

  const current = values[condition.field];
  if (current === undefined) return false;

  if (condition.equals !== undefined && current !== condition.equals) return false;
  if (condition.notEquals !== undefined && current === condition.notEquals) return false;

  if (condition.greaterThan !== undefined) {
    if (typeof current !== "number" || !(current > condition.greaterThan)) return false;
  }
  if (condition.lessThan !== undefined) {
    if (typeof current !== "number" || !(current < condition.lessThan)) return false;
  }

  return true;
}

/** The declared value for a field, or its schema default when nothing is stored. */
function valueFor(field: FieldDef, values: SettingsValues): FieldValue {
  const stored = values[field.id];
  return stored === undefined ? field.default : stored;
}

/**
 * Turns a field into its render model, or `null` when it is currently hidden.
 * Hidden fields are omitted entirely (not flagged) so consumers cannot
 * accidentally render one.
 */
function planField(
  field: FieldDef,
  values: SettingsValues,
  t: Translate,
): PlannedField | null {
  if (!isFieldVisible(field, values)) return null;

  const planned: PlannedField = {
    field,
    value: valueFor(field, values),
    label: resolveLabel(t, field.labelKey),
  };
  if (field.helpKey) planned.help = resolveLabel(t, field.helpKey);
  if (field.kind === "select") {
    planned.options = field.options.map((option) => ({
      value: option.value,
      label: resolveLabel(t, option.labelKey),
    }));
  }
  return planned;
}

/** Explicit groups first, in declaration order; ungrouped fields last. */
function planGroups(
  category: CategoryDef,
  values: SettingsValues,
  t: Translate,
): PlannedGroup[] {
  const planned = new Map<string, PlannedField>();
  for (const field of category.fields) {
    const entry = planField(field, values, t);
    if (entry) planned.set(field.id, entry);
  }

  const groups: PlannedGroup[] = [];
  const placed = new Set<string>();

  for (const group of category.groups ?? []) {
    const fields: PlannedField[] = [];
    for (const field of group.fields) {
      const entry = planned.get(field.id);
      if (!entry || placed.has(field.id)) continue;
      placed.add(field.id);
      fields.push(entry);
    }
    // A group whose fields are all hidden is dropped, label and all.
    if (fields.length === 0) continue;

    const plannedGroup: PlannedGroup = { id: group.id, fields };
    if (group.labelKey) plannedGroup.label = resolveLabel(t, group.labelKey);
    groups.push(plannedGroup);
  }

  const ungrouped = category.fields
    .filter((field) => !placed.has(field.id))
    .map((field) => planned.get(field.id))
    .filter((entry): entry is PlannedField => entry !== undefined);

  if (ungrouped.length > 0) {
    groups.push({ id: IMPLICIT_GROUP_ID, fields: ungrouped });
  }

  return groups;
}

export function planCategory(
  category: CategoryDef,
  values: SettingsValues,
  t: Translate,
): PlannedCategory {
  const groups = planGroups(category, values, t);
  return {
    id: category.id,
    title: resolveLabel(t, category.titleKey),
    groups,
    empty: groups.length === 0,
  };
}

/**
 * Builds the whole view model: the section title, the category rail (in backend
 * order) and the active category.
 *
 * A missing/unknown active id falls back to the first category, so a schema that
 * drops the previously selected category cannot blank the screen.
 *
 * `titleKey` is the plan-wide header ("Settings"); pass the one the shell
 * resolved so the planner stays the only place labels are resolved.
 */
export function planCategories(
  categories: CategoryDef[],
  activeCategoryId: SettingsCategoryId | null,
  values: Record<SettingsCategoryId, SettingsValues>,
  t: Translate,
  titleKey = "settings.title",
): SettingsPlan {
  const title = resolveLabel(t, titleKey);
  if (categories.length === 0) return { title, rail: [], active: null };

  const activeCategory =
    categories.find((category) => category.id === activeCategoryId) ?? categories[0];

  const rail = categories.map<PlannedRailItem>((category) => ({
    id: category.id,
    label: resolveLabel(t, category.labelKey),
    active: category.id === activeCategory.id,
  }));

  return {
    title,
    rail,
    active: planCategory(activeCategory, values[activeCategory.id] ?? {}, t),
  };
}
