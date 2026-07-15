import { DEFAULT_APPS, type AppItem } from "@/data/apps";

export interface AppsGridProps {
  apps?: AppItem[];
  gap?: string;
}

export function AppsGrid({ apps = DEFAULT_APPS, gap = "gap-4" }: AppsGridProps) {
  return (
    <div className="flex-[1_1_50%] h-full min-w-112.5">
      <div className={`grid grid-cols-4 ${gap} h-full`}>
        {apps.map((app) => (
          <button
            key={app.id}
            onClick={() => app.onClick?.()}
            className="
              relative flex items-center justify-center
              rounded-[20px]
              bg-linear-to-br from-[#F59E0B]/10 to-[#09090B]/20
              border border-white/10
              hover:border-white/20
              active:scale-[0.94]
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-warm-500/80 focus-visible:ring-offset-2 focus-visible:ring-offset-black/60
              transition-all duration-200
            "
          >
            <div className="text-warm-500 relative z-10">
              {app.icon}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
