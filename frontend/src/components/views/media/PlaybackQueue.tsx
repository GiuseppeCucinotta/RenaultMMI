import { useEffect, useRef } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { JukeboxAlbum } from "@/types/jukebox";
import { useI18n } from "@/i18n";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

const QUEUE_WIDTH = 620;

function formatDuration(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function ensureRowVisible(list: HTMLDivElement, row: HTMLElement): void {
  const rowRect = row.getBoundingClientRect();
  const listRect = list.getBoundingClientRect();
  if (rowRect.top < listRect.top) {
    list.scrollTop -= listRect.top - rowRect.top;
  } else if (rowRect.bottom > listRect.bottom) {
    list.scrollTop += rowRect.bottom - listRect.bottom;
  }
}

function NowPlayingBars({ isPlaying }: { isPlaying: boolean }) {
  return (
    <div className="flex h-[18px] items-end gap-[3px]" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className={cn(
            "w-[3px] origin-bottom rounded-full bg-warm-500",
            isPlaying && "animate-eq-bar",
          )}
          style={{ height: 14, animationDelay: `${i * 0.16}s` }}
        />
      ))}
    </div>
  );
}

export interface PlaybackQueueProps {
  album: JukeboxAlbum;
  currentTrackIndex: number;
  isPlaying: boolean;
  onSelectTrack: (trackIndex: number) => void;
  onClose: () => void;
}

export function PlaybackQueue({
  album,
  currentTrackIndex,
  isPlaying,
  onSelectTrack,
  onClose,
}: PlaybackQueueProps) {
  const reduceMotion = useReducedMotion();
  const { t } = useI18n();
  const currentRowRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const row = currentRowRef.current;
    const list = listRef.current;
    if (!row || !list) return;
    ensureRowVisible(list, row);
  }, [album.id, currentTrackIndex]);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const onFocusIn = () => {
      const row = list.querySelector<HTMLElement>("button:focus");
      if (!row) return;
      ensureRowVisible(list, row);
    };
    list.addEventListener("focusin", onFocusIn);
    return () => list.removeEventListener("focusin", onFocusIn);
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18, ease: "easeOut" }}
      className="absolute inset-0 z-20 flex justify-end"
    >
      <button
        type="button"
        tabIndex={-1}
        onClick={onClose}
        aria-label={t("media.player.closeQueue")}
        className="absolute inset-0 cursor-default"
      />
      <motion.aside
        data-queue-drawer
        initial={
          reduceMotion ? { opacity: 0 } : { opacity: 0, x: QUEUE_WIDTH }
        }
        animate={{ opacity: 1, x: 0 }}
        exit={reduceMotion ? { opacity: 0 } : { opacity: 0, x: QUEUE_WIDTH }}
        transition={{ type: "spring", stiffness: 320, damping: 32 }}
        style={{ width: QUEUE_WIDTH }}
        className="relative z-[1] my-4 mr-4 h-[calc(100%-2rem)] flex-none"
      >
        <Card className="flex h-full w-full flex-col gap-0 overflow-hidden rounded-2xl border-warm-800/70 bg-black/50 py-0 shadow-[-24px_24px_80px_rgba(0,0,0,0.65)]">
          <div className="flex flex-none items-center justify-between gap-4 px-6 pb-1 pt-5">
            <div className="min-w-0">
              <h3 className="truncate text-[20px] font-bold uppercase tracking-[0.05em] text-warm-100">
                {album.title}
              </h3>
              <p className="truncate text-[13px] font-semibold uppercase tracking-[0.12em] text-warm-500">
                {album.artistName} · {album.songs.length}{" "}
                {t("media.jukebox.trackCount")}
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-12 flex-none rounded-full bg-warm-900/50 text-warm-400 hover:bg-warm-900/80 hover:text-warm-200"
              onClick={onClose}
              aria-label={t("media.player.closeQueue")}
            >
              <X className="size-6" aria-hidden="true" />
            </Button>
          </div>

          <div
            ref={listRef}
            role="listbox"
            aria-label={t("media.jukebox.queueAria")}
            className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-2 py-3 [scrollbar-width:thin] [scrollbar-color:var(--warm-700)_transparent] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-warm-700/70"
          >
            {album.songs.map((song, index) => {
              const isCurrent = index === currentTrackIndex;
              return (
                <motion.button
                  key={song.id}
                  type="button"
                  ref={isCurrent ? currentRowRef : undefined}
                  role="option"
                  aria-selected={isCurrent}
                  aria-label={t("media.jukebox.playTrackInQueue", { title: song.title })}
                  initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 16 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{
                    type: "spring",
                    stiffness: 300,
                    damping: 26,
                    delay: reduceMotion ? 0 : 0.03 * index,
                  }}
                  onClick={() => onSelectTrack(index)}
                  className={cn(
                    "flex w-full items-center gap-4 rounded-[14px] px-4 py-3 text-left transition-colors",
                    isCurrent
                      ? "bg-warm-500/15 text-warm-100 shadow-[inset_0_0_0_1px_rgba(245,158,11,0.25)]"
                      : "text-warm-400 hover:bg-warm-900/40 hover:text-warm-200",
                  )}
                >
                  <span
                    className={cn(
                      "flex w-9 flex-none items-center justify-center text-[15px] font-bold tabular-nums",
                      isCurrent ? "text-warm-500" : "text-warm-600",
                    )}
                  >
                    {isCurrent ? <NowPlayingBars isPlaying={isPlaying} /> : song.track}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span
                      className={cn(
                        "block truncate text-[17px] font-semibold leading-tight",
                        isCurrent && "text-warm-50",
                      )}
                    >
                      {song.title}
                    </span>
                    <span
                      className={cn(
                        "block text-[11px] font-semibold uppercase tracking-[0.14em]",
                        isCurrent ? "text-warm-500" : "text-warm-600",
                      )}
                    >
                      {isCurrent
                        ? isPlaying
                          ? t("media.jukebox.playingNow")
                          : t("media.jukebox.currentTrack")
                        : song.format}
                    </span>
                  </span>
                  <span className="flex-none text-[14px] font-medium tabular-nums text-warm-500">
                    {formatDuration(song.durationSeconds)}
                  </span>
                </motion.button>
              );
            })}
          </div>
        </Card>
      </motion.aside>
    </motion.div>
  );
}
