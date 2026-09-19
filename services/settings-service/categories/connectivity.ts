import type { CategoryDef } from "../types.js";

/**
 * Connectivity — demo placeholder only. Exercises a toggle and a stepper in the
 * same category.
 */
export const connectivityCategory: CategoryDef = {
  id: "connectivity",
  labelKey: "settings.category.connectivity.label",
  titleKey: "settings.category.connectivity.title",
  icon: { kind: "asset", src: "src/assets/icons/views/smartphone.svg" },
  fields: [
    {
      id: "demoToggle",
      kind: "toggle",
      labelKey: "settings.connectivity.demoToggle.label",
      helpKey: "settings.connectivity.demoToggle.help",
      default: false,
    },
    {
      id: "demoRetries",
      kind: "stepper",
      labelKey: "settings.connectivity.demoRetries.label",
      helpKey: "settings.connectivity.demoRetries.help",
      default: 2,
      min: 1,
      max: 5,
      step: 1,
    },
  ],
};
