import { useState } from 'react'
import { webUrl } from '../shared/navigation'
import type { Favorite } from '../shared/model'
import { command } from './state'
import { Favicon } from './ui'

export function Favorites({ items, size, activeUrl, open, edit, menu }: {
  items: Favorite[]; size: string; activeUrl?: string
  open: (id: string) => void; edit: (favorite?: Favorite) => void
  menu: (event: React.MouseEvent, favorite: Favorite) => void
}) {
  const [target, setTarget] = useState<string | null>(null)
  const dropZone = (id: string | null) => ({
    onDragOver: (event: React.DragEvent) => {
      event.preventDefault()
      event.stopPropagation()
      event.dataTransfer.dropEffect = event.dataTransfer.types.includes('application/x-lexn-tab') ? 'move'
        : event.dataTransfer.types.includes('application/x-lexn-favorite') ? 'move' : 'copy'
      setTarget(id ?? 'end')
    },
    onDrop: async (event: React.DragEvent) => {
      event.preventDefault()
      event.stopPropagation()
      setTarget(null)
      const favorite = event.dataTransfer.getData('application/x-lexn-favorite')
      const tab = event.dataTransfer.getData('application/x-lexn-tab')
      if (favorite) { void command('moveFavorite', favorite, id); return }
      if (tab) { void command('favorite', tab); return }
      const payload = event.dataTransfer.getData('text/uri-list') || event.dataTransfer.getData('text/plain')
      const url = webUrl(payload.split(/\r?\n/).find(line => !line.startsWith('#'))?.trim() ?? '')
      if (url) await command('saveFavorite', null, url, new URL(url).hostname, '')
    },
  })
  return <section className="favorites-section" aria-label="Favorites" onDragLeave={event => {
    if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setTarget(null)
  }}>
    <div className="favorites-heading"><span>Favorites</span>
      <button type="button" className="favorite-add-text" onClick={() => edit()}>Add favorite</button>
    </div>
    <div className={'favorites-grid favorites-' + size + (target === 'end' ? ' favorites-drop-end' : '')} {...dropZone(null)}>
      {items.map(favorite => <button key={favorite.id} type="button" aria-label={favorite.title} title={favorite.title}
          className={target === favorite.id ? 'favorite-drop-target' : undefined}
          aria-pressed={favorite.url === activeUrl} onClick={() => open(favorite.id)} onContextMenu={event => menu(event, favorite)}
          draggable onDragStart={event => {
            event.dataTransfer.effectAllowed = 'move'
            event.dataTransfer.setData('application/x-lexn-favorite', favorite.id)
          }} onDragEnd={() => setTarget(null)}
          {...dropZone(favorite.id)}>
          <Favicon tab={favorite} fallback={null} />
        </button>)}

    </div>
  </section>
}
