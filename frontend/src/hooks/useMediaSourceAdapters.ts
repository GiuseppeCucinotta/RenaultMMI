import { DEFAULT_SOURCES } from "@/data/media";
import { useJukeboxContext } from "@/context/jukebox";
import { useBluetoothContext } from "@/context/bluetooth";
import { useCdContext } from "@/context/cd";
import type { ArtworkStatus, MediaSourceAdapter, SourceNowPlaying } from "@/types/media";
import type { BluetoothTrack } from "@/types/bluetooth";
import { useI18n } from "@/i18n";
import demoArtwork from "@/assets/icons/apps/Music.png";

const NOOP = (): void => undefined;

/**
 * Bridges the Bluetooth-specific artwork lifecycle onto the generic
 * `ArtworkStatus` contract consumed by the now-playing hub.
 */
function artworkStatusFrom(state: BluetoothTrack["artworkState"]): ArtworkStatus {
  if (state === "ready") return "ready";
  if (state === "loading") return "loading";
  return "unknown";
}

export const EMPTY_ADAPTER: MediaSourceAdapter = {
  getNowPlaying: () => null,
  isActive: () => false,
  togglePlayPause: NOOP,
  skipToNext: NOOP,
};

/**
 * Adapters provide the "now playing" contract per audio source.
 *
 * Adding a source (Bluetooth, CD, FM, ...) means giving it a real adapter in
 * the map below — the home player and any future consumer pick it up with no
 * further changes. Adapter factories are plain closures over data the source
 * already provides (e.g. the jukebox/bluetooth contexts); they are NOT hooks,
 * so the map can be iterated safely.
 */
export function useMediaSourceAdapters(): Record<string, MediaSourceAdapter> {
  const jukebox = useJukeboxContext();
  const bluetooth = useBluetoothContext();
  const cd = useCdContext();
  const { t } = useI18n();

  const jukeboxNowPlaying = (): SourceNowPlaying | null => {
    if (!jukebox.state.albumId) return null;
    const albumArtUrl = jukebox.artworkUrlFor(jukebox.state.albumId) ?? demoArtwork;
    return {
      sourceId: "jukebox",
      sourceName: t("media.sources.jukebox"),
      trackTitle: jukebox.state.trackTitle,
      artistName: jukebox.state.artistName,
      albumTitle: jukebox.state.albumTitle,
      albumArtUrl,
      artworkStatus: "ready",
      isPlaying: jukebox.state.isPlaying,
    };
  };

  const bluetoothNowPlaying = (): SourceNowPlaying => {
    // Bluetooth media belongs to the active phone: no phone, no player.
    const { media } = bluetooth.state;
    const track = media.track;
    return {
      sourceId: "bluetooth",
      sourceName: t("media.sources.bluetooth"),
      trackTitle: track?.title ?? t("media.bluetooth.noPhoneConnected"),
      artistName: track?.artist ?? null,
      albumTitle: track?.album ?? null,
      albumArtUrl: null,
      artworkStatus: artworkStatusFrom(track?.artworkState ?? "none"),
      isPlaying: media.status === "playing",
    };
  };

  const cdNowPlaying = (): SourceNowPlaying => {
    if (!cd.state.hasDisc) {
      return {
        sourceId: "cd",
        sourceName: t("media.sources.cd"),
        trackTitle: t("media.cd.noDisc"),
        artistName: null,
        albumTitle: null,
        albumArtUrl: null,
        artworkStatus: "unknown",
        isPlaying: false,
      };
    }
    const track =
      cd.state.tracks.find((candidate) => candidate.index === cd.state.currentTrackIndex) ??
      null;
    return {
      sourceId: "cd",
      sourceName: t("media.sources.cd"),
      trackTitle: track?.title ?? t("media.cd.noDisc"),
      artistName: null,
      albumTitle: cd.state.discTitle,
      albumArtUrl: null,
      artworkStatus: "unknown",
      isPlaying: cd.state.isPlaying,
    };
  };

  const SOURCE_ADAPTER_FACTORIES: Record<string, () => MediaSourceAdapter> = {
    jukebox: () => ({
      getNowPlaying: jukeboxNowPlaying,
      isActive: () => jukebox.state.albumId !== null,
      togglePlayPause: () => void jukebox.toggle(),
      skipToNext: () => void jukebox.next(),
    }),
    bluetooth: () => ({
      getNowPlaying: bluetoothNowPlaying,
      isActive: () => bluetooth.state.media.deviceId != null && bluetooth.state.media.track != null,
      togglePlayPause: () => void bluetooth.toggle(),
      skipToNext: () => void bluetooth.next(),
    }),
    cd: () => ({
      getNowPlaying: cdNowPlaying,
      isActive: () => cd.state.hasDisc && cd.state.currentTrackIndex !== null,
      togglePlayPause: () => void cd.toggle(),
      skipToNext: () => void cd.next(),
    }),
  };

  const adapters: Record<string, MediaSourceAdapter> = {};
  for (const source of DEFAULT_SOURCES) {
    const factory = SOURCE_ADAPTER_FACTORIES[source.id];
    adapters[source.id] = factory ? factory() : EMPTY_ADAPTER;
  }
  return adapters;
}
