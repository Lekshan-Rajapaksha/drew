import { writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { app, dialog, powerMonitor, shell, type BrowserWindow, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import { engines, HOME, profileThemes, type ArchivedTab, type SavedLogin, type SavedTab, type Favorite, type PaneRect, type BrowserState, type Bookmark, type Commands, type Folder, type SitePermission, type TabGroup, type Tab } from '../../shared/model.js'
import { allowedShortcut, defaultShortcut, shortcutActions, shortcutDefinitions, shortcutOverrides } from '../../shared/shortcuts.js'
import { addressToUrl, originOf, webUrl } from '../../shared/navigation.js'
import type { Database } from './database.js'
import type { FloatingSidebar } from './floatingSidebar.js'
import type { Tabs } from './tabs.js'
import { showExtension } from './extensions.js'
import { detectSources, exportedLinks, readChromium, readImportFile, saveImported, scanChromiumProfiles } from './importData.js'
import { chromiumProfile, markdownProfiles, saveBrowserProfiles } from './profileImport.js'
import { copyPassword, importPasswords, savePassword } from './vault.js'
import type { Downloads } from './profile.js'
import { checkForDrewUpdates } from './updates.js'

export function browserState(db: Database, tabs: Tabs, downloads: Downloads, window: BrowserWindow, otherWindowTabs: Tab[]): BrowserState {
  const profile = tabs.profileId
  const workspaces = tabs.workspaces()
  const localTabs = tabs.list()
  const groups = db.all<TabGroup>('SELECT * FROM tab_groups ORDER BY rowid')
  const previews = new Map(workspaces.map(space => space.profileId ?? space.id).map(id => {
    const { favoriteSize: size, theme, accentColor, accentEnd, topToolbar, keyboardShortcuts } = db.settings(id)
    return [id, { size, settings: { theme, accentColor, accentEnd, topToolbar, keyboardShortcuts },
      favorites: db.all<Favorite>('SELECT id, url, title, favicon, icon FROM favorites WHERE profileId = ? ORDER BY position, rowid LIMIT 12', id) }] as const
  }))
  const batterySaver = db.settings(profile).batterySaver
  return {
    privateWindow: downloads.privateWindow,
    batterySaving: batterySaver === 'on' || (batterySaver === 'battery' && powerMonitor.onBatteryPower),
    appVersion: app.getVersion(),
    welcomePending: db.get('welcomePending', false),
    windowMaximized: window.isMaximized(),
    passwords: db.all<SavedLogin>('SELECT id, origin, username FROM saved_logins WHERE profileId = ? ORDER BY origin, username', profile),
    workspaceId: tabs.workspaceId, profileId: profile, extensions: downloads.extensions(profile),
    favorites: db.all<Favorite>('SELECT id, url, title, favicon, icon FROM favorites WHERE profileId = ? ORDER BY position, rowid', profile),
    sidebarPreviews: Object.fromEntries(workspaces.filter(space => space.id !== tabs.workspaceId).map(space => [space.id, {
      ...previews.get(space.profileId ?? space.id)!,
      tabs: localTabs.filter(tab => tab.workspaceId === space.id).slice(0, 20),
      groups: groups.filter(group => group.workspaceId === space.id),
    }])),
    otherWindowTabs,
    canUndoClear: tabs.canUndoClear, split: tabs.split, workspaces, tabs: localTabs.filter(tab => tab.workspaceId === tabs.workspaceId),
    groups: groups.filter(group => group.workspaceId === tabs.workspaceId),
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
  downloads: Downloads, changed: () => void, sidebar: FloatingSidebar, nativeSpaceScroll: () => boolean, newWindow: () => void, newPrivateWindow: () => void, moveToNewWindow: (id: string) => Promise<void>,
  peerTabs: () => Tab[], focusWindowTab: (tabId: string) => void,
  registerImported: (tabs: SavedTab[]) => void,
  resetProfile: (profile: string) => void,
  clearProfileStorage: (profile: string, clear: () => Promise<void>) => Promise<void>,
) {
  const state = () => browserState(db, tabs, downloads, window, peerTabs())
  const currentTab = (value: unknown) => {
    const tabId = id(value)
    if (!tabs.list().some(tab => tab.id === tabId && tab.workspaceId === tabs.workspaceId)) throw new Error('Tab was not found in this Space.')
    return tabId
  }
  const commands: { [K in keyof Commands]: (...args: unknown[]) => void | Promise<void> } = {
    newWindow,
    newPrivateWindow,
    moveToWindow: value => moveToNewWindow(currentTab(value)),
    moveToSpace: (tab, space) => tabs.moveToSpace(currentTab(tab), id(space)),
    exportWorkspace: async () => {
      if (downloads.privateWindow) throw new Error('Workspace export is unavailable in private windows.')
      const escape = (text: string) => text.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!)
      const links = (items: { title: string; url: string }[]) => items.flatMap(({ title, url }) =>
        webUrl(url) ? ['<DT><A HREF="' + escape(url) + '">' + escape(title) + '</A>'] : []).join('\n')
      const space = tabs.workspaces().find(item => item.id === tabs.workspaceId)!
      const profile = tabs.profileId
      const sections = [
        ['Bookmarks', db.all<Bookmark>('SELECT title, url FROM bookmarks WHERE workspaceId = ?', profile)],
        ['Favorites', db.all<Favorite>('SELECT title, url FROM favorites WHERE profileId = ? ORDER BY position', profile)],
        ['Pinned tabs', tabs.list().filter(tab => tab.workspaceId === space.id && tab.pinned)],
        ['Open tabs', tabs.list().filter(tab => tab.workspaceId === space.id && !tab.pinned)],
      ] as const
      const { canceled, filePath } = await dialog.showSaveDialog(window, { defaultPath: 'Drew workspace.html', filters: [{ name: 'Bookmarks HTML', extensions: ['html'] }] })
      if (canceled || !filePath) return
      const body = sections.map(([name, items]) => '<DT><H3>' + name + '</H3>\n<DL><p>\n' + links([...items]) + '\n</DL><p>').join('\n')
      await writeFile(filePath, '<!DOCTYPE NETSCAPE-Bookmark-file-1>\n<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">\n<TITLE>' +
        escape(space.name) + '</TITLE>\n<H1>' + escape(space.name) + '</H1>\n<DL><p>\n' + body + '\n</DL><p>\n', { mode: 0o600 })
    },
    checkForUpdates: () => checkForDrewUpdates(),
    defaultBrowser: async () => {
      if (!app.isPackaged) throw new Error('Install Drew before setting it as your default browser.')
      if (process.platform === 'win32') await shell.openExternal('ms-settings:defaultapps')
      else if (process.platform === 'darwin') {
        app.setAsDefaultProtocolClient('http')
        app.setAsDefaultProtocolClient('https')
      } else throw new Error('Use your system settings to choose the default browser.')
    },
    findPage: (query, direction) => tabs.find(text(query, 512), direction === undefined ? undefined : choice(direction, ['next', 'previous'] as const)),
    pageZoom: direction => tabs.zoom(choice(direction, ['in', 'out', 'reset'])),
    printPage: () => tabs.print(),
    savePagePdf: () => tabs.savePdf(),
    sleepTab: value => {
      if (!tabs.sleep(currentTab(value))) throw new Error('This tab is active, still loading, or needs to stay awake.')
    },
    siteInfo: async () => {
      const tab = tabs.active()?.state
      const origin = tab && originOf(tab.url)
      if (!origin) return
      await dialog.showMessageBox(window, {
        type: origin.startsWith('https:') && !tab.error ? 'info' : 'warning',
        message: origin,
        detail: tab.error ? 'The page failed to load.' : origin.startsWith('https:') ? 'Connection uses HTTPS.' : 'Connection is unencrypted HTTP.',
      })
    },
    home: () => tabs.home(),
    setNavigationLayout: value => {
      const layout = choice(value, ['sidebar', 'compact', 'top'])
      const profile = tabs.profileId
      db.transaction(() => {
        db.setProfileSetting(profile, 'topToolbar', layout === 'top')
        db.setProfileSetting(profile, 'sidebarStyle', layout === 'compact' ? 'compact' : 'full')
      })
    },
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
    focusWindowTab: value => focusWindowTab(id(value)),
    saveLogin: async (value, user, password) => {
      const profile = tabs.profileId
      const origin = originOf(site(value))!
      if (typeof user !== 'string' || user.length > 256 || user.includes('\0')) throw new Error('Invalid username.')
      if (typeof password !== 'string' || !password || password.length > 4096 || password.includes('\0')) throw new Error('Invalid password.')
      await savePassword(db, { profile, origin, username: user }, password, () => !window.isDestroyed())
    },
    copyLogin: async value => {
      const profile = tabs.profileId
      await copyPassword(db, profile, id(value), () => !window.isDestroyed() && window.isFocused() && tabs.profileId === profile)
    },
    fillLogin: () => tabs.fillLogin(),
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
    restoreArchived: value => tabs.restoreArchive([id(value)]),
    restoreArchivedTabs: values => {
      if (!Array.isArray(values) || values.length > 200) throw new Error('Select up to 200 archived tabs.')
      tabs.restoreArchive([...new Set(values.map(id))])
    },
    undoClear: () => tabs.undoClear(),
    setSplit: (space, values) => {
      if (!Array.isArray(values) || values.length > 4) throw new Error('Invalid split layout.')
      const panes = values.map(value => {
        if (!value || typeof value !== 'object') throw new Error('Invalid split pane.')
        const { weight } = value
        if (typeof weight !== 'number' || !Number.isFinite(weight) || weight <= 0 || weight > 50) throw new Error('Invalid split weight.')
        return { id: id(value.id), weight }
      })
      if (new Set(panes.map(pane => pane.id)).size !== panes.length) throw new Error('Duplicate split pane.')
      const spaceId = id(space)
      if (spaceId !== tabs.workspaceId) return
      for (const pane of panes) currentTab(pane.id)
      tabs.setSplit(spaceId, panes)
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
    download: (value, action) => downloads.action(tabs.profileId, id(value), choice(action, ['open', 'reveal', 'cancel', 'pause', 'resume', 'retry']), window),
    setSetting: (key, value) => {
      const profile = tabs.profileId
      switch (key) {
        case 'engine': db.setProfileSetting(profile, key, choice(value, Object.keys(engines))); break
        case 'startup': db.setProfileSetting(profile, key, choice(value, ['restore', 'home', 'blank'])); break
        case 'theme': db.setProfileSetting(profile, key, choice(value, Object.keys(profileThemes))); break
        case 'background': db.setProfileSetting(profile, key, choice(value, ['violet', 'forest', 'midnight', 'black', 'match'])); break
        case 'sidebarStyle': db.setProfileSetting(profile, key, choice(value, ['full', 'compact'])); break
        case 'topTabs': db.setProfileSetting(profile, key, choice(value, ['above', 'below', 'hidden'])); break
        case 'topActions': db.setProfileSetting(profile, key, choice(value, ['full', 'minimal'])); break
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
        case 'linkHosts': {
          if (downloads.privateWindow) throw new Error('Link routing is unavailable in private windows.')
          const hosts = [...new Set(text(value, 1024).split(/[,\s]+/).filter(Boolean).map(host => {
            if (!/^[\p{L}\p{N}.-]+$/u.test(host) || !host.includes('.')) throw new Error('Enter website hostnames such as example.com.')
            return new URL('https://' + host).hostname
          }))]
          for (const record of tabs.workspaces()) {
            if (!record.profileId && record.id !== profile &&
                db.settings(record.id).linkHosts.split(',').some(host => hosts.includes(host))) {
              throw new Error('A different Profile already routes one of these hostnames.')
            }
          }
          db.setProfileSetting(profile, key, hosts.join(','))
          break
        }
        case 'memorySaver': db.setProfileSetting(profile, key, choice(value, ['off', '15', '30', '60'])); break
        case 'batterySaver': db.setProfileSetting(profile, key, choice(value, ['off', 'on', 'battery'])); break
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
            resetProfile(profile)
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
        case 'storage': await clearProfileStorage(id, () => profile.clearData()); break
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
  invoke('lexn:archive', (query, offset) => {
    if (typeof offset !== 'number' || !Number.isSafeInteger(offset) || offset < 0) throw new Error('Invalid archive offset.')
    const pattern = '%' + text(query).replace(/[\\%_]/g, '\\$&') + '%'
    return db.all<ArchivedTab>(`SELECT id, url, title, archivedAt FROM archived_tabs
      WHERE workspaceId = ? AND (title LIKE ? ESCAPE '\\' OR url LIKE ? ESCAPE '\\')
      ORDER BY archivedAt DESC, id DESC LIMIT 100 OFFSET ?`, tabs.workspaceId, pattern, pattern, offset)
  })
  invoke('lexn:frequent', () => db.frequent(tabs.profileId))
  invoke('lexn:import-sources', async () => (await detectSources()).map(({ id, label, browser }) => ({ id, label, browser })))
  invoke('lexn:import-browser', async (value, selected, review) => {
    if (downloads.privateWindow) throw new Error('Import is unavailable in private windows.')
    const kind = choice(value, ['browser', 'folder', 'bookmarks', 'passwords', 'profiles', 'profile-folder', 'profile-markdown'])
    const profile = kind === 'passwords' && selected !== undefined ? id(selected) : tabs.profileId
    const passwordProfile = kind === 'passwords' ? db.one<{ name: string }>('SELECT name FROM workspaces WHERE id = ? AND profileId IS NULL', profile) : undefined
    if (kind === 'passwords' && !passwordProfile) {
      throw new Error('Choose a Drew Profile for these passwords.')
    }
    const brand = () => choice(selected, ['Chrome', 'Arc', 'Dia', 'Ardia', 'Opera', 'Opera GX', 'Edge', 'Brave', 'Vivaldi', 'Chromium'] as const)
    const confirmImport = async (detail: string) => {
      if (window.isDestroyed()) return false
      if (review !== true) return true
      const { response } = await dialog.showMessageBox(window, {
        title: 'Drew import', type: 'question', message: 'Review browser data before importing',
        detail, buttons: ['Import', 'Cancel'], defaultId: 0, cancelId: 1, noLink: true,
      })
      return response === 0 && !window.isDestroyed()
    }
    const saveProfiles = async (profiles: Parameters<typeof saveBrowserProfiles>[1]) => {
      const summary = profiles.slice(0, 12).map(source => {
        const saved = db.get('browser-import:' + source.key, '')
        const destination = db.one<{ name: string }>('SELECT name FROM workspaces WHERE id = ? AND profileId IS NULL', saved)?.name
        return (destination ? destination + ' (existing Profile)' : source.name + ' (new Profile)') + '\n' +
          source.bookmarks.length + ' bookmarks, ' + source.history.length + ' history entries, ' +
          source.favorites.length + ' Favorites, ' + source.pinned.length + ' pinned tabs, ' + source.tabs.length + ' open tabs'
      }).join('\n\n')
      if (!await confirmImport(summary + (profiles.length > 12 ? '\n\nAdditional Profiles: ' + (profiles.length - 12) : '') +
          '\n\nDuplicates are skipped. Passwords are imported separately.')) return null
      const { results, createdTabs } = saveBrowserProfiles(db, profiles)
      registerImported(createdTabs)
      changed()
      return results
    }
    if (kind === 'profiles') {
      const browser = brand()
      const sources = (await detectSources()).filter(source => source.browser === browser)
      if (!sources.length) throw new Error('No local Profiles were found for this browser.')
      return saveProfiles(await Promise.all(sources.map(chromiumProfile)))
    }
    let path: string
    if (kind === 'browser') {
      const sourceId = text(selected, 256)
      const source = (await detectSources()).find(item => item.id === sourceId)
      if (!source) throw new Error('That browser Profile is unavailable.')
      path = source.path
    } else {
      const result = await dialog.showOpenDialog(window, {
        title: passwordProfile ? 'Choose password CSV for ' + passwordProfile.name : undefined,
        properties: [kind === 'folder' || kind === 'profile-folder' ? 'openDirectory' : 'openFile'],
        filters: kind === 'bookmarks' ? [{ name: 'Browser exports', extensions: ['html', 'htm', 'md'] }]
          : kind === 'profile-markdown' ? [{ name: 'Profile or Space export', extensions: ['md'] }]
          : kind === 'passwords' ? [{ name: 'Passwords CSV', extensions: ['csv'] }] : undefined,
      })
      if (result.canceled || !result.filePaths[0]) return null
      path = result.filePaths[0]
    }
    if (kind === 'profile-folder') {
      const sources = await scanChromiumProfiles(path, brand())
      if (!sources.length) throw new Error('Choose a Chromium Profile folder or its User Data folder.')
      return saveProfiles(await Promise.all(sources.map(chromiumProfile)))
    }
    if (kind === 'profile-markdown') {
      const profiles = markdownProfiles(await readImportFile(path), brand())
      if (!profiles.length) throw new Error('No Profiles, Spaces, or web links were found in this export.')
      return saveProfiles(profiles)
    }
    if (kind === 'passwords') {
      const imported = await importPasswords(db, profile, path, () => !window.isDestroyed())
      if (!imported) return null
      changed()
      return { bookmarks: 0, visits: 0, ...imported }
    }
    const imported = kind === 'bookmarks'
      ? { links: exportedLinks(await readImportFile(path), /\.md$/i.test(path)), history: [], notes: [] }
      : await readChromium(path)
    const target = db.one<{ name: string }>('SELECT name FROM workspaces WHERE id = ?', profile)?.name ?? 'Current Profile'
    if (!await confirmImport(target + '\n' + imported.links.length + ' bookmark links, ' + imported.history.length +
        ' history entries. Duplicates are skipped.')) return null
    const saved = saveImported(db, profile, imported.links, imported.history)
    changed()
    return { ...saved, passwords: 0, notes: imported.notes }
  })
  invoke('lexn:cookies', async () => (await downloads.sessionFor(tabs.profileId).cookies.get({})).map(({ name, domain, path, secure }) => ({
    name, domain: domain ?? '', path: path ?? '/', secure,
  })))
  invoke('lexn:command', async (name, args) => {
    if (typeof name !== 'string' || !Object.hasOwn(commands, name) || !Array.isArray(args) || args.length > 5) throw new Error('Unknown command.')
    if (downloads.privateWindow && ['saveLogin', 'loadExtension', 'checkForUpdates', 'defaultBrowser'].includes(name)) {
      throw new Error('This action is unavailable in private windows.')
    }
    await commands[name as keyof Commands](...args)
    if (!['findPage', 'pageZoom', 'printPage', 'siteInfo', 'sleepTab', 'savePagePdf'].includes(name)) changed()
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
        (width !== 0 && width !== 76 && (width < 242 || width > 360)) || typeof open !== 'boolean' || typeof animate !== 'boolean') return
    sidebar.layout(width, open, animate)
  }
  ipc.on('lexn:sidebar-layout', layoutSidebar)
}
