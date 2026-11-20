import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { addressToUrl, originOf, webUrl } from '../out/shared/navigation.js'
import { Database } from '../out/electron/main/database.js'
import { exportedLinks, passwordRows, readChromium, saveImported, scanChromiumProfiles } from '../out/electron/main/importData.js'
import { chromiumProfile, markdownProfiles, saveBrowserProfiles } from '../out/electron/main/profileImport.js'

test('Profile migrations preserve layout data and reuse the same isolated destinations on retry', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'drew-profile-migration-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const defaultPath = join(dir, 'Default')
  const workPath = join(dir, 'Profile 1')
  mkdirSync(defaultPath)
  mkdirSync(workPath)
  writeFileSync(join(dir, 'Local State'), JSON.stringify({ profile: { info_cache: {
    Default: { name: 'Personal' }, 'Profile 1': { name: 'Office' },
  } } }))
  writeFileSync(join(defaultPath, 'Preferences'), JSON.stringify({ browser: { theme: { user_color2: 0xff3388aa, color_scheme2: 1 } },
    pinned_tabs: [{ url: 'https://example.org/pin', title: 'Browser pin' }] }))
  writeFileSync(join(defaultPath, 'Bookmarks'), JSON.stringify({ roots: { bookmark_bar: {
    name: 'Bookmarks Bar', children: [{ type: 'url', name: 'Toolbar favorite', url: 'https://example.org/favorite' }],
  } } }))
  writeFileSync(join(workPath, 'Preferences'), '{}')
  const sources = await scanChromiumProfiles(dir, 'Chrome')
  assert.deepEqual(sources.map(source => source.label), ['Personal', 'Office'])
  const data = await Promise.all(sources.map(chromiumProfile))
  const db = new Database(join(dir, 'target.sqlite'))
  t.after(() => db.close())
  const first = saveBrowserProfiles(db, data)
  const [personal, office] = first.results.profiles
  assert.equal(personal.name, 'Personal (2)')
  assert.equal(db.settings(personal.id).accentColor, '#3388aa')
  assert.equal(db.settings(personal.id).theme, 'light')
  assert.equal(first.results.favorites, 1)
  assert.equal(first.createdTabs[0].title, 'Browser pin')
  assert.equal(first.createdTabs[0].workspaceId, personal.id)
  assert.equal(first.createdTabs[0].pinned, 1)
  assert.equal(db.all('SELECT id FROM favorites WHERE profileId = ?', office.id).length, 0)
  const repeat = saveBrowserProfiles(db, data)
  assert.deepEqual(repeat.results.profiles, first.results.profiles)
  assert.equal(repeat.createdTabs.length, 0)

  const markdown = markdownProfiles('# Arc Data Export\n## Space: Studio\nColor: #aabbcc\n### Favorites\n- [Mail](https://example.org/mail)\n### Pinned Tabs\n- **Planning**\n  - **Quarterly**\n    - [Roadmap](https://example.org/roadmap)\n### Today\n- [Read](https://example.org/read)\n## Space: Library\n### Pinned Tabs\n- [Research](https://example.org/research)', 'Arc')
  const imported = saveBrowserProfiles(db, markdown)
  const [studio, library] = imported.results.profiles
  assert.deepEqual(imported.results.profiles.map(profile => profile.name), ['Studio', 'Library'])
  assert.equal(db.settings(studio.id).accentColor, '#aabbcc')
  assert.equal(imported.results.pinned, 2)
  assert.equal(imported.results.tabs, 1)
  assert.deepEqual(db.all('SELECT url FROM tabs WHERE workspaceId = ?', library.id).map(tab => tab.url), ['https://example.org/research'])
  assert.deepEqual(db.all('SELECT name FROM tab_groups WHERE workspaceId = ? ORDER BY rowid', studio.id).map(group => group.name), ['Planning', 'Quarterly'])
})

