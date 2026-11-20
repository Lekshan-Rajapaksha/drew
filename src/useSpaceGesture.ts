import { useRef } from 'react'
import type { Workspace } from '../shared/model'

const wheelQuietTime = 270

export function useSpaceGesture(spaces: Workspace[], active: string, select: (id: string, direction?: number) => void) {
  const wheel = useRef({ distance: 0, last: -Infinity, consumed: false })
  const touch = useRef<{ x: number; y: number } | null>(null)
  const overSidebar = (target: EventTarget) => target instanceof Element && Boolean(target.closest('.spatial-sidebar, .service-rail'))
  const advance = (direction: number) => {
    const index = spaces.findIndex(space => space.id === active)
    if (index < 0 || spaces.length < 2) return
    select(spaces[(index + direction + spaces.length) % spaces.length].id, direction)
  }
  return {
    onWheel: (event: React.WheelEvent) => {
      const now = performance.now()
      const gesture = wheel.current
      if (now - gesture.last >= wheelQuietTime) {
        gesture.distance = 0
        gesture.consumed = false
      }
      // Momentum can continue past a fixed cooldown and cross between chrome surfaces.
      // Every event in the burst extends the latch until the trackpad is quiet.
      gesture.last = now
      if (gesture.consumed || event.ctrlKey || !overSidebar(event.target)) return
      const dx = event.shiftKey && !event.deltaX ? event.deltaY : event.deltaX
      if (Math.abs(dx) <= Math.abs(event.shiftKey ? 0 : event.deltaY)) return
      if (Math.sign(gesture.distance) !== Math.sign(dx)) gesture.distance = 0
      gesture.distance += dx * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 200 : 1)
      if (Math.abs(gesture.distance) < 64) return
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
