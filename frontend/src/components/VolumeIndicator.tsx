import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Volume2, VolumeX } from "lucide-react";
import { useEntertainmentVolume } from "@/hooks/useEntertainmentVolume";
import {
  ENTERTAINMENT_VOLUME_MAX,
  VOLUME_OSD_HIDE_DELAY_MS,
} from "@/constants/entertainment";

/**
 * Car-style volume overlay. Fades in at the bottom-center whenever the
 * entertainment volume value changes and auto-hides after a short delay.
 * Deliberately does not pop up on first mount or on source switches.
 */
export function VolumeIndicator() {
  const { volume } = useEntertainmentVolume();
  const [visible, setVisible] = useState(false);
  const previousVolumeRef = useRef<number | null>(null);
  const hideTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (previousVolumeRef.current === null) {
      previousVolumeRef.current = volume;
      return;
    }
    if (volume === previousVolumeRef.current) return;
    previousVolumeRef.current = volume;

    setVisible(true);
    if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
    hideTimerRef.current = window.setTimeout(
      () => setVisible(false),
      VOLUME_OSD_HIDE_DELAY_MS,
    );
  }, [volume]);

  useEffect(
    () => () => {
      if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
    },
    [],
  );

  const muted = volume <= 0;
  const percent = Math.round((volume / ENTERTAINMENT_VOLUME_MAX) * 100);

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-8 z-50 flex justify-center">
      <AnimatePresence>
        {visible && (
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.97 }}
            transition={{ type: "spring", stiffness: 320, damping: 26 }}
            role="status"
            aria-live="polite"
            className="flex items-center gap-5 rounded-2xl border border-warm-500/25 bg-warm-950/85 px-6 py-4 shadow-[0_8px_32px_rgba(0,0,0,0.55)] backdrop-blur-md"
          >
            <span className="flex items-center gap-3">
              {muted ? (
                <VolumeX className="size-7 text-warm-300" strokeWidth={2} />
              ) : (
                <Volume2 className="size-7 text-warm-500" strokeWidth={2} />
              )}
              <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-warm-200">
                Entertainment
              </span>
            </span>

            <span className="flex items-center gap-3">
              <span className="h-1.5 w-44 overflow-hidden rounded-full bg-warm-900">
                <motion.span
                  className="block h-full rounded-full bg-warm-500"
                  animate={{ width: `${percent}%` }}
                  transition={{ type: "spring", stiffness: 260, damping: 24 }}
                />
              </span>
              <span className="w-10 text-right font-mono text-xl font-semibold text-warm-50">
                {volume}
              </span>
            </span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
