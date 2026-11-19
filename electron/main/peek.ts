import { BrowserWindow, Menu, type Session } from 'electron'
import { webUrl } from '../../shared/navigation.js'

export function openPeek(parent: BrowserWindow, profile: Session, url: string, promote: (url: string) => void, javascript: boolean) {
  const preview = new BrowserWindow({
    parent, modal: true, show: false, width: 900, height: 650, title: 'LexN · Link preview',
    backgroundColor: '#171a21', autoHideMenuBar: true,
    webPreferences: { session: profile, sandbox: true, nodeIntegration: false, contextIsolation: true, webSecurity: true, javascript },
  })
  const contents = preview.webContents
  const moveToTab = () => {
    const address = webUrl(contents.getURL()) ?? url
    preview.close()
    promote(address)
  }
  contents.on('will-navigate', event => { if (!webUrl(event.url)) event.preventDefault() })
  contents.on('will-redirect', event => { if (event.isMainFrame && !webUrl(event.url)) event.preventDefault() })
  contents.setWindowOpenHandler(() => ({ action: 'deny' }))
  contents.on('page-title-updated', event => event.preventDefault())
  contents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return
    if (input.key === 'Escape') { event.preventDefault(); preview.close() }
    if ((input.meta || input.control) && input.key === 'Enter') { event.preventDefault(); moveToTab() }
  })
  contents.on('context-menu', () => Menu.buildFromTemplate([
    { label: 'Open in Full Tab', click: moveToTab },
    { label: 'Close Preview', click: () => preview.close() },
  ]).popup({ window: preview }))
  preview.once('ready-to-show', () => preview.show())
  void contents.loadURL(url).catch(() => { if (!preview.isDestroyed()) preview.close() })
  return preview
}
