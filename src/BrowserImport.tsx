import { browserImportItems, type BrowserImportItem } from '../shared/model'
import { useEffect, useState } from 'react'
import { FileText, FolderOpen, KeyRound } from 'lucide-react'
import type { BrowserBrand, BrowserImportKind, BrowserImportSource, Workspace } from '../shared/model'

const browserOptions: BrowserBrand[] = ['Chrome', 'Arc', 'Dia', 'Opera', 'Opera GX', 'Ardia', 'Edge', 'Brave', 'Vivaldi', 'Chromium']
const exportHelp: Partial<Record<BrowserBrand, string>> = {
  Arc: 'In Arc, open Settings → Advanced → Export Data. Choose Import Profiles or Spaces to bring over your exported Favorites, pinned folders, and tabs.',
  Dia: 'Choose Import Profiles or Spaces to bring over your exported Dia Profiles, tabs, and groups from Markdown.',
  Opera: 'Open opera:about to find the profile folder, or choose a bookmarks HTML export.',
  'Opera GX': 'Open opera:about to find the GX profile folder, or choose a bookmarks HTML export.',
  Chrome: 'Open chrome://version to find the profile folder. You can also export bookmarks from Bookmark Manager.',
}

function BrowserIcon({ brand }: { brand: BrowserBrand }) {
  const label: Record<BrowserBrand, string> = {
    Chrome: '', Arc: '⌒', Dia: 'dia', Ardia: 'A', Opera: '', 'Opera GX': '',
    Edge: 'e', Brave: 'B', Vivaldi: 'V', Chromium: '',
  }
  return <span className={'browser-brand brand-' + brand.toLowerCase().replace(' ', '-')} aria-hidden="true">{label[brand]}</span>
}

