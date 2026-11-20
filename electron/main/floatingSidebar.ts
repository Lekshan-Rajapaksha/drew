import { WebContentsView, type BrowserWindow, type View, type WebContentsViewConstructorOptions } from 'electron'
import { SIDEBAR_INSET, SIDEBAR_RADIUS } from '../../shared/model.js'

export class FloatingSidebar {
  private view: WebContentsView | null = null
  private width = 0
  private x = 0
  private target = 0
  private frame: ReturnType<typeof setTimeout> | undefined

  constructor(private window: BrowserWindow, private wireKeys: (contents: WebContentsView['webContents']) => void) {}

  create(options: WebContentsViewConstructorOptions) {
    const view = new WebContentsView(options)
    this.view = view
    view.setBackgroundColor('#00000000')
    view.setBorderRadius(SIDEBAR_RADIUS)
    view.setVisible(false)
    this.window.contentView.addChildView(view)
    const contents = view.webContents
    this.wireKeys(contents)
    contents.setWindowOpenHandler(() => ({ action: 'deny' }))
    contents.on('will-navigate', event => event.preventDefault())
    contents.on('destroyed', () => {
      this.stop()
      this.view = null
      if (!this.window.isDestroyed()) this.window.contentView.removeChildView(view)
    })
    return contents
  }

  get exists() { return this.view !== null }

  // Keep website views below the sidebar even when a new tab attaches while it is open.
  addWebsite(view: View) {
    const root = this.window.contentView
    const index = this.view ? root.children.indexOf(this.view) : -1
    if (index < 0) root.addChildView(view)
    else root.addChildView(view, index)
  }

  layout(width: number, open: boolean, animate: boolean) {
    const view = this.view
    if (!view) return
    if (!width) {
      this.stop()
      this.width = 0
      view.setVisible(false)
      return
    }

    const hidden = 2 * SIDEBAR_INSET - width - 1
    const target = open ? SIDEBAR_INSET : hidden
    if (this.width === width && target === this.target && (animate || !this.frame)) {
      this.position()
      return
    }
    if (!this.width || this.x <= 2 * SIDEBAR_INSET - this.width - 1) this.x = hidden
    if (this.width && this.width !== width && !open) animate = false
    this.width = width
    this.target = target
    this.stop()
    if (!animate || this.x === target) {
      this.x = target
      this.position()
      view.setVisible(open)
      return
    }

    view.setVisible(true)
    const from = this.x
    const travel = Math.min(1, Math.abs(target - from) / (SIDEBAR_INSET - hidden))
    const duration = (open ? 300 : 250) * (0.55 + 0.45 * travel)
    const start = performance.now()
    const tick = () => {
      this.frame = undefined
      const progress = Math.min(1, (performance.now() - start) / duration)
      const eased = progress ** 2 * (3 - 2 * progress)
      this.x = from + (target - from) * eased
      this.position()
      if (progress < 1) this.frame = setTimeout(tick, 16)
      else view.setVisible(open)
    }
    tick()
  }

  resize() { this.position() }

  dispose() {
    this.stop()
    this.view?.webContents.close()
  }

  private position() {
    if (!this.view || !this.width || this.window.isDestroyed()) return
    const [, height] = this.window.getContentSize()
    this.view.setBounds({
      x: Math.round(this.x), y: 0,
      width: this.width - 2 * SIDEBAR_INSET, height,
    })
  }

  private stop() {
    if (this.frame) clearTimeout(this.frame)
    this.frame = undefined
  }
}
