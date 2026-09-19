import type { CategoryDef } from "../types.js";

/**
 * System — demo placeholder only. The single field is `readOnly`, so the
 * renderer has a non-interactive row to show and the service has a write it
 * must reject.
 */
export const systemCategory: CategoryDef = {
  id: "system",
  labelKey: "settings.category.system.label",
  titleKey: "settings.category.system.title",
  icon: { kind: "asset", src: "src/assets/icons/homeIcons/settings.svg" },
  fields: [
    {
      id: "demoBuildLocked",
      kind: "toggle",
      labelKey: "settings.system.demoBuildLocked.label",
      helpKey: "settings.system.demoBuildLocked.help",
      default: false,
      readOnly: true,
    },
  ],
};
