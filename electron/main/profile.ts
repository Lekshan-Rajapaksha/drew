import { randomUUID } from 'node:crypto'
import { existsSync, lstatSync, statSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { app, BrowserWindow, dialog, Notification, session, shell, type View, type DownloadItem, type Session } from 'electron'
import type { Download, Permission } from '../../shared/model.js'
import { originOf, webUrl } from '../../shared/navigation.js'
import { extensionOptions, extensionPopup } from './extensions.js'
import type { Database } from './database.js'

const documentTypes = new Set(['.txt', '.csv', '.pdf', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.mp3', '.mp4', '.wav'])

function configurePermissions(session: Session, db: Database, profile: string, changed: () => void) {
  const permits = (origin: string, permission: Permission) => origin.startsWith('https://') &&
    (permission !== 'notifications' || db.settings(profile).notificationPolicy !== 'block') &&
    db.one<{ allow: number }>('SELECT allow FROM profile_permissions WHERE workspaceId = ? AND origin = ? AND permission = ?', profile, origin, permission)?.allow === 1
  session.setPermissionCheckHandler((_contents, permission, requestingOrigin, details) => {
    if (!details.isMainFrame) return false
    const origin = originOf(requestingOrigin)
    if (!origin) return false
    if (permission === 'notifications') return permits(origin, 'notifications')
    if (permission !== 'media') return false
    return details.mediaType === 'video' ? permits(origin, 'camera')
      : details.mediaType === 'audio' ? permits(origin, 'microphone')
        : permits(origin, 'camera') && permits(origin, 'microphone')
  })
  const prompts = new Set<number>()
  session.setPermissionRequestHandler((contents, permission, callback, details) => {
    const origin = originOf(details.requestingUrl)
    if (!details.isMainFrame || !origin?.startsWith('https:')) return callback(false)
    if (permission === 'notifications' && db.settings(profile).notificationPolicy === 'block') return callback(false)
    const requested: Permission[] = permission === 'notifications' ? ['notifications']
      : permission === 'media' && 'mediaTypes' in details && details.mediaTypes?.length
        ? [...new Set(details.mediaTypes.map(type => type === 'video' ? 'camera' as const : 'microphone' as const))] : []
    if (!requested.length) return callback(false)
    const rule = (key: Permission) => db.one<{ allow: number }>(
      'SELECT allow FROM profile_permissions WHERE workspaceId = ? AND origin = ? AND permission = ?', profile, origin, key)?.allow
    const rules = requested.map(rule)
    if (rules.includes(0)) return callback(false)
    if (rules.every(value => value === 1)) return callback(true)
    const containsPage = (view: View): boolean =>
      ('webContents' in view && view.webContents === contents) || view.children.some(containsPage)
    const owner = BrowserWindow.getFocusedWindow()
    if (!owner || owner.isModal() || !containsPage(owner.contentView)) return callback(false)
    if (!contents.isFocused() || originOf(contents.getURL()) !== origin || prompts.has(contents.id)) {
      return callback(false)
    }
    const id = contents.id
    const target = contents.getURL()
    prompts.add(id)
    void dialog.showMessageBox(owner, {
      type: 'question', title: 'Drew site permission', message: origin,
      detail: 'This site requests access to ' + requested.join(' and ') + '.',
      buttons: ['Allow for this Profile', 'Block for this Profile', 'Dismiss'],
      defaultId: 2, cancelId: 2, noLink: true,
    }).then(({ response }) => {
      if (response === 2 || contents.isDestroyed() || owner.isDestroyed() || contents.getURL() !== target) return callback(false)
      if (permission === 'notifications' && db.settings(profile).notificationPolicy === 'block') return callback(false)
      db.transaction(() => {
        for (const key of requested) db.run('INSERT INTO profile_permissions VALUES (?, ?, ?, ?) ON CONFLICT(workspaceId, origin, permission) DO UPDATE SET allow=excluded.allow',
          profile, origin, key, Number(response === 0))
      })
      changed()
      callback(response === 0)
    }).catch(() => callback(false)).finally(() => prompts.delete(id))
  })
}

export class Downloads {
  private items = new Map<string, DownloadItem>()
  private sessions = new Map<string, Session>()
  private paths = new Set<string>()
  private stopped = false

  constructor(private db: Database, private changed: () => void, readonly privateWindow = false) {}

  sessionFor(profile: string) {
    const existing = this.sessions.get(profile)
    if (existing) return existing
    const browserSession = session.fromPartition(this.privateWindow ? 'drew-private-' + profile : profile === this.db.primaryProfile() ? 'persist:lexn-web' : 'persist:lexn-profile-' + profile)
    this.sessions.set(profile, browserSession)
    configurePermissions(browserSession, this.db, profile, this.changed)
    this.refreshResourceRules(profile)
    this.observe(browserSession, profile)
    browserSession.extensions.on('extension-loaded', () => { if (!this.stopped) this.changed() })
    browserSession.extensions.on('extension-unloaded', () => { if (!this.stopped) this.changed() })
    for (const path of this.extensionPaths(profile)) {
      void browserSession.extensions.loadExtension(path).catch(() => {})
    }
    return browserSession
  }

  refreshResourceRules(profile: string) {
    const request = this.sessions.get(profile)?.webRequest
    if (!request) return
    const blocked = new Set(this.db.settings(profile).blockedResourceHosts.split(',').filter(Boolean))
    if (!blocked.size) { request.onBeforeRequest(null); return }
    request.onBeforeRequest({ urls: [...blocked].flatMap(host => ['http://' + host + '/*', 'https://' + host + '/*']) },
      (details, callback) => callback({ cancel: details.resourceType !== 'mainFrame' }))
  }

  private extensionPaths(profile: string): string[] {
    try {
      const value: unknown = JSON.parse(this.db.get('extensions:' + profile, '[]'))
      return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
    } catch {
      return []
    }
  }

  extensions(profile: string) {
    return this.sessionFor(profile).extensions.getAllExtensions().map(extension => ({
      id: extension.id, name: extension.name, version: extension.version, popup: Boolean(extensionPopup(extension)), options: Boolean(extensionOptions(extension)),
    }))
  }

  async loadExtension(profile: string, path: string) {
    const extension = await this.sessionFor(profile).extensions.loadExtension(path)
    if (this.stopped) return
    this.db.set('extensions:' + profile, JSON.stringify([...new Set([...this.extensionPaths(profile), extension.path])]))
  }

  removeExtension(profile: string, id: string) {
    const catalog = this.sessionFor(profile).extensions
    const extension = catalog.getExtension(id)
    if (!extension) return
    catalog.removeExtension(id)
    this.db.set('extensions:' + profile, JSON.stringify(this.extensionPaths(profile).filter(path => path !== extension.path)))
  }

  private observe(session: Session, profile: string) {
    const db = this.db
    session.on('will-download', (event, item) => {
      if (this.stopped) { event.preventDefault(); return }
      const id = randomUUID()
      const preferred = db.settings(profile).downloadPath
      let directory = app.getPath('downloads')
      if (preferred) {
        try { if (statSync(preferred).isDirectory()) directory = preferred } catch { /* Use Downloads. */ }
      }
      let name = basename(item.getFilename()).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/, '').slice(0, 180) || 'download'
      if (process.platform === 'win32' && /^(CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³])(?:\.|$)/i.test(name)) name = '_' + name
      const extension = extname(name)
      let path = join(directory, name)
      if (existsSync(path) || this.paths.has(path)) path = join(directory, name.slice(0, name.length - extension.length) + '-' + id.slice(0, 12) + extension)
      this.paths.add(path)
      item.setSavePath(path)
      this.items.set(id, item)
      db.run('INSERT INTO downloads VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        id, basename(path), path, item.getURL(), 0, Math.max(0, item.getTotalBytes()), 'progressing', Date.now(), profile)
      let last = 0
      item.on('updated', () => {
        if (this.stopped || Date.now() - last < 200) return
        last = Date.now()
        db.run('UPDATE downloads SET received = ?, total = ? WHERE id = ?', item.getReceivedBytes(), Math.max(0, item.getTotalBytes()), id)
        this.changed()
      })
      item.once('done', (_event, state) => {
        this.items.delete(id)
        this.paths.delete(path)
        if (this.stopped) return
        db.run('UPDATE downloads SET state = ?, received = ?, total = ? WHERE id = ?',
          state, item.getReceivedBytes(), Math.max(0, item.getTotalBytes()), id)
        this.changed()
        if (state === 'completed' && Notification.isSupported()) new Notification({ title: 'Download complete', body: basename(path) }).show()
      })
      this.changed()
    })
  }

  list(profile: string) { return this.db.all<Download>('SELECT * FROM downloads WHERE workspaceId = ? ORDER BY createdAt DESC LIMIT 200', profile) }

  async action(profile: string, id: string, action: 'cancel' | 'open' | 'reveal' | 'pause' | 'resume' | 'retry', window: BrowserWindow) {
    const item = this.db.one<Download>('SELECT * FROM downloads WHERE workspaceId = ? AND id = ?', profile, id)
    if (!item) return
    const live = this.items.get(id)
    if (action === 'cancel') return live?.cancel()
    if (action === 'pause' || action === 'resume') {
      if (!live || (action === 'resume' && !live.canResume())) throw new Error('This download cannot ' + action + '.')
      if (action === 'pause') live.pause()
      else live.resume()
      this.db.run('UPDATE downloads SET state = ? WHERE id = ?', action === 'pause' ? 'paused' : 'progressing', id)
      return
    }
    if (action === 'retry') {
      const url = webUrl(item.url)
      if (!url || !['cancelled', 'interrupted'].includes(item.state) || live) throw new Error('This download cannot be retried.')
      this.sessionFor(profile).downloadURL(url)
      return
    }
    const available = () => lstatSync(item.path, { throwIfNoEntry: false })?.isFile()
    if (item.state !== 'completed' || !available()) throw new Error('The downloaded file is unavailable.')
    if (action === 'reveal') shell.showItemInFolder(item.path)
    else {
      if (!documentTypes.has(extname(item.path).toLowerCase())) {
        const result = await dialog.showMessageBox(window, {
          type: 'warning', message: 'Open this downloaded file?', detail: basename(item.path),
          buttons: ['Cancel', 'Open File'], defaultId: 0, cancelId: 0, noLink: true,
        })
        if (result.response !== 1 || window.isDestroyed() || !available()) return
      }
      const error = await shell.openPath(item.path)
      if (error) throw new Error(error)
    }
  }

  dispose() {
    this.stopped = true
    this.db.run("UPDATE downloads SET state = 'interrupted' WHERE state IN ('progressing', 'paused')")
    for (const item of this.items.values()) item.cancel()
    this.items.clear()
    this.paths.clear()
    if (this.privateWindow) for (const partition of this.sessions.values()) void partition.clearData().catch(() => {})
  }
}
