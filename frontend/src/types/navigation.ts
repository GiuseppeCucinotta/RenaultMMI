/**
 * Every view the shell can render.
 *
 * `settings`, `trip-computer` and `trip-history` are full-screen apps opened from
 * a Home tile, so they exist here but deliberately not in `NAV_ORDER` — the
 * bottom rail stays three items.
 */
export type NavId = "home" | "phone" | "media" | "settings" | "trip-computer" | "trip-history";
