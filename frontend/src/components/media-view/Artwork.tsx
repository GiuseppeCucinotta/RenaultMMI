import { motion, useReducedMotion } from "framer-motion";
import musicIcon from "@/assets/icons/views/music.svg";
import type { ArtworkProps } from "@/types/media";

export function Artwork({
  artworkUrl,
  artworkStatus,
  artistName,
  trackTitle,
  layoutId,
}: ArtworkProps) {
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
        {artworkStatus === "ready" && artworkUrl ? (
          <img
            className="block h-full w-full object-cover"
            src={artworkUrl}
            alt={`${artistName} - ${trackTitle}`}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-[radial-gradient(circle_at_50%_38%,var(--color-warm-800),var(--color-warm-950))]">
            {artworkStatus === "loading" ? (
              <div
                className="size-12 animate-spin rounded-full border-[3px] border-warm-500/25 border-t-warm-400"
                role="status"
                aria-label="Loading artwork"
              />
            ) : (
              <img
                src={musicIcon}
                alt=""
                aria-hidden="true"
                className="size-20 opacity-60 mix-blend-screen"
              />
            )}
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}
