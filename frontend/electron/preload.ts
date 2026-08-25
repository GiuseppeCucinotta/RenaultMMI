import { ipcRenderer, contextBridge } from "electron";
import type { SystemInfo } from "../shared/system-info";

interface IpcRendererLike {
  on(channel: string, listener: (event: Electron.IpcRendererEvent, ...args: unknown[]) => void): void;
  off(channel: string, listener: (...args: unknown[]) => void): void;
  send(channel: string, ...args: unknown[]): void;
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
  node: () => string;
  chrome: () => string;
  electron: () => string;
}

interface AppInfo {
  name: string;
  version: string;
}

interface LogMessage {
  timestamp: string;
  type: string;
  content: string;
}

interface EntertainmentVolumeState {
  volume: number;
  activeSourceId: string;
}

// --------- Expose some API to the Renderer process ---------
type IpcListener = (event: Electron.IpcRendererEvent, ...args: unknown[]) => void;
const ipcWrappedListeners = new Map<IpcListener, IpcListener>();

contextBridge.exposeInMainWorld("ipcRenderer", {
  on(channel: string, listener: IpcListener) {
    const wrapped: IpcListener = (event, ...args) => listener(event, ...args);
    ipcWrappedListeners.set(listener, wrapped);
    return ipcRenderer.on(channel, wrapped);
  },
  off(channel: string, listener: IpcListener) {
    const wrapped = ipcWrappedListeners.get(listener);
    ipcWrappedListeners.delete(listener);
    return ipcRenderer.off(channel, wrapped ?? listener);
  },
  send(channel: string, ...args: unknown[]) {
    return ipcRenderer.send(channel, ...args);
  },
  invoke(channel: string, ...args: unknown[]) {
    return ipcRenderer.invoke(channel, ...args);
  },
  node: () => process.versions.node,
  chrome: () => process.versions.chrome,
  electron: () => process.versions.electron,
} as IpcRendererLike);

contextBridge.exposeInMainWorld("jukebox", {
  getEndpoint: async (): Promise<{ baseUrl: string }> =>
    ipcRenderer.invoke("jukebox:get-endpoint") as Promise<{ baseUrl: string }>,
});

contextBridge.exposeInMainWorld("bluetooth", {
  getEndpoint: async (): Promise<{ baseUrl: string }> =>
    ipcRenderer.invoke("bluetooth:get-endpoint") as Promise<{ baseUrl: string }>,
});

contextBridge.exposeInMainWorld("cd", {
  getEndpoint: async (): Promise<{ baseUrl: string }> =>
    ipcRenderer.invoke("cd:get-endpoint") as Promise<{ baseUrl: string }>,
});

contextBridge.exposeInMainWorld("entertainmentAudio", {
  getState: (): Promise<EntertainmentVolumeState> =>
    ipcRenderer.invoke("entertainment:get-state") as Promise<EntertainmentVolumeState>,
  setVolume: (volume: number): Promise<EntertainmentVolumeState> =>
    ipcRenderer.invoke("entertainment:set-volume", { volume }) as Promise<EntertainmentVolumeState>,
  setActiveSource: (sourceId: string): Promise<EntertainmentVolumeState> =>
    ipcRenderer.invoke("entertainment:set-source", { sourceId }) as Promise<EntertainmentVolumeState>,
  onStateChanged: (callback: (state: EntertainmentVolumeState) => void): (() => void) => {
    const listener = (_: Electron.IpcRendererEvent, state: unknown) => callback(state as EntertainmentVolumeState);
    ipcRenderer.on("entertainment:state-changed", listener);
    return () => ipcRenderer.removeListener("entertainment:state-changed", listener);
  },
});

contextBridge.exposeInMainWorld("debugAPI", {
  getSystemInfo: async (): Promise<SystemInfo> => {
    const cpu = typeof process.getCPUUsage === 'function' ? process.getCPUUsage() : { percentCPUUsage: 0 };
    const sysMem = typeof process.getSystemMemoryInfo === 'function' ? process.getSystemMemoryInfo() : null;
    const systemTotal = sysMem ? sysMem.total * 1024 : 0;

    let rss = 0;
    try {
      const procMem = await process.getProcessMemoryInfo();
      const workingSet = (procMem as { workingSetSize?: number }).workingSetSize ?? 0;
      rss = workingSet * 1024;
    } catch { /* memory info unavailable */ }

    const heap = typeof process.getHeapStatistics === 'function' ? process.getHeapStatistics() : null;

    return {
      node: process.versions.node,
      chrome: process.versions.chrome,
      electron: process.versions.electron,
      platform: process.platform,
      arch: process.arch,
      cpu: { percent: Math.max(0, Math.min(100, Math.round(cpu.percentCPUUsage))) },
      memory: {
        rss,
        heapUsed: heap?.usedHeapSize ?? 0,
        systemTotal,
        percent: systemTotal > 0 ? Math.round((rss / systemTotal) * 100) : 0,
      },
      uptime: Math.floor(process.uptime()),
    };
  },
  getAppInfo: (): Promise<AppInfo> => ipcRenderer.invoke('get-app-info'),
  getEnvVars: (): Record<string, string> => {
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env || {})) {
      if (key && value && !key.toLowerCase().includes('password') && !key.toLowerCase().includes('secret') && !key.toLowerCase().includes('token')) {
        result[key] = String(value);
      }
    }
    return result;
  },
  onLogMessage: (callback: (message: LogMessage) => void) => {
    const listener = (_: Electron.IpcRendererEvent, msg: unknown) => callback(msg as LogMessage);
    ipcRenderer.on('debug-log', listener);
  },
  sendTestMessage: (channel: string, data: Record<string, unknown>) => {
    ipcRenderer.send('test-message', { channel, data });
  },
  ipcChannels: {
    on: (callback: (channels: string[]) => void) => {
      ipcRenderer.on('debug-channels', (_, channels: string[]) => callback(channels));
    },
  },
});
