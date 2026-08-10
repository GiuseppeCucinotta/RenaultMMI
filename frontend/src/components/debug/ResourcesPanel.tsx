import { Cpu, MemoryStick } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatBytes } from "@/lib/format";
import type { SystemInfo } from "./debug.types";

function Meter({ percent }: { percent: number }) {
  const color = percent > 80 ? "bg-red-500" : percent > 60 ? "bg-warm-500" : "bg-warm-300";
  return (
    <div className="w-full h-2 rounded-full bg-white/10 overflow-hidden">
      <div
        className={cn("h-full rounded-full transition-all duration-500", color)}
        style={{ width: `${Math.max(2, Math.min(100, percent))}%` }}
      />
    </div>
  );
}

export function ResourcesPanel({ info }: { info: SystemInfo | null }) {
  const cpu = info?.cpu.percent ?? 0;
  const rss = info?.memory.rss ?? 0;
  const systemTotal = info?.memory.systemTotal ?? 0;
  const memPercent = info?.memory.percent ?? 0;

  return (
    <section className="grid grid-cols-2 gap-4">
      <div className="rounded-[20px] border border-white/10 bg-black/20 backdrop-blur-md p-6 space-y-4">
        <div className="flex items-center gap-3">
          <Cpu className="w-6 h-6 text-warm-300" strokeWidth={2} />
          <h2 className="text-xs uppercase tracking-widest text-warm-100 font-semibold">CPU</h2>
          <span className="ml-auto text-[10px] uppercase tracking-wider text-white/40 font-mono">App process</span>
        </div>
        <div className="flex items-baseline gap-1">
          <span className="text-5xl font-bold text-warm-50 font-mono leading-none">{info ? cpu : "--"}</span>
          <span className="text-lg text-warm-300 font-mono">%</span>
        </div>
        <Meter percent={cpu} />
      </div>

      <div className="rounded-[20px] border border-white/10 bg-black/20 backdrop-blur-md p-6 space-y-4">
        <div className="flex items-center gap-3">
          <MemoryStick className="w-6 h-6 text-warm-300" strokeWidth={2} />
          <h2 className="text-xs uppercase tracking-widest text-warm-100 font-semibold">RAM</h2>
          <span className="ml-auto text-[10px] uppercase tracking-wider text-white/40 font-mono">App + system</span>
        </div>
        <div className="flex items-baseline gap-1">
          <span className="text-3xl font-bold text-warm-50 font-mono leading-none">{info ? formatBytes(rss) : "--"}</span>
          <span className="text-sm text-warm-300 font-mono">/ {info ? formatBytes(systemTotal) : "--"}</span>
        </div>
        <Meter percent={memPercent} />
        <p className="text-[10px] text-white/40 font-mono">{info ? `${memPercent}% of system memory` : "no data"}</p>
      </div>
    </section>
  );
}
