import { randomUUID } from 'node:crypto'
import { BrowserWindow, Menu, WebContentsView, type Rectangle, type Session } from 'electron'
import { HOME, type PaneRect, type SavedTab, type Tab, type Workspace } from '../../shared/model.js'
import { webUrl } from '../../shared/navigation.js'
import type { Database } from './database.js'

interface LiveTab {
  state: Tab
  view: WebContentsView | null
  started: boolean
  pendingUrl: string | null
}

export class Tabs {
  private tabs = new Map<string, LiveTab>()
  private closed: SavedTab[] = []
  private attached = new Set<WebContentsView>()
  private bounds: Rectangle | PaneRect[] | null = null
  private spaceSlide: { start: number; direction: number } | null = null
  private slideTimer: ReturnType<typeof setTimeout> | null = null
  private shuttingDown = false
  workspaceId: string

  constructor(
    private window: BrowserWindow,
    private db: Database,
    private sessionFor: (profile: string) => Session,
    private changed: () => void,
    private wire: (view: WebContentsView) => void,
    private wirePeek?: (url: string, space: string) => void,
  ) {
    const spaces = this.workspaces()
    this.workspaceId = spaces.find(space => space.id === db.get('workspaceId', ''))?.id ?? spaces[0].id
    for (const tab of db.all<SavedTab>('SELECT * FROM tabs ORDER BY position, rowid')) this.register(tab)
    const { startup, homepage } = db.settings(this.profileId)
    if (startup === 'restore') this.switchWorkspace(this.workspaceId)
    else this.create(startup === 'home' ? homepage : HOME)
  }

  workspaces() { return this.db.all<Workspace>('SELECT * FROM workspaces ORDER BY rowid') }
  storageFor(id: string) {
    return this.db.one<{ profileId: string | null }>('SELECT profileId FROM workspaces WHERE id = ?', id)?.profileId ?? id
  }
  get profileId() { return this.storageFor(this.workspaceId) }
  list() { return [...this.tabs.values()].map(tab => tab.state).sort((a, b) => a.position - b.position) }
  active() {
    const workspace = this.db.one<Workspace>('SELECT * FROM workspaces WHERE id = ?', this.workspaceId)
    return workspace?.activeTab ? this.tabs.get(workspace.activeTab) : undefined
  }

  private register(saved: SavedTab) {
    const tab: LiveTab = { state: { ...saved, audible: false, muted: false, media: false, playing: false, loading: false, back: false, forward: false, error: null }, view: null, started: false, pendingUrl: null }
    this.tabs.set(saved.id, tab)
    return tab
  }

