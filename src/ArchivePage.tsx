import { useEffect, useState } from 'react'
import { Clock3 } from 'lucide-react'
import type { ArchivedTab } from '../shared/model'
import { Filter, PageHeader } from './Library'
import { command, useApp } from './state'

export function ArchivePage({ name, canUndo, browse }: { name: string; canUndo: boolean; browse: () => void }) {
  const [query, setQuery] = useState('')
  const [items, setItems] = useState<ArchivedTab[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [more, setMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(0)

  useEffect(() => {
    let current = true
    window.lexn.archive(query, page * 100).then(rows => {
      if (!current) return
      setItems(previous => page ? [...previous, ...rows] : rows)
      setMore(rows.length === 100)
    }).catch(error => { if (current) useApp.getState().setError(String(error)) })
      .finally(() => { if (current) setLoading(false) })
    return () => { current = false }
  }, [query, page])

  return <div className="management">
    <PageHeader icon={<Clock3 size={24} />} title="Archived tabs" subtitle={name} actions={<>
      {canUndo && <button type="button" className="secondary" onClick={async () => { if (await command('undoClear')) browse() }}>Undo Clear</button>}
      <button type="button" className="primary" disabled={!selected.length} onClick={async () => {
        if (await command('restoreArchivedTabs', selected)) browse()
      }}>Restore selected ({selected.length})</button>
    </>} />
    <Filter label="Search archived tabs" value={query} change={value => {
      setLoading(true); setQuery(value); setPage(0); setItems([]); setSelected([])
    }} />
    {!loading && !items.length && <p className="muted">{query ? 'No matching archived tabs.' : 'No archived tabs.'}</p>}
    <div className="records">{items.map(item => <article className="record" key={item.id}>
      <input type="checkbox" aria-label={'Select ' + item.title} checked={selected.includes(item.id)}
        disabled={selected.length >= 200 && !selected.includes(item.id)}
        onChange={event => setSelected(previous => event.target.checked ? [...previous, item.id] : previous.filter(id => id !== item.id))} />
      <button className="record-link" type="button" onClick={async () => {
        if (await command('restoreArchived', item.id)) browse()
      }}><strong>{item.title}</strong><span>{item.url}</span></button>
    </article>)}</div>
    {more && <button type="button" className="secondary" disabled={loading} onClick={() => { setLoading(true); setPage(previous => previous + 1) }}>Load more</button>}
  </div>
}
