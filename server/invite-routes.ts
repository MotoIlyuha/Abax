import { randomBytes } from 'node:crypto';
import { buildBoardUrl } from '../src/board-url';
import { sanitizePermissionsForPlan } from '../src/limits';
import type { PageRight } from '../src/types';
import { requireUser } from './auth';
import type { AppContext } from './context';
import type { InviteRow } from './db';
import { findActiveInvite, rightsOfInvite, type InviteRights } from './invites';
import { getActiveProject, ownerPlanOf, viewFor } from './projects';
import { HttpError, type Ctx, type Router } from './router';

// Ссылки совместной работы: создать/обновить, отозвать, открыть по токену (/api/invites, /j/:token).

const newToken = (): string => randomBytes(18).toString('base64url');

/** Адрес ссылки-приглашения для веб-клиента (формат с параметрами: работает и на GitHub Pages, где путей /j/… нет). */
export function inviteUrl(app: AppContext, token: string): string {
  const base = app.opts.publicWebUrl ? `${app.opts.publicWebUrl}/` : '/';
  return buildBoardUrl(base, { mode: 'collab', token });
}

export const cloudRoomCode = (projectId: string): string => `cloud:${projectId}`;

function inviteJson(app: AppContext, r: InviteRights) {
  return {
    token: r.token, url: inviteUrl(app, r.token), projectId: r.projectId, defaultRole: r.defaultRole,
    allowCopy: r.allowCopy, pageRights: r.pageRights, roomCode: cloudRoomCode(r.projectId),
  };
}

/** Действующая ссылка-приглашение проекта (одна на проект; приглашения по почте не в счёт); null — нет. */
function activeInviteOf(app: AppContext, projectId: string): InviteRow | null {
  const rows = app.db.prepare("SELECT * FROM invites WHERE project_id = ? AND revoked = 0 AND kind = 'link' ORDER BY created_at DESC").all(projectId) as InviteRow[];
  return rows.find(r => r.expires_at === null || r.expires_at > app.now()) ?? null;
}

/** Ответ по токену: проект, отфильтрованный и замаскированный по правам приглашения (владельцу — целиком). */
function resolveInvite(ctx: Ctx, token: string) {
  const app = ctx.app;
  const invite = findActiveInvite(app, token);
  const row = invite ? getActiveProject(app, invite.projectId) : null;
  if (!invite || !row) throw new HttpError(404, 'invite-not-found');
  const isOwner = !!ctx.user && ctx.user.id === row.owner_id;
  const view = viewFor(app, row, isOwner ? { role: 'host' } : { role: 'guest', invite });
  return {
    token, projectId: row.id, ownerPlan: view.ownerPlan, role: invite.defaultRole, isOwner,
    allowCopy: isOwner ? invite.allowCopy : view.allowCopy, pageRights: 'pageRights' in view ? view.pageRights : undefined,
    roomCode: cloudRoomCode(row.id), rev: view.rev, project: view.project,
  };
}

export function registerInviteRoutes(router: Router): void {
  router.post('/api/invites', async ctx => {
    const user = requireUser(ctx);
    const app = ctx.app;
    const body = await ctx.body() as { projectId?: unknown; defaultRole?: unknown; allowCopy?: unknown; pageRights?: unknown } | undefined;
    if (typeof body?.projectId !== 'string') throw new HttpError(400, 'bad-request');
    const row = getActiveProject(app, body.projectId);
    if (!row || row.owner_id !== user.id) throw new HttpError(404, 'project-not-found');
    if (body.defaultRole !== undefined && body.defaultRole !== 'edit' && body.defaultRole !== 'view') throw new HttpError(400, 'bad-role');
    if (body.allowCopy !== undefined && typeof body.allowCopy !== 'boolean') throw new HttpError(400, 'bad-request');
    if (body.pageRights !== undefined && (typeof body.pageRights !== 'object' || body.pageRights === null || Array.isArray(body.pageRights))) throw new HttpError(400, 'bad-request');

    // права проходят ту же поправку на тариф владельца, что и права проекта
    const plan = ownerPlanOf(app, row.owner_id);
    const perms = sanitizePermissionsForPlan(plan, { allowCopy: body.allowCopy as boolean | undefined, pageRights: (body.pageRights ?? {}) as Record<string, PageRight> });
    const pageRights = JSON.stringify(perms.pageRights ?? {});
    const existing = activeInviteOf(app, row.id);
    if (existing) {
      const role = (body.defaultRole as 'edit' | 'view' | undefined) ?? (existing.default_role === 'view' ? 'view' : 'edit');
      app.db.prepare('UPDATE invites SET default_role = ?, allow_copy = ?, page_rights_json = ? WHERE token = ?')
        .run(role, perms.allowCopy === false ? 0 : 1, pageRights, existing.token);
      // подключённые по этой ссылке гости получают новые права сразу (SPEC_NIGHT5 §3.2)
      app.notifyAccessChanged({ projectId: row.id, kind: 'invite-updated', token: existing.token });
      const rights = rightsOfInvite(app.db.prepare('SELECT * FROM invites WHERE token = ?').get(existing.token) as InviteRow);
      return { json: { ...inviteJson(app, rights), created: false } };
    }
    const token = newToken();
    app.db.prepare('INSERT INTO invites (token, project_id, created_by, default_role, allow_copy, page_rights_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(token, row.id, user.id, body.defaultRole ?? 'edit', perms.allowCopy === false ? 0 : 1, pageRights, app.now());
    const rights = rightsOfInvite(app.db.prepare('SELECT * FROM invites WHERE token = ?').get(token) as InviteRow);
    return { status: 201, json: { ...inviteJson(app, rights), created: true } };
  });

  /** Действующее приглашение своего проекта (null — нет), ничего не создавая. */
  router.get('/api/invites', ctx => {
    const user = requireUser(ctx);
    const projectId = ctx.query.get('projectId');
    const row = projectId ? getActiveProject(ctx.app, projectId) : null;
    if (!row || row.owner_id !== user.id) throw new HttpError(404, 'project-not-found');
    const inv = activeInviteOf(ctx.app, row.id);
    return { json: { invite: inv ? inviteJson(ctx.app, rightsOfInvite(inv)) : null } };
  });

  router.delete('/api/invites/:token', ctx => {
    const user = requireUser(ctx);
    const app = ctx.app;
    const inv = app.db.prepare('SELECT * FROM invites WHERE token = ?').get(ctx.params.token) as InviteRow | undefined;
    const row = inv ? getActiveProject(app, inv.project_id) : null;
    if (!inv || !row || row.owner_id !== user.id) throw new HttpError(404, 'invite-not-found');
    app.db.prepare('UPDATE invites SET revoked = 1 WHERE token = ?').run(inv.token);
    app.notifyAccessChanged({ projectId: inv.project_id, kind: 'invite-revoked', token: inv.token });
    return { json: { ok: true } };
  });

  router.get('/api/invites/:token', ctx => ({ json: resolveInvite(ctx, ctx.params.token) }));

  // тот же ответ по адресу страницы приглашения, если клиент просит JSON; иначе — страница клиента
  router.get('/j/:token', ctx => {
    if (!String(ctx.req.headers.accept ?? '').includes('application/json')) return { next: true };
    return { json: resolveInvite(ctx, ctx.params.token) };
  });
}

