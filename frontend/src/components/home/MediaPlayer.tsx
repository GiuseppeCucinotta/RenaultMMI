import { Play, Pause, SkipForward } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { Card, CardContent } from "@/components/ui/card";
import { useI18n } from "@/i18n";

export interface MediaPlayerProps {
  isPlaying?: boolean;
  trackName?: string;
  source?: string;
  albumArt?: string | null;
  onPlayPause?: () => void;
  onSkip?: () => void;
}

export function MediaPlayer({
  isPlaying = false,
  trackName,
  source,
  albumArt,
  onPlayPause,
  onSkip,
}: MediaPlayerProps) {
  const reduceMotion = useReducedMotion();
  const { t } = useI18n();
  const displayName = trackName || t("media.noMedia");
  const displaySource = source || t("media.noSource");

  return (
    <div className="flex-[0_0_25%] h-full min-w-62.5">
      <motion.div
        initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 40 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 240, damping: 26 }}
        className="h-full"
      >
        <Card className="relative h-full rounded-[20px] overflow-hidden border-0 bg-black/20">
          {/* Album art background */}
          <motion.div
            className="absolute inset-0 z-0"
            initial={reduceMotion ? undefined : { scale: 1.15 }}
            animate={{ scale: 1 }}
            transition={{ duration: reduceMotion ? 0 : 1.2, ease: "easeOut" }}
            style={{
              backgroundImage: albumArt ? `url(${albumArt})` : "none",
              backgroundSize: "cover",
              backgroundPosition: "center",
            }}
          />

          <div className="absolute bottom-0 left-0 right-0 z-1 h-2/5 rounded-b-2xl bg-linear-to-t from-black/60 to-black/5 backdrop-blur-2xl" />

          <CardContent className="relative z-2 flex flex-col justify-end h-full px-5 py-5">
            {/* Spacer — pushes content to bottom area */}
            <div className="flex-1" />

            {/* Song name (left) + Controls (right) — same horizontal level */}
            <motion.div
              initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 22 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ type: "spring", stiffness: 280, damping: 24, delay: 0.12 }}
              className="flex items-center justify-between gap-3"
            >
              <h2 className="min-w-0 truncate text-5xl font-bold text-warm-500 leading-none tracking-tight">
                {displayName}
              </h2>
              <div className="flex shrink-0 items-center gap-3">
                <motion.button
                  onClick={onPlayPause}
                  whileTap={reduceMotion ? undefined : { scale: 0.92 }}
                  transition={{ type: "spring", stiffness: 400, damping: 22 }}
                  className="w-14 h-14 flex items-center justify-center text-warm-500 hover:text-warm-400 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-warm-500/80 focus-visible:ring-offset-2 focus-visible:ring-offset-black/60 rounded-xl"
                  aria-label={isPlaying ? t("media.player.pause") : t("media.player.play")}
                >
                  {isPlaying ? <Pause className="w-10 h-10" /> : <Play className="w-10 h-10" />}
                </motion.button>
                <motion.button
                  onClick={onSkip}
                  whileTap={reduceMotion ? undefined : { scale: 0.92 }}
                  transition={{ type: "spring", stiffness: 400, damping: 22 }}
                  className="w-12 h-12 flex items-center justify-center text-warm-500 hover:text-warm-400 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-warm-500/80 focus-visible:ring-offset-2 focus-visible:ring-offset-black/60 rounded-xl"
                  aria-label={t("media.player.nextTrack")}
                >
                  <SkipForward className="w-8 h-8" />
                </motion.button>
              </div>
            </motion.div>

            {/* Source at very bottom left */}
            <motion.p
              initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ type: "spring", stiffness: 280, damping: 24, delay: 0.24 }}
              className="mt-2 text-sm font-medium text-warm-100"
            >
              {displaySource}
            </motion.p>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
