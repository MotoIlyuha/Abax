import { tutorSchema } from './tutor-schema';
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
  /** Персональный курсор (миграция V2). */
  cursor_id: string;
  /** Имя задал сам пользователь: вход через провайдера его не перезаписывает. */
  name_custom: number;
  email: string | null;
  google_sub: string | null;
  /** Подтверждённый адрес Google (миграция V3): по нему находятся приглашения по почте. */
  google_email: string | null;
  /** Свой аватар (миграция V6): смайл или фото data:image (src/avatar-value.ts); null — буквы. */
  avatar: string | null;
  /** Действующий тариф — пробный период (миграция V8). */
  plan_trial: number;
  /** Когда взят пробный период; null — ещё не брали (один раз на аккаунт). */
  trial_used_at: number | null;
}

/** Платёж за подписку или пробный период (server/billing.ts). */
export interface PaymentRow {
  id: string;
  user_id: string;
  plan: string;
  period: string | null;
  days: number;
  amount: number;
  status: string;
  provider: string;
  created_at: number;
}

/** Промокод: тариф на столько-то дней, не больше max_uses активаций (null — без ограничения). */
export interface PromoCodeRow {
  code: string;
  plan: string;
  days: number;
  max_uses: number | null;
  uses: number;
  expires_at: number | null;
  created_at: number;
  disabled_at: number | null;
}

export interface PromoRedemptionRow {
  user_id: string;
  code: string;
  plan: string;
  days: number;
  redeemed_at: number;
}

/** Код входа по почте (хранится только хеш). */
export interface EmailCodeRow {
  email: string;
  code_hash: string;
  expires_at: number;
  attempts: number;
  created_at: number;
}

/** Поток входа через провайдера с переходом на его сайт (Google, Telegram, dev). */
export interface AuthFlowRow {
  id: string;
  secret_hash: string;
  provider: string;
  mode: string;
  user_id: string | null;
  return_to: string;
  code_verifier: string | null;
  result_user_id: string | null;
  error: string | null;
  created_at: number;
  expires_at: number;
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
  /** 'link' — ссылка проекта, 'email' — персональное приглашение по почте (миграция V3). */
  kind: string;
  /** Пауза общей ссылки (миграция V4): не NULL — ссылка выключена, токен сохраняется. */
  disabled_at: number | null;
  /** Последний вход по приглашению (миграция V4). */
  last_used_at: number | null;
}

/** Именной адрес доски /j/<адрес> (миграция V4, SPEC_NIGHT6 §5.3). */
export interface AliasRow {
  alias: string;
  /** NULL — доска удалена из базы. */
  project_id: string | null;
  /** NULL — аккаунт удалён: адрес — надгробие навсегда. */
  owner_id: string | null;
  /** 'active' — адрес доски, 'former' — бывший (ведёт туда же), 'released' — освобождён (никуда не ведёт). */
  state: string;
  /** Когда адрес занят впервые (переезд на другую доску владельца и повторное занятие дату не меняют). */
  created_at: number;
  updated_at: number;
  /** Блокировка модератором (миграция V5): не NULL — адрес никуда не ведёт и его не может занять никто, даже владелец. */
  blocked_at: number | null;
  /** Причина блокировки — для модератора, пользователям не показывается. */
  blocked_reason: string | null;
}

