import type { NavId } from "@/types/navigation";

export const NAV_ORDER: NavId[] = ["home", "phone", "media"];

export interface NavItem {
  id: NavId;
  icon: string;
  label: string;
}
