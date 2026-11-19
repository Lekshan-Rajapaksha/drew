import { useState } from 'react'
import { KeyRound } from 'lucide-react'
import type { SavedLogin } from '../shared/model'
import { PageHeader } from './Library'
import { command } from './state'

export function Passwords({ entries }: { entries: SavedLogin[] }) {
  const [website, setWebsite] = useState('')
  const [username, setUsername] = useState('')
  const [notice, setNotice] = useState('')
  const [saving, setSaving] = useState(false)
  return <div className="management">
    <PageHeader icon={<KeyRound size={24} />} title="Passwords" subtitle="Save and copy passwords for this Profile." />
    <form className="vault-form" autoComplete="off" onSubmit={event => {
      event.preventDefault()
      if (saving) return
      const form = event.currentTarget
      const secret = new FormData(form).get('secret')
      if (typeof secret !== 'string' || !secret) return
      setSaving(true)
      void command('saveLogin', website, username, secret).then(ok => {
        if (ok) { form.reset(); setWebsite(''); setUsername(''); setNotice('Password saved.') }
        setSaving(false)
      })
    }}>
      <label>Website<input type="url" value={website} onChange={event => setWebsite(event.target.value)} placeholder="https://example.com" required /></label>
      <label>Username<input value={username} onChange={event => setUsername(event.target.value)} maxLength={256} /></label>
      <label>Password<input type="password" name="secret" autoComplete="new-password" maxLength={4096} required /></label>
      <button type="submit" className="primary" disabled={saving}>Save password</button>
    </form>
    <p role="status" className="muted">{notice}</p>
    <div className="records">{entries.map(entry => <article key={entry.id} className="record">
      <div className="record-link"><strong>{entry.origin}</strong><span>{entry.username}</span></div>
      <button type="button" className="secondary" onClick={() => {
        void command('copyLogin', entry.id).then(ok => { if (ok) setNotice('Password copied.') })
      }}>Copy password</button>
      <button type="button" className="secondary" onClick={() => {
        void command('removeLogin', entry.id).then(ok => { if (ok) setNotice('Password removed.') })
      }}>Remove</button>
    </article>)}</div>
  </div>
}
