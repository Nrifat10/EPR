const { app, BrowserWindow, Menu, ipcMain } = require('electron')
const path = require('path')
const fs = require('fs')

// ─────────────────────────────────────────────────────────────────────────────
// Landmark Inter Gulf HR — ONLINE desktop client (v1.1.0+).
//
// This edition is a native window into the company's own hosted server (VPS).
// It runs NO local server and NO local database — all data lives on the server,
// so every device (PC, Mac, phone) always sees the same live data.
//
// On first launch a small setup screen asks for the server address
// (e.g. https://hr.example.com). It is stored in userData/config.json and can
// be changed any time with Ctrl+Shift+S (or from the connection-error screen).
// ─────────────────────────────────────────────────────────────────────────────

let mainWindow = null
let configWindow = null
let quitting = false

function log(...args) {
  try {
    fs.appendFileSync(
      path.join(app.getPath('userData'), 'app.log'),
      `[${new Date().toISOString()}] ${args.join(' ')}\n`
    )
  } catch {}
}

function configPath() {
  return path.join(app.getPath('userData'), 'config.json')
}

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(configPath(), 'utf8'))
  } catch {
    return {}
  }
}

function saveConfig(cfg) {
  try {
    fs.mkdirSync(path.dirname(configPath()), { recursive: true })
    fs.writeFileSync(configPath(), JSON.stringify(cfg, null, 2))
  } catch (e) {
    log('failed to save config:', e.message)
  }
}

function normalizeUrl(raw) {
  let url = String(raw || '').trim()
  if (!url) return null
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url
  url = url.replace(/\/+$/, '')
  return url
}

// Probe the server: any HTTP response means "a server is there".
async function checkServer(url) {
  const attempt = async (u) => {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 10000)
    try {
      const res = await fetch(u + '/', { signal: ctrl.signal, redirect: 'follow' })
      return { ok: true, status: res.status }
    } catch (e) {
      return { ok: false, message: e && e.name === 'AbortError' ? 'timed out' : ((e && e.message) || 'unreachable') }
    } finally {
      clearTimeout(timer)
    }
  }
  let r = await attempt(url)
  if (r.ok) return { ok: true, url }
  if (/^https:\/\//i.test(url)) {
    const httpUrl = url.replace(/^https:\/\//i, 'http://')
    const r2 = await attempt(httpUrl)
    if (r2.ok) return { ok: true, url: httpUrl }
    return { ok: false, message: `${r.message} / ${r2.message}` }
  }
  return { ok: false, message: r.message }
}

function openMainWindow(serverUrl) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.loadURL(serverUrl)
    return
  }
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 680,
    title: 'Landmark Inter Gulf HR',
    backgroundColor: '#0b1220',
    show: false,
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  })
  Menu.setApplicationMenu(null)
  mainWindow.loadURL(serverUrl)
  mainWindow.once('ready-to-show', () => mainWindow.show())
  mainWindow.webContents.on('did-fail-load', (_e, code, desc, _url, isMain) => {
    if (!isMain || code === -3 || quitting) return
    log('main frame failed to load:', code, desc)
    mainWindow
      .loadFile(path.join(__dirname, 'error.html'), { query: { code: String(code), desc: desc || '' } })
      .catch(() => {})
  })
  mainWindow.webContents.on('before-input-event', (e, input) => {
    if (
      input.type === 'keyDown' &&
      input.control &&
      input.shift &&
      !input.alt &&
      !input.meta &&
      input.key.toLowerCase() === 's'
    ) {
      e.preventDefault()
      openConfigWindow(false)
    }
  })
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    const cfg = readConfig()
    const base = String(cfg.serverUrl || '').replace(/\/+$/, '')
    if (base && url.startsWith(base)) return { action: 'allow' }
    return { action: 'deny' }
  })
  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

function openConfigWindow(firstRun) {
  if (configWindow && !configWindow.isDestroyed()) {
    configWindow.focus()
    return
  }
  configWindow = new BrowserWindow({
    width: 640,
    height: 520,
    resizable: false,
    maximizable: false,
    title: 'Landmark Inter Gulf HR — Server Address',
    backgroundColor: '#0b1220',
    show: false,
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  })
  configWindow.setMenuBarVisibility(false)
  configWindow.loadFile(path.join(__dirname, 'config.html'), {
    query: firstRun ? { first: '1' } : {},
  })
  configWindow.once('ready-to-show', () => configWindow.show())
  configWindow.on('closed', () => {
    configWindow = null
  })
}

ipcMain.handle('lmhr:connect', async (_e, rawUrl, force) => {
  const url = normalizeUrl(rawUrl)
  if (!url) return { ok: false, message: 'Please type the server address.' }
  let result = { ok: true, url }
  if (!force) {
    result = await checkServer(url)
  }
  saveConfig({
    serverUrl: result.ok ? result.url : url,
    savedAt: new Date().toISOString(),
    checked: !!result.ok,
  })
  log('config saved:', result.ok ? result.url : url, '(checked:', result.ok, ')')
  if (result.ok) {
    if (configWindow && !configWindow.isDestroyed()) configWindow.close()
    openMainWindow(result.url)
    return { ok: true }
  }
  return { ok: false, message: result.message || 'Server not reachable.' }
})

ipcMain.on('lmhr:retry', () => {
  const cfg = readConfig()
  if (cfg.serverUrl && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.loadURL(cfg.serverUrl)
  }
})

ipcMain.on('lmhr:open-config', () => {
  openConfigWindow(false)
})

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const w = configWindow && !configWindow.isDestroyed() ? configWindow : mainWindow
    if (w) {
      if (w.isMinimized()) w.restore()
      w.focus()
    }
  })

  app.whenReady().then(() => {
    log('app ready (online client)')
    const cfg = readConfig()
    if (cfg.serverUrl) {
      openMainWindow(cfg.serverUrl)
    } else {
      openConfigWindow(true)
    }
  })

  app.on('window-all-closed', () => {
    app.quit()
  })

  app.on('before-quit', () => {
    quitting = true
  })
}
