import { motion, useReducedMotion } from "framer-motion";
import type { TrackMetadataProps } from "@/types/media";

export function TrackMetadata({ trackTitle, albumTitle }: TrackMetadataProps) {
  const reduceMotion = useReducedMotion();

  return (
    <motion.div
      key={trackTitle}
      initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 260, damping: 24 }}
      className="flex flex-col gap-2"
    >
      <h2 className="whitespace-nowrap text-[54px] font-bold leading-none tracking-[0.01em] text-warm-500 [text-shadow:0_0_24px_rgba(245,158,11,0.18)]">
        {trackTitle}
      </h2>
      <p className="text-[19px] font-semibold uppercase tracking-[0.12em] text-warm-500">
        {albumTitle}
      </p>
    </motion.div>
  );
}
