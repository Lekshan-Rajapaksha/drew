import { webUrl } from '../../shared/navigation.js'
import { mkdirSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { extname, isAbsolute, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { app, BrowserWindow, dialog, Menu, powerMonitor, protocol, screen, session, WebContentsView, type WebContents } from 'electron'
import { WINDOW_CAPTION_HEIGHT, WINDOW_CONTROLS_INSET, WINDOW_CONTROLS_WIDTH, type Shortcut, type Tab } from '../../shared/model.js'
import { effectiveShortcuts, keyBinding, shortcutActions } from '../../shared/shortcuts.js'
import { Database } from './database.js'
import { FloatingSidebar } from './floatingSidebar.js'
import { bindIpc, browserState } from './ipc.js'
import { openPeek } from './peek.js'
import { Downloads } from './profile.js'
import { monitorSpaceScroll } from './spaceScroll.js'
import { Tabs } from './tabs.js'
import { configureUpdates, stopUpdates } from './updates.js'

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

const windows = new Map<number, { privateWindow: boolean; browser: BrowserWindow; preview: (url: string) => void; closePreview: (profile: string) => void; changed: () => void; tabs: Tabs }>()
const profileResets = new Map<string, Promise<void>>()
function resetProfile(profile: string, suspended: boolean) {
  for (const entry of windows.values()) {
    entry.closePreview(profile)
    entry.tabs.resetRenderers(profile, suspended)
  }
  notifyWindows()
}
async function clearProfileStorage(profile: string, clear: () => Promise<void>) {
  const sequence = (profileResets.get(profile) ?? Promise.resolve()).catch(() => {}).then(async () => {
    resetProfile(profile, true)
    await clear()
  })
  profileResets.set(profile, sequence)
  try { await sequence }
  finally {
    if (profileResets.get(profile) === sequence) {
      profileResets.delete(profile)
      resetProfile(profile, false)
    }
  }
}
let currentWindowId: number | undefined
let scrollOwner: { id: number; stop: () => void } | undefined
const currentWindow = () => (currentWindowId === undefined ? undefined : windows.get(currentWindowId)) ?? [...windows.values()].at(-1)
const notifyWindows = () => { for (const entry of windows.values()) entry.changed() }
let database: Database | null = null
let downloads: Downloads | null = null
let shellReady = false
let quitting = false

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

function registerShellProtocol(target: Electron.Protocol) {
  target.handle('lexn', async request => {
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
}

function createWindow(initialSpace?: string, initialUrl?: string, sessionId = windows.size ? randomUUID() : 'main', privateWindow = false, movedTab?: Tab) {
  const db = privateWindow ? new Database(':memory:') : database ??= new Database(join(app.getPath('userData'), 'lexn.sqlite'))
  if (privateWindow) {
    db.set('welcomePending', false)
    db.run('UPDATE workspaces SET name = ? WHERE id = ?', 'Private', db.primaryProfile())
    db.run('DELETE FROM workspaces WHERE id <> ?', db.primaryProfile())
  }
  const savedBounds = db.one<{ bounds: string | null }>('SELECT bounds FROM browser_windows WHERE id = ?', sessionId)?.bounds
  const position = savedBounds ? JSON.parse(savedBounds) as Electron.Rectangle : undefined
  const visiblePosition = position && screen.getAllDisplays().some(display => position.x >= display.workArea.x &&
    position.x + 80 < display.workArea.x + display.workArea.width && position.y >= display.workArea.y &&
    position.y + 80 < display.workArea.y + display.workArea.height) ? position : {}
  const privateShell = privateWindow ? session.fromPartition('drew-private-shell-' + sessionId) : undefined
  if (privateShell) registerShellProtocol(privateShell.protocol)
  const browser = new BrowserWindow({
    width: 1400, height: 920, ...visiblePosition, minWidth: 750, minHeight: 540, show: false,
    title: privateWindow ? 'Drew · Private window' : 'Drew', backgroundColor: '#101017',
    titleBarStyle: 'hidden',
    ...(isMac ? { trafficLightPosition: { x: 15, y: 11 } }
      : { frame: false }),
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      ...(privateShell ? { session: privateShell } : {}),
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
  const peerTabs = () => [...windows.values()].filter(entry => entry.browser !== browser && entry.privateWindow === privateWindow)
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
      if (!browser.isDestroyed()) {
        const snapshot = browserState(db, tabs, windowDownloads, browser, peerTabs())
        pointerWidth = snapshot.settings.sidebarStyle === 'compact' ? 76 : Number(snapshot.settings.sidebarWidth)
        pointerPinned = snapshot.settings.keepSidebarOpen
        browser.webContents.send('lexn:state', snapshot)
      }
    })
  }
  const windowDownloads = privateWindow ? new Downloads(db, changed, true) : downloads ??= new Downloads(db, notifyWindows)
  const openPrivate = () => createWindow(undefined, undefined, randomUUID(), true)
  const openPeer = () => privateWindow ? openPrivate() : createWindow(tabs.workspaceId)
  const shortcut = (name: Shortcut) => {
    if (browser.isDestroyed()) return
    browser.webContents.focus()
    browser.webContents.send('lexn:shortcut', name)
  }
  let pointerWidth = 284
  let pointerPinned = false
  let pointerZone: 'outside' | 'edge' | 'sidebar' | undefined
  const publishPointer = (pointer: number | null) => {
    if (browser.isDestroyed() || browser.webContents.getURL() !== uiUrl) return
    const zone = pointer === null || pointer >= pointerWidth ? 'outside' : pointer <= 12 ? 'edge' : 'sidebar'
    if (zone === pointerZone) return
    pointerZone = zone
    browser.webContents.send('lexn:pointer', pointer)
  }
  const wireKeys = (wc: WebContents) => {
    wc.on('before-mouse-event', (_event, mouse) => {
      if (pointerPinned || !['mouseMove', 'mouseEnter', 'mouseLeave'].includes(mouse.type) || !browser.isFocused()) return
      const position = browser.getContentBounds()
      const x = mouse.globalX ?? position.x + mouse.x
      const y = mouse.globalY ?? position.y + mouse.y
      publishPointer(x >= position.x && x < position.x + position.width && y >= position.y && y < position.y + position.height ? x - position.x : null)
    })
    wc.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown' || input.alt) return
      if (input.control && !input.meta && input.key.toLowerCase() === 'tab') {
        event.preventDefault()
        tabs.next(input.shift)
        shortcut('browse')
        return
      }
      if ((isMac ? !input.meta || input.control : !input.control || input.meta)) return
      if (['=', '+', '-', '0'].includes(input.key)) {
        event.preventDefault()
        tabs.zoom(input.key === '0' ? 'reset' : input.key === '-' ? 'out' : 'in')
        return
      }
      const binding = keyBinding(input.key, input.code, input.shift)
      if (binding === 'Shift+N') { event.preventDefault(); openPrivate(); return }
      const shortcuts = effectiveShortcuts(db.settings(tabs.profileId).keyboardShortcuts, process.platform)
      const action = shortcutActions.find(item => shortcuts[item] === binding)
      if (!action) return
      event.preventDefault()
      const current = tabs.active()?.state.id
      switch (action) {
        case 'newWindow':
          openPeer()
          break
        case 'closeTab':
          if (current) tabs.close(current)
          shortcut('browse')
          break
        case 'reopenTab':
          tabs.reopen()
          shortcut('browse')
          break
        case 'print':
          tabs.print()
          break
        case 'reload':
          if (current) tabs.action(current, 'reload')
          break
        case 'fillLogin':
          if (!input.isAutoRepeat) void tabs.fillLogin().catch(error => tabs.reportPageError(error))
          break
        default: shortcut(action)
      }
    })
  }
  let peek: BrowserWindow | null = null
  let peekProfile = ''
  const preview = (url: string, space: string = tabs.workspaceId) => {
    const profile = tabs.storageFor(space)
    if (profileResets.has(profile)) return
    if (peek && !peek.isDestroyed()) peek.close()
    const opened = openPeek(browser, windowDownloads.sessionFor(profile), url,
      href => tabs.create(href, space, space === tabs.workspaceId), db.settings(profile).javascript)
    peek = opened
    peekProfile = profile
    opened.on('closed', () => { if (peek === opened) peek = null })
  }
  const notifyTab = (tab: Tab) => {
    // A startup navigation can emit updates during construction. The initial snapshot covers them.
    const owner = windows.get(browser.id)
    if (!owner) return
    const profile = owner.tabs.storageFor(tab.workspaceId)
    for (const entry of windows.values()) {
      if (!entry.browser.isDestroyed() && (entry.browser === browser || entry.tabs.profileId === profile)) entry.browser.webContents.send('drew:tab-update', tab)
    }
  }
  const sidebar = new FloatingSidebar(browser, wireKeys)
  const tabs: Tabs = new Tabs(browser, db, id => windowDownloads.sessionFor(id), notifyWindows,
    view => { wireKeys(view.webContents) }, view => sidebar.addWebsite(view), preview, sessionId, initialSpace,
    (url, space) => { createWindow(privateWindow ? undefined : space, url, randomUUID(), privateWindow) }, notifyTab)
  if (initialUrl) {
    const firstTab = tabs.active()
    if (firstTab) {
      tabs.navigate(firstTab.state.id, initialUrl)
      if (movedTab?.pinned) tabs.pin(firstTab.state.id)
    }
  }
  const windowId = browser.id
  windows.set(windowId, { privateWindow, browser, preview, changed, tabs, closePreview: profile => {
    if (peekProfile === profile && peek && !peek.isDestroyed()) peek.destroy()
  } })
  for (const profile of profileResets.keys()) tabs.resetRenderers(profile, true)
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
  browser.on('blur', () => publishPointer(null))
  browser.on('hide', () => publishPointer(null))
  browser.on('minimize', () => publishPointer(null))
  const archiveTimer = setInterval(() => {
    tabs.archive(true)
    tabs.sleepInactive(powerMonitor.onBatteryPower)
  }, 60_000)
  archiveTimer.unref()
  bindIpc(browser, uiUrl, db, tabs, windowDownloads, notifyWindows, sidebar, () => nativeSpaceScroll,
    openPeer, openPrivate, async id => {
      if (privateWindow) throw new Error('Moving tabs between private windows is unavailable.')
      const tab = tabs.list().find(item => item.id === id)
      if (!tab) return
      const { response } = await dialog.showMessageBox(browser, {
        type: 'question', message: 'Move this tab to a new window?',
        detail: 'Drew will reload the page in the same Profile. Finish any edits before moving.',
        buttons: ['Move tab', 'Cancel'], defaultId: 1, cancelId: 1, noLink: true,
      })
      if (response !== 0 || browser.isDestroyed() || !tabs.list().includes(tab)) return
      createWindow(tab.workspaceId, tab.url, randomUUID(), false, tab)
      tabs.close(id, false)
    }, peerTabs, focusWindowTab, records => {
      const owner = [...windows.values()].find(entry => !entry.privateWindow && entry.tabs.managesSavedTabs)?.tabs ?? tabs
      owner.registerImported(records)
    }, profile => resetProfile(profile, profileResets.has(profile)), clearProfileStorage)
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
  let savePosition: ReturnType<typeof setTimeout> | undefined
  const rememberPosition = () => {
    if (!browser.isDestroyed()) db.run('UPDATE browser_windows SET bounds=? WHERE id=?', JSON.stringify(browser.getNormalBounds()), sessionId)
  }
  const queuePosition = () => {
    clearTimeout(savePosition)
    savePosition = setTimeout(rememberPosition, 180)
  }
  browser.on('move', queuePosition)
  browser.on('resize', queuePosition)
  const updateWindowControls = () => { placeCaption(); changed() }
  browser.on('maximize', updateWindowControls)
  browser.on('unmaximize', updateWindowControls)
  browser.on('enter-full-screen', updateWindowControls)
  browser.on('leave-full-screen', updateWindowControls)
  browser.on('close', () => {
    clearTimeout(savePosition)
    rememberPosition()
    if (!quitting && windows.size > 1) {
      if (sessionId === 'main') db.run('UPDATE browser_windows SET open=0 WHERE id=?', sessionId)
      else db.transaction(() => {
        db.run('DELETE FROM tabs WHERE windowId=?', sessionId)
        db.run('DELETE FROM browser_windows WHERE id=?', sessionId)
      })
    }
    clearInterval(archiveTimer)
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
    if (privateWindow) {
      windowDownloads.dispose()
      void privateShell?.clearData().catch(() => {})
      db.close()
    }
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
    if (!shellReady) { pendingExternal = url; return }
    const host = new URL(url).hostname
    const routed = database?.all<{ id: string }>('SELECT id FROM workspaces WHERE profileId IS NULL ORDER BY rowid')
      .find(profile => database?.settings(profile.id).linkHosts.split(',').includes(host))?.id
    const regular = [...windows.values()].filter(entry => !entry.privateWindow)
    if (routed) {
      const target = regular.find(entry => entry.tabs.profileId === routed)
      if (target) target.preview(url)
      else createWindow(routed, url, randomUUID())
      return
    }
    const current = currentWindow()
    const target = current?.privateWindow ? regular.at(-1) : current
    if (target) target.preview(url)
    else createWindow()(url)
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
    registerShellProtocol(protocol)
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
    const db = database ??= new Database(join(app.getPath('userData'), 'lexn.sqlite'))
    const saved = db.all<{ id: string }>('SELECT id FROM browser_windows WHERE open=1 ORDER BY rowid')
    if (saved.length) for (const { id } of saved) createWindow(undefined, undefined, id)
    else createWindow()
    powerMonitor.on('on-ac', notifyWindows)
    powerMonitor.on('on-battery', notifyWindows)
    configureUpdates(() => { quitting = true })
    powerMonitor.on('on-ac', notifyWindows)
    powerMonitor.on('on-battery', notifyWindows)
    const initial = pendingExternal ?? process.argv.find(value => webUrl(value))
    if (initial) receive(initial)
    app.on('activate', () => { if (!currentWindow()) createWindow(); else foreground() })
  }).catch(error => {
    console.error('Drew failed to start:', error)
    dialog.showErrorBox('Drew could not start', String(error))
    app.exit(1)
  })
  app.on('window-all-closed', () => { if (!isMac) app.quit() })
  app.on('before-quit', () => { quitting = true })
  app.on('will-quit', () => {
    stopUpdates()
    downloads?.dispose()
    database?.close()
    database = null
  })
}
