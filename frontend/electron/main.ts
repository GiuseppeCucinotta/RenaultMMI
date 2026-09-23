import { app, BrowserWindow, ipcMain } from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { createUdpProbe } from './udp-probe'
import { watchDevArtifacts } from './dev-watch'
import { EntertainmentVolumeController, type EntertainmentVolumeState } from './entertainment-audio'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

process.env.APP_ROOT = path.join(__dirname, '..')

export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

// The services are a separate workspace package. In dev they build into
// `services/dist`; the packaged app copies that tree to `resources/services`.
export const SERVICES_DIST = app.isPackaged
  ? path.join(process.resourcesPath, 'services')
  : path.resolve(__dirname, '../../services/dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, 'public') : RENDERER_DIST

let win: BrowserWindow | null
let debugWin: BrowserWindow | null
let jukeboxService: ChildProcess | null = null
let bluetoothService: ChildProcess | null = null
let cdService: ChildProcess | null = null
let settingsService: ChildProcess | null = null
let tripService: ChildProcess | null = null

const udpProbe = createUdpProbe()

const JUKEBOX_PORT = process.env.JUKEBOX_PORT ?? '4100'
const JUKEBOX_MUSIC_ROOT = process.env.JUKEBOX_MUSIC_ROOT
const BLUETOOTH_PORT = process.env.BLUETOOTH_PORT ?? '4200'
const CD_PORT = process.env.CD_PORT ?? '4300'
const CD_DEVICE = process.env.CD_DEVICE
const SETTINGS_PORT = process.env.SETTINGS_PORT ?? '4400'
const SETTINGS_STORE_PATH = process.env.SETTINGS_STORE_PATH
const TRIP_PORT = process.env.TRIP_PORT ?? '4500'
const TRIP_DB_PATH = process.env.TRIP_DB_PATH
/**
 * Development mode. Declared here, with the other constants, because
 * `startTripService` reads it — a `const` referenced from a function that runs
 * during `app.whenReady()` is still in its temporal dead zone if it is declared
 * further down the file, and the throw silently skips the spawn.
 */
const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged

const entertainment = new EntertainmentVolumeController({
  jukeboxPort: Number(JUKEBOX_PORT),
  bluetoothPort: Number(BLUETOOTH_PORT),
  cdPort: Number(CD_PORT),
  defaultSourceId: 'bluetooth',
  setSourceSuspended: async (sourceId, suspended) => {
    const services: Record<string, { port: string; start: () => void }> = {
      jukebox: { port: JUKEBOX_PORT, start: startJukeboxService },
      bluetooth: { port: BLUETOOTH_PORT, start: startBluetoothService },
      cd: { port: CD_PORT, start: startCdService },
    }
    const service = services[sourceId]
    if (!service) return
    if (!suspended) service.start()
    await setServiceSuspended(service.port, suspended)
  },
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

async function postSuspended(port: string, suspended: boolean): Promise<void> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 10000)
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ suspended }),
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(`Service on port ${port} returned ${response.status}`)
    await response.arrayBuffer()
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Waking a source has to survive a service that is still binding its port
 * (first start) or briefly unavailable — otherwise the switch aborts and the
 * source the user selected stays suspended (a blank media screen). Putting a
 * source to sleep, on the other hand, is attempted once: a service that is
 * down must not delay the switch we are actually making.
 */
async function setServiceSuspended(port: string, suspended: boolean): Promise<void> {
  const attempts = suspended ? 1 : 4
  let lastError: unknown = new Error(`Service on port ${port} did not answer`)

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await postSuspended(port, suspended)
      return
    } catch (error) {
      lastError = error
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
  }
  throw lastError
}

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

ipcMain.handle('cd:get-endpoint', () => ({
  baseUrl: `http://127.0.0.1:${CD_PORT}`,
}))

ipcMain.handle('settings:get-endpoint', () => ({
  baseUrl: `http://127.0.0.1:${SETTINGS_PORT}`,
}))

ipcMain.handle('trip:get-endpoint', () => ({
  baseUrl: `http://127.0.0.1:${TRIP_PORT}`,
}))

ipcMain.on('debug-media-feed', (_event, feed: unknown) => {
  win?.webContents.send('debug-media-feed', feed)
})

ipcMain.on('debug-media-source', (_event, sourceId: unknown) => {
  win?.webContents.send('debug-media-source', sourceId)
})

