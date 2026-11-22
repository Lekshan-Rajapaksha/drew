import { useEffect, useRef } from 'react'
import type { SpaceScroll, Workspace } from '../shared/model'

export type SwipePreview = { id: string; direction: number; progress: number; settling?: boolean }
type Swipe = { id: string; direction: number; wheelGesture: boolean }
type PendingSwipe = { swipe: Swipe; timer?: ReturnType<typeof setTimeout> }

export function useSpaceGesture(
  spaces: Workspace[], active: string, select: (id: string) => Promise<boolean>, sidebarLimit: number,
  preview: (value: SwipePreview | null) => void, animate: boolean,
) {
  const wheel = useRef({ distance: 0, last: -Infinity, consumed: false })
  const native = useRef({ available: false, distance: 0, consumed: false })
  const previousSpace = useRef(active)
  const queue = useRef<Swipe[]>([])
  const touch = useRef<{ x: number; y: number } | null>(null)
  const wheelIdle = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const pending = useRef<PendingSwipe | null>(null)
  const visible = useRef<SwipePreview | null>(null)
  const previewFrame = useRef(0)
  const retreatTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const overSidebar = (target: EventTarget) => Boolean((target as Element).closest?.('.spatial-sidebar'))
  const neighbor = (direction: number) => {
    const current = queue.current.at(-1)?.id ?? pending.current?.swipe.id ?? active
    const index = spaces.findIndex(space => space.id === current)
    if (index < 0 || spaces.length < 2) return
    return spaces[(index + direction + spaces.length) % spaces.length].id
  }
  const show = (value: SwipePreview | null) => {
    cancelAnimationFrame(previewFrame.current)
    clearTimeout(retreatTimer.current)
    visible.current = value
    preview(value)
  }
  const retreat = () => {
    const current = visible.current
    if (pending.current || !current || current.progress === 0) return
    show({ ...current, progress: 0, settling: true })
    retreatTimer.current = setTimeout(() => show(null), 200)
  }
  const showPreview = (distance: number, threshold: number) => {
    const direction = Math.sign(distance)
    const id = direction && neighbor(direction)
    if (!animate || pending.current) return
    if (!id) { retreat(); return }
    cancelAnimationFrame(previewFrame.current)
    previewFrame.current = requestAnimationFrame(() => show({ id, direction, progress: Math.min(.78, Math.abs(distance) / threshold * .78) }))
  }
  const cancelSwipe = () => {
    clearTimeout(wheelIdle.current)
    clearTimeout(pending.current?.timer)
    pending.current = null
    queue.current = []
    show(null)
  }
  const startNext = () => {
    if (pending.current) return
    const swipe = queue.current.shift()
    if (!swipe) return
    const current: PendingSwipe = { swipe }
    pending.current = current
    const commit = () => {
      if (swipe.wheelGesture) wheel.current.last = performance.now()
      void select(swipe.id).then(ok => { if (!ok && pending.current === current) cancelSwipe() })
    }
    if (!animate) { commit(); return }
    show({ ...swipe, progress: 1, settling: true })
    current.timer = setTimeout(commit, 250)
  }
  const advance = (direction: number, wheelGesture = false) => {
    const next = neighbor(direction)
    if (!next) return
    queue.current.push({ id: next, direction, wheelGesture })
    startNext()
  }
  const receive = useRef<(event: SpaceScroll) => void>(() => {})
  useEffect(() => {
    if (previousSpace.current !== active) {
      previousSpace.current = active
      if (pending.current?.swipe.id === active) {
        pending.current = null
        show(null)
        startNext()
      } else cancelSwipe()
    }
    receive.current = event => {
      if (event.momentum) return
      const gesture = native.current
      if (event.phase === 'begin' || event.phase === 'end') {
        if (event.phase === 'begin' || !gesture.consumed) retreat()
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
    return () => { unsubscribe(); cancelAnimationFrame(previewFrame.current); clearTimeout(wheelIdle.current); clearTimeout(retreatTimer.current); clearTimeout(pending.current?.timer) }
  }, [])
  return {
    cancelSwipe,
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
        wheelIdle.current = setTimeout(retreat, 175)
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
      else retreat()
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
      retreat()
    },
    onTouchCancel: () => { touch.current = null; retreat() },
  }
}
