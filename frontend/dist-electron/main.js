import { ipcMain, app, BrowserWindow } from "electron";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import dgram from "node:dgram";
import { EventEmitter } from "node:events";
function createUdpProbe(port = 4e3, host = "127.0.0.1") {
  let socket = null;
  const start = (onFrame) => {
    if (socket) return;
    socket = dgram.createSocket("udp4");
    socket.on("message", (msg) => {
      onFrame({
        hex: Array.from(msg).map((b) => b.toString(16).padStart(2, "0")).join(" "),
        size: msg.length,
        time: Date.now()
      });
    });
    socket.bind(port, host);
  };
  const stop = () => {
    if (!socket) return;
    socket.close();
    socket = null;
  };
  return { start, stop };
}
const VOLUME_MIN = 0;
const VOLUME_MAX = 30;
const VOLUME_DEFAULT = 25;
function percentFromEntertainment(volume) {
  return Math.round(volume / VOLUME_MAX * 100);
}
class JukeboxVolumeBackend {
  baseUrl;
  constructor(jukeboxPort) {
    this.baseUrl = `http://127.0.0.1:${jukeboxPort}`;
  }
  async apply(percent) {
    try {
      await fetch(`${this.baseUrl}/api/volume`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ volume: percent })
      });
    } catch (error) {
      console.error("[entertainment] failed to set jukebox volume:", error instanceof Error ? error.message : error);
    }
  }
}
class BluetoothVolumeBackend {
  baseUrl;
  constructor(bluetoothPort) {
    this.baseUrl = `http://127.0.0.1:${bluetoothPort}`;
  }
  async apply(percent) {
    try {
      await fetch(`${this.baseUrl}/api/volume`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ volume: percent })
      });
    } catch (error) {
      console.error("[entertainment] failed to set bluetooth volume:", error instanceof Error ? error.message : error);
    }
  }
}
class NoopVolumeBackend {
  async apply() {
  }
}
class EntertainmentVolumeController extends EventEmitter {
  volume;
  activeSourceId;
  defaultBackend;
  sourceBackends;
  constructor(options) {
    super();
    this.volume = VOLUME_DEFAULT;
    this.activeSourceId = options.defaultSourceId;
    this.defaultBackend = new NoopVolumeBackend();
    this.sourceBackends = {
      jukebox: new JukeboxVolumeBackend(options.jukeboxPort),
      bluetooth: new BluetoothVolumeBackend(options.bluetoothPort)
    };
  }
  getState() {
    return { volume: this.volume, activeSourceId: this.activeSourceId };
  }
  setVolume(volume) {
    this.volume = Math.max(VOLUME_MIN, Math.min(VOLUME_MAX, Math.round(volume)));
    void this.applyVolume();
    this.emit("state", this.getState());
    return this.getState();
  }
  setActiveSource(sourceId) {
    this.activeSourceId = sourceId;
    void this.applyVolume();
    this.emit("state", this.getState());
    return this.getState();
  }
  async applyVolume() {
    const backend = this.sourceBackends[this.activeSourceId] ?? this.defaultBackend;
    try {
      await backend.apply(percentFromEntertainment(this.volume));
    } catch (error) {
      console.error("[entertainment] failed to apply volume:", error instanceof Error ? error.message : error);
    }
  }
}
const __dirname$1 = path.dirname(fileURLToPath(import.meta.url));
process.env.APP_ROOT = path.join(__dirname$1, "..");
const VITE_DEV_SERVER_URL = process.env["VITE_DEV_SERVER_URL"];
const MAIN_DIST = path.join(process.env.APP_ROOT, "dist-electron");
const RENDERER_DIST = path.join(process.env.APP_ROOT, "dist");
process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, "public") : RENDERER_DIST;
let win;
let debugWin;
let jukeboxService = null;
let bluetoothService = null;
const udpProbe = createUdpProbe();
const JUKEBOX_PORT = process.env.JUKEBOX_PORT ?? "4100";
const JUKEBOX_MUSIC_ROOT = process.env.JUKEBOX_MUSIC_ROOT;
const BLUETOOTH_PORT = process.env.BLUETOOTH_PORT ?? "4200";
const entertainment = new EntertainmentVolumeController({
  jukeboxPort: Number(JUKEBOX_PORT),
  bluetoothPort: Number(BLUETOOTH_PORT),
  defaultSourceId: "bluetooth"
});
function broadcastEntertainmentState(state) {
  win?.webContents.send("entertainment:state-changed", state);
  debugWin?.webContents.send("entertainment:state-changed", state);
}
entertainment.on("state", broadcastEntertainmentState);
ipcMain.handle("entertainment:get-state", () => entertainment.getState());
ipcMain.handle("entertainment:set-volume", (_event, payload) => {
  const volume = Number(payload?.volume);
  return Number.isFinite(volume) ? entertainment.setVolume(volume) : entertainment.getState();
});
function sendPlaybackStop(port) {
  return new Promise((resolve) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2e3);
    fetch(`http://127.0.0.1:${port}/api/playback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "stop" }),
      signal: controller.signal
    }).catch(() => void 0).finally(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}
ipcMain.handle("entertainment:set-source", async (_event, payload) => {
  const sourceId = typeof payload?.sourceId === "string" ? payload.sourceId : "";
  if (!sourceId) return entertainment.getState();
  const previous = entertainment.getState().activeSourceId;
  if (sourceId === previous) return entertainment.getState();
  if (previous === "jukebox") {
    await sendPlaybackStop(JUKEBOX_PORT);
  } else if (previous === "bluetooth") {
    await sendPlaybackStop(BLUETOOTH_PORT);
    stopBluetoothService();
  }
  if (sourceId === "bluetooth") {
    startBluetoothService();
  } else if (sourceId === "jukebox") {
    startJukeboxService();
  }
  return entertainment.setActiveSource(sourceId);
});
ipcMain.handle("get-app-info", () => ({
  name: app.getName(),
  version: app.getVersion()
}));
ipcMain.handle("jukebox:get-endpoint", () => ({
  baseUrl: `http://127.0.0.1:${JUKEBOX_PORT}`
}));
ipcMain.handle("bluetooth:get-endpoint", () => ({
  baseUrl: `http://127.0.0.1:${BLUETOOTH_PORT}`
}));
ipcMain.on("debug-media-feed", (_event, feed) => {
  win?.webContents.send("debug-media-feed", feed);
});
ipcMain.on("debug-media-source", (_event, sourceId) => {
  win?.webContents.send("debug-media-source", sourceId);
});
function startJukeboxService() {
  if (jukeboxService && !jukeboxService.killed) return;
  const entry = path.join(__dirname$1, "jukebox", "index.js");
  const env = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: "1",
    JUKEBOX_PORT
  };
  if (JUKEBOX_MUSIC_ROOT) {
    env.JUKEBOX_MUSIC_ROOT = JUKEBOX_MUSIC_ROOT;
  }
  jukeboxService = spawn(process.execPath, [entry], {
    env,
    stdio: "ignore"
  });
  jukeboxService.on("error", (error) => {
    console.error("[jukebox] failed to spawn service:", error.message);
    jukeboxService = null;
  });
  jukeboxService.on("exit", () => {
    jukeboxService = null;
  });
}
function stopJukeboxService() {
  if (jukeboxService && !jukeboxService.killed) {
    jukeboxService.kill();
  }
  jukeboxService = null;
}
function startBluetoothService() {
  if (bluetoothService && !bluetoothService.killed) return;
  const entry = path.join(__dirname$1, "bluetooth", "index.js");
  const env = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: "1",
    BLUETOOTH_PORT
  };
  bluetoothService = spawn(process.execPath, [entry], {
    env,
    stdio: "ignore"
  });
  bluetoothService.on("error", (error) => {
    console.error("[bluetooth] failed to spawn service:", error.message);
    bluetoothService = null;
  });
  bluetoothService.on("exit", () => {
    bluetoothService = null;
  });
}
function stopBluetoothService() {
  if (bluetoothService && !bluetoothService.killed) {
    bluetoothService.kill();
  }
  bluetoothService = null;
}
function createWindow() {
  win = new BrowserWindow({
    width: 1920,
    height: 480,
    frame: false,
    resizable: false,
    maximizable: false,
    fullscreen: true,
    icon: path.join(process.env.VITE_PUBLIC, "electron-vite.svg"),
    webPreferences: {
      preload: path.join(__dirname$1, "preload.mjs")
    }
  });
  win.webContents.on("did-finish-load", () => {
    win?.webContents.send("main-process-message", (/* @__PURE__ */ new Date()).toLocaleString());
  });
  win.webContents.on("before-input-event", (event, input) => {
    if (input.control && input.shift && input.key.toLowerCase() === "d") {
      event.preventDefault();
      toggleDebugWindow();
    }
  });
  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(path.join(RENDERER_DIST, "index.html"));
  }
}
function createDebugWindow() {
  if (debugWin && !debugWin.isDestroyed()) {
    debugWin.focus();
    return;
  }
  debugWin = new BrowserWindow({
    width: 900,
    height: 700,
    frame: true,
    title: "Debug Panel",
    icon: path.join(process.env.VITE_PUBLIC, "electron-vite.svg"),
    webPreferences: {
      preload: path.join(__dirname$1, "preload.mjs")
    }
  });
  if (VITE_DEV_SERVER_URL) {
    debugWin.loadURL(`${VITE_DEV_SERVER_URL}#/debug`);
  } else {
    debugWin.loadFile(path.join(RENDERER_DIST, "index.html"), { hash: "#/debug" });
  }
  udpProbe.start((frame) => {
    debugWin?.webContents.send("udp-packet", frame);
  });
  debugWin.on("closed", () => {
    debugWin = null;
    udpProbe.stop();
  });
}
function toggleDebugWindow() {
  if (debugWin && !debugWin.isDestroyed()) {
    debugWin.close();
  } else {
    createDebugWindow();
  }
}
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
    win = null;
  }
});
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
app.whenReady().then(() => {
  startJukeboxService();
  startBluetoothService();
  createWindow();
});
app.on("will-quit", () => {
  stopJukeboxService();
  stopBluetoothService();
});
export {
  MAIN_DIST,
  RENDERER_DIST,
  VITE_DEV_SERVER_URL,
  createDebugWindow,
  toggleDebugWindow
};
