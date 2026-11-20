import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { promisify } from 'node:util'
import { _electron as electron } from 'playwright'

const executable = process.argv[2]
assert.ok(executable, 'Pass the packaged Drew executable path.')
const executablePath = resolve(executable)
const previousExecutable = process.argv[3]
const profile = await mkdtemp(join(tmpdir(), 'lexn-packed-'))
const args = ['--user-data-dir=' + profile]
const run = promisify(execFile)
let app
let server

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
  await page.locator('.spatial-browser').waitFor()
  await waitFor(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some(window =>
    window.webContents.getURL() === 'lexn://shell/index.html' && window.isVisible() && !window.isMinimized())),
  'The packaged window is hidden or minimized.')
  return page
}

try {
  app = await electron.launch({ executablePath, args })
  const page = await showShell()
  await page.getByRole('heading', { name: 'Drew' }).waitFor()
  assert.equal((await page.locator('.home').boundingBox()).y, 0)
  const wordmark = page.getByRole('img', { name: 'Drew' })
  assert.equal(await wordmark.evaluate(image => image.decode().then(() => image.naturalWidth)), 720)
  await wordmark.evaluate(image => { image.parentElement.style.background = '#285080' })
  const logoImage = await wordmark.screenshot({ scale: 'css' })
  await wordmark.evaluate(image => { image.style.opacity = '0' })
  const backingImage = await wordmark.screenshot({ scale: 'css' })
  const [logoPixel, backingPixel] = await app.evaluate(({ nativeImage }, encodedImages) => encodedImages.map(encoded => {
    const image = nativeImage.createFromBuffer(Buffer.from(encoded, 'base64'))
    const offset = (10 * image.getSize().width + 10) * 4
    return [...image.getBitmap().subarray(offset, offset + 3)]
  }), [logoImage.toString('base64'), backingImage.toString('base64')])
  assert.deepEqual(logoPixel, backingPixel, 'The logo should show the surface behind its transparent background.')
  await wordmark.evaluate(image => {
    image.style.removeProperty('opacity')
    image.parentElement.style.removeProperty('background')
  })
  if (process.env.LEXN_SIDEBAR_SCREENSHOT) {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('lexn:shortcut', 'sidebar'))
    await page.locator('.spatial-sidebar').waitFor()
    await page.screenshot({ path: process.env.LEXN_SIDEBAR_SCREENSHOT, animations: 'disabled' })
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('lexn:shortcut', 'sidebar'))
  }
  if (process.env.LEXN_SCREENSHOT && !previousExecutable) {
    await page.locator('.spatial-collapsed').waitFor()
    await page.screenshot({ path: process.env.LEXN_SCREENSHOT, animations: 'disabled' })
  }
  const install = await app.evaluate(({ app }) => ({ packaged: app.isPackaged, version: app.getVersion(), path: app.getPath('userData') }))
  assert.equal(install.packaged, true)
  assert.equal(install.version, JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).version)
  assert.equal(install.path, profile)
  if (process.platform === 'darwin') assert.equal(await page.evaluate(() => window.lexn.usesNativeSpaceScroll()), true)
  console.log('Packaged Drew opened on a clean profile.')

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
  console.log('Packaged Drew reopened after a complete exit.')

  if (previousExecutable) {
    await app.close()
    app = undefined
    const upgradeArgs = ['--user-data-dir=' + await mkdtemp(join(profile, 'upgrade-'))]
    server = createServer((_request, response) => {
      response.setHeader('Content-Type', 'text/html')
      response.end('<!doctype html><title>Reading List</title><h1>Reading List</h1>')
    })
    await new Promise((listen, reject) => server.once('error', reject).listen(0, '127.0.0.1', listen))
    const url = 'http://127.0.0.1:' + server.address().port + '/reading'
    app = await electron.launch({ executablePath: resolve(previousExecutable), args: upgradeArgs })
    const oldShell = await showShell()
    await oldShell.evaluate(async url => {
      const { workspaces, workspaceId, profileId } = await window.lexn.getState()
      const other = workspaces.find(space => space.id !== profileId && space.profileId === null)
      await window.lexn.command('workspace', other.id)
      await window.lexn.command('setSetting', 'keepSidebarOpen', true)
      await window.lexn.command('setSetting', 'sidebarWidth', '348')
      await window.lexn.command('workspace', workspaceId)
      await window.lexn.command('setSetting', 'keepSidebarOpen', false)
      await window.lexn.command('setSetting', 'sidebarWidth', '312')
      await window.lexn.command('saveBookmark', null, 'Saved reading', url, null)
      await window.lexn.command('saveFavorite', null, 'https://example.org/', 'Reading favorite', '')
      await window.lexn.command('setSetting', 'background', 'black')
      await window.lexn.command('setSetting', 'theme', 'light')
      await window.lexn.command('newTab', url)
    }, url)
    await waitFor(async () => (await oldShell.evaluate(() => window.lexn.history('Reading List'))).length > 0,
      'LexN did not record the reading test visit.')
    await oldShell.evaluate(() => window.lexn.command('newTab'))
    await app.close()
    app = await electron.launch({ executablePath, args: upgradeArgs })
    const home = await showShell()
    await home.getByRole('heading', { name: 'Drew' }).waitFor()
    await home.getByRole('region', { name: 'Recent activity' }).getByText('Reading List').waitFor()
    const state = await home.evaluate(() => window.lexn.getState())
    assert.equal(state.settings.keepSidebarOpen, false)
    assert.equal(state.settings.sidebarWidth, '312')
    assert.equal(state.settings.theme, 'light')
    assert.equal(await home.locator('.home').evaluate(page => getComputedStyle(page).backgroundColor), 'rgb(255, 255, 255)')
    assert.equal(await home.locator('.home').evaluate(page => getComputedStyle(page).colorScheme), 'light')
    const searchSurface = home.locator('.home-search')
    const previousTint = await searchSurface.evaluate(surface => getComputedStyle(surface).backgroundImage)
    await home.evaluate(() => window.lexn.command('setSetting', 'accentColor', '#007deb'))
    await waitFor(async () => await searchSurface.evaluate(surface => getComputedStyle(surface).backgroundImage) !== previousTint,
      'the Profile accent did not update the Home search surface')
    assert.ok(state.bookmarks.some(item => item.title === 'Saved reading'))
    assert.ok(state.favorites.some(item => item.title === 'Reading favorite'))
    assert.equal(await home.locator('.home').getByText('Bookmarks', { exact: true }).count(), 0)
    assert.equal(await home.locator('.home').getByText('Saved reading', { exact: true }).count(), 0)

    if (process.env.LEXN_SCREENSHOT) {
      await home.mouse.move(800, 120)
      await home.locator('.spatial-collapsed').waitFor()
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('lexn:shortcut', 'sidebar'))
      await home.locator('.spatial-sidebar').waitFor()
      await home.screenshot({ path: process.env.LEXN_SCREENSHOT, animations: 'disabled' })
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('lexn:shortcut', 'sidebar'))
      await home.locator('.spatial-collapsed').waitFor()
    }

    const search = home.getByRole('combobox', { name: 'Search the web' })
    await search.fill('Reading')
    await home.getByRole('option', { name: /Reading List/ }).waitFor()
    await search.press('ArrowDown')
    assert.equal(await home.getByRole('option', { name: /Reading List/ }).getAttribute('aria-selected'), 'true')
    await search.press('Escape')
    await home.getByRole('listbox').waitFor({ state: 'detached' })
    await search.fill('Reading List')
    await home.getByRole('option', { name: /Reading List/ }).waitFor()
    await search.press('ArrowDown')
    await search.press('Enter')
    await waitFor(async () => {
      const browsing = await home.evaluate(() => window.lexn.getState())
      const activeTab = browsing.workspaces.find(space => space.id === browsing.workspaceId).activeTab
      return browsing.tabs.some(tab => tab.id === activeTab && tab.url === url)
    }, 'Selecting a history suggestion did not open the visited URL.')
    await app.evaluate(({ BrowserWindow }) => {
      const root = BrowserWindow.getAllWindows()[0]
      root.webContents.send('lexn:shortcut', 'sidebar')
    })
    const floating = await waitFor(async () => {
      for (const candidate of app.context().pages()) {
        if (candidate.url() === 'about:blank' && await candidate.locator('.floating-sidebar').count()) return candidate
      }
    }, 'The packaged floating sidebar did not open.')
    await floating.getByRole('combobox', { name: 'Address and search' }).waitFor()
    assert.equal(await app.evaluate(({ BrowserWindow }) => {
      const root = BrowserWindow.getAllWindows()[0]
      const website = root.contentView.children.find(view => view.children.length > 0)
      const [width, height] = root.getContentSize()
      const rect = website?.getBounds()
      return rect?.x === 0 && rect.y === 0 && rect.width === width && rect.height === height
    }), true)

    await app.evaluate(({ BrowserWindow }) => {
      const shell = BrowserWindow.getAllWindows()[0].webContents
      shell.send('lexn:pointer', 800)
      shell.send('lexn:shortcut', 'sidebar')
      shell.send('lexn:shortcut', 'settings')
    })
    await home.getByRole('heading', { name: 'Settings' }).waitFor()
    await home.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'New Tab', exact: true }).click()
    await home.getByRole('combobox', { name: 'Layout spacing' }).selectOption('compact')
    await home.getByLabel('Show recent activity').uncheck()
    await home.getByLabel('Show date and time').check()
    await home.getByLabel('Show local search suggestions').uncheck()
    await home.getByRole('button', { name: 'Appearance', exact: true }).click()
    await home.getByRole('combobox', { name: 'Interface motion' }).selectOption('off')
    await home.getByRole('combobox', { name: 'Sidebar hide delay' }).selectOption('relaxed')
    await home.locator('.motion-off').waitFor()
    await home.evaluate(() => window.lexn.command('newTab'))
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('lexn:shortcut', 'browse'))
    await home.locator('.home-compact .home-clock').waitFor()
    assert.equal(await home.locator('.home :is(.quick-links, .home-library)').count(), 0)
    await search.fill('Reading')
    assert.equal(await search.getAttribute('aria-expanded'), 'false')
    const updated = await home.evaluate(() => window.lexn.getState())
    const other = updated.workspaces.find(space => space.id !== updated.profileId && space.profileId === null)
    assert.ok(other)
    await home.evaluate(id => window.lexn.command('workspace', id), other.id)
    const independent = await home.evaluate(() => window.lexn.getState())
    assert.equal(independent.settings.homeClock, true)
    assert.equal(independent.settings.theme, 'dark')
    assert.equal(independent.settings.accentColor, '')
    assert.equal(independent.settings.homeRecent, true)
    assert.equal(independent.settings.motion, 'system')
    assert.equal(independent.settings.keepSidebarOpen, false)
    assert.equal(independent.settings.sidebarWidth, '312')
    await home.evaluate(id => window.lexn.command('workspace', id), updated.workspaceId)
    await app.close()
    app = await electron.launch({ executablePath, args: upgradeArgs })
    const reopened = await showShell()
    await reopened.locator('.home-compact .home-clock').waitFor()
    assert.equal(await reopened.locator('.home').evaluate(page => getComputedStyle(page).backgroundColor), 'rgb(255, 255, 255)')
    assert.equal((await reopened.evaluate(() => window.lexn.getState())).settings.sidebarDismiss, 'relaxed')
    console.log('Drew preserved existing profile data and applied the shared sidebar settings across Profiles.')
  }
} finally {
  if (app) await app.close().catch(() => {})
  if (server) {
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
  }
  await rm(profile, { recursive: true, force: true })
}
