import { useEffect, useState, type ReactNode } from 'react'
import {
  Bookmark as BookmarkIcon, Clock3, Download as DownloadIcon, ExternalLink, Folder, FolderOpen,
  Pencil, Plus, Search, Trash2, X,
} from 'lucide-react'
import type { Bookmark, BrowserState, Visit } from '../shared/model'
import { command, siteName, useApp } from './state'
import { Tool } from './ui'

export function PageHeader({ icon, title, subtitle, actions }: { icon: ReactNode; title: string; subtitle: string; actions?: ReactNode }) {
  return <header className="page-head">
    <span className="page-icon">{icon}</span>
    <div><h1>{title}</h1><p>{subtitle}</p></div>
    {actions && <div className="page-actions">{actions}</div>}
  </header>
}

export function Filter({ value, change, label }: { value: string; change: (value: string) => void; label: string }) {
  return <label className="filter"><Search size={17} /><input type="search" value={value}
    onChange={event => change(event.target.value)} placeholder={label} aria-label={label} /></label>
}

export function Empty({ icon, title, detail }: { icon: ReactNode; title: string; detail: string }) {
  return <div className="empty"><div>{icon}</div><h2>{title}</h2><p>{detail}</p></div>
}

export function BookmarksPage({ browser, open, edit, addFolder }: {
  browser: BrowserState; open: (url: string) => void; edit: (item?: Bookmark) => void; addFolder: () => void
}) {
  const [query, setQuery] = useState('')
  const [folder, setFolder] = useState('')
  const folders = browser.folders
  const items = browser.bookmarks.filter(item => (!folder || item.folderId === folder) && (item.title + ' ' + item.url).toLowerCase().includes(query.trim().toLowerCase()))
  return <div className="management">
    <PageHeader icon={<BookmarkIcon size={24} />} title="Bookmarks" subtitle="Keep the sites you want to come back to."
      actions={<><button className="secondary" type="button" onClick={addFolder}><Folder size={16} /> New folder</button>
        <button className="primary" type="button" onClick={() => edit()}><Plus size={16} /> Add bookmark</button></>} />
    <Filter label="Search bookmarks" value={query} change={setQuery} />
    {folders.length > 0 && <div className="folder-filters">
      <button className={!folder ? 'selected' : ''} type="button" onClick={() => setFolder('')}>All bookmarks</button>
      {folders.map(item => <button key={item.id} className={item.id === folder ? 'selected' : ''} type="button" onClick={() => setFolder(item.id)}><Folder size={14} />{item.name}</button>)}
      {folder && <Tool label="Delete selected folder" onClick={() => { void command('deleteFolder', folder).then(ok => { if (ok) setFolder('') }) }}><Trash2 size={15} /></Tool>}
    </div>}
    {items.length === 0 && <Empty icon={<BookmarkIcon size={24} />} title={query ? 'No matching bookmarks' : 'No bookmarks here'} detail="Use Add bookmark or the star in the address bar to save a site." />}
    <div className="records">{items.map(item => <article className="record" key={item.id}>
      <span className="record-icon"><BookmarkIcon size={17} /></span>
      <button className="record-link" type="button" onClick={() => open(item.url)}><strong>{item.title}</strong><span>{item.url}</span></button>
      <Tool label={`Edit ${item.title}`} onClick={() => edit(item)}><Pencil size={15} /></Tool>
      <Tool label={`Delete ${item.title}`} onClick={() => { void command('deleteBookmark', item.id) }}><Trash2 size={15} /></Tool>
    </article>)}</div>
  </div>
}

export function HistoryPage({ open, confirm }: { open: (url: string) => void; confirm: (action: () => Promise<void>) => void }) {
  const [query, setQuery] = useState('')
  const [items, setItems] = useState<Visit[]>([])
  const [revision, refresh] = useState(0)
  useEffect(() => {
    let current = true
    window.lexn.history(query).then(result => { if (current) setItems(result) })
      .catch(error => { if (current) useApp.getState().setError(String(error)) })
    return () => { current = false }
  }, [query, revision])
  return <div className="management">
    <PageHeader icon={<Clock3 size={24} />} title="History" subtitle="Find pages you visited in this browser."
      actions={<button className="secondary" type="button" onClick={() => confirm(async () => { if (await command('clearData', 'history')) refresh(value => value + 1) })}><Trash2 size={16} /> Clear history</button>} />
    <Filter label="Search history" value={query} change={setQuery} />
    {items.length === 0 && <Empty icon={<Clock3 size={24} />} title={query ? 'No matching visits' : 'No history yet'} detail="Pages you visit will appear here." />}
    <div className="records">{items.map(item => <article className="record" key={item.id}>
      <span className="record-icon"><Clock3 size={17} /></span>
      <button className="record-link" type="button" onClick={() => open(item.url)}><strong>{item.title}</strong><span>{siteName(item.url)}</span></button>
      <time dateTime={new Date(item.visitedAt).toISOString()}>{new Date(item.visitedAt).toLocaleString()}</time>
      <Tool label={`Delete visit to ${item.title}`} onClick={() => { void command('deleteVisit', item.id).then(ok => { if (ok) refresh(value => value + 1) }) }}><Trash2 size={15} /></Tool>
    </article>)}</div>
  </div>
}

const bytes = (bytes: number) => bytes < 1024 ? bytes + ' B' : bytes < 1024 ** 2 ? (bytes / 1024).toFixed(1) + ' KB' : (bytes / 1024 ** 2).toFixed(1) + ' MB'

export function DownloadsPage({ browser }: { browser: BrowserState }) {
  return <div className="management">
    <PageHeader icon={<DownloadIcon size={24} />} title="Downloads" subtitle="View files saved by Drew and track active downloads." />
    {browser.downloads.length === 0 && <Empty icon={<DownloadIcon size={24} />} title="No downloads yet" detail="Files you download from websites will appear here." />}
    <div className="records">{browser.downloads.map(item => <article className="record" key={item.id}>
      <span className="record-icon"><DownloadIcon size={17} /></span>
      <div className="record-link"><strong>{item.name}</strong><span>{item.state} · {bytes(item.received)}{item.total > 0 ? ' / ' + bytes(item.total) : ''}</span>
        {item.state === 'progressing' && <progress aria-label={`Downloading ${item.name}`} value={item.total ? item.received : undefined} max={item.total || 1} />}
      </div>
      {item.state === 'progressing' && <Tool label={`Cancel ${item.name}`} onClick={() => { void command('download', item.id, 'cancel') }}><X size={16} /></Tool>}
      {item.state === 'completed' && <>
        <Tool label={`Reveal ${item.name}`} onClick={() => { void command('download', item.id, 'reveal') }}><FolderOpen size={17} /></Tool>
        <Tool label={`Open ${item.name}`} onClick={() => { void command('download', item.id, 'open') }}><ExternalLink size={16} /></Tool>
      </>}
    </article>)}</div>
  </div>
}
