import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type Db = Database.Database;

/** Сколько последних ревизий проекта хранится. */
export const MAX_REVISIONS_PER_PROJECT = 200;

export interface UserRow {
  id: string;
  tg_id: string | null;
  tg_username: string | null;
  display_name: string;
  avatar_url: string | null;
  device_token_hash: string | null;
  plan: string;
  plan_expires_at: number | null;
  created_at: number;
  updated_at: number;
}

export interface ProjectRow {
  id: string;
  owner_id: string;
  title: string;
  rev: number;
  data_json: string;
  forbid_clone: number;
  allow_copy: number;
  page_rights_json: string;
  is_deleted: number;
  created_at: number;
  updated_at: number;
}

export interface InviteRow {
  token: string;
  project_id: string;
  created_by: string;
  default_role: string;
  allow_copy: number;
  page_rights_json: string;
  revoked: number;
  expires_at: number | null;
  created_at: number;
}

export interface AssetRow {
  hash: string;
  mime_type: string;
  size_bytes: number;
  storage_backend: string;
  storage_key: string;
  uploaded_by: string | null;
  created_at: number;
}

const SCHEMA_V1 = `
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  tg_id TEXT UNIQUE,
  tg_username TEXT,
  display_name TEXT NOT NULL DEFAULT 'Гость',
  avatar_url TEXT,
  device_token_hash TEXT UNIQUE,
  plan TEXT NOT NULL DEFAULT 'free',
  plan_expires_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  rev INTEGER NOT NULL DEFAULT 1,
  data_json TEXT NOT NULL,
  forbid_clone INTEGER NOT NULL DEFAULT 0,
  allow_copy INTEGER NOT NULL DEFAULT 1,
  page_rights_json TEXT NOT NULL DEFAULT '{}',
  is_deleted INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_projects_owner ON projects(owner_id, is_deleted, updated_at);

CREATE TABLE project_revisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  rev INTEGER NOT NULL,
  page_id TEXT,
  author_id TEXT,
  patch_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(project_id, rev)
);

CREATE TABLE invites (
  token TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  created_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  default_role TEXT NOT NULL DEFAULT 'edit',
  allow_copy INTEGER NOT NULL DEFAULT 1,
  page_rights_json TEXT NOT NULL DEFAULT '{}',
  revoked INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_invites_project ON invites(project_id, revoked);

CREATE TABLE assets (
  hash TEXT PRIMARY KEY,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  storage_backend TEXT NOT NULL DEFAULT 'local',
  storage_key TEXT NOT NULL,
  uploaded_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL
);
`;

/** Миграции по порядку; номер версии хранится в PRAGMA user_version. */
const MIGRATIONS: string[] = [SCHEMA_V1];

export function migrate(db: Db): void {
  const current = db.pragma('user_version', { simple: true }) as number;
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[v]);
      db.pragma(`user_version = ${v + 1}`);
    })();
  }
}

/** Открывает базу (путь к файлу или ':memory:'), включает WAL и внешние ключи, применяет миграции. */
export function openDb(path: string): Db {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}
