import { useState, useEffect } from 'react';
import { formatBytes, formatUptime } from '@/lib/format';
import type { SystemInfo } from './debug.types';

function getProcessPid(): string {
  try { return String(process.pid); } catch { return 'N/A'; }
}

function getProcessCwd(): string {
  try { return process.cwd(); } catch { return 'N/A'; }
}

export function SystemTab() {
  const [info, setInfo] = useState<SystemInfo | null>(null);

  useEffect(() => {
    const fetch = async () => {
      try { setInfo(await window.debugAPI.getSystemInfo()); }
      catch { /* process API unavailable in isolated renderer */ }
    };
    fetch();
    const interval = setInterval(fetch, 2000);
    return () => clearInterval(interval);
  }, []);

  if (!info) return <div className="flex-1 flex items-center justify-center text-zinc-500">Loading...</div>;

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6">
      <h2 className="text-lg font-bold text-white">System Information</h2>

      <div className="space-y-3">
        <div className="flex justify-between py-2 border-b border-zinc-800">
          <span className="text-zinc-400 text-sm">Platform</span>
          <span className="font-mono text-white text-sm">{info.platform} / {info.arch}</span>
        </div>
        <div className="flex justify-between py-2 border-b border-zinc-800">
          <span className="text-zinc-400 text-sm">Node.js</span>
          <span className="font-mono text-white text-sm">{info.node}</span>
        </div>
        <div className="flex justify-between py-2 border-b border-zinc-800">
          <span className="text-zinc-400 text-sm">Chrome</span>
          <span className="font-mono text-white text-sm">{info.chrome}</span>
        </div>
        <div className="flex justify-between py-2 border-b border-zinc-800">
          <span className="text-zinc-400 text-sm">Electron</span>
          <span className="font-mono text-white text-sm">{info.electron}</span>
        </div>
      </div>

      <div className="space-y-3 pt-4">
        <h3 className="text-sm font-bold text-white">Memory</h3>
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-zinc-900/80 border border-zinc-800 rounded-lg p-3">
            <div className="text-xs text-zinc-500">RSS</div>
            <div className="text-lg font-mono text-white">{formatBytes(info.memory.total)}</div>
          </div>
          <div className="bg-zinc-900/80 border border-zinc-800 rounded-lg p-3">
            <div className="text-xs text-zinc-500">Heap Used</div>
            <div className="text-lg font-mono text-white">{formatBytes(info.memory.used)}</div>
          </div>
          <div className="bg-zinc-900/80 border border-zinc-800 rounded-lg p-3">
            <div className="text-xs text-zinc-500">Heap %</div>
            <div className="text-lg font-mono text-white">{info.memory.percent}%</div>
          </div>
        </div>
      </div>

      <div className="space-y-3 pt-4">
        <h3 className="text-sm font-bold text-white">Process</h3>
        <div className="space-y-2">
          <div className="flex justify-between py-2 border-b border-zinc-800">
            <span className="text-zinc-400 text-sm">PID</span>
            <span className="font-mono text-white text-sm">{getProcessPid()}</span>
          </div>
          <div className="flex justify-between py-2 border-b border-zinc-800">
            <span className="text-zinc-400 text-sm">Uptime</span>
            <span className="font-mono text-white text-sm">{formatUptime(info.uptime)}</span>
          </div>
          <div className="flex justify-between py-2 border-b border-zinc-800">
            <span className="text-zinc-400 text-sm">CWD</span>
            <span className="font-mono text-white text-sm">{getProcessCwd()}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
