import { useState, type CSSProperties, type ReactNode } from 'react'
import { ArrowLeft, ArrowRight, ChevronDown, Ellipsis, ExternalLink, Folder, House, Pause, Pin, Play, Plus, RotateCw, Search, Volume2, VolumeX, X } from 'lucide-react'
import { HOME, themeAccents, type BrowserState, type Favorite, type Tab, type TabGroup, type Workspace } from '../shared/model'
import { effectiveShortcuts, shortcutLabel } from '../shared/shortcuts'
import { command, type Page } from './state'
import { Favorites } from './Favorites'
import { ServiceRail } from './ServiceRail'
import { Favicon, Tool } from './ui'
import type { SwipePreview } from './useSpaceGesture'

type SidebarProps = {
  browser: BrowserState; space: Workspace; active?: Tab; page: Page | null; collapsed: boolean; locked: boolean
  pinPending: boolean; pinSidebar: () => void; openActions: () => void; open: (page: Page) => void; select: (id: string) => void; newTab: () => void
  workspaceEditor: (space?: Workspace, sameProfile?: boolean) => void; groupEditor: (parent?: string) => void;
  switchProfile: (id: string, direction?: number) => void; chrome: ReactNode;
  context: (event: React.MouseEvent, tab: Tab) => void; resize: (event: React.PointerEvent<HTMLDivElement>) => void
  dragTab: (id: string | null) => void; openFavorite: (id: string) => void;
  favoriteMenu: (event: React.MouseEvent, favorite: Favorite) => void; editFavorite: (favorite?: Favorite) => void
  preview: SwipePreview | null; compact: boolean; systemDark: boolean; address: () => void; goHome: () => void
}

export function Sidebar(props: SidebarProps) {
  const { browser, preview, collapsed, compact, systemDark, resize } = props
  const neighbor = preview && browser.workspaces.find(space => space.id === preview.id)
  const next = neighbor && browser.sidebarPreviews[neighbor.id]
  const shift = preview && next ? preview.direction * preview.progress * 100 : 0
  const nextTheme = next?.settings.theme === 'system' ? (systemDark ? 'dark' : 'light') : next?.settings.theme
  const accent = nextTheme && neighbor ? next?.settings.accentColor || themeAccents[nextTheme] || neighbor.accent : undefined
  return <aside className={'sidebar spatial-sidebar' + (collapsed ? ' collapsed' : '') + (compact ? ' compact-sidebar' : '')} inert={collapsed}>
    <div className={'sidebar-carousel' + (preview?.settling ? ' swipe-settling' : '')}>
      <div key={props.space.id} className="sidebar-slide sidebar-swipe-current" style={{ transform: `translateX(${-shift}%)` }}>
        <SidebarPage {...props} />
      </div>
      {neighbor && next && preview && <div key={neighbor.id + '-preview-' + preview.direction} className={`sidebar-slide sidebar-swipe-next ${nextTheme ?? ''}`} inert aria-hidden="true"
        style={{ '--ambient': accent, '--accent': accent, '--ambient-end': next.settings.accentEnd || accent,
          '--swipe-edge': preview.direction * 100 + '%',
          transform: `translateX(${preview.direction * 100 - shift}%)` } as CSSProperties}>
        <SidebarPage {...props} space={neighbor} page={null}
          active={next.tabs.find(tab => tab.id === neighbor.activeTab)}
          browser={{ ...browser, settings: { ...browser.settings, ...next.settings, favoriteSize: next.size },
            favorites: next.favorites, tabs: next.tabs, groups: next.groups,
            otherWindowTabs: (neighbor.profileId ?? neighbor.id) === browser.profileId ? browser.otherWindowTabs : [] }}
          chrome={!compact && !next.settings.topToolbar ? <PreviewToolbar url={next.tabs.find(tab => tab.id === neighbor.activeTab)?.url} /> : null} />
      </div>}
    </div>
    <ProfileStrip browser={browser} space={props.space} page={props.page} open={props.open} switchProfile={props.switchProfile} workspaceEditor={props.workspaceEditor} />
    {!compact && <div className="resize-handle" role="separator" aria-label="Sidebar width" aria-orientation="vertical" onPointerDown={resize} />}
  </aside>
}

