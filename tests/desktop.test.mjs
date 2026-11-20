import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import test from 'node:test'
import { _electron as electron } from 'playwright'

const executablePath = process.env.LEXN_ELECTRON_BINARY || undefined

async function getState(page) { return page.evaluate(() => window.lexn.getState()) }
async function active(page) {
  const state = await getState(page)
  return state.tabs.find(tab => tab.id === state.workspaces.find(space => space.id === state.workspaceId).activeTab)
}

async function waitUntil(callback, message, milliseconds = 10000) {
  const deadline = Date.now() + milliseconds
  do {
    const result = await callback()
    if (result) return result
    await sleep(100)
  } while (Date.now() < deadline)
  assert.fail(message)
}

async function shellPage(app) {
  return waitUntil(() => app.context().pages().find(page => page.url() === 'lexn://shell/index.html'),
    'LexN shell window did not load')
}

async function go(page, url) {
  const input = page.getByRole('combobox', { name: 'Address and search' })
  await input.fill(url)
  await input.press('Enter')
}

async function activeView(app) {
  return app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]
    const view = win.contentView.children.flatMap(child => child.children).at(-1)
    return view?.webContents.getURL() ?? null
  })
}

async function shortcut(app, keyCode, modifiers) {
  await app.evaluate(({ BrowserWindow }, { keyCode, modifiers }) => {
    const win = BrowserWindow.getAllWindows()[0]
    const active = win.contentView.children.flatMap(child => child.children).at(-1)
    const contents = active?.webContents ?? win.webContents
    win.focus()
    contents.focus()
    contents.sendInputEvent({ type: 'keyDown', keyCode, modifiers })
    contents.sendInputEvent({ type: 'keyUp', keyCode, modifiers })
  }, { keyCode, modifiers })
}

async function pointAt(app, x) {
  await app.evaluate(({ BrowserWindow, screen }, x) => {
    const win = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().startsWith('lexn://shell'))
    const bounds = win.getContentBounds()
    screen.getCursorScreenPoint = () => ({ x: bounds.x + x, y: bounds.y + 220 })
    win.focus()
  }, x)
}

