import { useState, type Fragment as FragmentType } from 'react'
import { Fragment } from 'react'
import { Plus, X } from 'lucide-react'
import { command } from './state'
import { Tool } from './ui'
import type { SplitPane, Tab } from '../shared/model'

function PaneAddress({ tab }: { tab: Tab }) {
  const [edit, setEdit] = useState<string | null>(null)
  return <form onSubmit={event => {
    event.preventDefault()
    if (edit && edit.trim() !== tab.url) void command('navigate', tab.id, edit.trim())
    setEdit(null)
    event.currentTarget.querySelector('input')?.blur()
  }}>
    <input aria-label={`Address for ${tab.title}`} value={edit ?? tab.url}
      onFocus={event => { setEdit(tab.url); event.currentTarget.select() }}
      onBlur={() => setEdit(null)} onChange={event => setEdit(event.target.value)} />
  </form>
}

export function SplitView({ panes, layout, resizePanes, remove, add }: {
  panes: Tab[]; layout: SplitPane[]; resizePanes: (weights: Record<string, number>) => void; remove: (id: string) => void; add: () => void
}) {
  const [draft, setWeights] = useState<Record<string, number> | null>(null)
  const weights = draft ?? Object.fromEntries(layout.map(pane => [pane.id, pane.weight]))
  const fragment: typeof FragmentType = Fragment
  const resize = (event: React.PointerEvent<HTMLButtonElement>, left: Tab, right: Tab) => {
    const handle = event.currentTarget
    const lhs = handle.previousElementSibling?.getBoundingClientRect().width ?? 0
    const rhs = handle.nextElementSibling?.getBoundingClientRect().width ?? 0
    if (lhs + rhs < 160) return
    const start = event.clientX
    const leftWeight = weights[left.id] ?? 1
    const rightWeight = weights[right.id] ?? 1
    const totalWeight = leftWeight + rightWeight
    handle.setPointerCapture(event.pointerId)
    let resized: Record<string, number> | null = null
    const move = (pointer: PointerEvent) => {
      const next = Math.max(80, Math.min(lhs + rhs - 80, lhs + pointer.clientX - start))
      const units = next / (lhs + rhs) * totalWeight
      resized = { ...weights, [left.id]: units, [right.id]: totalWeight - units }
      setWeights(resized)
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('lostpointercapture', () => {
      handle.removeEventListener('pointermove', move)
      if (resized) resizePanes(resized)
      setWeights(null)
    }, { once: true })
  }
  return <div className="split-view">
    {panes.map((tab, index) => {
      const Wrapper = fragment
      return <Wrapper key={tab.id}>
        {index > 0 && <button className="pane-divider" type="button" aria-label="Resize split panes" onPointerDown={event => resize(event, panes[index - 1], tab)} />}
        <section className="split-pane" style={{ flexGrow: weights[tab.id] ?? 1 }}>
          <header><PaneAddress tab={tab} />
            {index === panes.length - 1 && panes.length < 4 && <Tool label="Add split pane" onClick={add}><Plus size={15} /></Tool>}
            <Tool label={`Remove ${tab.title} from split`} onClick={() => remove(tab.id)}><X size={15} /></Tool>
          </header>
          <div className="pane-viewport" data-pane={tab.id}>{tab.error && <p>{tab.error}</p>}</div>
        </section>
      </Wrapper>
    })}
  </div>
}
