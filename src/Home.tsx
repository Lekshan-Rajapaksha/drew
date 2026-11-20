import { useEffect, useState } from 'react'
import { ArrowUpRight, Bookmark, Code2, Globe2, History, Palette, Play, Plus, Search } from 'lucide-react'
import type { Bookmark as SavedBookmark, Settings, Visit } from '../shared/model'
import { command, siteName } from './state'
import { Mark, Tool } from './ui'

const defaults = [
  { title: 'Google', url: 'https://www.google.com/', Icon: Search, color: '#b5a2ff' },
  { title: 'YouTube', url: 'https://www.youtube.com/', Icon: Play, color: '#ff9ba8' },
  { title: 'GitHub', url: 'https://github.com/', Icon: Code2, color: '#d6c8ff' },
  { title: 'Wikipedia', url: 'https://www.wikipedia.org/', Icon: Globe2, color: '#89e4cb' },
]

export function Home({ activeId, bookmarks, background, navigate, library }: {
  activeId?: string; bookmarks: SavedBookmark[]; background: Settings['background']
  navigate: (url: string) => void; library: (page: 'bookmarks' | 'history') => void
}) {
  const [now, setNow] = useState(() => new Date())
  const [value, setValue] = useState('')
  const [frequent, setFrequent] = useState<Visit[]>([])
  const [recent, setRecent] = useState<Visit[]>([])
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])
  useEffect(() => {
    let mounted = true
    Promise.all([window.lexn.frequent(), window.lexn.history('')]).then(([top, history]) => {
      if (!mounted) return
      setFrequent(top)
      setRecent([...new Map(history.slice().reverse().map(visit => [visit.url, visit])).values()].reverse().slice(0, 5))
    }).catch(() => {})
    return () => { mounted = false }
  }, [activeId])
  const links = [...frequent.map(item => ({ ...item, title: siteName(item.url), Icon: Globe2, color: '#b5a2ff' })), ...defaults]
    .filter((item, index, all) => all.findIndex(other => siteName(other.url) === siteName(item.url)) === index).slice(0, 5)
  const time = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(now)

  return <div className={'home home-' + background}>
    <div className="horizon" aria-hidden="true"><div /><div /><div /><div /></div>
    <div className="home-top">
      <time dateTime={now.toISOString()}>{now.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
        <span aria-hidden="true">·</span>{time}
      </time>
      <Tool label="Change new tab background" onClick={() => {
        const choices = ['violet', 'forest', 'midnight', 'black', 'match'] as const
        void command('setSetting', 'background', choices[(choices.indexOf(background) + 1) % choices.length])
      }}><Palette size={17} /></Tool>
    </div>
    <div className="home-body">
      <h1 className="home-identity"><Mark /><span>LexN</span></h1>
      <form className="home-search" onSubmit={event => { event.preventDefault(); if (value.trim()) navigate(value) }}>
        <Search size={20} /><input aria-label="Search the web" value={value} onChange={event => setValue(event.target.value)}
          placeholder="Search the web" spellCheck={false} autoComplete="off" />
        <button aria-label="Go" type="submit"><ArrowUpRight size={18} /></button>
      </form>
      <div className="quick-links" aria-label="Quick access">
        {links.map(({ title, url, Icon, color }) => <button type="button" key={url} onClick={() => navigate(url)} title={url}>
          <span className="quick-icon" style={{ color }}><Icon size={21} /></span><span>{title}</span>
        </button>)}
        <button type="button" onClick={() => library('bookmarks')}><span className="quick-icon dashed"><Plus size={21} /></span><span>Bookmarks</span></button>
      </div>
      {(bookmarks.length > 0 || recent.length > 0) && <div className="home-library">
        {bookmarks.length > 0 && <section><button type="button" onClick={() => library('bookmarks')}><Bookmark size={15} /> Saved links <ArrowUpRight size={14} /></button>
          {bookmarks.slice(0, 4).map(item => <button className="home-history-link" type="button" key={item.id} onClick={() => navigate(item.url)}>{item.title}</button>)}
        </section>}
        {recent.length > 0 && <section><button type="button" onClick={() => library('history')}><History size={15} /> Recent <ArrowUpRight size={14} /></button>
          {recent.slice(0, 4).map(item => <button className="home-history-link" type="button" key={item.id} onClick={() => navigate(item.url)}>{item.title}</button>)}
        </section>}
      </div>}
    </div>
  </div>
}
