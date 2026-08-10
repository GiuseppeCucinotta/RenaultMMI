import type { PlayerDisplayProps } from "@/types/media";
import { Artwork } from "./Artwork";
import { TrackMetadata } from "./TrackMetadata";
import { PlaybackControls } from "./PlaybackControls";
import { ProgressBar } from "./ProgressBar";

export function PlayerDisplay({
  playbackFeed,
  sourceId,
  sharedLayoutId,
  onPrevious,
  onPlayPause,
  onNext,
  onSeek,
}: PlayerDisplayProps) {
  const { artistName, trackTitle, albumTitle, artworkUrl, isPlaying } = playbackFeed;
  const seekable = onSeek != null && playbackFeed.durationSeconds > 0;

  return (
    <section className="relative z-[1] flex min-h-0 flex-1 flex-col">
      <div className="relative z-[1] flex min-h-0 flex-1 items-center justify-start gap-14 px-6">
        <div className="relative flex-none">
          <Artwork
            artworkUrl={artworkUrl}
            artistName={artistName}
            trackTitle={trackTitle}
            layoutId={sharedLayoutId}
          />
          {sourceId === "cd" && (
            <div
              className="pointer-events-none absolute left-[70%] top-1/2 z-0 -translate-x-1/2 -translate-y-1/2"
              aria-hidden="true"
            >
              <div className="size-[250px] animate-cd-spin rounded-full bg-[radial-gradient(circle_at_50%_50%,transparent_0_12%,rgba(9,8,4,0.95)_13%_52%,rgba(64,54,40,0.9)_53%_56%,rgba(9,8,4,0.95)_57%_97%,rgba(245,158,11,0.18)_98%_100%)] shadow-[0_0_0_1px_rgba(0,0,0,0.6),0_20px_45px_rgba(0,0,0,0.55)]" />
            </div>
          )}
        </div>

        <div className="flex flex-col items-start gap-[26px]">
          <TrackMetadata trackTitle={trackTitle} albumTitle={albumTitle} />
          <PlaybackControls
            isPlaying={isPlaying}
            onPrevious={onPrevious}
            onPlayPause={onPlayPause}
            onNext={onNext}
          />
        </div>
      </div>

      <div className="relative z-[1] flex flex-none justify-start px-6 pb-[18px]">
        <ProgressBar
          currentTimeSeconds={playbackFeed.currentTimeSeconds}
          durationSeconds={playbackFeed.durationSeconds}
          onSeek={onSeek}
          disabled={!seekable}
        />
      </div>
    </section>
  );
}