test('browser imports preserve folders and timestamps, ignore duplicates, and stay in the destination Profile', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'drew-import-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const visit = 1783456789000
  const history = new DatabaseSync(join(dir, 'History'))
  history.exec('CREATE TABLE urls (url TEXT, title TEXT, last_visit_time INTEGER)')
  history.prepare('INSERT INTO urls VALUES (?, ?, ?)').run('https://example.org/reading', 'Reading', (visit + 11644473600000) * 1000)
  history.close()
  writeFileSync(join(dir, 'Bookmarks'), JSON.stringify({ roots: { bookmark_bar: {
    name: 'Bar', children: [{ type: 'folder', name: 'Reading', children: [
      { type: 'url', name: 'Saved article', url: 'https://example.org/article' },
      { type: 'url', name: 'Local file', url: 'file:///private/example' },
    ] }],
  } } }))
  const imported = await readChromium(dir)
  assert.deepEqual(imported.notes, [])
  assert.deepEqual(imported.links, [{ url: 'https://example.org/article', title: 'Saved article', folder: 'Bar › Reading' }])
  assert.deepEqual(imported.history, [{ url: 'https://example.org/reading', title: 'Reading', visitedAt: visit }])
  const db = new Database(join(dir, 'drew.sqlite'))
  const [first, second] = db.all('SELECT id FROM workspaces ORDER BY rowid')
  assert.deepEqual(saveImported(db, first.id, imported.links, imported.history), { bookmarks: 1, visits: 1 })
  assert.deepEqual(saveImported(db, first.id, imported.links, imported.history), { bookmarks: 0, visits: 0 })
  assert.equal(db.history('', first.id).length, 1)
  assert.equal(db.history('', second.id).length, 0)
  assert.equal(db.all('SELECT id FROM bookmarks WHERE workspaceId = ?', second.id).length, 0)
  db.close()
  assert.deepEqual(exportedLinks('# Favorites\n- [Article](https://example.org/Article_(book))', true),
    [{ url: 'https://example.org/Article_(book)', title: 'Article', folder: 'Favorites' }])
  assert.deepEqual(exportedLinks('# Work\n## Favorites\n- [Work](https://example.org/work)\n# Personal\n## Favorites\n- [Home](https://example.org/home)', true),
    [{ url: 'https://example.org/work', title: 'Work', folder: 'Work › Favorites' },
      { url: 'https://example.org/home', title: 'Home', folder: 'Personal › Favorites' }])
  assert.deepEqual(exportedLinks('<DL><H3>News &amp; Reading</H3><DL><A HREF="https://example.org/?q=1&amp;a=2">Saved</A></DL></DL>'),
    [{ url: 'https://example.org/?q=1&a=2', title: 'Saved', folder: 'News & Reading' }])
  assert.deepEqual(passwordRows('name,url,username,password\r\nFixture,https://example.org/path,"a,b","c""d"\r\n'),
    { entries: [{ origin: 'https://example.org', username: 'a,b', password: 'c"d' }], skipped: 0 })
  assert.deepEqual(passwordRows('url,username,password\nhttps://example.org, alice ,secret\nfile:///local,x,bad\n\n'),
    { entries: [{ origin: 'https://example.org', username: ' alice ', password: 'secret' }], skipped: 1 })
  assert.equal(passwordRows('url,username,password\n' + 'https://example.org,user,password\n'.repeat(5001)).entries.length, 5001)
  assert.throws(() => passwordRows('url,username,password\nhttps://example.org,user,"secret"extra\n'), /malformed quoted field/)
})

