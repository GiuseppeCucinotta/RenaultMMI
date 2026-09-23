/**
 * The category registry: the only module that knows the shipped category ids
 * and their rail order. Everything downstream (routes, store, renderer) is
 * driven by the registry, never by a hardcoded id (I1).
 *
 * A field may only gate on a sibling of its own category: `showWhen` is
 * resolved exclusively inside {@link assertValidField}, so a reference that
 * points at another category cannot even be registered (I2/I3).
 */

import { assertValidField, fieldDefaults } from "./fields.js";
import type { CategoryDef, SettingsCategoryId, SettingsValues } from "./types.js";

/** The rail order, top to bottom. Production's complete allowed id set. */
export const CATEGORY_ORDER: readonly SettingsCategoryId[] = [
  "vehicle",
  "trip",
  "audio",
  "connectivity",
  "display",
  "system",
];

export interface SettingsRegistry {
  categories: CategoryDef[];
  byId: Map<string, CategoryDef>;
  /** Keeps only the registered categories' values (unknown ids dropped). */
  values(state: Record<string, SettingsValues>): Record<string, SettingsValues>;
}

/**
 * Builds a validated registry.
 *
 * `allowedIds` is the complete set a definition is checked against: every
 * supplied category must be in it, and every id in it must be supplied. It
 * defaults to {@link CATEGORY_ORDER} — production passes nothing and therefore
 * ships exactly the five fixed categories — while tests may pass a wider set to
 * register their own throwaway fixture category.
 *
 * Throws on: an empty list, a duplicate category id, an id outside `allowedIds`,
 * a missing id, and any {@link assertValidField} failure (duplicate field id,
 * cross-category `showWhen`, invalid default, `min > max`, `step <= 0`, empty
 * `options`).
 */
export function createRegistry(
  categories: CategoryDef[],
  allowedIds: readonly SettingsCategoryId[] = CATEGORY_ORDER,
): SettingsRegistry {
  if (categories.length === 0) {
    throw new Error("settings registry needs at least one category");
  }

  const byId = new Map<string, CategoryDef>();
  for (const category of categories) {
    if (byId.has(category.id)) {
      throw new Error(`duplicate settings category id "${category.id}"`);
    }
    if (!allowedIds.includes(category.id)) {
      throw new Error(`unknown settings category id "${category.id}"`);
    }
    byId.set(category.id, category);
  }

  for (const id of allowedIds) {
    if (!byId.has(id)) throw new Error(`missing settings category "${id}"`);
  }

  for (const category of categories) {
    const fieldIds = new Set<string>();
    for (const field of category.fields) {
      assertValidField(field, category);
      fieldIds.add(field.id);
    }
    for (const group of category.groups ?? []) {
      for (const field of group.fields) {
        // `fields` is authoritative: a group view may only repeat it.
        if (!fieldIds.has(field.id)) {
          throw new Error(
            `group "${group.id}" of category "${category.id}" references unknown field "${field.id}"`,
          );
        }
      }
    }
  }

  // Declaration order is the allowed-id order, so the rail never depends on
  // how the five modules were listed at the call site.
  const ordered = allowedIds.map((id) => byId.get(id) as CategoryDef);

  return {
    categories: ordered,
    byId,
    values(state: Record<string, SettingsValues>): Record<string, SettingsValues> {
      const result: Record<string, SettingsValues> = {};
      for (const category of ordered) {
        const stored = state[category.id];
        if (stored) result[category.id] = { ...stored };
      }
      return result;
    },
  };
}

/** Schema defaults for every registered category. */
export function defaultValues(registry: SettingsRegistry): Record<string, SettingsValues> {
  const values: Record<string, SettingsValues> = {};
  for (const category of registry.categories) {
    values[category.id] = fieldDefaults(category);
  }
  return values;
}
