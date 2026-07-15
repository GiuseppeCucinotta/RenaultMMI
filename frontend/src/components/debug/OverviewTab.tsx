import { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { formatBytes, formatUptime } from '@/lib/format';

const ipc = typeof window !== 'undefined' ? window.ipcRenderer : undefined;

export function OverviewTab() {
  const [systemInfo, setSystemInfo] = useState<import('./debug.types').SystemInfo | null>(null);
  const [udpPacketCount, setUdpPacketCount] = useState(0);
  const [ipcCalls, setIpcCalls] = useState<number>(0);

  useEffect(() => {
    try {
      window.debugAPI.getSystemInfo()
        .then(setSystemInfo)
        .catch(() => setSystemInfo(null));
    } catch {
      setSystemInfo(null);
    }
  }, []);

  useEffect(() => {
    const onUdp = () => setUdpPacketCount(prev => prev + 1);
    const onIpc = () => setIpcCalls(prev => prev + 1);

    ipc?.on?.('udp-packet', onUdp);
    ipc?.on?.('debug-log', onIpc);

    return () => {
      ipc?.off?.('udp-packet', onUdp);
      ipc?.off?.('debug-log', onIpc);
    };
  }, []);

  const handleTestSend = () => {
    setIpcCalls(prev => prev + 1);
    window.debugAPI.sendTestMessage('test-channel', { time: Date.now(), message: 'Hello from debug panel' });
  };

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6">
      <div>
        <h2 className="text-lg font-bold text-white mb-1">Debug Panel</h2>
        <p className="text-xs text-zinc-500">Press <kbd className="px-1.5 py-0.5 bg-zinc-800 rounded text-zinc-400 font-mono text-[10px]">Ctrl+Shift+D</kbd> to toggle</p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="bg-zinc-900/80 border border-zinc-800 rounded-lg p-4 space-y-3">
          <div className="text-xs text-zinc-500 uppercase tracking-wider">System Uptime</div>
          <div className="text-2xl font-mono font-bold text-white">
            {systemInfo ? formatUptime(systemInfo.uptime) : '...'}
          </div>
        </div>

        <div className="bg-zinc-900/80 border border-zinc-800 rounded-lg p-4 space-y-3">
          <div className="text-xs text-zinc-500 uppercase tracking-wider">Memory Usage</div>
          <div className="text-2xl font-mono font-bold text-white">
            {systemInfo ? formatBytes(systemInfo.memory.used) : '...'}
          </div>
          <div className="w-full bg-zinc-800 rounded-full h-1.5">
            <div
              className={cn('h-1.5 rounded-full transition-all', (systemInfo?.memory?.percent ?? 0) > 80 ? 'bg-red-500' : (systemInfo?.memory?.percent ?? 0) > 60 ? 'bg-yellow-500' : 'bg-green-500')}
              style={{ width: systemInfo?.memory ? `${systemInfo.memory.percent}%` : '0%' }}
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="bg-zinc-900/80 border border-zinc-800 rounded-lg p-4 space-y-1">
          <div className="text-xs text-zinc-500">Node.js</div>
          <div className="text-sm font-mono text-white">{systemInfo?.node || '...'}</div>
        </div>
        <div className="bg-zinc-900/80 border border-zinc-800 rounded-lg p-4 space-y-1">
          <div className="text-xs text-zinc-500">Electron</div>
          <div className="text-sm font-mono text-white">{systemInfo?.electron || '...'}</div>
        </div>
        <div className="bg-zinc-900/80 border border-zinc-800 rounded-lg p-4 space-y-1">
          <div className="text-xs text-zinc-500">Platform</div>
          <div className="text-sm font-mono text-white">{systemInfo?.platform}/{systemInfo?.arch}</div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="bg-zinc-900/80 border border-zinc-800 rounded-lg p-4 space-y-3">
          <div className="text-xs text-zinc-500 uppercase tracking-wider">IPC Calls</div>
          <div className="text-3xl font-mono font-bold text-cyan-400">{ipcCalls}</div>
        </div>
        <div className="bg-zinc-900/80 border border-zinc-800 rounded-lg p-4 space-y-3">
          <div className="text-xs text-zinc-500 uppercase tracking-wider">UDP Packets</div>
          <div className="text-3xl font-mono font-bold text-green-400">{udpPacketCount}</div>
        </div>
      </div>

      <div className="bg-zinc-900/80 border border-zinc-800 rounded-lg p-4">
        <h3 className="text-sm font-bold text-white mb-3">Quick Actions</h3>
        <div className="flex gap-2">
          <button
            onClick={handleTestSend}
            className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-medium rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/80 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
          >
            Send Test IPC Message
          </button>
          <button
            onClick={() => window.debugAPI.sendTestMessage('udp-ping', { type: 'ping' })}
            className="px-4 py-2 bg-green-600 hover:bg-green-500 text-white text-sm font-medium rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-400/80 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
          >
            Simulate UDP Ping
          </button>
        </div>
      </div>
    </div>
  );
}
