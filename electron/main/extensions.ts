import { BrowserWindow, type Extension, type Session } from 'electron'

export function extensionPopup(extension: Extension) {
  const manifest = extension.manifest as { action?: { default_popup?: unknown }; browser_action?: { default_popup?: unknown } }
  const path = manifest.action?.default_popup ?? manifest.browser_action?.default_popup
  return extensionPage(extension, path)
}

export function extensionOptions(extension: Extension) {
  const manifest = extension.manifest as { options_ui?: { page?: unknown }; options_page?: unknown }
  return extensionPage(extension, manifest.options_ui?.page ?? manifest.options_page)
}

function extensionPage(extension: Extension, path: unknown) {
  if (typeof path !== 'string' || !path) return null
  try {
    const url = new URL(path, extension.url)
    return url.protocol === 'chrome-extension:' && url.hostname === extension.id ? url.href : null
  } catch {
    return null
  }
}

export function showExtension(parent: BrowserWindow, profile: Session, extension: Extension, options = false) {
  const address = options ? extensionOptions(extension) : extensionPopup(extension)
  if (!address) throw new Error('This extension does not provide that page.')
  const window = new BrowserWindow({
    parent, show: false, width: options ? 740 : 420, height: options ? 620 : 500, title: extension.name, autoHideMenuBar: true,
    webPreferences: { session: profile, sandbox: true, nodeIntegration: false, contextIsolation: true, webSecurity: true },
  })
  const contents = window.webContents
  const allowed = (value: string) => {
    try {
      const url = new URL(value)
      return url.protocol === 'chrome-extension:' && url.hostname === extension.id
    } catch {
      return false
    }
  }
  contents.on('will-navigate', event => { if (!allowed(event.url)) event.preventDefault() })
  contents.on('will-redirect', event => { if (event.isMainFrame && !allowed(event.url)) event.preventDefault() })
  contents.setWindowOpenHandler(() => ({ action: 'deny' }))
  contents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'Escape') {
      event.preventDefault()
      window.close()
    }
  })
  window.once('ready-to-show', () => window.show())
  void contents.loadURL(address).catch(() => { if (!window.isDestroyed()) window.close() })
}