test('address input navigates to web URLs or uses the selected search engine', () => {
  assert.equal(addressToUrl(' example.org/path ', 'google'), 'https://example.org/path')
  assert.equal(addressToUrl('localhost:8234/index', 'google'), 'http://localhost:8234/index')
  assert.equal(addressToUrl('[::1]:8234', 'google'), 'http://[::1]:8234/')
  assert.equal(addressToUrl('bücher.de', 'google'), 'https://xn--bcher-kva.de/')
  assert.equal(addressToUrl('two words & a symbol', 'duckduckgo'), 'https://duckduckgo.com/?q=two%20words%20%26%20a%20symbol')
  assert.equal(addressToUrl('', 'bing'), 'about:blank')
  for (const value of ['file:///etc/hosts', 'javascript:alert(1)', 'data:text/html,%3Ch1%3E', 'https://user:pass@example.org']) {
    assert.equal(webUrl(value), null)
  }
  assert.equal(originOf('https://example.org:443/web?a=1'), 'https://example.org')
  assert.equal(originOf('file:///not-web'), null)
})

test('migrations, literal history search, and saved browser state survive a fresh connection', t => {
  const dir = mkdtempSync(join(tmpdir(), 'lexn-unit-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const path = join(dir, 'data.sqlite')
  const db = new Database(path)
  const starters = db.all('SELECT id, name FROM workspaces ORDER BY rowid')
  assert.deepEqual(starters.map(row => row.name), ['Personal', 'Work'])
  assert.deepEqual(starters.map(row => db.settings(row.id).theme), ['black', 'light'])
  assert.equal(db.get('welcomePending', false), true)
  const profile = db.primaryProfile()
  db.setProfileSetting(profile, 'theme', 'light')
  db.run("INSERT INTO bookmark_folders VALUES ('folder', 'Reading', ?)", profile)
  db.run("INSERT INTO bookmarks VALUES ('bookmark', 'Example', 'https://example.org/', 'folder', ?)", profile)
  db.run("INSERT INTO history VALUES ('visit-1', 'https://example.org/', 'example_100%', 50, ?)", profile)
  db.run("INSERT INTO history VALUES ('visit-2', 'https://example.org/', 'New title', 100, ?)", profile)
  db.run("INSERT INTO downloads VALUES ('download', 'File', '/tmp/file', 'https://example.org/', 1, 100, 'progressing', 101, ?)", profile)
  assert.throws(() => db.transaction(() => {
    db.run("INSERT INTO bookmark_folders VALUES ('rollback', 'Temporary', ?)", profile)
    db.run("INSERT INTO bookmarks VALUES ('broken', 'Example', 'https://example.org/', 'missing', ?)", profile)
  }))
  db.close()

  const reopened = new Database(path)
  try {
    assert.equal(reopened.settings(profile).theme, 'light')
    assert.equal(reopened.one('SELECT folderId FROM bookmarks').folderId, 'folder')
    assert.equal(reopened.history('_100%')[0].id, 'visit-1')
    assert.equal(reopened.frequent()[0].visits, 2)
    assert.equal(reopened.frequent()[0].title, 'New title')
    assert.equal(reopened.one('SELECT state FROM downloads').state, 'interrupted')
    assert.equal(reopened.one('SELECT * FROM bookmark_folders WHERE id = ?', 'rollback'), undefined)
  } finally {
    reopened.close()
  }
})

test('v1 shared data migrates to the first profile without changing the active profile', t => {
  const dir = mkdtempSync(join(tmpdir(), 'lexn-migration-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const path = join(dir, 'legacy.sqlite')
  const legacy = new DatabaseSync(path)
  legacy.exec(`
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    INSERT INTO settings VALUES ('workspaceId', '"work"'), ('theme', '"light"');
    CREATE TABLE workspaces (id TEXT PRIMARY KEY, name TEXT, accent TEXT, activeTab TEXT);
    INSERT INTO workspaces VALUES ('personal', 'Home', '#b5a2ff', NULL), ('work', 'Work', '#72e3ba', NULL);
    CREATE TABLE tabs (id TEXT PRIMARY KEY);
    INSERT INTO tabs VALUES ('previous-tab');
    CREATE TABLE tab_groups (id TEXT PRIMARY KEY);
    CREATE TABLE bookmark_folders (id TEXT PRIMARY KEY, name TEXT);
    INSERT INTO bookmark_folders VALUES ('folder', 'Reading');
    CREATE TABLE bookmarks (id TEXT PRIMARY KEY, title TEXT, url TEXT, folderId TEXT);
    INSERT INTO bookmarks VALUES ('bookmark', 'Example', 'https://example.org/', 'folder');
    CREATE TABLE history (id TEXT PRIMARY KEY, title TEXT, url TEXT, visitedAt INTEGER);
    INSERT INTO history VALUES ('visit', 'Example', 'https://example.org/', 1);
    CREATE TABLE downloads (id TEXT PRIMARY KEY, state TEXT);
    INSERT INTO downloads VALUES ('download', 'progressing');
    CREATE TABLE site_permissions (origin TEXT, permission TEXT, allow INTEGER);
    INSERT INTO site_permissions VALUES ('https://example.org', 'notifications', 1);
    PRAGMA user_version = 1;
  `)
  legacy.close()
  const db = new Database(path)
  try {
    assert.equal(db.get('workspaceId', ''), 'work')
    assert.equal(db.primaryProfile(), 'personal')
    assert.ok(db.one('SELECT lastUsed FROM tabs').lastUsed > 0)
    assert.equal(db.one('SELECT COUNT(*) AS count FROM favorites WHERE profileId = ?', 'personal').count, 8)
    assert.equal(db.one('SELECT COUNT(*) AS count FROM favorites WHERE profileId = ?', 'work').count, 8)
    assert.equal(db.settings('personal').theme, 'light')
    assert.equal(db.settings('work').theme, 'dark')
    assert.equal(db.get('welcomePending', false), false)
    assert.equal(db.history('Example', 'personal')[0].id, 'visit')
    assert.deepEqual(db.history('Example', 'work'), [])
    for (const table of ['bookmarks', 'bookmark_folders', 'downloads', 'profile_permissions']) {
      assert.equal(db.one('SELECT workspaceId FROM ' + table).workspaceId, 'personal')
    }
    assert.equal(db.one('SELECT state FROM downloads').state, 'interrupted')
  } finally {
    db.close()
  }
})

test('the active Space’s Profile supplies a shared sidebar pin and width on upgrade', t => {
  const dir = mkdtempSync(join(tmpdir(), 'drew-sidebar-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const path = join(dir, 'sidebar.sqlite')
  const legacy = new Database(path)
  const personal = legacy.primaryProfile()
  const work = legacy.one("SELECT id FROM workspaces WHERE name = 'Work'").id
  legacy.setProfileSetting(personal, 'keepSidebarOpen', false)
  legacy.setProfileSetting(personal, 'sidebarWidth', '292')
  legacy.setProfileSetting(personal, 'theme', 'dark')
  legacy.setProfileSetting(work, 'keepSidebarOpen', true)
  legacy.setProfileSetting(work, 'sidebarWidth', '334')
  legacy.setProfileSetting(work, 'theme', 'slate')
  legacy.addWorkspace('work-space', 'Project', '#abc123', work, '')
  legacy.set('workspaceId', 'work-space')
  legacy.run('PRAGMA user_version = 5')
  legacy.close()

  const upgraded = new Database(path)
  try {
    for (const profile of [personal, work]) {
      assert.equal(upgraded.settings(profile).keepSidebarOpen, true)
      assert.equal(upgraded.settings(profile).sidebarWidth, '334')
    }
    assert.equal(upgraded.settings(work).theme, 'slate')
    assert.equal(upgraded.settings(personal).theme, 'dark')
    upgraded.set('keepSidebarOpen', false)
    upgraded.set('sidebarWidth', '300')
    assert.equal(upgraded.settings(work).keepSidebarOpen, false)
    assert.equal(upgraded.settings(personal).sidebarWidth, '300')
  } finally {
    upgraded.close()
  }
})
