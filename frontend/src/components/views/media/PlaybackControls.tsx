import { Pause, Play, SkipBack, SkipForward } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import type { PlaybackControlsProps } from "@/types/media";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n";

export function PlaybackControls({
  isPlaying,
  onPrevious,
  onPlayPause,
  onNext,
}: PlaybackControlsProps) {
  const reduceMotion = useReducedMotion();
  const { t } = useI18n();

  const entrance = (delay: number) => ({
    initial: reduceMotion ? { opacity: 0 } : { opacity: 0, y: 18, scale: 0.92 },
    animate: { opacity: 1, y: 0, scale: 1 },
    transition: {
      type: "spring" as const,
      stiffness: 300,
      damping: 24,
      delay,
    },
  });

  return (
    <div className="flex items-center gap-[18px]">
      <motion.div
        {...entrance(0.08)}
        whileTap={reduceMotion ? undefined : { scale: 0.92 }}
        className="size-14"
      >
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-14 rounded-full bg-warm-950/45 text-warm-500 hover:bg-warm-950/70 hover:text-warm-300"
          onClick={onPrevious}
          aria-label={t("media.player.previousTrack")}
        >
          <SkipBack className="size-7" aria-hidden="true" />
        </Button>
      </motion.div>

      <motion.div
        {...entrance(0.14)}
        whileTap={reduceMotion ? undefined : { scale: 0.92 }}
        className="size-18"
      >
        <Button
          type="button"
          size="icon"
          className="size-18 rounded-full bg-warm-500 text-warm-950 shadow-[0_0_26px_rgba(245,158,11,0.4)] hover:bg-warm-400 hover:text-warm-950"
          onClick={onPlayPause}
          aria-label={isPlaying ? t("media.player.pause") : t("media.player.play")}
        >
          {isPlaying ? (
            <Pause className="size-9" aria-hidden="true" />
          ) : (
            <Play className="size-9" aria-hidden="true" />
          )}
        </Button>
      </motion.div>

      <motion.div
        {...entrance(0.2)}
        whileTap={reduceMotion ? undefined : { scale: 0.92 }}
        className="size-14"
      >
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-14 rounded-full bg-warm-950/45 text-warm-500 hover:bg-warm-950/70 hover:text-warm-300"
          onClick={onNext}
          aria-label={t("media.player.nextTrack")}
        >
          <SkipForward className="size-7" aria-hidden="true" />
        </Button>
      </motion.div>
    </div>
  );
}
