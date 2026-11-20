import type { ReactNode } from 'react'
import { Globe2, X } from 'lucide-react'
import type { Tab } from '../shared/model'
import { webUrl } from '../shared/navigation'
import wordmark from './assets/drew-wordmark.png'

export function Wordmark({ decorative = false }: { decorative?: boolean }) {
  const matte = useId()
  return <>
    <svg className="wordmark-filter" aria-hidden="true" width="0" height="0">
      <filter id={matte} colorInterpolationFilters="sRGB">
        <feColorMatrix type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  .2126 .7152 .0722 0 0" />
        <feComponentTransfer result="matte"><feFuncA type="linear" slope={29} intercept={-.7} /></feComponentTransfer>
        <feComposite in="SourceGraphic" in2="matte" operator="in" />
      </filter>
    </svg>
    <img className="drew-wordmark" src={wordmark} alt={decorative ? '' : 'Drew'}
      width={720} height={236} style={{ filter: `url(#${matte}) var(--wordmark-tone, opacity(1))` }} />
  </>
}

export function Favicon({ tab, fallback = <Globe2 className="fallback-icon" size={15} /> }: {
  tab: Pick<Tab, 'favicon' | 'url'>; fallback?: ReactNode
}) {
  const site = webUrl(tab.url)
  const defaultIcon = site ? new URL('/favicon.ico', site).href : null
  const source = tab.favicon || defaultIcon
  return <span className="favicon-wrap" aria-hidden="true"><span className="favicon-fallback">{fallback}</span>
    {source && <img key={source} className="favicon" src={source} alt="" referrerPolicy="no-referrer"
      onLoad={event => { event.currentTarget.dataset.loaded = 'true' }}
      onError={event => {
        const img = event.currentTarget
        if (defaultIcon && img.src !== defaultIcon) img.src = defaultIcon
        else img.hidden = true
      }} />}
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
import { useId } from 'react'
