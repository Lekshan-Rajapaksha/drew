import { useState } from 'react'
import { effectiveShortcuts, shortcutActions, shortcutDefinitions, shortcutKeys, shortcutLabel, type ShortcutAction } from '../shared/shortcuts'
import { command } from './state'

export function KeyboardSettings({ saved }: { saved: string }) {
  const platform = window.lexn.platform
  const current = effectiveShortcuts(saved, platform)
  const [action, setAction] = useState<ShortcutAction>('command')
  const [binding, setBinding] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const value = binding ?? current[action]
  const shift = value.startsWith('Shift+')
  const key = value.replace('Shift+', '')

  async function save(next: string | null) {
    setBusy(true)
    setStatus('')
    const ok = await command('setShortcut', action, next)
    setBusy(false)
    if (ok) {
      setBinding(null)
      setStatus(next === null ? 'Default shortcut restored.' : 'Shortcut saved.')
    }
  }

  return <>
    <p className="muted">Choose an action and set its key combination for this Profile.</p>
    <form className="shortcut-form" onSubmit={event => { event.preventDefault(); void save(value) }}>
      <label>Action<select aria-label="Shortcut action" value={action} onChange={event => {
        setAction(event.target.value as ShortcutAction)
        setBinding(null)
        setStatus('')
      }}>
        {shortcutActions.map(item => <option value={item} key={item}>{shortcutDefinitions[item].label}</option>)}
      </select></label>
      <label>Key<select aria-label="Shortcut key" value={key} onChange={event => setBinding((shift ? 'Shift+' : '') + event.target.value)}>
        {shortcutKeys.map(key => <option value={key} key={key}>{key === ',' ? 'Comma' : key}</option>)}
      </select></label>
      <label className="shortcut-shift"><input type="checkbox" checked={shift} onChange={event =>
        setBinding((event.target.checked ? 'Shift+' : '') + key)} /> Include Shift</label>
      <button type="submit" className="primary" disabled={busy}>Save shortcut</button>
      <button type="button" className="secondary" disabled={busy} onClick={() => { void save(null) }}>Restore default</button>
    </form>
    {status && <p role="status" className="shortcut-status">{status}</p>}
    <div className="setting-list">
      {shortcutActions.map(item => <div className="setting" key={item}>
        <span>{shortcutDefinitions[item].label}</span><kbd>{shortcutLabel(current[item], platform)}</kbd>
      </div>)}
      <div className="setting"><span>Switch to the next tab</span><kbd>Ctrl+Tab</kbd></div>
      <div className="setting"><span>Switch to the previous tab</span><kbd>Ctrl+Shift+Tab</kbd></div>
    </div>
  </>
}
