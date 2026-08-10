import { Minus, Plus, Volume2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useEntertainmentVolume } from "@/hooks/useEntertainmentVolume";
import { ENTERTAINMENT_VOLUME_MAX } from "@/constants/entertainment";

export function VolumePanel() {
  const { volume, activeSourceId, adjustVolume } = useEntertainmentVolume();
  const percent = Math.round((volume / ENTERTAINMENT_VOLUME_MAX) * 100);

  return (
    <section className="rounded-[20px] border border-white/10 bg-black/20 backdrop-blur-md p-6 space-y-4">
      <div className="flex items-center gap-3">
        <Volume2 className="w-5 h-5 text-warm-300" strokeWidth={2} />
        <h2 className="text-xs uppercase tracking-widest text-warm-100 font-semibold">
          Entertainment Volume
        </h2>
        <span className="ml-auto text-[10px] uppercase tracking-wider text-white/40 font-mono">
          {activeSourceId} source
        </span>
      </div>

      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={() => void adjustVolume(-1)}
          disabled={volume <= 0}
          aria-label="Decrease entertainment volume"
          className="flex size-11 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-warm-100 transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-warm-500/80 disabled:opacity-40"
        >
          <Minus className="size-5" aria-hidden="true" />
        </button>

        <div className="flex-1">
          <div className="mb-1.5 flex items-baseline justify-between">
            <span className="font-mono text-2xl font-semibold text-warm-50">{volume}</span>
            <span className="font-mono text-xs text-white/40">
              / {ENTERTAINMENT_VOLUME_MAX} · {percent}%
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
            <div
              className={cn(
                "h-full rounded-full transition-all",
                volume <= 0 ? "bg-white/20" : "bg-warm-500",
              )}
              style={{ width: `${percent}%` }}
            />
          </div>
        </div>

        <button
          type="button"
          onClick={() => void adjustVolume(1)}
          disabled={volume >= ENTERTAINMENT_VOLUME_MAX}
          aria-label="Increase entertainment volume"
          className="flex size-11 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-warm-100 transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-warm-500/80 disabled:opacity-40"
        >
          <Plus className="size-5" aria-hidden="true" />
        </button>
      </div>
    </section>
  );
}
