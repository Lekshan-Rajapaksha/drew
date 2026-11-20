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

function visibleInput(input: HTMLInputElement) {
  return !input.disabled && !input.readOnly && input.getClientRects().length > 0 &&
    input.checkVisibility({ opacityProperty: true, visibilityProperty: true })
}

function safePassword(input: HTMLInputElement) {
  if (input.type !== 'password' || input.autocomplete.split(/\s+/).includes('new-password') || !visibleInput(input)) return false
  const form = input.form
  if (!form) return true
  if (form.method !== 'post') return false
  if (form.querySelectorAll('input[type=password]').length > 1 && !input.autocomplete.split(/\s+/).includes('current-password')) return false
  try {
    if (new URL(form.getAttribute('action') || location.href, document.baseURI).origin !== location.origin) return false
    return [...form.querySelectorAll('[formaction], [formmethod]')].every(element =>
      (!element.hasAttribute('formmethod') || element.getAttribute('formmethod')?.toLowerCase() === 'post') &&
      new URL(element.getAttribute('formaction') || location.href, document.baseURI).origin === location.origin)
  } catch { return false }
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
  let prepared: { token: string; url: string; input: HTMLInputElement; time: number } | undefined
  window.addEventListener('pagehide', () => { prepared = undefined })
  let lastOffer = -Infinity
  window.addEventListener('pointerup', event => {
    if (event.isTrusted && event.button === 0 && event.target instanceof HTMLInputElement && event.target === document.activeElement && !event.target.value &&
        location.protocol === 'https:' && safePassword(event.target) && performance.now() - lastOffer > 900) {
      lastOffer = performance.now()
      ipcRenderer.send('lexn:offer-login')
    }
  }, { passive: true })
  ipcRenderer.on('lexn:login-prepare', (_event, token: string, origin: string) => {
    const input = location.protocol === 'https:' && location.origin === origin ? loginField() : undefined
    prepared = input ? { token, url: location.href, input, time: performance.now() } : undefined
    ipcRenderer.send('lexn:login-result', 'prepare', token, Boolean(input))
  })
  ipcRenderer.on('lexn:login-apply', (_event, token: string, origin: string, username: string, password: string) => {
    const entry = prepared
    prepared = undefined
    const valid = entry && entry.token === token && entry.url === location.href && location.origin === origin &&
      performance.now() - entry.time < 30_000 && entry.input.isConnected && safePassword(entry.input)
    if (valid) {
      const input = entry.input
      const user = username ? usernameField(input) : undefined
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      setValue?.call(input, password)
      if (user) setValue?.call(user, username)
      for (const field of user ? [user, input] : [input]) {
        field.dispatchEvent(new Event('input', { bubbles: true, composed: true }))
        field.dispatchEvent(new Event('change', { bubbles: true }))
      }
    }
    ipcRenderer.send('lexn:login-result', 'apply', token, Boolean(valid))
  })
}
