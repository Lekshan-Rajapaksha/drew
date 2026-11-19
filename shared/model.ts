export const HOME = 'about:blank'
export const accents = ['#b5a2ff', '#72e3ba', '#80baff', '#f9b97b', '#fc91b5', '#6de5ef', '#ff8c82', '#dcc576'] as const
export const engines = {
  google: 'https://www.google.com/search?q=',
  duckduckgo: 'https://duckduckgo.com/?q=',
  bing: 'https://www.bing.com/search?q=',
} as const

export interface Settings {
  engine: keyof typeof engines
  homepage: string
  startup: 'restore' | 'home' | 'blank'
  theme: 'dark' | 'light' | 'system'
  background: 'violet' | 'forest' | 'midnight'
  downloadPath: string
  topToolbar: boolean
  keepSidebarOpen: boolean
  archiveHours: string
  javascript: boolean
}
export const defaultSettings: Settings = {
  engine: 'google', homepage: HOME, startup: 'restore', theme: 'dark',
  background: 'violet', downloadPath: '', topToolbar: false, keepSidebarOpen: false, archiveHours: '24', javascript: true,
}
export interface Workspace { id: string; name: string; accent: string; activeTab: string | null; profileId: string | null; icon: string }
export interface TabGroup { id: string; workspaceId: string; name: string; parentId: string | null }
export interface SavedTab {
  id: string; workspaceId: string; url: string; title: string; favicon: string | null
  pinned: 0 | 1; lastUsed: number; groupId: string | null; position: number
}
export interface Tab extends SavedTab {
  audible: boolean; muted: boolean; media: boolean; playing: boolean; loading: boolean; back: boolean; forward: boolean; error: string | null
}
export interface Bookmark { id: string; title: string; url: string; folderId: string | null }
export interface Folder { id: string; name: string }
export interface Visit { id: string; url: string; title: string; visitedAt: number; visits?: number }
export interface Download {
  id: string; name: string; path: string; url: string; received: number; total: number
  state: 'progressing' | 'completed' | 'cancelled' | 'interrupted'; createdAt: number
}
export type Permission = 'camera' | 'microphone' | 'notifications'
export interface SitePermission { origin: string; permission: Permission; allow: 0 | 1 }
export interface SiteCookie { name: string; domain: string; path: string; secure: boolean }
export interface Favorite { id: string; url: string; title: string; favicon: string | null }
export interface ArchivedTab { id: string; url: string; title: string; archivedAt: number }
export interface ViewRect { x: number; y: number; width: number; height: number }
export interface PaneRect extends ViewRect { id: string }

export interface ProfileExtension { id: string; name: string; version: string; popup: boolean }
export interface SavedLogin { id: string; origin: string; username: string }
export interface BrowserState {
  passwords: SavedLogin[];
  extensions: ProfileExtension[];
  favorites: Favorite[]; archived: ArchivedTab[];
  workspaceId: string; workspaces: Workspace[]; tabs: Tab[]; groups: TabGroup[];
  bookmarks: Bookmark[]; folders: Folder[]; downloads: Download[];
  settings: Settings; permissions: SitePermission[];
}
export interface Commands {
  newTab: [url?: string]
  closeTab: [id: string]
  selectTab: [id: string]
  saveLogin: [url: string, username: string, password: string]
  copyLogin: [id: string]
  removeLogin: [id: string]
  loadExtension: []
  removeExtension: [id: string]
  runExtension: [id: string]
  muteTab: [id: string]
  mediaTab: [id: string]
  pinTab: [id: string]
  moveTab: [id: string, target: string]
  groupTab: [id: string, group: string | null]
  addGroup: [name: string, parentId?: string]
  favorite: [tabId: string]
  removeFavorite: [id: string]
  openFavorite: [id: string]
  archiveTabs: []
  restoreArchived: [id: string]
  removeGroup: [id: string]
  navigate: [id: string, input: string]
  pageAction: [id: string, action: 'back' | 'forward' | 'reload' | 'stop' | 'home']
  reopenTab: []
  nextTab: [reverse?: boolean]
  workspace: [id: string]
  saveWorkspace: [id: string | null, name: string, accent: string, profileId?: string | null, icon?: string]
  saveBookmark: [id: string | null, title: string, url: string, folder: string | null]
  deleteBookmark: [id: string]
  addFolder: [name: string]
  deleteFolder: [id: string]
  deleteVisit: [id: string]
  download: [id: string, action: 'cancel' | 'open' | 'reveal']
  setSetting: [key: keyof Settings, value: string | boolean]
  chooseDownloadPath: []
  clearData: [kind: 'history' | 'cookies' | 'cache' | 'storage']
  setPermission: [origin: string, permission: Permission, mode: 'allow' | 'block' | 'reset']
  removeCookie: [domain: string, path: string, name: string, secure: boolean]
  windows: [action: 'minimize' | 'maximize' | 'close']
}
export type Shortcut = 'command' | 'split' | 'toolbar' | 'browse' | 'address' | 'sidebar' | 'history' | 'bookmarks' | 'downloads' | 'settings'
export interface Bridge {
  platform: string
  version: string
  getState(): Promise<BrowserState>
  command<K extends keyof Commands>(name: K, ...args: Commands[K]): Promise<void>
  history(query: string): Promise<Visit[]>
  frequent(): Promise<Visit[]>
  cookies(): Promise<SiteCookie[]>
  layout(rect: ViewRect | PaneRect[] | null): void
  onState(listener: (state: BrowserState) => void): () => void
  onShortcut(listener: (name: Shortcut) => void): () => void
}
