/**
 * Browser-dev fallback: mirrors the five schema entries the service ships, so
 * `npm run dev` in a plain browser (no Electron, no service) still renders the
 * view. Structure only — identical shape to `GET /api/state`.
 */

import type { SettingsState } from "@/types/settings";

export const MOCK_SETTINGS_STATE: SettingsState = {
  categories: [
    {
      id: "vehicle",
      labelKey: "settings.category.vehicle.label",
      titleKey: "settings.category.vehicle.title",
      icon: { kind: "asset", src: "src/assets/icons/homeIcons/home.svg" },
      fields: [
        {
          id: "demoToggle",
          kind: "toggle",
          labelKey: "settings.vehicle.demoToggle.label",
          default: true,
        },
      ],
    },
    {
      id: "audio",
      labelKey: "settings.category.audio.label",
      titleKey: "settings.category.audio.title",
      icon: { kind: "asset", src: "src/assets/icons/homeIcons/media-cast.svg" },
      fields: [
        {
          id: "demoLevel",
          kind: "slider",
          labelKey: "settings.audio.demoLevel.label",
          default: 5,
          min: 0,
          max: 10,
          step: 1,
        },
      ],
    },
    {
      id: "connectivity",
      labelKey: "settings.category.connectivity.label",
      titleKey: "settings.category.connectivity.title",
      icon: { kind: "asset", src: "src/assets/icons/views/smartphone.svg" },
      fields: [
        {
          id: "demoToggle",
          kind: "toggle",
          labelKey: "settings.connectivity.demoToggle.label",
          default: false,
        },
        {
          id: "demoRetries",
          kind: "stepper",
          labelKey: "settings.connectivity.demoRetries.label",
          default: 2,
          min: 1,
          max: 5,
          step: 1,
        },
      ],
    },
    {
      id: "display",
      labelKey: "settings.category.display.label",
      titleKey: "settings.category.display.title",
      icon: { kind: "asset", src: "src/assets/icons/homeIcons/browser.svg" },
      fields: [
        {
          id: "demoTheme",
          kind: "select",
          labelKey: "settings.display.demoTheme.label",
          default: "dark",
          options: [
            { value: "dark", labelKey: "settings.display.demoTheme.dark" },
            { value: "light", labelKey: "settings.display.demoTheme.light" },
            { value: "auto", labelKey: "settings.display.demoTheme.auto" },
          ],
        },
      ],
    },
    {
      id: "system",
      labelKey: "settings.category.system.label",
      titleKey: "settings.category.system.title",
      icon: { kind: "asset", src: "src/assets/icons/homeIcons/settings.svg" },
      fields: [
        {
          id: "demoBuildLocked",
          kind: "toggle",
          labelKey: "settings.system.demoBuildLocked.label",
          default: false,
          readOnly: true,
        },
      ],
    },
  ],
  values: {
    vehicle: { demoToggle: true },
    audio: { demoLevel: 5 },
    connectivity: { demoToggle: false, demoRetries: 2 },
    display: { demoTheme: "dark" },
    system: { demoBuildLocked: false },
  },
};
