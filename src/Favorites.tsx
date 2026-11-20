import { useState } from 'react'
import { CalendarDays, Code2, Globe, HardDrive, Mail, Music2, Play, Plus, Search } from 'lucide-react'
import { webUrl } from '../shared/navigation'
import type { Favorite } from '../shared/model'
import { command } from './state'
import { Favicon, Tool } from './ui'

const shortcutIcons = { google: Search, youtube: Play, github: Code2, wikipedia: Globe, mail: Mail, calendar: CalendarDays, drive: HardDrive, music: Music2 }
const colors = ['#9ec6ff', '#ff8298', '#d0bcff', '#9ae6d7', '#f9a78e', '#b7bbff', '#a9da9e', '#a5eab2']
const tileSizes = ['small', 'medium', 'large']

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
      <select aria-label="Favorite icon size" value={size} onChange={event => { void command('setSetting', 'favoriteSize', event.target.value) }}>
        {tileSizes.map(item => <option key={item} value={item}>{item}</option>)}
      </select>
      <Tool label="Add favorite" onClick={() => edit()}><Plus size={15} /></Tool>
    </div>
    <div className={'favorites-grid favorites-' + size} {...dropZone(null)}>
      {items.map((favorite, index) => {
        const Icon = shortcutIcons[favorite.id as keyof typeof shortcutIcons]
        return <button key={favorite.id} type="button" aria-label={favorite.title} title={favorite.title}
          className={target === favorite.id ? 'favorite-drop-target' : undefined}
          aria-pressed={favorite.url === activeUrl} onClick={() => open(favorite.id)} onContextMenu={event => menu(event, favorite)}
          draggable onDragStart={event => {
            event.dataTransfer.effectAllowed = 'move'
            event.dataTransfer.setData('application/x-lexn-favorite', favorite.id)
          }} onDragEnd={() => setTarget(null)}
          {...dropZone(favorite.id)} style={{ '--favorite-accent': colors[index % colors.length] } as React.CSSProperties}>
          {favorite.icon || (Icon ? <Icon size={19} /> : favorite.favicon ? <Favicon tab={{ favicon: favorite.favicon }} /> : favorite.title.slice(0, 1).toUpperCase())}
        </button>
      })}
      <button className={'favorite-add' + (target === 'end' ? ' favorite-drop-target' : '')} type="button" aria-label="Add or drop favorite" title="Add or drop a tab or link"
        onClick={() => edit()} {...dropZone(null)}><Plus size={18} /></button>
    </div>
  </section>
}
