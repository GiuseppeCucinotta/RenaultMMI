import { ipcRenderer, contextBridge } from "electron";

interface IpcRendererLike {
  on(channel: string, listener: (event: Electron.IpcRendererEvent, ...args: unknown[]) => void): void;
  off(channel: string, listener: (...args: unknown[]) => void): void;
  send(channel: string, ...args: unknown[]): void;
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
  node: () => string;
  chrome: () => string;
  electron: () => string;
}

interface SystemInfo {
  node: string;
  chrome: string;
  electron: string;
  platform: string;
  arch: string;
  memory: {
    total: number;
    used: number;
    percent: number;
  };
  uptime: number;
}

interface LogMessage {
  timestamp: string;
  type: string;
  content: string;
}

// --------- Expose some API to the Renderer process ---------
contextBridge.exposeInMainWorld("ipcRenderer", {
  on(channel: string, listener: (event: Electron.IpcRendererEvent, ...args: unknown[]) => void) {
    return ipcRenderer.on(channel, (event, ...args) =>
      listener(event, ...args)
    );
  },
  off(channel: string, listener: (event: Electron.IpcRendererEvent, ...args: unknown[]) => void) {
    return ipcRenderer.off(channel, listener);
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

contextBridge.exposeInMainWorld("debugAPI", {
  getSystemInfo: (): Promise<SystemInfo> => {
    const mem = typeof process.memoryUsage === 'function' ? process.memoryUsage() : null;
    return Promise.resolve({
      node: process.versions.node,
      chrome: process.versions.chrome,
      electron: process.versions.electron,
      platform: process.platform,
      arch: process.arch,
      memory: mem
        ? {
            total: mem.rss,
            used: mem.heapUsed,
            percent: Math.round((mem.heapUsed / mem.heapTotal) * 100),
          }
        : { total: 0, used: 0, percent: 0 },
      uptime: Math.floor(process.uptime()),
    });
  },
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
