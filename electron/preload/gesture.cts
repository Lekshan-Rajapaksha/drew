import { ipcRenderer } from 'electron'

let lastWheel = -Infinity
let distance = 0
let consumed = false

function scrollsHorizontally(target: EventTarget) {
  if (!(target instanceof Element)) return false
  const style = getComputedStyle(target)
  const root = target === document.scrollingElement
  const canScroll = target.scrollWidth - target.clientWidth > 1 &&
    (root || ['auto', 'scroll', 'overlay'].includes(style.overflowX))
  return canScroll || ((root || ['auto', 'scroll', 'overlay'].includes(style.overflowX)) && style.overscrollBehaviorX !== 'auto')
}

if (process.isMainFrame) window.addEventListener('wheel', event => {
  if (!event.isTrusted || event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey ||
      event.deltaMode !== WheelEvent.DOM_DELTA_PIXEL) return

  const now = performance.now()
  const quiet = now - lastWheel > 195
  lastWheel = now
  if (quiet) {
    distance = 0
    consumed = false
  }
  if (Math.abs(event.deltaX) <= Math.abs(event.deltaY) * 1.6 || event.deltaX === 0) {
    distance = 0
    return
  }
  if (event.composedPath().some(scrollsHorizontally)) {
    distance = 0
    return
  }
  if (consumed) {
    if (event.cancelable) event.preventDefault()
    return
  }
  if (Math.sign(distance) !== Math.sign(event.deltaX)) distance = 0
  distance += event.deltaX
  if (event.cancelable) event.preventDefault()
  if (Math.abs(distance) < 78) return
  consumed = true
  ipcRenderer.send('lexn:history-swipe', distance < 0 ? 'back' : 'forward')
}, { passive: false })

if (process.isMainFrame) ipcRenderer.on('lexn:history-swipe-cue', (_event, direction: unknown, animate: unknown) => {
  if (direction !== 'back' && direction !== 'forward') return
  const left = direction === 'back'
  const host = document.createElement('div')
  host.setAttribute('aria-hidden', 'true')
  host.style.cssText = 'all:initial; position:fixed; top:50%; z-index:2147483647; pointer-events:none;'
  host.style[left ? 'left' : 'right'] = '18px'
  const badge = document.createElement('span')
  badge.textContent = left ? '←' : '→'
  badge.style.cssText = 'display:grid;place-items:center;width:48px;height:48px;border-radius:50%;' +
    'background:#181820;color:white;border:1px solid #ffffff42;box-shadow:0 6px 24px #0005;font:600 25px system-ui;'
  host.attachShadow({ mode: 'closed' }).append(badge)
  document.documentElement.append(host)
  if (animate && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    badge.animate([
      { opacity: 0, transform: 'translateX(' + (left ? '-13px' : '13px') + ') scale(.92)' },
      { opacity: 1, transform: 'none', offset: .36 },
      { opacity: 1, offset: .7 },
      { opacity: 0 },
    ], { duration: 350, easing: 'cubic-bezier(.2,.7,.25,1)', fill: 'both' })
  }
  setTimeout(() => host.remove(), 350)
})

function visibleInput(input: HTMLInputElement) {
  return !input.disabled && !input.readOnly && input.getClientRects().length > 0 &&
    input.checkVisibility({ opacityProperty: true, visibilityProperty: true })
}

function safeDestination(form: HTMLFormElement | null, password: boolean) {
  if (!form) return true
  if (password && form.method !== 'post') return false
  try {
    if (new URL(form.getAttribute('action') || location.href, document.baseURI).origin !== location.origin) return false
    return [...form.querySelectorAll('[formaction], [formmethod]')].every(element =>
      (!password || !element.hasAttribute('formmethod') || element.getAttribute('formmethod')?.toLowerCase() === 'post') &&
      new URL(element.getAttribute('formaction') || location.href, document.baseURI).origin === location.origin)
  } catch { return false }
}

