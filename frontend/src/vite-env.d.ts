/// <reference types="vite/client" />

interface DebugAPI {
  getSystemInfo: () => Promise<{
    node: string;
    chrome: string;
    electron: string;
    platform: string;
    arch: string;
    cpu: { percent: number };
    memory: { rss: number; heapUsed: number; systemTotal: number; percent: number };
    uptime: number;
  }>;
  getAppInfo: () => Promise<{ name: string; version: string }>;
  getEnvVars: () => Record<string, string>;
  onLogMessage: (callback: (message: { timestamp: string; type: string; content: string }) => void) => void;
  sendTestMessage: (channel: string, data: Record<string, unknown>) => void;
  ipcChannels: {
    on: (callback: (channels: string[]) => void) => void;
  };
}

interface IpcRenderer {
  on<T>(channel: string, listener: (event: Electron.IpcRendererEvent, payload: T) => void): void;
  off<T>(channel: string, listener: (event: Electron.IpcRendererEvent, payload: T) => void): void;
  send(channel: string, ...args: unknown[]): void;
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
  node: () => string;
  chrome: () => string;
  electron: () => string;
}

interface JukeboxApi {
  getEndpoint: () => Promise<{ baseUrl: string }>;
}

interface BluetoothApi {
  getEndpoint: () => Promise<{ baseUrl: string }>;
}

interface EntertainmentVolumeState {
  volume: number;
  activeSourceId: string;
}

interface EntertainmentAudioApi {
  getState: () => Promise<EntertainmentVolumeState>;
  setVolume: (volume: number) => Promise<EntertainmentVolumeState>;
  setActiveSource: (sourceId: string) => Promise<EntertainmentVolumeState>;
  onStateChanged: (callback: (state: EntertainmentVolumeState) => void) => () => void;
}

interface Window {
  ipcRenderer: IpcRenderer;
  debugAPI: DebugAPI;
  jukebox?: JukeboxApi;
  bluetooth?: BluetoothApi;
  entertainmentAudio?: EntertainmentAudioApi;
}