function startJukeboxService() {
  if (jukeboxService && !jukeboxService.killed) return

  const entry = path.join(SERVICES_DIST, 'jukebox', 'index.js')
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
    JUKEBOX_PORT,
  }
  if (JUKEBOX_MUSIC_ROOT) {
    env.JUKEBOX_MUSIC_ROOT = JUKEBOX_MUSIC_ROOT
  }

  spawnService('jukebox', entry, env, (child) => {
    jukeboxService = child
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

  const entry = path.join(SERVICES_DIST, 'bluetooth', 'index.js')
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
    BLUETOOTH_PORT,
  }

  spawnService('bluetooth', entry, env, (child) => {
    bluetoothService = child
  })
}

function stopBluetoothService() {
  if (bluetoothService && !bluetoothService.killed) {
    bluetoothService.kill()
  }
  bluetoothService = null
}

function startCdService() {
  if (cdService && !cdService.killed) return

  const entry = path.join(SERVICES_DIST, 'cd', 'index.js')
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
    CD_PORT,
  }
  if (CD_DEVICE) {
    env.CD_DEVICE = CD_DEVICE
  }

  spawnService('cd', entry, env, (child) => {
    cdService = child
  })
}

function stopCdService() {
  if (cdService && !cdService.killed) {
    cdService.kill()
  }
  cdService = null
}

function startSettingsService() {
  if (settingsService && !settingsService.killed) return

  const entry = path.join(SERVICES_DIST, 'settings', 'index.js')
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
    SETTINGS_PORT,
  }
  if (SETTINGS_STORE_PATH) {
    env.SETTINGS_STORE_PATH = SETTINGS_STORE_PATH
  }

  spawnService('settings', entry, env, (child) => {
    settingsService = child
  })
}

function stopSettingsService() {
  if (settingsService && !settingsService.killed) {
    settingsService.kill()
  }
  settingsService = null
}

/**
 * The trip service owns the only persistent database in the app, and it reads
 * the shared preferences over HTTP like any other client. `SETTINGS_BASE_URL` is
 * what lets it do that without importing settings code, and `TRIP_DEV_SIMULATE`
 * is the only switch that makes it fabricate telemetry — it is never set in a
 * packaged build.
 */
function startTripService() {
  if (tripService && !tripService.killed) return

  const entry = path.join(SERVICES_DIST, 'trip', 'index.js')
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
    TRIP_PORT,
    SETTINGS_BASE_URL: `http://127.0.0.1:${SETTINGS_PORT}`,
  }
  // Derived from Electron's own userData rather than left to the service's
  // `~/.config/renault-mmi` default: an appliance can be running from a
  // read-only or relocated home, and a service that cannot open its database
  // does not start at all. An explicit `TRIP_DB_PATH` still wins.
  env.TRIP_DB_PATH = TRIP_DB_PATH || path.join(app.getPath('userData'), 'trips.db')
  // Dev convenience: without a vehicle there is no odometer signal yet, so the
  // simulator is the only way to see either app with real data. It also keeps
  // the service busy, which is correct — a drive that is happening must be
  // recorded whether or not anyone is looking at the screen.
  if (isDev && process.env.TRIP_DEV_SIMULATE === undefined) {
    env.TRIP_DEV_SIMULATE = '1'
  }

  spawnService('trip', entry, env, (child) => {
    tripService = child
  })
}

function stopTripService() {
  if (tripService && !tripService.killed) {
    tripService.kill()
  }
  tripService = null
}

/** A dev rebuild must not race the old child for the port: wait for its exit. */
/**
 * Spawns a service child, waiting out a dev build that is still in flight.
 *
 * On a dev start the main process reaches `app.whenReady()` while the services
 * watch is still writing bundles, so an entry can be missing (or briefly absent
 * while its output directory is emptied and rewritten). Spawning then exits at
 * once — and because services run with `stdio: 'ignore'` the error is invisible:
 * the symptom is only "one port never opens".
 *
 * So a child that dies early is retried until the entry exists. The retry is
 * bounded by a deadline and does not hide a genuine crash: a service that is
 * present and broken still gives up and says so.
 */
const SERVICE_SPAWN_RETRY_MS = 500
const SERVICE_SPAWN_WAIT_MS = 30_000