function serve(request, response) {
  switch (request.url) {
    case '/download':
      response.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename="lexn-smoke.txt"' })
      response.end('LexN real download\n')
      break
    case '/slow':
      response.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename="lexn-slow.bin"', 'Content-Length': 12000000 })
      const timer = setInterval(() => response.write(Buffer.alloc(1024)), 30)
      response.on('close', () => clearInterval(timer))
      break
    case '/favicon.ico':
      response.writeHead(200, { 'Content-Type': 'image/png' })
      response.end(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/r1cAAAAASUVORK5CYII=', 'base64'))
      break
    default: {
      const title = request.url === '/two' ? 'LexN Fixture Two' : 'LexN Fixture One'
      response.setHeader('Content-Type', 'text/html')
      response.setHeader('Set-Cookie', 'lexn_fixture=reachable; Path=/; SameSite=Lax')
      response.end(`<!doctype html><title>${title}</title><body style="background:#def"><h1>${title}</h1>
        <a href="/two" target="_blank" id="blank">New tab</a> <a href="/download" id="download">Download</a>
        <a href="/slow" id="slow">Slow download</a></body>`)
    }
  }
}

test('desktop browser renders Chromium pages, downloads files, and restores its SQLite profile', { timeout: 120000 }, async t => {
  const profile = await mkdtemp(join(tmpdir(), 'lexn-desktop-'))
  await mkdir(join(profile, 'downloads'))
  const server = createServer(serve)
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve))
  const origin = 'http://127.0.0.1:' + server.address().port
  const env = { ...process.env, LEXN_TEST_PROFILE: profile }
  let app
  t.after(async () => {
    if (app) await app.close().catch(() => {})
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
    await rm(profile, { recursive: true, force: true })
  })
  const launch = async (initialize = false) => {
    app = await electron.launch({ args: ['.'], executablePath, env, timeout: 30000 })
    const page = await shellPage(app)
    await page.locator('.spatial-browser').waitFor()
    await pointAt(app, 850)
    if (initialize) {
      const intro = page.getByRole('dialog', { name: 'Welcome to Drew' })
      await intro.waitFor()
      const first = await getState(page)
      assert.deepEqual(first.workspaces.map(space => space.name), ['Personal', 'Work'])
      assert.equal(first.settings.theme, 'black')
      await intro.getByRole('button', { name: 'Open Drew' }).click()
      await intro.waitFor({ state: 'detached' })
      assert.equal((await getState(page)).welcomePending, false)
      await page.evaluate(() => window.lexn.command('setSetting', 'keepSidebarOpen', true))
    }
    await page.getByRole('combobox', { name: 'Address and search' }).waitFor()
    return page
  }
  let page = await launch(true)
  const homeSearch = page.getByRole('combobox', { name: 'Search the web' })
  await page.getByRole('heading', { name: 'Drew' }).waitFor()
  await homeSearch.waitFor()
  assert.ok(await page.locator('.home-clock').textContent())
  assert.equal(await page.locator('.quick-links').count(), 0)
  assert.equal((await page.locator('.home').boundingBox()).y, 0)
  if (process.platform === 'darwin') assert.deepEqual(await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].getWindowButtonPosition()), { x: 15, y: 11 })
  await page.getByRole('button', { name: 'Customize' }).click()
  await page.getByRole('combobox', { name: 'New tab background' }).waitFor()
  const settingsSections = page.getByRole('navigation', { name: 'Settings sections' })
  await settingsSections.getByRole('button', { name: 'Keyboard Shortcuts' }).click()
  await page.getByRole('combobox', { name: 'Shortcut key' }).selectOption('K')
  await page.getByRole('button', { name: 'Save shortcut' }).click()
  await page.getByRole('status').filter({ hasText: 'Shortcut saved' }).waitFor()
  await shortcut(app, 'K', [process.platform === 'darwin' ? 'meta' : 'control'])
  const remappedBar = page.getByRole('dialog', { name: 'Command Bar' })
  await remappedBar.waitFor()
  await remappedBar.getByRole('combobox').press('Escape')
  await page.getByRole('button', { name: 'Restore default' }).click()
  await page.getByRole('status').filter({ hasText: 'Default shortcut restored' }).waitFor()
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('lexn:shortcut', 'browse'))
  if (process.env.LEXN_SCREENSHOT) await page.screenshot({ path: process.env.LEXN_SCREENSHOT, animations: 'disabled' })
  await app.evaluate(({ session }, fixture) => {
    session.fromPartition('persist:lexn-web').webRequest.onBeforeRequest(
      { urls: ['https://www.google.com/search*'] },
      ({ url }, callback) => {
        const request = new URL(url)
        callback(request.searchParams.get('q') === 'local Chromium search' ? { redirectURL: fixture } : {})
      },
    )
  }, origin + '/one')
  await homeSearch.fill('local Chromium search')
  await homeSearch.press('Enter')
  const one = await waitUntil(async () => {
    const tab = await active(page)
    return tab.title === 'LexN Fixture One' && tab
  }, 'first page title did not update')
  assert.equal(await activeView(app), origin + '/one')
  assert.equal(await page.locator('.toolbar-top').count(), 0)
  await page.locator('.address-site-icon img').waitFor()
  await waitUntil(async () => page.locator('.address-site-icon img').evaluate(img => img.complete && img.naturalWidth > 0), 'website favicon did not load')
  await page.getByRole('button', { name: 'Add page to Favorites' }).click()
  await page.getByRole('button', { name: 'Edit page favorite' }).waitFor()
  assert.equal(await page.locator('.spatial-footer').getByRole('navigation', { name: 'Browser services' }).count(), 1)
  await page.getByRole('button', { name: 'Browser menu' }).click()
  await page.getByRole('button', { name: 'Show top toolbar' }).click()
  await page.locator('.toolbar-top').waitFor()
  const toggleModifier = process.platform === 'darwin' ? 'meta' : 'control'
  await shortcut(app, 'Y', [toggleModifier, 'shift'])
  await page.locator('.toolbar-top').waitFor({ state: 'detached' })
  await shortcut(app, 'L', [toggleModifier])
  await page.getByRole('dialog', { name: 'Command Bar' }).waitFor()
  await page.getByRole('dialog').getByRole('combobox').press('Escape')
  await page.getByRole('dialog', { name: 'Command Bar' }).waitFor({ state: 'detached' })
  const pin = page.getByRole('button', { name: 'Keep sidebar expanded' })
  const geometry = () => app.evaluate(({ BrowserWindow }) => {
    const root = BrowserWindow.getAllWindows()[0]
    const website = root.contentView.children.find(child => child.children.some(view => view.webContents?.getURL().startsWith('http:')))
    const sidebar = root.contentView.children.find(child => child.webContents?.getURL() === 'about:blank')
    return {
      website: website?.getBounds(),
      sidebar: sidebar?.getVisible() ? sidebar.getBounds() : null,
      width: root.getContentSize()[0],
      height: root.getContentSize()[1],
    }
  })
  await pin.click()
  await page.locator('.spatial-browser.spatial-collapsed').waitFor()
  const unpinned = await waitUntil(async () => {
    const geometryNow = await geometry()
    return geometryNow.website?.x === 0 && geometryNow.website.y === 0 &&
      geometryNow.website.width === geometryNow.width && geometryNow.website.height === geometryNow.height && geometryNow
  }, 'an unpinned page did not fill its viewport')
  await pointAt(app, 3)
  const floating = await waitUntil(async () => {
    const native = await geometry()
    return native.sidebar?.x === 8 && native
  }, 'sidebar did not slide over the web page')
  assert.deepEqual(floating.website, unpinned.website)
  assert.equal(floating.sidebar.y, 11)
  assert.equal(floating.sidebar.width, 268)
  assert.equal(floating.sidebar.height, floating.height - 22)
  await pointAt(app, 850)
  await waitUntil(async () => !(await geometry()).sidebar, 'sidebar did not hide on pointer exit')
  assert.deepEqual((await geometry()).website, unpinned.website)

  await shortcut(app, 'S', [toggleModifier])
  await waitUntil(async () => (await geometry()).sidebar?.x === 8, 'sidebar shortcut did not open the overlay')
  assert.deepEqual((await geometry()).website, unpinned.website)
  await shortcut(app, 'S', [toggleModifier])
  await waitUntil(async () => !(await geometry()).sidebar, 'sidebar shortcut did not close the overlay')

  await pointAt(app, 3)
  const sidebarPage = await waitUntil(async () => {
    for (const candidate of app.context().pages()) {
      if (candidate.url() === 'about:blank' && await candidate.locator('.floating-sidebar').count()) return candidate
    }
  }, 'floating sidebar renderer did not open')
  const floatingPin = sidebarPage.getByRole('button', { name: 'Keep sidebar expanded' })
  assert.equal(await sidebarPage.locator('.spatial-sidebar').evaluate(card => getComputedStyle(card).borderRadius), '18px')
  await floatingPin.click()
  await waitUntil(async () => (await getState(page)).settings.keepSidebarOpen, 'sidebar pin was not saved')
  await waitUntil(async () => {
    const native = await geometry()
    return native.sidebar === null && native.website?.x === 284 && native.website.width === native.width - 284
  }, 'pinning the sidebar did not resize the page')
  const pinnedCard = page.locator('.spatial-sidebar')
  assert.equal((await pinnedCard.boundingBox()).x, 8)
  assert.equal((await pinnedCard.boundingBox()).y, 11)
  assert.equal((await pinnedCard.boundingBox()).height, floating.height - 22)
  assert.equal(await pinnedCard.evaluate(card => getComputedStyle(card).borderRadius), '18px')
  const grip = await page.getByRole('separator', { name: 'Sidebar width' }).boundingBox()
  await page.mouse.move(grip.x + 1, grip.y + 180)
  await page.mouse.down()
  await page.mouse.move(grip.x + 37, grip.y + 180, { steps: 4 })
  await page.mouse.up()
  await waitUntil(async () => (await getState(page)).settings.sidebarWidth === '320', 'sidebar width was not saved')
  await waitUntil(async () => (await geometry()).website?.x === 320, 'the pinned sidebar did not reserve its resized width')
  const services = page.getByRole('navigation', { name: 'Browser services' })
  await services.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('button', { name: 'Appearance', exact: true }).click()
  const keepOpen = page.getByRole('checkbox', { name: 'Keep tab sidebar expanded' })
  await keepOpen.uncheck()
  await keepOpen.check()
  await waitUntil(async () => await pin.getAttribute('aria-pressed') === 'true', 'sidebar pin did not reflect Settings')
  await pointAt(app, 850)
  await shortcut(app, 'S', [toggleModifier])
  assert.equal(await page.locator('.spatial-collapsed').count(), 0)
  await page.locator(`[data-tab-id="${one.id}"]`).click()
  await waitUntil(async () => await activeView(app) === origin + '/one', 'website did not reattach after changing chrome')

  const websiteGlobals = await app.evaluate(({ webContents }, url) => {
    const tab = webContents.getAllWebContents().find(contents => contents.getURL() === url)
    return tab.executeJavaScript('[typeof window.lexn, typeof require, typeof process, document.querySelector("h1").textContent, Notification.permission]')
  }, origin + '/one')
  assert.deepEqual(websiteGlobals, ['undefined', 'undefined', 'undefined', 'LexN Fixture One', 'denied'])
  await assert.rejects(page.evaluate(() => window.lexn.command('setSetting', 'engine', 'not-a-search-engine')), /Invalid option/)

  await go(page, origin + '/two')
  await waitUntil(async () => (await active(page)).title === 'LexN Fixture Two', 'second page did not load')
  await page.getByRole('button', { name: 'Back', exact: true }).click()
  await waitUntil(async () => (await active(page)).url === origin + '/one', 'back did not navigate')
  await page.getByRole('button', { name: 'Forward', exact: true }).click()
  await waitUntil(async () => (await active(page)).url === origin + '/two', 'forward did not navigate')
  const visited = await waitUntil(() => app.context().pages().find(candidate => candidate.url() === origin + '/two'), 'website view was not available')
  await visited.mouse.move(400, 120)
  await visited.mouse.wheel(-100, 0)
  await waitUntil(async () => (await active(page)).url === origin + '/one', 'two-finger back gesture did not navigate')
  await sleep(520)
  await visited.mouse.move(400, 120)
  await visited.mouse.wheel(100, 0)
  await waitUntil(async () => (await active(page)).url === origin + '/two', 'two-finger forward gesture did not navigate')
  await page.getByRole('button', { name: 'Bookmark this page' }).click()
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await page.getByRole('button', { name: 'Edit bookmark' }).waitFor()

  await app.evaluate(({ webContents }, url) => {
    return webContents.getAllWebContents().find(contents => contents.getURL() === url).executeJavaScript('document.getElementById("blank").click()', true)
  }, origin + '/two')
  const two = await waitUntil(async () => {
    const tab = await active(page)
    return tab.id !== one.id && tab.title === 'LexN Fixture Two' && tab
  }, 'target=_blank did not create a Chromium tab')
  await page.locator(`[data-tab-id="${one.id}"]`).click()
  assert.equal((await active(page)).id, one.id)
  await page.locator(`[data-tab-id="${two.id}"]`).click()
  assert.equal(await activeView(app), origin + '/two')
  await page.locator(`[data-tab-id="${one.id}"]`).click({ button: 'right' })
  await page.getByRole('button', { name: 'Add to Split View' }).click()
  await waitUntil(async () => await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].contentView.children.flatMap(child => child.children).filter(child => child.webContents?.getURL().startsWith('http:')).length) === 2,
    'two native browsing panes were not attached')
  await page.getByRole('button', { name: 'Remove LexN Fixture Two from split' }).last().click()
  await page.locator('.split-view').waitFor({ state: 'detached' })
  const modifier = process.platform === 'darwin' ? 'meta' : 'control'
  await shortcut(app, 'T', [modifier])
  const commandBar = page.getByRole('dialog', { name: 'Command Bar' })
  await commandBar.getByRole('combobox').fill('New Blank Tab')
  await commandBar.getByRole('combobox').press('Enter')
  await waitUntil(async () => (await active(page)).url === 'about:blank', 'new-tab shortcut did not work')
  await shortcut(app, 'W', [modifier])
  await waitUntil(async () => (await active(page)).id === two.id, 'close-tab shortcut did not restore the previous tab')
  await shortcut(app, 'T', [modifier, 'shift'])
  const reopened = await waitUntil(async () => {
    const tab = await active(page)
    return tab.url === 'about:blank' && tab
  }, 'reopen shortcut did not restore the tab')
  await page.locator(`[data-tab-id="${reopened.id}"]`).click()
  await shortcut(app, 'Tab', ['control'])
  await waitUntil(async () => (await active(page)).id === one.id, 'next-tab shortcut did not cycle tabs')

  await page.getByRole('button', { name: 'Create tab group' }).click()
  await page.getByRole('textbox', { name: 'Name' }).fill('Reading')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  const reading = await waitUntil(async () => (await getState(page)).groups.find(group => group.name === 'Reading'), 'group was not created')
  await page.locator(`[data-tab-id="${two.id}"]`).click({ button: 'right' })
  await page.getByRole('combobox', { name: 'Move tab to group' }).selectOption(reading.id)
  await waitUntil(async () => (await getState(page)).tabs.some(tab => tab.id === two.id && tab.groupId === reading.id), 'tab was not grouped')
  await page.locator(`[data-tab-id="${one.id}"]`).click({ button: 'right' })
  await page.getByRole('button', { name: 'Pin tab', exact: true }).click()
  await waitUntil(async () => (await getState(page)).tabs.some(tab => tab.id === one.id && tab.pinned === 1), 'tab was not pinned')
  await waitUntil(async () => await activeView(app) === origin + '/two', 'view did not reattach after context menu')

  await page.getByRole('button', { name: 'Browser menu' }).click()
  await page.getByRole('button', { name: 'Page assistant' }).click()
  await page.getByRole('complementary', { name: 'Page assistant' }).waitFor()
  assert.equal(await activeView(app), origin + '/two')
  await page.getByRole('button', { name: 'Close assistant' }).click()

  await app.evaluate(({ BrowserWindow }) => {
    const view = BrowserWindow.getAllWindows()[0].contentView.children.flatMap(child => child.children).find(child => child.webContents?.getURL().startsWith('http:'))
    return view.webContents.executeJavaScript('document.getElementById("download").click()', true)
  })
  await page.getByRole('button', { name: 'Downloads', exact: true }).click()
  await page.getByRole('button', { name: 'Reveal lexn-smoke.txt' }).waitFor()
  assert.equal(await readFile(join(profile, 'downloads', 'lexn-smoke.txt'), 'utf8'), 'LexN real download\n')
  assert.equal(await activeView(app), null)

  await page.locator(`[data-tab-id="${one.id}"]`).click()
  await app.evaluate(({ BrowserWindow }) => {
    const view = BrowserWindow.getAllWindows()[0].contentView.children.flatMap(child => child.children).find(child => child.webContents?.getURL().startsWith('http:'))
    return view.webContents.executeJavaScript('document.getElementById("slow").click()', true)
  })
  await page.getByRole('button', { name: 'Downloads', exact: true }).click()
  await page.getByRole('button', { name: 'Cancel lexn-slow.bin' }).click()
  await waitUntil(async () => (await getState(page)).downloads.some(item => item.name === 'lexn-slow.bin' && item.state === 'cancelled'),
    'Chromium download cancellation was not saved')

  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('button', { name: 'Cookies', exact: true }).click()
  await page.getByText('lexn_fixture', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Remove cookie lexn_fixture' }).click()
  await page.getByText('No cookies stored').waitFor()
  await page.getByRole('button', { name: 'Appearance', exact: true }).click()
  await page.getByRole('combobox', { name: 'Theme', exact: true }).selectOption('light')
  await page.locator('.browser.light').waitFor()
  assert.equal(await page.locator('.viewport').evaluate(viewport => getComputedStyle(viewport).backgroundColor), 'rgb(255, 255, 255)')
  for (const [theme, color] of [['rose', 'rgb(255, 243, 246)'], ['sky', 'rgb(237, 247, 255)'],
    ['mint', 'rgb(237, 249, 242)'], ['lavender', 'rgb(247, 242, 255)']]) {
    await page.getByRole('combobox', { name: 'Theme', exact: true }).selectOption(theme)
    await page.locator('.browser.' + theme).waitFor()
    assert.equal(await page.locator('.viewport').evaluate(viewport => getComputedStyle(viewport).backgroundColor), color)
  }
  await settingsSections.getByRole('button', { name: 'Notifications' }).click()
  await page.getByLabel('Notification website').fill('https://example.com')
  await page.getByRole('button', { name: 'Save notification rule' }).click()
  const siteRule = page.getByLabel('Notification permission for https://example.com')
  await siteRule.waitFor()
  await siteRule.selectOption('block')
  await waitUntil(async () => (await getState(page)).permissions.some(rule => rule.permission === 'notifications' && !rule.allow),
    'website notification denial was not saved')
  await siteRule.selectOption('allow')
  await page.getByRole('combobox', { name: 'Website notifications' }).selectOption('block')
  await waitUntil(async () => (await getState(page)).settings.notificationPolicy === 'block', 'global notification block was not saved')
  await page.getByRole('combobox', { name: 'Website notifications' }).selectOption('approved')
  const extensionPath = join(profile, 'fixture-extension')
  await mkdir(extensionPath)
  await writeFile(join(extensionPath, 'manifest.json'), JSON.stringify({
    manifest_version: 3, name: 'LexN Fixture Extension', version: '1.0.0', action: { default_popup: 'popup.html' },
  }))
  await writeFile(join(extensionPath, 'popup.html'), '<!doctype html><title>LexN Fixture Popup</title><p>Extension popup</p>')
  await shortcut(app, 'T', [modifier])
  await commandBar.getByRole('combobox').fill('Extensions')
  await commandBar.getByRole('combobox').press('Enter')
  await app.evaluate(({ dialog }, path) => {
    const original = dialog.showOpenDialog
    dialog.showOpenDialog = async () => {
      dialog.showOpenDialog = original
      return { canceled: false, filePaths: [path] }
    }
  }, extensionPath)
  await page.getByRole('button', { name: 'Load unpacked' }).click()
  await page.getByText('LexN Fixture Extension', { exact: true }).waitFor()
  await shortcut(app, 'T', [modifier])
  await commandBar.getByRole('combobox').fill('LexN Fixture Extension')
  await commandBar.getByRole('combobox').press('Enter')
  await waitUntil(async () => app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().some(win => win.webContents.getURL().startsWith('chrome-extension://'))), 'extension popup did not open')
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows().find(win => win.webContents.getURL().startsWith('chrome-extension://')).close()
  })
  const favorites = page.getByRole('region', { name: 'Favorites' })
  await favorites.getByRole('button', { name: 'Add favorite', exact: true }).click()
  const addFavorite = page.getByRole('dialog', { name: 'Add favorite' })
  await addFavorite.getByRole('textbox', { name: 'Title' }).fill('Fixture Favorite')
  await addFavorite.getByRole('textbox', { name: 'Website URL' }).fill(origin + '/favorite')
  await addFavorite.getByRole('textbox', { name: 'Icon' }).fill('★')
  await addFavorite.getByRole('button', { name: 'Save', exact: true }).click()
  const tile = favorites.getByRole('button', { name: 'Fixture Favorite' })
  await tile.waitFor()
  await tile.dragTo(favorites.getByRole('button', { name: 'Google' }))
  await waitUntil(async () => (await getState(page)).favorites[0].title === 'Fixture Favorite', 'favorite did not move')
  assert.equal(await favorites.getByRole('combobox', { name: 'Favorite icon size' }).count(), 0)
  await page.getByRole('navigation', { name: 'Browser services' }).getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('button', { name: 'Appearance', exact: true }).click()
  await page.getByRole('combobox', { name: 'Favorite icon size' }).selectOption('small')
  await page.locator('.favorites-small').waitFor()
  await tile.click({ button: 'right' })
  await page.getByRole('button', { name: 'Edit favorite', exact: true }).click()
  const editFavorite = page.getByRole('dialog', { name: 'Edit favorite' })
  await editFavorite.getByRole('textbox', { name: 'Icon' }).fill('✦')
  await editFavorite.getByRole('button', { name: 'Save', exact: true }).click()
  await waitUntil(async () => (await getState(page)).favorites[0].icon === '✦', 'favorite edit did not persist')
  await favorites.getByRole('button', { name: 'Music' }).click({ button: 'right' })
  await page.getByRole('button', { name: 'Remove favorite', exact: true }).click()
  await favorites.getByRole('button', { name: 'Music' }).waitFor({ state: 'detached' })
  await page.locator(`[data-tab-id="${one.id}"]`).dragTo(favorites.getByRole('button', { name: 'Add or drop favorite' }))
  await waitUntil(async () => (await getState(page)).favorites.some(item => item.url === origin + '/two'), 'tab drag did not add a favorite')
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('button', { name: 'Appearance', exact: true }).click()
  await page.getByRole('combobox', { name: 'Theme', exact: true }).selectOption('black')
  await page.locator('.browser.black').waitFor()
  assert.equal(await page.locator('.spatial-sidebar').evaluate(element => getComputedStyle(element).backgroundColor), 'rgb(0, 0, 0)')
  await page.getByLabel('Custom accent color').fill('#23a878')
  await page.getByRole('combobox', { name: 'Color intensity' }).selectOption('vivid')
  await waitUntil(async () => (await getState(page)).settings.accentColor === '#23a878', 'custom accent was not saved')
  if (process.env.LEXN_BLACK_SCREENSHOT) await page.screenshot({ path: process.env.LEXN_BLACK_SCREENSHOT })
  if (process.platform !== 'linux') {
    await app.evaluate(({ safeStorage }) => {
      safeStorage.isAsyncEncryptionAvailable = async () => true
      safeStorage.encryptStringAsync = async () => Buffer.from('encrypted-fixture-only')
    })
    await page.evaluate(() => window.lexn.command('saveLogin', 'https://example.org', 'test-login', 'temporary-fixture'))
    assert.equal((await getState(page)).passwords[0].username, 'test-login')
  }
  await pointAt(app, 3)
  const preRestartHistory = await page.evaluate(() => window.lexn.history('Fixture Two'))
  assert.ok(preRestartHistory.length > 0)
  await page.getByRole('button', { name: 'Add Space or profile' }).click()
  await page.getByRole('button', { name: 'New profile' }).click()
  await page.getByRole('textbox', { name: 'Name' }).fill('Research')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await waitUntil(async () => {
    const state = await getState(page)
    return state.workspaces.some(space => space.name === 'Research' && space.id === state.workspaceId)
  }, 'workspace was not created')
  const isolated = await getState(page)
  assert.deepEqual(isolated.bookmarks, [])
  assert.deepEqual(isolated.extensions, [])
  assert.deepEqual(isolated.passwords, [])
  assert.deepEqual(isolated.downloads, [])
  assert.deepEqual(isolated.permissions, [])
  assert.deepEqual(await page.evaluate(() => window.lexn.cookies()), [])
  assert.deepEqual(await page.evaluate(() => window.lexn.history('')), [])
  assert.equal(isolated.favorites[0].title, 'Google')
  assert.ok(isolated.favorites.some(item => item.id === 'music'))
  assert.ok(!isolated.favorites.some(item => item.title === 'Fixture Favorite'))
  assert.equal(isolated.settings.theme, 'dark')
  assert.equal(isolated.settings.accentColor, '')
  assert.equal(isolated.settings.favoriteSize, 'medium')
  assert.equal(isolated.settings.keepSidebarOpen, true)
  assert.equal(isolated.settings.sidebarWidth, '320')
  await page.evaluate(() => window.lexn.command('saveFavorite', 'google', 'https://www.google.com/', 'Research Google', 'R'))
  await page.evaluate(() => window.lexn.command('setSetting', 'theme', 'slate'))
  await page.locator('.browser.slate').waitFor()
  await page.locator('.spatial-sidebar').dispatchEvent('wheel', { deltaX: 105, deltaY: 0 })
  await waitUntil(async () => { const state = await getState(page); return state.workspaces.find(item => item.id === state.workspaceId)?.name === 'Personal' }, 'horizontal swipe did not advance to Personal')
  for (let packet = 0; packet < 7; packet++) {
    await sleep(110)
    const surface = packet % 2 ? '.spatial-footer' : '.spatial-sidebar'
    await page.locator(surface).dispatchEvent('wheel', { deltaX: 95, deltaY: 36 })
    assert.equal((await getState(page)).workspaceId, (await getState(page)).workspaces[0].id)
  }
  await sleep(330)
  await page.locator('.spatial-sidebar').dispatchEvent('wheel', { deltaX: -105, deltaY: 0 })
  await waitUntil(async () => { const state = await getState(page); return state.workspaces.find(item => item.id === state.workspaceId)?.name === 'Research' }, 'reverse swipe did not return to Research')
  if (process.platform === 'darwin') {
    assert.equal(await page.evaluate(() => window.lexn.usesNativeSpaceScroll()), true)
    await app.evaluate(({ BrowserWindow }) => {
      const root = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().startsWith('lexn://shell'))
      const send = (phase, dx, momentum = false) => root.webContents.send(
        'lexn:space-scroll', { x: 100, dx, dy: 0, phase, momentum },
      )
      send('begin', 0); send('change', 70); send('end', 0)
      send('change', 120, true)
      send('begin', 0); send('change', 70); send('end', 0)
    })
    await waitUntil(async () => {
      const state = await getState(page)
      return state.workspaces.find(item => item.id === state.workspaceId)?.name === 'Work'
    }, 'two rapid native swipes did not move exactly two Spaces')
    await page.evaluate(async () => {
      const current = await window.lexn.getState()
      await window.lexn.command('workspace', current.workspaces.find(space => space.name === 'Research').id)
    })
  }


  await go(page, origin + '/one')
  await waitUntil(async () => (await active(page)).title === 'LexN Fixture One', 'profile navigation failed')
  await waitUntil(async () => (await page.evaluate(() => window.lexn.cookies())).some(cookie => cookie.name === 'lexn_fixture'), 'profile cookie was not set')
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]
    const timeline = []
    Reflect.set(window, 'drewTestSwipeFrames', timeline)
    const timer = setInterval(() => {
      if (window.isDestroyed()) {
        clearInterval(timer)
        return
      }
      const viewport = window.contentView.children.find(view => view.children.length > 0)
      if (!viewport) return
      timeline.push({ width: viewport.getBounds().width, pages: viewport.children.map(page => page.getBounds()) })
    }, 8)
    setTimeout(() => clearInterval(timer), 550)
  })
  await page.getByRole('button', { name: 'Personal', exact: true }).click()
  assert.deepEqual(await page.evaluate(() => window.lexn.cookies()), [])
  await waitUntil(async () => (await geometry()).website?.x === 320, 'the second Profile did not keep the shared width')
  const frames = await app.evaluate(({ BrowserWindow }) => Reflect.get(BrowserWindow.getAllWindows()[0], 'drewTestSwipeFrames'))
  assert.ok(frames.length > 0 && frames.every(({ width, pages }) =>
    pages.length === 1 && pages[0].x === 0 && pages[0].width === width), 'the webpage moved during the Profile switch')
  await page.getByRole('button', { name: 'Research', exact: true }).click()
  await page.getByRole('button', { name: 'Add Space or profile' }).click()
  await page.getByRole('button', { name: 'New Space', exact: true }).click()
  await page.getByRole('textbox', { name: 'Name' }).fill('Second Research Space')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await waitUntil(async () => {
    const state = await getState(page)
    const research = state.workspaces.find(space => space.name === 'Research')
    return state.workspaces.some(space => space.name === 'Second Research Space' && space.id === state.workspaceId && space.profileId === research?.id)
  }, 'shared Space did not attach to its selected profile')
  assert.ok((await page.evaluate(() => window.lexn.cookies())).some(cookie => cookie.name === 'lexn_fixture'))
  assert.equal((await active(page)).url, 'about:blank')
  assert.equal((await getState(page)).favorites[0].title, 'Research Google')
  assert.equal((await getState(page)).settings.theme, 'slate')
  await go(page, origin + '/one')
  await waitUntil(async () => (await active(page)).title === 'LexN Fixture One', 'shared-space navigation failed')
  await page.getByRole('button', { name: 'Clear', exact: true }).click()
  await page.getByRole('button', { name: 'Archived tabs' }).click()
  await page.locator('.record-link').filter({ hasText: 'LexN Fixture One' }).click()
  await waitUntil(async () => (await active(page)).url === origin + '/one', 'could not restore archived tab')
  await page.getByRole('button', { name: 'Research', exact: true }).click()

  await page.getByRole('button', { name: 'Browser menu' }).click()
  await page.getByRole('button', { name: 'Show top toolbar' }).click()
  await page.locator('.toolbar-top').waitFor()
  const exitCode = new Promise(resolve => app.process().once('exit', resolve))
  await app.close()
  assert.equal(await exitCode, 0)
  app = undefined
  page = await launch()
  assert.equal((await active(page)).url, origin + '/one')
  assert.equal((await getState(page)).settings.theme, 'slate')
  assert.equal((await getState(page)).settings.favoriteSize, 'medium')
  assert.equal((await getState(page)).favorites[0].title, 'Research Google')
  await page.locator('.toolbar-top').waitFor()
  await pointAt(app, 3)
  await page.getByRole('button', { name: 'Personal', exact: true }).click()
  await page.locator('.browser.black').waitFor()
  const personal = await getState(page)
  assert.equal(personal.settings.keepSidebarOpen, true)
  assert.equal(personal.settings.sidebarWidth, '320')
  assert.equal(personal.settings.favoriteSize, 'small')
  assert.equal(personal.settings.accentColor, '#23a878')
  assert.equal(personal.settings.colorIntensity, 'vivid')
  assert.equal(personal.favorites[0].icon, '✦')
  assert.equal(personal.favorites.find(item => item.id === 'google').title, 'Google')
  if (process.platform !== 'linux') assert.equal(personal.passwords[0].username, 'test-login')
  const postRestartHistory = await page.evaluate(() => window.lexn.history('Fixture Two'))
  assert.ok(postRestartHistory.some(visit => preRestartHistory.some(previous => previous.id === visit.id)))
  const restored = await getState(page)
  assert.ok(restored.tabs.some(tab => tab.id === two.id && tab.url === origin + '/two' && tab.groupId === reading.id))
  assert.ok(restored.tabs.some(tab => tab.id === one.id && tab.pinned === 1))
  await page.locator(`[data-tab-id="${two.id}"]`).click()
  await waitUntil(async () => await activeView(app) === origin + '/two', 'workspace tab was not reattached')
  await page.getByRole('navigation', { name: 'Browser services' }).getByRole('button', { name: 'Bookmarks', exact: true }).click()
  await page.locator('.record-link').filter({ hasText: 'LexN Fixture Two' }).waitFor()
  await page.getByRole('button', { name: 'History', exact: true }).click()
  await page.getByRole('searchbox', { name: 'Search history' }).fill('Fixture Two')
  await page.locator('.record-link').filter({ hasText: 'LexN Fixture Two' }).first().waitFor()

  await waitUntil(async () => (await getState(page)).extensions.some(extension => extension.name === 'LexN Fixture Extension'),
    'extension did not reload on restart')
  await page.locator(`[data-tab-id="${one.id}"]`).click()
  await waitUntil(async () => await activeView(app) === origin + '/two', 'pinned tab did not attach')
  await app.evaluate(({ BrowserWindow }) => {
    const root = BrowserWindow.getAllWindows().find(win => win.webContents.getURL().startsWith('lexn://'))
    return root.contentView.children.flatMap(child => child.children).find(child => child.webContents?.getURL().startsWith('http:')).webContents
      .executeJavaScript('document.getElementById("blank").click()', true)
  })
  await waitUntil(async () => app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().some(win => win.isModal() && win.webContents.getURL().startsWith('http:') && !win.webContents.isLoading())), 'pinned link did not open a peek window')
  await app.evaluate(({ BrowserWindow }) => {
    const view = BrowserWindow.getAllWindows().find(win => win.isModal() && win.webContents.getURL().startsWith('http:'))
    view.focus()
    view.webContents.focus()
    view.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter', modifiers: [process.platform === 'darwin' ? 'meta' : 'control'] })
  })
  await waitUntil(async () => (await active(page)).id !== one.id, 'peek was not promoted to a full tab')

  const extraPanes = []
  for (let index = 1; index <= 3; index++) {
    const url = origin + '/pane-' + index
    await page.evaluate(address => window.lexn.command('newTab', address), url)
    extraPanes.push((await active(page)).id)
  }
  await page.locator(`[data-tab-id="${one.id}"]`).click()
  for (const id of extraPanes) {
    await page.locator(`[data-tab-id="${id}"]`).click({ button: 'right' })
    await page.getByRole('button', { name: 'Add to Split View' }).click()
  }
  await waitUntil(async () => await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].contentView.children.flatMap(child => child.children).filter(child => child.webContents?.getURL().startsWith('http:')).length) === 4,
    'four native browsing panes were not attached')
  const divider = await page.getByRole('button', { name: 'Resize split panes' }).first().boundingBox()
  const before = (await page.locator('.split-pane').first().boundingBox()).width
  await page.mouse.move(divider.x + divider.width / 2, divider.y + 55)
  await page.mouse.down()
  await page.mouse.move(divider.x + 35, divider.y + 55, { steps: 4 })
  await page.mouse.up()
  await waitUntil(async () => (await page.locator('.split-pane').first().boundingBox()).width > before + 15,
    'dragging the divider did not resize the split panes')
})

