import { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import { accents, defaultSettings, type Settings, type Visit } from '../../shared/model.js'

const starterFavorites = [
  ['google', 'https://www.google.com/', 'Google'], ['youtube', 'https://www.youtube.com/', 'YouTube'],
  ['github', 'https://github.com/', 'GitHub'], ['wikipedia', 'https://www.wikipedia.org/', 'Wikipedia'],
  ['mail', 'https://mail.google.com/', 'Mail'], ['calendar', 'https://calendar.google.com/', 'Calendar'],
  ['drive', 'https://drive.google.com/', 'Drive'], ['music', 'https://open.spotify.com/', 'Music'],
] as const

const migrations = [
  `
  CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE workspaces (id TEXT PRIMARY KEY, name TEXT NOT NULL, accent TEXT NOT NULL, activeTab TEXT);
  CREATE TABLE tab_groups (id TEXT PRIMARY KEY, workspaceId TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, name TEXT NOT NULL);
  CREATE TABLE tabs (
    id TEXT PRIMARY KEY, workspaceId TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    url TEXT NOT NULL, title TEXT NOT NULL, favicon TEXT, pinned INTEGER NOT NULL CHECK(pinned IN (0,1)),
    groupId TEXT REFERENCES tab_groups(id) ON DELETE SET NULL, position INTEGER NOT NULL
  );
  CREATE INDEX tabs_workspace ON tabs(workspaceId, position);
  CREATE TABLE bookmark_folders (id TEXT PRIMARY KEY, name TEXT NOT NULL);
  CREATE TABLE bookmarks (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, url TEXT NOT NULL,
    folderId TEXT REFERENCES bookmark_folders(id) ON DELETE SET NULL
  );
  CREATE INDEX bookmarks_url ON bookmarks(url);
  CREATE TABLE history (id TEXT PRIMARY KEY, url TEXT NOT NULL, title TEXT NOT NULL, visitedAt INTEGER NOT NULL);
  CREATE INDEX history_time ON history(visitedAt DESC);
  CREATE INDEX history_url ON history(url, visitedAt DESC);
  CREATE TABLE downloads (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, path TEXT NOT NULL, url TEXT NOT NULL,
    received INTEGER NOT NULL, total INTEGER NOT NULL, state TEXT NOT NULL, createdAt INTEGER NOT NULL
  );
  CREATE TABLE site_permissions (
    origin TEXT NOT NULL, permission TEXT NOT NULL, allow INTEGER NOT NULL CHECK(allow IN (0,1)),
    PRIMARY KEY (origin, permission)
  );
  `,
  `
  ALTER TABLE bookmarks ADD COLUMN workspaceId TEXT REFERENCES workspaces(id);
  ALTER TABLE bookmark_folders ADD COLUMN workspaceId TEXT REFERENCES workspaces(id);
  ALTER TABLE history ADD COLUMN workspaceId TEXT REFERENCES workspaces(id);
  ALTER TABLE downloads ADD COLUMN workspaceId TEXT REFERENCES workspaces(id);
  UPDATE bookmarks SET workspaceId = (SELECT id FROM workspaces ORDER BY rowid LIMIT 1);
  UPDATE bookmark_folders SET workspaceId = (SELECT id FROM workspaces ORDER BY rowid LIMIT 1);
  UPDATE history SET workspaceId = (SELECT id FROM workspaces ORDER BY rowid LIMIT 1);
  UPDATE downloads SET workspaceId = (SELECT id FROM workspaces ORDER BY rowid LIMIT 1);
  CREATE INDEX history_workspace_time ON history(workspaceId, visitedAt DESC);
  CREATE INDEX history_workspace_url ON history(workspaceId, url, visitedAt DESC);
  CREATE TABLE profile_permissions (
    workspaceId TEXT NOT NULL REFERENCES workspaces(id),
    origin TEXT NOT NULL, permission TEXT NOT NULL, allow INTEGER NOT NULL CHECK(allow IN (0,1)),
    PRIMARY KEY (workspaceId, origin, permission)
  );
  INSERT INTO profile_permissions
    SELECT workspaces.id, origin, permission, allow FROM site_permissions
    JOIN workspaces ON workspaces.rowid = (SELECT MIN(rowid) FROM workspaces);
  DROP TABLE site_permissions;
  `,

  `
  ALTER TABLE workspaces ADD COLUMN profileId TEXT REFERENCES workspaces(id);
  ALTER TABLE workspaces ADD COLUMN icon TEXT NOT NULL DEFAULT '';
  ALTER TABLE tab_groups ADD COLUMN parentId TEXT REFERENCES tab_groups(id) ON DELETE SET NULL;
  ALTER TABLE tabs ADD COLUMN lastUsed INTEGER NOT NULL DEFAULT 0;
  UPDATE tabs SET lastUsed = CAST(strftime('%s','now') AS INTEGER) * 1000;
  CREATE TABLE saved_logins (
    id TEXT PRIMARY KEY, profileId TEXT NOT NULL REFERENCES workspaces(id),
    origin TEXT NOT NULL, username TEXT NOT NULL, encrypted TEXT NOT NULL,
    UNIQUE(profileId, origin, username)
  );
  CREATE TABLE favorites (id TEXT PRIMARY KEY, url TEXT NOT NULL UNIQUE, title TEXT NOT NULL, favicon TEXT);
  CREATE TABLE archived_tabs (
    id TEXT PRIMARY KEY, workspaceId TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    url TEXT NOT NULL, title TEXT NOT NULL, archivedAt INTEGER NOT NULL
  );
  INSERT INTO favorites VALUES
    ('google','https://www.google.com/','Google',NULL),
    ('youtube','https://www.youtube.com/','YouTube',NULL),
    ('github','https://github.com/','GitHub',NULL),
    ('wikipedia','https://www.wikipedia.org/','Wikipedia',NULL),
    ('mail','https://mail.google.com/','Mail',NULL),
    ('calendar','https://calendar.google.com/','Calendar',NULL),
    ('drive','https://drive.google.com/','Drive',NULL),
    ('music','https://open.spotify.com/','Music',NULL);
  `,

  `
  ALTER TABLE favorites ADD COLUMN position INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE favorites ADD COLUMN icon TEXT NOT NULL DEFAULT '';
  UPDATE favorites SET position = rowid;
  `,

  `
  CREATE TABLE profile_settings (
    profileId TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    PRIMARY KEY (profileId, key)
  );
  INSERT INTO profile_settings
    SELECT (SELECT id FROM workspaces WHERE profileId IS NULL ORDER BY rowid LIMIT 1), key, value
    FROM settings WHERE key IN (${Object.keys(defaultSettings).map(key => "'" + key + "'").join(', ')})
      AND EXISTS (SELECT 1 FROM workspaces WHERE profileId IS NULL);
  ALTER TABLE favorites RENAME TO global_favorites;
  CREATE TABLE favorites (
    profileId TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    id TEXT NOT NULL, url TEXT NOT NULL, title TEXT NOT NULL, favicon TEXT,
    position INTEGER NOT NULL, icon TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (profileId, id),
    UNIQUE (profileId, url)
  );
  INSERT INTO favorites
    SELECT (SELECT id FROM workspaces WHERE profileId IS NULL ORDER BY rowid LIMIT 1), id, url, title, favicon, position, icon
    FROM global_favorites WHERE EXISTS (SELECT 1 FROM workspaces WHERE profileId IS NULL);
  DROP TABLE global_favorites;
  `,

  `
  WITH active_profile AS (
    SELECT COALESCE(profileId, id) AS id FROM workspaces
    ORDER BY (json_quote(workspaces.id) = (SELECT value FROM settings WHERE key = 'workspaceId')) DESC, rowid
    LIMIT 1
  ), sidebar_defaults(key, value) AS (
    VALUES ('keepSidebarOpen', '${JSON.stringify(defaultSettings.keepSidebarOpen)}'),
           ('sidebarWidth', '${JSON.stringify(defaultSettings.sidebarWidth)}')
  )
  INSERT INTO settings
    SELECT defaults.key, COALESCE(profile_settings.value, defaults.value)
    FROM active_profile CROSS JOIN sidebar_defaults AS defaults
    LEFT JOIN profile_settings ON profile_settings.profileId = active_profile.id AND profile_settings.key = defaults.key
    WHERE true
    ON CONFLICT(key) DO UPDATE SET value = excluded.value;
  `,
]

type Value = string | number | null

export class Database {
  private db: DatabaseSync

  constructor(path: string) {
    this.db = new DatabaseSync(path)
    try {
      this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 2500;')
      const version = this.one<{ user_version: number }>('PRAGMA user_version')?.user_version ?? 0
      if (version > migrations.length) throw new Error('This profile requires a newer version of Drew.')
      for (let index = version; index < migrations.length; index++) {
        this.transaction(() => {
          this.db.exec(migrations[index] + 'PRAGMA user_version = ' + (index + 1))
          if (index === 4) {
            const profiles = this.all<{ id: string }>('SELECT id FROM workspaces WHERE profileId IS NULL ORDER BY rowid')
            profiles.slice(1).forEach(profile => this.seedFavorites(profile.id))
          }
        })
      }
      this.transaction(() => {
        if (!this.one('SELECT id FROM workspaces LIMIT 1')) {
          for (const [index, name] of ['Personal', 'Work', 'Study'].entries()) {
            this.addWorkspace(randomUUID(), name, accents[index], null, '')
          }
        }
        this.run("UPDATE downloads SET state = 'interrupted' WHERE state = 'progressing'")
      })
    } catch (error) {
      this.db.close()
      throw error
    }
  }

  all<T>(sql: string, ...values: Value[]): T[] {
    return this.db.prepare(sql).all(...values) as T[]
  }

  one<T>(sql: string, ...values: Value[]): T | undefined {
    return this.db.prepare(sql).get(...values) as T | undefined
  }

  run(sql: string, ...values: Value[]) {
    return this.db.prepare(sql).run(...values)
  }

  transaction<T>(work: () => T): T {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const result = work()
      this.db.exec('COMMIT')
      return result
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  get<T>(key: string, fallback: T): T {
    const row = this.one<{ value: string }>('SELECT value FROM settings WHERE key = ?', key)
    if (!row) return fallback
    try {
      const parsed = JSON.parse(row.value)
      return typeof parsed === typeof fallback ? parsed as T : fallback
    } catch {
      return fallback
    }
  }

  set(key: string, value: boolean | string) {
    this.run('INSERT INTO settings VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, JSON.stringify(value))
  }

  settings(profile: string): Settings {
    const entries = this.all<{ key: string; value: string }>('SELECT key, value FROM profile_settings WHERE profileId = ?', profile)
    const overrides = entries.flatMap(({ key, value }) => {
      if (!Object.hasOwn(defaultSettings, key)) return []
      try {
        const parsed: unknown = JSON.parse(value)
        return typeof parsed === typeof defaultSettings[key as keyof Settings] ? [[key, parsed]] : []
      } catch {
        return []
      }
    })
    return {
      ...defaultSettings,
      ...Object.fromEntries(overrides),
      keepSidebarOpen: this.get('keepSidebarOpen', defaultSettings.keepSidebarOpen),
      sidebarWidth: this.get('sidebarWidth', defaultSettings.sidebarWidth),
    }
  }

  setProfileSetting(profile: string, key: keyof Settings, value: boolean | string) {
    this.run(`INSERT INTO profile_settings VALUES (?, ?, ?)
      ON CONFLICT(profileId, key) DO UPDATE SET value = excluded.value`, profile, key, JSON.stringify(value))
  }

  addWorkspace(id: string, name: string, accent: string, profile: string | null, icon: string) {
    this.run('INSERT INTO workspaces (id, name, accent, activeTab, profileId, icon) VALUES (?, ?, ?, NULL, ?, ?)',
      id, name, accent, profile, icon)
    if (!profile) this.seedFavorites(id)
  }

  private seedFavorites(profile: string) {
    starterFavorites.forEach(([id, url, title], position) => {
      this.run('INSERT INTO favorites (profileId, id, url, title, position) VALUES (?, ?, ?, ?, ?)',
        profile, id, url, title, position)
    })
  }

  primaryProfile() { return this.one<{ id: string }>('SELECT id FROM workspaces ORDER BY rowid LIMIT 1')!.id }

  history(query: string, profile = this.primaryProfile()) {
    const pattern = '%' + query.replace(/[\\%_]/g, '\\$&') + '%'
    return this.all<Visit>(
      "SELECT * FROM history WHERE workspaceId = ? AND (title LIKE ? ESCAPE '\\' OR url LIKE ? ESCAPE '\\' ) ORDER BY visitedAt DESC LIMIT 250",
      profile, pattern, pattern,
    )
  }

  frequent(profile = this.primaryProfile()) {
    return this.all<Visit>(`
      WITH ranked AS (
        SELECT *, COUNT(*) OVER (PARTITION BY url) AS visits,
          ROW_NUMBER() OVER (PARTITION BY url ORDER BY visitedAt DESC, rowid DESC) AS rank
        FROM history WHERE workspaceId = ?
      )
      SELECT id, url, title, visitedAt, visits FROM ranked WHERE rank = 1
      ORDER BY visits DESC, visitedAt DESC LIMIT 6
    `, profile)
  }

  close() { this.db.close() }
}
