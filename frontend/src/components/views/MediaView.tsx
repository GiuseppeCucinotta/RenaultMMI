import { useRotaryNavigation } from "@/hooks/useRotaryNavigation";
import { MusicApp } from "@/components/media-view";
import type { MediaViewProps } from "@/types/media";

export function MediaView({
  playbackFeed,
  sourceFeed,
  onSelectSource,
  onPrevious,
  onPlayPause,
  onNext,
}: MediaViewProps) {
  const isJukebox = sourceFeed.selectedSourceId === "jukebox";
  const { containerRef } = useRotaryNavigation({
    selector: "button, [role='button'], [tabindex='0']",
    enabled: !isJukebox,
  });

  return (
    <div ref={containerRef} className="flex w-full h-full">
      <MusicApp
        playbackFeed={playbackFeed}
        sourceFeed={sourceFeed}
        onSelectSource={onSelectSource}
        onPrevious={onPrevious}
        onPlayPause={onPlayPause}
        onNext={onNext}
      />
    </div>
  );
}
