import { useEffect, useState, type ReactNode } from 'react'
import { Cookie, FolderOpen, Settings2, Shield, Trash2 } from 'lucide-react'
import type { BrowserState, Permission, Settings as Preferences, SiteCookie } from '../shared/model'
import { HOME } from '../shared/model'
import { AccentPicker } from './AccentPicker'
import { Empty, Filter, PageHeader } from './Library'
import { command, useApp } from './state'
import { Tool } from './ui'

type Confirm = (title: string, description: string, action: () => Promise<void>) => void

function Setting({ label, detail, children }: { label: string; detail?: string; children?: ReactNode }) {
  return <div className="setting"><div><strong>{label}</strong>{detail && <p>{detail}</p>}</div><div className="setting-control">{children}</div></div>
}

export function Settings({ browser, confirm }: { browser: BrowserState; confirm: Confirm }) {
  const settings = browser.settings
  const space = browser.workspaces.find(item => item.id === browser.workspaceId)
  const profile = browser.workspaces.find(item => item.id === browser.profileId)
  const resolvedAccent = settings.accentColor || space?.accent || '#b5a2ff'
  const [homepage, setHomepage] = useState(settings.homepage === HOME ? '' : settings.homepage)
  const [section, setSection] = useState('General')
  const [origin, setOrigin] = useState('')
  const [permission, setPermission] = useState<Permission>('camera')
  const [mode, setMode] = useState<'allow' | 'block'>('block')
  const [cookies, setCookies] = useState<SiteCookie[]>([])
  const [filter, setFilter] = useState('')
  const [revision, refresh] = useState(0)

  useEffect(() => {
    if (section !== 'Cookies') return
    let current = true
    window.lexn.cookies().then(result => { if (current) setCookies(result) })
      .catch(error => { if (current) useApp.getState().setError(String(error)) })
    return () => { current = false }
  }, [section, revision])

  function select<K extends keyof Preferences>(key: K, label: string, choices: Record<string, string>) {
    return <select aria-label={label} value={String(settings[key])} onChange={event => { void command('setSetting', key, event.target.value) }}>
      {Object.entries(choices).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
    </select>
  }
  const clear = (kind: 'history' | 'cookies' | 'cache' | 'storage', label: string, detail: string) =>
    <button type="button" className="secondary" onClick={() => confirm(label, detail, async () => {
      if (await command('clearData', kind)) refresh(value => value + 1)
    })}>{label}</button>

  return <div className="management settings">
    <PageHeader icon={<Settings2 size={24} />} title="Settings" subtitle={profile ? 'Preferences for ' + profile.name : 'Manage your Profile preferences.'} />
    <nav className="section-tabs" aria-label="Settings sections">{['General', 'Appearance', 'Privacy', 'Cookies', 'About'].map(item =>
      <button key={item} type="button" className={section === item ? 'selected' : ''} onClick={() => setSection(item)}>{item}</button>)}</nav>
    {section === 'General' && <div className="setting-list">
      <Setting label="Search engine" detail="Used for searches from the address bar and new tab.">
        {select('engine', 'Search engine', { google: 'Google', duckduckgo: 'DuckDuckGo', bing: 'Bing' })}
      </Setting>
      <Setting label="Home page" detail="Leave blank to use the LexN new tab page.">
        <form className="inline-form" onSubmit={event => { event.preventDefault(); void command('setSetting', 'homepage', homepage) }}>
          <input aria-label="Home page URL" placeholder="https://example.com" value={homepage} onChange={event => setHomepage(event.target.value)} />
          <button className="secondary" type="submit">Save</button>
        </form>
      </Setting>
      <Setting label="Auto-archive Today tabs" detail="Archives inactive, unpinned tabs in Spaces linked to this Profile.">
        {select('archiveHours', 'Auto-archive Today tabs', { '0': 'Never', '12': '12 hours', '24': '24 hours', '72': '3 days', '168': '7 days' })}
      </Setting>
      <Setting label="On startup">{select('startup', 'On startup', { restore: 'Restore the previous session', home: 'Open home page in a new tab', blank: 'Open a blank tab' })}</Setting>
      <Setting label="Download location" detail={settings.downloadPath || 'System Downloads folder'}>
        {settings.downloadPath && <button type="button" className="secondary" onClick={() => { void command('setSetting', 'downloadPath', '') }}>Reset</button>}
        <button type="button" className="secondary" onClick={() => { void command('chooseDownloadPath') }}><FolderOpen size={16} /> Choose folder</button>
      </Setting>
    </div>}
    {section === 'Appearance' && <div className="setting-list">
      <Setting label="Top toolbar" detail="Show navigation and the address bar above the webpage.">
        <input type="checkbox" aria-label="Show top toolbar" checked={settings.topToolbar}
          onChange={event => { void command('setSetting', 'topToolbar', event.target.checked) }} />
      </Setting>
      <Setting label="Keep tab sidebar expanded" detail="Keep the sidebar and service rail visible when the pointer leaves.">
        <input type="checkbox" aria-label="Keep tab sidebar expanded" checked={settings.keepSidebarOpen}
          onChange={event => { void command('setSetting', 'keepSidebarOpen', event.target.checked) }} />
      </Setting>
      <Setting label="Theme" detail="True Black uses a pure black browser frame and sidebar.">
        {select('theme', 'Theme', { dark: 'Soft Dark', black: 'True Black', slate: 'Slate', light: 'Light', system: 'Follow system' })}
      </Setting>
      <Setting label="Profile accent" detail="Choose a color for this Profile or use each Space’s accent.">
        <AccentPicker color={resolvedAccent} change={value => { void command('setSetting', 'accentColor', value) }} />
        {settings.accentColor && <button type="button" className="secondary" onClick={() => { void command('setSetting', 'accentColor', '') }}>Use Space colors</button>}
      </Setting>
      <Setting label="Color intensity">{select('colorIntensity', 'Color intensity', { subtle: 'Subtle', balanced: 'Balanced', vivid: 'Vivid' })}</Setting>
      <Setting label="New tab background">{select('background', 'New tab background', { violet: 'Accent wash', forest: 'Forest', midnight: 'Midnight', black: 'Solid black', match: 'Match theme' })}</Setting>
      <Setting label="Favorite icon size">{select('favoriteSize', 'Favorite icon size in Appearance', { small: 'Small', medium: 'Medium', large: 'Large' })}</Setting>
    </div>}
    {section === 'Privacy' && <>
      <div className="setting-list">
        <Setting label="JavaScript" detail="Applies to websites in this Profile. Changing it reloads the active tab.">
          <input aria-label="Enable website JavaScript" type="checkbox" checked={settings.javascript} onChange={event => { void command('setSetting', 'javascript', event.target.checked) }} />
        </Setting>
        <Setting label="Browsing history">{clear('history', 'Clear history', 'Delete all recorded visits from this profile.')}</Setting>
        <Setting label="Cached files">{clear('cache', 'Clear cache', 'Remove cached resources from the website profile.')}</Setting>
        <Setting label="Website data" detail="Clears cookies, cache, and other Chromium site data. Active pages will reload.">
          {clear('storage', 'Clear website data', 'This will remove Chromium site data and can sign you out of websites.')}
        </Setting>
      </div>
      <h2 className="section-heading"><Shield size={18} /> Website permissions</h2>
      <p className="muted">Camera, microphone, and notifications are blocked until allowed for an HTTPS origin. The operating system can also require permission.</p>
      <form className="inline-form permission-form" onSubmit={event => {
        event.preventDefault()
        void command('setPermission', origin, permission, mode).then(ok => { if (ok) setOrigin('') })
      }}>
        <input aria-label="Website origin" placeholder="https://example.com" value={origin} onChange={event => setOrigin(event.target.value)} required />
        <select aria-label="Permission type" value={permission} onChange={event => setPermission(event.target.value as Permission)}>
          <option value="camera">Camera</option><option value="microphone">Microphone</option><option value="notifications">Notifications</option>
        </select>
        <select aria-label="Permission rule" value={mode} onChange={event => setMode(event.target.value as typeof mode)}>
          <option value="block">Block</option><option value="allow">Allow</option>
        </select>
        <button className="primary" type="submit">Save rule</button>
      </form>
      <div className="records">{browser.permissions.map(rule => <article className="record" key={rule.origin + rule.permission}>
        <div className="record-link"><strong>{rule.origin}</strong><span>{rule.permission} · {rule.allow ? 'Allowed' : 'Blocked'}</span></div>
        <Tool label={`Remove ${rule.permission} rule for ${rule.origin}`} onClick={() => { void command('setPermission', rule.origin, rule.permission, 'reset') }}><Trash2 size={16} /></Tool>
      </article>)}</div>
    </>}
    {section === 'Cookies' && <>
      <div className="cookies-heading"><Filter label="Filter cookies" value={filter} change={setFilter} />
        {clear('cookies', 'Clear cookies', 'Remove all cookies from the website profile. Websites may sign you out.')}</div>
      {!cookies.length && <Empty icon={<Cookie size={24} />} title="No cookies stored" detail="Cookies set by websites will appear here." />}
      <div className="records">{cookies.filter(cookie => (cookie.domain + ' ' + cookie.name).toLowerCase().includes(filter.toLowerCase())).map((cookie, index) =>
        <article className="record" key={cookie.domain + cookie.path + cookie.name + index}>
          <div className="record-link"><strong>{cookie.name}</strong><span>{cookie.domain}{cookie.path}</span></div>
          <Tool label={`Remove cookie ${cookie.name}`} onClick={() => {
            void command('removeCookie', cookie.domain, cookie.path, cookie.name, cookie.secure).then(ok => { if (ok) refresh(value => value + 1) })
          }}><Trash2 size={16} /></Tool>
        </article>)}</div>
    </>}
    {section === 'About' && <div className="setting-list">
      <Setting label="LexN Browser" detail="A Chromium-based desktop browser with workspaces."><span>Version {window.lexn.version}</span></Setting>
      <Setting label="Default browser" detail="Use your operating system’s default apps settings to choose its web browser. OS registration varies by installer." />
      <Setting label="Local profile" detail="Browsing data is stored on this device. Each browser profile keeps separate logins, history, bookmarks, downloads and permissions." />
    </div>}
  </div>
}
