import { useRef } from 'react'
import type { Workspace } from '../shared/model'

export function useSpaceGesture(spaces: Workspace[], active: string, select: (id: string) => void) {
  const wheel = useRef({ distance: 0, last: 0, switched: 0 })
  const touch = useRef<{ x: number; y: number } | null>(null)
  const advance = (direction: number) => {
    const index = spaces.findIndex(space => space.id === active)
    if (index < 0 || spaces.length < 2) return
    select(spaces[(index + direction + spaces.length) % spaces.length].id)
  }
  return {
    onWheel: (event: React.WheelEvent) => {
      const dx = event.shiftKey && !event.deltaX ? event.deltaY : event.deltaX
      if (event.ctrlKey || Math.abs(dx) <= Math.abs(event.shiftKey ? 0 : event.deltaY)) return
      const now = performance.now()
      const gesture = wheel.current
      const elapsed = now - gesture.last
      gesture.last = now
      if (gesture.switched && now - gesture.switched < 520) return
      if (elapsed > 140 || Math.sign(gesture.distance) !== Math.sign(dx)) gesture.distance = 0
      gesture.distance += dx * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 200 : 1)
      if (Math.abs(gesture.distance) < 64) return
      advance(Math.sign(gesture.distance))
      gesture.distance = 0
      gesture.switched = now
    },
    onTouchStart: (event: React.TouchEvent) => {
      const point = event.touches[0]
      touch.current = point ? { x: point.clientX, y: point.clientY } : null
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
