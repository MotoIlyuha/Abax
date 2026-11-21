import type { Db, UserRow } from './db';
import { HttpError } from './router';
import { createUser, getUser, isAnonymousUser, mergeUsers } from './users';

// Способы входа (почта, Telegram, Google): вход и привязка к текущему аккаунту (SPEC_NIGHT4 §7.1).

export type IdentityProvider = 'email' | 'telegram' | 'google';
export type AuthMode = 'login' | 'link';

export const isAuthMode = (v: unknown): v is AuthMode => v === 'login' || v === 'link';

/** Что провайдер сообщил о пользователе. */
export interface Identity {
  provider: IdentityProvider;
  /** Почта (в нижнем регистре), id Telegram или sub Google. */
  subject: string;
  /** Имя у провайдера: ставится, только если пользователь не задавал своё. */
  displayName?: string;
  tgUsername?: string | null;
  avatarUrl?: string | null;
  /** Google: подтверждённый адрес (email_verified) — по нему находятся приглашения по почте; null — не подтверждён. */
  verifiedEmail?: string | null;
}

const COLUMN: Record<IdentityProvider, 'email' | 'tg_id' | 'google_sub'> = { email: 'email', telegram: 'tg_id', google: 'google_sub' };

export function findByIdentity(db: Db, provider: IdentityProvider, subject: string): UserRow | null {
  return (db.prepare(`SELECT * FROM users WHERE ${COLUMN[provider]} = ?`).get(subject) as UserRow | undefined) ?? null;
}

/** Записать способ входа и данные профиля провайдера пользователю. */
function assign(db: Db, user: UserRow, id: Identity, now: number): void {
  db.prepare(`UPDATE users SET ${COLUMN[id.provider]} = ?, updated_at = ? WHERE id = ?`).run(id.subject, now, user.id);
  refreshProfile(db, user.id, id, now);
}

function refreshProfile(db: Db, userId: string, id: Identity, now: number): void {
  if (id.provider === 'telegram') {
    db.prepare('UPDATE users SET tg_username = ?, avatar_url = ?, updated_at = ? WHERE id = ?').run(id.tgUsername ?? null, id.avatarUrl ?? null, now, userId);
  }
  if (id.provider === 'google' && id.avatarUrl !== undefined) {
    db.prepare('UPDATE users SET avatar_url = ?, updated_at = ? WHERE id = ?').run(id.avatarUrl, now, userId);
  }
  if (id.provider === 'google' && id.verifiedEmail !== undefined) {
    db.prepare('UPDATE users SET google_email = ?, updated_at = ? WHERE id = ?').run(id.verifiedEmail, now, userId);
  }
  if (id.displayName) {
    db.prepare('UPDATE users SET display_name = ?, updated_at = ? WHERE id = ? AND name_custom = 0').run(id.displayName, now, userId);
  }
}

/**
 * Вход или привязка.
 * link: нужна сессия; способ у другого пользователя — 409 identity-taken; иначе он записывается текущему.
 * login: способ уже есть у X — текущий аноним сливается в X; нет — аноним получает способ «на месте»;
 * без сессии (или текущий — не аноним) создаётся новый пользователь.
 */
export function resolveIdentity(db: Db, id: Identity, mode: AuthMode, current: UserRow | null, now: number): UserRow {
  const existing = findByIdentity(db, id.provider, id.subject);
  if (mode === 'link') {
    if (!current) throw new HttpError(401, 'unauthorized');
    if (existing && existing.id !== current.id) throw new HttpError(409, 'identity-taken');
    if (existing) refreshProfile(db, current.id, id, now);
    else assign(db, current, id, now);
    return getUser(db, current.id)!;
  }
  if (existing) {
    if (current && current.id !== existing.id && isAnonymousUser(current)) mergeUsers(db, current.id, existing.id, now);
    refreshProfile(db, existing.id, id, now);
    return getUser(db, existing.id)!;
  }
  if (current && isAnonymousUser(current)) {
    assign(db, current, id, now);
    return getUser(db, current.id)!;
  }
  const created = createUser(db, now);
  assign(db, created, id, now);
  return getUser(db, created.id)!;
}
