import type { PageRight } from '../src/types';
import { isPageRight, PLAN_LIMITS } from '../src/limits';
import { isAliasShaped, isTokenShaped, normalizeRole, participantCaps, type AccessRole, type StoredRole } from '../src/access';
import type { AppContext } from './context';
import type { AliasRow, InviteRow } from './db';
import { effectivePlan, getUser } from './users';

// Ссылки совместной работы: разбор токена или именного адреса и права приглашения (SPEC_NIGHT6 §5.4).
// Один путь для всех мест, где гость предъявляет ссылку: /api/invites/:x, /j/:x, вход в облачную комнату,
// просмотр, патчи и клонирование по ?invite=. Маршруты — в invite-routes.ts и email-invites.ts.

export interface InviteRights {
  /** Что предъявил гость: токен или именной адрес (токен ссылки при входе по адресу не раскрывается). */
  token: string;
  /** Настоящий токен строки invites — только для сервера. */
  linkToken: string;
  projectId: string;
  /** Роль, как хранится (включая старые синонимы edit/view). */
  defaultRole: StoredRole;
  role: AccessRole;
  /** Старая роль edit/view (Ночи №3–5). */
  legacy: boolean;
  allowCopy: boolean;
  pageRights: Record<string, PageRight>;
  kind: 'link' | 'email';
  via: 'token' | 'alias';
  /** Включена ли ссылка (не на паузе). */
  enabled: boolean;
  /** Приглашение по почте этой строки (для «откуда доступ»). */
  emailInviteId?: string;
}

/** Почему ссылка не открылась (все — 404 для прежних клиентов, код — для понятного текста). */
export type InviteFailure = 'invite-not-found' | 'link-paused' | 'alias-released' | 'alias-inactive' | 'board-deleted';

export function parsePageRights(json: string): Record<string, PageRight> {
  try {
    const raw = JSON.parse(json) as unknown;
    const out: Record<string, PageRight> = {};
    if (raw && typeof raw === 'object') for (const [id, r] of Object.entries(raw)) if (isPageRight(r)) out[id] = r;
    return out;
  } catch { return {}; }
}

export function rightsOfInvite(row: InviteRow, presented: string = row.token, via: 'token' | 'alias' = 'token'): InviteRights {
  const stored: StoredRole = (normalizeRole(row.default_role) ? row.default_role : 'edit') as StoredRole;
  const role = normalizeRole(stored)!;
  return {
    token: presented, linkToken: row.token, projectId: row.project_id,
    defaultRole: stored, role: role.role, legacy: role.legacy,
    allowCopy: row.allow_copy !== 0,
    pageRights: parsePageRights(row.page_rights_json),
    kind: row.kind === 'email' ? 'email' : 'link', via,
    enabled: row.disabled_at === null || row.disabled_at === undefined,
  };
}

const projectState = (app: AppContext, id: string | null): { owner_id: string; is_deleted: number } | null =>
  id ? (app.db.prepare('SELECT owner_id, is_deleted FROM projects WHERE id = ?').get(id) as { owner_id: string; is_deleted: number } | undefined) ?? null : null;

const live = (app: AppContext, row: InviteRow) => row.revoked === 0 && (row.expires_at === null || row.expires_at > app.now());

/** Действующая общая ссылка доски (не отозвана, не просрочена; может быть на паузе); null — нет. */
export function linkInviteOf(app: AppContext, projectId: string): InviteRow | null {
  const rows = app.db.prepare("SELECT * FROM invites WHERE project_id = ? AND revoked = 0 AND kind = 'link' ORDER BY created_at DESC").all(projectId) as InviteRow[];
  return rows.find(r => live(app, r)) ?? null;
}

/** Активный именной адрес доски; null — нет. */
export function activeAliasOf(app: AppContext, projectId: string): string | null {
  const row = app.db.prepare("SELECT alias FROM public_aliases WHERE project_id = ? AND state = 'active'").get(projectId) as { alias: string } | undefined;
  return row?.alias ?? null;
}

/**
 * Токен или именной адрес → права приглашения или причина отказа. projectId — если ссылка должна относиться к этой доске.
 * Адрес ведёт на текущую общую ссылку доски (её роль и права); на паузе, без ссылки, на Free или у удалённой доски — отказ.
 */
export function resolveInviteKey(app: AppContext, key: unknown, projectId?: string): { ok: InviteRights } | { error: InviteFailure } {
  if (typeof key !== 'string' || key === '' || key.length > 128) return { error: 'invite-not-found' };
  let rights: InviteRights;
  // сначала — токен (токены Ночей №3–5 и новые — 24 символа; строки другой длины — только старые и тестовые)
  const row = app.db.prepare('SELECT * FROM invites WHERE token = ?').get(key) as InviteRow | undefined;
  if (row || !isAliasShaped(key)) {
    if (!row || !live(app, row)) return { error: 'invite-not-found' };
    const project = projectState(app, row.project_id);
    if (!project || project.is_deleted !== 0) return { error: 'board-deleted' };
    if (row.disabled_at !== null) return { error: 'link-paused' };
    rights = rightsOfInvite(row);
    if (rights.kind === 'email') {
      const ei = app.db.prepare('SELECT id FROM project_email_invites WHERE token = ?').get(row.token) as { id: string } | undefined;
      if (ei) rights.emailInviteId = ei.id;
    }
  } else {
    // именной адрес: ведёт на текущую общую ссылку доски
    const alias = app.db.prepare('SELECT * FROM public_aliases WHERE alias = ?').get(key) as AliasRow | undefined;
    if (!alias) return { error: 'invite-not-found' };
    if (alias.state === 'released' || alias.owner_id === null) return { error: 'alias-released' };
    const project = projectState(app, alias.project_id);
    if (!project || project.is_deleted !== 0) return { error: 'board-deleted' };
    if (app.opts.enforceLimits) {
      const owner = getUser(app.db, project.owner_id);
      if (!owner || !PLAN_LIMITS[effectivePlan(owner, app.now())].canSetAlias) return { error: 'alias-inactive' };
    }
    const link = linkInviteOf(app, alias.project_id!);
    if (!link || link.disabled_at !== null) return { error: 'link-paused' };
    rights = rightsOfInvite(link, key, 'alias');
  }
  if (projectId !== undefined && rights.projectId !== projectId) return { error: 'invite-not-found' };
  return { ok: rights };
}

/** Действующее приглашение по токену или именному адресу; null — нет (причина — resolveInviteKey). */
export function findActiveInvite(app: AppContext, token: unknown, projectId?: string): InviteRights | null {
  const r = resolveInviteKey(app, token, projectId);
  return 'ok' in r ? r.ok : null;
}

/** Последний вход по приглашению: не чаще раза в минуту на токен. */
export function touchInvite(app: AppContext, linkToken: string): void {
  const now = app.now();
  app.db.prepare('UPDATE invites SET last_used_at = ? WHERE token = ? AND (last_used_at IS NULL OR last_used_at < ?)').run(now, linkToken, now - 60_000);
}

/** Форма ключа: токен или именной адрес (для /j/:x). */
export function isInviteKeyShaped(key: string): boolean {
  return isTokenShaped(key) || isAliasShaped(key);
}

/** Может ли гость по этому приглашению копировать (клонирование, просмотр): роль, права доски, запрет ссылки. */
export function inviteCopyAllowed(invite: InviteRights, perms: { allowCopy?: boolean; forbidClone?: boolean }): boolean {
  return participantCaps({ owner: false, role: invite.role, legacy: invite.legacy, inviteAllowCopy: invite.allowCopy }, perms).copy;
}