  private makeView(tab: LiveTab) {
    const view = new WebContentsView({
      webPreferences: {
        session: this.sessionFor(this.storageFor(tab.state.workspaceId)), sandbox: true, nodeIntegration: false, contextIsolation: true,
        webSecurity: true, javascript: this.db.settings(this.storageFor(tab.state.workspaceId)).javascript, navigateOnDragDrop: false,
      },
    })
    tab.view = view
    const wc = view.webContents
    const state = tab.state
    const update = () => {
      if (this.shuttingDown || tab.view !== view || wc.isDestroyed()) return
      state.back = wc.navigationHistory.canGoBack()
      state.forward = wc.navigationHistory.canGoForward()
      this.syncView()
      this.changed()
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
    wc.setWindowOpenHandler(({ url }) => {
      const target = webUrl(url)
      if (target) setImmediate(() => {
        if (!this.shuttingDown) this.openRelated(state, target)
      })
      return { action: 'deny' }
    })
    wc.on('did-start-navigation', event => {
      if (event.isMainFrame && !event.isSameDocument) {
        tab.pendingUrl = event.url
        state.error = null
        update()
      }
    })
    wc.on('media-started-playing', () => { state.media = true; state.playing = true; update() })
    wc.on('media-paused', () => { state.playing = false; update() })
    wc.on('audio-state-changed', event => { state.audible = event.audible; update() })
    wc.setAudioMuted(state.muted)
    wc.on('did-start-loading', () => { state.loading = true; update() })
    wc.on('did-stop-loading', () => { tab.pendingUrl = null; state.loading = false; update() })
    wc.on('did-navigate', (_event, url) => committed(url))
    wc.on('did-navigate-in-page', (_event, url, main) => { if (main) committed(url, true) })
    wc.on('page-title-updated', (_event, title) => {
      if (state.url === HOME || state.error) return
      state.title = title.trim().slice(0, 512) || new URL(state.url).hostname
      this.persist(state)
      this.db.run('UPDATE history SET title = ? WHERE id = (SELECT id FROM history WHERE url = ? AND workspaceId = ? ORDER BY visitedAt DESC, rowid DESC LIMIT 1)', state.title, state.url, this.storageFor(state.workspaceId))
      update()
    })
    wc.on('page-favicon-updated', (_event, urls) => {
      if (state.url === HOME || state.error) return
      state.favicon = urls.map(url => webUrl(url)).find(Boolean) ?? null
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
      if (params.linkURL && webUrl(params.linkURL)) {
        Menu.buildFromTemplate([{
          label: 'Open Link in New Tab',
          click: () => this.create(params.linkURL, state.workspaceId, this.workspaceId === state.workspaceId),
        }]).popup({ window: this.window })
      }
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
    const view = tab.view ?? this.makeView(tab)
    tab.started = true
    tab.pendingUrl = url
    void view.webContents.loadURL(url === HOME ? HOME : webUrl(url) ?? HOME).catch(() => {
      // Navigation lifecycle events handle failed and superseded requests.
    })
  }

  private persist(tab: SavedTab) {
    this.db.run(`INSERT INTO tabs VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET url=excluded.url, title=excluded.title, favicon=excluded.favicon,
      pinned=excluded.pinned, groupId=excluded.groupId, position=excluded.position, lastUsed=excluded.lastUsed`,
    tab.id, tab.workspaceId, tab.url, tab.title, tab.favicon, tab.pinned, tab.groupId, tab.position, tab.lastUsed)
  }

  private markActive(workspaceId: string, tabId: string) {
    this.db.run('UPDATE workspaces SET activeTab = ? WHERE id = ?', tabId, workspaceId)
  }

  create(url = HOME, workspaceId = this.workspaceId, select = true, previous?: SavedTab) {
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
    this.markActive(this.workspaceId, id)
    tab.state.lastUsed = Date.now()
    this.persist(tab.state)
    if (!tab.started) this.start(tab)
    this.syncView()
    this.window.webContents.focus()
    this.changed()
  }

  switchWorkspace(id: string, direction = 0) {
    const space = this.workspaces().find(item => item.id === id)
    if (!space) return
    if (id !== this.workspaceId) {
      if (Array.isArray(this.bounds)) this.bounds = null
      this.spaceSlide = direction ? { start: performance.now(), direction } : null
    }
    this.workspaceId = id
    this.db.set('workspaceId', id)
    const tabs = this.list().filter(tab => tab.workspaceId === id)
    const active = tabs.find(tab => tab.id === space.activeTab) ?? tabs[0]
    if (active) this.select(active.id)
    else this.create()
  }

  close(id: string) {
    const tab = this.tabs.get(id)
    if (!tab) return
    const { workspaceId } = tab.state
    const activeId = this.workspaces().find(space => space.id === workspaceId)?.activeTab
    const siblings = this.ordered(workspaceId)
    const position = siblings.findIndex(item => item.id === id)
    this.closed.push({ ...tab.state })
    if (this.closed.length > 30) this.closed.shift()
    this.tabs.delete(id)
    this.destroyView(tab)
    this.db.run('DELETE FROM tabs WHERE id = ?', id)
    if (activeId === id) {
      const next = siblings[position + 1] ?? siblings[position - 1]
      if (workspaceId === this.workspaceId) {
        if (next) this.select(next.id)
        else this.create()
      } else {
        this.db.run('UPDATE workspaces SET activeTab = ? WHERE id = ?', next?.id ?? null, workspaceId)
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

  action(id: string, action: 'back' | 'forward' | 'reload' | 'stop' | 'home') {
    const tab = this.tabs.get(id)
    const wc = tab?.view?.webContents
    if (!tab || !wc) return
    if (action === 'home') this.navigate(id, this.db.settings(this.storageFor(tab.state.workspaceId)).homepage)
    if (action === 'back' && wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack()
    if (action === 'forward' && wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward()
    if (action === 'stop') { wc.stop(); tab.pendingUrl = null }
    if (action === 'reload') {
      if (tab.pendingUrl) { this.start(tab, tab.pendingUrl); return }
      if (tab.state.error || !tab.started) this.navigate(id, tab.state.url)
      else wc.reload()
    }
  }

  resetRenderers(profile?: string) {
    for (const tab of this.tabs.values()) {
      if (profile && this.storageFor(tab.state.workspaceId) !== profile) continue
      this.destroyView(tab)
      tab.started = false
      tab.pendingUrl = null
      Object.assign(tab.state, { loading: false, back: false, forward: false, error: null, audible: false, media: false, playing: false })
    }
    const active = this.active()
    if (active && (!profile || this.storageFor(active.state.workspaceId) === profile)) this.select(active.state.id)
  }

  archive(expiredOnly = false) {
    const now = Date.now()
    const visible = expiredOnly ? this.visibleIds() : []
    const cutoffByProfile = new Map<string, number>()
    const ids = this.list().filter(tab => {
      if (tab.pinned) return false
      if (!expiredOnly) return tab.workspaceId === this.workspaceId
      if (visible.includes(tab.id)) return false
      const profileId = this.storageFor(tab.workspaceId)
      if (!cutoffByProfile.has(profileId)) {
        const hours = Number(this.db.settings(profileId).archiveHours)
        cutoffByProfile.set(profileId, hours > 0 ? now - hours * 3_600_000 : 0)
      }
      return tab.lastUsed < cutoffByProfile.get(profileId)!
    })
    for (const tab of ids) {
      if (tab.url !== HOME) this.db.run('INSERT INTO archived_tabs VALUES (?, ?, ?, ?, ?)', tab.id, tab.workspaceId, tab.url, tab.title, now)
      this.close(tab.id)
    }
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
      if (!tab.started) this.start(tab)
      if (tab.view) next.set(tab.view, { x: slot.x, y: slot.y, width: slot.width, height: slot.height })
    }
    for (const view of this.attached) if (!next.has(view)) this.window.contentView.removeChildView(view)
    const slide = this.spaceSlide
    let offset = 0
    if (slide && !Array.isArray(bounds)) {
      const progress = Math.min(1, (performance.now() - slide.start) / 360)
      offset = Math.round(33 * (1 - progress) ** 3) * slide.direction
      if (progress >= 1) this.spaceSlide = null
      else if (!this.slideTimer) this.slideTimer = setTimeout(() => {
        this.slideTimer = null
        this.syncView()
      }, 16)
    }
    for (const [view, rect] of next) {
      if (!this.attached.has(view)) this.window.contentView.addChildView(view)
      const inset = Math.min(Math.abs(offset), Math.max(0, rect.width - 1))
      view.setBounds({ ...rect, x: rect.x + (offset > 0 ? inset : 0), width: rect.width - inset })
    }
    this.attached = new Set(next.keys())
  }

  private destroyView(tab: LiveTab) {
    const view = tab.view
    if (!view) return
    tab.view = null
    if (this.attached.has(view)) {
      if (!this.window.isDestroyed()) this.window.contentView.removeChildView(view)
      this.attached.delete(view)
    }
    view.webContents.removeAllListeners()
    if (!view.webContents.isDestroyed()) view.webContents.close()
  }

  dispose() {
    this.shuttingDown = true
    if (this.slideTimer) clearTimeout(this.slideTimer)
    for (const tab of this.tabs.values()) this.destroyView(tab)
  }
}
