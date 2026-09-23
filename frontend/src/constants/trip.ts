/**
 * Fixed presentation constants and endpoints for the two trip apps.
 *
 * The port and poll cadence live here rather than inside a component, matching
 * every other service client in the renderer.
 */

/** Default service location; the preload bridge overrides it when available. */
export const TRIP_DEFAULT_BASE_URL = "http://127.0.0.1:4500";

/** Health re-probe cadence while a trip view is open, mirroring the others. */
export const TRIP_HEALTH_POLL_MS = 5000;

/** How many trips the history list asks for per page. */
export const TRIP_HISTORY_PAGE_SIZE = 25;

/**
 * Days per bucket-granularity switch, mirroring the service's own thresholds.
 * Only used to describe the axis; the service decides the buckets.
 */
export const TRIP_GRAPH_HEIGHT = 190;

/** Aspect reserved for the trajectory map, in CSS pixels at the 1920×480 stage. */
export const TRIP_MAP_VIEWPORT = { width: 760, height: 300, padding: 18 } as const;
