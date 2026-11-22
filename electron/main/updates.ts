import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, dialog } from 'electron'
import updater from 'electron-updater'

let available = false
let checking = false
let timer: ReturnType<typeof setInterval> | undefined

export function configureUpdates(prepareRestart: () => void) {
  if (!app.isPackaged) return
  const policy = join(import.meta.dirname, 'update-policy.json')
  try {
    const config = JSON.parse(readFileSync(policy, 'utf8')) as { url: string; publisherName?: string[] }
    const url = new URL(config.url)
    if (url.protocol !== 'https:' || url.username || url.password ||
        (process.platform === 'win32' && !config.publisherName?.length)) return
  } catch { return }
  const { autoUpdater } = updater
  autoUpdater.updateConfigPath = policy
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false
  autoUpdater.allowDowngrade = false
  autoUpdater.allowPrerelease = false
  autoUpdater.disableWebInstaller = true
  autoUpdater.logger = null
  autoUpdater.on('error', () => {})
  autoUpdater.on('update-downloaded', () => {
    void dialog.showMessageBox({
      type: 'info', message: 'Restart Drew to install the update?',
      detail: 'Drew restores saved windows and split layouts after restarting.',
      buttons: ['Restart and install', 'Later'], defaultId: 0, cancelId: 1, noLink: true,
    }).then(({ response }) => {
      if (response === 0) {
        prepareRestart()
        autoUpdater.quitAndInstall()
      }
    }).catch(() => {})
  })
  available = true
  timer = setInterval(() => { void checkForDrewUpdates(false) }, 4 * 60 * 60 * 1000)
  timer.unref()
  void checkForDrewUpdates(false)
}

export async function checkForDrewUpdates(interactive = true) {
  if (!available) {
    if (interactive) throw new Error('Automatic updates are available in signed distribution builds.')
    return
  }
  if (checking) return
  checking = true
  try {
    const result = await updater.autoUpdater.checkForUpdates()
    if (!result?.isUpdateAvailable) {
      if (interactive) await dialog.showMessageBox({ type: 'info', message: 'Drew is up to date.' })
      return
    }
    const choice = await dialog.showMessageBox({
      type: 'info', message: 'A Drew update is available.',
      buttons: ['Download update', 'Later'], defaultId: 0, cancelId: 1, noLink: true,
    })
    if (choice.response === 0) await updater.autoUpdater.downloadUpdate()
  } catch {
    if (interactive) throw new Error('Drew could not verify or download the update. Try again later.')
  } finally { checking = false }
}

export function stopUpdates() { clearInterval(timer) }
