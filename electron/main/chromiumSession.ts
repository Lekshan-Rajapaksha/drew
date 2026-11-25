import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { webUrl } from '../../shared/navigation.js'
import { readImportBytes, type Link } from './importData.js'

type StoredTab = {
  window: number; position: number; selected: number; pinned: boolean
  entries: Map<number, { url: string; title: string }>
}

function navigation(payload: Buffer) {
  if (payload.length < 20) return
  const length = payload.readUInt32LE(0)
  const offset = payload.length - length
  if (offset < 4 || offset > 16 || offset + 12 > payload.length) return
  const bytes = payload.readInt32LE(offset + 8)
  if (bytes < 0 || bytes > 8192 || offset + 12 + bytes > payload.length) return
  const titleOffset = offset + 12 + Math.ceil(bytes / 4) * 4
  if (titleOffset + 4 > payload.length) return
  const titleLength = payload.readInt32LE(titleOffset)
  if (titleLength < 0 || titleOffset + 4 + titleLength * 2 > payload.length) return
  return {
    tab: payload.readInt32LE(offset), index: payload.readInt32LE(offset + 4),
    url: payload.toString('utf8', offset + 12, offset + 12 + bytes),
    title: payload.toString('utf16le', titleOffset + 4, titleOffset + 4 + Math.min(titleLength, 512) * 2),
  }
}

export function parseChromiumSession(bytes: Buffer) {
  if (bytes.length < 8 || bytes.toString('ascii', 0, 4) !== 'SNSS') return null
  const version = bytes.readUInt32LE(4)
  if (version !== 1 && version !== 3) return null
  const tabs = new Map<number, StoredTab>()
  const windows = new Map<number, number>()
  const closed = new Set<number>()
  const tab = (id: number) => {
    let record = tabs.get(id)
    if (!record) {
      record = { window: 0, position: 0, selected: 0, pinned: false, entries: new Map() }
      tabs.set(id, record)
    }
    return record
  }
  let complete = version === 1
  let commands = 0
  for (let offset = 8; offset + 2 <= bytes.length;) {
    if (++commands > 100_000) return null
    const length = bytes.readUInt16LE(offset)
    if (!length || offset + 2 + length > bytes.length) break
    const command = bytes[offset + 2]
    const payload = bytes.subarray(offset + 3, offset + 2 + length)
    offset += 2 + length
    if (command === 255 && length === 1) complete = true
    if (command === 6) {
      const entry = navigation(payload)
      if (entry) tab(entry.tab).entries.set(entry.index, { url: entry.url, title: entry.title })
      continue
    }
    if (payload.length < 4) continue
    const id = payload.readInt32LE(0)
    if (command === 16) tabs.delete(id)
    if (command === 17) closed.add(id)
    if (command === 12 && payload.length >= 5) tab(id).pinned = payload[4] !== 0
    if (payload.length < 8) continue
    const value = payload.readInt32LE(4)
    switch (command) {
      case 0: tab(value).window = id; break
      case 2: tab(id).position = value; break
      case 5:
        for (const index of tab(id).entries.keys()) if (index >= value) tab(id).entries.delete(index)
        break
      case 7: tab(id).selected = value; break
      case 9: windows.set(id, value); closed.delete(id); break
      case 11:
      case 24: {
        const start = command === 11 ? 0 : value
        const count = command === 11 ? value : payload.length >= 12 ? payload.readInt32LE(8) : 0
        if (start < 0 || count <= 0) break
        const current = tab(id)
        current.entries = new Map([...current.entries].flatMap(([index, entry]) =>
          index < start ? [[index, entry]] : index >= start + count ? [[index - count, entry]] : []))
        if (current.selected >= start) current.selected = Math.max(start - 1, current.selected - count)
        break
      }
    }
  }
  if (!complete) return null
  const links: { pinned: Link[]; tabs: Link[] } = { pinned: [], tabs: [] }
  const ordered = [...tabs.values()].sort((a, b) => a.window - b.window || a.position - b.position)
  for (const record of ordered) {
    if (!record.window || closed.has(record.window) || windows.get(record.window) !== 0) continue
    const orderedEntries = [...record.entries].sort(([a], [b]) => a - b)
    const entry = record.entries.get(record.selected) ?? orderedEntries.find(([index]) => index >= record.selected)?.[1] ?? orderedEntries.at(-1)?.[1]
    const url = entry && webUrl(entry.url)
    if (url) links[record.pinned ? 'pinned' : 'tabs'].push({ url, title: entry.title.trim() || new URL(url).hostname, folder: '' })
    if (links.pinned.length + links.tabs.length >= 2000) break
  }
  return links
}

export async function readChromiumSession(profile: string) {
  const names = await readdir(join(profile, 'Sessions'), { withFileTypes: true }).catch(() => [])
  const candidates = names.filter(item => item.isFile() && /^Session_\d+$/.test(item.name))
    .map(item => item.name).sort((a, b) => b.length - a.length || b.localeCompare(a)).slice(0, 8)
  const paths = [...candidates.map(name => join(profile, 'Sessions', name)), join(profile, 'Current Session'), join(profile, 'Last Session')]
  let unreadable = false
  for (const path of paths) {
    try {
      const session = parseChromiumSession(await readImportBytes(path))
      if (session) return { ...session, notes: [] }
      unreadable = true
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') unreadable = true }
  }
  const encrypted = await readdir(join(profile, 'Sessions_Encrypted')).catch(() => [])
  return { tabs: [], pinned: [], notes: encrypted.some(name => /^Session_\d+$/.test(name))
    ? ['The source browser stores open tabs in an encrypted session. Use its export option when available.']
    : unreadable ? ['Open tabs could not be read from the source session.'] : [] }
}
