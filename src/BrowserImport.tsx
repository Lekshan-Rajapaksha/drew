import { useEffect, useState } from 'react'
import type { BrowserImportKind, BrowserImportSource } from '../shared/model'

export function BrowserImport({ profile }: { profile: string }) {
  const [sources, setSources] = useState<BrowserImportSource[]>([])
  const [source, setSource] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  useEffect(() => {
    let current = true
    window.lexn.importSources().then(items => {
      if (current) { setSources(items); setSource(items[0]?.id ?? '') }
    }).catch(() => { if (current) setStatus('Browser detection is unavailable. You can still choose a folder or export file.') })
    return () => { current = false }
  }, [])

  async function run(kind: BrowserImportKind) {
    setBusy(true)
    setStatus('')
    try {
      const result = await window.lexn.importBrowserData(kind, source)
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

  return <div className="import-browser">
    <p className="muted">Import into <strong>{profile}</strong>. Existing bookmarks, history entries, and passwords are kept when they match an imported item.</p>
    <div className="setting-list">
      <div className="setting"><div><strong>Installed browser</strong><p>Import bookmarks and recent history from a detected Chromium Profile.</p></div>
        <div className="setting-control">
          <select aria-label="Browser to import from" value={source} disabled={busy || !sources.length} onChange={event => setSource(event.target.value)}>
            {!sources.length && <option value="">No browsers detected</option>}
            {sources.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
          <button type="button" className="primary" disabled={busy || !source} onClick={() => { void run('browser') }}>Import browser data</button>
        </div>
      </div>
      <div className="setting"><div><strong>Other browser folder</strong><p>Choose a Chromium Profile folder containing a Bookmarks or History file.</p></div>
        <button type="button" className="secondary" disabled={busy} onClick={() => { void run('folder') }}>Choose Profile folder</button></div>
      <div className="setting"><div><strong>Bookmarks or Arc and Dia links</strong><p>Choose a bookmarks HTML file or a Markdown export.</p></div>
        <button type="button" className="secondary" disabled={busy} onClick={() => { void run('bookmarks') }}>Import links file</button></div>
      <div className="setting"><div><strong>Saved passwords</strong><p>Import a password CSV using system encryption.</p></div>
        <button type="button" className="secondary" disabled={busy} onClick={() => { void run('passwords') }}>Import password CSV</button></div>
    </div>
    {busy && <p role="status">Importing…</p>}
    {status && <p role="status" className="import-status">{status}</p>}
  </div>
}
