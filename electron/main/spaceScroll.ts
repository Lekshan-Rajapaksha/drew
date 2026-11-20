import { createRequire } from 'node:module'
import { join } from 'node:path'
import type { BrowserWindow } from 'electron'
import type { SpaceScroll } from '../../shared/model.js'

interface NativeMonitor {
  watch: (handle: Buffer, onScroll: (x: number, dx: number, dy: number, phase: SpaceScroll['phase'], momentum: boolean) => void) => boolean
  unwatch: () => void
}

export function monitorSpaceScroll(window: BrowserWindow, uiUrl: string) {
  if (process.platform !== 'darwin') return null
  try {
    const require = createRequire(import.meta.url)
    const monitor = require(join(import.meta.dirname, '../../native/scroll.node')) as NativeMonitor
    const started = monitor.watch(window.getNativeWindowHandle(), (x, dx, dy, phase, momentum) => {
      if (!window.isDestroyed() && window.webContents.getURL() === uiUrl) {
        window.webContents.send('lexn:space-scroll', { x, dx, dy, phase, momentum } satisfies SpaceScroll)
      }
    })
    return started ? () => monitor.unwatch() : null
  } catch (error) {
    console.warn('Drew native scroll phases are unavailable:', error)
    return null
  }
}
