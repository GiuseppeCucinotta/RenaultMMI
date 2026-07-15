import { useRotaryNavigation } from "@/hooks/useRotaryNavigation";
import { MediaPlayer, AppsGrid, CarStatus } from ".";

export interface HomeViewProps {
  isPlaying?: boolean;
  trackName?: string;
  artist?: string;
  onPlayPause?: () => void;
  onSkip?: () => void;
}

export function HomeView({
  isPlaying,
  trackName,
  artist,
  onPlayPause,
  onSkip,
}: HomeViewProps) {
  const { containerRef } = useRotaryNavigation({
    selector: "button, [role='button'], [tabindex='0']",
  });

  return (
    <div ref={containerRef} className="flex w-full h-full gap-4">
      <MediaPlayer
        isPlaying={isPlaying}
        trackName={trackName}
        artist={artist}
        onPlayPause={onPlayPause}
        onSkip={onSkip}
      />
      <AppsGrid />
      <CarStatus />
    </div>
  );
}
