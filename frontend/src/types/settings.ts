/**
 * Renderer-side mirror of the settings schema.
 *
 * The backend owns the schema (`settings-service/types.ts`); the renderer keeps
 * its own structural copy on purpose, so the two halves of the feature evolve
 * independently (the same split the repo already uses for jukebox types).
 *
 * Nothing here may name a category id, a field id or a label: the UI is a pure
 * function of whatever schema the service reports (spec invariant I1).
 */

export type SettingsCategoryId = string;

export type FieldValue = boolean | number | string;
export type SettingsValues = Record<string, FieldValue>;

/** Predicate over the *same category's* values (spec invariant I3). */
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
  groups?: CategoryGroup[];
  fields: FieldDef[];
}

export interface SettingsState {
  categories: CategoryDef[];
  values: Record<SettingsCategoryId, SettingsValues>;
}

export type SettingsMode = "service" | "mock" | "loading";

/** Response bodies of the settings service routes. */
export interface SettingsCategoriesBody {
  categories: CategoryDef[];
}

export interface SettingsValuesBody {
  values: Record<SettingsCategoryId, SettingsValues>;
}

export interface SettingsCategoryValuesBody {
  categoryId: SettingsCategoryId;
  values: SettingsValues;
}
