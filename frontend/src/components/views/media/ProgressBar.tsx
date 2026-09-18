import { motion, useReducedMotion } from "framer-motion";
import type { ProgressBarProps } from "@/types/media";
import { Slider } from "@/components/ui/slider";
import { useI18n } from "@/i18n";

export function ProgressBar({
  currentTimeSeconds,
  durationSeconds,
  onSeek,
  disabled = false,
}: ProgressBarProps) {
  const reduceMotion = useReducedMotion();
  const { t } = useI18n();
  const max = Math.max(0, Math.round(durationSeconds));
  const current = Math.min(max, Math.max(0, currentTimeSeconds));

  return (
    <motion.div
      initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 40 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 220, damping: 26, delay: 0.45 }}
      className="w-full"
    >
      <Slider
        className="w-full"
        value={[current]}
        min={0}
        max={max}
        step={1}
        disabled={disabled}
        aria-label={t("media.player.playbackPosition")}
        onValueChange={(value) => onSeek?.(value[0])}
        trackClassName="h-2.5 rounded-full border border-warm-700 bg-warm-800"
        rangeClassName="bg-warm-500 shadow-[0_0_16px_rgba(245,158,11,0.55)]"
        thumbClassName="size-4 border-warm-950 bg-warm-500"
      />
    </motion.div>
  );
}
