import { motion, useReducedMotion } from "framer-motion";
import type { ArtworkProps } from "@/types/media";

export function Artwork({ artworkUrl, artistName, trackTitle, layoutId }: ArtworkProps) {
  const reduceMotion = useReducedMotion();

  return (
    <motion.div
      layoutId={layoutId}
      transition={{ type: "spring", stiffness: 300, damping: 30 }}
      className="relative z-[1] h-[260px] w-[260px] flex-none overflow-hidden rounded-[18px] border border-warm-500/40 shadow-[0_24px_60px_rgba(0,0,0,0.55),0_0_42px_rgba(245,158,11,0.14)]"
    >
      <motion.div
        key={trackTitle}
        initial={reduceMotion ? { opacity: 0 } : { opacity: 0, x: layoutId ? 0 : -70 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ type: "spring", stiffness: 240, damping: 26 }}
        className="relative h-full w-full [transform:perspective(900px)_rotateY(16deg)]"
      >
        <img
          className="block h-full w-full object-cover"
          src={artworkUrl}
          alt={`${artistName} - ${trackTitle}`}
        />
      </motion.div>
    </motion.div>
  );
}
