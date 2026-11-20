import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { AlertTriangle, Clock3, Globe2, LayoutPanelLeft, Pin, Puzzle, RotateCw, Star, X } from 'lucide-react'
import {
  accents, HOME, themeAccents, SIDEBAR_INSET, SIDEBAR_RADIUS, SIDEBAR_VERTICAL_GAP, WINDOW_CAPTION_HEIGHT, WINDOW_CONTROLS_INSET, WINDOW_CONTROLS_WIDTH, type Bookmark, type Favorite, type Tab, type Workspace,
} from '../shared/model'
import { webUrl } from '../shared/navigation'
import { AccentPicker } from './AccentPicker'
import { useSpaceGesture, type SwipePreview } from './useSpaceGesture'
import { CommandBar } from './CommandBar'
import { SplitView } from './SplitView'
import { Assistant } from './assistant'
import { Home } from './Home'
import { BookmarksPage, DownloadsPage, HistoryPage } from './Library'
import { Passwords } from './Passwords'
import { Settings, type SettingsSection } from './Settings'
import { Sidebar } from './Sidebar'
import { command, useApp, type Page } from './state'
import { Toolbar, TopTabs } from './Toolbar'
import { Welcome } from './Welcome'
import { WindowControls } from './WindowControls'
import { Overlay, Tool, Wordmark } from './ui'
import './styles.css'

type Modal =
  | { kind: 'workspace'; space?: Workspace; sameProfile?: boolean }
  | { kind: 'favorite'; favorite?: Favorite }
  | { kind: 'bookmark'; item?: Bookmark; source?: Tab }
  | { kind: 'group'; parent?: string }
  | { kind: 'folder' }
  | { kind: 'confirm'; title: string; description: string; action: () => Promise<void> }

function Dialog({ modal, close }: { modal: Modal; close: () => void }) {

  const browser = useApp(state => state.browser)
  const initial = modal.kind === 'favorite' ? modal.favorite?.title : modal.kind === 'workspace' ? modal.space?.name
    : modal.kind === 'bookmark' ? modal.item?.title ?? modal.source?.title : ''
  const [name, setName] = useState(initial ?? '')
  const [url, setUrl] = useState(modal.kind === 'favorite' ? modal.favorite?.url ?? '' : modal.kind === 'bookmark' ? modal.item?.url ?? modal.source?.url ?? '' : '')
  const [folder, setFolder] = useState(modal.kind === 'bookmark' ? modal.item?.folderId ?? '' : '')
  const [accent, setAccent] = useState(modal.kind === 'workspace' ? modal.space?.accent ?? accents[0] : accents[0])
  const current = browser?.workspaces.find(space => space.id === browser.workspaceId)
  const [profileId, setProfileId] = useState(current?.profileId ?? current?.id ?? '')
  const [icon, setIcon] = useState(modal.kind === 'favorite' ? modal.favorite?.icon ?? '' : modal.kind === 'workspace' ? modal.space?.icon ?? '' : '')
  const [busy, setBusy] = useState(false)
  const title = modal.kind === 'workspace' ? (modal.space ? 'Edit Space' : modal.sameProfile ? 'New Space' : 'New profile')
    : modal.kind === 'favorite' ? (modal.favorite ? 'Edit favorite' : 'Add favorite')
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
      case 'favorite': ok = await command('saveFavorite', modal.favorite?.id ?? null, url, name, icon); break
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
        {modal.kind === 'bookmark' || modal.kind === 'favorite' ? 'Title' : 'Name'}
        <input autoFocus required value={name} maxLength={modal.kind === 'workspace' ? 48 : modal.kind === 'bookmark' ? 512 : modal.kind === 'favorite' ? 120 : 64}
          onChange={event => setName(event.target.value)} />
      </label>}
      {modal.kind === 'favorite' && <>
        <label>Website URL<input type="url" required value={url} onChange={event => setUrl(event.target.value)} placeholder="https://example.com" /></label>
        <label>Icon<input value={icon} maxLength={12} placeholder="Optional emoji or short label" onChange={event => setIcon(event.target.value)} /></label>
      </>}
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
      {modal.kind === 'workspace' && <div><p className="muted">Space accent</p><AccentPicker color={accent} change={setAccent} /></div>}
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

