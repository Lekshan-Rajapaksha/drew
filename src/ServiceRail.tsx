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
    {services.map(([id, label, Icon], index) => <button key={id} type="button" className="icon-button service-icon"
      data-service={index} aria-label={label} title={label} aria-current={page === id ? 'page' : undefined} onClick={() => open(id)}>
      <Icon size={17} />
    </button>)}
  </nav>
}