function PreviewToolbar({ url }: { url?: string }) {
  return <div className="toolbar toolbar-side">
    <div className="nav-cluster"><ArrowLeft size={16} /><ArrowRight size={16} /><RotateCw size={15} /><House size={15} /></div>
    <div className="toolbar-actions"><Ellipsis size={18} /></div>
    <div className="address-wrap"><div className="address"><Search size={15} /><span>{!url || url === HOME ? 'Search or URL' : url}</span></div></div>
  </div>
}

function SidebarPage({ browser, space, active, page, locked, pinPending, pinSidebar, openActions, select, newTab, groupEditor, context, chrome, dragTab, openFavorite, favoriteMenu, editFavorite, compact, address, goHome }: SidebarProps) {
  const [closedGroups, setClosedGroups] = useState<string[]>([])
  const [dragging, setDragging] = useState('')
  const platform = window.lexn.platform
  const newTabShortcut = shortcutLabel(effectiveShortcuts(browser.settings.keyboardShortcuts, platform).command, platform)
  const tabs = browser.tabs.filter(tab => tab.workspaceId === space.id)
  const groups = browser.groups.filter(group => group.workspaceId === space.id)
  const renderTab = (tab: Tab) => <div key={tab.id} className={'tab-row' + (tab.id === active?.id && !page ? ' selected' : '') + (dragging === tab.id ? ' dragging' : '')}
    draggable onDragStart={event => {
      event.dataTransfer.setData('application/x-lexn-tab', tab.id)
      event.dataTransfer.effectAllowed = 'move'
      setDragging(tab.id); dragTab(tab.id)
    }}
    onDragEnd={() => { setDragging(''); dragTab(null) }} onDragOver={event => { if (dragging) event.preventDefault() }}
    onDrop={event => { event.stopPropagation(); event.preventDefault(); if (dragging) void command('moveTab', dragging, tab.id); setDragging(''); dragTab(null) }}
    onContextMenu={event => context(event, tab)}>
    <button type="button" className="tab-select" title={tab.title} aria-label={tab.title} onClick={() => select(tab.id)} data-tab-id={tab.id}
      aria-current={tab.id === active?.id && !page ? 'page' : undefined}>
      {tab.loading ? <span className="spinner small" /> : <Favicon tab={tab} />}
      <span>{tab.title}</span>
    </button>
    {tab.media && <Tool label={tab.playing ? 'Pause playback' : 'Resume playback'} onClick={() => { void command('mediaTab', tab.id) }}>
      {tab.playing ? <Pause size={14} /> : <Play size={14} />}
    </Tool>}
    {(tab.audible || tab.muted) && <Tool label={tab.muted ? 'Unmute tab' : 'Mute tab'} onClick={() => { void command('muteTab', tab.id) }}>
      {tab.muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
    </Tool>}
    <Tool label={`Close ${tab.title}`} className="tab-close" onClick={() => { void command('closeTab', tab.id) }}><X size={13} /></Tool>
  </div>

  const renderFolder = (group: TabGroup) => <div className="group" key={group.id} onDragOver={event => { if (dragging) event.preventDefault() }}
    onDrop={event => { event.stopPropagation(); event.preventDefault(); if (dragging) void command('groupTab', dragging, group.id); setDragging(''); dragTab(null) }}>
    <div className="group-heading">
      <button type="button" title={group.name} aria-label={group.name} aria-expanded={!closedGroups.includes(group.id)} onClick={() => setClosedGroups(previous =>
        previous.includes(group.id) ? previous.filter(id => id !== group.id) : [...previous, group.id])}>
        <ChevronDown size={13} /><Folder size={14} /> <span>{group.name}</span>
      </button>
      <Tool label={`Add folder inside ${group.name}`} onClick={() => groupEditor(group.id)}><Plus size={13} /></Tool>
      <Tool label={`Delete group ${group.name}`} onClick={() => { void command('removeGroup', group.id) }}><X size={13} /></Tool>
    </div>
    {!closedGroups.includes(group.id) && <div className="group-content">
      {groups.filter(child => child.parentId === group.id).map(renderFolder)}
      {tabs.filter(tab => tab.groupId === group.id).map(renderTab)}
    </div>}
  </div>

  const availableGroups = new Set(groups.map(group => group.id))
  return <>
    <header className="spatial-header">
      <button type="button" className="icon-button sidebar-toggle sidebar-pin" aria-label="Keep sidebar expanded"
        title={locked ? 'Unpin sidebar' : 'Keep sidebar expanded'} aria-pressed={locked} disabled={pinPending} onClick={pinSidebar}>
        <Pin size={17} />
      </button>
      {compact && !browser.settings.topToolbar ? <>
        <Tool label="Search or enter address" onClick={address}><Search size={16} /></Tool>
        <Tool label="Home" onClick={goHome}><House size={16} /></Tool>
        <Tool label="Browser menu" onClick={openActions}><Ellipsis size={18} /></Tool>
      </> : chrome}
    </header>
    <div className="tabs-scroll spatial-scroll" key={space.id}>
      <Favorites items={browser.favorites} size={browser.settings.favoriteSize} activeUrl={active?.url}
        open={openFavorite} edit={editFavorite} menu={favoriteMenu} />
      <section className="tab-tier" aria-label="Pinned tabs">
        <div className="side-label">Pinned<Tool label="Create tab group" onClick={() => groupEditor()}><Plus size={14} /></Tool></div>
        {groups.filter(group => !group.parentId).map(renderFolder)}
        {tabs.filter(tab => tab.pinned && (!tab.groupId || !availableGroups.has(tab.groupId))).map(renderTab)}
      </section>
      {browser.otherWindowTabs.length > 0 && <section className="tab-tier" aria-label="Other windows">
        <div className="side-label">Other windows</div>
        {browser.otherWindowTabs.map(tab => <div className="tab-row" key={tab.id}>
          <button className="tab-select" type="button" title={tab.title + ' · Other window'} aria-label={'Switch to ' + tab.title + ' in another window'}
            onClick={() => { void command('focusWindowTab', tab.id) }}>
            <Favicon tab={tab} /><span>{tab.title}</span><ExternalLink className="other-window-icon" size={12} />
          </button>
        </div>)}
      </section>}
      <section className="tab-tier today-tier" aria-label="Today">
        <div className="side-label">Today<button type="button" className="clear-tabs" onClick={() => { void command('archiveTabs') }}
          disabled={!tabs.some(tab => !tab.pinned && tab.url !== 'about:blank')}>Clear</button></div>
        <button type="button" className="new-tab" onClick={newTab} title="New tab"><Plus size={17} /><span>New Tab</span><kbd>{newTabShortcut}</kbd></button>
        {tabs.filter(tab => !tab.pinned).map(renderTab)}
      </section>
    </div>
  </>
}

function ProfileStrip({ browser, space, page, open, switchProfile, workspaceEditor }: Pick<SidebarProps, 'browser' | 'space' | 'page' | 'open' | 'switchProfile' | 'workspaceEditor'>) {
  const [creating, setCreating] = useState(false)
  return <footer className="spatial-footer">
    <ServiceRail page={page} open={open} />
    <div className="space-strip">
      <button type="button" className="space-name" title="Edit Space" aria-label="Edit Space" onClick={() => workspaceEditor(space)}><span key={space.id}>{space.icon || space.name}</span></button>
      <nav className="profile-dots" aria-label="Browser profiles">
        {browser.workspaces.map(item => <button key={item.id} type="button" title={item.name} aria-label={item.name} aria-pressed={item.id === space.id}
          onClick={() => switchProfile(item.id)}><i style={{ '--dot': item.accent } as React.CSSProperties} /></button>)}
      </nav>
      <div className="space-add">
        <Tool label="Add Space or profile" onClick={() => setCreating(!creating)}><Plus size={16} /></Tool>
        {creating && <div className="space-add-menu">
          <button type="button" onClick={() => { workspaceEditor(undefined, true); setCreating(false) }}>New Space</button>
          <button type="button" onClick={() => { workspaceEditor(); setCreating(false) }}>New profile</button>
        </div>}
      </div>
    </div>
  </footer>
}
