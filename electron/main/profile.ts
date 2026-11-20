import { randomUUID } from 'node:crypto'
import { existsSync, statSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { app, Notification, session, shell, type DownloadItem, type Session } from 'electron'
import type { Download, Permission } from '../../shared/model.js'
import { originOf } from '../../shared/navigation.js'
import { extensionPopup } from './extensions.js'
import type { Database } from './database.js'

function configurePermissions(session: Session, db: Database, profile: string) {
  const permits = (origin: string, permission: Permission) => origin.startsWith('https://') &&
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
  session.setPermissionRequestHandler((_contents, permission, callback, details) => {
    const origin = originOf(details.requestingUrl)
    if (!details.isMainFrame || !origin) return callback(false)
    if (permission === 'notifications') return callback(permits(origin, 'notifications'))
    if (permission === 'media' && 'mediaTypes' in details && details.mediaTypes?.length) {
      return callback(details.mediaTypes.every(type => permits(origin, type === 'video' ? 'camera' : 'microphone')))
    }
    callback(false)
  })
}

export class Downloads {
  private items = new Map<string, DownloadItem>()
  private sessions = new Map<string, Session>()
  private paths = new Set<string>()
  private stopped = false

  constructor(private db: Database, private changed: () => void) {}

  sessionFor(profile: string) {
    const existing = this.sessions.get(profile)
    if (existing) return existing
    const browserSession = session.fromPartition(profile === this.db.primaryProfile() ? 'persist:lexn-web' : 'persist:lexn-profile-' + profile)
    this.sessions.set(profile, browserSession)
    configurePermissions(browserSession, this.db, profile)
    this.observe(browserSession, profile)
    browserSession.extensions.on('extension-loaded', () => { if (!this.stopped) this.changed() })
    browserSession.extensions.on('extension-unloaded', () => { if (!this.stopped) this.changed() })
    for (const path of this.extensionPaths(profile)) {
      void browserSession.extensions.loadExtension(path).catch(() => {})
    }
    return browserSession
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
      id: extension.id, name: extension.name, version: extension.version, popup: Boolean(extensionPopup(extension)),
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

  async action(profile: string, id: string, action: 'cancel' | 'open' | 'reveal') {
    const item = this.db.one<Download>('SELECT * FROM downloads WHERE workspaceId = ? AND id = ?', profile, id)
    if (!item) return
    if (action === 'cancel') return this.items.get(id)?.cancel()
    if (item.state !== 'completed' || !existsSync(item.path)) throw new Error('The downloaded file is unavailable.')
    if (action === 'reveal') shell.showItemInFolder(item.path)
    else {
      const error = await shell.openPath(item.path)
      if (error) throw new Error(error)
    }
  }

  dispose() {
    this.stopped = true
    this.db.run("UPDATE downloads SET state = 'interrupted' WHERE state = 'progressing'")
    for (const item of this.items.values()) item.cancel()
    this.items.clear()
    this.paths.clear()
  }
}
