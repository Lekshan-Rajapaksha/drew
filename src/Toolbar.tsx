import {
  ArrowDownToLine, ArrowLeft, ArrowRight, Ellipsis, House, KeyRound, LockKeyhole, Maximize2, Minus,
  PanelTopClose, PanelTopOpen, Puzzle, RotateCw, Search, ShieldAlert, Sparkles, Star, X,
} from 'lucide-react'
import type { RefObject } from 'react'
import type { Tab } from '../shared/model'
import { HOME } from '../shared/model'
import { command, type Page } from './state'
import { Tool } from './ui'

export function Toolbar({ variant, toggleToolbar, active, input, setInput, field, submit, bookmark, saved, toggleMenu, menu, open, focus, onBlur, suggestions, suggestionIndex, onKeyDown }: {
  variant: 'top' | 'side' | 'palette'; toggleToolbar: () => void; active?: Tab; input: string; setInput: (value: string) => void; field: RefObject<HTMLInputElement | null>
  submit: (value: string) => void; bookmark: () => void; saved: boolean
  toggleMenu: (menu: 'options' | 'extensions') => void; menu: string | null
  open: (page: Page | 'assistant') => void; focus: () => void; onBlur: () => void
  suggestions: { title: string; url: string }[]; suggestionIndex: number; onKeyDown: React.KeyboardEventHandler<HTMLInputElement>
}) {
  const action = (name: 'back' | 'forward' | 'reload' | 'stop' | 'home') => {
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
      <Tool label="Home" onClick={() => action('home')}><House size={16} /></Tool>
    </div>}
    <div className="address-wrap">
      <form className="address" onSubmit={event => { event.preventDefault(); submit(suggestions[suggestionIndex]?.url ?? input) }}>
        {active?.loading ? <span className="spinner small" /> : atHome ? <Search size={16} />
          : active?.url.startsWith('https://') && !active.error ? <span title="HTTPS connection"><LockKeyhole size={14} /></span>
          : <span title="Connection status"><ShieldAlert size={15} /></span>}
        <input ref={field} spellCheck={false} autoCapitalize="off" autoComplete="off" aria-label="Address and search"
          role="combobox" aria-expanded={suggestions.length > 0} aria-autocomplete="list" aria-controls={suggestions.length ? 'address-suggestions' : undefined}
          aria-activedescendant={suggestionIndex >= 0 ? 'suggestion-' + suggestionIndex : undefined}
          placeholder={variant === 'side' ? 'Search or URL' : 'Search or enter a URL'} value={input} onChange={event => setInput(event.target.value)} onFocus={focus} onBlur={onBlur} onKeyDown={onKeyDown} />
        <Tool label={saved ? 'Edit bookmark' : 'Bookmark this page'} disabled={atHome} className={saved ? 'starred' : ''} onClick={bookmark}><Star size={16} /></Tool>
      </form>
      {suggestions.length > 0 && <div className="suggestions" role="listbox" id="address-suggestions">
        {suggestions.map(({ title, url }, index) => <button type="button" role="option" aria-selected={index === suggestionIndex} id={'suggestion-' + index}
          key={url} onMouseDown={event => event.preventDefault()} onClick={() => submit(url)}><Search size={15} /><span>{title}</span><small>{url}</small></button>)}
      </div>}
    </div>
    {variant !== 'palette' && <div className="toolbar-actions">
      {variant === 'top' && <Tool label="Extensions" onClick={() => open('extensions')}><Puzzle size={17} /></Tool>}
      <Tool label="Browser menu" onClick={() => toggleMenu('options')}><Ellipsis size={20} /></Tool>
      {variant === 'top' && window.lexn.platform !== 'darwin' && <WindowControls />}
      {menu && <div className="browser-menu">
        {menu === 'options' && <>
          <button onClick={toggleToolbar}>{variant === 'top' ? <PanelTopClose size={16} /> : <PanelTopOpen size={16} />} {variant === 'top' ? 'Hide top toolbar' : 'Show top toolbar'}</button>
          <button onClick={() => open('downloads')}><ArrowDownToLine size={16} /> Downloads</button>
          <button onClick={() => open('assistant')}><Sparkles size={16} /> Page assistant</button>
          <button onClick={() => open('extensions')}><Puzzle size={16} /> Extensions</button>
          <button onClick={() => open('passwords')}><KeyRound size={16} /> Passwords</button>
          <button onClick={() => open('settings')}>Settings</button>
        </>}
      </div>}
    </div>}
  </div>
}

export function WindowControls() {
  return <div className="windows-controls">
    <Tool label="Minimize window" onClick={() => { void command('windows', 'minimize') }}><Minus size={15} /></Tool>
    <Tool label="Maximize or restore window" onClick={() => { void command('windows', 'maximize') }}><Maximize2 size={14} /></Tool>
    <Tool label="Close window" onClick={() => { void command('windows', 'close') }}><X size={17} /></Tool>
  </div>
}
