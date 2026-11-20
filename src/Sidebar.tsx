import { useState, type ReactNode } from 'react'
import { ChevronDown, Folder, Pause, Pin, Play, Plus, Volume2, VolumeX, X } from 'lucide-react'
import type { BrowserState, Favorite, Tab, TabGroup, Workspace } from '../shared/model'
import { effectiveShortcuts, shortcutLabel } from '../shared/shortcuts'
import { command, type Page } from './state'
import { ServiceRail } from './ServiceRail'
import { Favorites } from './Favorites'
import { Favicon, Tool } from './ui'
import type { SwipePreview } from './useSpaceGesture'

export function Sidebar({ browser, space, active, page, collapsed, locked, pinPending, pinSidebar, open, select, newTab, workspaceEditor, groupEditor, context, resize, switchProfile, chrome, dragTab, openFavorite, favoriteMenu, editFavorite, preview, entryDirection }: {
  browser: BrowserState; space: Workspace; active?: Tab; page: Page | null; collapsed: boolean; locked: boolean
  pinPending: boolean; pinSidebar: () => void; open: (page: Page) => void; select: (id: string) => void; newTab: () => void
  workspaceEditor: (space?: Workspace, sameProfile?: boolean) => void; groupEditor: (parent?: string) => void;
  switchProfile: (id: string, direction?: number) => void; chrome: ReactNode;
  context: (event: React.MouseEvent, tab: Tab) => void; resize: (event: React.PointerEvent<HTMLDivElement>) => void
  dragTab: (id: string | null) => void; openFavorite: (id: string) => void;
  favoriteMenu: (event: React.MouseEvent, favorite: Favorite) => void; editFavorite: (favorite?: Favorite) => void
  preview: SwipePreview | null; entryDirection: number;
}) {
  const [closedGroups, setClosedGroups] = useState<string[]>([])
  const [dragging, setDragging] = useState('')
  const [creating, setCreating] = useState(false)
  const platform = window.lexn.platform
  const newTabShortcut = shortcutLabel(effectiveShortcuts(browser.settings.keyboardShortcuts, platform).command, platform)
  const tabs = browser.tabs.filter(tab => tab.workspaceId === space.id)
  const groups = browser.groups.filter(group => group.workspaceId === space.id)
  const neighbor = preview && browser.workspaces.find(item => item.id === preview.id)
  const incoming = neighbor && browser.favoritePreviews[neighbor.profileId ?? neighbor.id]
  const shift = preview && incoming ? preview.direction * preview.progress * 100 : 0
  const renderTab = (tab: Tab) => <div key={tab.id} className={'tab-row' + (tab.id === active?.id && !page ? ' selected' : '') + (dragging === tab.id ? ' dragging' : '')}
    draggable onDragStart={event => {
      event.dataTransfer.setData('application/x-lexn-tab', tab.id)
      event.dataTransfer.effectAllowed = 'move'
      setDragging(tab.id); dragTab(tab.id)
    }}
    onDragEnd={() => { setDragging(''); dragTab(null) }} onDragOver={event => { if (dragging) event.preventDefault() }}
    onDrop={event => { event.stopPropagation(); event.preventDefault(); if (dragging) void command('moveTab', dragging, tab.id); setDragging(''); dragTab(null) }}
    onContextMenu={event => context(event, tab)}>
    <button type="button" className="tab-select" title={tab.title} onClick={() => select(tab.id)} data-tab-id={tab.id}
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
      <button type="button" aria-expanded={!closedGroups.includes(group.id)} onClick={() => setClosedGroups(previous =>
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

  return <aside className={'sidebar spatial-sidebar' + (collapsed ? ' collapsed' : '')} inert={collapsed}>
    <header className="spatial-header">
      <button type="button" className="icon-button sidebar-toggle sidebar-pin" aria-label="Keep sidebar expanded"
        title={locked ? 'Unpin sidebar' : 'Keep sidebar expanded'} aria-pressed={locked} disabled={pinPending} onClick={pinSidebar}>
        <Pin size={17} />
      </button>
      {chrome}
    </header>
    <div className="tabs-scroll spatial-scroll" key={space.id} style={{ '--entry-shift': entryDirection * 24 + 'px' } as React.CSSProperties}>
      <div className="favorites-carousel">
        <div className="favorites-swipe-current" style={{ transform: `translateX(${-shift}%)` }}>
          <Favorites items={browser.favorites} size={browser.settings.favoriteSize} activeUrl={active?.url}
            open={openFavorite} edit={editFavorite} menu={favoriteMenu} />
        </div>
        {incoming && preview && <div className="favorites-swipe-next" inert aria-hidden="true"
          style={{ transform: `translateX(${preview.direction * 100 - shift}%)` }}>
          <Favorites items={incoming.items} size={incoming.size} open={() => {}} edit={() => {}} menu={() => {}} />
        </div>}
      </div>
      <section className="tab-tier" aria-label="Pinned tabs">
        <div className="side-label">Pinned<Tool label="Create tab group" onClick={() => groupEditor()}><Plus size={14} /></Tool></div>
        {groups.filter(group => !group.parentId).map(renderFolder)}
        {tabs.filter(tab => tab.pinned && !tab.groupId).map(renderTab)}
      </section>
      <section className="tab-tier today-tier" aria-label="Today">
        <div className="side-label">Today<button type="button" className="clear-tabs" onClick={() => { void command('archiveTabs') }}
          disabled={!tabs.some(tab => !tab.pinned && tab.url !== 'about:blank')}>Clear</button></div>
        <button type="button" className="new-tab" onClick={newTab} title="New tab"><Plus size={17} /><span>New Tab</span><kbd>{newTabShortcut}</kbd></button>
        {tabs.filter(tab => !tab.pinned).map(renderTab)}
      </section>
    </div>
    <footer className="spatial-footer">
      <ServiceRail page={page} open={open} />
      <div className="space-strip">
        <button type="button" className="space-name" title="Edit Space" aria-label="Edit Space" onClick={() => workspaceEditor(space)}>{space.icon || space.name}</button>
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
    <div className="resize-handle" role="separator" aria-label="Sidebar width" aria-orientation="vertical" onPointerDown={resize} />
  </aside>
}
