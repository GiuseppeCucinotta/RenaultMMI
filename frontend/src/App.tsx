import { useState, useEffect, useCallback } from "react";
import { Navbar } from "@/components/Navbar";
import { Background } from "@/components/Background";
import { HomeView } from "@/components/home";
import { PhoneView } from "@/components/views/PhoneView";
import { MediaView } from "@/components/views/MediaView";
import { DebugPanel } from "@/components/debug/DebugPanel";
import type { NavId } from "@/types/navigation";
import { NAV_ORDER } from "@/constants/navigation";

function App() {
  const [activeView, setActiveView] = useState<NavId>("home");
  const [isDebug, setIsDebug] = useState(window.location.hash.startsWith('#/debug'));

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

  if (isDebug) {
    return <DebugPanel />;
  }

  const renderView = () => {
    switch (activeView) {
      case "home":
        return <HomeView />;
      case "phone":
        return <PhoneView />;
      case "media":
        return <MediaView />;
      default:
        return <HomeView />;
    }
  };

  return (
    <div className="min-h-screen w-full flex justify-start p-10 relative">
      <Background />
      <Navbar activeId={activeView} onNavigate={setActiveView} onGearScroll={handleGearScroll} />
      <main className="flex-1 ml-10 flex flex-col">
        <div className="flex-1 relative">
          {renderView()}
        </div>
      </main>
    </div>
  );
}

export default App;
