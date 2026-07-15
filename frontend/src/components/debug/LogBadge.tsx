import { cn } from "@/lib/utils";
import type { LogMessage } from "./debug.types";

const colors: Record<LogMessage['type'], string> = {
  info: 'bg-blue-500/20 text-blue-400',
  warn: 'bg-yellow-500/20 text-yellow-400',
  error: 'bg-red-500/20 text-red-400',
  debug: 'bg-purple-500/20 text-purple-400',
  udp: 'bg-green-500/20 text-green-400',
  can: 'bg-amber-500/20 text-amber-400',
  ipc: 'bg-cyan-500/20 text-cyan-400',
};

export function LogBadge({ type }: { type: LogMessage['type'] }) {
  return (
    <span className={cn('text-[10px] uppercase tracking-wider font-mono font-bold px-1.5 py-0.5 rounded', colors[type])}>
      {type}
    </span>
  );
}
