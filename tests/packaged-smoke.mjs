import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { promisify } from 'node:util'
import { _electron as electron } from 'playwright'

const executable = process.argv[2]
assert.ok(executable, 'Pass the packaged LexN executable path.')
const executablePath = resolve(executable)
const profile = await mkdtemp(join(tmpdir(), 'lexn-packed-'))
const args = ['--user-data-dir=' + profile]
const run = promisify(execFile)
let app

async function waitFor(check, description) {
  for (let attempt = 0; attempt < 120; attempt++) {
    const value = await check()
    if (value) return value
    await sleep(100)
  }
  assert.fail(description)
}

const showShell = async () => {
  const page = await waitFor(() => app.context().pages().find(candidate =>
    candidate.url() === 'lexn://shell/index.html' && !candidate.isClosed()), 'The packaged shell did not load.')
  await page.getByRole('navigation', { name: 'Browser services' }).waitFor()
  await waitFor(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some(window =>
    window.webContents.getURL() === 'lexn://shell/index.html' && window.isVisible() && !window.isMinimized())),
  'The packaged window is hidden or minimized.')
  return page
}

try {
  app = await electron.launch({ executablePath, args })
  await showShell()
  const install = await app.evaluate(({ app }) => ({ packaged: app.isPackaged, version: app.getVersion(), path: app.getPath('userData') }))
  assert.equal(install.packaged, true)
  assert.equal(install.version, '0.3.1')
  assert.equal(install.path, profile)
  console.log('Packaged LexN opened on a clean profile.')

  await app.evaluate(({ BrowserWindow, app }) => {
    BrowserWindow.getAllWindows()[0].hide()
    app.emit('activate')
  })
  await showShell()
  console.log('Activation restored the hidden browser window.')

  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].hide())
  await run(executablePath, args, { timeout: 12000 })
  await showShell()
  console.log('A second launch restored the running instance.')

  if (process.platform === 'darwin') {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
    await waitFor(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length === 0),
      'The browser window did not close.')
    await app.evaluate(({ app }) => app.emit('activate'))
    await showShell()
    console.log('Activation recreated the browser after its last window closed.')
  }

  await app.close()
  app = await electron.launch({ executablePath, args })
  await showShell()
  console.log('Packaged LexN reopened after a complete exit.')
} finally {
  if (app) await app.close().catch(() => {})
  await rm(profile, { recursive: true, force: true })
}
