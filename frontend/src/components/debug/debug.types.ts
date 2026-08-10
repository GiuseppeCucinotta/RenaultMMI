export interface LogMessage {
  id: number;
  timestamp: string;
  type: 'info' | 'warn' | 'error' | 'debug' | 'udp' | 'can' | 'ipc';
  content: string;
}

export interface SystemInfo {
  node: string;
  chrome: string;
  electron: string;
  platform: string;
  arch: string;
  cpu: { percent: number };
  memory: { rss: number; heapUsed: number; systemTotal: number; percent: number };
  uptime: number;
}

export interface AppInfo {
  name: string;
  version: string;
}

export interface UdpFrame {
  hex: string;
  size: number;
  time: number;
}

export interface EnvEntry {
  key: string;
  value: string;
}
