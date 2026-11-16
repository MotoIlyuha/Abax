import { createHash, randomUUID } from 'node:crypto';
import type { PlanTier } from '../src/types';
import { PLAN_LIMITS, isPlanTier } from '../src/limits';
import type { Db, UserRow } from './db';

export const sha256Hex = (s: string): string => createHash('sha256').update(s).digest('hex');

/** Тариф с учётом срока: истёк plan_expires_at — free. */
export function effectivePlan(user: UserRow, now: number): PlanTier {
  if (user.plan_expires_at !== null && user.plan_expires_at <= now) return 'free';
  return isPlanTier(user.plan) ? user.plan : 'free';
}

const finite = (n: number): number | null => (Number.isFinite(n) ? n : null);

/** Возможности тарифа в виде, который видит клиент; null — без ограничений. */
export function limitsFor(plan: PlanTier) {
  const l = PLAN_LIMITS[plan];
  return {
    maxProjects: finite(l.maxProjects),
    maxPagesPerProject: finite(l.maxPagesPerProject),
    maxRoomGuests: finite(l.maxP2PGuests),
    canForbidClone: l.canProtectClone,
    canDisableCopy: l.canProtectCopy,
  };
}

export function userInfo(user: UserRow, now: number) {
  return {
    id: user.id,
    displayName: user.display_name,
    tgUsername: user.tg_username,
    avatarUrl: user.avatar_url,
    isAnonymous: user.tg_id === null,
    plan: effectivePlan(user, now),
  };
}

/** Ответ /api/me и входа: пользователь, эффективный тариф и его лимиты. */
export function meResponse(user: UserRow, now: number, enforce: boolean) {
  const plan = effectivePlan(user, now);
  return {
    user: userInfo(user, now),
    plan,
    planExpiresAt: user.plan_expires_at,
    limitsEnforced: enforce,
    limits: limitsFor(plan),
  };
}

export function getUser(db: Db, id: string): UserRow | null {
  return (db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined) ?? null;
}

export function findByDevice(db: Db, deviceTokenHash: string): UserRow | null {
  return (db.prepare('SELECT * FROM users WHERE device_token_hash = ?').get(deviceTokenHash) as UserRow | undefined) ?? null;
}

export function findByTelegram(db: Db, tgId: string): UserRow | null {
  return (db.prepare('SELECT * FROM users WHERE tg_id = ?').get(tgId) as UserRow | undefined) ?? null;
}

export function createUser(db: Db, now: number, fields: Partial<Pick<UserRow, 'tg_id' | 'tg_username' | 'display_name' | 'avatar_url' | 'device_token_hash'>> = {}): UserRow {
  const id = randomUUID();
  db.prepare(`INSERT INTO users (id, tg_id, tg_username, display_name, avatar_url, device_token_hash, plan, plan_expires_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'free', NULL, ?, ?)`)
    .run(id, fields.tg_id ?? null, fields.tg_username ?? null, fields.display_name ?? 'Гость', fields.avatar_url ?? null, fields.device_token_hash ?? null, now, now);
  return getUser(db, id)!;
}

/**
 * Слияние аккаунтов: всё, что принадлежало анониму (проекты, приглашения, ассеты, авторство ревизий),
 * переходит к целевому пользователю одной транзакцией; запись анонима удаляется, а привязка его устройства
 * переходит к целевому, если у того своей нет.
 */
export function mergeUsers(db: Db, fromId: string, toId: string, now: number): void {
  if (fromId === toId) return;
  db.transaction(() => {
    const from = getUser(db, fromId);
    if (!from) return;
    const hash = from.device_token_hash;
    db.prepare('UPDATE users SET device_token_hash = NULL WHERE id = ?').run(fromId);
    db.prepare('UPDATE projects SET owner_id = ? WHERE owner_id = ?').run(toId, fromId);
    db.prepare('UPDATE invites SET created_by = ? WHERE created_by = ?').run(toId, fromId);
    db.prepare('UPDATE assets SET uploaded_by = ? WHERE uploaded_by = ?').run(toId, fromId);
    db.prepare('UPDATE project_revisions SET author_id = ? WHERE author_id = ?').run(toId, fromId);
    db.prepare('DELETE FROM users WHERE id = ?').run(fromId);
    if (hash) db.prepare('UPDATE users SET device_token_hash = ?, updated_at = ? WHERE id = ? AND device_token_hash IS NULL').run(hash, now, toId);
  })();
}

/** Назначить тариф (выдаёт оператор: пока нет платежей); days — срок в днях, без него — бессрочно. */
export function setUserPlanRow(db: Db, userId: string, plan: PlanTier, now: number, days?: number): boolean {
  const expires = days !== undefined && days > 0 ? now + days * 24 * 3600 * 1000 : null;
  return db.prepare('UPDATE users SET plan = ?, plan_expires_at = ?, updated_at = ? WHERE id = ?').run(plan, expires, now, userId).changes > 0;
}
