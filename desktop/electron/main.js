const { app, BrowserWindow, dialog, Menu } = require('electron')
const { spawn } = require('child_process')
const path = require('path')
const fs = require('fs')
const http = require('http')
const net = require('net')

// ─────────────────────────────────────────────────────────────────────────────
// Landmark Inter Gulf HR — desktop shell.
//
// Architecture: Electron window ⇄ local Next.js standalone server (child
// process run with Electron's embedded Node via ELECTRON_RUN_AS_NODE=1).
// SQLite DB lives in %APPDATA%/Landmark Inter Gulf HR/db/custom.db; on first
// run it is seeded from the packaged snapshot (resources/seed-db/custom.db).
// ─────────────────────────────────────────────────────────────────────────────

const START_PORT = 3847
let serverProc = null
let mainWindow = null
let quitting = false

function log(...args) {
  try {
    fs.appendFileSync(
      path.join(app.getPath('userData'), 'app.log'),
      `[${new Date().toISOString()}] ${args.join(' ')}\n`
    )
  } catch {}
}

function findFreePort(start) {
  return new Promise((resolve, reject) => {
    const tryPort = (p) => {
      if (p > start + 25) return reject(new Error('No free port found'))
      const srv = net.createServer()
      srv.once('error', () => tryPort(p + 1))
      srv.once('listening', () => srv.close(() => resolve(p)))
      srv.listen(p, '127.0.0.1')
    }
    tryPort(start)
  })
}

function resourcesRoot() {
  return process.resourcesPath || path.join(__dirname, '..')
}

function prepareDatabase() {
  const userData = app.getPath('userData')
  const dbDir = path.join(userData, 'db')
  const dbPath = path.join(dbDir, 'custom.db')
  if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true })
  if (!fs.existsSync(dbPath)) {
    const seed = path.join(resourcesRoot(), 'seed-db', 'custom.db')
    if (fs.existsSync(seed)) {
      fs.copyFileSync(seed, dbPath)
      log('database seeded from packaged snapshot')
    } else {
      fs.writeFileSync(dbPath, '')
      log('WARNING: no packaged seed DB — created empty database')
    }
  }
  return dbPath
}

function startServer(dbPath, port) {
  return new Promise((resolve, reject) => {
    const appDir = path.join(resourcesRoot(), 'app')
    const serverJs = path.join(appDir, 'server.js')
    if (!fs.existsSync(serverJs)) {
      return reject(new Error(`server.js not found at ${serverJs}`))
    }

    const env = {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      ELECTRON_NO_ATTACH_CONSOLE: '1',
      NODE_ENV: 'production',
      PORT: String(port),
      HOSTNAME: '127.0.0.1',
      DATABASE_URL: 'file:' + dbPath.split(path.sep).join('/'),
    }

    try {
      serverProc = spawn(process.execPath, [serverJs], {
        cwd: appDir,
        env,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch (e) {
      return reject(e)
    }

    try {
      const logStream = fs.createWriteStream(path.join(app.getPath('userData'), 'server.log'), {
        flags: 'a',
      })
      serverProc.stdout.pipe(logStream)
      serverProc.stderr.pipe(logStream)
    } catch {}

    serverProc.on('exit', (code) => log('server process exited, code =', code))
    serverProc.on('error', (e) => log('server process error:', e.message))

    const t0 = Date.now()
    const poll = () => {
      if (quitting) return reject(new Error('shutting down'))
      const req = http.get(
        { host: '127.0.0.1', port, path: '/api/bootstrap', timeout: 2500 },
        (res) => {
          res.resume()
          if (res.statusCode && res.statusCode < 500) return resolve(port)
          retry()
        }
      )
      req.on('error', retry)
      req.on('timeout', () => {
        req.destroy()
        retry()
      })
    }
    const retry = () => {
      if (Date.now() - t0 > 45000) {
        reject(new Error('The local server did not become ready within 45 seconds.'))
      } else setTimeout(poll, 400)
    }
    poll()
  })
}

function createWindow(port) {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 680,
    title: 'Landmark Inter Gulf HR',
    backgroundColor: '#0b1220',
    show: false,
    autoHideMenuBar: true,
    icon: path.join(resourcesRoot(), 'app', 'public', 'logo.png'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  })
  Menu.setApplicationMenu(null)
  mainWindow.loadURL(`http://127.0.0.1:${port}/`)
  mainWindow.once('ready-to-show', () => mainWindow.show())
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\/127\.0\.0\.1/.test(url)) return { action: 'allow' }
    return { action: 'deny' }
  })
  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(async () => {
    try {
      const dbPath = prepareDatabase()
      const port = await findFreePort(START_PORT)
      log('starting server on port', port, 'db =', dbPath)
      await startServer(dbPath, port)
      createWindow(port)
    } catch (e) {
      log('FATAL:', e.message)
      dialog.showErrorBox(
        'Landmark Inter Gulf HR — failed to start',
        `${e.message}\n\nCheck the log file for details:\n${path.join(app.getPath('userData'), 'server.log')}`
      )
      app.quit()
    }
  })

  app.on('window-all-closed', () => {
    app.quit()
  })

  app.on('before-quit', () => {
    quitting = true
    if (serverProc) {
      try {
        serverProc.kill()
      } catch {}
      serverProc = null
    }
  })
}
