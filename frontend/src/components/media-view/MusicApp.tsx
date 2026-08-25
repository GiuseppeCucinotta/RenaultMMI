import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, AudioLines, ListMusic } from "lucide-react";
import type { MusicAppProps } from "@/types/media";
import { Button } from "@/components/ui/button";
import { useJukeboxContext } from "@/context/jukebox";
import { useBluetoothContext } from "@/context/bluetooth";
import { useRotaryNavigation } from "@/hooks/useRotaryNavigation";
import { DEFAULT_PLAYBACK_FEED } from "@/data/media";
import { Watermark } from "./Watermark";
import { Clock } from "./Clock";
import { SourceSelector } from "./SourceSelector";
import { PlayerDisplay } from "./PlayerDisplay";
import { JukeboxView } from "./JukeboxView";
import { PlaybackQueue } from "./PlaybackQueue";
import { SHARED_ART_ID } from "./CoverFlowItem";
import { useI18n } from "@/i18n";

type JukeboxMode = "library" | "player";

const BODY_TRANSITION = { duration: 0.22, ease: "easeInOut" as const };

const PLAYER_ROTARY_SELECTOR = "button, [role='button'], [tabindex='0']";
const QUEUE_ROTARY_SELECTOR = "[data-queue-drawer] button";

export function MusicApp({
  playbackFeed,
  sourceFeed,
  onSelectSource,
  onPrevious,
  onPlayPause,
  onNext,
  onSeek,
}: MusicAppProps) {
  const jukebox = useJukeboxContext();
  const bluetooth = useBluetoothContext();
  const { t } = useI18n();
  const [jukeboxMode, setJukeboxMode] = useState<JukeboxMode>("library");
  const [showQueue, setShowQueue] = useState(false);
  const isJukebox = sourceFeed.selectedSourceId === "jukebox";
  const isBluetooth = sourceFeed.selectedSourceId === "bluetooth";

  const playerRotary = useRotaryNavigation({
    selector: showQueue ? QUEUE_ROTARY_SELECTOR : PLAYER_ROTARY_SELECTOR,
    enabled: isJukebox && jukeboxMode === "player",
  });
  const { containerRef, focusElement } = playerRotary;

  const prevQueueOpen = useRef(false);

  useEffect(() => {
    const opened = showQueue && !prevQueueOpen.current;
    prevQueueOpen.current = showQueue;
    if (!opened) return;
    const listbox = containerRef.current?.querySelector('[role="listbox"]');
    const rows = listbox
      ? Array.from(listbox.querySelectorAll<HTMLElement>("button"))
      : [];
    const target = rows[jukebox.state.trackIndex] ?? rows[0];
    if (!target) return;
    const frame = requestAnimationFrame(() => focusElement(target));
    return () => cancelAnimationFrame(frame);
  }, [showQueue, focusElement, containerRef, jukebox.state.trackIndex]);

  const handleSelectAlbum = useCallback(
    (albumId: string) => {
      if (jukebox.state.albumId === albumId) {
        setJukeboxMode("player");
        return;
      }
      void jukebox.playAlbum(albumId).then((started) => {
        if (started) setJukeboxMode("player");
      });
    },
    [jukebox],
  );

  const playingAlbumIndex = useMemo(() => {
    if (!jukebox.state.albumId) return null;
    const index = jukebox.albums.findIndex((album) => album.id === jukebox.state.albumId);
    return index >= 0 ? index : null;
  }, [jukebox.state.albumId, jukebox.albums]);

  const activeFeed = isJukebox
    ? (jukebox.playbackFeed ?? DEFAULT_PLAYBACK_FEED)
    : isBluetooth
      ? bluetooth.playbackFeed
      : {
          ...playbackFeed,
          trackTitle: playbackFeed.trackTitle || t("media.noMedia"),
        };

  const inPlayer = isJukebox && jukeboxMode === "player";
  const hasAlbum = jukebox.state.albumId != null;

  const currentAlbum = useMemo(() => {
    if (!jukebox.state.albumId) return null;
    return (
      jukebox.albums.find((album) => album.id === jukebox.state.albumId) ?? null
    );
  }, [jukebox.state.albumId, jukebox.albums]);

  useEffect(() => {
    if (!inPlayer) setShowQueue(false);
  }, [inPlayer]);

  useEffect(() => {
    if (!isJukebox) setJukeboxMode("library");
  }, [isJukebox]);

  const header = (
    <div className="relative z-[1] flex min-h-[76px] flex-none items-center justify-center px-6">
      {inPlayer ? (
        <div className="absolute left-6 top-1/2 flex -translate-y-1/2 items-center gap-3">
          <Button
            type="button"
            variant="ghost"
            className="h-auto rounded-full px-5 py-3 text-[15px] font-semibold uppercase tracking-[0.08em] text-warm-400 hover:bg-warm-950/40 hover:text-warm-200 active:scale-95"
            onClick={() => setJukeboxMode("library")}
            aria-label={t("media.player.backToLibrary")}
          >
            <ArrowLeft className="size-5" aria-hidden="true" />
            <span>{t("media.player.library")}</span>
          </Button>
          {currentAlbum ? (
            <Button
              type="button"
              variant="ghost"
              className="h-auto rounded-full px-5 py-3 text-[15px] font-semibold uppercase tracking-[0.08em] text-warm-400 hover:bg-warm-950/40 hover:text-warm-200 active:scale-95"
              onClick={() => setShowQueue((open) => !open)}
            >
              <ListMusic className="size-5" aria-hidden="true" />
              <span>{t("media.jukebox.queue")}</span>
            </Button>
          ) : null}
        </div>
      ) : isJukebox && hasAlbum ? (
        <Button
          type="button"
          variant="ghost"
          className="absolute left-6 top-1/2 h-auto -translate-y-1/2 rounded-full px-5 py-3 text-[15px] font-semibold uppercase tracking-[0.08em] text-warm-500 hover:bg-warm-950/40 hover:text-warm-200 active:scale-95"
          onClick={() => setJukeboxMode("player")}
          aria-label={t("media.player.backToNowPlaying")}
        >
          <AudioLines className="size-5" aria-hidden="true" />
          <span>{t("media.player.nowPlaying")}</span>
        </Button>
      ) : null}
      <SourceSelector feed={sourceFeed} onSelectSource={onSelectSource} />
      <Clock />
    </div>
  );

  return (
    <div ref={containerRef} className="relative flex h-full w-full flex-col overflow-hidden">
      {header}
      <div className="relative min-h-0 flex-1">
        <AnimatePresence mode="popLayout">
          {isJukebox && jukeboxMode === "library" ? (
            <motion.div
              key="jukebox-library"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={BODY_TRANSITION}
              className="relative flex h-full w-full flex-col"
            >
              <JukeboxView
                albums={jukebox.albums}
                loading={jukebox.mode === "loading"}
                error={jukebox.error}
                onScan={jukebox.scan}
                onSelectAlbum={handleSelectAlbum}
                artworkUrlFor={jukebox.artworkUrlFor}
                focusIndex={playingAlbumIndex}
                activeAlbumId={jukebox.state.albumId}
                isPlaying={jukebox.state.isPlaying}
              />
            </motion.div>
          ) : isJukebox ? (
            <motion.div
              key="jukebox-player"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={BODY_TRANSITION}
              className="relative flex h-full w-full flex-col overflow-hidden"
            >
              <Watermark artistName={activeFeed.artistName} />
              <PlayerDisplay
                playbackFeed={activeFeed}
                sourceId={sourceFeed.selectedSourceId}
                sharedLayoutId={SHARED_ART_ID}
                onPrevious={jukebox.previous}
                onPlayPause={jukebox.toggle}
                onNext={jukebox.next}
                onSeek={jukebox.seek}
              />
              <AnimatePresence>
                {showQueue && currentAlbum ? (
                  <PlaybackQueue
                    album={currentAlbum}
                    currentTrackIndex={jukebox.state.trackIndex}
                    isPlaying={jukebox.state.isPlaying}
                    onSelectTrack={(index) => {
                      void jukebox.playTrack(index);
                      setShowQueue(false);
                    }}
                    onClose={() => setShowQueue(false)}
                  />
                ) : null}
              </AnimatePresence>
            </motion.div>
          ) : (
            <motion.div
              key="source-player"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={BODY_TRANSITION}
              className="relative flex h-full w-full flex-col overflow-hidden"
            >
              <Watermark artistName={activeFeed.artistName} />
              <PlayerDisplay
                playbackFeed={activeFeed}
                sourceId={sourceFeed.selectedSourceId}
                onPrevious={isBluetooth ? bluetooth.previous : onPrevious}
                onPlayPause={isBluetooth ? bluetooth.toggle : onPlayPause}
                onNext={isBluetooth ? bluetooth.next : onNext}
                onSeek={isBluetooth ? undefined : onSeek}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
