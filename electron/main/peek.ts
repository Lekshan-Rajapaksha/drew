import { BrowserWindow, Menu, WebContentsView, type Session } from 'electron'
import { join } from 'node:path'
import { webUrl } from '../../shared/navigation.js'

const stripHeight = 58
const strip = 'data:text/html;charset=utf-8,' + encodeURIComponent(`<!doctype html>
<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>Drew · Link preview</title>
<style>
  *{box-sizing:border-box} body{margin:0;height:58px;display:flex;align-items:center;gap:12px;padding:0 14px;background:#171a21;color:#f3f5fb;font:13px system-ui}
  #site{min-width:0;flex:1} #connection{display:block;color:#b9c1d1;font-size:11px} #origin{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;direction:ltr;text-align:left}
  button{background:#2b3447;color:#fff;border:1px solid #49556d;border-radius:8px;padding:8px 10px;font:inherit;white-space:nowrap}
  button:focus-visible{outline:2px solid #a7c7ff;outline-offset:2px}
</style><div id="site"><span id="connection" role="status">Connecting</span><strong id="origin" dir="ltr"></strong></div>
<button id="open" type="button">Open in full tab</button>`)

export function openPeek(parent: BrowserWindow, profile: Session, url: string, promote: (url: string) => void, javascript: boolean) {
  const preview = new BrowserWindow({
    parent, modal: true, show: false, width: 900, height: 650, title: 'Drew · Link preview',
    backgroundColor: '#171a21', autoHideMenuBar: true,
    webPreferences: { preload: join(import.meta.dirname, '../preload/peek.cjs'), sandbox: true, nodeIntegration: false, contextIsolation: true },
  })
  const page = new WebContentsView({
    webPreferences: { session: profile, sandbox: true, nodeIntegration: false, contextIsolation: true, webSecurity: true, javascript, navigateOnDragDrop: false },
  })
  preview.contentView.addChildView(page)
  const contents = page.webContents
  const chrome = preview.webContents
  let address = url
  let status = 'Connecting'
  const update = () => {
    if (!chrome.isDestroyed() && chrome.getURL() === strip) chrome.send('drew:peek-status', new URL(address).origin, address, status)
  }
  const resize = () => {
    const [width, height] = preview.getContentSize()
    page.setBounds({ x: 0, y: stripHeight, width, height: Math.max(0, height - stripHeight) })
  }
  const moveToTab = () => {
    preview.close()
    promote(address)
  }
  for (const surface of [contents, chrome]) {
    surface.setWindowOpenHandler(() => ({ action: 'deny' }))
    surface.on('will-attach-webview', event => event.preventDefault())
    surface.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return
      if (input.key === 'Escape') { event.preventDefault(); preview.close() }
      if ((input.meta || input.control) && input.key === 'Enter') { event.preventDefault(); moveToTab() }
    })
  }
  chrome.on('will-navigate', event => event.preventDefault())
  chrome.ipc.on('drew:peek-promote', event => {
    if (event.senderFrame === chrome.mainFrame && event.senderFrame?.url === strip) moveToTab()
  })
  contents.on('will-navigate', event => { if (!webUrl(event.url)) event.preventDefault() })
  contents.on('will-redirect', event => { if (event.isMainFrame && !webUrl(event.url)) event.preventDefault() })
  contents.on('did-start-navigation', event => {
    if (!event.isMainFrame || event.isSameDocument || !webUrl(event.url)) return
    address = event.url
    status = 'Connecting'
    page.setVisible(false)
    update()
  })
  contents.on('did-redirect-navigation', event => {
    if (event.isMainFrame && webUrl(event.url)) { address = event.url; update() }
  })
  const committed = (target: string) => {
    if (!webUrl(target)) return
    address = target
    status = new URL(target).protocol === 'https:' ? 'HTTPS connection' : 'Unencrypted HTTP'
    page.setVisible(true)
    contents.focus()
    update()
  }
  contents.on('did-navigate', (_event, target) => committed(target))
  contents.on('did-navigate-in-page', (_event, target, main) => { if (main) committed(target) })
  contents.on('did-fail-load', (_event, code, _description, target, main) => {
    if (!main || code === -3) return
    address = webUrl(target) ?? address
    status = 'Page failed to load'
    update()
  })
  contents.on('context-menu', () => Menu.buildFromTemplate([
    { label: 'Open in Full Tab', click: moveToTab },
    { label: 'Close Preview', click: () => preview.close() },
  ]).popup({ window: preview }))
  preview.on('resize', resize)
  preview.on('closed', () => { if (!contents.isDestroyed()) contents.close() })
  resize()
  void chrome.loadURL(strip).then(() => {
    if (preview.isDestroyed()) return
    update()
    preview.show()
    contents.focus()
    return contents.loadURL(url)
  }).catch(() => {
    if (preview.isDestroyed()) return
    status = 'Page failed to load'
    update()
  })
  return preview
}
