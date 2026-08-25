export interface SystemInfo {
  node: string;
  chrome: string;
  electron: string;
  platform: string;
  arch: string;
  cpu: {
    percent: number;
  };
  memory: {
    rss: number;
    heapUsed: number;
    systemTotal: number;
    percent: number;
  };
  uptime: number;
}
