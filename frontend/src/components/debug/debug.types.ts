export interface LogMessage {
  id: number;
  timestamp: string;
  type: 'info' | 'warn' | 'error' | 'debug' | 'udp' | 'can' | 'ipc';
  content: string;
}

export type { SystemInfo } from "../../../shared/system-info";

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
