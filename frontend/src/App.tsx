import { useState, useEffect, useCallback, useMemo } from "react";
import { Navbar } from "@/components/Navbar";
import { Background } from "@/components/Background";
import { HomeView } from "@/components/home";
import { PhoneView } from "@/components/views/PhoneView";
import { MediaView } from "@/components/views/MediaView";
import { SettingsView } from "@/components/settings/SettingsView";
import { TripComputerView } from "@/components/views/trip-computer/TripComputerView";
import { TripHistoryView } from "@/components/views/trip-history/TripHistoryView";
import { DebugPanel } from "@/components/debug/DebugPanel";
import { VolumeIndicator } from "@/components/VolumeIndicator";
import type { NavId } from "@/types/navigation";
import { NAV_ORDER } from "@/constants/navigation";
import type { CurrentPlaybackFeed, SourceFeed } from "@/types/media";
import { DEFAULT_APPS } from "@/data/apps";
import { DEFAULT_PLAYBACK_FEED, DEFAULT_SOURCE_FEED } from "@/data/media";
import { useNowPlaying } from "@/hooks/useNowPlaying";
import { useEntertainmentVolume } from "@/hooks/useEntertainmentVolume";

function App() {
  const [activeView, setActiveView] = useState<NavId>("home");
  const [isDebug, setIsDebug] = useState(window.location.hash.startsWith('#/debug'));
  const [playbackFeed, setPlaybackFeed] = useState<CurrentPlaybackFeed>(DEFAULT_PLAYBACK_FEED);
  const [sourceFeed, setSourceFeed] = useState<SourceFeed>(DEFAULT_SOURCE_FEED);
  const nowPlaying = useNowPlaying(sourceFeed.selectedSourceId, sourceFeed.sources);
  const { setActiveSource } = useEntertainmentVolume();

  /**
   * The Home grid's app tiles are generic: each carries an optional `onClick`.
   * Only the tiles this shell can actually open get one, so `AppsGrid` stays a
   * dumb renderer and the routing knowledge lives here.
   */
  const homeApps = useMemo(() => {
    // Each tile's id maps to the view it opens. Only tiles the shell can
    // actually open get an `onClick`, so `AppsGrid` stays a dumb renderer and
    // the routing knowledge lives here.
    const targets: Record<string, NavId> = {
      fuel: "trip-computer",
      "nav-history": "trip-history",
      settings: "settings",
    };
    return DEFAULT_APPS.map((app) => {
      const target = targets[app.id];
      return target ? { ...app, onClick: () => setActiveView(target) } : app;
    });
  }, []);

  useEffect(() => {
    const ipc = window.ipcRenderer;
    if (!ipc) return;

    const onMediaFeed = (_event: unknown, feed: CurrentPlaybackFeed) => {
      if (feed && typeof feed === "object") setPlaybackFeed(feed);
    };
    const onMediaSource = (_event: unknown, sourceId: string) => {
      if (typeof sourceId === "string") {
        setSourceFeed((prev) => ({ ...prev, selectedSourceId: sourceId }));
        void setActiveSource(sourceId);
      }
    };

    ipc.on("debug-media-feed", onMediaFeed);
    ipc.on("debug-media-source", onMediaSource);
    return () => {
      ipc.off("debug-media-feed", onMediaFeed);
      ipc.off("debug-media-source", onMediaSource);
    };
  }, [setActiveSource]);

  useEffect(() => {
    const onHashChange = () => {
      setIsDebug(window.location.hash.startsWith('#/debug'));
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const handleGearScroll = useCallback((direction: "up" | "down") => {
    setActiveView((prev) => {
      const idx = NAV_ORDER.indexOf(prev);
      if (direction === "down") {
        return NAV_ORDER[(idx + 1) % NAV_ORDER.length];
      }
      return NAV_ORDER[(idx - 1 + NAV_ORDER.length) % NAV_ORDER.length];
    });
  }, []);

  const handleSelectSource = useCallback(
    (id: string) => {
      setSourceFeed((prev) => ({ ...prev, selectedSourceId: id }));
      void setActiveSource(id);
    },
    [setActiveSource],
  );

  if (isDebug) {
    return <DebugPanel />;
  }

  const renderView = () => {
    switch (activeView) {
      case "home":
        return <HomeView {...nowPlaying} apps={homeApps} />;
      case "phone":
        return <PhoneView />;
      case "media":
        return (
          <MediaView
            playbackFeed={playbackFeed}
            sourceFeed={sourceFeed}
            onSelectSource={handleSelectSource}
          />
        );
      case "settings":
        return <SettingsView />;
      case "trip-computer":
        return <TripComputerView />;
      case "trip-history":
        return <TripHistoryView />;
      default:
        return <HomeView {...nowPlaying} />;
    }
  };

  return (
    <div className="min-h-screen w-full flex justify-start p-10 relative">
      <Background />
      <Navbar activeId={activeView} onNavigate={setActiveView} onGearScroll={handleGearScroll} />
      <main className="ml-10 flex min-w-0 flex-1 flex-col">
        <div className="flex-1 relative">
          {renderView()}
        </div>
      </main>
      <VolumeIndicator />
    </div>
  );
}

export default App;
