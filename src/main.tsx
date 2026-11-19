import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { createRoot } from 'react-dom/client'
import { AlertTriangle, Clock3, Globe2, LayoutPanelLeft, Pin, Puzzle, RotateCw, Star, X } from 'lucide-react'
import {
  accents, HOME, type Bookmark, type Favorite, type Tab, type Workspace,
} from '../shared/model'
import { webUrl } from '../shared/navigation'
import { CommandBar } from './CommandBar'
import { SplitView } from './SplitView'
import { Assistant } from './assistant'
import { Home } from './Home'
import { BookmarksPage, DownloadsPage, HistoryPage } from './Library'
import { Passwords } from './Passwords'
import { Settings } from './Settings'
import { ServiceRail } from './ServiceRail'
import { Sidebar } from './Sidebar'
import { command, useApp, type Page } from './state'
import { Toolbar, WindowControls } from './Toolbar'
import { Mark, Overlay, Tool } from './ui'
import './styles.css'

type Modal =
  | { kind: 'workspace'; space?: Workspace; sameProfile?: boolean }
  | { kind: 'bookmark'; item?: Bookmark; source?: Tab }
  | { kind: 'group'; parent?: string }
  | { kind: 'folder' }
  | { kind: 'confirm'; title: string; description: string; action: () => Promise<void> }

