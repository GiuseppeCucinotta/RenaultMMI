import { app, BrowserWindow, ipcMain } from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { createUdpProbe } from './udp-probe'
import { EntertainmentVolumeController, type EntertainmentVolumeState } from './entertainment-audio'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

process.env.APP_ROOT = path.join(__dirname, '..')

export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, 'public') : RENDERER_DIST

let win: BrowserWindow | null
let debugWin: BrowserWindow | null
let jukeboxService: ChildProcess | null = null
let bluetoothService: ChildProcess | null = null

const udpProbe = createUdpProbe()

const JUKEBOX_PORT = process.env.JUKEBOX_PORT ?? '4100'
const JUKEBOX_MUSIC_ROOT = process.env.JUKEBOX_MUSIC_ROOT
const BLUETOOTH_PORT = process.env.BLUETOOTH_PORT ?? '4200'

const entertainment = new EntertainmentVolumeController({
  jukeboxPort: Number(JUKEBOX_PORT),
  bluetoothPort: Number(BLUETOOTH_PORT),
  defaultSourceId: 'bluetooth',
})

function broadcastEntertainmentState(state: EntertainmentVolumeState) {
  win?.webContents.send('entertainment:state-changed', state)
  debugWin?.webContents.send('entertainment:state-changed', state)
}
entertainment.on('state', broadcastEntertainmentState)

ipcMain.handle('entertainment:get-state', () => entertainment.getState())

ipcMain.handle('entertainment:set-volume', (_event, payload: { volume?: unknown }) => {
  const volume = Number(payload?.volume)
  return Number.isFinite(volume) ? entertainment.setVolume(volume) : entertainment.getState()
})

ipcMain.handle('entertainment:set-source', (_event, payload: { sourceId?: unknown }) => {
  const sourceId = typeof payload?.sourceId === 'string' ? payload.sourceId : ''
  return sourceId ? entertainment.setActiveSource(sourceId) : entertainment.getState()
})

ipcMain.handle('get-app-info', () => ({
  name: app.getName(),
  version: app.getVersion(),
}))

ipcMain.handle('jukebox:get-endpoint', () => ({
  baseUrl: `http://127.0.0.1:${JUKEBOX_PORT}`,
}))

ipcMain.handle('bluetooth:get-endpoint', () => ({
  baseUrl: `http://127.0.0.1:${BLUETOOTH_PORT}`,
}))

ipcMain.on('debug-media-feed', (_event, feed: unknown) => {
  win?.webContents.send('debug-media-feed', feed)
})

ipcMain.on('debug-media-source', (_event, sourceId: unknown) => {
  win?.webContents.send('debug-media-source', sourceId)
})

function startJukeboxService() {
  if (jukeboxService && !jukeboxService.killed) return

  const entry = path.join(__dirname, 'jukebox', 'index.js')
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
    JUKEBOX_PORT,
  }
  if (JUKEBOX_MUSIC_ROOT) {
    env.JUKEBOX_MUSIC_ROOT = JUKEBOX_MUSIC_ROOT
  }

  jukeboxService = spawn(process.execPath, [entry], {
    env,
    stdio: 'ignore',
  })

  jukeboxService.on('error', (error) => {
    console.error('[jukebox] failed to spawn service:', error.message)
    jukeboxService = null
  })
  jukeboxService.on('exit', () => {
    jukeboxService = null
  })
}

function stopJukeboxService() {
  if (jukeboxService && !jukeboxService.killed) {
    jukeboxService.kill()
  }
  jukeboxService = null
}

function startBluetoothService() {
  if (bluetoothService && !bluetoothService.killed) return

  const entry = path.join(__dirname, 'bluetooth', 'index.js')
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
    BLUETOOTH_PORT,
  }

  bluetoothService = spawn(process.execPath, [entry], {
    env,
    stdio: 'ignore',
  })

  bluetoothService.on('error', (error) => {
    console.error('[bluetooth] failed to spawn service:', error.message)
    bluetoothService = null
  })
  bluetoothService.on('exit', () => {
    bluetoothService = null
  })
}

function stopBluetoothService() {
  if (bluetoothService && !bluetoothService.killed) {
    bluetoothService.kill()
  }
  bluetoothService = null
}

function createWindow() {
  win = new BrowserWindow({
    width: 1920,
    height: 480,
    frame: false,
    resizable: false,
    maximizable: false,
    fullscreen: true,
    icon: path.join(process.env.VITE_PUBLIC, 'electron-vite.svg'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
    },
  })

  win.webContents.on('did-finish-load', () => {
    win?.webContents.send('main-process-message', (new Date).toLocaleString())
  })

  win.webContents.on('before-input-event', (event, input) => {
    if (input.control && input.shift && input.key.toLowerCase() === 'd') {
      event.preventDefault()
      toggleDebugWindow()
    }
  })

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    win.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }
}

function createDebugWindow() {
  if (debugWin && !debugWin.isDestroyed()) {
    debugWin.focus()
    return
  }

  debugWin = new BrowserWindow({
    width: 900,
    height: 700,
    frame: true,
    title: 'Debug Panel',
    icon: path.join(process.env.VITE_PUBLIC, 'electron-vite.svg'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
    },
  })

  if (VITE_DEV_SERVER_URL) {
    debugWin.loadURL(`${VITE_DEV_SERVER_URL}#/debug`)
  } else {
    debugWin.loadFile(path.join(RENDERER_DIST, 'index.html'), { hash: '#/debug' })
  }

  udpProbe.start((frame) => {
    debugWin?.webContents.send('udp-packet', frame)
  })

  debugWin.on('closed', () => {
    debugWin = null
    udpProbe.stop()
  })
}

function toggleDebugWindow() {
  if (debugWin && !debugWin.isDestroyed()) {
    debugWin.close()
  } else {
    createDebugWindow()
  }
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
    win = null
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

app.whenReady().then(() => {
  startJukeboxService()
  startBluetoothService()
  createWindow()
})

app.on('will-quit', () => {
  stopJukeboxService()
  stopBluetoothService()
})

export { createDebugWindow, toggleDebugWindow }
