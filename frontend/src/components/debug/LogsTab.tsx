import { useState, useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import { LogBadge } from './LogBadge';
import type { LogMessage } from './debug.types';

const ipc = typeof window !== 'undefined' ? window.ipcRenderer : undefined;

const FILTER_TYPES = ['all', 'info', 'debug', 'udp', 'can', 'ipc', 'error', 'warn'] as const;

export function LogsTab() {
  const [logs, setLogs] = useState<LogMessage[]>([]);
  const [filter, setFilter] = useState<string>('all');
  const logIdRef = useRef(0);

  useEffect(() => {
    const addLog = (type: LogMessage['type'], content: string) => {
      logIdRef.current += 1;
      setLogs(prev => [...prev.slice(-500), {
        id: logIdRef.current,
        timestamp: new Date().toLocaleTimeString(),
        type,
        content,
      }]);
    };

    try { window.debugAPI.onLogMessage((message) => {
      addLog(message.type as LogMessage['type'], message.content);
    }); } catch { /* debug API unavailable */ }

    const logListener = (...args: unknown[]) => {
      const m = args[0] as { type: string; content: string };
      addLog(m.type as LogMessage['type'], m.content);
    };
    ipc?.on?.('debug-log', logListener);

    addLog('info', 'Debug panel logs initialized');

    return () => {
      ipc?.off?.('debug-log', logListener);
    };
  }, []);

  const filtered = filter === 'all' ? logs : logs.filter(l => l.type === filter);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex items-center gap-2 p-3 border-b border-zinc-800">
        <div className="flex gap-1">
          {FILTER_TYPES.map(t => (
            <button
              key={t}
              onClick={() => setFilter(t)}
              className={cn(
                'text-[10px] uppercase px-2 py-1 rounded font-mono font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400/80 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950',
                filter === t ? 'bg-zinc-700 text-white' : 'text-zinc-500 hover:text-zinc-300'
              )}
            >
              {t}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        <span className="text-[10px] text-zinc-600 font-mono">{filtered.length} messages</span>
        <button
          onClick={() => setLogs([])}
          className="text-[10px] text-zinc-500 hover:text-red-400 font-mono px-2 py-1 rounded transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400/80 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
        >
          Clear
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-0.5 font-mono text-xs">
        {filtered.map(log => (
          <div key={log.id} className="flex gap-2 py-1 hover:bg-zinc-900/50 px-1 rounded">
            <span className="text-zinc-600 shrink-0">{log.timestamp}</span>
            <LogBadge type={log.type} />
            <span className="text-zinc-300 truncate">{log.content}</span>
          </div>
        ))}
        {filtered.length === 0 && (
          <div className="text-center text-zinc-600 py-8 text-sm">No logs to display</div>
        )}
      </div>
    </div>
  );
}
