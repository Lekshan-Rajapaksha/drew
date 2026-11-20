import { useEffect, useRef } from 'react'
import type { SpaceScroll, Workspace } from '../shared/model'

export type SwipePreview = { id: string; direction: number; progress: number; settling?: boolean }

export function useSpaceGesture(
  spaces: Workspace[], active: string, select: (id: string, direction?: number) => void, sidebarLimit: number,
  preview: (value: SwipePreview | null) => void, animate: boolean,
) {
  const wheel = useRef({ distance: 0, last: -Infinity, consumed: false })
  const native = useRef({ available: false, distance: 0, consumed: false })
  const route = useRef({ actual: active, queued: [] as string[] })
  const touch = useRef<{ x: number; y: number } | null>(null)
  const wheelIdle = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const pending = useRef<{ timer: ReturnType<typeof setTimeout>; commit: () => void } | null>(null)
  const overSidebar = (target: EventTarget) => Boolean((target as Element).closest?.('.spatial-sidebar'))
  const neighbor = (direction: number) => {
    const prediction = route.current
    if (prediction.actual !== active) {
      const confirmed = prediction.queued.indexOf(active)
      prediction.queued = confirmed === -1 ? [] : prediction.queued.slice(confirmed + 1)
      prediction.actual = active
    }
    const current = prediction.queued.at(-1) ?? active
    const index = spaces.findIndex(space => space.id === current)
    if (index < 0 || spaces.length < 2) return
    return spaces[(index + direction + spaces.length) % spaces.length].id
  }
  const showPreview = (distance: number, threshold: number) => {
    const direction = Math.sign(distance)
    const id = direction && neighbor(direction)
    if (animate && !pending.current) preview(id ? { id, direction, progress: Math.min(.78, Math.abs(distance) / threshold * .78) } : null)
  }
  const advance = (direction: number, wheelGesture = false) => {
    const next = neighbor(direction)
    if (!next) return
    route.current.queued.push(next)
    if (pending.current) {
      clearTimeout(pending.current.timer)
      pending.current.commit()
    }
    if (!animate) { select(next, direction); return }
    preview({ id: next, direction, progress: 1, settling: true })
    const commit = () => {
      pending.current = null
      if (wheelGesture) wheel.current.last = performance.now()
      select(next, direction)
    }
    pending.current = { commit, timer: setTimeout(commit, 250) }
  }
  const receive = useRef<(event: SpaceScroll) => void>(() => {})
  useEffect(() => {
    receive.current = event => {
      if (event.momentum) return
      const gesture = native.current
      if (event.phase === 'begin' || event.phase === 'end') {
        if (!pending.current && (event.phase === 'begin' || !gesture.consumed)) preview(null)
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
      } else showPreview(gesture.distance, 45)
    }
  })
  useEffect(() => {
    void window.lexn.usesNativeSpaceScroll().then(available => { native.current.available = available }).catch(() => {})
    const unsubscribe = window.lexn.onSpaceScroll(event => receive.current(event))
    return () => { unsubscribe(); clearTimeout(wheelIdle.current); clearTimeout(pending.current?.timer) }
  }, [])
  return {
    cancelSwipe: () => {
      clearTimeout(wheelIdle.current)
      clearTimeout(pending.current?.timer)
      pending.current = null
      route.current.queued = []
      preview(null)
    },
    onWheel: (event: React.WheelEvent) => {
      if (native.current.available && event.nativeEvent.isTrusted) return
      if (event.ctrlKey || !overSidebar(event.target)) return
      const dx = event.shiftKey && !event.deltaX ? event.deltaY : event.deltaX
      const horizontal = Math.abs(dx) > Math.abs(event.shiftKey ? 0 : event.deltaY)
      if (horizontal && event.deltaMode !== 0) { advance(Math.sign(dx)); return }
      const now = performance.now()
      const gesture = wheel.current
      const quietPeriod = gesture.consumed ? 270 : 175
      if (now - gesture.last >= quietPeriod || (horizontal && gesture.consumed && Math.sign(dx) !== Math.sign(gesture.distance))) {
        gesture.distance = 0
        gesture.consumed = false
      }
      gesture.last = now
      if (gesture.consumed || !horizontal) return
      if (Math.sign(gesture.distance) !== Math.sign(dx)) gesture.distance = 0
      gesture.distance += dx
      clearTimeout(wheelIdle.current)
      if (Math.abs(gesture.distance) < 52) {
        showPreview(gesture.distance, 52)
        wheelIdle.current = setTimeout(() => { if (!pending.current) preview(null) }, 175)
        return
      }
      gesture.consumed = true
      advance(Math.sign(gesture.distance), true)
    },
    onTouchStart: (event: React.TouchEvent) => {
      const point = event.touches[0]
      touch.current = point && overSidebar(event.target) ? { x: point.clientX, y: point.clientY } : null
    },
    onTouchMove: (event: React.TouchEvent) => {
      const point = event.touches[0]
      if (!touch.current || !point) return
      const dx = touch.current.x - point.clientX
      const dy = touch.current.y - point.clientY
      if (Math.abs(dx) > Math.abs(dy) * 1.4) showPreview(dx, 55)
      else preview(null)
    },
    onTouchEnd: (event: React.TouchEvent) => {
      const point = event.changedTouches[0]
      if (touch.current && point) {
        const dx = touch.current.x - point.clientX
        const dy = touch.current.y - point.clientY
        if (Math.abs(dx) >= 45 && Math.abs(dx) > Math.abs(dy) * 1.4) {
          touch.current = null
          advance(Math.sign(dx))
          return
        }
      }
      touch.current = null
      preview(null)
    },
    onTouchCancel: () => { touch.current = null; preview(null) },
  }
}
