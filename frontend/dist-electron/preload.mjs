"use strict";
const electron = require("electron");
const ipcWrappedListeners = /* @__PURE__ */ new Map();
electron.contextBridge.exposeInMainWorld("ipcRenderer", {
  on(channel, listener) {
    const wrapped = (event, ...args) => listener(event, ...args);
    ipcWrappedListeners.set(listener, wrapped);
    return electron.ipcRenderer.on(channel, wrapped);
  },
  off(channel, listener) {
    const wrapped = ipcWrappedListeners.get(listener);
    ipcWrappedListeners.delete(listener);
    return electron.ipcRenderer.off(channel, wrapped ?? listener);
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
electron.contextBridge.exposeInMainWorld("jukebox", {
  getEndpoint: async () => electron.ipcRenderer.invoke("jukebox:get-endpoint")
});
electron.contextBridge.exposeInMainWorld("bluetooth", {
  getEndpoint: async () => electron.ipcRenderer.invoke("bluetooth:get-endpoint")
});
electron.contextBridge.exposeInMainWorld("entertainmentAudio", {
  getState: () => electron.ipcRenderer.invoke("entertainment:get-state"),
  setVolume: (volume) => electron.ipcRenderer.invoke("entertainment:set-volume", { volume }),
  setActiveSource: (sourceId) => electron.ipcRenderer.invoke("entertainment:set-source", { sourceId }),
  onStateChanged: (callback) => {
    const listener = (_, state) => callback(state);
    electron.ipcRenderer.on("entertainment:state-changed", listener);
    return () => electron.ipcRenderer.removeListener("entertainment:state-changed", listener);
  }
});
electron.contextBridge.exposeInMainWorld("debugAPI", {
  getSystemInfo: async () => {
    const cpu = typeof process.getCPUUsage === "function" ? process.getCPUUsage() : { percentCPUUsage: 0 };
    const sysMem = typeof process.getSystemMemoryInfo === "function" ? process.getSystemMemoryInfo() : null;
    const systemTotal = sysMem ? sysMem.total * 1024 : 0;
    let rss = 0;
    try {
      const procMem = await process.getProcessMemoryInfo();
      const workingSet = procMem.workingSetSize ?? 0;
      rss = workingSet * 1024;
    } catch {
    }
    const heap = typeof process.getHeapStatistics === "function" ? process.getHeapStatistics() : null;
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
        percent: systemTotal > 0 ? Math.round(rss / systemTotal * 100) : 0
      },
      uptime: Math.floor(process.uptime())
    };
  },
  getAppInfo: () => electron.ipcRenderer.invoke("get-app-info"),
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
