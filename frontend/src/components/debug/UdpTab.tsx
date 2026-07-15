import { useState, useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';

const ipc = typeof window !== 'undefined' ? window.ipcRenderer : undefined;

interface UdpPacket {
  time: string;
  data: string;
  size: number;
}

export function UdpTab() {
  const [packets, setPackets] = useState<UdpPacket[]>([]);
  const [listening, setListening] = useState(false);
  const packetIdRef = useRef(0);

  useEffect(() => {
    if (!listening) return;

    const listener = (...args: unknown[]) => {
      packetIdRef.current += 1;
      const d = args[0] as { hex: string; size: number };
      setPackets(prev => [...prev.slice(-200), {
        time: new Date().toLocaleTimeString(),
        data: d.hex,
        size: d.size,
      }]);
    };

    ipc?.on?.('udp-packet', listener);

    return () => {
      ipc?.off?.('udp-packet', listener);
    };
  }, [listening]);

  const handleSimulate = () => {
    packetIdRef.current += 1;
    const mockHex = Array.from({ length: 32 }, () => Math.floor(Math.random() * 256).toString(16).padStart(2, '0')).join(' ');
    setPackets(prev => [...prev.slice(-200), {
      time: new Date().toLocaleTimeString(),
      data: mockHex,
      size: 32,
    }]);
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex items-center gap-3 p-3 border-b border-zinc-800">
        <button
          onClick={() => setListening(!listening)}
          className={cn(
            'px-3 py-1.5 text-xs font-medium rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950',
            listening
              ? 'bg-red-600 hover:bg-red-500 text-white focus-visible:ring-red-400/80'
              : 'bg-green-600 hover:bg-green-500 text-white focus-visible:ring-green-400/80'
          )}
        >
          {listening ? 'Stop' : 'Start'} Listen
        </button>
        <button
          onClick={handleSimulate}
          className="px-3 py-1.5 bg-zinc-700 hover:bg-zinc-600 text-white text-xs font-medium rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400/80 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
        >
          Simulate Packet
        </button>
        <div className="flex-1" />
        <span className="text-[10px] text-zinc-600 font-mono">{packets.length} packets</span>
        <button
          onClick={() => setPackets([])}
          className="text-[10px] text-zinc-500 hover:text-red-400 font-mono px-2 py-1 rounded transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400/80 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
        >
          Clear
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-0.5 font-mono text-[11px]">
        {packets.map((p, i) => (
          <div key={i} className="flex gap-3 py-1 hover:bg-zinc-900/50 px-1 rounded">
            <span className="text-zinc-600 shrink-0 w-20">{p.time}</span>
            <span className="text-green-400 shrink-0 w-14">{p.size}B</span>
            <span className="text-zinc-300 break-all">{p.data}</span>
          </div>
        ))}
        {packets.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-zinc-600 gap-2">
            <div className="text-2xl">⇌</div>
            <div className="text-xs">No UDP packets captured yet</div>
            {listening && <div className="text-[10px] text-zinc-700 animate-pulse">Listening for packets on port 4000...</div>}
          </div>
        )}
      </div>
    </div>
  );
}
