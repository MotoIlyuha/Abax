import { randomBytes } from 'node:crypto';
import { buildBoardUrl } from '../src/board-url';
import { MAX_ALIASES_PER_OWNER, PLAN_LIMITS, sanitizePermissionsForPlan } from '../src/limits';
import { isAliasShaped, isNewAliasOk, isStoredRole, legacyRoleOf, normalizeRole, type StoredRole } from '../src/access';
import type { PageRight } from '../src/types';
import { requireUser } from './auth';
import type { AppContext } from './context';
import type { AliasRow, InviteRow } from './db';
import { activeAliasOf, isInviteKeyShaped, linkInviteOf, resolveInviteKey, rightsOfInvite, suggestFreeAliases, touchInvite, withMemberRights, type InviteRights } from './invites';
import { getActiveProject, ownerPlanOf, viewFor } from './projects';
import { HttpError, type Ctx, type Router } from './router';
import { effectivePlan } from './users';

// Ссылки совместной работы: общая ссылка доски (создать/обновить, пауза, сброс, отозвать), открыть по токену
// или именному адресу (/api/invites/:x, /j/:x), именной адрес доски (/api/projects/:id/alias). SPEC_NIGHT6 §5.2–5.4.

/** Новый токен: 144 бита из криптостойкого генератора, 24 символа base64url. */
export const newToken = (): string => randomBytes(18).toString('base64url');

/** Адрес ссылки-приглашения для веб-клиента (формат с параметрами: работает и на GitHub Pages, где путей /j/… нет). */
export function inviteUrl(app: AppContext, token: string): string {
  const base = app.opts.publicWebUrl ? `${app.opts.publicWebUrl}/` : '/';
  return buildBoardUrl(base, { mode: 'collab', token });
}

/** Чистый адрес /j/<ключ> — только если клиента раздаёт этот сервер (prettyLinks); иначе null. */
export function prettyInviteUrl(app: AppContext, key: string): string | null {
  return app.opts.prettyLinks && app.opts.publicWebUrl ? `${app.opts.publicWebUrl}/j/${encodeURIComponent(key)}` : null;
}

export const cloudRoomCode = (projectId: string): string => `cloud:${projectId}`;

/** Общая ссылка для владельца: настоящий токен, роль (старый синоним — для прежних клиентов), пауза, адрес. */
function inviteJson(app: AppContext, r: InviteRights) {
  const alias = activeAliasOf(app, r.projectId);
  return {
    token: r.linkToken, url: inviteUrl(app, r.linkToken), prettyUrl: prettyInviteUrl(app, alias ?? r.linkToken),
    projectId: r.projectId, defaultRole: legacyRoleOf(r.role), role: r.defaultRole,
    allowCopy: r.allowCopy, pageRights: r.pageRights, roomCode: cloudRoomCode(r.projectId),
    enabled: r.enabled, alias,
  };
}

const FAILURE_STATUS = 404;

/** Ответ по токену или адресу: проект, отфильтрованный и замаскированный по правам приглашения (владельцу — целиком). */
function resolveInvite(ctx: Ctx, key: string) {
  const app = ctx.app;
  const res = resolveInviteKey(app, key);
  if ('error' in res) throw new HttpError(FAILURE_STATUS, res.error);
  const row = getActiveProject(app, res.ok.projectId);
  if (!row) throw new HttpError(FAILURE_STATUS, 'board-deleted');
  const isOwner = !!ctx.user && ctx.user.id === row.owner_id;
  // личные права этого участника на страницы (меню аватара «Настройки доступа») — поверх прав ссылки
  const invite = isOwner ? res.ok : withMemberRights(app, res.ok, ctx.user?.id);
  if (!isOwner) touchInvite(app, invite.linkToken);
  const view = viewFor(app, row, isOwner ? { role: 'host' } : { role: 'guest', invite });
  return {
    token: invite.token, projectId: row.id, ownerPlan: view.ownerPlan,
    // role — старый синоним для клиентов Ночей №3–5; accessRole — роль Ночи №6
    role: legacyRoleOf(invite.role), accessRole: invite.role, legacy: invite.legacy, via: invite.via, isOwner,
    allowCopy: isOwner ? invite.allowCopy : view.allowCopy, pageRights: 'pageRights' in view ? view.pageRights : undefined,
    roomCode: cloudRoomCode(row.id), rev: view.rev, project: view.project,
  };
}

