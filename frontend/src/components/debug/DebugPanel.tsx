import { useState } from 'react';
import { cn } from '@/lib/utils';
import { TABS } from './debugPanel.constants';
import { OverviewTab } from './OverviewTab';
import { SystemTab } from './SystemTab';
import { LogsTab } from './LogsTab';
import { UdpTab } from './UdpTab';
import { EnvTab } from './EnvTab';
import { TestsTab } from './TestsTab';

export function DebugPanel() {
  const [activeTab, setActiveTab] = useState('overview');

  const renderTab = () => {
    switch (activeTab) {
      case 'overview': return <OverviewTab />;
      case 'system': return <SystemTab />;
      case 'logs': return <LogsTab />;
      case 'udp': return <UdpTab />;
      case 'env': return <EnvTab />;
      case 'tests': return <TestsTab />;
    }
  };

  return (
    <div className="min-h-screen w-full bg-zinc-950 text-white flex">
      <div className="w-44 border-r border-zinc-800 flex flex-col">
        <div className="p-4 border-b border-zinc-800">
          <div className="text-sm font-bold text-zinc-300">Debug Panel</div>
        </div>
        <nav className="flex-1 p-2 space-y-0.5">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400/80 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950',
                activeTab === tab.id
                  ? 'bg-zinc-800 text-white'
                  : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900'
              )}
            >
              <span className="text-xs opacity-60">{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </nav>
        <div className="p-3 border-t border-zinc-800">
          <div className="text-[10px] text-zinc-600 text-center">Renault MMi Debug</div>
        </div>
      </div>
      {renderTab()}
    </div>
  );
}
