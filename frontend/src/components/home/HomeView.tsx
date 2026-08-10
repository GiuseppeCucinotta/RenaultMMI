import { motion, useReducedMotion } from "framer-motion";
import { useRotaryNavigation } from "@/hooks/useRotaryNavigation";
import { MediaPlayer, AppsGrid, CarStatus } from ".";

export interface HomeViewProps {
  isPlaying?: boolean;
  trackName?: string;
  source?: string;
  albumArt?: string | null;
  onPlayPause?: () => void;
  onSkip?: () => void;
}

export function HomeView({
  isPlaying,
  trackName,
  source,
  albumArt,
  onPlayPause,
  onSkip,
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
      className="flex w-full h-full gap-4"
    >
      <MediaPlayer
        isPlaying={isPlaying}
        trackName={trackName}
        source={source}
        albumArt={albumArt}
        onPlayPause={onPlayPause}
        onSkip={onSkip}
      />
      <AppsGrid />
      <CarStatus />
    </motion.div>
  );
}