function safePassword(input: HTMLInputElement) {
  const tags = input.autocomplete.split(/\s+/)
  return input.type === 'password' && !tags.includes('new-password') && visibleInput(input) &&
    (!(input.form && input.form.querySelectorAll('input[type=password]').length > 1) || tags.includes('current-password')) &&
    safeDestination(input.form, true)
}

function safeUsername(input: HTMLInputElement) {
  return ['text', 'email', 'tel'].includes(input.type) && input.autocomplete.split(/\s+/).includes('username') &&
    visibleInput(input) && safeDestination(input.form, false)
}

function loginField() {
  if (document.activeElement instanceof HTMLInputElement && safePassword(document.activeElement)) return document.activeElement
  const matches = [...document.querySelectorAll<HTMLInputElement>('input[type=password]')].filter(safePassword)
  return matches.length === 1 ? matches[0] : undefined
}

function usernameField(password: HTMLInputElement) {
  const fields = [...(password.form?.elements ?? document.querySelectorAll('input[autocomplete~=username]'))]
    .filter((field): field is HTMLInputElement => field instanceof HTMLInputElement &&
      ['text', 'email', 'tel'].includes(field.type) && visibleInput(field) &&
      Boolean(field.compareDocumentPosition(password) & Node.DOCUMENT_POSITION_FOLLOWING))
  return fields.find(field => field.autocomplete.split(/\s+/).includes('username')) ??
    fields.find(field => /^(?:user(?:name)?|email|login|identifier)$/.test((field.name || field.id).toLowerCase())) ??
    (fields.length === 1 ? fields[0] : undefined)
}

if (process.isMainFrame) {
  let edited = false
  window.addEventListener('input', event => {
    if (!edited && event.isTrusted) {
      edited = true
      ipcRenderer.send('drew:page-edited')
    }
  }, { capture: true, passive: true })
  let prepared: { token: string; url: string; input: HTMLInputElement; time: number; kind: 'username' | 'password' } | undefined
  window.addEventListener('pagehide', () => { prepared = undefined })
  let lastOffer = -Infinity
  window.addEventListener('pointerup', event => {
    if (event.isTrusted && event.button === 0 && event.target instanceof HTMLInputElement && event.target === document.activeElement && !event.target.value &&
        location.protocol === 'https:' && (safePassword(event.target) || safeUsername(event.target)) && performance.now() - lastOffer > 900) {
      lastOffer = performance.now()
      ipcRenderer.send('lexn:offer-login')
    }
  }, { passive: true })
  ipcRenderer.on('lexn:login-prepare', (_event, token: string, origin: string) => {
    prepared = undefined
    if (location.protocol === 'https:' && location.origin === origin) {
      const active = document.activeElement
      const user = active instanceof HTMLInputElement && safeUsername(active) ? active : undefined
      const pass = loginField()
      const input = pass ?? user
      if (input) prepared = { token, url: location.href, input, time: performance.now(), kind: pass ? 'password' : 'username' }
    }
    ipcRenderer.send('lexn:login-result', 'prepare', token, prepared?.kind ?? false)
  })
  ipcRenderer.on('lexn:login-apply', (_event, token: string, origin: string, username: string, password: string) => {
    const entry = prepared
    prepared = undefined
    const valid = entry && entry.token === token && entry.url === location.href && location.origin === origin &&
      performance.now() - entry.time < 30_000 && entry.input.isConnected &&
      (entry.kind === 'password' ? Boolean(password) && safePassword(entry.input) : !password && Boolean(username) && safeUsername(entry.input))
    if (valid) {
      const input = entry.input
      const user = entry.kind === 'password' && username ? usernameField(input) : undefined
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      setValue?.call(input, entry.kind === 'password' ? password : username)
      if (user) setValue?.call(user, username)
      for (const field of user ? [user, input] : [input]) {
        field.dispatchEvent(new Event('input', { bubbles: true, composed: true }))
        field.dispatchEvent(new Event('change', { bubbles: true }))
      }
    }
    ipcRenderer.send('lexn:login-result', 'apply', token, Boolean(valid))
  })
}
