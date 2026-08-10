import type { JukeboxAlbum } from "@/types/jukebox";
import { CoverFlowItem } from "./CoverFlowItem";

export interface CoverFlowProps {
  albums: JukeboxAlbum[];
  focusedIndex: number;
  activeAlbumId?: string | null;
  isPlaying?: boolean;
  artworkUrlFor: (albumId: string) => string | null;
  onFocus: (index: number) => void;
  onSelect: (albumId: string) => void;
}

export function CoverFlow({
  albums,
  focusedIndex,
  activeAlbumId,
  isPlaying,
  artworkUrlFor,
  onFocus,
  onSelect,
}: CoverFlowProps) {
  return (
    <div className="relative h-full w-full overflow-hidden">
      {albums.map((album, index) => (
        <CoverFlowItem
          key={album.id}
          album={album}
          index={index}
          artworkUrl={artworkUrlFor(album.id)}
          delta={index - focusedIndex}
          isActive={activeAlbumId != null && album.id === activeAlbumId}
          isPlaying={isPlaying}
          onFocus={() => onFocus(index)}
          onSelect={() => onSelect(album.id)}
        />
      ))}
    </div>
  );
}
