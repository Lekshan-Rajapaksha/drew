import { useEffect, useRef } from 'react'
import type { SpaceScroll, Workspace } from '../shared/model'

export function useSpaceGesture(
  spaces: Workspace[], active: string, select: (id: string, direction?: number) => void, sidebarLimit: number,
) {
  const wheel = useRef({ distance: 0, last: -Infinity, consumed: false })
  const native = useRef({ available: false, distance: 0, consumed: false })
  const route = useRef({ actual: active, queued: [] as string[] })
  const touch = useRef<{ x: number; y: number } | null>(null)
  const overSidebar = (target: EventTarget) => Boolean((target as Element).closest?.('.spatial-sidebar'))
  const advance = (direction: number) => {
    const prediction = route.current
    if (prediction.actual !== active) {
      const confirmed = prediction.queued.indexOf(active)
      prediction.queued = confirmed === -1 ? [] : prediction.queued.slice(confirmed + 1)
      prediction.actual = active
    }
    const current = prediction.queued.at(-1) ?? active
    const index = spaces.findIndex(space => space.id === current)
    if (index < 0 || spaces.length < 2) return
    const next = spaces[(index + direction + spaces.length) % spaces.length].id
    prediction.queued.push(next)
    select(next, direction)
  }
  const receive = useRef<(event: SpaceScroll) => void>(() => {})
  useEffect(() => {
    receive.current = event => {
      if (event.momentum) return
      const gesture = native.current
      if (event.phase === 'begin' || event.phase === 'end') {
        gesture.distance = 0
        gesture.consumed = false
      }
      if (event.phase === 'end' || event.x < 0 || event.x >= sidebarLimit || Math.abs(event.dx) <= Math.abs(event.dy)) return
      if (event.phase === 'discrete') { advance(Math.sign(event.dx)); return }
      if (gesture.consumed) return
      gesture.distance += event.dx
      if (Math.abs(gesture.distance) >= 45) {
        gesture.consumed = true
        advance(Math.sign(gesture.distance))
      }
    }
  })
  useEffect(() => {
    void window.lexn.usesNativeSpaceScroll().then(available => { native.current.available = available }).catch(() => {})
    return window.lexn.onSpaceScroll(event => receive.current(event))
  }, [])
  return {
    onWheel: (event: React.WheelEvent) => {
      if (native.current.available && event.nativeEvent.isTrusted) return
      if (event.ctrlKey || !overSidebar(event.target)) return
      const dx = event.shiftKey && !event.deltaX ? event.deltaY : event.deltaX
      const horizontal = Math.abs(dx) > Math.abs(event.shiftKey ? 0 : event.deltaY)
      if (horizontal && event.deltaMode !== 0) { advance(Math.sign(dx)); return }
      const now = performance.now()
      const gesture = wheel.current
      if (now - gesture.last >= 175 || (horizontal && gesture.consumed && Math.sign(dx) !== Math.sign(gesture.distance))) {
        gesture.distance = 0
        gesture.consumed = false
      }
      gesture.last = now
      if (gesture.consumed || !horizontal) return
      if (Math.sign(gesture.distance) !== Math.sign(dx)) gesture.distance = 0
      gesture.distance += dx
      if (Math.abs(gesture.distance) < 52) return
      gesture.consumed = true
      advance(Math.sign(gesture.distance))
    },
    onTouchStart: (event: React.TouchEvent) => {
      const point = event.touches[0]
      touch.current = point && overSidebar(event.target) ? { x: point.clientX, y: point.clientY } : null
    },
    onTouchEnd: (event: React.TouchEvent) => {
      const point = event.changedTouches[0]
      if (touch.current && point) {
        const dx = touch.current.x - point.clientX
        const dy = touch.current.y - point.clientY
        if (Math.abs(dx) >= 45 && Math.abs(dx) > Math.abs(dy) * 1.4) advance(Math.sign(dx))
      }
      touch.current = null
    },
    onTouchCancel: () => { touch.current = null },
  }
}
