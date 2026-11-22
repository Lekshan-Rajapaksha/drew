import { useState } from 'react'
import { KeyRound } from 'lucide-react'
import type { SavedLogin } from '../shared/model'
import { PageHeader } from './Library'
import { command } from './state'

export function Passwords({ entries, currentOrigin }: { entries: SavedLogin[]; currentOrigin?: string }) {
  const [website, setWebsite] = useState(currentOrigin ?? '')
  const [username, setUsername] = useState('')
  const [notice, setNotice] = useState('')
  const [saving, setSaving] = useState(false)
  let origin = ''
  try { origin = new URL(website).origin } catch { /* An incomplete URL is normal while editing. */ }
  const existing = entries.some(entry => entry.origin === origin && entry.username === username)

  return <div className="management">
    <PageHeader icon={<KeyRound size={24} />} title="Passwords" subtitle="Use a saved account from the password field on a matching HTTPS sign-in page." />
    <form className="vault-form" autoComplete="off" onSubmit={event => {
      event.preventDefault()
      if (saving) return
      const form = event.currentTarget
      const secret = new FormData(form).get('secret')
      if (typeof secret !== 'string' || !secret) return
      form.reset()
      setSaving(true)
      void command('saveLogin', website, username, secret).then(ok => {
        if (ok) { form.reset(); setWebsite(''); setUsername(''); setNotice(existing ? 'Password updated.' : 'Password saved.') }
        setSaving(false)
      })
    }}>
      <label>Website<input type="url" value={website} onChange={event => setWebsite(event.target.value)} placeholder="https://example.com" required /></label>
      <label>Username<input value={username} onChange={event => setUsername(event.target.value)} maxLength={256} /></label>
      <label>Password<input type="password" name="secret" autoComplete="new-password" maxLength={4096} required /></label>
      <button type="submit" className="primary" disabled={saving}>{existing ? 'Update password' : 'Save password'}</button>
    </form>
    <p role="status" className="muted">{notice}</p>
    <div className="records">{entries.map(entry => <article key={entry.id} className="record">
      <div className="record-link"><strong>{entry.origin}</strong><span>{entry.username}</span></div>
      <button type="button" className="secondary" onClick={() => {
        setWebsite(entry.origin); setUsername(entry.username)
        document.querySelector<HTMLInputElement>('.vault-form input[name=secret]')?.focus()
      }}>Edit password</button>
      <button type="button" className="secondary" onClick={() => {
        void command('copyLogin', entry.id).then(ok => { if (ok) setNotice('Password copied. Drew clears it from the clipboard after 30 seconds if it is still there.') })
      }} aria-label={`Copy password for ${entry.username || 'unnamed account'} at ${entry.origin}`}>Copy password</button>
      <button type="button" className="secondary" onClick={() => {
        void command('removeLogin', entry.id).then(ok => { if (ok) setNotice('Password removed.') })
      }}>Remove</button>
    </article>)}</div>
  </div>
}