function chromePopup(name: string) {
  const popup = window.open('about:blank', name)
  if (!popup) return null
  popup.document.documentElement.lang = document.documentElement.lang
  popup.document.documentElement.style.background = 'transparent'
  popup.document.head.append(...[...document.querySelectorAll('link[rel="stylesheet"]')].map(link => link.cloneNode()))
  return popup
}

function Browser() {
  const browser = useApp(state => state.browser)
  const page = useApp(state => state.page)
  const error = useApp(state => state.error)
  const { setBrowser, setPage, setError } = useApp.getState()
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('General')
  const [swipePreview, setSwipePreview] = useState<SwipePreview | null>(null)
  const [resized, setResized] = useState<number | null>(null)
  const [resizingSidebar, setResizingSidebar] = useState(false)
  const [pendingPin, setPendingPin] = useState<boolean | null>(null)
  const [captionContent, setCaptionContent] = useState<HTMLDivElement | null>(null)
  const [manualSidebar, setManualSidebar] = useState(false)
  const [hoverSidebar, setHoverSidebar] = useState(false)
  const [pointerZone, setPointerZone] = useState<'edge' | 'sidebar' | 'outside'>('outside')
  const pointerX = useRef<number | null>(null)
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
  const sidebarSlot = useRef<HTMLDivElement>(null)
  const sidebarWindow = useRef<Window | null>(null)
  const sidebarPresentation = useRef({ floating: false, collapsed: true })
  const [sidebarContent] = useState(() => document.createElement('div'))
  const spaces = browser?.workspaces ?? []
  const space = spaces.find(item => item.id === browser?.workspaceId)
  const profileId = browser?.profileId ?? ''
  const savedWidth = Number(browser?.settings.sidebarWidth) || 284
  const compact = browser?.settings.sidebarStyle === 'compact'
  const width = compact ? 76 : resized ?? savedWidth
  const active = browser?.tabs.find(tab => tab.id === space?.activeTab)
  const activeUrl = active && active.url !== HOME ? active.url : ''
  const favorite = browser?.favorites.find(item => item.url === activeUrl)
  const saved = browser?.bookmarks.find(bookmark => bookmark.url === activeUrl)
  const external = Boolean(activeUrl && !active?.error && !page)
  const suggestions = editing && address.trim() && address !== activeUrl ? results : []
  const locked = pendingPin ?? browser?.settings.keepSidebarOpen ?? false
  const welcome = browser?.welcomePending ?? false
  const isMac = window.lexn.platform === 'darwin'
  const collapsed = welcome || (!locked && !manualSidebar && !hoverSidebar)
  const topToolbar = browser?.settings.topToolbar ?? false
  const overlay = Boolean(welcome || modal || context || palette || favoriteMenu || dragging)
  const splitTabs = splitIds.map(id => browser?.tabs.find(tab => tab.id === id && tab.workspaceId === space?.id))
    .filter((tab): tab is Tab => Boolean(tab && tab.url !== HOME))
  const splitVisible = splitTabs.length >= 2 && !page
  const splitKey = splitTabs.map(tab => tab.id).join(',')
  const showView = external && !overlay
  const floatsAboveWebsite = !welcome && !locked && (external || splitVisible) &&
    !modal && !palette && !context && !favoriteMenu
  const reserve = external && !overlay && topToolbar ? Math.max(suggestions.length ? 16 + suggestions.length * 36 : 0, menu ? 397 : 0) : 0
  const animate = browser?.settings.motion !== 'off' && !matchMedia('(prefers-reduced-motion: reduce)').matches
  const theme = browser?.settings.theme === 'system' ? (systemDark ? 'dark' : 'light') : browser?.settings.theme ?? 'dark'
  const accent = browser?.settings.accentColor || themeAccents[theme] || space?.accent || accents[0]
  const accentEnd = browser?.settings.accentEnd || accent
  const intensity = { subtle: 0.45, balanced: 1, vivid: 1.8 }[browser?.settings.colorIntensity ?? 'balanced']
  const chromeClass = `browser spatial-browser ${theme} ${topToolbar ? 'with-top-toolbar' : 'sidebar-first'} ${isMac ? 'mac' : 'windows'} ${browser?.settings.motion === 'off' ? 'motion-off' : ''}` + (browser?.settings.accentEnd ? ' has-gradient' : '')
  const chromeStyle = {
    '--caption-height': WINDOW_CAPTION_HEIGHT + 'px', '--sidebar-inset': SIDEBAR_INSET + 'px',
    '--sidebar-gap': SIDEBAR_VERTICAL_GAP + 'px', '--caption-inset': WINDOW_CONTROLS_INSET + 'px',
    '--caption-width': WINDOW_CONTROLS_WIDTH + 'px', '--sidebar-radius': SIDEBAR_RADIUS + 'px', '--sidebar-width': width + 'px', '--accent': accent, '--accent-end': accentEnd, '--color-intensity': intensity,
  } as CSSProperties

  useLayoutEffect(() => {
    const node = viewport.current
    if ((!showView && !splitVisible) || overlay || !node) { window.lexn.layout(null); return }
    const bounds = (element: Element) => {
      const rect = element.getBoundingClientRect()
      const x = Math.round(rect.left)
      const y = Math.round(rect.top)
      return { x, y, width: Math.round(rect.right) - x, height: Math.round(rect.bottom) - y }
    }
    const panes = [...node.querySelectorAll<HTMLElement>('[data-pane]')]
    let lastLayout = ''
    const layout = () => {
      const next = panes.length ? panes.map(element => ({ ...bounds(element), id: element.dataset.pane! })) : bounds(node)
      const signature = JSON.stringify(next)
      if (signature === lastLayout) return
      lastLayout = signature
      window.lexn.layout(next)
    }
    layout()
    const observer = new ResizeObserver(layout)
    for (const element of [node, ...panes]) observer.observe(element)
    window.addEventListener('resize', layout)
    node.closest('.browser')?.addEventListener('transitionend', layout)
    return () => { observer.disconnect(); window.removeEventListener('resize', layout); node.closest('.browser')?.removeEventListener('transitionend', layout) }
  }, [showView, reserve, topToolbar, overlay, splitVisible, splitKey, locked])
  useLayoutEffect(() => {
    if (!sidebarSlot.current) return
    if (floatsAboveWebsite && !collapsed && !sidebarWindow.current) {
      sidebarWindow.current = chromePopup('drew-sidebar')
    }
    const popup = floatsAboveWebsite ? sidebarWindow.current : null
    sidebarContent.className = popup ? chromeClass + ' floating-sidebar' : 'sidebar-content'
    if (popup) {
      sidebarContent.style.setProperty('--caption-height', WINDOW_CAPTION_HEIGHT + 'px')
      sidebarContent.style.setProperty('--sidebar-gap', SIDEBAR_VERTICAL_GAP + 'px')
      sidebarContent.style.setProperty('--sidebar-radius', SIDEBAR_RADIUS + 'px')
      sidebarContent.style.setProperty('--sidebar-width', width + 'px')
      sidebarContent.style.setProperty('--accent', accent)
      sidebarContent.style.setProperty('--accent-end', accentEnd)
      sidebarContent.style.setProperty('--color-intensity', String(intensity))
    } else sidebarContent.removeAttribute('style')
    const container = popup?.document.body ?? sidebarSlot.current
    if (sidebarContent.parentElement !== container) container.append(sidebarContent)
    const previous = sidebarPresentation.current
    window.lexn.layoutSidebar(popup ? width : 0, !collapsed, animate && (previous.floating || previous.collapsed))
    sidebarPresentation.current = { floating: Boolean(popup), collapsed }
  }, [accent, accentEnd, animate, chromeClass, collapsed, floatsAboveWebsite, intensity, sidebarContent, width])

  const ready = Boolean(browser)
  useLayoutEffect(() => {
    if (isMac || !ready) return
    const popup = chromePopup('drew-window-controls')
    if (!popup) return
    const container = popup.document.createElement('div')
    popup.document.body.append(container)
    setCaptionContent(container)
  }, [isMac, ready])
  useLayoutEffect(() => {
    if (!captionContent) return
    captionContent.className = chromeClass + ' window-caption-view'
    captionContent.style.setProperty('--accent', accent)
    captionContent.style.setProperty('--accent-end', accentEnd)
    captionContent.style.setProperty('--color-intensity', String(intensity))
  }, [accent, accentEnd, captionContent, chromeClass, intensity])
  useEffect(() => {
    if (pendingPin !== null && pendingPin === browser?.settings.keepSidebarOpen) setPendingPin(null)
  }, [browser?.settings.keepSidebarOpen, pendingPin])

  useEffect(() => {
    const off = window.lexn.onState(setBrowser)
    window.lexn.getState().then(setBrowser).catch(error => setError(String(error)))
    return off
  }, [setBrowser, setError])
  useEffect(() => {
    const classify = (x: number | null) => setPointerZone(x === null || x >= width ? 'outside' : x <= 12 ? 'edge' : 'sidebar')
    classify(pointerX.current)
    return window.lexn.onPointer(x => {
      pointerX.current = x
      classify(x)
    })
  }, [width])
  const edgeZone = pointerZone === 'edge'
  const withinSidebar = pointerZone !== 'outside'
  const holdSidebar = Boolean(dragging || modal || palette || context || favoriteMenu || editing || resizingSidebar || swipePreview)
  const dismissDelay = { quick: 70, balanced: 140, relaxed: 350 }[browser?.settings.sidebarDismiss ?? 'balanced']
  useEffect(() => {
    if (edgeZone) {
      setHoverSidebar(true)
      return
    }
    if (!hoverSidebar || withinSidebar || holdSidebar) return
    const timer = setTimeout(() => {
      setHoverSidebar(false)
      setMenu(null)
    }, dismissDelay)
    return () => clearTimeout(timer)
  }, [edgeZone, withinSidebar, holdSidebar, hoverSidebar, dismissDelay])

  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)')
    const change = () => setSystemDark(media.matches)
    media.addEventListener('change', change)
    return () => media.removeEventListener('change', change)
  }, [])
  useEffect(() => {
    if (!resizingSidebar && resized === savedWidth) setResized(null)
  }, [resized, resizingSidebar, savedWidth])
  useEffect(() => {
    const off = window.lexn.onShortcut(name => {
      if (useApp.getState().browser?.welcomePending) return
      if (name === 'address' || name === 'command' || name === 'split') {
        setMenu(null); setPalette(name); setContext(null); setFavoriteMenu(null)
      } else if (name === 'toolbar') {
        const visible = useApp.getState().browser?.settings.topToolbar ?? false
        setMenu(null); setPalette(null); void command('setSetting', 'topToolbar', !visible)
      }
      else if (name === 'browse') { setMenu(null); setPalette(null); setEditing(false); setPage(null) }
      else if (name === 'sidebar') {
        const snapshot = useApp.getState().browser
        if (!snapshot || snapshot.settings.keepSidebarOpen) return
        setManualSidebar(previous => !previous)
        setHoverSidebar(false)
      }
      else {
        if (name === 'settings') setSettingsSection('General')
        setMenu(null); setPalette(null); setEditing(false); setPage(name)
      }
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

  useEffect(() => {
    if (!menu && !context && !modal && !palette && !favoriteMenu) return
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setMenu(null); setContext(null); setModal(null); setPalette(null); setFavoriteMenu(null) }
    }
    const documents = new Set([document, sidebarContent.ownerDocument])
    for (const doc of documents) doc.addEventListener('keydown', dismiss)
    return () => { for (const doc of documents) doc.removeEventListener('keydown', dismiss) }
  }, [menu, context, modal, palette, favoriteMenu, floatsAboveWebsite, sidebarContent])
  useEffect(() => {
    if (!error) return
    const timer = setTimeout(() => setError(''), 7000)
    return () => clearTimeout(timer)
  }, [error, setError])

  const toggle = () => {
    if (locked) return
    setManualSidebar(collapsed)
    setHoverSidebar(false)
  }
  const resize = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    const start = event.clientX
    const grip = event.currentTarget
    grip.setPointerCapture(event.pointerId)
    setResizingSidebar(true)
    let nextWidth = width
    const move = (motion: PointerEvent) => {
      nextWidth = Math.round(Math.max(242, Math.min(360, width + motion.clientX - start)))
      setResized(nextWidth)
    }
    grip.addEventListener('pointermove', move)
    grip.addEventListener('lostpointercapture', () => {
      setResizingSidebar(false)
      grip.removeEventListener('pointermove', move)
      void command('setSetting', 'sidebarWidth', String(nextWidth)).then(ok => {
        if (!ok) setResized(null)
      })
    }, { once: true })
  }
  const open = (page: Page | 'assistant') => {
    setMenu(null)
    setPalette(null)
    setEditing(false)
    if (page === 'assistant') setAssistantOpen(previous => !previous)
    else {
      if (page === 'settings') setSettingsSection('General')
      setPage(page)
    }
  }
  const select = (id: string) => {
    setEditing(false); setMenu(null); setPalette(null); setPage(null); if (!splitIds.includes(id)) setSplitIds([]); void command('selectTab', id)
  }
  const navigate = (value: string) => {
    setEditing(false); setMenu(null); setPalette(null); setPage(null); field.current?.blur()
    if (page || !active) void command('newTab', value)
    else void command('navigate', active.id, value)
  }
  const changeProfile = (id: string) => {
    setPalette(null); setMenu(null); setEditing(false); setResults([]); setPage(null)
    setSplitIds([]); setContext(null); setFavoriteMenu(null)
    return command('workspace', id)
  }
  const switchProfile = (id: string) => {
    cancelSwipe()
    if (id !== space?.id) void changeProfile(id)
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
  const { cancelSwipe, ...gesture } = useSpaceGesture(spaces, space?.id ?? '', changeProfile, collapsed ? 0 : width, setSwipePreview, animate && !collapsed)
  const confirm = (title: string, description: string, action: () => Promise<void>) =>
    setModal({ kind: 'confirm', title, description, action })

  if (!browser || !space) return <main className="startup"><Wordmark decorative />{error || 'Opening Drew…'}</main>
  const goHome = () => {
    setMenu(null); setPalette(null); setEditing(false); setSplitIds([]); setPage(null)
    field.current?.blur()
    void command('home')
  }
  const newWindow = () => { setMenu(null); setPalette(null); void command('newWindow') }
  const toggleToolbar = () => {
    setMenu(null); setPalette(null); setEditing(false)
    void command('setSetting', 'topToolbar', !topToolbar)
  }
  const toolbar = (variant: 'top' | 'side' | 'palette') => <Toolbar variant={variant} toggleToolbar={toggleToolbar} goHome={goHome} newWindow={newWindow} minimal={variant === 'top' && browser.settings.topActions === 'minimal'} active={active} input={editing ? address : activeUrl} setInput={value => {
        setAddress(value); setSelected(-1); setResults([])
      }} field={field} submit={navigate} saved={Boolean(saved)}
        bookmark={() => { if (active && webUrl(activeUrl)) setModal({ kind: 'bookmark', item: saved, source: active }) }}
        favorited={Boolean(favorite)} favorite={() => {
          if (favorite) setModal({ kind: 'favorite', favorite })
          else if (active && webUrl(activeUrl)) void command('favorite', active.id)
        }}
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
  const controls = !isMac && <WindowControls maximized={browser.windowMaximized} />
  const topTabs = topToolbar && browser.settings.topTabs !== 'hidden' && <TopTabs tabs={browser.tabs}
    active={page ? undefined : active?.id} select={select} close={id => { void command('closeTab', id) }} add={newTab} />
  return <div className={chromeClass + (collapsed ? ' spatial-collapsed' : '') + (locked ? ' sidebar-pinned' : '') + (external || splitVisible ? ' native-page' : '')}
    style={chromeStyle}
    {...gesture}
    onPointerDown={event => {
      const target = event.target as Element
      if (menu && !target.closest?.('.toolbar-actions')) setMenu(null)
      if (favoriteMenu && !target.closest?.('.context-menu')) setFavoriteMenu(null)
      if (context && !target.closest?.('.context-menu')) setContext(null)
    }}>
    {!topToolbar && <div className="window-drag-zone" aria-hidden="true" />}
    {captionContent ? createPortal(controls, captionContent) : controls}
    <div className="sidebar-slot" ref={sidebarSlot} />
    {createPortal(<Sidebar browser={browser} space={space} active={active} page={page} collapsed={collapsed} locked={locked} open={open}
      preview={animate && !collapsed ? swipePreview : null} compact={compact} systemDark={systemDark}
      address={() => { setMenu(null); setPalette('address') }}
      openActions={newTab}
      goHome={goHome}
      pinPending={pendingPin !== null} pinSidebar={() => {
        if (pendingPin !== null) return
        const next = !locked
        setPendingPin(next)
        setManualSidebar(false)
        setHoverSidebar(withinSidebar)
        void command('setSetting', 'keepSidebarOpen', next).then(ok => {
          if (!ok) setPendingPin(null)
        })
      }}
      chrome={!topToolbar ? toolbar('side') : null} switchProfile={switchProfile} select={select} newTab={newTab}
      workspaceEditor={(space, sameProfile) => setModal({ kind: 'workspace', space, sameProfile })}
      groupEditor={parent => setModal({ kind: 'group', parent })} resize={resize}
      dragTab={setDragging} openFavorite={id => { setPage(null); setSplitIds([]); void command('openFavorite', id) }}
      editFavorite={favorite => setModal({ kind: 'favorite', favorite })}
      favoriteMenu={(event, favorite) => {
        event.preventDefault()
        setFavoriteMenu({ favorite, x: Math.min(event.clientX, innerWidth - 210), y: Math.min(event.clientY, innerHeight - 105) })
      }}
      context={(event, tab) => {
        event.preventDefault()
        setContext({ tab, x: Math.min(event.clientX, innerWidth - 228), y: Math.min(event.clientY, innerHeight - 225) })
      }} />, sidebarContent)}
    <main className="main" inert={welcome}>
      {browser.settings.topTabs === 'above' && topTabs}
      {topToolbar && toolbar('top')}
      {browser.settings.topTabs === 'below' && topTabs}

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
        {page === 'settings' && <Settings key={profileId} browser={browser} confirm={confirm} section={settingsSection} setSection={setSettingsSection} goHome={goHome} />}
        {!splitVisible && !page && !active?.error && (!active || active.url === HOME) && <Home key={profileId + ':' + (active?.id ?? '')}
          settings={browser.settings} navigate={navigate} openHistory={() => open('history')}
          customize={() => { open('settings'); setSettingsSection('New Tab') }} />}
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
        { label: 'Bookmarks', run: () => open('bookmarks') },
        { label: 'History', run: () => open('history') },
        { label: 'Downloads', run: () => open('downloads') },
        { label: 'Archived Tabs', run: () => open('archive') },
        { label: 'Page assistant', run: () => open('assistant') },
        { label: 'Passwords', run: () => open('passwords') },
        { label: 'Extensions', run: () => open('extensions') },
        ...browser.extensions.filter(extension => extension.popup).map(extension => ({
          label: extension.name, run: () => { setPalette(null); void command('runExtension', extension.id) },
        })),
        { label: 'Settings', run: () => open('settings') },
        { label: 'New Window', run: newWindow },
        { label: 'New Blank Tab', run: () => { setPalette(null); setPage(null); setSplitIds([]); void command('newTab') } },
      ]} />}
    {favoriteMenu && <div className="context-menu" style={{ left: favoriteMenu.x, top: favoriteMenu.y }}>
      <button type="button" onClick={() => { setModal({ kind: 'favorite', favorite: favoriteMenu.favorite }); setFavoriteMenu(null) }}>Edit favorite</button>
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
    {welcome && <Welcome animate={animate} openImport={() => {
      void command('finishWelcome').then(ok => { if (ok) { setSettingsSection('Import'); setPage('settings') } })
    }} />}
    {error && <div className={'toast' + (external && !overlay ? ' toast-top' : '')} role="alert"><AlertTriangle size={17} /><span>{error}</span>
      <Tool label="Dismiss error" onClick={() => setError('')}><X size={15} /></Tool></div>}
  </div>
}

createRoot(document.getElementById('root')!).render(<Browser />)
