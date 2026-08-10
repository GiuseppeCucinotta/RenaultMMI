import { useState } from "react";
import { Disc3, Music2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { DEFAULT_PLAYBACK_FEED, DEFAULT_SOURCES } from "@/data/media";
import type { CurrentPlaybackFeed } from "@/types/media";

function Field({
  label,
  value,
  onChange,
  mono = false,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  mono?: boolean;
  type?: string;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[10px] uppercase tracking-wider text-white/40">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          "w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-warm-50",
          "focus:outline-none focus:ring-2 focus:ring-warm-500/80",
          mono && "font-mono",
        )}
      />
    </label>
  );
}

export function MediaFeedPanel() {
  const [feed, setFeed] = useState<CurrentPlaybackFeed>(DEFAULT_PLAYBACK_FEED);
  const [selectedSourceId, setSelectedSourceId] = useState("bluetooth");

  const sendFeed = (next: CurrentPlaybackFeed) => {
    setFeed(next);
    window.ipcRenderer?.send("debug-media-feed", next);
  };

  const sendSource = (sourceId: string) => {
    setSelectedSourceId(sourceId);
    window.ipcRenderer?.send("debug-media-source", sourceId);
  };

  return (
    <section className="rounded-[20px] border border-white/10 bg-black/20 backdrop-blur-md p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Music2 className="w-5 h-5 text-warm-300" strokeWidth={2} />
        <h2 className="text-xs uppercase tracking-widest text-warm-100 font-semibold">Media Feed</h2>
        <span className="ml-auto text-[10px] uppercase tracking-wider text-white/40 font-mono">Live edit · artwork locked</span>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Field
          label="Track Title"
          value={feed.trackTitle}
          onChange={(v) => sendFeed({ ...feed, trackTitle: v })}
        />
        <Field
          label="Album"
          value={feed.albumTitle}
          onChange={(v) => sendFeed({ ...feed, albumTitle: v })}
        />
        <Field
          label="Artist"
          value={feed.artistName}
          onChange={(v) => sendFeed({ ...feed, artistName: v })}
        />
        <div className="flex items-end gap-2">
          <Field
            label="Duration (s)"
            type="number"
            mono
            value={String(feed.durationSeconds)}
            onChange={(v) => sendFeed({ ...feed, durationSeconds: Math.max(0, Number(v) || 0) })}
          />
          <Field
            label="Position (s)"
            type="number"
            mono
            value={String(feed.currentTimeSeconds)}
            onChange={(v) => sendFeed({ ...feed, currentTimeSeconds: Math.max(0, Number(v) || 0) })}
          />
        </div>
      </div>

      <div className="flex items-center gap-4">
        <span className="text-[10px] uppercase tracking-wider text-white/40">Playing</span>
        <button
          onClick={() => sendFeed({ ...feed, isPlaying: !feed.isPlaying })}
          className={cn(
            "relative w-12 h-6 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-warm-500/80",
            feed.isPlaying ? "bg-warm-500" : "bg-white/10",
          )}
          aria-pressed={feed.isPlaying}
          aria-label="Toggle playing state"
        >
          <span
            className={cn(
              "absolute top-0.5 w-5 h-5 rounded-full bg-warm-50 transition-all",
              feed.isPlaying ? "left-6.5" : "left-0.5",
            )}
          />
        </button>
        <span className={cn("text-sm font-mono", feed.isPlaying ? "text-warm-300" : "text-white/40")}>
          {feed.isPlaying ? "on" : "off"}
        </span>
      </div>

      <div>
        <span className="text-[10px] uppercase tracking-wider text-white/40">Source</span>
        <div className="mt-2 flex flex-wrap gap-2">
          {DEFAULT_SOURCES.map((source) => {
            const isSelected = source.id === selectedSourceId;
            return (
              <button
                key={source.id}
                onClick={() => sendSource(source.id)}
                className={cn(
                  "flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-warm-500/80",
                  isSelected
                    ? "border-warm-500/60 bg-warm-500/15 text-warm-200"
                    : "border-white/10 bg-white/5 text-white/60 hover:bg-white/10",
                )}
              >
                {source.iconKey === "cd" && <Disc3 className="w-4 h-4" aria-hidden="true" />}
                {source.name}
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
