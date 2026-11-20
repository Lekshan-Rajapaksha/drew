import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { open, readdir, realpath, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, isAbsolute, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { originOf, webUrl } from '../../shared/navigation.js'
import type { Database } from './database.js'
import type { BrowserBrand, BrowserImportSource } from '../../shared/model.js'

export type Link = { url: string; title: string; folder: string }
export type Entry = { url: string; title: string; visitedAt: number }
export type Source = BrowserImportSource & { path: string }
const maxFileSize = 16 * 1024 * 1024

export async function readImportFile(path: string) {
  const file = await open(path, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0))
  try {
    const info = await file.stat()
    if (!info.isFile() || info.size > maxFileSize) throw new Error('Choose an export file smaller than 16 MB.')
    const data = Buffer.alloc(info.size)
    let length = 0
    while (length < data.length) {
      const { bytesRead } = await file.read(data, length, data.length - length, length)
      if (!bytesRead) break
      length += bytesRead
    }
    if ((await file.stat()).size !== info.size || length !== info.size) throw new Error('The file changed during import. Export it again and retry.')
    try { return new TextDecoder('utf-8', { fatal: true }).decode(data) }
    catch { throw new Error('Use a UTF-8 browser export file.') }
    finally { data.fill(0) }
  } finally { await file.close() }
}

const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
function decode(value: string) {
  return value.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (raw, entity: string) => {
    if (entity[0] !== '#') return entities[entity.toLowerCase()] ?? raw
    const value = entity.slice(1)
    const code = value[0].toLowerCase() === 'x' ? Number.parseInt(value.slice(1), 16) : Number(value)
    return code <= 0x10ffff ? String.fromCodePoint(code) : raw
  })
}
function addLink(links: Link[], value: string, title: string, folder: string) {
  const url = webUrl(value)
  if (url && links.length < 10000) links.push({ url, title: (title.trim() || new URL(url).hostname).slice(0, 512), folder: folder.slice(0, 120) })
}

