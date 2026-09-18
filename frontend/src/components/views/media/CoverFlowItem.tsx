import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";
import type { JukeboxAlbum } from "@/types/jukebox";
import { useI18n } from "@/i18n";

export const COVER_SIZE = 240;
export const COVER_ANCHOR_Y = "45%";

export const SHARED_ART_ID = "jukebox-now-playing";

const MAX_VISIBLE = 3;

interface Placement {
  x: number;
  scale: number;
  opacity: number;
  z: number;
}

const PLACEMENT: Record<number, Placement> = {
  0: { x: 0, scale: 1, opacity: 1, z: 40 },
  1: { x: 240, scale: 0.72, opacity: 0.5, z: 30 },
  2: { x: 440, scale: 0.52, opacity: 0.25, z: 20 },
  3: { x: 580, scale: 0.42, opacity: 0.12, z: 10 },
};

export interface CoverFlowItemProps {
  album: JukeboxAlbum;
  index: number;
  artworkUrl: string | null;
  delta: number;
  isActive?: boolean;
  isPlaying?: boolean;
  onSelect: () => void;
  onFocus: () => void;
}

function albumInitials(title: string): string {
  const words = title.split(/\s+/).filter(Boolean).slice(0, 2);
  return words.map((word) => word[0]?.toUpperCase() ?? "").join("");
}

function AlbumArtwork({ album, artworkUrl }: { album: JukeboxAlbum; artworkUrl: string | null }) {
  if (artworkUrl) {
    return (
      <img
        src={artworkUrl}
        alt={`${album.title} by ${album.artistName}`}
        className="block h-full w-full object-cover"
      />
    );
  }
  return (
    <div className="flex h-full w-full items-center justify-center bg-[linear-gradient(150deg,var(--warm-700)_0%,var(--warm-900)_55%,var(--warm-950)_100%)]">
      <span className="text-[52px] font-bold tracking-tight text-warm-400/90 [text-shadow:0_0_24px_rgba(245,158,11,0.35)]">
        {albumInitials(album.title)}
      </span>
    </div>
  );
}

function PlayingBadge({ isPlaying }: { isPlaying: boolean }) {
  return (
    <div className="absolute right-2 top-2 flex h-8 items-end gap-[3px] rounded-full bg-black/70 px-2.5 py-2 shadow-[0_2px_10px_rgba(0,0,0,0.6)]">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className={cn(
            "w-[3px] origin-bottom rounded-full bg-warm-500",
            isPlaying && "animate-eq-bar",
          )}
          style={{ height: 12, animationDelay: `${i * 0.16}s` }}
        />
      ))}
    </div>
  );
}

export function CoverFlowItem({
  album,
  index,
  artworkUrl,
  delta,
  isActive = false,
  isPlaying = false,
  onSelect,
  onFocus,
}: CoverFlowItemProps) {
  const reduceMotion = useReducedMotion();
  const { t } = useI18n();
  const absDelta = Math.abs(delta);
  if (absDelta > MAX_VISIBLE) return null;

  const placement = PLACEMENT[absDelta];
  const isFocused = delta === 0;
  const side = delta < 0 ? -1 : 1;
  const x = placement.x * side - COVER_SIZE / 2;

  const artAndLabel = (
    <div className="flex flex-col items-center" style={{ width: COVER_SIZE }}>
      <motion.div
        layoutId={isActive ? SHARED_ART_ID : undefined}
        transition={{ type: "spring", stiffness: 300, damping: 30 }}
        className={cn(
          "relative overflow-hidden rounded-[16px] border bg-warm-950 shadow-[0_18px_40px_rgba(0,0,0,0.55)]",
          isFocused
            ? "border-warm-500/50 shadow-[0_0_38px_rgba(245,158,11,0.28),0_18px_40px_rgba(0,0,0,0.55)] ring-1 ring-warm-500/60"
            : "border-warm-700/30",
        )}
        style={{ width: COVER_SIZE, height: COVER_SIZE }}
      >
        <AlbumArtwork album={album} artworkUrl={artworkUrl} />
        {isFocused && isActive ? <PlayingBadge isPlaying={isPlaying} /> : null}
      </motion.div>

      <div
        className={cn(
          "max-w-[280px] px-1 pt-2 text-center",
          isFocused ? "opacity-100" : "hidden opacity-0",
        )}
      >
        <p className="truncate text-[15px] font-bold uppercase tracking-[0.04em] text-warm-50 drop-shadow-[0_2px_6px_rgba(0,0,0,0.85)]">
          {album.title}
        </p>
        <p className="truncate text-[12px] font-semibold uppercase tracking-[0.1em] text-warm-500">
          {album.artistName}
          {album.year ? ` · ${album.year}` : ""}
        </p>
      </div>
    </div>
  );

  return (
    <motion.button
      type="button"
      data-cover-index={index}
      initial={
        reduceMotion
          ? { opacity: 0 }
          : {
              opacity: 0,
              y: 60 + (index % 8) * 24,
              scale: 0.8,
              rotateZ: side < 0 ? -4 : 4,
            }
      }
      animate={{ x, y: 0, scale: placement.scale, opacity: placement.opacity, rotateZ: 0 }}
      transition={{ type: "spring", stiffness: 320, damping: 28 }}
      style={{
        top: `calc(${COVER_ANCHOR_Y} - ${COVER_SIZE / 2}px)`,
        zIndex: placement.z,
      }}
      className="absolute left-1/2 h-auto w-auto gap-0 rounded-none bg-transparent p-0 text-warm-500 hover:bg-transparent hover:text-warm-300"
      onClick={isFocused ? onSelect : onFocus}
      onDoubleClick={isFocused ? undefined : onSelect}
      aria-label={t("media.jukebox.playAlbum", { title: album.title, artist: album.artistName })}
    >
      {artAndLabel}
    </motion.button>
  );
}
