import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BrowserWindow, type WebContents } from 'electron'

export async function showPrintPreview(parent: BrowserWindow, source: WebContents) {
  const pdf = await source.printToPDF({ printBackground: true, preferCSSPageSize: true })
  if (parent.isDestroyed() || source.isDestroyed()) return
  const directory = await mkdtemp(join(tmpdir(), 'drew-print-'))
  const cleanup = () => rm(directory, { recursive: true, force: true }).catch(() => {})
  let preview: BrowserWindow | undefined
  try {
    const path = join(directory, 'Print preview.pdf')
    await writeFile(path, pdf, { mode: 0o600 })
    if (parent.isDestroyed()) { await cleanup(); return }
    preview = new BrowserWindow({
      parent, modal: true, show: false, width: 880, height: 740, title: 'Print preview',
      autoHideMenuBar: true, webPreferences: {
        plugins: true, sandbox: true, contextIsolation: true, nodeIntegration: false,
      },
    })
    const window = preview
    window.once('closed', () => { void cleanup() })
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.on('will-navigate', event => event.preventDefault())
    window.webContents.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown' && input.key === 'Escape') { event.preventDefault(); window.close() }
    })
    window.on('page-title-updated', event => event.preventDefault())
    await window.loadFile(path)
    if (!window.isDestroyed()) window.show()
  } catch (error) {
    if (preview && !preview.isDestroyed()) preview.destroy()
    else await cleanup()
    throw error
  }
}