export function BrowserImport({ profileId, workspaces }: { profileId: string; workspaces: Workspace[] }) {
  const [sources, setSources] = useState<BrowserImportSource[]>([])
  const [brand, setBrand] = useState<BrowserBrand>('Chrome')
  const [source, setSource] = useState('')
  const [allProfiles, setAllProfiles] = useState(true)
  const [destination, setDestination] = useState(profileId)
  const [items, setItems] = useState<BrowserImportItem[]>([...browserImportItems])
  const [includePasswords, setIncludePasswords] = useState(false)
  const [busy, setBusy] = useState(false)
  const [scanning, setScanning] = useState(true)
  const [status, setStatus] = useState('')
  useEffect(() => {
    let current = true
    window.lexn.importSources().then(items => {
      if (current) setSources(items)
    }).catch(() => {
      if (current) setStatus('Browser detection is unavailable. Choose a folder or export file to continue.')
    }).finally(() => { if (current) setScanning(false) })
    return () => { current = false }
  }, [])
  const detected = new Set(sources.map(item => item.browser))
  const orderedBrands = [...browserOptions].sort((a, b) => Number(detected.has(b)) - Number(detected.has(a)))
  const profiles = sources.filter(item => item.browser === brand)
  const selected = profiles.some(item => item.id === source) ? source : profiles[0]?.id ?? ''
  const destinations = workspaces.filter(item => !item.profileId)
  const target = destinations.find(item => item.id === destination)
  const currentProfile = destinations.find(item => item.id === profileId)?.name ?? 'this Profile'

  async function run(kind: BrowserImportKind) {
    setBusy(true)
    setStatus('')
    try {
      const value = kind === 'browser' || kind === 'profile' ? selected : kind === 'passwords' ? destination : brand
      const result = await window.lexn.importBrowserData(kind, value, true, includePasswords, items)
      if (!result) return
      if (result.profiles?.length) setDestination(result.profiles.length === 1 ? result.profiles[0].id : '')
      const notes = [...result.notes]
      let passwordCount = result.passwords
      if (includePasswords && kind !== 'passwords') {
        for (const item of result.passwordFallbackProfiles ?? result.profiles ?? [{ id: profileId, name: currentProfile }]) {
          setStatus('Choose the password CSV for ' + item.name + '.')
          try {
            const accountData = await window.lexn.importBrowserData('passwords', item.id)
            if (accountData) {
              passwordCount += accountData.passwords
              notes.push(...accountData.notes.map(note => item.name + ' · ' + note))
            } else notes.push('Password import skipped for ' + item.name + '.')
          } catch (error) {
            notes.push(item.name + ' · ' + (error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': Error: /, '') : String(error)))
          }
        }
      }
      const counts = [
        [result.bookmarks, 'bookmark', 'bookmarks'],
        [result.visits, 'history entry', 'history entries'],
        [passwordCount, 'password', 'passwords'],
        [result.favorites ?? 0, 'Favorite', 'Favorites'],
        [result.pinned ?? 0, 'pinned tab', 'pinned tabs'],
        [result.tabs ?? 0, 'open tab', 'open tabs'],
      ].flatMap(([count, one, many]) => count ? [count + ' ' + (count === 1 ? one : many)] : [])
      const summary = result.profiles?.length
        ? 'Profiles imported: ' + result.profiles.map(item => item.name).join(', ') + '.' + (counts.length ? ' Added ' + counts.join(', ') + '.' : '')
        : counts.length ? 'Imported ' + counts.join(', ') + ' into ' + (kind === 'passwords' ? target?.name ?? currentProfile : currentProfile) + '.'
        : notes.length ? '' : 'No new items were found.'
      setStatus([summary, ...notes].filter(Boolean).join(' '))
    } catch (error) {
      setStatus(error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': Error: /, '') : String(error))
    } finally { setBusy(false) }
  }

  return <section className="import-browser" aria-label="Browser data import">
    <h3>Source browser</h3>
    <div className="browser-brand-grid" role="group" aria-label="Source browser">
      {orderedBrands.map(item => <button key={item} type="button" aria-pressed={item === brand} disabled={busy}
        onClick={() => { setBrand(item); setSource(''); setAllProfiles(true); setStatus('') }}>
        <BrowserIcon brand={item} /><span>{item}</span>
        {detected.has(item) && <small>Detected</small>}
      </button>)}
    </div>

    <div className="import-source-panel import-options">
      <div className="import-profile-row">
        <strong>{brand} profiles</strong>
        {profiles.length > 0 ? <select aria-label="Source profile" value={allProfiles ? '' : selected} disabled={busy}
          onChange={event => {
            setAllProfiles(!event.target.value)
            if (event.target.value) setSource(event.target.value)
          }}>
          <option value="">All profiles ({profiles.length})</option>
          {profiles.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select> : <span className="muted">{scanning ? 'Looking for profiles…' : 'No local profiles detected'}</span>}
      </div>
      <fieldset className="import-file-actions import-items">
        <legend>What to import</legend>
        {browserImportItems.map(item => <label className="import-guide" key={item}>
          <input type="checkbox" checked={items.includes(item)} disabled={busy} onChange={event => {
            setItems(previous => event.target.checked ? [...previous, item] : previous.filter(value => value !== item))
          }} />{{ bookmarks: 'Bookmarks', history: 'History', favorites: 'Favorites', pinned: 'Pinned tabs', tabs: 'Open tabs' }[item]}
        </label>)}
        <label className="import-guide">
          <input type="checkbox" checked={includePasswords} disabled={busy} onChange={event => setIncludePasswords(event.target.checked)} />
          Include saved passwords
        </label>
      </fieldset>
      {profiles.length > 0 && <div className="import-primary">
        <button type="button" className="primary" disabled={busy || (!items.length && !includePasswords)}
          onClick={() => { void run(allProfiles ? 'profiles' : 'profile') }}>
          {allProfiles ? 'Import all Profiles' : 'Import selected Profile'}
        </button>
      </div>}
    </div>

    <details className="import-disclosure">
      <summary>Other import options</summary>
      {exportHelp[brand] && <p className="import-guide">{exportHelp[brand]}</p>}
      <div className="import-file-actions">
        <button type="button" className="secondary" disabled={busy} onClick={() => { void run('profile-folder') }}><FolderOpen size={16} />Import Profiles from folder</button>
        <button type="button" className="secondary" disabled={busy} onClick={() => { void run('profile-markdown') }}><FileText size={16} />Import Profiles or Spaces</button>
        <button type="button" className="secondary" disabled={busy} onClick={() => { void run('bookmarks') }}><FileText size={16} />Import links file</button>
        <button type="button" className="secondary" disabled={busy} onClick={() => { void run('folder') }}>Copy from Profile folder</button>
      </div>
      {selected && <div className="import-profile-row">
        <span className="muted">Copy into {currentProfile}</span>
        <button type="button" className="secondary" disabled={busy} onClick={() => { void run('browser') }}>Copy bookmarks and history</button>
      </div>}
    </details>
    <details className="import-disclosure">
      <summary>Import passwords from CSV</summary>
      <p className="import-guide">Select the matching Drew Profile. Delete the readable CSV after importing.</p>
      <div className="import-file-actions">
        <select aria-label="Password destination Profile" value={destination} disabled={busy} onChange={event => setDestination(event.target.value)}>
          <option value="" disabled>Choose matching Profile</option>
          {destinations.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
        <button type="button" className="secondary" disabled={busy || !target} onClick={() => { void run('passwords') }}><KeyRound size={16} />Import password CSV</button>
      </div>
    </details>
    {busy && <p role="status">Importing…</p>}
    {status && <p role="status" className="import-status">{status}</p>}
  </section>
}
