import { ArrowDown, ArrowUpRight, Command, Globe, LayoutPanelLeft, Search, X } from 'lucide-react'
import { useState } from 'react'
import type { Tab } from '../shared/model'

export interface BarAction { label: string; run: () => void }

export function CommandBar({ initial, tabs, actions, split, close, navigate, select }: {
  initial: string; tabs: Tab[]; actions: BarAction[]; split: boolean
  close: () => void; navigate: (text: string) => void; select: (id: string) => void
}) {
  const [input, setInput] = useState(initial)
  const [choice, setChoice] = useState(0)
  const query = input.trim().toLowerCase()
  const tabRows = tabs.filter(tab => (tab.title + ' ' + tab.url).toLowerCase().includes(query)).slice(0, 6)
    .map(tab => ({ label: tab.title, detail: split ? 'Add pane' : 'Switch to tab', Icon: split ? LayoutPanelLeft : Globe, run: () => select(tab.id) }))
  const actionRows = actions.filter(action => action.label.toLowerCase().includes(query)).slice(0, 5)
    .map(action => ({ label: action.label, detail: 'Action', Icon: Command, run: action.run }))
  const typed = !split && query ? [{ label: input.trim(), detail: 'Open URL or search', Icon: Search, run: () => navigate(input) }] : []
  const exact = actionRows.find(action => action.label.toLowerCase() === query)
  const rows = exact ? [exact, ...typed, ...tabRows, ...actionRows.filter(action => action !== exact)]
    : [...typed, ...tabRows, ...actionRows]
  const active = Math.min(choice, Math.max(0, rows.length - 1))
  return <div className="overlay command-overlay" onMouseDown={event => { if (event.currentTarget === event.target) close() }}>
    <section className="command-panel" role="dialog" aria-modal="true" aria-label={split ? 'Split View' : 'Command Bar'}>
      <form onSubmit={event => { event.preventDefault(); rows[active]?.run() }}>
        <div className="command-input">
          <Search size={21} />
          <input autoFocus aria-label={split ? 'Find a tab for split view' : 'Search commands or enter a URL'} role="combobox"
            aria-expanded={rows.length > 0} aria-controls="command-results" aria-activedescendant={rows.length ? 'command-row-' + active : undefined}
            placeholder={split ? 'Choose a tab for Split View' : 'Search, open a URL, or run a command'} value={input}
            onFocus={event => event.currentTarget.select()} onChange={event => { setInput(event.target.value); setChoice(0) }}
            onKeyDown={event => {
              if (event.key === 'Escape') close()
              if (!rows.length || (event.key !== 'ArrowDown' && event.key !== 'ArrowUp')) return
              event.preventDefault()
              setChoice((active + (event.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length)
            }} />
          <button type="button" aria-label="Close command bar" onClick={close}><X size={16} /></button>
        </div>
        <div id="command-results" className="command-results" role="listbox">
          {rows.map(({ label, detail, run, Icon }, index) => <button key={index} type="button" role="option" id={'command-row-' + index}
            aria-selected={index === active} onMouseMove={() => setChoice(index)} onClick={run}><Icon size={16} /><span>{label}</span><small>{detail}</small></button>)}
          {!rows.length && <p>{split ? 'Open another webpage to add a pane.' : 'No matches'}</p>}
        </div>
      </form>
      <footer><span><ArrowDown size={12} /> Select</span><span><ArrowUpRight size={12} /> Open</span><kbd>Esc</kbd></footer>
    </section>
  </div>
}
