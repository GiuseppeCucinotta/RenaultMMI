/// <reference types="vite/client" />

interface DebugAPI {
  getSystemInfo: () => Promise<{
    node: string;
    chrome: string;
    electron: string;
    platform: string;
    arch: string;
    memory: { total: number; used: number; percent: number };
    uptime: number;
  }>;
  getEnvVars: () => Record<string, string>;
  onLogMessage: (callback: (message: { timestamp: string; type: string; content: string }) => void) => void;
  sendTestMessage: (channel: string, data: Record<string, unknown>) => void;
  ipcChannels: {
    on: (callback: (channels: string[]) => void) => void;
  };
}

interface IpcRenderer {
  on(channel: string, listener: (event: Electron.IpcRendererEvent, ...args: unknown[]) => void): void;
  off(channel: string, listener: (event: Electron.IpcRendererEvent, ...args: unknown[]) => void): void;
  send(channel: string, ...args: unknown[]): void;
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
  node: () => string;
  chrome: () => string;
  electron: () => string;
}

interface Window {
  ipcRenderer: IpcRenderer;
  debugAPI: DebugAPI;
}
