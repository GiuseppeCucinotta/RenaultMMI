import { cn } from "@/lib/utils";
import type { PlannedRailItem } from "@/lib/settings-layout";
import type { SettingsCategoryId } from "@/types/settings";

export interface CategoryRailProps {
  /** The one header for the whole section, e.g. "Settings". */
  title: string;
  items: PlannedRailItem[];
  onSelect: (id: SettingsCategoryId) => void;
}

/**
 * Left column: the section header and the category selector.
 *
 * Categories are plain text, matching the design reference — no icons, no
 * container, no pill. The selected one is the only amber item, which is the
 * whole selection affordance; the others stay readable but recessed.
 *
 * The nav fills the viewport height and distributes the five lines across it, so
 * the list uses the space that is actually available instead of clustering at
 * the top. Labels stay on one line (`whitespace-nowrap`): the rail is sized for
 * the longest localized label, and a wrapped category name would break the
 * scannable column the reference relies on.
 *
 * It renders whatever the planner reports and never names a category itself.
 */
export function CategoryRail({ title, items, onSelect }: CategoryRailProps) {
  return (
    <nav
      aria-label={title}
      className="flex h-full w-[240px] shrink-0 flex-col justify-between gap-6"
    >
      <h1 className="text-3xl font-normal tracking-wide text-warm-50">{title}</h1>

      <ul className="flex flex-1 flex-col justify-around">
        {items.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              aria-current={item.active ? "true" : undefined}
              onClick={() => onSelect(item.id)}
              className={cn(
                "-mx-2 rounded-md px-2 text-left text-2xl tracking-wide whitespace-nowrap transition-colors duration-200",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-warm-500/80 focus-visible:ring-offset-2 focus-visible:ring-offset-black/60",
                item.active
                  ? "font-medium text-warm-500 drop-shadow-[0_0_10px_rgba(218,140,5,0.45)]"
                  : "text-warm-100/60 hover:text-warm-100",
              )}
            >
              {item.label}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
