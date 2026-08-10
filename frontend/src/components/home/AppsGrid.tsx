import { motion, useReducedMotion } from "framer-motion";
import { DEFAULT_APPS, type AppItem } from "@/data/apps";
import { getMessage, useI18n, type TranslationKey } from "@/i18n";

export interface AppsGridProps {
  apps?: AppItem[];
  gap?: string;
}

function appLabelKey(id: string): TranslationKey {
  return `apps.${id}` as TranslationKey;
}

export function AppsGrid({ apps = DEFAULT_APPS, gap = "gap-4" }: AppsGridProps) {
  const reduceMotion = useReducedMotion();
  const { locale } = useI18n();

  return (
    <div className="flex-[1_1_50%] h-full min-w-112.5">
      <div className={`grid grid-cols-4 ${gap} h-full`}>
        {apps.map((app, index) => (
          <motion.button
            key={app.id}
            aria-label={getMessage(locale, appLabelKey(app.id)) ?? app.name}
            onClick={() => app.onClick?.()}
            initial={
              reduceMotion
                ? { opacity: 0 }
                : { opacity: 0, y: 28, scale: 0.94 }
            }
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{
              type: "spring",
              stiffness: 300,
              damping: 24,
              delay: reduceMotion ? 0 : 0.1 + index * 0.045,
            }}
            whileTap={reduceMotion ? undefined : { scale: 0.93 }}
            className="
              relative flex items-center justify-center
              rounded-[20px]
              bg-linear-to-br from-[#F59E0B]/10 to-[#09090B]/20
              border border-white/10
              hover:border-white/20
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-warm-500/80 focus-visible:ring-offset-2 focus-visible:ring-offset-black/60
              transition-colors duration-200
            "
          >
            <div className="text-warm-500 relative z-10">
              {app.icon}
            </div>
          </motion.button>
        ))}
      </div>
    </div>
  );
}