/** Роль из запроса: старый синоним, совпадающий с синонимом сохранённой новой роли, роль не меняет (не расширяем молча). */
function nextRole(body: unknown, existing: string | null): StoredRole {
  const cur = existing && normalizeRole(existing) ? existing as StoredRole : null;
  // без роли в запросе: прежняя роль ссылки, у новой — старый синоним edit (как у клиентов Ночей №3–5)
  if (body === undefined) return cur ?? 'edit';
  const b = body as StoredRole;
  if (cur && (b === 'edit' || b === 'view')) {
    const curRole = normalizeRole(cur)!;
    if (!curRole.legacy && legacyRoleOf(curRole.role) === b) return cur;
  }
  return b;
}

function ownLink(ctx: Ctx, token: string): { inv: InviteRow; row: NonNullable<ReturnType<typeof getActiveProject>> } {
  const user = requireUser(ctx);
  const inv = ctx.app.db.prepare('SELECT * FROM invites WHERE token = ?').get(token) as InviteRow | undefined;
  const row = inv ? getActiveProject(ctx.app, inv.project_id) : null;
  if (!inv || !row || row.owner_id !== user.id) throw new HttpError(404, 'invite-not-found');
  return { inv, row };
}

const aliasesOfOwner = (app: AppContext, ownerId: string): AliasRow[] =>
  app.db.prepare('SELECT * FROM public_aliases WHERE owner_id = ?').all(ownerId) as AliasRow[];

