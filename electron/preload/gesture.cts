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
