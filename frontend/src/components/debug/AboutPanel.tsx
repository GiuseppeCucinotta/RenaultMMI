import { useEffect, useState } from "react";
import { Info } from "lucide-react";
import { formatUptime } from "@/lib/format";
import type { AppInfo, SystemInfo } from "./debug.types";

interface RowProps {
  label: string;
  value: string;
  mono?: boolean;
}

function Row({ label, value, mono = true }: RowProps) {
  return (
    <div className="flex items-center justify-between gap-4 py-2 border-b border-white/5 last:border-0">
      <span className="text-xs text-white/50">{label}</span>
      <span className={mono ? "text-sm text-warm-50 font-mono truncate" : "text-sm text-warm-50 truncate"}>{value}</span>
    </div>
  );
}

export function AboutPanel({ info }: { info: SystemInfo | null }) {
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);

  useEffect(() => {
    try {
      window.debugAPI.getAppInfo().then(setAppInfo).catch(() => setAppInfo(null));
    } catch {
      setAppInfo(null);
    }
  }, []);

  return (
    <section className="rounded-[20px] border border-white/10 bg-black/20 backdrop-blur-md p-6">
      <div className="flex items-center gap-3 mb-4">
        <Info className="w-5 h-5 text-warm-300" strokeWidth={2} />
        <h2 className="text-xs uppercase tracking-widest text-warm-100 font-semibold">About</h2>
      </div>

      <div className="grid grid-cols-2 gap-x-10">
        <div>
          <Row label="Application" value={appInfo ? `${appInfo.name} v${appInfo.version}` : "—"} mono={false} />
          <Row label="Electron" value={info?.electron ?? "—"} />
          <Row label="Chromium" value={info?.chrome ?? "—"} />
          <Row label="Node.js" value={info?.node ?? "—"} />
        </div>
        <div>
          <Row label="Platform" value={info ? `${info.platform} / ${info.arch}` : "—"} mono={false} />
          <Row label="Uptime" value={info ? formatUptime(info.uptime) : "—"} />
          <Row label="UDP Listener" value="127.0.0.1:4000" />
          <Row label="Build" value="Debug" />
        </div>
      </div>

      <p className="mt-4 text-[10px] text-white/25">Renault Grand Modus · Infotainment Debug Console</p>
    </section>
  );
}
