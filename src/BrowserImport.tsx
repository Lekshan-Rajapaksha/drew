import { useEffect, useState } from 'react'
import { ArrowDownToLine, FileText, FolderOpen, Globe2, KeyRound } from 'lucide-react'
import type { BrowserBrand, BrowserImportKind, BrowserImportSource } from '../shared/model'

const browserOptions: BrowserBrand[] = ['Chrome', 'Arc', 'Dia', 'Opera', 'Opera GX', 'Ardia', 'Edge', 'Brave', 'Vivaldi', 'Chromium']
const exportHelp: Partial<Record<BrowserBrand, string>> = {
  Arc: 'In Arc, open Settings → Advanced → Export Data. Choose the Markdown file to save links from your Spaces, Favorites, and tabs as bookmarks in Drew.',
  Dia: 'Choose your exported Dia Markdown file to bring over links from tabs and groups as bookmarks in Drew.',
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

export function BrowserImport({ profile }: { profile: string }) {
  const [sources, setSources] = useState<BrowserImportSource[]>([])
  const [brand, setBrand] = useState<BrowserBrand>('Chrome')
  const [source, setSource] = useState('')
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

  async function run(kind: BrowserImportKind) {
    setBusy(true)
    setStatus('')
    try {
      const result = await window.lexn.importBrowserData(kind, selected)
      if (!result) return
      const counts = [
        [result.bookmarks, 'bookmark', 'bookmarks'],
        [result.visits, 'history entry', 'history entries'],
        [result.passwords, 'password', 'passwords'],
      ].flatMap(([count, one, many]) => count ? [count + ' ' + (count === 1 ? one : many)] : [])
      const summary = counts.length
        ? 'Imported ' + counts.join(', ') + ' into ' + profile + '.'
        : result.notes.length ? '' : 'No new items were found.'
      setStatus([summary, ...result.notes].filter(Boolean).join(' '))
    } catch (error) {
      setStatus(error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': Error: /, '') : String(error))
    } finally { setBusy(false) }
  }

  return <section className="import-browser" aria-label="Browser data import">
    <div className="import-intro"><div><h2>Bring your browser data</h2><p>Bookmarks, recent history, and passwords go into <strong>{profile}</strong>. Duplicate entries are skipped.</p></div><ArrowDownToLine size={24} aria-hidden="true" /></div>
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
          : profiles.length ? 'Choose a profile to copy bookmarks and recent history.' : 'No local profile detected. You can choose a folder or an export below.'}</p></div>
        {profiles.length > 0 && <div className="setting-control">
          <select aria-label="Source profile" value={selected} disabled={busy} onChange={event => setSource(event.target.value)}>
            {profiles.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
          <button type="button" className="primary" disabled={busy} onClick={() => { void run('browser') }}>Import bookmarks and history</button>
        </div>}
      </div>
      <p className="import-guide"><Globe2 size={15} aria-hidden="true" />{exportHelp[brand] ?? 'Choose the browser’s Chromium profile folder, or select an HTML bookmarks export.'}</p>
    </div>
    <h3>Import from a file or folder</h3>
    <div className="import-file-actions">
      <button type="button" className="secondary" disabled={busy} onClick={() => { void run('folder') }}><FolderOpen size={16} />Choose Profile folder</button>
      <button type="button" className="secondary" disabled={busy} onClick={() => { void run('bookmarks') }}><FileText size={16} />Import links file</button>
    </div>
    <p className="muted import-file-note">Links files can be bookmarks HTML or Markdown.</p>
    <div className="import-source-panel">
      <div className="setting">
        <div><strong>Saved passwords from {brand}</strong><p>Export passwords from your browser’s password manager, then choose the CSV. Drew saves each website and username separately in <strong>{profile}</strong> using system encryption.</p></div>
        <button type="button" className="secondary" disabled={busy} onClick={() => { void run('passwords') }}><KeyRound size={16} />Import password CSV</button>
      </div>
      <p className="import-guide">The exported CSV contains readable passwords. Delete the export when you finish importing it.</p>
    </div>
    {busy && <p role="status">Importing…</p>}
    {status && <p role="status" className="import-status">{status}</p>}
  </section>
}
