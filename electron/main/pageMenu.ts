import { clipboard, dialog, Menu, type BrowserWindow, type ContextMenuParams, type MenuItemConstructorOptions, type WebContents } from 'electron'
import { engines, type Settings } from '../../shared/model.js'
import { webUrl } from '../../shared/navigation.js'

export function showPageMenu(window: BrowserWindow, contents: WebContents, params: ContextMenuParams, actions: {
  engine: Settings['engine']; openTab: (url: string, foreground: boolean) => void
  openWindow?: (url: string) => void; fill?: () => void; report: (error: unknown) => void
}) {
  const location = contents.getURL()
  const current = () => !contents.isDestroyed() && !window.isDestroyed() && contents.getURL() === location
  const item = (label: string, run: () => unknown, enabled = true): MenuItemConstructorOptions => ({
    label, enabled, click: () => {
      if (current()) void Promise.resolve().then(() => { if (current()) return run() }).catch(actions.report)
    },
  })
  const section = (items: MenuItemConstructorOptions[]) => {
    if (!items.length) return
    if (menu.length) menu.push({ type: 'separator' })
    menu.push(...items)
  }
  const menu: MenuItemConstructorOptions[] = []
  const link = webUrl(params.linkURL)
  const media = webUrl(params.srcURL)
  const image = params.mediaType === 'image'
  const password = params.formControlType === 'input-password'
  const selection = password ? '' : params.selectionText.trim().slice(0, 2048)
  const edit = params.editFlags

  if (link) section([
    item('Open Link in New Tab', () => actions.openTab(link, false)),
    ...(actions.openWindow ? [item('Open Link in New Window', () => actions.openWindow?.(link))] : []),
    item('Save Link', () => contents.downloadURL(link)),
    item('Copy Link Address', () => clipboard.writeText(link)),
    ...(params.linkText ? [item('Copy Link Text', () => clipboard.writeText(params.linkText))] : []),
  ])
  if (image || (media && ['audio', 'video'].includes(params.mediaType))) {
    const type = image ? 'Image' : params.mediaType === 'video' ? 'Video' : 'Audio'
    section([
      ...(media ? [
        item('Open ' + type + ' in New Tab', () => actions.openTab(media, false)),
        item('Save ' + type, () => contents.downloadURL(media), image || params.mediaFlags.canSave),
        item('Copy ' + type + ' Address', () => clipboard.writeText(media)),
      ] : []),
      ...(image && params.hasImageContents ? [item('Copy Image', () => contents.copyImageAt(params.x, params.y))] : []),
    ])
  }
  if (params.isEditable) {
    if (!password && params.misspelledWord && params.spellcheckEnabled) section([
      ...params.dictionarySuggestions.slice(0, 6).map(word => item(word, () => contents.replaceMisspelling(word))),
      item('Add to Dictionary', () => contents.session.addWordToSpellCheckerDictionary(params.misspelledWord)),
    ])
    section([
      ...(actions.fill ? [item('Fill Saved Login', actions.fill)] : []),
      item('Undo', () => contents.undo(), edit.canUndo),
      item('Redo', () => contents.redo(), edit.canRedo),
      ...(!password ? [item('Cut', () => contents.cut(), edit.canCut), item('Copy', () => contents.copy(), edit.canCopy)] : []),
      item('Paste', () => contents.paste(), edit.canPaste),
      ...(edit.canEditRichly ? [item('Paste as Plain Text', () => contents.pasteAndMatchStyle(), edit.canPaste)] : []),
      item('Delete', () => contents.delete(), edit.canDelete),
      item('Select All', () => contents.selectAll(), edit.canSelectAll),
    ])
  }
  if (selection) section([
    ...(!params.isEditable ? [item('Copy', () => contents.copy(), edit.canCopy)] : []),
    item('Search the Web for Selection', () => actions.openTab(engines[actions.engine] + encodeURIComponent(selection), true)),
  ])
  if (!link && !params.isEditable && !selection && params.mediaType === 'none') section([
    item('Back', () => contents.navigationHistory.goBack(), contents.navigationHistory.canGoBack()),
    item('Forward', () => contents.navigationHistory.goForward(), contents.navigationHistory.canGoForward()),
    item('Reload', () => contents.reload()),
    item('Save Page As…', async () => {
      const result = await dialog.showSaveDialog(window, { defaultPath: 'webpage.html', filters: [{ name: 'Web page', extensions: ['html'] }] })
      if (!result.canceled && result.filePath && current()) await contents.savePage(result.filePath, 'HTMLOnly')
    }),
    item('Print…', () => contents.print()),
    item('Copy Page Address', () => location && clipboard.writeText(location)),
    item('Select All', () => contents.selectAll(), edit.canSelectAll),
  ])
  section([item('Inspect', () => contents.inspectElement(params.x, params.y))])
  Menu.buildFromTemplate(menu).popup({ window })
}
