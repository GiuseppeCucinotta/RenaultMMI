import type { CategoryDef } from "../types.js";

/**
 * Trip — the preferences the trip service and both trip apps read.
 *
 * The field ids here are a **wire contract**, not a naming choice: the trip
 * service reads them by name from `GET /api/values/trip`
 * (`services/trip-service/settings/client.ts`). Renaming one silently reverts the
 * trip engine to its defaults, because that client is deliberately tolerant of a
 * field it cannot find.
 *
 * Note there is no unit conversion in the renderer: `consumptionUnit` is read by
 * the service, which then formats every card itself. That is what keeps a card
 * and a chart from disagreeing about what a litre per kilometre means.
 */
export const tripCategory: CategoryDef = {
  id: "trip",
  labelKey: "settings.category.trip.label",
  titleKey: "settings.category.trip.title",
  icon: { kind: "asset", src: "src/assets/icons/homeIcons/fuelConsumptionIcon.svg" },
  fields: [
    {
      id: "consumptionUnit",
      kind: "select",
      labelKey: "settings.trip.consumptionUnit.label",
      helpKey: "settings.trip.consumptionUnit.help",
      default: "l_per_100km",
      options: [
        { value: "l_per_100km", labelKey: "settings.trip.consumptionUnit.l_per_100km" },
        { value: "km_per_l", labelKey: "settings.trip.consumptionUnit.km_per_l" },
      ],
    },
    {
      id: "currency",
      kind: "select",
      labelKey: "settings.trip.currency.label",
      helpKey: "settings.trip.currency.help",
      default: "EUR",
      options: [
        { value: "EUR", labelKey: "settings.trip.currency.EUR" },
        { value: "USD", labelKey: "settings.trip.currency.USD" },
        { value: "GBP", labelKey: "settings.trip.currency.GBP" },
      ],
    },
    {
      id: "homeGeofenceLat",
      kind: "stepper",
      labelKey: "settings.trip.homeGeofenceLat.label",
      helpKey: "settings.trip.homeGeofenceLat.help",
      default: 44.6471,
      // `min: 0` is deliberate: the stepper validates that a value lies on the
      // lattice `min + n*step`, and `-90 + n*0.0001` does not land on 44.6471
      // (a negative anchor plus a float step never does). Anchoring at zero
      // keeps four decimal places — about 11 m — exactly enforceable.
      min: 0,
      max: 90,
      step: 0.0001,
      unitKey: "°N",
    },
    {
      id: "homeGeofenceLon",
      kind: "stepper",
      labelKey: "settings.trip.homeGeofenceLon.label",
      helpKey: "settings.trip.homeGeofenceLon.help",
      default: 10.9252,
      min: 0,
      max: 180,
      step: 0.0001,
      unitKey: "°E",
    },
    {
      id: "homeGeofenceRadiusM",
      kind: "slider",
      labelKey: "settings.trip.homeGeofenceRadiusM.label",
      helpKey: "settings.trip.homeGeofenceRadiusM.help",
      default: 200,
      min: 50,
      max: 2000,
      step: 50,
      unitKey: "m",
    },
    {
      id: "stageDwellMinutes",
      kind: "stepper",
      labelKey: "settings.trip.stageDwellMinutes.label",
      helpKey: "settings.trip.stageDwellMinutes.help",
      default: 15,
      min: 1,
      max: 120,
      step: 1,
      unitKey: "min",
    },
    {
      id: "layoverHours",
      kind: "stepper",
      labelKey: "settings.trip.layoverHours.label",
      helpKey: "settings.trip.layoverHours.help",
      default: 18,
      min: 1,
      max: 72,
      step: 1,
      unitKey: "h",
    },
  ],
};
