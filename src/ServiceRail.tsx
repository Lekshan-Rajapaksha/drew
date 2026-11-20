import { Archive, Bookmark, Clock3, Download, Settings2 } from 'lucide-react'
import type { Page } from './state'

const services = [
  ['bookmarks', 'Bookmarks', Bookmark],
  ['history', 'History', Clock3],
  ['downloads', 'Downloads', Download],
  ['archive', 'Archived tabs', Archive],
  ['settings', 'Settings', Settings2],
] as const

export function ServiceRail({ page, open }: { page: Page | null; open: (page: Page) => void }) {
  return <nav className="service-rail" aria-label="Browser services">
    <div className="rail-services">
      {services.map(([id, label, Icon], i) => <button key={id} type="button" className="icon-button service-icon" data-service={i}
        title={label} aria-label={label} aria-current={page === id ? 'page' : undefined} onClick={() => open(id)}><Icon size={17} /></button>)}
    </div>

  </nav>
}
