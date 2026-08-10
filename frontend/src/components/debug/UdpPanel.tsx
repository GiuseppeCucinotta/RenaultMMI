import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { UdpFrame } from "./debug.types";

const MAX_FRAMES = 200;

function useUdpFrames() {
  const [frames, setFrames] = useState<UdpFrame[]>([]);
  const [paused, setPaused] = useState(false);
  const timesRef = useRef<number[]>([]);
  const [rate, setRate] = useState(0);

  useEffect(() => {
    const ipc = typeof window !== 'undefined' ? window.ipcRenderer : undefined;

    const onFrame = (_event: unknown, frame: UdpFrame) => {
      timesRef.current.push(frame.time);
      if (!paused) {
        setFrames((prev) => [frame, ...prev].slice(0, MAX_FRAMES));
      }
    };

    ipc?.on('udp-packet', onFrame);

    const interval = window.setInterval(() => {
      const now = Date.now();
      const recent = timesRef.current.filter((t) => now - t < 1000).length;
      timesRef.current = timesRef.current.filter((t) => now - t < 5000);
      setRate(recent);
    }, 500);

    return () => {
      ipc?.off('udp-packet', onFrame);
      window.clearInterval(interval);
    };
  }, [paused]);

  return { frames, rate, paused, setPaused, setFrames };
}

export function UdpPanel() {
  const { frames, rate, paused, setPaused, setFrames } = useUdpFrames();
  const lastFrame = frames[0]?.time ?? 0;
  const ageMs = lastFrame ? Date.now() - lastFrame : 0;
  const receiving = ageMs < 2000;

  return (
    <section className="rounded-[20px] border border-white/10 bg-black/20 backdrop-blur-md overflow-hidden">
      <div className="flex items-center gap-3 px-6 pt-6 pb-4">
        <h2 className="text-xs uppercase tracking-widest text-warm-100 font-semibold">UDP Frames</h2>
        <span
          className={cn(
            "flex items-center gap-1.5 text-[10px] uppercase tracking-wider font-mono px-2 py-1 rounded-full border",
            receiving
              ? "text-warm-300 border-warm-500/40 bg-warm-500/10"
              : "text-white/40 border-white/10 bg-white/5"
          )}
        >
          <span className={cn("w-1.5 h-1.5 rounded-full", receiving ? "bg-warm-300 animate-pulse" : "bg-white/30")} />
          {receiving ? "Receiving" : "Listening"} · 127.0.0.1:4000
        </span>
        <div className="flex-1" />
        <div className="flex items-center gap-4 text-right">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-white/40 font-mono">Frames/s</div>
            <div className="text-xl font-bold text-warm-50 font-mono leading-none">{rate}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-white/40 font-mono">Total</div>
            <div className="text-xl font-bold text-warm-50 font-mono leading-none">{frames.length}</div>
          </div>
        </div>
        <button
          onClick={() => setPaused(!paused)}
          className="text-[10px] uppercase tracking-wider px-3 py-1.5 rounded-lg border border-white/10 text-warm-100 hover:bg-white/5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-warm-500/80 focus-visible:ring-offset-2 focus-visible:ring-offset-black/60"
        >
          {paused ? "Resume" : "Pause"}
        </button>
        <button
          onClick={() => setFrames([])}
          className="text-[10px] uppercase tracking-wider px-3 py-1.5 rounded-lg border border-white/10 text-white/50 hover:text-red-400 hover:bg-red-500/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400/80 focus-visible:ring-offset-2 focus-visible:ring-offset-black/60"
        >
          Clear
        </button>
      </div>

      <div className="mx-6 flex items-center gap-2">
        <span className="text-[10px] font-mono text-warm-500/80 bg-warm-500/10 border border-warm-500/30 px-2 py-1 rounded-full">
          Raw frames — decoding pending (future consumer process)
        </span>
      </div>

      <div className="mt-4 h-64 overflow-y-auto border-t border-white/10 px-6 py-3 font-mono text-[11px]">
        {frames.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-white/40 gap-2">
            <span className="text-3xl text-warm-500/60">⇄</span>
            <span className="text-xs">No UDP frames received yet</span>
            <span className="text-[10px] text-white/25 animate-pulse">Waiting on 127.0.0.1:4000 — run the backend to inject frames</span>
          </div>
        )}
        {frames.map((frame, i) => (
          <div key={i} className="flex gap-4 py-1 border-b border-white/5 items-center">
            <span className="text-white/30 shrink-0 w-20">{new Date(frame.time).toLocaleTimeString()}</span>
            <span className="text-warm-300 shrink-0 w-14">{frame.size}B</span>
            <span className="text-warm-50/80 break-all">{frame.hex}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
