import type { CategoryDef } from "../types.js";

/**
 * Audio — demo placeholder only.
 *
 * Deliberately unrelated to `EntertainmentVolumeController`: settings never
 * touch system/master volume (I5), and this slider wires nothing.
 */
export const audioCategory: CategoryDef = {
  id: "audio",
  labelKey: "settings.category.audio.label",
  titleKey: "settings.category.audio.title",
  icon: { kind: "asset", src: "src/assets/icons/homeIcons/media-cast.svg" },
  fields: [
    {
      id: "demoLevel",
      kind: "slider",
      labelKey: "settings.audio.demoLevel.label",
      helpKey: "settings.audio.demoLevel.help",
      default: 5,
      min: 0,
      max: 10,
      step: 1,
    },
  ],
};
