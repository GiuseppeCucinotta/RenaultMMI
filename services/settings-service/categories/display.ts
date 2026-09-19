import type { CategoryDef } from "../types.js";

/** Display — demo placeholder only. Exercises the select kind. */
export const displayCategory: CategoryDef = {
  id: "display",
  labelKey: "settings.category.display.label",
  titleKey: "settings.category.display.title",
  icon: { kind: "asset", src: "src/assets/icons/homeIcons/browser.svg" },
  fields: [
    {
      id: "demoTheme",
      kind: "select",
      labelKey: "settings.display.demoTheme.label",
      helpKey: "settings.display.demoTheme.help",
      default: "dark",
      options: [
        { value: "dark", labelKey: "settings.display.demoTheme.option.dark" },
        { value: "light", labelKey: "settings.display.demoTheme.option.light" },
        { value: "auto", labelKey: "settings.display.demoTheme.option.auto" },
      ],
    },
  ],
};
