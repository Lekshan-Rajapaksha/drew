import { basename, dirname, join } from 'node:path'
import { webUrl } from '../../shared/navigation.js'
import { readImportFile, type Link, type Source } from './importData.js'

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : []
const string = (value: unknown) => typeof value === 'string' ? value : ''
const label = (value: unknown, max: number) => string(value).trim().slice(0, max)

function pairs(value: unknown) {
  const list = array(value)
  const result: [unknown, unknown][] = []
  for (let index = 0; index + 1 < list.length; index += 2) result.push([list[index], list[index + 1]])
  return result
}

function profileName(value: unknown) {
  const profile = record(value)
  if (Object.hasOwn(profile, 'default')) return 'Default'
  return string(record(record(profile.custom)._0).directoryBasename)
}

export function parseArcSidebar(value: unknown, folder: string) {
  const containers = array(record(record(value).sidebar).containers).map(record)
  const box = containers.find((item, index) => Array.isArray(item.items) && Object.hasOwn(containers[index - 1] ?? {}, 'global'))
    ?? containers.find((item, index) => Array.isArray(item.items) && !Object.hasOwn(containers[index - 1] ?? {}, 'littleBrowser'))
  const items = new Map(array(box?.items).slice(0, 20_000).map(record).filter(item => string(item.id)).map(item => [string(item.id), item]))
  const childrenByParent = new Map<string, string[]>()
  for (const [id, item] of items) {
    const parent = string(item.parentID)
    if (!items.has(parent) || parent === id) continue
    const children = childrenByParent.get(parent) ?? []
    children.push(id)
    childrenByParent.set(parent, children)
  }
  let remainingLinks = 10_000
  const collect = (roots: string[], includeFolders: boolean, seen: Set<string>) => {
    const links: Link[] = []
    const visit = (id: string, folders: string[], depth: number) => {
      if (seen.has(id) || depth > 32 || seen.size >= 20_000 || links.length >= 2000 || remainingLinks <= 0) return
      const item = items.get(id)
      if (!item) return
      seen.add(id)
      const data = record(item.data)
      const tab = record(data.tab)
      const address = string(tab.savedURL)
      const url = address.length <= 8192 && webUrl(address)
      if (url) {
        remainingLinks--
        links.push({ url, title: label(item.title, 512) || label(tab.savedTitle, 512) || new URL(url).hostname, folder: folders.join(' › ').slice(0, 120) })
        return
      }
      const nested = includeFolders && depth > 0 && Object.hasOwn(data, 'list')
        ? [...folders, (label(item.title, 64) || 'Folder').replaceAll(' › ', ' / ')] : folders
      for (const child of new Set([...array(item.childrenIds).map(string), ...(childrenByParent.get(id) ?? [])])) visit(child, nested, depth + 1)
    }
    for (const root of roots) visit(root, [], 0)
    return links
  }
  const spaces = array(box?.spaces).map(record).filter(space => (profileName(space.profile) || 'Default') === folder)
    .slice(0, 200).flatMap((space, index) => {
      const id = label(space.id, 128)
      if (!id) return []
      const roots = [...pairs(space.newContainerIDs).map(([kind, value]) => [Object.keys(record(kind))[0], value] as const), ...pairs(space.containerIDs)]
      const from = (kind: string) => roots.filter(([key]) => key === kind).map(([, id]) => string(id))
      const seen = new Set<string>()
      const custom = record(space.customInfo)
      const palette = record(record(custom.windowTheme).primaryColorPalette)
      const color = record(palette.midTone)
      const channels = [color.red, color.green, color.blue]
      const accent = channels.every(channel => typeof channel === 'number' && Number.isFinite(channel) && channel >= 0 && channel <= 1)
        ? '#' + channels.map(channel => Math.round(Number(channel) * 255).toString(16).padStart(2, '0')).join('') : undefined
      const icon = record(custom.iconType)
      return [{ id, name: label(space.title, 64) || 'Space ' + (index + 1), accent,
        icon: label(icon.emoji_v2 ?? icon.emoji, 16), pinned: collect(from('pinned'), true, seen), tabs: collect(from('unpinned'), false, seen) }]
    })
  const favorites = collect(pairs(box?.topAppsContainerIDs).filter(([profile]) => profileName(profile) === folder).map(([, id]) => string(id)), false, new Set())
  return { spaces, favorites }
}

export async function readArcSidebar(source: Source) {
  const root = source.root ?? dirname(source.path)
  const parent = dirname(source.path)
  const arcRoot = basename(root) === 'User Data' ? dirname(root)
    : basename(parent) === 'User Data' ? dirname(parent) : root
  try {
    return parseArcSidebar(JSON.parse(await readImportFile(join(arcRoot, 'StorableSidebar.json'))), source.folder || basename(source.path))
  } catch { return { spaces: [], favorites: [] } }
}
