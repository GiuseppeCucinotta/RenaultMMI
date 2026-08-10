import { useState, useEffect } from "react";
import { ResourcesPanel } from "./ResourcesPanel";
import { UdpPanel } from "./UdpPanel";
import { VolumePanel } from "./VolumePanel";
import { MediaFeedPanel } from "./MediaFeedPanel";
import { AboutPanel } from "./AboutPanel";
import { LanguagePanel } from "./LanguagePanel";
import type { SystemInfo } from "./debug.types";

export function DebugPanel() {
  const [info, setInfo] = useState<SystemInfo | null>(null);

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const next = await window.debugAPI.getSystemInfo();
        if (!cancelled) setInfo(next);
      } catch {
        if (!cancelled) setInfo(null);
      }
    };
    refresh();
    const interval = window.setInterval(refresh, 1000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  return (
    <div className="min-h-screen w-full bg-[#050505] text-warm-50">
      <div className="mx-auto max-w-3xl px-8 py-8 space-y-6">
        <header className="flex items-baseline gap-4">
          <h1 className="text-2xl font-bold tracking-wide text-warm-50">Debug Panel</h1>
          <span className="text-xs text-white/40">
            Press <kbd className="px-1.5 py-0.5 bg-white/10 rounded text-warm-100 font-mono text-[10px]">Ctrl+Shift+D</kbd> to toggle
          </span>
        </header>

        <ResourcesPanel info={info} />
        <UdpPanel />
        <VolumePanel />
        <LanguagePanel />
        <MediaFeedPanel />
        <AboutPanel info={info} />
      </div>
    </div>
  );
}
