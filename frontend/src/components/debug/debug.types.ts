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
  memory: { total: number; used: number; percent: number };
  uptime: number;
}

export interface EnvEntry {
  key: string;
  value: string;
}