export function registerInviteRoutes(router: Router): void {
  router.post('/api/invites', async ctx => {
    const user = requireUser(ctx);
    const app = ctx.app;
    const body = await ctx.body() as { projectId?: unknown; defaultRole?: unknown; allowCopy?: unknown; pageRights?: unknown; enabled?: unknown } | undefined;
    if (typeof body?.projectId !== 'string') throw new HttpError(400, 'bad-request');
    const row = getActiveProject(app, body.projectId);
    if (!row || row.owner_id !== user.id) throw new HttpError(404, 'project-not-found');
    if (body.defaultRole !== undefined && !isStoredRole(body.defaultRole)) throw new HttpError(400, 'bad-role');
    if (body.allowCopy !== undefined && typeof body.allowCopy !== 'boolean') throw new HttpError(400, 'bad-request');
    if (body.enabled !== undefined && typeof body.enabled !== 'boolean') throw new HttpError(400, 'bad-request');
    if (body.pageRights !== undefined && (typeof body.pageRights !== 'object' || body.pageRights === null || Array.isArray(body.pageRights))) throw new HttpError(400, 'bad-request');

    // права проходят ту же поправку на тариф владельца, что и права проекта
    const plan = ownerPlanOf(app, row.owner_id);
    const perms = sanitizePermissionsForPlan(plan, { allowCopy: body.allowCopy as boolean | undefined, pageRights: (body.pageRights ?? {}) as Record<string, PageRight> });
    const pageRights = JSON.stringify(perms.pageRights ?? {});
    const existing = linkInviteOf(app, row.id);
    if (existing) {
      const role = nextRole(body.defaultRole, existing.default_role);
      const allowCopy = body.allowCopy === undefined && existing.allow_copy === 0 && perms.allowCopy !== false ? 0 : perms.allowCopy === false ? 0 : 1;
      const pausing = body.enabled === false && existing.disabled_at === null;
      const disabledAt = body.enabled === undefined ? existing.disabled_at : body.enabled ? null : existing.disabled_at ?? app.now();
      app.db.prepare('UPDATE invites SET default_role = ?, allow_copy = ?, page_rights_json = ?, disabled_at = ? WHERE token = ?')
        .run(role, allowCopy, pageRights, disabledAt, existing.token);
      // пауза закрывает соединения по ссылке и по адресу; иначе подключённые гости получают новые права сразу
      app.notifyAccessChanged({ projectId: row.id, kind: pausing ? 'invite-revoked' : 'invite-updated', token: existing.token });
      const rights = rightsOfInvite(app.db.prepare('SELECT * FROM invites WHERE token = ?').get(existing.token) as InviteRow);
      return { json: { ...inviteJson(app, rights), created: false } };
    }
    const token = newToken();
    app.db.prepare('INSERT INTO invites (token, project_id, created_by, default_role, allow_copy, page_rights_json, created_at, disabled_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(token, row.id, user.id, nextRole(body.defaultRole, null), perms.allowCopy === false ? 0 : 1, pageRights, app.now(), body.enabled === false ? app.now() : null);
    const rights = rightsOfInvite(app.db.prepare('SELECT * FROM invites WHERE token = ?').get(token) as InviteRow);
    return { status: 201, json: { ...inviteJson(app, rights), created: true } };
  });

  /** Действующая общая ссылка своей доски (в т.ч. на паузе; null — нет), ничего не создавая. */
  router.get('/api/invites', ctx => {
    const user = requireUser(ctx);
    const projectId = ctx.query.get('projectId');
    const row = projectId ? getActiveProject(ctx.app, projectId) : null;
    if (!row || row.owner_id !== user.id) throw new HttpError(404, 'project-not-found');
    const inv = linkInviteOf(ctx.app, row.id);
    return { json: { invite: inv ? inviteJson(ctx.app, rightsOfInvite(inv)) : null } };
  });

  /** «Сбросить ссылку»: старый токен перестаёт работать, новый — с теми же ролью, копированием и паузой. */
  router.post('/api/invites/:token/reset', ctx => {
    const { inv, row } = ownLink(ctx, ctx.params.token);
    const app = ctx.app;
    if (inv.kind !== 'link' || inv.revoked !== 0) throw new HttpError(404, 'invite-not-found');
    const token = newToken();
    app.db.transaction(() => {
      app.db.prepare('UPDATE invites SET revoked = 1 WHERE token = ?').run(inv.token);
      app.db.prepare('INSERT INTO invites (token, project_id, created_by, default_role, allow_copy, page_rights_json, created_at, disabled_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(token, row.id, inv.created_by, inv.default_role, inv.allow_copy, inv.page_rights_json, app.now(), inv.disabled_at);
    })();
    app.notifyAccessChanged({ projectId: row.id, kind: 'invite-revoked', token: inv.token });
    const rights = rightsOfInvite(app.db.prepare('SELECT * FROM invites WHERE token = ?').get(token) as InviteRow);
    return { status: 201, json: { ...inviteJson(app, rights), created: true } };
  });

  router.delete('/api/invites/:token', ctx => {
    const { inv } = ownLink(ctx, ctx.params.token);
    const app = ctx.app;
    app.db.prepare('UPDATE invites SET revoked = 1 WHERE token = ?').run(inv.token);
    app.notifyAccessChanged({ projectId: inv.project_id, kind: 'invite-revoked', token: inv.token });
    return { json: { ok: true } };
  });

  router.get('/api/invites/:token', ctx => ({ json: resolveInvite(ctx, ctx.params.token) }));

  // тот же ответ по адресу страницы приглашения, если клиент просит JSON; иначе — перенаправление на клиент
  router.get('/j/:token', ctx => {
    const key = ctx.params.token;
    if (String(ctx.req.headers.accept ?? '').includes('application/json')) return { json: resolveInvite(ctx, key) };
    if (!isInviteKeyShaped(key)) return { next: true };
    // клиент по вложенному пути не отдаётся (base './', base-uri 'none'): ведём на адрес с параметрами
    const base = ctx.app.opts.publicWebUrl ? `${ctx.app.opts.publicWebUrl}/` : '/';
    return { status: 302, headers: { Location: buildBoardUrl(base, { mode: 'collab', token: key }), 'Cache-Control': 'no-store' } };
  });

  // ----- Именной адрес доски (Pro/Tutor) -----

  router.get('/api/projects/:id/alias', ctx => {
    const user = requireUser(ctx);
    const row = getActiveProject(ctx.app, ctx.params.id);
    if (!row || row.owner_id !== user.id) throw new HttpError(404, 'project-not-found');
    const rows = ctx.app.db.prepare("SELECT alias, state FROM public_aliases WHERE project_id = ? AND state IN ('active', 'former') AND blocked_at IS NULL ORDER BY updated_at DESC")
      .all(row.id) as { alias: string; state: string }[];
    return {
      json: {
        alias: rows.find(r => r.state === 'active')?.alias ?? null,
        former: rows.filter(r => r.state === 'former').map(r => r.alias),
        prettyUrl: (() => { const a = rows.find(r => r.state === 'active')?.alias; return a ? prettyInviteUrl(ctx.app, a) : null; })(),
      },
    };
  });

  // проверка адреса на лету, пока владелец печатает: свободен ли и что предложить взамен (без записи в базу)
  router.get('/api/projects/:id/alias/check', ctx => {
    const user = requireUser(ctx);
    const app = ctx.app;
    const row = getActiveProject(app, ctx.params.id);
    if (!row || row.owner_id !== user.id) throw new HttpError(404, 'project-not-found');
    const alias = (ctx.query.get('alias') ?? '').trim();
    // неправильную форму показывает сам клиент; подсказать нечего
    if (!isAliasShaped(alias)) return { json: { alias, status: 'bad', suggestions: [] } };
    const taken = app.db.prepare('SELECT owner_id, blocked_at FROM public_aliases WHERE alias = ?').get(alias) as Pick<AliasRow, 'owner_id' | 'blocked_at'> | undefined;
    const status = !taken ? (isNewAliasOk(alias) ? 'free' : 'short')
      : taken.owner_id !== user.id ? 'taken' : taken.blocked_at !== null ? 'blocked' : 'own';
    return { json: { alias, status, suggestions: status === 'free' || status === 'own' ? [] : suggestFreeAliases(app, alias) } };
  });

  router.put('/api/projects/:id/alias', async ctx => {
    const user = requireUser(ctx);
    const app = ctx.app;
    const row = getActiveProject(app, ctx.params.id);
    if (!row || row.owner_id !== user.id) throw new HttpError(404, 'project-not-found');
    const body = await ctx.body() as { alias?: unknown } | undefined;
    const alias = typeof body?.alias === 'string' ? body.alias.trim() : '';
    if (!isAliasShaped(alias)) throw new HttpError(400, 'bad-alias');
    const taken = app.db.prepare('SELECT * FROM public_aliases WHERE alias = ?').get(alias) as AliasRow | undefined;
    // новый адрес — не короче ALIAS_MIN; адреса, занятые раньше (3–5 символов), узнаются, а свои можно вернуть
    if (!taken && !isNewAliasOk(alias)) throw new HttpError(400, 'bad-alias');
    if (app.opts.enforceLimits && !PLAN_LIMITS[effectivePlan(user, app.now())].canSetAlias) throw new HttpError(403, 'plan-limit-alias');
    // адрес, когда-либо принадлежавший другому аккаунту (в т.ч. надгробие), не достаётся никому: предлагаем похожие свободные
    if (taken && taken.owner_id !== user.id) throw new HttpError(409, 'alias-taken', { suggestions: suggestFreeAliases(app, alias) });
    if (taken && taken.blocked_at !== null) throw new HttpError(409, 'alias-blocked', { suggestions: suggestFreeAliases(app, alias) });
    if (taken && taken.state === 'active' && taken.project_id === row.id) return { json: { alias, former: [], prettyUrl: prettyInviteUrl(app, alias) } };
    if (!taken && aliasesOfOwner(app, user.id).length >= MAX_ALIASES_PER_OWNER) throw new HttpError(429, 'alias-limit');
    const now = app.now();
    app.db.transaction(() => {
      // прежний адрес доски становится бывшим и продолжает вести на неё
      app.db.prepare("UPDATE public_aliases SET state = 'former', updated_at = ? WHERE project_id = ? AND state = 'active'").run(now, row.id);
      if (taken) app.db.prepare("UPDATE public_aliases SET project_id = ?, state = 'active', updated_at = ? WHERE alias = ?").run(row.id, now, alias);
      else app.db.prepare("INSERT INTO public_aliases (alias, project_id, owner_id, state, created_at, updated_at) VALUES (?, ?, ?, 'active', ?, ?)").run(alias, row.id, user.id, now, now);
    })();
    const former = (app.db.prepare("SELECT alias FROM public_aliases WHERE project_id = ? AND state = 'former' AND blocked_at IS NULL ORDER BY updated_at DESC").all(row.id) as { alias: string }[]).map(r => r.alias);
    return { json: { alias, former, prettyUrl: prettyInviteUrl(app, alias) } };
  });

  router.delete('/api/projects/:id/alias/:alias', ctx => {
    const user = requireUser(ctx);
    const app = ctx.app;
    const row = getActiveProject(app, ctx.params.id);
    if (!row || row.owner_id !== user.id) throw new HttpError(404, 'project-not-found');
    const res = app.db.prepare("UPDATE public_aliases SET state = 'released', updated_at = ? WHERE alias = ? AND project_id = ? AND owner_id = ? AND state IN ('active', 'former') AND blocked_at IS NULL")
      .run(app.now(), ctx.params.alias, row.id, user.id);
    if (res.changes === 0) throw new HttpError(404, 'alias-not-found');
    // вошедшие по адресу остаются до отключения общей ссылки: адрес — лишь вход, права у ссылки
    return { json: { ok: true } };
  });
}
