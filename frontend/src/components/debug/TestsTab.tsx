import { useState } from 'react';
import { cn } from '@/lib/utils';
import { formatUptime } from '@/lib/format';

export function TestsTab() {
  const [results, setResults] = useState<Array<{ test: string; status: 'pass' | 'fail' | 'pending'; time: number }>>([]);
  const [running, setRunning] = useState(false);

  const runTests = async () => {
    setRunning(true);
    setResults([]);
    const newResults: typeof results = [];

    const addResult = (test: string, status: 'pass' | 'fail', time: number) => {
      newResults.push({ test, status, time });
      setResults([...newResults]);
    };

    const t1 = Date.now();
    try {
      const nodeVer = window.ipcRenderer.node();
      addResult(`IPC node() returns ${nodeVer}`, 'pass', Date.now() - t1);
    } catch {
      addResult('IPC node()', 'fail', Date.now() - t1);
    }

    const t2 = Date.now();
    try {
      const chromeVer = window.ipcRenderer.chrome();
      addResult(`IPC chrome() returns ${chromeVer}`, 'pass', Date.now() - t2);
    } catch {
      addResult('IPC chrome()', 'fail', Date.now() - t2);
    }

    const t3 = Date.now();
    try {
      const info = await window.debugAPI.getSystemInfo();
      addResult(`getSystemInfo() (uptime: ${formatUptime(info.uptime)})`, 'pass', Date.now() - t3);
    } catch {
      addResult('getSystemInfo()', 'fail', Date.now() - t3);
    }

    const t4 = Date.now();
    try {
      const env = window.debugAPI.getEnvVars();
      addResult(`getEnvVars() (${Object.keys(env).length} vars)`, 'pass', Date.now() - t4);
    } catch {
      addResult('getEnvVars()', 'fail', Date.now() - t4);
    }

    const t5 = Date.now();
    try {
      window.debugAPI.sendTestMessage('test-channel', { time: Date.now() });
      addResult('sendTestMessage()', 'pass', Date.now() - t5);
    } catch {
      addResult('sendTestMessage()', 'fail', Date.now() - t5);
    }

    setRunning(false);
  };

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6">
      <div>
        <h2 className="text-lg font-bold text-white mb-1">Test Suite</h2>
        <p className="text-xs text-zinc-500">Verify IPC and API connectivity</p>
      </div>

      <button
        onClick={runTests}
        disabled={running}
        className={cn(
          'w-full py-3 text-sm font-medium rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/80 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950',
          running
            ? 'bg-zinc-800 text-zinc-500 cursor-not-allowed'
            : 'bg-cyan-600 hover:bg-cyan-500 text-white'
        )}
      >
        {running ? 'Running...' : 'Run All Tests'}
      </button>

      <div className="space-y-2">
        {results.map((r, i) => (
          <div key={i} className="flex items-center gap-3 py-2 px-3 bg-zinc-900/80 border border-zinc-800 rounded-lg">
            <span className={cn('text-sm', r.status === 'pass' ? 'text-green-400' : 'text-red-400')}>
              {r.status === 'pass' ? '✓' : '✗'}
            </span>
            <span className="flex-1 text-sm text-zinc-300 font-mono truncate">{r.test}</span>
            <span className="text-[10px] text-zinc-600 font-mono">{r.time}ms</span>
          </div>
        ))}
        {results.length === 0 && !running && (
          <div className="text-center text-zinc-600 py-8 text-sm">Click "Run All Tests" to verify connectivity</div>
        )}
      </div>
    </div>
  );
}
