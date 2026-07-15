import { Play, Pause, SkipForward } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

export interface MediaPlayerProps {
  isPlaying?: boolean;
  trackName?: string;
  artist?: string;
  albumArt?: string;
  onPlayPause?: () => void;
  onSkip?: () => void;
}

export function MediaPlayer({
  isPlaying = false,
  trackName,
  artist,
  albumArt,
  onPlayPause,
  onSkip,
}: MediaPlayerProps) {
  const displayName = trackName || "No Media";
  const displayArtist = artist || "Plug some media!";

  return (
    <div className="flex-[0_0_25%] h-full min-w-62.5">
      <Card className="relative h-full rounded-[20px] overflow-hidden border-0 bg-black/20">
        {/* Album art background */}
        <div
          className="absolute inset-0 z-0"
          style={{
            backgroundImage: albumArt ? `url(${albumArt})` : "none",
            backgroundSize: "cover",
            backgroundPosition: "center",
          }}
        />

        <div className="absolute bottom-0 left-0 right-0 z-1 h-2/5 rounded-b-2xl bg-gradient-to-t from-black/60 to-black/5 backdrop-blur-2xl" />

        <CardContent className="relative z-2 flex flex-col justify-end h-full px-5 py-5">
          {/* Spacer — pushes content to bottom area */}
          <div className="flex-1" />

          {/* Song name (left) + Controls (right) — same horizontal level */}
          <div className="flex items-center justify-between">
            <h2 className="text-5xl font-bold text-warm-500 leading-none tracking-tight">
              {displayName}
            </h2>
            <div className="flex items-center gap-3">
              <button
                onClick={onPlayPause}
                className="w-14 h-14 flex items-center justify-center text-warm-500 hover:text-warm-400 transition-colors active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-warm-500/80 focus-visible:ring-offset-2 focus-visible:ring-offset-black/60 rounded-xl"
                aria-label={isPlaying ? "Pause" : "Play"}
              >
                {isPlaying ? <Pause className="w-10 h-10" /> : <Play className="w-10 h-10" />}
              </button>
              <button
                onClick={onSkip}
                className="w-12 h-12 flex items-center justify-center text-warm-500 hover:text-warm-400 transition-colors active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-warm-500/80 focus-visible:ring-offset-2 focus-visible:ring-offset-black/60 rounded-xl"
                aria-label="Next track"
              >
                <SkipForward className="w-8 h-8" />
              </button>
            </div>
          </div>

          {/* Artist at very bottom left */}
          <p className="text-sm text-warm-100 mt-2 font-medium">
            {displayArtist}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