test('Drew imports links on first run, opens Home from Settings, and keeps each window’s tabs separate', { timeout: 60000 }, async t => {
  const profile = await mkdtemp(join(tmpdir(), 'drew-window-import-'))
  const app = await electron.launch({ args: ['.'], executablePath, env: { ...process.env, LEXN_TEST_PROFILE: profile } })
  t.after(async () => {
    await app.close().catch(() => {})
    await rm(profile, { recursive: true, force: true })
  })
  const page = await shellPage(app)
  await page.getByRole('dialog').getByRole('button', { name: 'Import browser data' }).click()
  const picker = page.getByRole('button', { name: 'Import links file' })
  await picker.waitFor()
  const book = join(profile, 'export.md')
  await writeFile(book, '# Reading\n- [Import fixture](https://example.org/imported)')
  await app.evaluate(({ dialog }, path) => {
    const original = dialog.showOpenDialog
    dialog.showOpenDialog = async () => {
      dialog.showOpenDialog = original
      return { canceled: false, filePaths: [path] }
    }
  }, book)
  await picker.click()
  await page.getByText('Imported 1 bookmark into Personal.').waitFor()
  assert.equal((await getState(page)).bookmarks.length, 1)
  await page.getByRole('button', { name: 'Appearance', exact: true }).click()
  await page.getByRole('button', { name: 'Glacier', exact: true }).click()
  await page.locator('.browser.has-gradient').waitFor()
  assert.equal((await getState(page)).settings.accentEnd, '#6b9af1')
  await page.getByLabel('Keep tab sidebar expanded').check()
  await page.getByRole('button', { name: 'General', exact: true }).click()
  await page.getByRole('button', { name: 'Open home page', exact: true }).click()
  await page.getByRole('heading', { name: 'Drew' }).waitFor()
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('button', { name: 'Home', exact: true }).click()
  await page.getByRole('heading', { name: 'Drew' }).waitFor()

  const firstTab = await active(page)
  const opened = app.context().waitForEvent('page', { predicate: candidate =>
    candidate.waitForURL('lexn://shell/index.html', { timeout: 4000 }).then(() => true).catch(() => false) })
  await page.getByRole('button', { name: 'Browser menu', exact: true }).click()
  await page.getByRole('button', { name: 'New Window', exact: true }).click()
  const second = await opened
  await second.getByRole('heading', { name: 'Drew' }).waitFor()
  assert.notEqual((await active(second)).id, firstTab.id)
  assert.equal((await getState(second)).settings.accentEnd, '#6b9af1')
  const personal = await getState(page)
  await second.evaluate(async id => {
    await window.lexn.command('workspace', id)
    await window.lexn.command('saveFavorite', 'google', 'https://www.google.com/', 'Work favorite', 'W')
  }, personal.workspaces[1].id)
  assert.equal((await getState(second)).settings.accentEnd, '')
  assert.equal((await getState(second)).bookmarks.length, 0)
  assert.equal((await active(page)).id, firstTab.id)
  await second.evaluate(() => window.lexn.command('windowAction', 'close')).catch(() => {})
  await page.locator('.spatial-sidebar').dispatchEvent('wheel', { deltaX: 30, deltaY: 0 })
  assert.equal(await page.locator('.favorites-swipe-next [aria-label="Work favorite"]').count(), 1)
  assert.equal((await getState(page)).workspaceId, personal.workspaceId)
  await page.locator('.spatial-sidebar').dispatchEvent('wheel', { deltaX: 60, deltaY: 0 })
  await page.getByRole('button', { name: 'Work favorite', exact: true }).waitFor()
  assert.equal((await getState(page)).workspaceId, personal.workspaces[1].id)
})

