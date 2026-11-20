import { Copy, Minus, Square, X } from 'lucide-react'
import { command } from './state'
import { Tool } from './ui'

export function WindowControls({ maximized }: { maximized: boolean }) {
  return <div className="caption-controls" role="group" aria-label="Window controls">
    <Tool label="Minimize window" onClick={() => { void command('windowAction', 'minimize') }}><Minus size={16} /></Tool>
    <Tool label={maximized ? 'Restore window' : 'Maximize window'} onClick={() => { void command('windowAction', 'toggleMaximize') }}>
      {maximized ? <Copy size={14} /> : <Square size={13} />}
    </Tool>
    <Tool label="Close window" className="caption-close" onClick={() => { void command('windowAction', 'close') }}><X size={17} /></Tool>
  </div>
}
