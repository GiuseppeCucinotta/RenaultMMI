/**
 * Pure field helpers: visibility, normalisation, defaults and schema
 * validation. No I/O, no service, no clock — everything here is a function of
 * its arguments, so both the store (on load) and the service (on write) share
 * exactly the same rules (I4).
 */

import type {
  CategoryDef,
  FieldDef,
  FieldValue,
  SettingsValues,
  ShowWhen,
} from "./types.js";

/** Epsilon for the stepper lattice check (floats accumulate tiny error). */
const LATTICE_EPSILON = 1e-9;

function isToggle(field: FieldDef): field is Extract<FieldDef, { kind: "toggle" }> {
  return field.kind === "toggle";
}

function isSlider(field: FieldDef): field is Extract<FieldDef, { kind: "slider" }> {
  return field.kind === "slider";
}

function isStepper(field: FieldDef): field is Extract<FieldDef, { kind: "stepper" }> {
  return field.kind === "stepper";
}

function describe(field: FieldDef): string {
  return `field "${field.id}" (${field.kind})`;
}

/**
 * Evaluates a `showWhen` predicate against its own category's values.
 *
 * Every comparator present must pass. A reference to a field that is absent
 * from `values` is not an error: the field is simply invisible.
 */
function matchesShowWhen(showWhen: ShowWhen, values: SettingsValues): boolean {
  if (!(showWhen.field in values)) return false;
  const current = values[showWhen.field];

  if (showWhen.equals !== undefined && current !== showWhen.equals) return false;
  if (showWhen.notEquals !== undefined && current === showWhen.notEquals) return false;
  if (showWhen.greaterThan !== undefined) {
    if (typeof current !== "number" || current <= showWhen.greaterThan) return false;
  }
  if (showWhen.lessThan !== undefined) {
    if (typeof current !== "number" || current >= showWhen.lessThan) return false;
  }
  return true;
}

/** `true` when the field should be rendered for the given values. */
export function isFieldVisible(field: FieldDef, values: SettingsValues): boolean {
  if (!field.showWhen) return true;
  return matchesShowWhen(field.showWhen, values);
}

/**
 * Validates and coerces a raw value against the field schema.
 *
 * - `toggle`: must be a boolean
 * - `slider`: a finite number inside `[min, max]`, snapped to the nearest
 *   `min + n*step` lattice point
 * - `stepper`: a finite number already on the lattice and inside the range
 * - `select`: a string that is one of `options`
 *
 * Out-of-range numbers are **rejected, not clamped**, for both numeric kinds.
 * Clamping would make a typo in a schema or a caller indistinguishable from a
 * deliberate value, and the spec requires a 400. Only the *step* is forgiving
 * for sliders, because a slider's continuous track legitimately lands between
 * steps.
 *
 * Throws a plain `Error` on anything invalid; callers map that to their own
 * error type (HTTP 400, a boot-time config failure, ...).
 */
export function normalizeFieldValue(field: FieldDef, value: unknown): FieldValue {
  if (isToggle(field)) {
    if (typeof value !== "boolean") {
      throw new Error(`${describe(field)} expects a boolean`);
    }
    return value;
  }

  if (isSlider(field)) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new Error(`${describe(field)} expects a finite number`);
    }
    if (value < field.min || value > field.max) {
      throw new Error(`${describe(field)} must be between ${field.min} and ${field.max}`);
    }
    // Arithmetic on (value - min) instead of `%`: step 0.1 is not exactly
    // representable, so a remainder check would misfire.
    const snapped = field.min + Math.round((value - field.min) / field.step) * field.step;
    // Guard the extremes against float drift only (e.g. a snapped max landing
    // a hair above `max`); the range check above already rejected real outliers.
    return Math.min(field.max, Math.max(field.min, snapped));
  }

  if (isStepper(field)) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new Error(`${describe(field)} expects a finite number`);
    }
    if (value < field.min || value > field.max) {
      throw new Error(`${describe(field)} must be between ${field.min} and ${field.max}`);
    }
    const steps = (value - field.min) / field.step;
    if (Math.abs(steps - Math.round(steps)) > LATTICE_EPSILON) {
      throw new Error(`${describe(field)} must be a multiple of ${field.step} starting at ${field.min}`);
    }
    return Math.round(steps) * field.step + field.min;
  }

  if (field.kind === "select") {
    if (typeof value !== "string" || !field.options.some((option) => option.value === value)) {
      throw new Error(`${describe(field)} expects one of: ${field.options.map((o) => o.value).join(", ")}`);
    }
    return value;
  }

  // Unreachable for the current union: keeps a future field kind from silently
  // validating instead of failing loudly.
  throw new Error(`unsupported field kind for ${(field as FieldDef).id}`);
}

/** Normalised defaults for every field of a category. */
export function fieldDefaults(category: CategoryDef): SettingsValues {
  const defaults: SettingsValues = {};
  for (const field of category.fields) {
    defaults[field.id] = normalizeFieldValue(field, field.default);
  }
  return defaults;
}

/**
 * Boot-time schema validation. Throws a plain `Error` (a programming error, not
 * a request error) so a broken category definition fails loudly in tests and at
 * service start instead of producing a half-working UI.
 */
export function assertValidField(field: FieldDef, category: CategoryDef): void {
  const siblings = category.fields.filter((candidate) => candidate.id === field.id);
  if (siblings.length > 1) {
    throw new Error(`duplicate field id "${field.id}" in category "${category.id}"`);
  }

  if (field.showWhen) {
    const referenced = category.fields.some(
      (candidate) => candidate.id === field.showWhen?.field,
    );
    if (!referenced) {
      // Cross-category dependencies land here: a field may only gate on a
      // sibling of its own category (I2/I3).
      throw new Error(
        `field "${field.id}" in category "${category.id}" references unknown field "${field.showWhen.field}"`,
      );
    }
  }

  if (isSlider(field) || isStepper(field)) {
    if (field.min > field.max) {
      throw new Error(`${describe(field)} has min > max`);
    }
    if (!(field.step > 0)) {
      throw new Error(`${describe(field)} has a non-positive step`);
    }
  }

  if (field.kind === "select" && field.options.length === 0) {
    throw new Error(`${describe(field)} has no options`);
  }

  // Also checks the default's type, lattice and option membership. An
  // out-of-range default now throws directly inside normalizeFieldValue, so this
  // only has to catch a default that is off the slider lattice.
  const normalizedDefault = normalizeFieldValue(field, field.default);
  if (normalizedDefault !== field.default) {
    throw new Error(
      `default ${JSON.stringify(field.default)} of ${describe(field)} is not on its step lattice`,
    );
  }
}