/** Приглашение по почте (миграция V3); доступ — по токену своей строки invites. */
export interface EmailInviteRow {
  id: string;
  project_id: string;
  host_user_id: string;
  email: string;
  role: string;
  token: string;
  status: string;
  created_at: number;
  updated_at: number;
  /** Когда письмо отправлено в последний раз (повтор — не чаще раза в 10 минут). */
  mailed_at: number | null;
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

/** Ночь №4: профиль (курсор, своё имя), почта и Google, коды входа по почте и потоки входа через провайдера. */
const SCHEMA_V2 = `
ALTER TABLE users ADD COLUMN cursor_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE users ADD COLUMN name_custom INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN email TEXT;
ALTER TABLE users ADD COLUMN google_sub TEXT;
CREATE UNIQUE INDEX idx_users_email ON users(email);
CREATE UNIQUE INDEX idx_users_google ON users(google_sub);

CREATE TABLE email_codes (
  email TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE auth_flows (
  id TEXT PRIMARY KEY,
  secret_hash TEXT NOT NULL,
  provider TEXT NOT NULL,
  mode TEXT NOT NULL,
  user_id TEXT,
  return_to TEXT NOT NULL,
  code_verifier TEXT,
  result_user_id TEXT,
  error TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
`;

/** Ночь №5: вид приглашения, подтверждённый адрес Google, приглашения по почте. */
const SCHEMA_V3 = `
ALTER TABLE invites ADD COLUMN kind TEXT NOT NULL DEFAULT 'link';
ALTER TABLE users ADD COLUMN google_email TEXT;
CREATE INDEX idx_users_google_email ON users(google_email);

CREATE TABLE project_email_invites (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  host_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE REFERENCES invites(token),
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  mailed_at INTEGER
);
CREATE UNIQUE INDEX idx_email_invites_project_email ON project_email_invites(project_id, email);
CREATE INDEX idx_email_invites_email ON project_email_invites(email, status);
`;

/** Ночь №6: пауза и последний вход приглашения, именные адреса досок. */
const SCHEMA_V4 = `
ALTER TABLE invites ADD COLUMN disabled_at INTEGER;
ALTER TABLE invites ADD COLUMN last_used_at INTEGER;

CREATE TABLE public_aliases (
  alias TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  owner_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  state TEXT NOT NULL DEFAULT 'active',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_aliases_project ON public_aliases(project_id, state);
CREATE INDEX idx_aliases_owner ON public_aliases(owner_id);
`;

/**
 * Модерация именных адресов: блокировка (с сохранением состояния — снятие возвращает как было) и очередь
 * свежих адресов по дате создания. Кто занял — owner_id, когда — created_at (см. listAliasesForModeration).
 */
const SCHEMA_V5 = `
ALTER TABLE public_aliases ADD COLUMN blocked_at INTEGER;
ALTER TABLE public_aliases ADD COLUMN blocked_reason TEXT;
CREATE INDEX idx_aliases_created ON public_aliases(created_at);
`;

/** Свой аватар пользователя: смайл или фото, обрезанное под круг (null — буквы имени). */
const SCHEMA_V6 = `
ALTER TABLE users ADD COLUMN avatar TEXT;
`;

/**
 * Личные права участника на страницы доски (меню аватара «Настройки доступа»): за пользователем, а не за ссылкой —
 * переживают перезаход и действуют поверх роли его приглашения. Строка удаляется вместе с доской или пользователем.
 */
const SCHEMA_V7 = `
CREATE TABLE member_page_rights (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  page_rights_json TEXT NOT NULL DEFAULT '{}',
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (project_id, user_id)
);
`;

/**
 * Подписка: пробный период (один раз на аккаунт), история платежей, промокоды и их активации.
 * Один промокод один аккаунт активирует один раз (PRIMARY KEY активации).
 */
const SCHEMA_V8 = `
ALTER TABLE users ADD COLUMN plan_trial INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN trial_used_at INTEGER;

CREATE TABLE payments (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan TEXT NOT NULL,
  period TEXT,
  days INTEGER NOT NULL,
  amount INTEGER NOT NULL,
  status TEXT NOT NULL,
  provider TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_payments_user ON payments(user_id, created_at);

CREATE TABLE promo_codes (
  code TEXT PRIMARY KEY,
  plan TEXT NOT NULL,
  days INTEGER NOT NULL,
  max_uses INTEGER,
  uses INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE promo_redemptions (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  plan TEXT NOT NULL,
  days INTEGER NOT NULL,
  redeemed_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, code)
);
`;

/** Миграции по порядку; номер версии хранится в PRAGMA user_version. */
const SCHEMA_V9 = `
CREATE TABLE yookassa_checkouts (
  payment_id TEXT PRIMARY KEY REFERENCES payments(id) ON DELETE CASCADE,
  provider_id TEXT UNIQUE,
  request_json TEXT NOT NULL,
  confirmation_url TEXT
);
`;

const SCHEMA_V10 = `
ALTER TABLE promo_codes ADD COLUMN disabled_at INTEGER;
ALTER TABLE payments ADD COLUMN resolved_at INTEGER;

CREATE TABLE admin_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE INDEX idx_admin_sessions_expires ON admin_sessions(expires_at);

CREATE TABLE admin_audit (
  id INTEGER PRIMARY KEY,
  admin_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  operation TEXT NOT NULL,
  object_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  change_json TEXT NOT NULL
);
CREATE INDEX idx_admin_audit_operation ON admin_audit(operation, id);
CREATE INDEX idx_admin_audit_admin ON admin_audit(admin_id, id);
`;

const MIGRATIONS: string[] = [SCHEMA_V1, SCHEMA_V2, SCHEMA_V3, SCHEMA_V4, SCHEMA_V5, SCHEMA_V6, SCHEMA_V7, SCHEMA_V8, SCHEMA_V9, SCHEMA_V10, tutorSchema,
  'ALTER TABLE tutor_lessons ADD COLUMN removed_at INTEGER'];

/** target — до какой версии (по умолчанию — до последней; меньше — только в тестах миграций). */
export function migrate(db: Db, target = MIGRATIONS.length): void {
  const current = db.pragma('user_version', { simple: true }) as number;
  for (let v = current; v < Math.min(target, MIGRATIONS.length); v++) {
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
