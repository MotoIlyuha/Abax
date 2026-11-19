import { randomInt } from 'node:crypto';
import type { PageRight } from '../src/types';
import { isPageRight, PLAN_LIMITS } from '../src/limits';
import { aliasCandidates, isAliasShaped, isTokenShaped, normalizeRole, participantCaps, type AccessRole, type StoredRole } from '../src/access';
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
export type InviteFailure = 'invite-not-found' | 'link-paused' | 'alias-released' | 'alias-blocked' | 'alias-inactive' | 'board-deleted';

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

/** Активный именной адрес доски; null — нет (заблокированный модератором — тоже нет). */
export function activeAliasOf(app: AppContext, projectId: string): string | null {
  const row = app.db.prepare("SELECT alias FROM public_aliases WHERE project_id = ? AND state = 'active' AND blocked_at IS NULL").get(projectId) as { alias: string } | undefined;
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
    if (alias.blocked_at !== null) return { error: 'alias-blocked' };
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
export function findActiveInvite(app: AppContext, token: unknown, projectId?: string, userId?: string | null): InviteRights | null {
  const r = resolveInviteKey(app, token, projectId);
  return 'ok' in r ? withMemberRights(app, r.ok, userId) : null;
}

// ----- Личные права участника (меню аватара «Настройки доступа») -----

/** Личные права пользователя на страницы доски; {} — нет. */
export function memberPageRights(app: AppContext, projectId: string, userId: string): Record<string, PageRight> {
  const row = app.db.prepare('SELECT page_rights_json FROM member_page_rights WHERE project_id = ? AND user_id = ?').get(projectId, userId) as { page_rights_json: string } | undefined;
  return row ? parsePageRights(row.page_rights_json) : {};
}

/** Сохранить личные права пользователя на страницы доски целиком (пустые — строка удаляется). */
export function setMemberPageRights(app: AppContext, projectId: string, userId: string, rights: Record<string, PageRight>): void {
  const clean = parsePageRights(JSON.stringify(rights));
  if (Object.keys(clean).length === 0) {
    app.db.prepare('DELETE FROM member_page_rights WHERE project_id = ? AND user_id = ?').run(projectId, userId);
    return;
  }
  app.db.prepare(`INSERT INTO member_page_rights (project_id, user_id, page_rights_json, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(project_id, user_id) DO UPDATE SET page_rights_json = excluded.page_rights_json, updated_at = excluded.updated_at`)
    .run(projectId, userId, JSON.stringify(clean), app.now());
}

/**
 * Права приглашения с личными правами этого пользователя на страницы (они поверх старых page_rights ссылки).
 * Без пользователя (нет сессии) — как есть: личные права даются только узнаваемому участнику.
 */
export function withMemberRights(app: AppContext, invite: InviteRights, userId: string | null | undefined): InviteRights {
  if (!userId) return invite;
  const own = memberPageRights(app, invite.projectId, userId);
  return Object.keys(own).length ? { ...invite, pageRights: { ...invite.pageRights, ...own } } : invite;
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

// ----- Подсказки и модерация именных адресов -----

/** Сколько свободных похожих адресов предлагать вместо занятого. */
export const ALIAS_SUGGESTIONS = 3;

/**
 * Свободные похожие адреса для base (занятого или короче минимума): ни разу не занятые никем (любая строка public_aliases,
 * в т.ч. освобождённая, бывшая или заблокированная, — уже не свободна). Пусто — подсказать нечего.
 */
export function suggestFreeAliases(app: AppContext, base: string, rnd: (n: number) => number = randomInt): string[] {
  const year = new Date(app.now()).getUTCFullYear();
  const free: string[] = [];
  // кандидаты со случайными цифрами: если все заняты (редко), пробуем ещё раз
  for (let round = 0; round < 3 && free.length < ALIAS_SUGGESTIONS; round++) {
    const cands = aliasCandidates(base, year, rnd).filter(c => !free.includes(c));
    if (cands.length === 0) break;
    const busy = new Set((app.db.prepare(`SELECT alias FROM public_aliases WHERE alias IN (${cands.map(() => '?').join(',')})`)
      .all(...cands) as { alias: string }[]).map(r => r.alias));
    for (const c of cands) if (!busy.has(c) && free.length < ALIAS_SUGGESTIONS) free.push(c);
  }
  return free;
}

/** Строка для модератора: адрес, кто и когда занял, на какую доску ведёт, блокировка. */
export interface AliasModerationRow {
  alias: string;
  state: string;
  ownerId: string | null;
  ownerName: string | null;
  ownerEmail: string | null;
  projectId: string | null;
  projectTitle: string | null;
  createdAt: number;
  updatedAt: number;
  blockedAt: number | null;
  blockedReason: string | null;
}

/**
 * Именные адреса для модерации (будущая админ-панель или скрипт): свежие сначала.
 * since — только занятые с этого момента (мс); owner — только этого аккаунта.
 */
export function listAliasesForModeration(app: AppContext, opts: { since?: number; ownerId?: string; limit?: number } = {}): AliasModerationRow[] {
  const where: string[] = [];
  const args: (string | number)[] = [];
  if (opts.since !== undefined) { where.push('a.created_at >= ?'); args.push(opts.since); }
  if (opts.ownerId !== undefined) { where.push('a.owner_id = ?'); args.push(opts.ownerId); }
  args.push(Math.max(1, Math.min(opts.limit ?? 100, 1000)));
  return app.db.prepare(`
    SELECT a.alias, a.state, a.owner_id AS ownerId, u.display_name AS ownerName, COALESCE(u.email, u.google_email) AS ownerEmail,
           a.project_id AS projectId, p.title AS projectTitle, a.created_at AS createdAt, a.updated_at AS updatedAt,
           a.blocked_at AS blockedAt, a.blocked_reason AS blockedReason
    FROM public_aliases a
    LEFT JOIN users u ON u.id = a.owner_id
    LEFT JOIN projects p ON p.id = a.project_id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY a.created_at DESC, a.alias
    LIMIT ?`).all(...args) as AliasModerationRow[];
}

/**
 * Блокировка адреса модератором: адрес перестаёт вести на доску (гостям — alias-blocked) и не достаётся никому,
 * включая владельца. Состояние и владелец сохраняются — снятие блокировки возвращает всё как было. false — адреса нет.
 */
export function setAliasBlocked(app: AppContext, alias: string, blocked: boolean, reason: string | null = null): boolean {
  const res = blocked
    ? app.db.prepare('UPDATE public_aliases SET blocked_at = ?, blocked_reason = ? WHERE alias = ?').run(app.now(), reason, alias)
    : app.db.prepare('UPDATE public_aliases SET blocked_at = NULL, blocked_reason = NULL WHERE alias = ?').run(alias);
  return res.changes > 0;
}
