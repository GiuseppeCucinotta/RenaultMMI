/**
 * Settings schema types — the contract between the settings service, its
 * registry/store and the renderer.
 *
 * A category is a self-contained plugin: it declares its own fields, their
 * defaults, constraints and (optional) same-category `showWhen` gates. Nothing
 * here knows about hardware, and nothing may reference another category.
 */

export type SettingsCategoryId = string;

export type FieldValue = boolean | number | string;
export type SettingsValues = Record<string, FieldValue>;

/**
 * Predicate over the SAME category's values. Every comparator that is present
 * must pass; a missing referenced field makes the field invisible.
 */
export interface ShowWhen {
  field: string;
  equals?: FieldValue;
  notEquals?: FieldValue;
  greaterThan?: number;
  lessThan?: number;
}

export type CategoryIcon =
  | { kind: "asset"; src: string }
  | { kind: "lucide"; name: string };

interface FieldBase {
  id: string;
  labelKey: string;
  helpKey?: string;
  default: FieldValue;
  readOnly?: boolean;
  showWhen?: ShowWhen;
}

export interface ToggleField extends FieldBase {
  kind: "toggle";
  default: boolean;
}

export interface SliderField extends FieldBase {
  kind: "slider";
  default: number;
  min: number;
  max: number;
  step: number;
  unitKey?: string;
}

export interface SelectField extends FieldBase {
  kind: "select";
  default: string;
  options: { value: string; labelKey: string }[];
}

export interface StepperField extends FieldBase {
  kind: "stepper";
  default: number;
  min: number;
  max: number;
  step: number;
  unitKey?: string;
}

export type FieldDef = ToggleField | SliderField | SelectField | StepperField;
export type FieldKind = FieldDef["kind"];

/** Optional presentation grouping inside a category's center column. */
export interface CategoryGroup {
  id: string;
  labelKey?: string;
  fields: FieldDef[];
}

export interface CategoryDef {
  id: SettingsCategoryId;
  labelKey: string;
  titleKey: string;
  icon: CategoryIcon;
  /**
   * Presentation-only grouping. `fields` is the flat, authoritative list used
   * for validation, defaults and planning; a group may only repeat entries
   * from it.
   */
  groups?: CategoryGroup[];
  fields: FieldDef[];
}

export interface SettingsState {
  categories: CategoryDef[];
  values: Record<SettingsCategoryId, SettingsValues>;
}
