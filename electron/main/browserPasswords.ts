import { execFile } from 'node:child_process'
import { createDecipheriv, pbkdf2Sync } from 'node:crypto'
import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { promisify } from 'node:util'
import { originOf } from '../../shared/navigation.js'
import type { BrowserBrand } from '../../shared/model.js'
import type { Source } from './importData.js'

const run = promisify(execFile)
const accounts: Partial<Record<BrowserBrand, string>> = {
  Ardia: 'Ardia', Chrome: 'Chrome', Chromium: 'Chromium', Edge: 'Microsoft Edge', Arc: 'Arc', Dia: 'Dia',
  Brave: 'Brave', Vivaldi: 'Vivaldi', Opera: 'Opera', 'Opera GX': 'Opera',
}

export async function readBrowserPasswords(source: Source, keychain = readKeychain) {
  const account = accounts[source.browser]
  const files = await Promise.all(['Login Data', 'Login Data For Account'].map(async name => {
    const path = join(source.path, name)
    return (await stat(path).catch(() => null))?.isFile() ? path : null
  }))
  if (!files.some(Boolean)) return { entries: [], skipped: 0 }
  if ((process.platform !== 'darwin' && keychain === readKeychain) || !account) throw new Error('Use a password CSV for this browser or platform.')
  const rows: { origin_url: string; username_value: string; password_value: Uint8Array }[] = []
  for (const path of files) {
    if (!path) continue
    const db = new DatabaseSync(path, { readOnly: true })
    try {
      db.exec('PRAGMA trusted_schema=OFF; PRAGMA query_only=ON;')
      rows.push(...db.prepare(`SELECT origin_url, username_value, password_value FROM logins
        WHERE blacklisted_by_user=0 AND length(password_value) BETWEEN 19 AND 16403 LIMIT 5000`).all() as typeof rows)
    } finally { db.close() }
  }
  if (!rows.length) return { entries: [], skipped: 0 }
  const secret = await keychain(account)
  let key: Buffer
  try { key = pbkdf2Sync(secret, 'saltysalt', 1003, 16, 'sha1') }
  finally { secret.fill(0) }
  const entries: { origin: string; username: string; password: string }[] = []
  try {
    for (const row of rows) {
      const origin = originOf(row.origin_url)
      const value = Buffer.from(row.password_value)
      if (!origin?.startsWith('https://') || typeof row.username_value !== 'string' ||
          row.username_value.length > 256 || row.username_value.includes('\0') ||
          value.toString('ascii', 0, 3) !== 'v10' || (value.length - 3) % 16) continue
      try {
        const decipher = createDecipheriv('aes-128-cbc', key, Buffer.alloc(16, 32))
        const body = decipher.update(value.subarray(3))
        try {
          const end = decipher.final()
          const plain = Buffer.concat([body, end])
          try {
            const password = new TextDecoder('utf-8', { fatal: true }).decode(plain)
            if (password.length && password.length <= 4096 && !password.includes('\0')) entries.push({ origin, username: row.username_value, password })
          } finally { end.fill(0); plain.fill(0) }
        } finally { body.fill(0) }
      } catch { /* A source format or key can differ between accounts. */ }
    }
  } finally { key.fill(0) }
  return { entries, skipped: rows.length - entries.length }
}

async function readKeychain(account: string) {
  try {
    const { stdout } = await run('/usr/bin/security', ['find-generic-password', '-a', account, '-s', account + ' Safe Storage', '-w'],
      { encoding: 'buffer', maxBuffer: 8192, timeout: 120_000 })
    let end = stdout.length
    if (stdout[end - 1] === 10) end--
    if (!end) throw new Error('Empty keychain item.')
    return stdout.subarray(0, end)
  } catch { throw new Error('Keychain access was unavailable or declined. Use a password CSV for this Profile.') }
}
