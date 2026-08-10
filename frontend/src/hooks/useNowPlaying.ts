import type { MediaSource, NowPlayingFeed } from "@/types/media";
import { EMPTY_ADAPTER, useMediaSourceAdapters } from "./useMediaSourceAdapters";
import { getMessage, useI18n, type TranslationKey } from "@/i18n";

const NOOP = (): void => undefined;

function sourceLabelKey(id: string): TranslationKey {
  return `media.sources.${id}` as TranslationKey;
}

/**
 * Resolves the "now playing" state shown on the home screen.
 *
 * Always prefers whatever source is *actually* playing, falling back to
 * the currently selected source when nothing has media loaded. Controls are
 * only wired when the resolved source can actually act on them.
 */
export function useNowPlaying(
  selectedSourceId: string,
  sources: MediaSource[],
): NowPlayingFeed {
  const { t, locale } = useI18n();
  const adapters = useMediaSourceAdapters();
  const selectedAdapter = adapters[selectedSourceId] ?? EMPTY_ADAPTER;

  const activeAdapter =
    Object.values(adapters).find((adapter) => adapter.isActive()) ?? null;
  const adapter = activeAdapter ?? selectedAdapter;

  const nowPlaying = adapter.getNowPlaying();
  const canControl = adapter.isActive();

  return {
    trackName: nowPlaying?.trackTitle ?? t("media.noMedia"),
    source:
      nowPlaying?.sourceName ??
      getMessage(locale, sourceLabelKey(selectedSourceId)) ??
      sources.find((source) => source.id === selectedSourceId)?.name ??
      selectedSourceId,
    albumArt: nowPlaying?.albumArtUrl ?? null,
    isPlaying: nowPlaying?.isPlaying ?? false,
    onPlayPause: canControl ? adapter.togglePlayPause : NOOP,
    onSkip: canControl ? adapter.skipToNext : NOOP,
  };
}
