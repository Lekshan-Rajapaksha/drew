import { writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { BrowserWindow, dialog, View, WebContentsView, type Rectangle, type Session } from 'electron'
import { HOME, type ArchivedTab, type PaneRect, type SavedTab, type SplitPane, type Tab, type Workspace } from '../../shared/model.js'
import { originOf, webUrl } from '../../shared/navigation.js'
import type { Database } from './database.js'
import { fillSavedLogin } from './loginFill.js'
import { showPageMenu } from './pageMenu.js'

interface LiveTab {
  state: Tab
  view: WebContentsView | null
  started: boolean
  pendingUrl: string | null
  edited: boolean
  history?: Electron.RestoreOptions
  signInWindow?: BrowserWindow
}

export class Tabs {
  private tabs = new Map<string, LiveTab>()
  private closed: SavedTab[] = []
  private attached = new Set<WebContentsView>()
  private viewport = new View()
  private activeBySpace = new Map<string, string>()
  private splits = new Map<string, SplitPane[]>()
  private bounds: Rectangle | PaneRect[] | null = null
  private shuttingDown = false
  private findTarget: WebContentsView['webContents'] | undefined
  private findRequest = 0
  private suspendedProfiles = new Set<string>()
  workspaceId: string

  constructor(
    private window: BrowserWindow,
    private db: Database,
    private sessionFor: (profile: string) => Session,
    private changed: () => void,
    private wire: (view: WebContentsView) => void,
    attachViewport: (view: View) => void,
    private wirePeek?: (url: string, space: string) => void,
    readonly sessionId = 'main',
    initialSpace?: string,
    private openWindow?: (url: string, space: string) => void,
    private tabChanged: (tab: Tab) => void = () => {},
  ) {
    this.viewport.setVisible(false)
    attachViewport(this.viewport)
    const spaces = db.all<Workspace>('SELECT * FROM workspaces ORDER BY rowid')
    const session = db.one<{ space: string; active: string; splits: string }>('SELECT space, active, splits FROM browser_windows WHERE id = ?', sessionId)
    const primary = sessionId === 'main'
    this.workspaceId = spaces.find(space => space.id === (session?.space ?? initialSpace ?? (primary ? db.get('workspaceId', '') : '')))?.id ?? spaces[0].id
    for (const tab of db.all<SavedTab>('SELECT id, workspaceId, url, title, favicon, pinned, groupId, position, lastUsed FROM tabs WHERE windowId = ? ORDER BY position, rowid', sessionId)) this.register(tab)
    if (session) {
      this.activeBySpace = new Map(JSON.parse(session.active))
      this.splits = new Map(JSON.parse(session.splits))
    } else if (primary) {
      for (const space of spaces) if (space.activeTab) this.activeBySpace.set(space.id, space.activeTab)
    }
    this.saveWindow()
    const { startup, homepage } = db.settings(this.profileId)
    if (!primary && !session) this.create(homepage)
    else if (startup === 'restore') this.switchWorkspace(this.workspaceId)
    else this.create(startup === 'home' ? homepage : HOME)
  }

  workspaces() {
    return this.db.all<Workspace>('SELECT * FROM workspaces ORDER BY rowid').map(space =>
      ({ ...space, activeTab: this.activeBySpace.get(space.id) ?? null }))
  }
  storageFor(id: string) {
    return this.db.one<{ profileId: string | null }>('SELECT profileId FROM workspaces WHERE id = ?', id)?.profileId ?? id
  }
  get profileId() { return this.storageFor(this.workspaceId) }
  get managesSavedTabs() { return this.sessionId === 'main' }
  private saveWindow() {
    this.db.run(`INSERT INTO browser_windows(id, space, active, splits) VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET space=excluded.space, active=excluded.active, splits=excluded.splits, open=1`,
      this.sessionId, this.workspaceId, JSON.stringify([...this.activeBySpace]), JSON.stringify([...this.splits]))
  }
  get split() {
    return (this.splits.get(this.workspaceId) ?? []).filter(pane => {
      const tab = this.tabs.get(pane.id)?.state
      return tab && tab.workspaceId === this.workspaceId && tab.url !== HOME
    })
  }
  setSplit(space: string, panes: SplitPane[]) {
    if (space !== this.workspaceId) return
    if (panes.length < 2) this.splits.delete(space)
    else this.splits.set(space, panes)
    this.saveWindow()
  }
  registerImported(records: SavedTab[]) {
    for (const record of records) if (!this.tabs.has(record.id)) {
      this.register(record)
      if (!this.managesSavedTabs) this.db.run('UPDATE tabs SET windowId = ? WHERE id = ?', this.sessionId, record.id)
    }
  }
  list() { return [...this.tabs.values()].map(tab => tab.state).sort((a, b) => a.position - b.position) }
  active() {
    const id = this.activeBySpace.get(this.workspaceId)
    return id ? this.tabs.get(id) : undefined
  }

  private register(saved: SavedTab) {
    const tab: LiveTab = { state: { ...saved, sleeping: false, audible: false, muted: false, media: false, playing: false, loading: false, back: false, forward: false, error: null }, view: null, started: false, pendingUrl: null, edited: false }
    this.tabs.set(saved.id, tab)
    return tab
  }

  private canFill(tab: LiveTab, view: WebContentsView) {
    return !this.shuttingDown && tab === this.active() && tab.view === view && this.attached.has(view) &&
      !this.window.isDestroyed() && this.window.isFocused() && !view.webContents.isDestroyed() && !tab.pendingUrl
  }

  async fillLogin() {
    const tab = this.active()
    const view = tab?.view
    if (!tab || !view) throw new Error('Open a matching HTTPS sign-in page to fill a saved login.')
    await fillSavedLogin(this.db, this.window, view.webContents, this.storageFor(tab.state.workspaceId), () => this.canFill(tab, view), false)
  }

  reportPageError(error: unknown) {
    if (!this.window.isDestroyed()) void dialog.showMessageBox(this.window, { type: 'info', message: String(error instanceof Error ? error.message : error) })
  }

  private makeView(tab: LiveTab) {
    const view = new WebContentsView({
      webPreferences: {
        preload: join(import.meta.dirname, '../preload/gesture.cjs'),
        session: this.sessionFor(this.storageFor(tab.state.workspaceId)), sandbox: true, nodeIntegration: false, contextIsolation: true,
        webSecurity: true, javascript: this.db.settings(this.storageFor(tab.state.workspaceId)).javascript, navigateOnDragDrop: false,
      },
    })
    tab.view = view
    const wc = view.webContents
    const state = tab.state
    const loginProfile = this.storageFor(state.workspaceId)
    wc.ipc.on('drew:page-edited', event => {
      if (tab.view === view && event.senderFrame === wc.mainFrame) tab.edited = true
    })
    wc.ipc.on('lexn:offer-login', event => {
      if (!this.canFill(tab, view) || !wc.isFocused() || event.senderFrame !== wc.mainFrame) return
      void fillSavedLogin(this.db, this.window, wc, loginProfile, () => this.canFill(tab, view), true)
        .catch(error => this.reportPageError(error))
    })
    let lastHistorySwipe = -Infinity
    wc.ipc.on('lexn:history-swipe', (event, direction: unknown) => {
      if (this.shuttingDown || tab.view !== view || !this.attached.has(view) || !this.window.isFocused() ||
          event.senderFrame !== wc.mainFrame || (direction !== 'back' && direction !== 'forward')) return
      const now = performance.now()
      if (now - lastHistorySwipe < 475) return
      const history = wc.navigationHistory
      if (direction === 'back' ? !history.canGoBack() : !history.canGoForward()) return
      lastHistorySwipe = now
      this.action(state.id, direction)
    })
    let displayable = state.url !== HOME && !state.error
    const update = () => {
      if (this.shuttingDown || tab.view !== view || wc.isDestroyed()) return
      state.back = wc.navigationHistory.canGoBack()
      state.forward = wc.navigationHistory.canGoForward()
      const nextDisplayable = state.url !== HOME && !state.error
      if (nextDisplayable !== displayable) {
        displayable = nextDisplayable
        this.syncView()
      }
      this.tabChanged(state)
    }
    const committed = (url: string, inPage = false) => {
      if (url !== HOME && !webUrl(url)) return
      if (!inPage && url !== state.url) {
        state.media = false
        state.playing = false
        state.title = url === HOME ? 'New Tab' : new URL(url).hostname
        state.favicon = null
      }
      tab.pendingUrl = null
      state.url = url
      state.lastUsed = Date.now()
      state.error = null
      this.persist(state)
      if (url !== HOME) {
        this.db.run('INSERT INTO history VALUES (?, ?, ?, ?, ?)', randomUUID(), url, state.title, Date.now(), this.storageFor(state.workspaceId))
      }
      update()
    }
    const allowed = (url: string) => url === HOME || Boolean(webUrl(url))
    wc.on('will-navigate', event => {
      if (!allowed(event.url)) { event.preventDefault(); return }
      if (state.pinned && state.url !== HOME && event.url !== HOME && new URL(event.url).hostname !== new URL(state.url).hostname) {
        event.preventDefault()
        this.openRelated(state, event.url)
      }
    })
    wc.on('will-redirect', (event) => { if (event.isMainFrame && !allowed(event.url)) event.preventDefault() })
    wc.setWindowOpenHandler(({ url, disposition }) => {
      const target = webUrl(url)
      if (disposition === 'new-window' && this.canFill(tab, view) && wc.isFocused() && webUrl(wc.getURL())?.startsWith('https://') &&
          (url === 'about:blank' || target?.startsWith('https://'))) {
        if (tab.signInWindow && !tab.signInWindow.isDestroyed()) {
          tab.signInWindow.focus()
          return { action: 'deny' }
        }
        return { action: 'allow', overrideBrowserWindowOptions: {
          parent: this.window, modal: false, show: false, width: 620, height: 700,
          title: 'Drew · Sign-in window', autoHideMenuBar: true, frame: true,
          alwaysOnTop: false, fullscreen: false, fullscreenable: false, transparent: false,
          webPreferences: { session: wc.session, sandbox: true, nodeIntegration: false, nodeIntegrationInSubFrames: false,
            contextIsolation: true, webSecurity: true, javascript: this.db.settings(loginProfile).javascript },
        } }
      }
      if (target) setImmediate(() => {
        if (!this.shuttingDown) this.openRelated(state, target)
      })
      return { action: 'deny' }
    })
    wc.on('did-create-window', popup => {
      tab.signInWindow = popup
      const contents = popup.webContents
      const safe = (url: string) => url === 'about:blank' || Boolean(webUrl(url)?.startsWith('https://'))
      const showOrigin = (url: string) => popup.setTitle('Drew · ' + (originOf(url) ?? 'Waiting for sign-in'))
      contents.setWindowOpenHandler(() => ({ action: 'deny' }))
      contents.on('will-attach-webview', event => event.preventDefault())
      contents.on('will-navigate', event => { if (!safe(event.url)) event.preventDefault() })
      contents.on('will-redirect', event => { if (event.isMainFrame && !safe(event.url)) event.preventDefault() })
      popup.on('page-title-updated', event => event.preventDefault())
      contents.on('did-navigate', (_event, url) => showOrigin(url))
      popup.once('ready-to-show', () => popup.show())
      popup.on('closed', () => { if (tab.signInWindow === popup) tab.signInWindow = undefined })
      showOrigin(contents.getURL())
    })
    wc.once('destroyed', () => { if (tab.signInWindow && !tab.signInWindow.isDestroyed()) tab.signInWindow.destroy() })
    wc.on('did-start-navigation', event => {
      if (event.isMainFrame && !event.isSameDocument) {
        tab.pendingUrl = event.url
        tab.edited = false
        state.error = null
        update()
      }
    })
    wc.on('found-in-page', (_event, result) => {
      if (wc === this.findTarget && result.requestId === this.findRequest && result.finalUpdate)
        this.window.webContents.send('drew:find-result', { index: result.activeMatchOrdinal, total: result.matches })
    })
    wc.on('media-started-playing', () => { state.media = true; state.playing = true; update() })
    wc.on('media-paused', () => { state.playing = false; update() })
    wc.on('audio-state-changed', event => { state.audible = event.audible; update() })
    wc.setAudioMuted(state.muted)
    wc.on('did-start-loading', () => { state.loading = true; update() })
    wc.on('did-stop-loading', () => {
      tab.pendingUrl = null
      state.loading = false
      const origin = originOf(wc.getURL())
      if (origin) wc.setZoomLevel(Number(this.db.get('zoom:' + loginProfile + ':' + origin, '0')))
      update()
    })
    wc.on('did-navigate', (_event, url) => committed(url))
    wc.on('did-navigate-in-page', (_event, url, main) => { if (main) committed(url, true) })
    wc.on('page-title-updated', (_event, title) => {
      if (state.url === HOME || state.error) return
      const next = title.trim().slice(0, 512) || new URL(state.url).hostname
      if (next === state.title) return
      state.title = next
      this.persist(state)
      this.db.run('UPDATE history SET title = ? WHERE id = (SELECT id FROM history WHERE url = ? AND workspaceId = ? ORDER BY visitedAt DESC, rowid DESC LIMIT 1)', state.title, state.url, this.storageFor(state.workspaceId))
      update()
    })
    wc.on('page-favicon-updated', (_event, urls) => {
      if (state.url === HOME || state.error) return
      const favicon = urls.map(url => webUrl(url) ?? (
        url.length <= 96_000 && /^data:image\/(?:png|gif|jpeg|webp|x-icon|vnd\.microsoft\.icon);base64,[a-z0-9+/=]+$/i.test(url) ? url : null
      )).find(Boolean) ?? null
      if (favicon === state.favicon) return
      state.favicon = favicon
      this.persist(state)
      update()
    })
    wc.on('did-fail-load', (_event, code, description, url, main) => {
      if (!main || code === -3) return
      if (webUrl(url)) {
        state.url = url
        state.title = new URL(url).hostname
        state.favicon = null
      }
      tab.pendingUrl = null
      state.error = description.replace(/^net::/, '')
      state.loading = false
      this.persist(state)
      update()
    })
    wc.on('render-process-gone', (_event, details) => {
      state.error = 'Page process exited (' + details.reason + ')'
      state.loading = false
      tab.started = false
      update()
    })
    wc.on('context-menu', (_event, params) => {
      const origin = originOf(wc.getURL())
      const hasLogin = params.frame === wc.mainFrame && this.canFill(tab, view) && origin?.startsWith('https://') &&
        this.db.one('SELECT id FROM saved_logins WHERE profileId = ? AND origin = ? LIMIT 1', loginProfile, origin)
      showPageMenu(this.window, wc, params, {
        engine: this.db.settings(loginProfile).engine,
        openTab: (url, foreground) => { this.create(url, state.workspaceId, foreground && this.workspaceId === state.workspaceId) },
        openWindow: url => this.openWindow?.(url, state.workspaceId),
        fill: hasLogin ? () => { void this.fillLogin().catch(error => this.reportPageError(error)) } : undefined,
        report: error => this.reportPageError(error),
      })
    })
    this.wire(view)
    return view
  }

  private openRelated(tab: Tab, url: string) {
    if (this.wirePeek && tab.pinned && tab.workspaceId === this.workspaceId && webUrl(url)) {
      this.wirePeek(url, tab.workspaceId)
    } else this.create(url, tab.workspaceId, this.workspaceId === tab.workspaceId)
  }

  private start(tab: LiveTab, url = tab.state.url) {
    if (this.suspendedProfiles.has(this.storageFor(tab.state.workspaceId))) return
    const view = tab.view ?? this.makeView(tab)
    tab.started = true
    tab.state.sleeping = false
    tab.pendingUrl = url
    const history = url === tab.state.url ? tab.history : undefined
    tab.history = undefined
    const load = () => view.webContents.loadURL(url === HOME ? HOME : webUrl(url) ?? HOME)
    const navigation = history ? view.webContents.navigationHistory.restore(history).catch(load) : load()
    void navigation.catch(() => {})
  }

  find(query: string, direction?: 'next' | 'previous') {
    const contents = this.active()?.view?.webContents
    if (!query || contents !== this.findTarget) {
      if (this.findTarget && !this.findTarget.isDestroyed()) this.findTarget.stopFindInPage('clearSelection')
      this.findTarget = undefined
    }
    if (!query || !contents) return
    this.findTarget = contents
    this.findRequest = contents.findInPage(query, { forward: direction !== 'previous', findNext: !direction })
  }

  zoom(direction: 'in' | 'out' | 'reset') {
    const contents = this.active()?.view?.webContents
    if (!contents || !webUrl(contents.getURL())) return
    const origin = new URL(contents.getURL()).origin
    const key = 'zoom:' + this.profileId + ':' + origin
    const current = contents.getZoomLevel()
    const level = direction === 'reset' ? 0 : Math.max(-3, Math.min(5, current + (direction === 'in' ? 1 : -1)))
    this.db.set(key, String(level))
    contents.setZoomLevel(level)
    this.tabChanged(this.active()!.state)
  }

  print() {
    const contents = this.active()?.view?.webContents
    if (contents && webUrl(contents.getURL())) contents.print()
  }

  async savePdf() {
    const tab = this.active()
    const contents = tab?.view?.webContents
    const url = contents?.getURL()
    if (!contents || !url || !webUrl(url)) return
    const { canceled, filePath } = await dialog.showSaveDialog(this.window, {
      defaultPath: 'Page.pdf', filters: [{ name: 'PDF', extensions: ['pdf'] }],
    })
    if (canceled || !filePath || contents.isDestroyed() || contents.getURL() !== url || this.active() !== tab) return
    const document = await contents.printToPDF({ printBackground: true, preferCSSPageSize: true })
    await writeFile(filePath, document, { mode: 0o600 })
  }

  private backgroundProtection(tab: LiveTab, automatic: boolean) {
    const { state, view } = tab
    const contents = view?.webContents
    if (tab === this.active() || this.visibleIds().includes(state.id) ||
        this.splits.get(state.workspaceId)?.some(pane => pane.id === state.id)) return 'This tab is visible or in Split View.'
    if (tab.edited) return 'This tab contains edits.'
    if (tab.pendingUrl || state.loading) return 'This tab is loading.'
    if (tab.signInWindow) return 'This tab has a sign-in window.'
    if (state.playing || state.audible || contents?.isBeingCaptured() || contents?.isCurrentlyAudible()) {
      return 'This tab has active media or capture.'
    }
    const profile = this.storageFor(state.workspaceId)
    const origin = originOf(state.url)
    if (automatic && origin && this.db.settings(profile).keepAwakeHosts.split(',').includes(new URL(origin).hostname)) {
      return 'This site is set to stay awake.'
    }
    if (!view) return
    if (this.db.one("SELECT 1 FROM downloads WHERE workspaceId = ? AND state IN ('progressing', 'paused')", profile)) {
      return 'This Profile has an active download.'
    }
    if (this.db.one("SELECT 1 FROM profile_permissions WHERE workspaceId = ? AND origin = ? AND allow = 1 AND permission IN ('camera', 'microphone')", profile, origin)) {
      return 'This site has permission to use the camera or microphone.'
    }
  }

  sleep(id: string, automatic = false) {
    const tab = this.tabs.get(id)
    const contents = tab?.view?.webContents
    if (!tab || !contents || tab.state.url === HOME || (automatic && tab.state.pinned)) return false
    const protection = this.backgroundProtection(tab, automatic)
    if (protection) {
      if (!automatic) throw new Error(protection)
      return false
    }
    const entries = contents.navigationHistory.getAllEntries()
    const index = contents.navigationHistory.getActiveIndex()
    if (entries.length && index >= 0) tab.history = { entries, index }
    this.destroyView(tab)
    tab.started = false
    tab.pendingUrl = null
    tab.state.sleeping = true
    this.tabChanged(tab.state)
    return true
  }

  sleepInactive(onBattery: boolean) {
    const timeouts = new Map<string, number>()
    const now = Date.now()
    for (const { state, view } of this.tabs.values()) {
      if (!view || state.pinned) continue
      const profile = this.storageFor(state.workspaceId)
      let minutes = timeouts.get(profile)
      if (minutes === undefined) {
        const { memorySaver, batterySaver } = this.db.settings(profile)
        const saving = batterySaver === 'on' || (batterySaver === 'battery' && onBattery)
        minutes = saving ? 10 : Number(memorySaver) || 0
        timeouts.set(profile, minutes)
      }
      if (minutes && now - state.lastUsed >= minutes * 60_000) this.sleep(state.id, true)
    }
  }

  private persist(tab: SavedTab) {
    this.db.run(`INSERT INTO tabs (id, workspaceId, url, title, favicon, pinned, groupId, position, lastUsed, windowId) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET url=excluded.url, title=excluded.title, favicon=excluded.favicon,
      pinned=excluded.pinned, groupId=excluded.groupId, position=excluded.position, lastUsed=excluded.lastUsed`,
    tab.id, tab.workspaceId, tab.url, tab.title, tab.favicon, tab.pinned, tab.groupId, tab.position, tab.lastUsed, this.sessionId)
  }

  private markActive(workspaceId: string, tabId: string | null) {
    if (tabId) this.activeBySpace.set(workspaceId, tabId)
    else this.activeBySpace.delete(workspaceId)
    if (this.managesSavedTabs) this.db.run('UPDATE workspaces SET activeTab = ? WHERE id = ?', tabId, workspaceId)
    this.saveWindow()
  }

  create(url = HOME, workspaceId = this.workspaceId, select = true, previous?: Pick<SavedTab, 'title' | 'favicon' | 'pinned' | 'groupId'>) {
    url = url === HOME ? HOME : webUrl(url) ?? HOME
    const position = Math.max(-1, ...this.list().filter(tab => tab.workspaceId === workspaceId).map(tab => tab.position)) + 1
    const tab = this.register({
      id: randomUUID(), workspaceId, url, title: previous?.title ?? (url === HOME ? 'New Tab' : new URL(url).hostname),
      favicon: previous?.favicon ?? null, pinned: previous?.pinned ?? 0, groupId: previous?.groupId ?? null, position, lastUsed: Date.now(),
    })
    this.persist(tab.state)
    if (select) this.select(tab.state.id)
    else this.changed()
    return tab.state.id
  }

  select(id: string) {
    const tab = this.tabs.get(id)
    if (!tab || tab.state.workspaceId !== this.workspaceId) return
    if (this.active() !== tab) this.find('')
    this.markActive(this.workspaceId, id)
    tab.state.lastUsed = Date.now()
    this.persist(tab.state)
    if (!tab.started) this.start(tab)
    this.syncView()
    this.window.webContents.focus()
    this.changed()
  }

  switchWorkspace(id: string) {
    const space = this.workspaces().find(item => item.id === id)
    if (!space) return
    if (id !== this.workspaceId) {
      this.find('')
      if (Array.isArray(this.bounds)) this.bounds = null
    }
    this.workspaceId = id
    if (this.managesSavedTabs) this.db.set('workspaceId', id)
    this.saveWindow()
    const tabs = this.list().filter(tab => tab.workspaceId === id)
    const active = tabs.find(tab => tab.id === space.activeTab) ?? tabs[0]
    if (active) this.select(active.id)
    else this.create()
  }

  moveToSpace(id: string, space: string) {
    const tab = this.tabs.get(id)
    if (!tab || tab.state.workspaceId === space) return
    if (!this.workspaces().some(item => item.id === space) || this.storageFor(space) !== this.profileId) {
      throw new Error('Choose a Space in the same Profile.')
    }
    const source = tab.state.workspaceId
    const next = this.ordered(source).find(item => item.id !== id)
    const wasActive = this.activeBySpace.get(source) === id
    this.db.transaction(() => {
      tab.state.position = Math.max(-1, ...this.ordered(space).map(item => item.position)) + 1
      tab.state.workspaceId = space
      tab.state.groupId = null
      this.splits.set(source, (this.splits.get(source) ?? []).filter(pane => pane.id !== id))
      this.persist(tab.state)
      if (!this.activeBySpace.has(space)) this.markActive(space, id)
      if (wasActive) {
        if (source === this.workspaceId) {
          if (next) this.select(next.id)
          else this.create()
        } else this.markActive(source, next?.id ?? null)
      }
      this.saveWindow()
    })
    this.syncView()
    this.changed()
  }

  close(id: string, remember = true) {
    const tab = this.tabs.get(id)
    if (!tab) return
    const { workspaceId } = tab.state
    const activeId = this.activeBySpace.get(workspaceId)
    const siblings = this.ordered(workspaceId)
    const position = siblings.findIndex(item => item.id === id)
    if (remember) {
      this.closed.push({ ...tab.state })
      if (this.closed.length > 30) this.closed.shift()
    }
    this.tabs.delete(id)
    this.destroyView(tab)
    this.db.run('DELETE FROM tabs WHERE id = ? AND windowId = ?', id, this.sessionId)
    if (activeId === id) {
      const next = siblings[position + 1] ?? siblings[position - 1]
      if (workspaceId === this.workspaceId) {
        if (next) this.select(next.id)
        else this.create()
      } else {
        this.markActive(workspaceId, next?.id ?? null)
      }
    }
    this.changed()
  }

  reopen() {
    const index = this.closed.findLastIndex(tab => tab.workspaceId === this.workspaceId)
    if (index < 0) return
    const [last] = this.closed.splice(index, 1)
    if (last.groupId && !this.db.one('SELECT id FROM tab_groups WHERE id = ?', last.groupId)) last.groupId = null
    this.create(last.url, last.workspaceId, true, last)
  }

  private ordered(workspaceId = this.workspaceId) {
    return this.list().filter(tab => tab.workspaceId === workspaceId).sort((a, b) => b.pinned - a.pinned)
  }

  next(reverse = false) {
    const tabs = this.ordered()
    if (!tabs.length) return
    const index = tabs.findIndex(tab => tab.id === this.active()?.state.id)
    this.select(tabs[(index + (reverse ? -1 : 1) + tabs.length) % tabs.length].id)
  }

  async toggleMedia(id: string) {
    const tab = this.tabs.get(id)
    if (!tab?.view || tab.state.workspaceId !== this.workspaceId || !tab.state.media) return
    const script = tab.state.playing
      ? "(() => { for (const media of document.querySelectorAll('audio,video')) if (!media.paused) media.pause() })()"
      : "(() => { const media = [...document.querySelectorAll('audio,video')].find(item => item.currentSrc && item.paused); if (media) media.play().catch(() => {}) })()"
    await tab.view.webContents.executeJavaScript(script, true).catch(() => {})
  }

  mute(id: string) {
    const tab = this.tabs.get(id)
    if (!tab?.view || tab.state.workspaceId !== this.workspaceId) return
    tab.state.muted = !tab.state.muted
    tab.view.webContents.setAudioMuted(tab.state.muted)
    this.changed()
  }

  pin(id: string) {
    const tab = this.tabs.get(id)?.state
    if (!tab) return
    tab.pinned = tab.pinned ? 0 : 1
    if (!tab.pinned) tab.groupId = null
    this.persist(tab)
    this.changed()
  }

  group(id: string, groupId: string | null) {
    const tab = this.tabs.get(id)?.state
    if (!tab || (groupId && !this.db.one('SELECT id FROM tab_groups WHERE id = ? AND workspaceId = ?', groupId, tab.workspaceId))) return
    tab.groupId = groupId
    if (groupId) tab.pinned = 1
    this.persist(tab)
    this.changed()
  }

  removeGroup(groupId: string) {
    this.db.run('DELETE FROM tab_groups WHERE id = ?', groupId)
    for (const { state } of this.tabs.values()) if (state.groupId === groupId) state.groupId = null
    this.changed()
  }

  move(id: string, target: string) {
    if (id === target) return
    const source = this.tabs.get(id)?.state
    const destination = this.tabs.get(target)?.state
    if (!source || !destination || source.workspaceId !== destination.workspaceId) return
    const list = this.list().filter(tab => tab.workspaceId === source.workspaceId)
    const oldIndex = list.indexOf(source)
    const targetIndex = list.indexOf(destination)
    list.splice(oldIndex, 1)
    list.splice(targetIndex, 0, source)
    this.db.transaction(() => {
      source.pinned = destination.pinned
      source.groupId = destination.groupId
      list.forEach((tab, index) => { tab.position = index; this.persist(tab) })
    })
    this.changed()
  }

  navigate(id: string, url: string) {
    const tab = this.tabs.get(id)
    if (!tab) return
    tab.state.error = null
    if (url === HOME) {
      Object.assign(tab.state, { url: HOME, title: 'New Tab', favicon: null })
      this.persist(tab.state)
    }
    this.start(tab, url)
    this.syncView()
    this.changed()
  }

  home() {
    const url = this.db.settings(this.profileId).homepage
    const active = this.active()
    if (active) this.navigate(active.state.id, url)
    else this.create(url)
  }

  action(id: string, action: 'back' | 'forward' | 'reload' | 'stop' | 'home') {
    const tab = this.tabs.get(id)
    if (!tab) return
    if (action === 'home') { this.navigate(id, this.db.settings(this.storageFor(tab.state.workspaceId)).homepage); return }
    const wc = tab.view?.webContents
    if (!wc) return
    if (action === 'back' && wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack()
    if (action === 'forward' && wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward()
    if (action === 'stop') { wc.stop(); tab.pendingUrl = null }
    if (action === 'reload') {
      if (tab.pendingUrl) { this.start(tab, tab.pendingUrl); return }
      if (tab.state.error || !tab.started) this.navigate(id, tab.state.url)
      else wc.reload()
    }
  }

  resetRenderers(profile: string, suspended = false) {
    if (suspended) this.suspendedProfiles.add(profile)
    else this.suspendedProfiles.delete(profile)
    for (const tab of this.tabs.values()) {
      if (this.storageFor(tab.state.workspaceId) !== profile) continue
      this.destroyView(tab)
      tab.started = false
      tab.pendingUrl = null
      Object.assign(tab.state, { loading: false, back: false, forward: false, error: null, audible: false, media: false, playing: false })
    }
    const active = this.active()
    if (!suspended && active && this.profileId === profile && this.bounds) this.start(active)
    this.syncView()
    this.changed()
  }

  archive(expiredOnly = false) {
    const now = Date.now()
    const cutoffByProfile = new Map<string, number>()
    const ids = this.list().filter(tab => {
      if (tab.pinned) return false
      if (!expiredOnly) return tab.workspaceId === this.workspaceId
      const profileId = this.storageFor(tab.workspaceId)
      if (!cutoffByProfile.has(profileId)) {
        const hours = Number(this.db.settings(profileId).archiveHours)
        cutoffByProfile.set(profileId, hours > 0 ? now - hours * 3_600_000 : 0)
      }
      return tab.lastUsed < cutoffByProfile.get(profileId)! && !this.backgroundProtection(this.tabs.get(tab.id)!, true)
    })
    const batch = expiredOnly ? null : randomUUID()
    this.db.transaction(() => {
      for (const tab of ids) {
        if (tab.url !== HOME) this.db.run('INSERT INTO archived_tabs (id, workspaceId, url, title, archivedAt, batch, windowId) VALUES (?, ?, ?, ?, ?, ?, ?)', tab.id, tab.workspaceId, tab.url, tab.title, now, batch, this.sessionId)
        this.close(tab.id, false)
      }
    })
  }

  private latestClear() {
    return this.db.one<{ batch: string }>('SELECT batch FROM archived_tabs WHERE workspaceId = ? AND windowId = ? AND batch IS NOT NULL ORDER BY archivedAt DESC, rowid DESC LIMIT 1',
      this.workspaceId, this.sessionId)?.batch
  }
  get canUndoClear() { return Boolean(this.latestClear()) }
  undoClear() {
    const batch = this.latestClear()
    if (!batch) return
    const items = this.db.all<ArchivedTab>('SELECT id, url, title, archivedAt FROM archived_tabs WHERE workspaceId = ? AND batch = ? ORDER BY rowid', this.workspaceId, batch)
    this.restoreArchive(items.map(item => item.id))
  }
  restoreArchive(ids: string[]) {
    this.db.transaction(() => {
      let last: string | undefined
      for (const id of ids) {
        const item = this.db.one<ArchivedTab>('SELECT id, url, title, archivedAt FROM archived_tabs WHERE id = ? AND workspaceId = ?', id, this.workspaceId)
        if (!item) continue
        last = this.create(item.url, this.workspaceId, false, { title: item.title, pinned: 0, groupId: null, favicon: null })
        this.db.run('DELETE FROM archived_tabs WHERE id = ?', id)
      }
      if (last) {
        this.setSplit(this.workspaceId, [])
        this.select(last)
      }
    })
  }

  private visibleIds() {
    if (Array.isArray(this.bounds)) return this.bounds.map(pane => pane.id)
    const active = this.active()
    return active ? [active.state.id] : []
  }

  layout(bounds: Rectangle | PaneRect[] | null) {
    this.bounds = bounds
    this.syncView()
  }

  private syncView() {
    if (this.shuttingDown || this.window.isDestroyed()) return
    const active = this.active()
    const bounds = this.bounds
    const slots = Array.isArray(bounds) ? bounds : (active && bounds ? [{ ...bounds, id: active.state.id }] : [])
    const next = new Map<WebContentsView, Rectangle>()
    for (const slot of slots) {
      const tab = this.tabs.get(slot.id)
      if (!tab || tab.state.workspaceId !== this.workspaceId || tab.state.url === HOME || tab.state.error) continue
      if (this.suspendedProfiles.has(this.storageFor(tab.state.workspaceId))) continue
      if (!tab.started) this.start(tab)
      if (tab.view) next.set(tab.view, { x: slot.x, y: slot.y, width: slot.width, height: slot.height })
    }

    const clip = Array.isArray(bounds) && bounds.length ? {
      x: Math.min(...bounds.map(rect => rect.x)),
      y: Math.min(...bounds.map(rect => rect.y)),
      width: 0,
      height: 0,
    } : Array.isArray(bounds) ? null : bounds
    if (clip && Array.isArray(bounds)) {
      clip.width = Math.max(...bounds.map(rect => rect.x + rect.width)) - clip.x
      clip.height = Math.max(...bounds.map(rect => rect.y + rect.height)) - clip.y
    }
    this.viewport.setVisible(Boolean(clip && next.size))
    if (clip) this.viewport.setBounds(clip)
    for (const view of this.attached) if (!next.has(view)) this.viewport.removeChildView(view)
    for (const [view, rect] of next) {
      if (!this.attached.has(view)) this.viewport.addChildView(view)
      if (clip) view.setBounds({ ...rect, x: rect.x - clip.x, y: rect.y - clip.y })
    }
    this.attached = new Set(next.keys())
  }

  private destroyView(tab: LiveTab) {
    const view = tab.view
    if (!view) return
    if (this.findTarget === view.webContents) this.findTarget = undefined
    tab.view = null
    if (tab.signInWindow && !tab.signInWindow.isDestroyed()) tab.signInWindow.destroy()
    if (this.attached.has(view)) {
      if (!this.window.isDestroyed()) this.viewport.removeChildView(view)
      this.attached.delete(view)
    }
    view.webContents.removeAllListeners()
    if (!view.webContents.isDestroyed()) view.webContents.close()
  }

  dispose() {
    this.shuttingDown = true
    for (const tab of this.tabs.values()) this.destroyView(tab)
    if (!this.window.isDestroyed()) this.window.contentView.removeChildView(this.viewport)
  }
}
