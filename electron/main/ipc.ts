import { randomUUID } from 'node:crypto'
import { app, clipboard, dialog, safeStorage, type BrowserWindow, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import { engines, HOME, profileThemes, type ArchivedTab, type SavedLogin, type Favorite, type PaneRect, type BrowserState, type Bookmark, type Commands, type Folder, type SitePermission, type TabGroup } from '../../shared/model.js'
import { allowedShortcut, defaultShortcut, shortcutActions, shortcutDefinitions, shortcutOverrides } from '../../shared/shortcuts.js'
import { addressToUrl, originOf, webUrl } from '../../shared/navigation.js'
import type { Database } from './database.js'
import type { FloatingSidebar } from './floatingSidebar.js'
import type { Tabs } from './tabs.js'
import { showExtension } from './extensions.js'
import { detectSources, exportedLinks, passwordRows, readChromium, readImportFile, saveImported } from './importData.js'
import type { Downloads } from './profile.js'

export function browserState(db: Database, tabs: Tabs, downloads: Downloads, window: BrowserWindow): BrowserState {
  const profile = tabs.profileId
  const workspaces = tabs.workspaces()
  return {
    welcomePending: db.get('welcomePending', false),
    windowMaximized: window.isMaximized(),
    passwords: db.all<SavedLogin>('SELECT id, origin, username FROM saved_logins WHERE profileId = ? ORDER BY origin, username', profile),
    workspaceId: tabs.workspaceId, profileId: profile, extensions: downloads.extensions(profile),
    favorites: db.all<Favorite>('SELECT id, url, title, favicon, icon FROM favorites WHERE profileId = ? ORDER BY position, rowid', profile),
    favoritePreviews: Object.fromEntries([...new Set(workspaces.map(space => space.profileId ?? space.id))].map(id => [id, {
      items: db.all<Favorite>('SELECT id, url, title, favicon, icon FROM favorites WHERE profileId = ? ORDER BY position, rowid LIMIT 12', id),
      size: db.settings(id).favoriteSize,
    }])),
    archived: db.all<ArchivedTab>('SELECT id, url, title, archivedAt FROM archived_tabs WHERE workspaceId = ? ORDER BY archivedAt DESC LIMIT 150', tabs.workspaceId), workspaces, tabs: tabs.list().filter(tab => tab.workspaceId === tabs.workspaceId),
    groups: db.all<TabGroup>('SELECT * FROM tab_groups WHERE workspaceId = ? ORDER BY rowid', tabs.workspaceId),
    bookmarks: db.all<Bookmark>('SELECT id, title, url, folderId FROM bookmarks WHERE workspaceId = ? ORDER BY rowid DESC', profile),
    folders: db.all<Folder>('SELECT id, name FROM bookmark_folders WHERE workspaceId = ? ORDER BY name', profile),
    downloads: downloads.list(profile), settings: db.settings(tabs.profileId),
    permissions: db.all<SitePermission>('SELECT origin, permission, allow FROM profile_permissions WHERE workspaceId = ? ORDER BY origin, permission', profile),
  }
}

function text(value: unknown, max = 512): string {
  if (typeof value !== 'string' || value.length > max) throw new Error('Invalid text value.')
  return value.trim()
}

function required(value: unknown, max = 512) {
  const clean = text(value, max)
  if (!clean) throw new Error('Enter a value.')
  return clean
}

function id(value: unknown) {
  const clean = text(value, 36)
  if (!/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(clean)) throw new Error('Invalid item identifier.')
  return clean
}

function choice<T extends string>(value: unknown, options: readonly T[]): T {
  const clean = text(value)
  const match = options.find(option => option === clean)
  if (!match) throw new Error('Invalid option.')
  return match
}

function site(value: unknown) {
  const url = webUrl(required(value, 8192))
  if (!url) throw new Error('Enter an HTTP or HTTPS address.')
  return url
}

function hexColor(value: unknown) {
  const color = text(value, 7).toLowerCase()
  if (!/^#[0-9a-f]{6}$/.test(color)) throw new Error('Enter a six-digit hex color.')
  return color
}

function boolean(value: unknown) {
  if (typeof value !== 'boolean') throw new Error('Invalid boolean value.')
  return value
}

export function bindIpc(
  window: BrowserWindow, uiUrl: string, db: Database, tabs: Tabs,
  downloads: Downloads, changed: () => void, sidebar: FloatingSidebar, nativeSpaceScroll: () => boolean, newWindow: () => void,
) {
  const state = () => browserState(db, tabs, downloads, window)
  const currentTab = (value: unknown) => {
    const tabId = id(value)
    if (!tabs.list().some(tab => tab.id === tabId && tab.workspaceId === tabs.workspaceId)) throw new Error('Tab was not found in this Space.')
    return tabId
  }
  const commands: { [K in keyof Commands]: (...args: unknown[]) => void | Promise<void> } = {
    newWindow,
    home: () => tabs.home(),
    setGradient: (first, end) => {
      const profile = tabs.profileId
      const startColor = hexColor(first), endColor = hexColor(end)
      db.transaction(() => {
        db.setProfileSetting(profile, 'accentColor', startColor)
        db.setProfileSetting(profile, 'accentEnd', endColor)
      })
    },
    newTab: value => { tabs.create(value === undefined ? HOME : addressToUrl(text(value, 8192), db.settings(tabs.profileId).engine)) },
    closeTab: value => tabs.close(currentTab(value)),
    selectTab: value => tabs.select(id(value)),
    saveLogin: async (value, user, password) => {
      const profile = tabs.profileId
      const origin = originOf(site(value))!
      const username = text(user, 256)
      if (typeof password !== 'string' || !password || password.length > 4096) throw new Error('Invalid password.')
      if (process.platform === 'linux' || !await safeStorage.isAsyncEncryptionAvailable()) throw new Error('System encryption is unavailable.')
      const encrypted = (await safeStorage.encryptStringAsync(password)).toString('base64')
      if (window.isDestroyed()) return
      db.run('INSERT INTO saved_logins VALUES (?, ?, ?, ?, ?) ON CONFLICT(profileId, origin, username) DO UPDATE SET encrypted = excluded.encrypted',
        randomUUID(), profile, origin, username, encrypted)
    },
    copyLogin: async value => {
      const profile = tabs.profileId
      const row = db.one<{ encrypted: string }>('SELECT encrypted FROM saved_logins WHERE id = ? AND profileId = ?', id(value), profile)
      if (!row) throw new Error('Password was not found in this Profile.')
      const data = Buffer.from(row.encrypted, 'base64')
      let decrypted = await safeStorage.decryptStringAsync(data)
      if (decrypted.shouldReEncrypt) {
        decrypted = await safeStorage.decryptStringAsync(data)
        const encrypted = (await safeStorage.encryptStringAsync(decrypted.result)).toString('base64')
        if (window.isDestroyed()) return
        db.run('UPDATE saved_logins SET encrypted = ? WHERE id = ? AND profileId = ? AND encrypted = ?', encrypted, id(value), profile, row.encrypted)
      }
      if (!window.isDestroyed() && tabs.profileId === profile) clipboard.writeText(decrypted.result)
    },
    removeLogin: value => { db.run('DELETE FROM saved_logins WHERE id = ? AND profileId = ?', id(value), tabs.profileId) },
    loadExtension: async () => {
      const profile = tabs.profileId
      const result = await dialog.showOpenDialog(window, { title: 'Load unpacked extension', properties: ['openDirectory'] })
      if (!result.canceled && !window.isDestroyed()) await downloads.loadExtension(profile, result.filePaths[0])
    },
    removeExtension: value => downloads.removeExtension(tabs.profileId, required(value, 64)),
    runExtension: value => {
      const session = downloads.sessionFor(tabs.profileId)
      const extension = session.extensions.getExtension(required(value, 64))
      if (extension) showExtension(window, session, extension)
    },
    mediaTab: value => tabs.toggleMedia(id(value)),
    muteTab: value => tabs.mute(id(value)),
    pinTab: value => tabs.pin(currentTab(value)),
    moveTab: (value, target) => tabs.move(currentTab(value), currentTab(target)),
    groupTab: (value, group) => tabs.group(currentTab(value), group === null ? null : id(group)),
    addGroup: (name, parent) => {
      const group = parent === undefined ? null : id(parent)
      if (group && !db.one('SELECT id FROM tab_groups WHERE id = ? AND workspaceId = ?', group, tabs.workspaceId)) throw new Error('Folder was not found.')
      db.run('INSERT INTO tab_groups VALUES (?, ?, ?, ?)', randomUUID(), tabs.workspaceId, required(name, 64), group)
    },
    favorite: value => {
      const tabId = currentTab(value)
      const tab = tabs.list().find(item => item.id === tabId)
      if (!tab || !webUrl(tab.url)) return
      const profile = tabs.profileId
      db.run(`INSERT INTO favorites (profileId, id, url, title, favicon, position)
        VALUES (?, ?, ?, ?, ?, (SELECT COALESCE(MAX(position), 0) + 1 FROM favorites WHERE profileId = ?))
        ON CONFLICT(profileId, url) DO NOTHING`, profile, randomUUID(), tab.url, tab.title, tab.favicon, profile)
    },
    saveFavorite: (value, url, title, icon) => {
      const profile = tabs.profileId
      const address = site(url)
      const name = required(title, 120)
      const glyph = text(icon, 12)
      if (value === null) {
        db.run(`INSERT INTO favorites (profileId, id, url, title, icon, position)
          VALUES (?, ?, ?, ?, ?, (SELECT COALESCE(MAX(position), 0) + 1 FROM favorites WHERE profileId = ?))
          ON CONFLICT(profileId, url) DO UPDATE SET title = excluded.title, icon = excluded.icon`,
          profile, randomUUID(), address, name, glyph, profile)
      } else {
        db.run('UPDATE favorites SET favicon = CASE WHEN url = ? THEN favicon ELSE NULL END, url = ?, title = ?, icon = ? WHERE profileId = ? AND id = ?',
          address, address, name, glyph, profile, required(value, 64))
      }
    },
    moveFavorite: (value, target) => {
      const profile = tabs.profileId
      const source = required(value, 64)
      const destination = target === null ? null : required(target, 64)
      if (source === destination) return
      const sorted = db.all<{ id: string }>('SELECT id FROM favorites WHERE profileId = ? ORDER BY position, rowid', profile).map(item => item.id)
      const from = sorted.indexOf(source)
      const to = destination === null ? sorted.length - 1 : sorted.indexOf(destination)
      if (from < 0 || to < 0) return
      sorted.splice(from, 1)
      sorted.splice(to, 0, source)
      db.transaction(() => sorted.forEach((id, index) => db.run('UPDATE favorites SET position = ? WHERE profileId = ? AND id = ?', index, profile, id)))
    },
    removeFavorite: value => { db.run('DELETE FROM favorites WHERE profileId = ? AND id = ?', tabs.profileId, required(value, 64)) },
    openFavorite: value => {
      const item = db.one<Favorite>('SELECT id, url, title, favicon, icon FROM favorites WHERE profileId = ? AND id = ?', tabs.profileId, required(value, 64))
      if (!item) return
      const existing = tabs.list().find(tab => tab.workspaceId === tabs.workspaceId && tab.url === item.url)
      if (existing) tabs.select(existing.id)
      else tabs.create(item.url)
    },
    archiveTabs: () => tabs.archive(),
    restoreArchived: value => {
      const item = db.one<ArchivedTab>('SELECT * FROM archived_tabs WHERE id = ? AND workspaceId = ?', id(value), tabs.workspaceId)
      if (!item) return
      tabs.create(item.url)
      db.run('DELETE FROM archived_tabs WHERE id = ?', item.id)
    },
    removeGroup: group => {
      const key = id(group)
      if (db.one('SELECT id FROM tab_groups WHERE id = ? AND workspaceId = ?', key, tabs.workspaceId)) tabs.removeGroup(key)
    },
    navigate: (value, input) => tabs.navigate(currentTab(value), addressToUrl(text(input, 8192), db.settings(tabs.profileId).engine)),
    pageAction: (value, action) => tabs.action(currentTab(value), choice(action, ['back', 'forward', 'reload', 'stop', 'home'])),
    reopenTab: () => tabs.reopen(),
    nextTab: reverse => tabs.next(reverse === undefined ? false : boolean(reverse)),
    workspace: value => tabs.switchWorkspace(id(value)),
    saveWorkspace: (value, name, accent, profile, icon) => {
      const label = required(name, 48)
      const color = hexColor(accent)
      const glyph = icon === undefined ? '' : text(icon, 12)
      if (value === null) {
        const storage = profile === undefined || profile === null ? null : id(profile)
        if (storage && !db.one('SELECT id FROM workspaces WHERE id = ? AND profileId IS NULL', storage)) throw new Error('Profile was not found.')
        const newId = randomUUID()
        db.transaction(() => db.addWorkspace(newId, label, color, storage, glyph))
        tabs.switchWorkspace(newId)
      } else db.run('UPDATE workspaces SET name = ?, accent = ?, icon = ? WHERE id = ? AND id = ?', label, color, glyph, id(value), tabs.workspaceId)
    },
    saveBookmark: (value, title, url, folder) => {
      const profile = tabs.profileId
      const label = required(title)
      const href = site(url)
      const parent = folder === null ? null : id(folder)
      if (parent && !db.one('SELECT id FROM bookmark_folders WHERE id = ? AND workspaceId = ?', parent, profile)) throw new Error('The bookmark folder no longer exists.')
      if (value === null) db.run('INSERT INTO bookmarks VALUES (?, ?, ?, ?, ?)', randomUUID(), label, href, parent, profile)
      else db.run('UPDATE bookmarks SET title = ?, url = ?, folderId = ? WHERE id = ? AND workspaceId = ?', label, href, parent, id(value), profile)
    },
    deleteBookmark: value => { db.run('DELETE FROM bookmarks WHERE id = ? AND workspaceId = ?', id(value), tabs.profileId) },
    addFolder: name => { db.run('INSERT INTO bookmark_folders VALUES (?, ?, ?)', randomUUID(), required(name, 64), tabs.profileId) },
    deleteFolder: value => { db.run('DELETE FROM bookmark_folders WHERE id = ? AND workspaceId = ?', id(value), tabs.profileId) },
    deleteVisit: value => { db.run('DELETE FROM history WHERE id = ? AND workspaceId = ?', id(value), tabs.profileId) },
    download: (value, action) => downloads.action(tabs.profileId, id(value), choice(action, ['open', 'reveal', 'cancel'])),
    setSetting: (key, value) => {
      const profile = tabs.profileId
      switch (key) {
        case 'engine': db.setProfileSetting(profile, key, choice(value, Object.keys(engines))); break
        case 'startup': db.setProfileSetting(profile, key, choice(value, ['restore', 'home', 'blank'])); break
        case 'theme': db.setProfileSetting(profile, key, choice(value, Object.keys(profileThemes))); break
        case 'background': db.setProfileSetting(profile, key, choice(value, ['violet', 'forest', 'midnight', 'black', 'match'])); break
        case 'accentEnd':
        case 'accentColor': db.setProfileSetting(profile, key, value === '' ? '' : hexColor(value)); break
        case 'colorIntensity': db.setProfileSetting(profile, key, choice(value, ['subtle', 'balanced', 'vivid'])); break
        case 'sidebarWidth': {
          const width = Number(text(value, 3))
          if (!Number.isInteger(width) || width < 242 || width > 360) throw new Error('Invalid sidebar width.')
          db.set(key, String(width))
          break
        }
        case 'homepage': {
          const input = text(value, 8192)
          const normalized = !input || input === HOME ? HOME : site(/^[a-z][a-z\d+.-]*:\/\//i.test(input) ? input : 'https://' + input)
          db.setProfileSetting(profile, key, normalized)
          break
        }
        case 'downloadPath':
          if (value !== '') throw new Error('Use the folder picker to set a download location.')
          db.setProfileSetting(profile, key, '')
          break
        case 'archiveHours': db.setProfileSetting(profile, key, choice(value, ['0', '12', '24', '72', '168'])); break
        case 'favoriteSize': db.setProfileSetting(profile, key, choice(value, ['small', 'medium', 'large'])); break
        case 'notificationPolicy': db.setProfileSetting(profile, key, choice(value, ['approved', 'block'])); break
        case 'homeDensity': db.setProfileSetting(profile, key, choice(value, ['relaxed', 'compact'])); break
        case 'motion': db.setProfileSetting(profile, key, choice(value, ['system', 'off'])); break
        case 'sidebarDismiss': db.setProfileSetting(profile, key, choice(value, ['quick', 'balanced', 'relaxed'])); break
        case 'homeRecent':
        case 'homeClock':
        case 'homeSuggestions':
        case 'topToolbar': db.setProfileSetting(profile, key, boolean(value)); break
        case 'keepSidebarOpen': db.set(key, boolean(value)); break
        case 'javascript':
          if (boolean(value) !== db.settings(profile).javascript) {
            db.setProfileSetting(profile, key, boolean(value))
            tabs.resetRenderers(profile)
          }
          break
        default: throw new Error('Unknown setting.')
      }
    },
    chooseDownloadPath: async () => {
      const profile = tabs.profileId
      const result = await dialog.showOpenDialog(window, { properties: ['openDirectory', 'createDirectory'], defaultPath: db.settings(profile).downloadPath || app.getPath('downloads') })
      if (!result.canceled && !window.isDestroyed()) db.setProfileSetting(profile, 'downloadPath', result.filePaths[0])
    },
    clearData: async kind => {
      const id = tabs.profileId
      const profile = downloads.sessionFor(id)
      switch (choice(kind, ['history', 'cookies', 'cache', 'storage'])) {
        case 'history': db.run('DELETE FROM history WHERE workspaceId = ?', id); break
        case 'cookies': await profile.clearStorageData({ storages: ['cookies'] }); break
        case 'cache': await profile.clearCache(); break
        case 'storage':
          await profile.clearData()
          tabs.resetRenderers(id)
          break
      }
    },
    setPermission: (value, key, mode) => {
      const origin = originOf(site(value))
      if (!origin?.startsWith('https://')) throw new Error('Site permissions require an HTTPS origin.')
      const permission = choice(key, ['camera', 'microphone', 'notifications'])
      const rule = choice(mode, ['allow', 'block', 'reset'])
      if (rule === 'reset') db.run('DELETE FROM profile_permissions WHERE workspaceId = ? AND origin = ? AND permission = ?', tabs.profileId, origin, permission)
      else db.run('INSERT INTO profile_permissions VALUES (?, ?, ?, ?) ON CONFLICT(workspaceId, origin, permission) DO UPDATE SET allow = excluded.allow', tabs.profileId, origin, permission, Number(rule === 'allow'))
    },
    removeCookie: async (domain, path, name, secure) => {
      const profile = downloads.sessionFor(tabs.profileId)
      const host = required(domain, 253).replace(/^\./, '')
      const location = required(path, 4096)
      const url = new URL((boolean(secure) ? 'https://' : 'http://') + host)
      if (url.hostname !== host || !location.startsWith('/')) throw new Error('Invalid cookie scope.')
      url.pathname = location
      await profile.cookies.remove(url.href, text(name, 4096))
      await profile.cookies.flushStore()
    },
    setShortcut: (value, binding) => {
      const action = choice(value, shortcutActions)
      const profile = tabs.profileId
      const platform = process.platform
      const overrides = shortcutOverrides(db.settings(profile).keyboardShortcuts, platform)
      const fallback = defaultShortcut(action, platform)
      const next = binding === null ? fallback : text(binding, 7)
      if (!allowedShortcut(next, platform)) throw new Error('That key combination is reserved or unsupported.')
      const conflict = shortcutActions.find(item => item !== action && (overrides[item] ?? defaultShortcut(item, platform)) === next)
      if (conflict) throw new Error('That shortcut is already used for ' + shortcutDefinitions[conflict].label.toLowerCase() + '.')
      if (next === fallback) delete overrides[action]
      else overrides[action] = next
      db.setProfileSetting(profile, 'keyboardShortcuts', JSON.stringify(overrides))
    },
    finishWelcome: () => { db.set('welcomePending', false) },
    windowAction: action => {
      switch (choice(action, ['minimize', 'toggleMaximize', 'close'])) {
        case 'minimize': window.minimize(); break
        case 'toggleMaximize': if (window.isMaximized()) window.unmaximize(); else window.maximize(); break
        case 'close': window.close(); break
      }
    },
  }
  const trusted = (event: IpcMainEvent | IpcMainInvokeEvent) =>
    !window.isDestroyed() && event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame &&
    event.senderFrame?.url === uiUrl
  const ipc = window.webContents.ipc
  const invoke = (channel: string, handler: (...args: unknown[]) => unknown) => {
    ipc.handle(channel, (event, ...args: unknown[]) => {
      if (!trusted(event)) throw new Error('Unauthorized sender.')
      return handler(...args)
    })
  }
  invoke('lexn:state', state)
  invoke('lexn:uses-native-space-scroll', nativeSpaceScroll)
  invoke('lexn:history', query => db.history(text(query), tabs.profileId))
  invoke('lexn:frequent', () => db.frequent(tabs.profileId))
  invoke('lexn:import-sources', async () => (await detectSources()).map(({ id, label }) => ({ id, label })))
  invoke('lexn:import-browser', async (value, selected) => {
    const kind = choice(value, ['browser', 'folder', 'bookmarks', 'passwords'])
    const profile = tabs.profileId
    let path: string
    if (kind === 'browser') {
      const sourceId = text(selected, 256)
      const source = (await detectSources()).find(item => item.id === sourceId)
      if (!source) throw new Error('That browser Profile is unavailable.')
      path = source.path
    } else {
      const result = await dialog.showOpenDialog(window, {
        properties: [kind === 'folder' ? 'openDirectory' : 'openFile'],
        filters: kind === 'bookmarks' ? [{ name: 'Browser exports', extensions: ['html', 'htm', 'md'] }]
          : kind === 'passwords' ? [{ name: 'Passwords CSV', extensions: ['csv'] }] : undefined,
      })
      if (result.canceled || !result.filePaths[0]) return null
      path = result.filePaths[0]
    }
    if (kind === 'passwords') {
      if (!await safeStorage.isAsyncEncryptionAvailable()) throw new Error('System encryption is unavailable.')
      const rows = passwordRows(await readImportFile(path))
      const logins: { origin: string; username: string; encrypted: string }[] = []
      for (const { origin, username, password } of rows) {
        if (window.isDestroyed()) return null
        if (db.one('SELECT id FROM saved_logins WHERE profileId = ? AND origin = ? AND username = ?', profile, origin, username)) continue
        logins.push({ origin, username, encrypted: (await safeStorage.encryptStringAsync(password)).toString('base64') })
      }
      if (window.isDestroyed()) return null
      const passwords = db.transaction(() => logins.reduce((count, row) => count + Number(db.run(
        'INSERT INTO saved_logins VALUES (?, ?, ?, ?, ?) ON CONFLICT(profileId, origin, username) DO NOTHING',
        randomUUID(), profile, row.origin, row.username, row.encrypted,
      ).changes), 0))
      changed()
      return { bookmarks: 0, visits: 0, passwords, notes: [] }
    }
    const imported = kind === 'bookmarks'
      ? { links: exportedLinks(await readImportFile(path), /\.md$/i.test(path)), history: [], notes: [] }
      : await readChromium(path)
    if (window.isDestroyed()) return null
    const saved = saveImported(db, profile, imported.links, imported.history)
    changed()
    return { ...saved, passwords: 0, notes: imported.notes }
  })
  invoke('lexn:cookies', async () => (await downloads.sessionFor(tabs.profileId).cookies.get({})).map(({ name, domain, path, secure }) => ({
    name, domain: domain ?? '', path: path ?? '/', secure,
  })))
  invoke('lexn:command', async (name, args) => {
    if (typeof name !== 'string' || !Object.hasOwn(commands, name) || !Array.isArray(args) || args.length > 5) throw new Error('Unknown command.')
    await commands[name as keyof Commands](...args)
    changed()
  })
  const layout = (event: IpcMainEvent, value: unknown) => {
    if (!trusted(event)) return
    const [w, h] = window.getContentSize()
    const rect = (raw: unknown) => {
      if (typeof raw !== 'object' || !raw) return null
      const { x, y, width, height } = raw as Record<string, unknown>
      if (typeof x !== 'number' || typeof y !== 'number' || typeof width !== 'number' || typeof height !== 'number' ||
          ![x, y, width, height].every(Number.isSafeInteger) || x < 0 || y < 0 || x >= w || y >= h || width <= 0 || height <= 0) return null
      return { x, y, width: Math.min(w - x, width), height: Math.min(h - y, height) }
    }
    if (Array.isArray(value)) {
      if (value.length > 4) return
      const panes: PaneRect[] = []
      for (const item of value) {
        const bounds = rect(item)
        if (bounds && typeof item.id === 'string') panes.push({ ...bounds, id: item.id })
      }
      tabs.layout(panes)
    } else tabs.layout(rect(value))
  }
  ipc.on('lexn:layout', layout)
  const layoutSidebar = (event: IpcMainEvent, width: unknown, open: unknown, animate: unknown) => {
    if (!trusted(event) || typeof width !== 'number' || !Number.isInteger(width) ||
        (width !== 0 && (width < 242 || width > 360)) || typeof open !== 'boolean' || typeof animate !== 'boolean') return
    sidebar.layout(width, open, animate)
  }
  ipc.on('lexn:sidebar-layout', layoutSidebar)
}
