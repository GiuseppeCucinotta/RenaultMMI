/**
 * Fixed presentation constants for the Settings view.
 *
 * Deliberately contains **no category ids, field ids or labels** — those come
 * from the backend schema, so this file must stay content-free (invariant I1).
 */

/** Width reserved for the category rail, matching the design reference. */
export const SETTINGS_RAIL_WIDTH = "w-[120px]";

/** Side of the square reserved for the per-category artwork (design ref). */
export const SETTINGS_ARTWORK_SIZE = 420;

/** Literal text that reserves the artwork slot until a real asset exists. */
export const SETTINGS_ARTWORK_PLACEHOLDER = "PLACEHOLDER";

/** Default service location; the preload bridge overrides it when available. */
export const SETTINGS_DEFAULT_BASE_URL = "http://127.0.0.1:4400";

/** Health re-probe cadence while the view is open, mirroring the other sources. */
export const SETTINGS_HEALTH_POLL_MS = 5000;
