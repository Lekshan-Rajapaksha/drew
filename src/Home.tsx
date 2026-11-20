import { useEffect, useId, useState } from 'react'
import { ArrowUpRight, History, Search, SlidersHorizontal } from 'lucide-react'
import type { Settings, Visit } from '../shared/model'
import { siteName } from './state'
import { Wordmark } from './ui'

function uniqueVisits(visits: Visit[], limit: number) {
  const seen = new Set<string>()
  return visits.filter(visit => {
    if (seen.has(visit.url)) return false
    seen.add(visit.url)
    return true
  }).slice(0, limit)
}

function HomeClock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const tick = () => {
      const time = new Date()
      setNow(time)
      timer = setTimeout(tick, 60_000 - time.getTime() % 60_000)
    }
    tick()
    return () => clearTimeout(timer)
  }, [])
  return <time className="home-clock" dateTime={now.toISOString()}>
    <strong>{now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</strong>
    <span>{now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</span>
  </time>
}

export function Home({ settings, navigate, openHistory, customize }: {
  settings: Settings; navigate: (url: string) => void; openHistory: () => void; customize: () => void
}) {
  const [value, setValue] = useState('')
  const [editing, setEditing] = useState(false)
  const [selected, setSelected] = useState(-1)
  const [suggestions, setSuggestions] = useState<Visit[]>([])
  const [recent, setRecent] = useState<Visit[]>([])
  const listId = useId()
  const query = value.trim()
  const showSuggestions = settings.homeSuggestions && editing && query.length > 1 && suggestions.length > 0

  useEffect(() => {
    if (!settings.homeRecent) return
    let active = true
    window.lexn.history('').then(visits => { if (active) setRecent(uniqueVisits(visits, 4)) }).catch(() => {})
    return () => { active = false }
  }, [settings.homeRecent])

  useEffect(() => {
    if (!settings.homeSuggestions || !editing || query.length < 2) return
    let active = true
    const timer = setTimeout(() => {
      window.lexn.history(query.slice(0, 512))
        .then(visits => { if (active) setSuggestions(uniqueVisits(visits, 5)) })
        .catch(() => {})
    }, 110)
    return () => { active = false; clearTimeout(timer) }
  }, [settings.homeSuggestions, editing, query])

  function finish(url: string) {
    setEditing(false)
    setSelected(-1)
    setSuggestions([])
    if (url) navigate(url)
  }

  return <div className={'home home-' + settings.background + ' home-' + settings.homeDensity}>
    <div className="home-tools">
      {settings.homeClock && <HomeClock />}
      <button type="button" className="home-customize" onClick={customize}><SlidersHorizontal size={15} /> Customize</button>
    </div>
    <div className="home-body">
      <h1 className="home-identity"><Wordmark /></h1>
      <div className="home-search-area">
        <form className="home-search" onSubmit={event => {
          event.preventDefault()
          finish(showSuggestions && selected >= 0 ? suggestions[selected].url : query)
        }}>
          <span className="home-search-icon"><Search size={17} aria-hidden="true" /></span>
          <input aria-label="Search the web" role="combobox" aria-autocomplete="list" aria-expanded={showSuggestions}
            aria-controls={showSuggestions ? listId : undefined}
            aria-activedescendant={showSuggestions && selected >= 0 ? listId + '-' + selected : undefined}
            value={value} onFocus={() => setEditing(true)} onBlur={() => { setEditing(false); setSelected(-1) }}
            onChange={event => { setValue(event.target.value); setEditing(true); setSelected(-1); setSuggestions([]) }}
            onKeyDown={event => {
              if (event.nativeEvent.isComposing) return
              if (event.key === 'Escape' && showSuggestions) {
                event.stopPropagation()
                setEditing(false)
                setSelected(-1)
              }
              if (!showSuggestions || (event.key !== 'ArrowDown' && event.key !== 'ArrowUp')) return
              event.preventDefault()
              const last = suggestions.length - 1
              setSelected(index => event.key === 'ArrowDown' ? (index >= last ? -1 : index + 1) : (index < 0 ? last : index - 1))
            }}
            placeholder="Search or enter a URL" spellCheck={false} autoComplete="off" />
          <button aria-label="Go" type="submit" disabled={!query}><ArrowUpRight size={16} /></button>
        </form>
        {showSuggestions && <ul className="home-suggestions" role="listbox" aria-label="History suggestions" id={listId}>
          {suggestions.map((item, index) => <li key={item.id} role="option" id={listId + '-' + index} aria-selected={selected === index}
            onMouseDown={event => event.preventDefault()} onClick={() => finish(item.url)}>
            <History size={16} aria-hidden="true" /><span><strong>{item.title}</strong><small>{item.url}</small></span>
            <ArrowUpRight size={15} aria-hidden="true" />
          </li>)}
        </ul>}
      </div>
      {settings.homeRecent && recent.length > 0 && <section className="home-library" aria-label="Recent activity">
        <button type="button" className="home-recent-title" aria-label="Open browsing history" onClick={openHistory}>
          <History size={16} /> Recent <ArrowUpRight size={15} />
        </button>
        {recent.map(item => <button className="home-history-link" type="button" key={item.id} onClick={() => navigate(item.url)} title={item.url}>
          <span>{item.title}</span><small>{siteName(item.url)}</small>
        </button>)}
      </section>}
    </div>
  </div>
}
