import type { ReactNode } from 'react'
import { Globe2, X } from 'lucide-react'
import type { Tab } from '../shared/model'

export function Mark({ small = false }: { small?: boolean }) {
  return <span className={small ? 'mark mark-small' : 'mark'} aria-hidden="true"><i /><i /><i /></span>
}

export function Favicon({ tab }: { tab: Pick<Tab, 'favicon'> }) {
  return <span className="favicon-wrap"><Globe2 className="fallback-icon" size={15} />
    {tab.favicon && <img key={tab.favicon} className="favicon" src={tab.favicon} alt="" referrerPolicy="no-referrer"
      onError={event => { event.currentTarget.hidden = true }} />}
  </span>
}

export function Tool({ label, disabled, onClick, children, className = '' }: {
  label: string; disabled?: boolean; onClick: () => void; children: ReactNode; className?: string
}) {
  return <button type="button" title={label} aria-label={label} disabled={disabled}
    onClick={onClick} className={'icon-button ' + className}>{children}</button>
}

export function Overlay({ title, children, close }: { title: string; children: ReactNode; close: () => void }) {
  return <div className="overlay" onMouseDown={event => { if (event.target === event.currentTarget) close() }}>
    <section className="modal" role="dialog" aria-modal="true" aria-label={title}>
      <div className="modal-head"><h2>{title}</h2><Tool label="Close dialog" onClick={close}><X size={17} /></Tool></div>
      {children}
    </section>
  </div>
}
