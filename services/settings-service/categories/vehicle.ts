import type { CategoryDef } from "../types.js";

/**
 * Vehicle — demo placeholder only.
 *
 * Invent no vehicle semantics and wire no actuator: this category exists so the
 * adaptive layout has five real rail entries to switch between. Real settings
 * replace this file wholesale, and nothing outside it needs to change.
 */
export const vehicleCategory: CategoryDef = {
  id: "vehicle",
  labelKey: "settings.category.vehicle.label",
  titleKey: "settings.category.vehicle.title",
  icon: { kind: "asset", src: "src/assets/icons/homeIcons/home.svg" },
  fields: [
    {
      id: "demoToggle",
      kind: "toggle",
      labelKey: "settings.vehicle.demoToggle.label",
      helpKey: "settings.vehicle.demoToggle.help",
      default: true,
    },
  ],
};
