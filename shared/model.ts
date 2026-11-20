export const HOME = 'about:blank'
export const WINDOW_CAPTION_HEIGHT = 36
export const SIDEBAR_INSET = 8
export const SIDEBAR_VERTICAL_GAP = 11
export const SIDEBAR_RADIUS = 18
export const WINDOW_CONTROLS_WIDTH = 138
export const WINDOW_CONTROLS_INSET = 4
export const accents = ['#b5a2ff', '#72e3ba', '#80baff', '#f9b97b', '#fc91b5', '#6de5ef', '#ff8c82', '#dcc576'] as const
export const engines = {
  google: 'https://www.google.com/search?q=',
  duckduckgo: 'https://duckduckgo.com/?q=',
  bing: 'https://www.bing.com/search?q=',
} as const
export const profileThemes = {
  dark: 'Soft Dark', black: 'True Black', slate: 'Slate', light: 'Light',
  rose: 'Rose', sky: 'Sky Blue', mint: 'Mint', lavender: 'Lavender', system: 'Follow system',
} as const
export const themeAccents: Partial<Record<keyof typeof profileThemes, string>> = {
  rose: '#cb5b83', sky: '#448cc5', mint: '#339474', lavender: '#8567c5',
}

export interface Settings {
  engine: keyof typeof engines
  homepage: string
  startup: 'restore' | 'home' | 'blank'
  theme: keyof typeof profileThemes
  background: 'violet' | 'forest' | 'midnight' | 'black' | 'match'
  accentColor: string
  accentEnd: string
  colorIntensity: 'subtle' | 'balanced' | 'vivid'
  sidebarWidth: string
  downloadPath: string
  topToolbar: boolean
  sidebarStyle: 'full' | 'compact'
  topTabs: 'above' | 'below' | 'hidden'
  topActions: 'full' | 'minimal'
  keepSidebarOpen: boolean
  favoriteSize: string
  homeRecent: boolean
  homeClock: boolean
  homeSuggestions: boolean
  homeDensity: 'relaxed' | 'compact'
  motion: 'system' | 'off'
  sidebarDismiss: 'quick' | 'balanced' | 'relaxed'
  notificationPolicy: 'approved' | 'block'
  keyboardShortcuts: string
  archiveHours: string
  javascript: boolean
}
export const defaultSettings: Settings = {
  engine: 'google', homepage: HOME, startup: 'restore', theme: 'dark',
  background: 'match', accentColor: '', accentEnd: '', colorIntensity: 'balanced', sidebarWidth: '284', downloadPath: '', topToolbar: false, keepSidebarOpen: false, favoriteSize: 'medium', archiveHours: '24', javascript: true,
  homeRecent: true, homeClock: true, homeSuggestions: true,
  sidebarStyle: 'full', topTabs: 'above', topActions: 'full',
  homeDensity: 'relaxed', motion: 'system', sidebarDismiss: 'balanced', notificationPolicy: 'approved', keyboardShortcuts: '{}',
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
export interface Favorite { id: string; url: string; title: string; favicon: string | null; icon: string }
export interface ArchivedTab { id: string; url: string; title: string; archivedAt: number }
export interface ViewRect { x: number; y: number; width: number; height: number }
export interface PaneRect extends ViewRect { id: string }
export type BrowserBrand = 'Chrome' | 'Arc' | 'Dia' | 'Ardia' | 'Opera' | 'Opera GX' | 'Edge' | 'Brave' | 'Vivaldi' | 'Chromium'
export interface BrowserImportSource { id: string; label: string; browser: BrowserBrand }
export interface BrowserImportResult {
  bookmarks: number; visits: number; passwords: number; notes: string[]
  profiles?: { id: string; name: string }[]; favorites?: number; pinned?: number; tabs?: number
}
export type BrowserImportKind = 'browser' | 'folder' | 'bookmarks' | 'passwords' | 'profiles' | 'profile-folder' | 'profile-markdown'

export interface ProfileExtension { id: string; name: string; version: string; popup: boolean }
export interface SavedLogin { id: string; origin: string; username: string }
export interface BrowserState {
  appVersion: string
  welcomePending: boolean
  windowMaximized: boolean
  passwords: SavedLogin[];
  extensions: ProfileExtension[];
  favorites: Favorite[]; archived: ArchivedTab[];
  sidebarPreviews: Record<string, {
    favorites: Favorite[]; size: Settings['favoriteSize']; tabs: Tab[]; groups: TabGroup[]
    settings: Pick<Settings, 'theme' | 'accentColor' | 'accentEnd' | 'topToolbar' | 'keyboardShortcuts'>
  }>
  otherWindowTabs: Tab[]
  workspaceId: string; profileId: string; workspaces: Workspace[]; tabs: Tab[]; groups: TabGroup[];
  bookmarks: Bookmark[]; folders: Folder[]; downloads: Download[];
  settings: Settings; permissions: SitePermission[];
}
export interface Commands {
  newTab: [url?: string]
  newWindow: []
  home: []
  setGradient: [string, string]
  setNavigationLayout: ['sidebar' | 'compact' | 'top']
  closeTab: [id: string]
  selectTab: [id: string]
  focusWindowTab: [id: string]
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
  saveFavorite: [id: string | null, url: string, title: string, icon: string]
  moveFavorite: [id: string, target: string | null]
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
  setShortcut: [action: string, binding: string | null]
  finishWelcome: []
  windowAction: [action: 'minimize' | 'toggleMaximize' | 'close']
}
export type Shortcut = 'command' | 'split' | 'toolbar' | 'browse' | 'address' | 'sidebar' | 'history' | 'bookmarks' | 'downloads' | 'settings'
export interface SpaceScroll {
  x: number; dx: number; dy: number; phase: 'begin' | 'change' | 'end' | 'discrete'; momentum: boolean
}
export interface Bridge {
  platform: string
  getState(): Promise<BrowserState>
  command<K extends keyof Commands>(name: K, ...args: Commands[K]): Promise<void>
  history(query: string): Promise<Visit[]>
  frequent(): Promise<Visit[]>
  cookies(): Promise<SiteCookie[]>
  importSources(): Promise<BrowserImportSource[]>
  importBrowserData(kind: BrowserImportKind, source?: string): Promise<BrowserImportResult | null>
  layout(rect: ViewRect | PaneRect[] | null): void
  layoutSidebar(width: number, open: boolean, animate: boolean): void
  onState(listener: (state: BrowserState) => void): () => void
  usesNativeSpaceScroll(): Promise<boolean>
  onSpaceScroll(listener: (scroll: SpaceScroll) => void): () => void
  onPointer(listener: (x: number | null) => void): () => void
  onShortcut(listener: (name: Shortcut) => void): () => void
}
