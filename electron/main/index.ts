import { webUrl } from '../../shared/navigation.js'
import { mkdirSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { extname, isAbsolute, join } from 'node:path'
import { app, BrowserWindow, dialog, Menu, protocol, screen, type WebContents } from 'electron'
import type { Shortcut } from '../../shared/model.js'
import { Database } from './database.js'
import { bindIpc, browserState } from './ipc.js'
import { openPeek } from './peek.js'
import { Downloads } from './profile.js'
import { Tabs } from './tabs.js'

const uiUrl = 'lexn://shell/index.html'
protocol.registerSchemesAsPrivileged([
  { scheme: 'lexn', privileges: { standard: true, secure: true } },
])
app.setName('LexN Browser')
const isolatedProfile = app.commandLine.getSwitchValue('user-data-dir')
const testProfile = !app.isPackaged ? process.env.LEXN_TEST_PROFILE : undefined
const override = testProfile ?? (isAbsolute(isolatedProfile) ? isolatedProfile : undefined)
if (override) {
  mkdirSync(override, { recursive: true })
  app.setPath('userData', override)
  if (testProfile) app.setPath('downloads', join(testProfile, 'downloads'))
}
if (process.platform === 'win32') app.setAppUserModelId('com.lexn.browser')
app.enableSandbox()

let window: BrowserWindow | null = null
let database: Database | null = null
let downloads: Downloads | null = null
const isMac = process.platform === 'darwin'
let shellReady = false

function foreground() {
  if (!window || window.isDestroyed()) return
  if (isMac && app.isHidden()) app.show()
  if (window.isMinimized()) window.restore()
  window.show()
  const modal = window.getChildWindows().find(child => child.isModal() && child.isVisible())
  const target = modal ?? window
  target.focus()
}

function createWindow() {
  const db = database ??= new Database(join(app.getPath('userData'), 'lexn.sqlite'))
  const browser = window = new BrowserWindow({
    width: 1400, height: 920, minWidth: 750, minHeight: 540, show: false,
    title: 'LexN Browser', backgroundColor: '#101017',
    titleBarStyle: 'hidden',
    ...(isMac ? { trafficLightPosition: { x: 17, y: 19 } } : {}),
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true,
    },
  })
  let dirty = false
  const changed = () => {
    if (dirty) return
    dirty = true
    setImmediate(() => {
      dirty = false
      if (!browser.isDestroyed() && downloads) browser.webContents.send('lexn:state', browserState(db, tabs, downloads))
    })
  }
  downloads ??= new Downloads(db, () => notifyWindow?.())
  notifyWindow = changed
  const shortcut = (name: Shortcut) => {
    if (browser.isDestroyed()) return
    browser.webContents.focus()
    browser.webContents.send('lexn:shortcut', name)
  }
  const wireKeys = (wc: WebContents) => wc.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || input.alt) return
    const key = input.key.toLowerCase()
    if (input.control && !input.meta && key === 'tab') {
      event.preventDefault()
      tabs.next(input.shift)
      shortcut('browse')
      return
    }
    if ((isMac ? !input.meta || input.control : !input.control || input.meta)) return
    const current = tabs.active()?.state.id
    if (input.shift && key === 'd') { event.preventDefault(); shortcut('split'); return }
    if (input.shift && key === 'y') { event.preventDefault(); shortcut('toolbar'); return }
    if (input.shift && key === 't') { event.preventDefault(); tabs.reopen(); shortcut('browse'); return }
    if (input.shift && key === 'b') { event.preventDefault(); shortcut('bookmarks'); return }
    if (input.shift) return
    switch (key) {
      case 't': event.preventDefault(); shortcut('command'); break
      case 'w': event.preventDefault(); if (current) tabs.close(current); shortcut('browse'); break
      case 'l': event.preventDefault(); shortcut('address'); break
      case 'r': event.preventDefault(); if (current) tabs.action(current, 'reload'); break
      case 'h': if (!isMac) { event.preventDefault(); shortcut('history') } break
      case 'j': event.preventDefault(); shortcut('downloads'); break
      case ',': event.preventDefault(); shortcut('settings'); break
      case 's': event.preventDefault(); shortcut('sidebar'); break
    }
  })
  let peek: BrowserWindow | null = null
  const preview = (url: string, space: string = tabs.workspaceId) => {
    if (peek && !peek.isDestroyed()) peek.close()
    const opened = openPeek(browser, downloads!.sessionFor(tabs.storageFor(space)), url,
      href => tabs.create(href, space, space === tabs.workspaceId), db.settings().javascript)
    peek = opened
    opened.on('closed', () => { if (peek === opened) peek = null })
  }
  const tabs: Tabs = new Tabs(browser, db, id => downloads!.sessionFor(id), changed, view => { wireKeys(view.webContents) }, preview)
  externalLink = preview
  tabs.archive(true)
  let lastPointer: number | null | undefined
  const pointerTimer = setInterval(() => {
    if (browser.isDestroyed()) return
    let pointer: number | null = null
    if (browser.isFocused() && browser.webContents.getURL() === uiUrl) {
      const within = browser.getContentBounds()
      const cursor = screen.getCursorScreenPoint()
      const x = cursor.x - within.x
      const y = cursor.y - within.y
      if (x >= 0 && x < within.width && y >= 0 && y < within.height) pointer = x
    }
    if (lastPointer === pointer) return
    lastPointer = pointer
    browser.webContents.send('lexn:pointer', pointer)
  }, 33)
  const archiveTimer = setInterval(() => tabs.archive(true), 60_000)
  const unbind = bindIpc(browser, uiUrl, db, tabs, downloads, changed)
  wireKeys(browser.webContents)
  browser.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  browser.webContents.on('will-navigate', event => event.preventDefault())
  browser.webContents.on('will-attach-webview', event => event.preventDefault())
  browser.once('ready-to-show', () => { if (!browser.isVisible()) browser.show() })
  browser.on('close', () => { clearInterval(archiveTimer); clearInterval(pointerTimer); tabs.dispose() })
  browser.on('closed', () => {
    unbind()
    window = null
    notifyWindow = null
    externalLink = null
  })
  void browser.loadURL(uiUrl).then(() => {
    if (!browser.isDestroyed() && !browser.isVisible() && !browser.isMinimized()) browser.show()
  }).catch(error => {
    if (browser.isDestroyed()) return
    console.error('LexN shell failed to load:', error)
    dialog.showErrorBox('LexN could not load the interface', String(error))
    app.quit()
  })
  return preview
}
let externalLink: ((url: string) => void) | null = null
let pendingExternal: string | null = null
let notifyWindow: (() => void) | null = null

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  const receive = (url: string) => {
    if (!webUrl(url)) return
    if (externalLink) externalLink(url)
    else if (shellReady) createWindow()(url)
    else pendingExternal = url
  }
  app.on('open-url', (event, url) => { event.preventDefault(); receive(url) })
  app.on('second-instance', (_event, argv) => {
    const url = argv.find(value => webUrl(value))
    if (url) receive(url)
    if (!shellReady) return
    if (!window) createWindow()
    else foreground()
  })
  app.whenReady().then(() => {
    protocol.handle('lexn', async request => {
      const { host, pathname, search } = new URL(request.url)
      if (request.method !== 'GET' || host !== 'shell' || search ||
          !/^\/(?:index\.html|assets\/[\w.-]+\.(?:js|css))$/.test(pathname)) {
        return new Response(null, { status: 404 })
      }
      const type = extname(pathname) === '.js' ? 'text/javascript' : extname(pathname) === '.css' ? 'text/css' : 'text/html'
      try {
        const body = await readFile(join(app.getAppPath(), 'dist', pathname.slice(1)))
        return new Response(body, { headers: { 'Content-Type': type + '; charset=utf-8', 'X-Content-Type-Options': 'nosniff' } })
      } catch {
        return new Response(null, { status: 404 })
      }
    })
    Menu.setApplicationMenu(isMac ? Menu.buildFromTemplate([
      { role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' },
    ]) : null)
    shellReady = true
    createWindow()
    const initial = pendingExternal ?? process.argv.find(value => webUrl(value))
    if (initial) receive(initial)
    app.on('activate', () => { if (!window) createWindow(); else foreground() })
  }).catch(error => {
    console.error('LexN failed to start:', error)
    dialog.showErrorBox('LexN could not start', String(error))
    app.exit(1)
  })
  app.on('window-all-closed', () => { if (!isMac) app.quit() })
  app.on('will-quit', () => {
    downloads?.dispose()
    database?.close()
    database = null
  })
}