function Dialog({ modal, close }: { modal: Modal; close: () => void }) {

  const browser = useApp(state => state.browser)
  const initial = modal.kind === 'workspace' ? modal.space?.name
    : modal.kind === 'bookmark' ? modal.item?.title ?? modal.source?.title : ''
  const [name, setName] = useState(initial ?? '')
  const [url, setUrl] = useState(modal.kind === 'bookmark' ? modal.item?.url ?? modal.source?.url ?? '' : '')
  const [folder, setFolder] = useState(modal.kind === 'bookmark' ? modal.item?.folderId ?? '' : '')
  const [accent, setAccent] = useState(modal.kind === 'workspace' ? modal.space?.accent ?? accents[0] : accents[0])
  const current = browser?.workspaces.find(space => space.id === browser.workspaceId)
  const [profileId, setProfileId] = useState(current?.profileId ?? current?.id ?? '')
  const [icon, setIcon] = useState(modal.kind === 'workspace' ? modal.space?.icon ?? '' : '')
  const [busy, setBusy] = useState(false)
  const title = modal.kind === 'workspace' ? (modal.space ? 'Edit Space' : modal.sameProfile ? 'New Space' : 'New profile')
    : modal.kind === 'bookmark' ? (modal.item ? 'Edit bookmark' : 'Add bookmark')
      : modal.kind === 'group' ? 'New tab group' : modal.kind === 'folder' ? 'New folder'
        : modal.kind === 'confirm' ? modal.title : ''
  const save = async () => {
    setBusy(true)
    let ok = false
    switch (modal.kind) {
      case 'workspace':
        ok = await command('saveWorkspace', modal.space?.id ?? null, name, accent, modal.sameProfile ? profileId : null, icon)
        if (ok && !modal.space) useApp.getState().setPage(null)
        break
      case 'bookmark': ok = await command('saveBookmark', modal.item?.id ?? null, name, url, folder || null); break
      case 'group': ok = await command('addGroup', name, modal.parent); break
      case 'folder': ok = await command('addFolder', name); break
      case 'confirm': close(); await modal.action(); return
    }
    if (ok) close()
    else setBusy(false)
  }
  return <Overlay title={title} close={close}>
    <form className="modal-form" onSubmit={event => { event.preventDefault(); void save() }}>
      {modal.kind === 'confirm' ? <p className="muted">{modal.description}</p> : <label>
        {modal.kind === 'bookmark' ? 'Title' : 'Name'}
        <input autoFocus required value={name} maxLength={modal.kind === 'workspace' ? 48 : modal.kind === 'bookmark' ? 512 : 64}
          onChange={event => setName(event.target.value)} />
      </label>}
      {modal.kind === 'bookmark' && <>
        <label>Website URL<input required value={url} onChange={event => setUrl(event.target.value)} placeholder="https://example.com" /></label>
        <label>Folder<select value={folder} onChange={event => setFolder(event.target.value)}>
          <option value="">No folder</option>{browser?.folders.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select></label>
      </>}
      {modal.kind === 'workspace' && <>
        <label>Space icon<input value={icon} maxLength={12} placeholder="Optional symbol" onChange={event => setIcon(event.target.value)} /></label>
        {modal.sameProfile && <label>Profile<select value={profileId} onChange={event => setProfileId(event.target.value)}>
          {browser?.workspaces.filter(item => !item.profileId).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select></label>}
      </>}
      {modal.kind === 'workspace' && <div className="swatches" aria-label="Accent color">{accents.map(color =>
        <button key={color} type="button" aria-label={color} aria-pressed={color === accent} onClick={() => setAccent(color)} style={{ background: color }} />)}</div>}
      <div className="modal-actions">
        {modal.kind === 'bookmark' && modal.item && <button className="secondary destructive" type="button" onClick={() => {
          if (modal.item) void command('deleteBookmark', modal.item.id).then(ok => { if (ok) close() })
        }}>Remove bookmark</button>}
        <button className="secondary" type="button" onClick={close}>Cancel</button>
        <button className="primary" type="submit" disabled={busy}>{modal.kind === 'confirm' ? 'Clear data' : 'Save'}</button>
      </div>
    </form>
  </Overlay>
}

type Menu = 'options' | 'extensions'
type Suggestion = { title: string; url: string }

function Browser() {
  const browser = useApp(state => state.browser)
  const page = useApp(state => state.page)
  const error = useApp(state => state.error)
  const { setBrowser, setPage, setError } = useApp.getState()
  const [width, setWidth] = useState(() => Math.min(360, Math.max(242, Number(localStorage.getItem('sidebar-width')) || 284)))
  const [requestedCollapse, setCollapsed] = useState(() => localStorage.getItem('sidebar-collapsed') === 'true')
  const [modal, setModal] = useState<Modal | null>(null)
  const [assistantOpen, setAssistantOpen] = useState(false)
  const [palette, setPalette] = useState<'address' | 'command' | 'split' | null>(null)
  const [splitIds, setSplitIds] = useState<string[]>([])
  const [dragging, setDragging] = useState<string | null>(null)
  const [favoriteMenu, setFavoriteMenu] = useState<{ favorite: Favorite; x: number; y: number } | null>(null)
  const [menu, setMenu] = useState<Menu | null>(null)
  const [context, setContext] = useState<{ tab: Tab; x: number; y: number } | null>(null)
  const [editing, setEditing] = useState(false)
  const [address, setAddress] = useState('')
  const [selected, setSelected] = useState(-1)
  const [results, setResults] = useState<Suggestion[]>([])
  const [systemDark, setSystemDark] = useState(() => matchMedia('(prefers-color-scheme: dark)').matches)
  const field = useRef<HTMLInputElement>(null)
  const viewport = useRef<HTMLDivElement>(null)
  const spaces = browser?.workspaces ?? []
  const space = spaces.find(item => item.id === browser?.workspaceId)
  const active = browser?.tabs.find(tab => tab.id === space?.activeTab)
  const activeUrl = active && active.url !== HOME ? active.url : ''
  const saved = browser?.bookmarks.find(bookmark => bookmark.url === activeUrl)
  const external = Boolean(activeUrl && !active?.error && !page)
  const suggestions = editing && address.trim() && address !== activeUrl ? results : []
  const locked = browser?.settings.keepSidebarOpen ?? false
  const collapsed = requestedCollapse && !locked
  const topToolbar = browser?.settings.topToolbar ?? false
  const overlay = Boolean(modal || context || palette || favoriteMenu || dragging)
  const splitTabs = splitIds.map(id => browser?.tabs.find(tab => tab.id === id && tab.workspaceId === space?.id))
    .filter((tab): tab is Tab => Boolean(tab && tab.url !== HOME))
  const splitVisible = splitTabs.length >= 2 && !page
  const splitKey = splitTabs.map(tab => tab.id).join(',')
  const showView = external && !overlay
  const reserve = external && !overlay && topToolbar ? Math.max(suggestions.length ? 16 + suggestions.length * 36 : 0, menu ? 165 : 0) : 0

  useEffect(() => {
    const off = window.lexn.onState(setBrowser)
    window.lexn.getState().then(setBrowser).catch(error => setError(String(error)))
    return off
  }, [setBrowser, setError])
  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)')
    const change = () => setSystemDark(media.matches)
    media.addEventListener('change', change)
    return () => media.removeEventListener('change', change)
  }, [])
  useEffect(() => {
    const off = window.lexn.onShortcut(name => {
      if (name === 'address' || name === 'command' || name === 'split') {
        setMenu(null); setPalette(name); setContext(null); setFavoriteMenu(null)
      } else if (name === 'toolbar') {
        const visible = useApp.getState().browser?.settings.topToolbar ?? false
        setMenu(null); setPalette(null); void command('setSetting', 'topToolbar', !visible)
      }
      else if (name === 'browse') { setMenu(null); setPalette(null); setEditing(false); setPage(null) }
      else if (name === 'sidebar') {
        if (useApp.getState().browser?.settings.keepSidebarOpen) return
        setCollapsed(previous => { localStorage.setItem('sidebar-collapsed', String(!previous)); return !previous })
      }
      else { setMenu(null); setPalette(null); setEditing(false); setPage(name) }
    })
    return off
  }, [setPage])
  useEffect(() => {
    if (!editing || !address.trim() || address === activeUrl) return
    let valid = true
    const query = address.trim().toLowerCase().slice(0, 512)
    const timer = setTimeout(() => {
      window.lexn.history(query).then(history => {
        if (!valid) return
        const bookmarks = useApp.getState().browser?.bookmarks.filter(item =>
          (item.title + ' ' + item.url).toLowerCase().includes(query)) ?? []
        const distinct = new Map<string, Suggestion>()
        for (const item of [...bookmarks, ...history]) {
          if (item.url !== activeUrl && !distinct.has(item.url)) distinct.set(item.url, { title: item.title, url: item.url })
          if (distinct.size === 5) break
        }
        setResults([...distinct.values()])
      }).catch(() => { if (valid) setResults([]) })
    }, 100)
    return () => { valid = false; clearTimeout(timer) }
  }, [editing, address, activeUrl, space?.id])
  useLayoutEffect(() => {
    const node = viewport.current
    if ((!showView && !splitVisible) || overlay || !node) { window.lexn.layout(null); return }
    const bounds = (element: Element) => {
      const rect = element.getBoundingClientRect()
      return { x: Math.ceil(rect.x) + 1, y: Math.ceil(rect.y) + 1, width: Math.floor(rect.width) - 2, height: Math.floor(rect.height) - 2 }
    }
    const panes = [...node.querySelectorAll<HTMLElement>('[data-pane]')]
    const layout = () => {
      if (panes.length) window.lexn.layout(panes.map(element => ({ ...bounds(element), id: element.dataset.pane! })))
      else window.lexn.layout(bounds(node))
    }
    layout()
    const observer = new ResizeObserver(layout)
    for (const element of [node, ...panes]) observer.observe(element)
    window.addEventListener('resize', layout)
    node.closest('.browser')?.addEventListener('transitionend', layout)
    return () => { observer.disconnect(); window.removeEventListener('resize', layout); node.closest('.browser')?.removeEventListener('transitionend', layout) }
  }, [showView, reserve, topToolbar, overlay, splitVisible, splitKey])
  useEffect(() => {
    if (!menu && !context && !modal && !palette && !favoriteMenu) return
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setMenu(null); setContext(null); setModal(null); setPalette(null); setFavoriteMenu(null) }
    }
    document.addEventListener('keydown', dismiss)
    return () => document.removeEventListener('keydown', dismiss)
  }, [menu, context, modal, palette, favoriteMenu])
  useEffect(() => {
    if (!error) return
    const timer = setTimeout(() => setError(''), 7000)
    return () => clearTimeout(timer)
  }, [error, setError])

  const toggle = () => {
    if (locked) return
    setCollapsed(previous => {
      localStorage.setItem('sidebar-collapsed', String(!previous))
      return !previous
    })
  }
  const resize = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    const start = event.clientX
    const grip = event.currentTarget
    grip.setPointerCapture(event.pointerId)
    const move = (motion: PointerEvent) => {
      const next = Math.round(Math.max(242, Math.min(360, width + motion.clientX - start)))
      setWidth(next)
      localStorage.setItem('sidebar-width', String(next))
    }
    grip.addEventListener('pointermove', move)
    grip.addEventListener('lostpointercapture', () => grip.removeEventListener('pointermove', move), { once: true })
  }
  const open = (page: Page | 'assistant') => {
    setMenu(null)
    setPalette(null)
    setEditing(false)
    if (page === 'assistant') setAssistantOpen(previous => !previous)
    else setPage(page)
  }
  const select = (id: string) => {
    setEditing(false); setMenu(null); setPalette(null); setPage(null); if (!splitIds.includes(id)) setSplitIds([]); void command('selectTab', id)
  }
  const navigate = (value: string) => {
    setEditing(false); setMenu(null); setPalette(null); setPage(null); field.current?.blur()
    if (page || !active) void command('newTab', value)
    else void command('navigate', active.id, value)
  }
  const switchProfile = (id: string) => {
    setPalette(null); setMenu(null); setEditing(false); setResults([]); setPage(null)
    setSplitIds([]); setContext(null); setFavoriteMenu(null)
    void command('workspace', id)
  }
  const newTab = () => { setMenu(null); setPalette('command') }
  const addSplit = (id: string) => {
    const tab = browser?.tabs.find(item => item.id === id && item.workspaceId === space?.id && item.url !== HOME)
    if (!tab) return
    const existing = splitTabs.length > 1 ? splitTabs.map(item => item.id) : activeUrl && active ? [active.id] : []
    if (!existing.length) { select(id); return }
    if (!existing.includes(id) && existing.length < 4) setSplitIds([...existing, id])
    setPalette(null); setContext(null); setPage(null)
  }
  const confirm = (title: string, description: string, action: () => Promise<void>) =>
    setModal({ kind: 'confirm', title, description, action })

  if (!browser || !space) return <main className="startup"><Mark />{error || 'Opening LexN Browser…'}</main>
  const light = browser.settings.theme === 'light' || (browser.settings.theme === 'system' && !systemDark)
  const toggleToolbar = () => {
    setMenu(null); setPalette(null); setEditing(false)
    void command('setSetting', 'topToolbar', !topToolbar)
  }
  const toolbar = (variant: 'top' | 'side' | 'palette') => <Toolbar variant={variant} toggleToolbar={toggleToolbar} active={active} input={editing ? address : activeUrl} setInput={value => {
        setAddress(value); setSelected(-1); setResults([])
      }} field={field} submit={navigate} saved={Boolean(saved)}
        bookmark={() => { if (active && webUrl(activeUrl)) setModal({ kind: 'bookmark', item: saved, source: active }) }}
        toggleMenu={value => setMenu(menu === value ? null : value)} menu={menu} open={open}
        focus={() => { setAddress(activeUrl); setResults([]); setSelected(-1); setEditing(true) }} onBlur={() => setEditing(false)}
        suggestions={suggestions} suggestionIndex={selected}
        onKeyDown={event => {
          if (event.key === 'Escape') { field.current?.blur(); setPalette(null); return }
          if (!suggestions.length) return
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            if (selected < 0 && event.key === 'ArrowUp') { setSelected(suggestions.length - 1); return }
            const step = event.key === 'ArrowDown' ? 1 : -1
            setSelected(index => (index + step + suggestions.length) % suggestions.length)
          }
        }} />
  return <div className={`browser spatial-browser ${collapsed ? 'spatial-collapsed' : ''} ${light ? 'light' : ''} ${topToolbar ? 'with-top-toolbar' : 'sidebar-first'} ${window.lexn.platform === 'darwin' ? 'mac' : 'windows'}`}
    style={{ '--sidebar-width': width + 'px', '--accent': space.accent } as CSSProperties}
    onPointerDown={event => {
      if (menu && event.target instanceof Element && !event.target.closest('.toolbar-actions')) setMenu(null)
      if (favoriteMenu && event.target instanceof Element && !event.target.closest('.context-menu')) setFavoriteMenu(null)
      if (context && event.target instanceof Element && !event.target.closest('.context-menu')) setContext(null)
    }}>
    <ServiceRail collapsed={collapsed} page={page} open={open} newTab={newTab}
      address={() => { setMenu(null); setPalette('address') }} expand={toggle} spaces={spaces} active={space.id} select={switchProfile} />
    <Sidebar browser={browser} space={space} active={active} page={page} collapsed={collapsed} locked={locked} toggle={toggle}
      chrome={!topToolbar ? toolbar('side') : null} switchProfile={switchProfile} select={select} newTab={newTab}
      workspaceEditor={(space, sameProfile) => setModal({ kind: 'workspace', space, sameProfile })}
      groupEditor={parent => setModal({ kind: 'group', parent })} resize={resize}
      dragTab={setDragging} openFavorite={id => { setPage(null); setSplitIds([]); void command('openFavorite', id) }}
      favoriteMenu={(event, favorite) => {
        event.preventDefault()
        setFavoriteMenu({ favorite, x: event.clientX, y: Math.min(event.clientY, innerHeight - 65) })
      }}
      context={(event, tab) => {
        event.preventDefault()
        setContext({ tab, x: Math.min(event.clientX, innerWidth - 228), y: Math.min(event.clientY, innerHeight - 225) })
      }} />
    <main className="main">
      {topToolbar && toolbar('top')}
      {window.lexn.platform !== 'darwin' && !topToolbar && <div className="window-controls-strip"><WindowControls /></div>}

      <div className="content-layout">
      <section ref={viewport} className={'viewport' + (external ? ' website' : '')} style={reserve ? { marginTop: reserve + 8 } : undefined}>
        {splitVisible && <SplitView panes={splitTabs} remove={id => setSplitIds(current => current.filter(item => item !== id))} add={() => setPalette('split')} />}
        {page === 'passwords' && <Passwords key={space.profileId ?? space.id} entries={browser.passwords} />}
        {page === 'extensions' && <div className="management">
          <header className="page-head"><span className="page-icon"><Puzzle size={24} /></span><div><h1>Extensions</h1><p>Extensions installed in this Profile</p></div>
            <button type="button" className="primary" onClick={() => { void command('loadExtension') }}>Load unpacked</button>
          </header>
          {!browser.extensions.length && <p className="muted">No extensions installed.</p>}
          <div className="records">{browser.extensions.map(extension => <article className="record" key={extension.id}>
            <div className="record-link"><strong>{extension.name}</strong><span>{extension.version}</span></div>
            {extension.popup && <button type="button" className="secondary" onClick={() => { void command('runExtension', extension.id) }}>Open</button>}
            <button type="button" className="secondary" onClick={() => { void command('removeExtension', extension.id) }}>Remove</button>
          </article>)}</div>
        </div>}
        {page === 'archive' && <div className="management">
          <header className="page-head"><span className="page-icon"><Clock3 size={24} /></span><div><h1>Archived tabs</h1><p>{space.name}</p></div></header>
          {!browser.archived.length && <p className="muted">No archived tabs.</p>}
          <div className="records">{browser.archived.map(tab => <article className="record" key={tab.id}>
            <button className="record-link" type="button" onClick={() => { setPage(null); void command('restoreArchived', tab.id) }}><strong>{tab.title}</strong><span>{tab.url}</span></button>
          </article>)}</div>
        </div>}
        {page === 'bookmarks' && <BookmarksPage key={space.id} browser={browser} open={navigate} edit={item => setModal({ kind: 'bookmark', item })} addFolder={() => setModal({ kind: 'folder' })} />}
        {page === 'history' && <HistoryPage key={space.id} open={navigate} confirm={action => confirm('Clear history', 'Delete all recorded visits from this profile.', action)} />}
        {page === 'downloads' && <DownloadsPage browser={browser} />}
        {page === 'settings' && <Settings key={space.id} browser={browser} confirm={confirm} />}
        {!splitVisible && !page && !active?.error && (!active || active.url === HOME) && <Home key={active?.id} activeId={active?.id}
          bookmarks={browser.bookmarks} background={browser.settings.background} navigate={navigate} library={open} />}
        {!splitVisible && !page && active?.error && <div className="page-error">
          <span className="page-icon"><Globe2 size={26} /></span><h1>This page couldn’t load</h1>
          <p>{activeUrl}</p><code>{active.error}</code>
          <button type="button" className="primary" onClick={() => { void command('pageAction', active.id, 'reload') }}><RotateCw size={16} /> Try again</button>
        </div>}
        {dragging && dragging !== active?.id && activeUrl && <div className="split-drop" onDragOver={event => event.preventDefault()}
          onDrop={event => { event.preventDefault(); const id = event.dataTransfer.getData('application/x-lexn-tab'); setDragging(null); if (id) addSplit(id) }}>Drop to add a split pane</div>}
      </section>
      {assistantOpen && <Assistant tab={active} close={() => setAssistantOpen(false)} />}
      </div>
    </main>
    {palette && <CommandBar key={palette} initial={palette === 'address' ? activeUrl : ''} split={palette === 'split'}
      tabs={browser.tabs.filter(tab => tab.workspaceId === space.id && (palette !== 'split' ||
        (tab.url !== HOME && tab.id !== active?.id && !splitIds.includes(tab.id))))}
      close={() => setPalette(null)} select={palette === 'split' ? addSplit : select}
      navigate={value => {
        if (palette === 'address') navigate(value)
        else { setPage(null); setPalette(null); setSplitIds([]); void command('newTab', value) }
      }}
      actions={palette === 'split' ? [] : [
        { label: 'Clear Cache', run: () => { setPalette(null); void command('clearData', 'cache') } },
        { label: 'Split View', run: () => setPalette('split') },
        ...(locked ? [] : [{ label: collapsed ? 'Show Sidebar' : 'Hide Sidebar', run: () => { setPalette(null); toggle() } }]),
        { label: 'Archived Tabs', run: () => open('archive') },
        { label: 'Passwords', run: () => open('passwords') },
        { label: 'Extensions', run: () => open('extensions') },
        ...browser.extensions.filter(extension => extension.popup).map(extension => ({
          label: extension.name, run: () => { setPalette(null); void command('runExtension', extension.id) },
        })),
        { label: 'Settings', run: () => open('settings') },
        { label: 'New Blank Tab', run: () => { setPalette(null); setPage(null); setSplitIds([]); void command('newTab') } },
      ]} />}
    {favoriteMenu && <div className="context-menu" style={{ left: favoriteMenu.x, top: favoriteMenu.y }}>
      <button type="button" onClick={() => { void command('removeFavorite', favoriteMenu.favorite.id); setFavoriteMenu(null) }}><X size={15} /> Remove favorite</button>
    </div>}
    {context && <div className="context-menu" style={{ left: context.x, top: context.y }}>
      <button type="button" onClick={() => { void command('pinTab', context.tab.id); setContext(null) }}><Pin size={15} /> {context.tab.pinned ? 'Unpin tab' : 'Pin tab'}</button>
      {context.tab.url !== HOME && <button type="button" onClick={() => { void command('favorite', context.tab.id); setContext(null) }}><Star size={15} /> Add to Favorites</button>}
      {context.tab.id !== active?.id && context.tab.url !== HOME && activeUrl && <button type="button" onClick={() => addSplit(context.tab.id)}><LayoutPanelLeft size={15} /> Add to Split View</button>}
      <label>Tab group<select aria-label="Move tab to group" value={context.tab.groupId ?? ''} onChange={event => {
        void command('groupTab', context.tab.id, event.target.value || null); setContext(null)
      }}><option value="">Ungrouped</option>{browser.groups.filter(group => group.workspaceId === space.id).map(group =>
        <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>
      <button type="button" onClick={() => { void command('closeTab', context.tab.id); setContext(null) }}><X size={15} /> Close tab</button>
    </div>}
    {modal && <Dialog modal={modal} close={() => setModal(null)} />}
    {error && <div className={'toast' + (external && !overlay ? ' toast-top' : '')} role="alert"><AlertTriangle size={17} /><span>{error}</span>
      <Tool label="Dismiss error" onClick={() => setError('')}><X size={15} /></Tool></div>}
  </div>
}

createRoot(document.getElementById('root')!).render(<Browser />)
