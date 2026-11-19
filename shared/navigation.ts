import { engines, HOME, type Settings } from './model.js'

export function webUrl(input: string): string | null {
  try {
    const url = new URL(input)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null
    return url.href
  } catch {
    return null
  }
}

export function addressToUrl(input: string, engine: Settings['engine']): string {
  const value = input.trim()
  if (!value || value === HOME) return HOME
  const direct = webUrl(value)
  if (direct) return direct
  if (!/\s/.test(value)) {
    const host = value.split(/[/?#]/, 1)[0]
    if (/^(localhost|\[::1\]|127(?:\.\d{1,3}){3})(:\d+)?$/i.test(host)) {
      const local = webUrl('http://' + value)
      if (local) return local
    }
    if (/^[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+(?::\d+)?$/u.test(host)) {
      const https = webUrl('https://' + value)
      if (https) return https
    }
  }
  return engines[engine] + encodeURIComponent(value)
}

export function originOf(input: string): string | null {
  const url = webUrl(input)
  return url ? new URL(url).origin : null
}
