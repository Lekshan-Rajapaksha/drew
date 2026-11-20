import { randomUUID } from 'node:crypto'
import { Menu, type BrowserWindow, type IpcMainEvent, type WebContents, type WebFrameMain } from 'electron'
import { originOf } from '../../shared/navigation.js'
import type { SavedLogin } from '../../shared/model.js'
import type { Database } from './database.js'
import { unlockLogin } from './vault.js'

const choosing = new WeakSet<WebContents>()

function exchange(contents: WebContents, frame: WebFrameMain, stage: 'prepare' | 'apply', token: string, ...args: string[]) {
  return new Promise<boolean>(resolve => {
    const ipc = contents.ipc
    const finish = (ok: boolean) => {
      clearTimeout(timer)
      contents.removeListener('did-start-navigation', navigation)
      contents.removeListener('destroyed', destroyed)
      ipc.removeListener('lexn:login-result', reply)
      resolve(ok)
    }
    const reply = (event: IpcMainEvent, resultStage: unknown, replyToken: unknown, ok: unknown) => {
      if (event.senderFrame === frame && resultStage === stage && replyToken === token) finish(ok === true)
    }
    const navigation = (event: { isMainFrame: boolean; isSameDocument: boolean }) => {
      if (event.isMainFrame && !event.isSameDocument) finish(false)
    }
    const destroyed = () => finish(false)
    const timer = setTimeout(() => finish(false), 1800)
    ipc.on('lexn:login-result', reply)
    contents.on('did-start-navigation', navigation)
    contents.once('destroyed', destroyed)
    try { frame.send('lexn:login-' + stage, token, ...args) }
    catch { finish(false) }
  })
}

export async function fillSavedLogin(db: Database, window: BrowserWindow, contents: WebContents, profile: string,
  canFill: () => boolean, offer: boolean) {
  const frame = contents.mainFrame
  const address = frame.url
  const origin = originOf(address)
  if (!origin?.startsWith('https://') || !canFill()) throw new Error('Open a matching HTTPS sign-in page to fill a saved login.')
  if (choosing.has(contents)) return
  const stillCurrent = () => canFill() && !frame.isDestroyed() && contents.mainFrame === frame && frame.url === address
  const logins = db.all<SavedLogin>('SELECT id, origin, username FROM saved_logins WHERE origin = ? AND profileId = ? ORDER BY username', origin, profile)
  if (!logins.length) {
    if (offer) return
    throw new Error('This Profile has no saved login for ' + origin + '.')
  }
  choosing.add(contents)
  try {
    const token = randomUUID()
    if (!await exchange(contents, frame, 'prepare', token, origin) || !stillCurrent()) {
      if (offer) return
      throw new Error('Focus the password field of a sign-in form and try again.')
    }
    const selected = !offer && logins.length === 1 ? logins[0] : await new Promise<SavedLogin | null>(resolve => {
      const menu = Menu.buildFromTemplate(logins.map(login => ({
        label: 'Fill ' + (login.username.replace(/[\p{Cc}\p{Cf}]/gu, '').slice(0, 120) || 'saved login'),
        click: () => resolve(login),
      })))
      menu.popup({ window, callback: () => resolve(null) })
    })
    if (!selected || !stillCurrent()) return
    const { username, password } = await unlockLogin(db, profile, selected.id, stillCurrent, origin)
    if (!stillCurrent()) return
    if (!await exchange(contents, frame, 'apply', token, origin, username, password)) {
      throw new Error('The sign-in form changed before Drew could fill it. Try again.')
    }
  } finally { choosing.delete(contents) }
}
