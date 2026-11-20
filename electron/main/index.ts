import { webUrl } from '../../shared/navigation.js'
import { mkdirSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { extname, isAbsolute, join } from 'node:path'
import { app, BrowserWindow, dialog, Menu, protocol, screen, WebContentsView, type WebContents } from 'electron'
import { WINDOW_CAPTION_HEIGHT, WINDOW_CONTROLS_INSET, WINDOW_CONTROLS_WIDTH, type Shortcut } from '../../shared/model.js'
import { effectiveShortcuts, keyBinding, shortcutActions } from '../../shared/shortcuts.js'
import { Database } from './database.js'
import { FloatingSidebar } from './floatingSidebar.js'
import { bindIpc, browserState } from './ipc.js'
import { openPeek } from './peek.js'
import { Downloads } from './profile.js'
import { monitorSpaceScroll } from './spaceScroll.js'
import { Tabs } from './tabs.js'

const uiUrl = 'lexn://shell/index.html'
protocol.registerSchemesAsPrivileged([
  { scheme: 'lexn', privileges: { standard: true, secure: true } },
])
const isMac = process.platform === 'darwin'
const legacyProfileName = 'LexN Browser'
// Electron uses the runtime app name for the macOS Safe Storage service and account.
app.setName(isMac ? legacyProfileName : 'Drew')
const isolatedProfile = app.commandLine.getSwitchValue('user-data-dir')
const testProfile = !app.isPackaged ? process.env.LEXN_TEST_PROFILE : undefined
const override = testProfile ?? (isAbsolute(isolatedProfile) ? isolatedProfile : undefined)
const profilePath = override ?? join(app.getPath('appData'), legacyProfileName)
mkdirSync(profilePath, { recursive: true, mode: 0o700 })
app.setPath('userData', profilePath)
if (testProfile) app.setPath('downloads', join(testProfile, 'downloads'))
if (process.platform === 'win32') app.setAppUserModelId('com.lexn.browser')
app.enableSandbox()

const windows = new Map<number, { browser: BrowserWindow; preview: (url: string) => void; changed: () => void; tabs: Tabs }>()
let currentWindowId: number | undefined
let scrollOwner: { id: number; stop: () => void } | undefined
const currentWindow = () => (currentWindowId === undefined ? undefined : windows.get(currentWindowId)) ?? [...windows.values()].at(-1)
const notifyWindows = () => { for (const entry of windows.values()) entry.changed() }
let database: Database | null = null
let downloads: Downloads | null = null
let shellReady = false

function foreground() {
  const window = currentWindow()?.browser
  if (!window || window.isDestroyed()) return
  if (isMac && app.isHidden()) app.show()
  if (window.isMinimized()) window.restore()
  window.show()
  const modal = window.getChildWindows().find(child => child.isModal() && child.isVisible())
  const target = modal ?? window
  target.focus()
}

function createWindow(initialSpace?: string) {
  const db = database ??= new Database(join(app.getPath('userData'), 'lexn.sqlite'))
  const restoreSession = windows.size === 0
  const browser = new BrowserWindow({
    width: 1400, height: 920, minWidth: 750, minHeight: 540, show: false,
    title: 'Drew', backgroundColor: '#101017',
    titleBarStyle: 'hidden',
    ...(isMac ? { trafficLightPosition: { x: 15, y: 11 } }
      : { frame: false }),
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true,
    },
  })
  let captionView: WebContentsView | null = null
  const placeCaption = () => {
    if (!captionView || browser.isDestroyed()) return
    captionView.setVisible(!browser.isFullScreen())
    const [width] = browser.getContentSize()
    captionView.setBounds({
      x: width - WINDOW_CONTROLS_WIDTH - WINDOW_CONTROLS_INSET,
      y: WINDOW_CONTROLS_INSET, width: WINDOW_CONTROLS_WIDTH, height: WINDOW_CAPTION_HEIGHT,
    })
  }
  let dirty = false
  const peerTabs = () => [...windows.values()].filter(entry => entry.browser !== browser)
    .flatMap(entry => entry.tabs.list().filter(tab => entry.tabs.storageFor(tab.workspaceId) === tabs.profileId))
  const focusWindowTab = (id: string) => {
    const target = peerTabs().find(tab => tab.id === id)
    if (!target) return
    const owner = [...windows.values()].find(entry => entry.browser !== browser && entry.tabs.list().some(tab => tab.id === id))
    if (!owner) return
    if (owner.tabs.workspaceId !== target.workspaceId) owner.tabs.switchWorkspace(target.workspaceId)
    owner.tabs.select(id)
    if (owner.browser.isMinimized()) owner.browser.restore()
    owner.browser.show()
    owner.browser.focus()
    owner.browser.webContents.send('lexn:shortcut', 'browse')
  }
  const changed = () => {
    if (dirty) return
    dirty = true
    setImmediate(() => {
      dirty = false
      if (!browser.isDestroyed() && downloads) {
        browser.webContents.send('lexn:state', browserState(db, tabs, downloads, browser, peerTabs()))
      }
    })
  }
  downloads ??= new Downloads(db, notifyWindows)
  const shortcut = (name: Shortcut) => {
    if (browser.isDestroyed()) return
    browser.webContents.focus()
    browser.webContents.send('lexn:shortcut', name)
  }
  const wireKeys = (wc: WebContents) => wc.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || input.alt) return
    if (input.control && !input.meta && input.key.toLowerCase() === 'tab') {
      event.preventDefault()
      tabs.next(input.shift)
      shortcut('browse')
      return
    }
    if ((isMac ? !input.meta || input.control : !input.control || input.meta)) return
    const binding = keyBinding(input.key, input.code, input.shift)
    const shortcuts = effectiveShortcuts(db.settings(tabs.profileId).keyboardShortcuts, process.platform)
    const action = shortcutActions.find(item => shortcuts[item] === binding)
    if (!action) return
    event.preventDefault()
    const current = tabs.active()?.state.id
    switch (action) {
      case 'newWindow':
        createWindow(tabs.workspaceId)
        break
      case 'closeTab':
        if (current) tabs.close(current)
        shortcut('browse')
        break
      case 'reopenTab':
        tabs.reopen()
        shortcut('browse')
        break
      case 'reload':
        if (current) tabs.action(current, 'reload')
        break
      default: shortcut(action)
    }
  })
  let peek: BrowserWindow | null = null
  const preview = (url: string, space: string = tabs.workspaceId) => {
    if (peek && !peek.isDestroyed()) peek.close()
    const opened = openPeek(browser, downloads!.sessionFor(tabs.storageFor(space)), url,
      href => tabs.create(href, space, space === tabs.workspaceId), db.settings(tabs.storageFor(space)).javascript)
    peek = opened
    opened.on('closed', () => { if (peek === opened) peek = null })
  }
  const sidebar = new FloatingSidebar(browser, wireKeys)
  const tabs: Tabs = new Tabs(browser, db, id => downloads!.sessionFor(id), notifyWindows,
    view => { wireKeys(view.webContents) }, view => sidebar.addWebsite(view), preview, restoreSession, initialSpace)
  const windowId = browser.id
  windows.set(windowId, { browser, preview, changed, tabs })
  notifyWindows()
  currentWindowId = windowId
  let nativeSpaceScroll = false
  const trackFocusedWindow = () => {
    currentWindowId = windowId
    if (scrollOwner?.id === windowId) return
    scrollOwner?.stop()
    const stop = monitorSpaceScroll(browser, uiUrl)
    scrollOwner = stop ? { id: windowId, stop } : undefined
    nativeSpaceScroll = Boolean(stop)
  }
  trackFocusedWindow()
  browser.on('focus', trackFocusedWindow)
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
  bindIpc(browser, uiUrl, db, tabs, downloads, notifyWindows, sidebar, () => nativeSpaceScroll,
    () => { createWindow(tabs.workspaceId) }, peerTabs, focusWindowTab)
  wireKeys(browser.webContents)
  browser.webContents.setWindowOpenHandler(details => {
    if (details.url !== 'about:blank' || browser.webContents.getURL() !== uiUrl) return { action: 'deny' }
    if (details.frameName === 'drew-sidebar' && !sidebar.exists) {
      return { action: 'allow', createWindow: options => sidebar.create(options) }
    }
    if (details.frameName === 'drew-window-controls' && !isMac && !captionView) {
      return { action: 'allow', createWindow: options => {
        const view = new WebContentsView(options)
        captionView = view
        view.setBackgroundColor('#00000000')
        view.setBorderRadius(9)
        browser.contentView.addChildView(view)
        placeCaption()
        const contents = view.webContents
        wireKeys(contents)
        contents.setWindowOpenHandler(() => ({ action: 'deny' }))
        contents.on('will-navigate', event => event.preventDefault())
        contents.once('destroyed', () => {
          captionView = null
          if (!browser.isDestroyed()) browser.contentView.removeChildView(view)
        })
        return contents
      } }
    }
    return { action: 'deny' }
  })
  browser.webContents.on('will-navigate', event => event.preventDefault())
  browser.webContents.on('will-attach-webview', event => event.preventDefault())
  browser.once('ready-to-show', () => { if (!browser.isVisible()) browser.show() })
  browser.on('resize', () => { sidebar.resize(); placeCaption() })
  const updateWindowControls = () => { placeCaption(); changed() }
  browser.on('maximize', updateWindowControls)
  browser.on('unmaximize', updateWindowControls)
  browser.on('enter-full-screen', updateWindowControls)
  browser.on('leave-full-screen', updateWindowControls)
  browser.on('close', () => {
    clearInterval(archiveTimer)
    clearInterval(pointerTimer)
    if (scrollOwner?.id === windowId) {
      scrollOwner.stop()
      scrollOwner = undefined
    }
    tabs.dispose()
    sidebar.dispose()
    captionView?.webContents.close()
  })
  browser.on('closed', () => {
    windows.delete(windowId)
    notifyWindows()
    if (currentWindowId === windowId) currentWindowId = undefined
  })
  void browser.loadURL(uiUrl).then(() => {
    if (!browser.isDestroyed() && !browser.isVisible() && !browser.isMinimized()) browser.show()
  }).catch(error => {
    if (browser.isDestroyed()) return
    console.error('Drew shell failed to load:', error)
    dialog.showErrorBox('Drew could not load the interface', String(error))
    browser.close()
  })
  return preview
}
let pendingExternal: string | null = null

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  const receive = (url: string) => {
    if (!webUrl(url)) return
    const target = currentWindow()
    if (target) target.preview(url)
    else if (shellReady) createWindow()(url)
    else pendingExternal = url
  }
  app.on('open-url', (event, url) => { event.preventDefault(); receive(url) })
  app.on('second-instance', (_event, argv) => {
    const url = argv.find(value => webUrl(value))
    if (url) receive(url)
    if (!shellReady) return
    if (!currentWindow()) createWindow()
    else foreground()
  })
  app.whenReady().then(() => {
    protocol.handle('lexn', async request => {
      const { host, pathname, search } = new URL(request.url)
      if (request.method !== 'GET' || host !== 'shell' || search ||
          !/^\/(?:index\.html|assets\/[\w.-]+\.(?:js|css|png))$/.test(pathname)) {
        return new Response(null, { status: 404 })
      }
      const mimeTypes: Record<string, string> = { '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.html': 'text/html; charset=utf-8' }
      const type = mimeTypes[extname(pathname)]
      try {
        const body = await readFile(join(app.getAppPath(), 'dist', pathname.slice(1)))
        return new Response(body, { headers: {
          'Content-Type': type,
          'X-Content-Type-Options': 'nosniff',
          'Referrer-Policy': 'no-referrer',
          'Content-Security-Policy': "frame-ancestors 'none'",
          'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), display-capture=(), usb=(), serial=()',
        } })
      } catch {
        return new Response(null, { status: 404 })
      }
    })
    if (isMac) app.setAboutPanelOptions({ applicationName: 'Drew', applicationVersion: app.getVersion() })
    Menu.setApplicationMenu(isMac ? Menu.buildFromTemplate([
      { label: 'Drew', submenu: [
        { role: 'about', label: 'About Drew' }, { type: 'separator' }, { role: 'services' },
        { type: 'separator' }, { role: 'hide', label: 'Hide Drew' }, { role: 'hideOthers' }, { role: 'unhide' },
        { type: 'separator' }, { role: 'quit', label: 'Quit Drew' },
      ] },
      { label: 'File', submenu: [{ label: 'New Window', accelerator: 'Command+N', click: () => createWindow(currentWindow()?.tabs.workspaceId) }] },
      { role: 'editMenu' }, { role: 'windowMenu' },
    ]) : null)
    shellReady = true
    createWindow()
    const initial = pendingExternal ?? process.argv.find(value => webUrl(value))
    if (initial) receive(initial)
    app.on('activate', () => { if (!currentWindow()) createWindow(); else foreground() })
  }).catch(error => {
    console.error('Drew failed to start:', error)
    dialog.showErrorBox('Drew could not start', String(error))
    app.exit(1)
  })
  app.on('window-all-closed', () => { if (!isMac) app.quit() })
  app.on('will-quit', () => {
    downloads?.dispose()
    database?.close()
    database = null
  })
}