export function exportedLinks(text: string, markdown = false): Link[] {
  const links: Link[] = []
  if (markdown) {
    const headings: { level: number; name: string }[] = []
    const folders: { indent: number; name: string }[] = []
    for (const line of text.split(/\r?\n/)) {
      const heading = /^(#{1,6})\s+(.+)$/.exec(line)
      if (heading) {
        const level = heading[1].length
        while ((headings.at(-1)?.level ?? 0) >= level) headings.pop()
        headings.push({ level, name: heading[2].trim() })
        folders.length = 0
      }
      const bullet = /^([\t ]*)[-*+]\s+(.+)$/.exec(line)
      if (bullet) {
        const indent = bullet[1].replace(/\t/g, '    ').length
        while ((folders.at(-1)?.indent ?? -1) >= indent) folders.pop()
        const label = /^(?:\*\*([^*]+)\*\*:?|📁\s+(.+?))$/.exec(bullet[2].trim())
        if (label) folders.push({ indent, name: (label[1] ?? label[2]).replace(/:$/, '').trim() })
      }
      const folder = [...headings.map(item => item.name), ...folders.map(item => item.name)].join(' › ')
      for (const link of line.matchAll(/\[([^\]]+)\]\((<https?:\/\/[^>]+>|https?:\/\/[^\s()]*(?:\([^\s()]*\)[^\s()]*)*)\)/gi)) {
        addLink(links, link[2].replace(/^<|>$/g, ''), link[1], folder)
      }
    }
    return links
  }
  const folders: string[] = []
  let folder = ''
  for (const match of text.matchAll(/<h3\b[^>]*>([\s\S]*?)<\/h3\s*>|<a\b([^>]*)>([\s\S]*?)<\/a\s*>|<dl\b[^>]*>|<\/dl\s*>/gi)) {
    if (match[1] !== undefined) folder = decode(match[1].replace(/<[^>]+>/g, '')).trim()
    else if (match[2] !== undefined) {
      const href = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(match[2])
      if (href) addLink(links, decode(href[1] ?? href[2] ?? href[3]), decode(match[3].replace(/<[^>]+>/g, '')), folders.filter(Boolean).join(' › '))
    } else if (/^<\//.test(match[0])) folders.pop()
    else { folders.push(folder); folder = '' }
  }
  return links
}

export function chromiumLinks(contents: string, toolbarOnly = false) {
  const parsed = JSON.parse(contents) as { roots?: Record<string, unknown> }
  const links: Link[] = []
  const walk = (node: unknown, folder: string, depth: number) => {
    if (!node || typeof node !== 'object' || depth > 50 || links.length >= 10000) return
    const item = node as { type?: string; name?: unknown; url?: unknown; children?: unknown }
    const name = typeof item.name === 'string' ? item.name.trim() : ''
    if (item.type === 'url' && typeof item.url === 'string') addLink(links, item.url, name, folder)
    else if (Array.isArray(item.children)) {
      const next = [folder, name].filter(Boolean).join(' › ')
      for (const child of item.children) walk(child, next, depth + 1)
    }
  }
  if (toolbarOnly) {
    const bar = parsed.roots?.bookmark_bar as { children?: unknown } | undefined
    if (Array.isArray(bar?.children)) for (const child of bar.children) {
      if (child?.type === 'url') walk(child, '', 0)
    }
  } else for (const root of Object.values(parsed.roots ?? {})) walk(root, '', 0)
  return links
}

async function isFile(path: string) {
  return (await stat(path).catch(() => null))?.isFile() ?? false
}

export async function detectSources(): Promise<Source[]> {
  const home = homedir()
  const mac = process.platform === 'darwin'
  const win = process.platform === 'win32'
  const base = mac ? join(home, 'Library', 'Application Support')
    : win ? process.env.LOCALAPPDATA || join(home, 'AppData', 'Local') : join(home, '.config')
  const roots: [BrowserBrand, string][] = [
    ['Chrome', win ? 'Google/Chrome/User Data' : mac ? 'Google/Chrome' : 'google-chrome'],
    ['Edge', win ? 'Microsoft/Edge/User Data' : mac ? 'Microsoft Edge' : 'microsoft-edge'],
    ['Brave', 'BraveSoftware/Brave-Browser' + (win ? '/User Data' : '')],
    ['Vivaldi', (mac ? 'Vivaldi' : 'vivaldi') + (win ? '/User Data' : '')],
    ['Chromium', (mac ? 'Chromium' : 'chromium') + (win ? '/User Data' : '')],
    ['Arc', 'Arc/User Data'],
    ['Dia', 'Dia/User Data'],
    ['Ardia', 'Ardia/User Data'],
    ['Opera', mac ? 'com.operasoftware.Opera' : 'opera'],
    ['Opera GX', mac ? 'com.operasoftware.OperaGX' : 'opera-gx'],
  ]
  if (win) {
    const roaming = process.env.APPDATA || join(home, 'AppData', 'Roaming')
    roots.push(['Opera', join(roaming, 'Opera Software', 'Opera Stable')], ['Opera GX', join(roaming, 'Opera Software', 'Opera GX Stable')])
    const packages = await readdir(join(base, 'Packages'), { withFileTypes: true }).catch(() => [])
    for (const entry of packages) {
      if (entry.isDirectory() && /^TheBrowserCompany\.Arc_/i.test(entry.name)) {
        roots.push(['Arc', `Packages/${entry.name}/LocalCache/Local/Arc/User Data`])
      }
    }
  }
  const lists = await Promise.all(roots.map(([name, root]) => scanChromiumProfiles(isAbsolute(root) ? root : join(base, root), name)))
  return [...new Map(lists.flat().map(source => [source.id, source])).values()]
}

export async function scanChromiumProfiles(parent: string, browser: BrowserBrand): Promise<Source[]> {
  const dirs = await readdir(parent, { withFileTypes: true }).catch(() => [])
  const localState = await readImportFile(join(parent, 'Local State')).then(contents => {
    const state = JSON.parse(contents) as { profile?: { info_cache?: Record<string, { name?: unknown }> } }
    return state.profile?.info_cache ?? {}
  }).catch(() => ({} as Record<string, { name?: unknown }>))
  const folders = ['', ...dirs.filter(item => item.isDirectory() && /^(Default|Profile \d+)$/.test(item.name))
    .map(item => item.name).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))]
  return (await Promise.all(folders.map(async folder => {
    const path = join(parent, folder)
    const label = localState[folder]?.name
    const hasData = await isFile(join(path, 'Bookmarks')) || await isFile(join(path, 'History'))
    if (!hasData && !(await isFile(join(path, 'Preferences')))) return []
    const canonical = await realpath(path).catch(() => path)
    const id = createHash('sha256').update(canonical).digest('hex')
    return [{ id, label: typeof label === 'string' && label.trim() ? label.trim().slice(0, 64) : folder || basename(parent),
      browser, path }]
  }))).flat()
}

