export const shortcutDefinitions = {
  newWindow: { label: 'New window', binding: 'N' },
  command: { label: 'Open Command Bar', binding: 'T' },
  address: { label: 'Focus address bar', binding: 'L' },
  fillLogin: { label: 'Fill saved login', binding: 'Shift+L' },
  closeTab: { label: 'Close current tab', binding: 'W' },
  reopenTab: { label: 'Reopen closed tab', binding: 'Shift+T' },
  find: { label: 'Find in page', binding: 'F' },
  print: { label: 'Print page', binding: 'P' },
  reload: { label: 'Reload page', binding: 'R' },
  sidebar: { label: 'Toggle sidebar', binding: 'S' },
  toolbar: { label: 'Toggle top toolbar', binding: 'Shift+Y' },
  split: { label: 'Open Split View', binding: 'Shift+D' },
  bookmarks: { label: 'Open bookmarks', binding: 'Shift+B' },
  history: { label: 'Open history', binding: 'H' },
  downloads: { label: 'Open downloads', binding: 'J' },
  settings: { label: 'Open Settings', binding: ',' },
} as const

export type ShortcutAction = keyof typeof shortcutDefinitions
export const shortcutActions = Object.keys(shortcutDefinitions) as ShortcutAction[]
export const shortcutKeys = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789,'.split('')

export function defaultShortcut(action: ShortcutAction, platform: string): string {
  return platform === 'darwin' && action === 'history' ? 'Shift+H' : shortcutDefinitions[action].binding
}

export function allowedShortcut(binding: string, platform: string) {
  if (!/^(Shift\+)?[A-Z0-9,]$/.test(binding)) return false
  const reserved = ['A', 'C', 'V', 'X', 'Y', 'Z', 'Shift+Z', 'Shift+N']
  if (platform === 'darwin') reserved.push('H', 'M', 'Q', 'Shift+Q', 'Shift+W')
  return !reserved.includes(binding)
}

export function shortcutOverrides(raw: string, platform: string): Partial<Record<ShortcutAction, string>> {
  try {
    const saved: unknown = JSON.parse(raw)
    if (!saved || typeof saved !== 'object') return {}
    const entries = saved as Record<string, unknown>
    return Object.fromEntries(shortcutActions.flatMap(action => {
      const binding = entries[action]
      return typeof binding === 'string' && allowedShortcut(binding, platform) ? [[action, binding]] : []
    }))
  } catch {
    return {}
  }
}

export function effectiveShortcuts(raw: string, platform: string) {
  const overrides = shortcutOverrides(raw, platform)
  return Object.fromEntries(shortcutActions.map(action => [action, overrides[action] ?? defaultShortcut(action, platform)])) as Record<ShortcutAction, string>
}

export function shortcutLabel(binding: string, platform: string) {
  return (platform === 'darwin' ? '⌘' : 'Ctrl+') + binding.replace('Shift+', platform === 'darwin' ? '⇧' : 'Shift+')
}

export function keyBinding(key: string, code: string, shift: boolean) {
  const normalized = code === 'Comma' ? ',' : /^Digit[0-9]$/.test(code) ? code.slice(-1) : key.toUpperCase()
  return (shift ? 'Shift+' : '') + normalized
}