test('Google, web search, and YouTube load in Chromium', { skip: !process.env.LEXN_TEST_PUBLIC_WEB, timeout: 90000 }, async t => {
  const profile = await mkdtemp(join(tmpdir(), 'lexn-public-'))
  let app
  t.after(async () => {
    if (app) await app.close().catch(() => {})
    await rm(profile, { recursive: true, force: true })
  })
  app = await electron.launch({ args: ['.'], executablePath, env: { ...process.env, LEXN_TEST_PROFILE: profile } })
  const page = await shellPage(app)
  await page.locator('.spatial-browser').waitFor()
  await page.getByRole('button', { name: 'Open Drew' }).click()
  await shortcut(app, 'S', [process.platform === 'darwin' ? 'meta' : 'control'])
  for (const [input, host, path] of [['google.com', /google\./, /^\/$/], ['Chromium browser', /google\./, /^\/search/], ['youtube.com', /youtube\.com/, /^\/$/]]) {
    await t.test(input, async subtest => {
      await go(page, input)
      let tab
      try {
        await waitUntil(async () => {
          tab = await active(page)
          if (!tab?.url.startsWith('https://') || tab.loading || tab.error) return false
          const url = new URL(tab.url)
          if (input === 'Chromium browser' && host.test(url.hostname) && url.pathname.startsWith('/sorry/')) {
            const requested = url.searchParams.get('continue')
            if (requested && new URL(requested).searchParams.get('q') === input) {
              subtest.skip('Google redirected the correct search request to its verification page.')
              return true
            }
          }
          return host.test(url.hostname) && path.test(url.pathname) && tab.title !== url.hostname
        }, 'Public page did not finish loading', 22000)
      } catch (error) {
        throw new Error(`${error.message} (${tab?.url ? new URL(tab.url).origin + new URL(tab.url).pathname : 'no URL'}: ${tab?.error || 'page did not match'})`, { cause: error })
      }
    })
  }
})
