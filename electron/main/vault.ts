import { createHash, randomUUID } from 'node:crypto'
import { clipboard, safeStorage } from 'electron'
import type { Database } from './database.js'
import { passwordRows, readImportFile } from './importData.js'

type Account = { profile: string; origin: string; username: string }
const envelope = 'account-v1:'
const clipboardLifetime = 30_000
let clipboardTimer: ReturnType<typeof setTimeout> | undefined
let clipboardRevision = 0

function accountPayload(account: Account, password: string) {
  return envelope + JSON.stringify([account.profile, account.origin, account.username, password])
}

async function requireEncryption() {
  if (!['darwin', 'win32'].includes(process.platform) || !await safeStorage.isAsyncEncryptionAvailable()) {
    throw new Error('System password protection is unavailable.')
  }
}

async function seal(account: Account, password: string) {
  try {
    const encrypted = await safeStorage.encryptStringAsync(accountPayload(account, password))
    if (!encrypted.length) throw new Error('Encryption returned no data.')
    return envelope + encrypted.toString('base64')
  } catch {
    throw new Error('System encryption could not save the password. Unlock your system key store and try again.')
  }
}

export async function savePassword(db: Database, account: Account, password: string, canSave: () => boolean) {
  await requireEncryption()
  const encrypted = await seal(account, password)
  if (!canSave()) return
  db.run(`INSERT INTO saved_logins VALUES (?, ?, ?, ?, ?) ON CONFLICT(profileId, origin, username)
    DO UPDATE SET encrypted = excluded.encrypted`, randomUUID(), account.profile, account.origin, account.username, encrypted)
}

export async function importPasswords(db: Database, profile: string, path: string, canSave: () => boolean) {
  return importLoginEntries(db, profile, passwordRows(await readImportFile(path)), canSave)
}

export async function importLoginEntries(db: Database, profile: string,
  { entries, skipped: invalid }: ReturnType<typeof passwordRows>, canSave: () => boolean) {
  await requireEncryption()
  let duplicates = 0
  const logins: { origin: string; username: string; encrypted: string }[] = []
  const seen = new Set<string>()
  for (const { origin, username, password } of entries) {
    if (!canSave()) return null
    const key = JSON.stringify([origin, username])
    if (seen.has(key) || db.one('SELECT id FROM saved_logins WHERE profileId = ? AND origin = ? AND username = ?', profile, origin, username)) {
      duplicates++
      continue
    }
    seen.add(key)
    logins.push({ origin, username, encrypted: await seal({ profile, origin, username }, password) })
  }
  if (!canSave()) return null
  const passwords = db.transaction(() => logins.reduce((count, row) => count + Number(db.run(
    'INSERT INTO saved_logins VALUES (?, ?, ?, ?, ?) ON CONFLICT(profileId, origin, username) DO NOTHING',
    randomUUID(), profile, row.origin, row.username, row.encrypted,
  ).changes), 0))
  duplicates += logins.length - passwords
  const notes = []
  if (duplicates) notes.push(`${duplicates} matching account${duplicates === 1 ? ' was' : 's were'} kept as saved.`)
  if (invalid) notes.push(`${invalid} invalid or unsupported row${invalid === 1 ? ' was' : 's were'} skipped.`)
  return { passwords, notes }
}

export async function unlockLogin(db: Database, profile: string, id: string, canUse: () => boolean, origin?: string) {
  if (!canUse()) throw new Error('Focus this Profile’s window to use a saved password.')
  const row = db.one<{ origin: string; username: string; encrypted: string }>(
    'SELECT origin, username, encrypted FROM saved_logins WHERE id = ? AND profileId = ?', id, profile)
  if (!row || (origin !== undefined && origin !== row.origin)) throw new Error('Password was not found in this Profile.')
  await requireEncryption()
  const bound = row.encrypted.startsWith(envelope)
  const data = Buffer.from(bound ? row.encrypted.slice(envelope.length) : row.encrypted, 'base64')
  const account = { profile, origin: row.origin, username: row.username }
  let password: string
  let rotate: boolean
  try {
    let opened = await safeStorage.decryptStringAsync(data)
    rotate = opened.shouldReEncrypt
    if (rotate) opened = await safeStorage.decryptStringAsync(data)
    if (opened.shouldReEncrypt || !opened.result) throw new Error('Password protection is temporarily unavailable.')
    if (bound) {
      const parsed: unknown = JSON.parse(opened.result.slice(envelope.length))
      if (!Array.isArray(parsed) || parsed.length !== 4 || typeof parsed[3] !== 'string' ||
          accountPayload(account, parsed[3]) !== opened.result) throw new Error('Password account does not match.')
      password = parsed[3]
    } else {
      if (opened.result.startsWith(envelope)) throw new Error('Password protection marker does not match.')
      password = opened.result
    }
  } catch {
    throw new Error('Drew could not unlock the saved password for this account.')
  } finally { data.fill(0) }
  const replacement = !bound || rotate ? await seal(account, password) : row.encrypted
  if (!canUse()) throw new Error('The active page or Profile changed before the password could be used.')
  if (replacement !== row.encrypted) {
    const result = db.run('UPDATE saved_logins SET encrypted = ? WHERE id = ? AND profileId = ? AND encrypted = ?', replacement, id, profile, row.encrypted)
    if (!result.changes) throw new Error('The saved password changed. Try again.')
  } else if (!db.one('SELECT id FROM saved_logins WHERE id = ? AND profileId = ? AND encrypted = ?', id, profile, row.encrypted)) {
    throw new Error('The saved password changed. Try again.')
  }
  return { username: row.username, password }
}

export async function copyPassword(db: Database, profile: string, id: string, canCopy: () => boolean) {
  const { password } = await unlockLogin(db, profile, id, canCopy)
  const revision = ++clipboardRevision
  await clipboard.writeText(password)
  if (revision !== clipboardRevision) return
  const digest = createHash('sha256').update(password).digest('hex')
  clearTimeout(clipboardTimer)
  clipboardTimer = setTimeout(() => {
    void clipboard.readText().then(text => {
      if (revision === clipboardRevision && createHash('sha256').update(text).digest('hex') === digest) clipboard.clear()
    }).catch(() => {})
  }, clipboardLifetime)
  clipboardTimer.unref()
}
