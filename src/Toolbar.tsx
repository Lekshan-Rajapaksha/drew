import {
  Archive, ArrowDownToLine, ArrowLeft, ArrowRight, Bookmark, Clock3, Ellipsis, Heart, House, KeyRound,
  PanelTopClose, PanelTopOpen, Plus, Puzzle, RotateCw, Search, Settings2, Sparkles, SquarePlus, Star, X,
} from 'lucide-react'
import type { RefObject } from 'react'
import type { Tab } from '../shared/model'
import { HOME } from '../shared/model'
import { command, type Page } from './state'
import { Favicon, Tool } from './ui'

export function Toolbar({ variant, toggleToolbar, active, input, setInput, field, submit, bookmark, saved, favorite, favorited, toggleMenu, menu, open, focus, onBlur, suggestions, suggestionIndex, onKeyDown, goHome, newWindow, minimal }: {
  variant: 'top' | 'side' | 'palette'; toggleToolbar: () => void; active?: Tab; input: string; setInput: (value: string) => void; field: RefObject<HTMLInputElement | null>
  submit: (value: string) => void; bookmark: () => void; saved: boolean; favorite: () => void; favorited: boolean
  toggleMenu: (menu: 'options' | 'extensions') => void; menu: string | null
  open: (page: Page | 'assistant') => void; focus: () => void; onBlur: () => void
  goHome: () => void; newWindow: () => void
  minimal?: boolean
  suggestions: { title: string; url: string }[]; suggestionIndex: number; onKeyDown: React.KeyboardEventHandler<HTMLInputElement>
}) {
  const action = (name: 'back' | 'forward' | 'reload' | 'stop') => {
    if (active) void command('pageAction', active.id, name)
  }
  const atHome = !active || active.url === HOME
  return <div className={'toolbar toolbar-' + variant}>
    {variant !== 'palette' && <div className="nav-cluster">
      <Tool label="Back" disabled={!active?.back} onClick={() => action('back')}><ArrowLeft size={17} /></Tool>
      <Tool label="Forward" disabled={!active?.forward} onClick={() => action('forward')}><ArrowRight size={17} /></Tool>
      <Tool label={active?.loading ? 'Stop loading' : 'Reload'} onClick={() => action(active?.loading ? 'stop' : 'reload')}>
        {active?.loading ? <X size={17} /> : <RotateCw size={16} />}
      </Tool>
      <Tool label="Home" onClick={goHome}><House size={16} /></Tool>
    </div>}
    <div className="address-wrap">
      <form className="address" onSubmit={event => { event.preventDefault(); submit(suggestions[suggestionIndex]?.url ?? input) }}>
        {active?.loading ? <span className="spinner small" /> : atHome ? <Search size={16} />
          : active && <span className="address-site-icon" title={active.url.startsWith('https://') && !active.error ? 'HTTPS connection' : 'Connection status'}>
            <Favicon tab={active} />
          </span>}
        <input ref={field} spellCheck={false} autoCapitalize="off" autoComplete="off" aria-label="Address and search"
          role="combobox" aria-expanded={suggestions.length > 0} aria-autocomplete="list" aria-controls={suggestions.length ? 'address-suggestions' : undefined}
          aria-activedescendant={suggestionIndex >= 0 ? 'suggestion-' + suggestionIndex : undefined}
          placeholder={variant === 'side' ? 'Search or URL' : 'Search or enter a URL'} value={input} onChange={event => setInput(event.target.value)} onFocus={focus} onBlur={onBlur} onKeyDown={onKeyDown} />
      {!minimal && !atHome && <Tool label={favorited ? 'Edit page favorite' : 'Add page to Favorites'} className={favorited ? 'starred' : ''}
          onClick={favorite}><Heart size={15} /></Tool>}
        <Tool label={saved ? 'Edit bookmark' : 'Bookmark this page'} disabled={atHome} className={saved ? 'starred' : ''} onClick={bookmark}><Star size={16} /></Tool>
      </form>
      {suggestions.length > 0 && <div className="suggestions" role="listbox" id="address-suggestions">
        {suggestions.map(({ title, url }, index) => <button type="button" role="option" aria-selected={index === suggestionIndex} id={'suggestion-' + index}
          key={url} onMouseDown={event => event.preventDefault()} onClick={() => submit(url)}><Search size={15} /><span>{title}</span><small>{url}</small></button>)}
      </div>}
    </div>
    {variant !== 'palette' && <div className="toolbar-actions">
      {variant === 'top' && !minimal && <Tool label="Extensions" onClick={() => open('extensions')}><Puzzle size={17} /></Tool>}
      <Tool label="Browser menu" onClick={() => toggleMenu('options')}><Ellipsis size={20} /></Tool>
      {menu && <div className="browser-menu">
        {menu === 'options' && <>
          <button onClick={newWindow}><SquarePlus size={16} /> New Window</button>
          <button onClick={toggleToolbar}>{variant === 'top' ? <PanelTopClose size={16} /> : <PanelTopOpen size={16} />} {variant === 'top' ? 'Hide top toolbar' : 'Show top toolbar'}</button>
          <button onClick={() => open('bookmarks')}><Bookmark size={16} /> Bookmarks</button>
          <button onClick={() => open('history')}><Clock3 size={16} /> History</button>
          <button onClick={() => open('downloads')}><ArrowDownToLine size={16} /> Downloads</button>
          <button onClick={() => open('archive')}><Archive size={16} /> Archived tabs</button>
          <button onClick={() => open('assistant')}><Sparkles size={16} /> Page assistant</button>
          <button onClick={() => open('extensions')}><Puzzle size={16} /> Extensions</button>
          <button disabled={atHome} onClick={() => { toggleMenu('options'); void command('fillLogin') }}><KeyRound size={16} /> Fill saved login</button>
          <button onClick={() => open('passwords')}><KeyRound size={16} /> Passwords</button>
          <button onClick={() => open('settings')}><Settings2 size={16} /> Settings</button>
        </>}
      </div>}
    </div>}
  </div>
}

export function TopTabs({ tabs, active, select, close, add }: {
  tabs: Tab[]; active?: string; select: (id: string) => void; close: (id: string) => void; add: () => void
}) {
  return <nav className="top-tabs" aria-label="Top tabs">
    <div className="top-tabs-list">
      {tabs.map(tab => <div className="top-tab" key={tab.id} data-selected={tab.id === active}>
        <button type="button" className="top-tab-select" title={tab.title} aria-label={tab.title}
          aria-current={tab.id === active ? 'page' : undefined} onClick={() => select(tab.id)}><Favicon tab={tab} /><span>{tab.title}</span></button>
        <Tool label={'Close ' + tab.title} onClick={() => close(tab.id)}><X size={13} /></Tool>
      </div>)}
    </div>
    <Tool label="New tab" onClick={add}><Plus size={17} /></Tool>
  </nav>
}
