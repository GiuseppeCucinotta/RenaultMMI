"use strict";
const electron = require("electron");
electron.contextBridge.exposeInMainWorld("ipcRenderer", {
  on(channel, listener) {
    return electron.ipcRenderer.on(
      channel,
      (event, ...args) => listener(event, ...args)
    );
  },
  off(channel, listener) {
    return electron.ipcRenderer.off(channel, listener);
  },
  send(channel, ...args) {
    return electron.ipcRenderer.send(channel, ...args);
  },
  invoke(channel, ...args) {
    return electron.ipcRenderer.invoke(channel, ...args);
  },
  node: () => process.versions.node,
  chrome: () => process.versions.chrome,
  electron: () => process.versions.electron
});
electron.contextBridge.exposeInMainWorld("debugAPI", {
  getSystemInfo: () => {
    const mem = typeof process.memoryUsage === "function" ? process.memoryUsage() : null;
    return Promise.resolve({
      node: process.versions.node,
      chrome: process.versions.chrome,
      electron: process.versions.electron,
      platform: process.platform,
      arch: process.arch,
      memory: mem ? {
        total: mem.rss,
        used: mem.heapUsed,
        percent: Math.round(mem.heapUsed / mem.heapTotal * 100)
      } : { total: 0, used: 0, percent: 0 },
      uptime: Math.floor(process.uptime())
    });
  },
  getEnvVars: () => {
    const result = {};
    for (const [key, value] of Object.entries(process.env || {})) {
      if (key && value && !key.toLowerCase().includes("password") && !key.toLowerCase().includes("secret") && !key.toLowerCase().includes("token")) {
        result[key] = String(value);
      }
    }
    return result;
  },
  onLogMessage: (callback) => {
    const listener = (_, msg) => callback(msg);
    electron.ipcRenderer.on("debug-log", listener);
  },
  sendTestMessage: (channel, data) => {
    electron.ipcRenderer.send("test-message", { channel, data });
  },
  ipcChannels: {
    on: (callback) => {
      electron.ipcRenderer.on("debug-channels", (_, channels) => callback(channels));
    }
  }
});
