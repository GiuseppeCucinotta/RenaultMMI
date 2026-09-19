import { motion, useReducedMotion } from "framer-motion";
import { useRotaryNavigation } from "@/hooks/useRotaryNavigation";
import type { AppItem } from "@/data/apps";
import { MediaPlayer, AppsGrid, CarStatus } from ".";

export interface HomeViewProps {
  isPlaying?: boolean;
  trackName?: string;
  source?: string;
  albumArt?: string | null;
  onPlayPause?: () => void;
  onSkip?: () => void;
  /** App tiles to show; the shell decides which ones carry an `onClick`. */
  apps?: AppItem[];
}

export function HomeView({
  isPlaying,
  trackName,
  source,
  albumArt,
  onPlayPause,
  onSkip,
  apps,
}: HomeViewProps) {
  const reduceMotion = useReducedMotion();
  const { containerRef } = useRotaryNavigation({
    selector: "button, [role='button'], [tabindex='0']",
  });

  return (
    <motion.div
      ref={containerRef}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: reduceMotion ? 0 : 0.3, ease: "easeOut" }}
      className="flex w-full h-full gap-4 min-w-0 overflow-hidden"
    >
      <MediaPlayer
        isPlaying={isPlaying}
        trackName={trackName}
        source={source}
        albumArt={albumArt}
        onPlayPause={onPlayPause}
        onSkip={onSkip}
      />
      <AppsGrid apps={apps} />
      <CarStatus />
    </motion.div>
  );
}
