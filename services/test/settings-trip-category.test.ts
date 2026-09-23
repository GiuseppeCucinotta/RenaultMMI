/**
 * The `trip` settings category.
 *
 * The trip service reads these field ids **by name** over HTTP
 * (`services/trip-service/settings/client.ts`), and its reader is deliberately
 * tolerant — a field it cannot find silently falls back to a default. That
 * tolerance is good for uptime and terrible for refactors, so the ids are pinned
 * here: renaming one must break a test, not silently change how the trip engine
 * segments a drive.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { tripCategory } from "../settings-service/categories/trip.js";
import { CATEGORY_ORDER, createRegistry } from "../settings-service/registry.js";
import { fieldDefaults, normalizeFieldValue } from "../settings-service/fields.js";
import { PRODUCTION_CATEGORIES } from "./settings-support.js";

/** The names the trip service looks up. Changing this list is a wire change. */
const TRIP_FIELD_IDS = [
  "consumptionUnit",
  "currency",
  "homeGeofenceLat",
  "homeGeofenceLon",
  "homeGeofenceRadiusM",
  "stageDwellMinutes",
  "layoverHours",
] as const;

test("the trip category is registered in the rail order", () => {
  assert.ok(CATEGORY_ORDER.includes("trip"));
  assert.deepEqual(
    createRegistry(PRODUCTION_CATEGORIES).categories.map((category) => category.id),
    [...CATEGORY_ORDER],
  );
});

test("the trip category exposes exactly the fields the service reads", () => {
  assert.deepEqual(
    tripCategory.fields.map((field) => field.id),
    [...TRIP_FIELD_IDS],
  );
});

test("every trip field has a translatable label and a sane default", () => {
  for (const field of tripCategory.fields) {
    assert.match(field.labelKey, /^settings\.trip\./, `${field.id} needs a namespaced label`);
    assert.ok(field.helpKey, `${field.id} should explain itself`);
    assert.notEqual(field.default, undefined, `${field.id} needs a default`);
  }
});

test("the defaults match what the trip engine assumes", () => {
  const defaults = fieldDefaults(tripCategory);
  // These are also `DEFAULT_PREFERENCES` in the trip service: a mismatch would
  // mean different behaviour before and after the first settings read.
  assert.equal(defaults.consumptionUnit, "l_per_100km");
  assert.equal(defaults.currency, "EUR");
  assert.equal(defaults.homeGeofenceRadiusM, 200);
  assert.equal(defaults.stageDwellMinutes, 15);
  assert.equal(defaults.layoverHours, 18);
});

test("a coordinate on the step lattice is accepted and an off-lattice one is not", () => {
  const lat = tripCategory.fields.find((field) => field.id === "homeGeofenceLat");
  assert.ok(lat);
  // 44.6471 sits exactly on `0 + n*0.0001`, which is why the bounds are anchored
  // at zero; an off-lattice value must be rejected rather than silently moved.
  assert.equal(normalizeFieldValue(lat, 44.6471), 44.6471);
  assert.throws(() => normalizeFieldValue(lat, 44.64711), /multiple of/);
});

test("the consumption unit only accepts the two units the service understands", () => {
  const unit = tripCategory.fields.find((field) => field.id === "consumptionUnit");
  assert.ok(unit?.kind === "select");
  assert.deepEqual(
    unit.options.map((option) => option.value),
    ["l_per_100km", "km_per_l"],
  );
  assert.throws(() => normalizeFieldValue(unit, "mpg"), /expects one of/);
});

test("a nonsensical dwell threshold is rejected at the boundary", () => {
  const dwell = tripCategory.fields.find((field) => field.id === "stageDwellMinutes");
  assert.ok(dwell);
  assert.equal(normalizeFieldValue(dwell, 1), 1);
  assert.equal(normalizeFieldValue(dwell, 120), 120);
  assert.throws(() => normalizeFieldValue(dwell, 0), /must be between/);
  assert.throws(() => normalizeFieldValue(dwell, 121), /must be between/);
});
