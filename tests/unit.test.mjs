import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { addressToUrl, originOf, webUrl } from '../out/shared/navigation.js'
import { Database } from '../out/electron/main/database.js'

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
  assert.deepEqual(db.all('SELECT name FROM workspaces ORDER BY rowid').map(row => row.name), ['Personal', 'Work', 'Study'])
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
