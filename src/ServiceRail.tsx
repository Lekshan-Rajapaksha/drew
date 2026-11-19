import { Archive, Bookmark, Clock3, Download, PanelLeftOpen, Plus, Search, Settings2 } from 'lucide-react'
import type { Workspace } from '../shared/model'
import type { Page } from './state'
import { Mark, Tool } from './ui'
import { useSpaceGesture } from './useSpaceGesture'

const services = [
  ['bookmarks', 'Bookmarks', Bookmark],
  ['history', 'History', Clock3],
  ['downloads', 'Downloads', Download],
  ['archive', 'Archived tabs', Archive],
  ['settings', 'Settings', Settings2],
] as const

export function ServiceRail({ collapsed, page, open, newTab, address, expand, spaces, active, select }: {
  collapsed: boolean; page: Page | null; open: (page: Page) => void; newTab: () => void
  address: () => void; expand: () => void; spaces: Workspace[]; active: string; select: (id: string) => void
}) {
  const gesture = useSpaceGesture(spaces, active, select)
  return <nav className="service-rail" aria-label="Browser services" {...gesture}>
    <div className="rail-mark"><Mark small /></div>
    {collapsed && <Tool label="Expand sidebar" onClick={expand}><PanelLeftOpen size={18} /></Tool>}
    <Tool label="Open Command Bar" onClick={newTab}><Plus size={20} /></Tool>
    <Tool label="Open address bar" onClick={address}><Search size={17} /></Tool>
    <div className="rail-divider" />
    <div className="rail-services">
      {services.map(([id, label, Icon], i) => <button key={id} type="button" className="icon-button service-icon" data-service={i}
        title={label} aria-label={label} aria-current={page === id ? 'page' : undefined} onClick={() => open(id)}><Icon size={17} /></button>)}
    </div>
    {collapsed && <div className="rail-spaces" role="group" aria-label="Spaces">
      {spaces.map(space => <button key={space.id} type="button" className="rail-space" aria-label={space.name} aria-pressed={active === space.id}
        title={space.name} onClick={() => select(space.id)} style={{ color: space.accent } as React.CSSProperties}>
        {space.icon || space.name.slice(0, 1).toUpperCase()}
      </button>)}
    </div>}
  </nav>
}
