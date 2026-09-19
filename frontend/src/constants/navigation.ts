import type { NavId } from "@/types/navigation";

/**
 * Views reachable from the bottom `Navbar`, in rotary/scroll order.
 *
 * `settings` is intentionally absent: it is a full-screen app opened from the
 * Home tile, so the Navbar stays three items (spec §7.5).
 */
export const NAV_ORDER: NavId[] = ["home", "phone", "media"];

export interface NavItem {
  id: NavId;
  icon: string;
  label: string;
}