function chromiumHistory(path: string): Entry[] {
  const source = new DatabaseSync(path, { readOnly: true })
  try {
    source.exec('PRAGMA trusted_schema = OFF; PRAGMA query_only = ON;')
    const rows = source.prepare('SELECT url, title, last_visit_time / 1000 AS visit_millis FROM urls ORDER BY last_visit_time DESC LIMIT 5000').all() as
      { url: string; title: string | null; visit_millis: number | null }[]
    return rows.flatMap(row => {
      const url = webUrl(row.url)
      const visitedAt = (row.visit_millis ?? 0) - 11644473600000
      return url && Number.isSafeInteger(visitedAt) && visitedAt > 0
        ? [{ url, title: (row.title || new URL(url).hostname).slice(0, 512), visitedAt }] : []
    })
  } finally { source.close() }
}

export async function readChromium(path: string, includeToolbar = false) {
  const notes: string[] = []
  let links: Link[] = [], history: Entry[] = [], toolbar: Link[] = []
  const bookmarks = join(path, 'Bookmarks')
  const visits = join(path, 'History')
  if (await isFile(bookmarks)) {
    try {
      const contents = await readImportFile(bookmarks)
      links = chromiumLinks(contents)
      if (includeToolbar) toolbar = chromiumLinks(contents, true)
    }
    catch { notes.push('Bookmarks could not be read.') }
  }
  if (await isFile(visits)) {
    try { history = chromiumHistory(visits) }
    catch { notes.push('History could not be read. Close the source browser and try again.') }
  }
  if (!links.length && !history.length && !notes.length) notes.push('No bookmarks or history were found in that folder.')
  return { links, history, notes, toolbar }
}

export function saveImported(db: Database, profile: string, links: Link[], history: Entry[]) {
  return db.transaction(() => mergeImported(db, profile, links, history))
}

export function mergeImported(db: Database, profile: string, links: Link[], history: Entry[]) {
  let bookmarks = 0, visits = 0
  const folders = new Map<string, string>()
  for (const link of links) {
    let folder = folders.get(link.folder) ?? db.one<{ id: string }>('SELECT id FROM bookmark_folders WHERE name = ? AND workspaceId = ?', link.folder, profile)?.id
    if (!folder && link.folder) {
      folder = randomUUID()
      db.run('INSERT INTO bookmark_folders VALUES (?, ?, ?)', folder, link.folder, profile)
      folders.set(link.folder, folder)
    }
    if (db.one('SELECT id FROM bookmarks WHERE workspaceId = ? AND url = ? AND folderId IS ?', profile, link.url, folder ?? null)) continue
    db.run('INSERT INTO bookmarks VALUES (?, ?, ?, ?, ?)', randomUUID(), link.title, link.url, folder ?? null, profile)
    bookmarks++
  }
  for (const entry of history) {
    if (db.one('SELECT id FROM history WHERE workspaceId = ? AND url = ? AND visitedAt = ?', profile, entry.url, entry.visitedAt)) continue
    db.run('INSERT INTO history VALUES (?, ?, ?, ?, ?)', randomUUID(), entry.url, entry.title, entry.visitedAt, profile)
    visits++
  }
  return { bookmarks, visits }
}

export function passwordRows(csv: string) {
  const rows: string[][] = []
  let record: string[] = [], cell = '', quoted = false, fieldClosed = false
  for (let i = 0; i < csv.length; i++) {
    const char = csv[i]
    if (quoted) {
      if (char === '"' && csv[i + 1] === '"') { cell += '"'; i++ }
      else if (char === '"') { quoted = false; fieldClosed = true }
      else cell += char
    } else if (char === ',') { record.push(cell); cell = ''; fieldClosed = false }
    else if (char === '\r' || char === '\n') {
      if (char === '\r' && csv[i + 1] === '\n') i++
      rows.push([...record, cell]); record = []; cell = ''; fieldClosed = false
    } else {
      if (fieldClosed || (char === '"' && cell)) throw new Error('The password CSV contains a malformed quoted field.')
      if (char === '"') quoted = true
      else cell += char
    }
  }
  if (quoted) throw new Error('The password CSV has an incomplete quoted field.')
  if (cell || record.length) rows.push([...record, cell])
  const header = rows.shift()?.map(field => field.trim().toLowerCase()) ?? []
  const positions = ['url', 'username', 'password'].map(field => header.indexOf(field))
  if (positions.includes(-1)) throw new Error('Choose a password CSV with URL, username, and password columns.')
  let skipped = 0
  const entries = rows.flatMap(row => {
    if (row.length === 1 && !row[0].trim()) return []
    const [url, username, password] = positions.map(index => row[index])
    const origin = url && originOf(url)
    if (origin && username !== undefined && username.length <= 256 && password && password.length <= 4096 && !username.includes('\0') && !password.includes('\0')) {
      return [{ origin, username, password }]
    }
    skipped++
    return []
  })
  return { entries, skipped }
}
