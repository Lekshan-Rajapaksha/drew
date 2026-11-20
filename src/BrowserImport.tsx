import { useEffect, useState } from 'react'
import { ArrowDownToLine, FileText, FolderOpen, Globe2, KeyRound } from 'lucide-react'
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
  const [destination, setDestination] = useState(profileId)
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
  const profiles = sources.filter(item => item.browser === brand)
  const selected = profiles.some(item => item.id === source) ? source : profiles[0]?.id ?? ''
  const destinations = workspaces.filter(item => !item.profileId)
  const target = destinations.find(item => item.id === destination)
  const currentProfile = destinations.find(item => item.id === profileId)?.name ?? 'this Profile'

  async function run(kind: BrowserImportKind) {
    setBusy(true)
    setStatus('')
    try {
      const value = kind === 'browser' ? selected : kind === 'passwords' ? destination : brand
      const result = await window.lexn.importBrowserData(kind, value)
      if (!result) return
      if (result.profiles?.length) setDestination(result.profiles.length === 1 ? result.profiles[0].id : '')
      const notes = [...result.notes]
      let passwordCount = result.passwords
      if (includePasswords && kind !== 'passwords') {
        for (const item of result.profiles ?? [{ id: profileId, name: currentProfile }]) {
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
    <div className="import-intro"><div><h2>Bring your browser data</h2><p>Create matching Drew Profiles or copy individual items into <strong>{currentProfile}</strong>. Duplicate entries are skipped.</p></div><ArrowDownToLine size={24} aria-hidden="true" /></div>
    <h3>Choose your browser</h3>
    <div className="browser-brand-grid" role="group" aria-label="Source browser">
      {browserOptions.map(item => <button key={item} type="button" aria-pressed={item === brand} disabled={busy}
        onClick={() => { setBrand(item); setStatus('') }}>
        <BrowserIcon brand={item} /><span>{item}</span>
        {sources.some(source => source.browser === item) && <small>Detected</small>}
      </button>)}
    </div>
    <div className="import-source-panel">
      <div className="setting">
        <div><strong>Import directly from {brand}</strong><p>{scanning ? 'Looking for local browser profiles…'
          : profiles.length ? 'Create separate Drew Profiles with available bookmarks, history, Favorites, pinned tabs, and colors.' : 'No local profile detected. You can choose a folder or an export below.'}</p></div>
        {profiles.length > 0 && <div className="setting-control">
          <select aria-label="Source profile" value={selected} disabled={busy} onChange={event => setSource(event.target.value)}>
            {profiles.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
          <button type="button" className="secondary" disabled={busy} onClick={() => { void run('browser') }}>Copy bookmarks and history</button>
          <button type="button" className="primary" disabled={busy} onClick={() => { void run('profiles') }}>Import all Profiles</button>
        </div>}
      </div>
      <p className="import-guide"><Globe2 size={15} aria-hidden="true" />{exportHelp[brand] ?? 'Choose the browser’s Chromium profile folder, or select an HTML bookmarks export.'}</p>
    </div>
    <label className="import-guide">
      <input type="checkbox" checked={includePasswords} disabled={busy} onChange={event => setIncludePasswords(event.target.checked)} />
      Include password CSVs in this import. Drew asks for each Profile’s export. Cancel skips that Profile’s passwords.
    </label>
    <h3>Import from a file or folder</h3>
    <div className="import-file-actions">
      <button type="button" className="secondary" disabled={busy} onClick={() => { void run('folder') }}><FolderOpen size={16} />Choose Profile folder</button>
      <button type="button" className="secondary" disabled={busy} onClick={() => { void run('profile-folder') }}><FolderOpen size={16} />Import Profiles from folder</button>
      <button type="button" className="secondary" disabled={busy} onClick={() => { void run('profile-markdown') }}><FileText size={16} />Import Profiles or Spaces</button>
      <button type="button" className="secondary" disabled={busy} onClick={() => { void run('bookmarks') }}><FileText size={16} />Import links file</button>
    </div>
    <p className="muted import-file-note">Links files can be bookmarks HTML or Markdown.</p>
    <div className="import-source-panel">
      <div className="setting">
        <div><strong>Saved passwords from {brand}</strong><p>Export passwords from each source Profile. Choose its matching Drew Profile before importing its CSV. Drew encrypts passwords and keeps each website and username separate.</p></div>
        <div className="setting-control">
          <select aria-label="Password destination Profile" value={destination} disabled={busy} onChange={event => setDestination(event.target.value)}>
            <option value="" disabled>Choose matching Profile</option>
            {destinations.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
          <button type="button" className="secondary" disabled={busy || !target} onClick={() => { void run('passwords') }}><KeyRound size={16} />Import password CSV</button>
        </div>
      </div>
      <p className="import-guide">The exported CSV contains readable passwords. Delete the export when you finish importing it.</p>
    </div>
    {busy && <p role="status">Importing…</p>}
    {status && <p role="status" className="import-status">{status}</p>}
  </section>
}
