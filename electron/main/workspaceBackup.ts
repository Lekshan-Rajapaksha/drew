import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { dialog, type BrowserWindow } from 'electron'
import { HOME, type SavedTab, type TabGroup } from '../../shared/model.js'
import { webUrl } from '../../shared/navigation.js'
import type { Database } from './database.js'
import { readImportFile } from './importData.js'
import type { Tabs } from './tabs.js'

function object(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid Drew Space backup.')
  return value as Record<string, unknown>
}
function collection(value: unknown, maximum: number) {
  if (!Array.isArray(value) || value.length > maximum) throw new Error('Invalid Drew Space backup collection.')
  return value.map(object)
}
function text(value: unknown, maximum: number) {
  if (typeof value !== 'string' || value.length > maximum) throw new Error('Invalid Drew Space backup field.')
  return value
}

export async function exportSpace(window: BrowserWindow, db: Database, tabs: Tabs) {
  const space = tabs.workspaces().find(space => space.id === tabs.workspaceId)!
  const { canceled, filePath } = await dialog.showSaveDialog(window, {
    defaultPath: 'Drew Space.json', filters: [{ name: 'Drew Space backup', extensions: ['json'] }],
  })
  if (canceled || !filePath || window.isDestroyed() || tabs.workspaceId !== space.id) return
  const groups = db.all<TabGroup>('SELECT id, name, parentId FROM tab_groups WHERE workspaceId = ? ORDER BY rowid', space.id)
  const records = tabs.list().filter(tab => tab.workspaceId === space.id)
  const backup = {
    format: 'drew-space', version: 1, name: space.name, accent: space.accent, icon: space.icon,
    groups, active: tabs.active()?.state.id ?? null, split: tabs.split,
    tabs: records.map(({ id, url, title, pinned, groupId }) => ({ id, url, title, pinned, groupId })),
  }
  await writeFile(filePath, JSON.stringify(backup, null, 2) + '\n', { mode: 0o600 })
}

export async function restoreSpace(window: BrowserWindow, db: Database, tabs: Tabs) {
  const profile = tabs.profileId
  const file = await dialog.showOpenDialog(window, { properties: ['openFile'], filters: [{ name: 'Drew Space backup', extensions: ['json'] }] })
  if (file.canceled || !file.filePaths[0] || window.isDestroyed()) return
  const backup = object(JSON.parse(await readImportFile(file.filePaths[0])))
  if (backup.format !== 'drew-space' || backup.version !== 1) throw new Error('Unsupported Drew Space backup version.')
  const name = text(backup.name, 64)
  const accent = text(backup.accent, 7)
  const icon = text(backup.icon, 32)
  if (!name.trim() || !/^#[a-f0-9]{6}$/i.test(accent)) throw new Error('Invalid Space name or color.')
  const groups = new Map<string, { id: string; name: string; parent: string | null }>()
  for (const group of collection(backup.groups, 500)) {
    const key = text(group.id, 64)
    if (!key || groups.has(key)) throw new Error('Duplicate group in Space backup.')
    groups.set(key, { id: randomUUID(), name: text(group.name, 64), parent: group.parentId === null ? null : text(group.parentId, 64) })
  }
  for (const key of groups.keys()) {
    const visited = new Set<string>()
    let current: string | null = key
    while (current !== null) {
      const group = groups.get(current)
      if (!group || visited.has(current)) throw new Error('Invalid group hierarchy in Space backup.')
      visited.add(current)
      current = group.parent
    }
  }
  const space = randomUUID()
  const ids = new Map<string, string>()
  const records = collection(backup.tabs, 2000).map((tab, position): SavedTab => {
    const key = text(tab.id, 64)
    const address = text(tab.url, 8192)
    const url = address === HOME ? HOME : webUrl(address)
    if (!url || !key || ids.has(key) || (tab.pinned !== 0 && tab.pinned !== 1)) throw new Error('Invalid tab in Space backup.')
    const groupId = tab.groupId === null ? null : groups.get(text(tab.groupId, 64))?.id
    if (groupId === undefined) throw new Error('Missing tab group in Space backup.')
    const id = randomUUID()
    ids.set(key, id)
    return { id, url, title: text(tab.title, 512), workspaceId: space, position, groupId, pinned: tab.pinned,
      favicon: null, lastUsed: Date.now() }
  })
  const split = collection(backup.split, 4).map(pane => {
    const id = ids.get(text(pane.id, 64))
    const { weight } = pane
    if (!id || typeof weight !== 'number' || !Number.isFinite(weight) || weight <= 0 || weight > 50) throw new Error('Invalid split layout.')
    return { id, weight }
  })
  if (new Set(split.map(pane => pane.id)).size !== split.length) throw new Error('Duplicate split pane.')
  const active = backup.active === null ? undefined : ids.get(text(backup.active, 64))
  const destination = tabs.workspaces().find(item => item.id === profile)?.name ?? 'Current Profile'
  const confirm = await dialog.showMessageBox(window, {
    type: 'question', message: 'Restore ' + name + '?',
    detail: 'Create a copy in ' + destination + ' with ' + records.length + ' tabs, ' + groups.size + ' groups and ' + split.length + ' split panes.',
    buttons: ['Restore copy', 'Cancel'], defaultId: 1, cancelId: 1, noLink: true,
  })
  if (confirm.response !== 0 || window.isDestroyed() || tabs.profileId !== profile) return
  db.transaction(() => {
    db.addWorkspace(space, name, accent, profile, icon, false)
    for (const group of groups.values()) db.run('INSERT INTO tab_groups (id, workspaceId, name, parentId) VALUES (?, ?, ?, NULL)', group.id, space, group.name)
    for (const group of groups.values()) if (group.parent) db.run('UPDATE tab_groups SET parentId=? WHERE id=?', groups.get(group.parent)!.id, group.id)
    for (const tab of records) db.run(`INSERT INTO tabs (id, workspaceId, url, title, favicon, pinned, groupId, position, lastUsed, windowId)
      VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)`, tab.id, space, tab.url, tab.title, tab.pinned, tab.groupId, tab.position, tab.lastUsed, tabs.sessionId)
  })
  tabs.registerImported(records)
  tabs.switchWorkspace(space)
  if (active) tabs.select(active)
  tabs.setSplit(space, split)
}
