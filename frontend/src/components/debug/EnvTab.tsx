import { useState, useEffect } from 'react';

interface EnvEntry {
  key: string;
  value: string;
}

export function EnvTab() {
  const [env, setEnv] = useState<EnvEntry[]>([]);
  const [search, setSearch] = useState('');

  useEffect(() => {
    try {
      const vars = window.debugAPI.getEnvVars();
      setEnv(Object.entries(vars).map(([key, value]) => ({ key, value })).sort((a, b) => a.key.localeCompare(b.key)));
    } catch { /* debug API unavailable */ }
  }, []);

  const filtered = env.filter(e => e.key.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="p-3 border-b border-zinc-800">
        <div className="flex gap-2 items-center">
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Filter environment variables..."
            className="flex-1 bg-zinc-900 border border-zinc-800 rounded-md px-3 py-1.5 text-sm text-white placeholder:text-zinc-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400/80 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
          />
          <span className="text-[10px] text-zinc-600 font-mono">{filtered.length} / {env.length}</span>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-0.5">
        {filtered.map(({ key, value }) => (
          <div key={key} className="flex gap-3 py-2 border-b border-zinc-800/50">
            <span className="text-cyan-400 font-mono text-xs shrink-0 w-48 truncate">{key}</span>
            <span className="text-zinc-400 font-mono text-xs truncate">{value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