function spawnService(
  name: string,
  entry: string,
  env: NodeJS.ProcessEnv,
  onChild: (child: ChildProcess | null) => void,
  waitUntil = Date.now() + SERVICE_SPAWN_WAIT_MS,
): void {
  if (quitting) {
    onChild(null)
    return
  }

  if (!existsSync(entry)) {
    if (Date.now() >= waitUntil) {
      console.error(`[${name}] bundle ${entry} never appeared; giving up`)
      onChild(null)
      return
    }
    setTimeout(() => spawnService(name, entry, env, onChild, waitUntil), SERVICE_SPAWN_RETRY_MS).unref()
    return
  }

  // stderr is captured, not ignored: a service that dies at startup is exactly
  // the case where the reason matters, and `stdio: 'ignore'` would swallow it.
  const child = spawn(process.execPath, [entry], { env, stdio: ['ignore', 'ignore', 'pipe'] })
  let startupErrors = ''
  child.stderr?.on('data', (chunk: Buffer) => {
    startupErrors = (startupErrors + chunk.toString()).slice(-2000)
  })
  onChild(child)

  // A child that survives this long was not a missing-bundle failure.
  let alive = false
  const settle = setTimeout(() => {
    alive = true
  }, SERVICE_SPAWN_RETRY_MS)
  settle.unref()

  child.on('error', (error) => {
    console.error(`[${name}] failed to spawn service:`, error.message)
    onChild(null)
  })

  child.on('exit', () => {
    if (alive) {
      onChild(null)
      return
    }
    clearTimeout(settle)
    if (startupErrors.trim().length > 0) {
      console.error(`[${name}] service failed at startup:\n${startupErrors.trim()}`)
    }
    if (Date.now() >= waitUntil) {
      console.error(`[${name}] service exited immediately and will not be retried`)
      onChild(null)
      return
    }
    setTimeout(() => spawnService(name, entry, env, onChild, waitUntil), SERVICE_SPAWN_RETRY_MS).unref()
  })
}

/** Set on `will-quit`, so a retry cannot resurrect a service during shutdown. */
let quitting = false

function restartService(name: string, child: ChildProcess | null, start: () => void) {
  console.log(`[dev] ${name} changed — restarting the service`)
  if (!child || child.killed) {
    start()
    return
  }
  const force = setTimeout(() => child.kill('SIGKILL'), 3000)
  force.unref()
  child.once('exit', () => {
    clearTimeout(force)
    start()
  })
  child.kill()
}

function relaunchApp() {
  console.log('[dev] main process changed — relaunching the app')
  app.relaunch()
  app.quit()
}

/**
 * Dev-only: vite-plugin-electron rebuilds the bundles on every edit but only
 * reloads the renderer, so the Electron main process and the spawned services
 * would otherwise keep running the previous code until the app is restarted.
 * Restarting `main.js` reloads the whole app; each service bundle restarts just
 * that child process (the renderer reconnects to it through SSE).
 */
function watchDevBundles() {
  if (!VITE_DEV_SERVER_URL) return

  const serviceTarget = (name: string, child: () => ChildProcess | null, start: () => void) => ({
    name,
    path: path.join(SERVICES_DIST, name),
    match: (file: string) => file === 'index.js',
    onChange: () => restartService(name, child(), start),
  })

  watchDevArtifacts(
    [
      {
        name: 'main',
        path: MAIN_DIST,
        match: (file: string) => file === 'main.js',
        onChange: relaunchApp,
      },
      serviceTarget('jukebox', () => jukeboxService, startJukeboxService),
      serviceTarget('bluetooth', () => bluetoothService, startBluetoothService),
      serviceTarget('cd', () => cdService, startCdService),
      serviceTarget('settings', () => settingsService, startSettingsService),
      serviceTarget('trip', () => tripService, startTripService),
    ],
    {
      onError: (name, error) =>
        console.error(`[dev] cannot watch ${name}:`, error instanceof Error ? error.message : error),
    },
  )
}

function createWindow() {
  win = new BrowserWindow({
    width: 1920,
    height: 480,
    frame: false,
    resizable: false,
    maximizable: false,
    fullscreen: !isDev,
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
  startCdService()
  startSettingsService()
  startTripService()
  watchDevBundles()
  createWindow()
})

app.on('will-quit', () => {
  // Stops a spawn retry from resurrecting a service during shutdown.
  quitting = true
  stopJukeboxService()
  stopBluetoothService()
  stopCdService()
  stopSettingsService()
  stopTripService()
})

export { createDebugWindow, toggleDebugWindow }
