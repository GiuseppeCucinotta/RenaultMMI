import { useEffect } from "react";
import { ScanLine } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useCoverFlowNavigation } from "@/hooks/useCoverFlowNavigation";
import type { JukeboxAlbum } from "@/types/jukebox";
import { useI18n } from "@/i18n";
import { CoverFlow } from "./CoverFlow";

export interface JukeboxViewProps {
  albums: JukeboxAlbum[];
  loading: boolean;
  error: string | null;
  onScan: () => void;
  onSelectAlbum: (albumId: string) => void;
  artworkUrlFor: (albumId: string) => string | null;
  focusIndex?: number | null;
  activeAlbumId?: string | null;
  isPlaying?: boolean;
}

function JukeboxEmptyState({
  title,
  hint,
  actionLabel,
  onAction,
}: {
  title: string;
  hint: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  const reduceMotion = useReducedMotion();

  return (
    <div className="flex min-h-0 flex-1 items-center justify-center px-6">
      <motion.div
        initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 24, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: "spring", stiffness: 240, damping: 24 }}
        className="w-full max-w-[520px]"
      >
        <Card className="rounded-[20px] border-warm-800/60 bg-black/20 shadow-[0_24px_60px_rgba(0,0,0,0.4)] backdrop-blur-md">
          <CardContent className="flex flex-col items-center gap-4 px-10 py-12 text-center">
            <h2 className="text-[34px] font-bold uppercase tracking-[0.06em] text-warm-300">{title}</h2>
            <p className="max-w-[420px] text-[17px] text-warm-500">{hint}</p>
            {actionLabel && onAction ? (
              <Button
                type="button"
                variant="ghost"
                className="mt-2 rounded-full bg-warm-950/50 px-8 py-3.5 text-[16px] font-semibold uppercase tracking-[0.08em] text-warm-500 hover:bg-warm-950/70 hover:text-warm-300 active:scale-95"
                onClick={onAction}
              >
                <ScanLine className="size-6" aria-hidden="true" />
                <span>{actionLabel}</span>
              </Button>
            ) : null}
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}

export function JukeboxView({
  albums,
  loading,
  error,
  onScan,
  onSelectAlbum,
  artworkUrlFor,
  focusIndex,
  activeAlbumId,
  isPlaying,
}: JukeboxViewProps) {
  const { containerRef, focusedIndex, setFocusedIndex } = useCoverFlowNavigation({
    count: albums.length,
    onSelect: (index) => {
      const album = albums[index];
      if (album) onSelectAlbum(album.id);
    },
  });

  useEffect(() => {
    if (focusIndex == null) return;
    setFocusedIndex(focusIndex);
  }, [focusIndex, setFocusedIndex]);

  const { t } = useI18n();

  if (loading) {
    return (
      <JukeboxEmptyState
        title={t("media.jukebox.scanningTitle")}
        hint={t("media.jukebox.scanningHint")}
      />
    );
  }

  if (error) {
    return (
      <JukeboxEmptyState
        title={t("media.jukebox.errorTitle")}
        hint={error}
        actionLabel={t("media.jukebox.retryScan")}
        onAction={onScan}
      />
    );
  }

  if (albums.length === 0) {
    return (
      <JukeboxEmptyState
        title={t("media.jukebox.emptyTitle")}
        hint={t("media.jukebox.emptyHint")}
        actionLabel={t("media.jukebox.scan")}
        onAction={onScan}
      />
    );
  }

  return (
    <motion.section
      ref={containerRef}
      tabIndex={0}
      aria-label={t("media.jukebox.libraryAria")}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
      className="relative z-1 min-h-0 flex-1 touch-none outline-none focus:outline-none focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0"
    >
      <CoverFlow
        albums={albums}
        focusedIndex={focusedIndex}
        activeAlbumId={activeAlbumId}
        isPlaying={isPlaying}
        artworkUrlFor={artworkUrlFor}
        onFocus={setFocusedIndex}
        onSelect={onSelectAlbum}
      />
    </motion.section>
  );
}
