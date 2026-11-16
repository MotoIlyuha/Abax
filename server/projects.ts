import { randomUUID } from 'node:crypto';
import { applyBoardPatch, isBoardPatch, type BoardPatch, type ElementOp } from '../src/delta';
import { parseProject, sanitizeElement, serializeProject } from '../src/file';
import { assetHashOf } from '../src/asset-store';
import { preserveElementReactions } from '../src/comments';
import { canCreateProject, isOverPageLimit, sanitizePermissionsForPlan } from '../src/limits';
import { cloneProjectForViewer, hiddenPageIds, invitePageRight, maskPagesForGuest, stripStudentData, withoutPages } from '../src/project-access';
import { guardedElement, hostElement } from '../src/room-host';
import { MAX_ATTEMPTS } from '../src/task-element';
import type { CommentThread, Element, Page, PageRight, PlanTier, Project, ProjectPermissions, TaskAttempt } from '../src/types';
import { ingestElement, ingestProjectImages } from './assets';
import { requireUser } from './auth';
import type { AppContext } from './context';
import { MAX_REVISIONS_PER_PROJECT, type ProjectRow } from './db';
import { findActiveInvite, type InviteRights } from './invites';
import { HttpError, type Router } from './router';
import { effectivePlan, getUser } from './users';

// Проекты в облаке: список, просмотр с учётом роли, сохранение с лимитами тарифа, патчи, клонирование, удаление.

const MAX_PROJECT_BODY = 10 * 1024 * 1024;
const MAX_PATCH_BODY = 2 * 1024 * 1024;
/** Патч в журнале ревизий дольше этого хранится только в виде сводки. */
const MAX_REVISION_JSON = 256 * 1024;

// ----- Доступ к строкам -----

export function getProjectRow(app: AppContext, id: string): ProjectRow | null {
  return (app.db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as ProjectRow | undefined) ?? null;
}

export function getActiveProject(app: AppContext, id: string): ProjectRow | null {
  const row = getProjectRow(app, id);
  return row && row.is_deleted === 0 ? row : null;
}

export const projectOf = (row: ProjectRow): Project => JSON.parse(row.data_json) as Project;

/** Действующий тариф владельца проекта. */
export function ownerPlanOf(app: AppContext, ownerId: string): PlanTier {
  const u = getUser(app.db, ownerId);
  return u ? effectivePlan(u, app.now()) : 'free';
}

function activeCount(app: AppContext, ownerId: string): number {
  return (app.db.prepare('SELECT COUNT(*) n FROM projects WHERE owner_id = ? AND is_deleted = 0').get(ownerId) as { n: number }).n;
}

// ----- Запись -----

interface WriteArgs {
  existing: ProjectRow | null;
  ownerId: string;
  project: Project;
  authorId: string | null;
  pageId?: string | null;
  /** Содержимое журнала ревизий (patch_json). */
  revision: unknown;
}

/** Одна запись проекта: строка, ревизия, подрезка журнала — в одной транзакции. Возвращает новую ревизию. */
export function writeProject(app: AppContext, a: WriteArgs): number {
  const perms: ProjectPermissions = a.project.permissions ?? {};
  const now = app.now();
  const rev = a.existing ? a.existing.rev + 1 : 1;
  let revJson = JSON.stringify(a.revision);
  if (revJson.length > MAX_REVISION_JSON) revJson = JSON.stringify({ kind: 'large', bytes: revJson.length });
  app.db.transaction(() => {
    const cols = [a.project.name, rev, serializeProject(a.project), perms.forbidClone ? 1 : 0, perms.allowCopy === false ? 0 : 1, JSON.stringify(perms.pageRights ?? {}), now] as const;
    if (a.existing) {
      app.db.prepare('UPDATE projects SET title = ?, rev = ?, data_json = ?, forbid_clone = ?, allow_copy = ?, page_rights_json = ?, updated_at = ?, is_deleted = 0 WHERE id = ?')
        .run(...cols, a.project.id);
    } else {
      app.db.prepare('INSERT INTO projects (title, rev, data_json, forbid_clone, allow_copy, page_rights_json, updated_at, id, owner_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(...cols, a.project.id, a.ownerId, now);
    }
    app.db.prepare('INSERT INTO project_revisions (project_id, rev, page_id, author_id, patch_json, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(a.project.id, rev, a.pageId ?? null, a.authorId, revJson, now);
    app.db.prepare(`DELETE FROM project_revisions WHERE project_id = ? AND id NOT IN
      (SELECT id FROM project_revisions WHERE project_id = ? ORDER BY rev DESC LIMIT ${MAX_REVISIONS_PER_PROJECT})`).run(a.project.id, a.project.id);
  })();
  return rev;
}

// ----- Слияние при устаревшей ревизии -----

function unionAttempts(a: TaskAttempt[] | undefined, b: TaskAttempt[] | undefined): TaskAttempt[] | undefined {
  const seen = new Set<string>();
  const out: TaskAttempt[] = [];
  for (const t of [...(a ?? []), ...(b ?? [])]) {
    const k = `${t.timestamp}\u0000${t.value}`;
    if (!seen.has(k)) { seen.add(k); out.push(t); }
  }
  out.sort((x, y) => x.timestamp - y.timestamp);
  return out.length > 0 ? out.slice(-MAX_ATTEMPTS) : undefined;
}

/** Ответы учеников растут только вперёд: при устаревшей ревизии попытки объединяются, а свежий черновик — серверный. */
function mergeTaskLive(current: Element, incoming: Element): Element {
  if (current.type !== 'task' || incoming.type !== 'task') return incoming;
  const attempts = unionAttempts(current.attempts, incoming.attempts);
  const draft = current.studentDraft ?? incoming.studentDraft;
  const { attempts: _a, studentDraft: _d, ...rest } = incoming;
  return { ...rest, ...(attempts ? { attempts } : {}), ...(draft !== undefined ? { studentDraft: draft } : {}) } as Element;
}

function mergeComments(current: CommentThread[] | undefined, incoming: CommentThread[] | undefined): CommentThread[] | undefined {
  const byId = new Map((current ?? []).map(t => [t.id, t]));
  const seen = new Set<string>();
  const out: CommentThread[] = (incoming ?? []).map(t => {
    seen.add(t.id);
    const c = byId.get(t.id);
    if (!c) return t;
    const known = new Set(t.messages.map(m => m.id));
    const extra = c.messages.filter(m => !known.has(m.id));
    return extra.length > 0 ? { ...t, messages: [...t.messages, ...extra].sort((x, y) => x.createdAt - y.createdAt) } : t;
  });
  for (const c of current ?? []) if (!seen.has(c.id)) out.push(c);
  return out.length > 0 ? out : undefined;
}

/**
 * Сохранение автором поверх более новой серверной версии: правки автора выигрывают (последняя запись),
 * но то, что менялось мимо автора — реакции, ответы и черновики учеников, комментарии, — сохраняется.
 */
export function mergeStale(current: Project, incoming: Project): Project {
  const pages: Page[] = incoming.pages.map(pg => {
    const cur = current.pages.find(p => p.id === pg.id);
    if (!cur) return pg;
    const curById = new Map(cur.elements.map(e => [e.id, e]));
    const withReactions = preserveElementReactions(pg.elements, cur.elements);
    const elements = withReactions.map(el => { const c = curById.get(el.id); return c ? mergeTaskLive(c, el) : el; });
    const comments = mergeComments(cur.comments, pg.comments);
    const { comments: _c, ...rest } = pg;
    return { ...rest, elements, ...(comments ? { comments } : {}) };
  });
  return { ...incoming, pages };
}

// ----- Просмотр -----

type Access =
  | { role: 'host' }
  | { role: 'viewer'; pageId?: string }
  | { role: 'guest'; invite: InviteRights; pageId?: string };

/** Проект так, как его видит участник с этой ролью. Ответов в заданиях у не-владельца нет. */
export function viewFor(app: AppContext, row: ProjectRow, access: Access) {
  const stored = projectOf(row);
  const plan = ownerPlanOf(app, row.owner_id);
  if (access.role === 'host') {
    return { role: 'host', rev: row.rev, canClone: true, allowCopy: true, ownerPlan: plan, project: { ...stored, ownerPlan: plan } };
  }
  const hidden = access.role === 'guest'
    ? new Set(stored.pages.filter(p => invitePageRight(stored, access.invite, p.id) === 'hidden').map(p => p.id))
    : hiddenPageIds(stored);
  let pages = withoutPages(stored, hidden).pages;
  if (access.pageId !== undefined) {
    pages = pages.filter(p => p.id === access.pageId);
    if (pages.length === 0) throw new HttpError(404, 'page-not-found');
  }
  pages = maskPagesForGuest(pages);
  if (access.role === 'viewer') pages = stripStudentData(pages);
  const perms = sanitizePermissionsForPlan(plan, stored.permissions ?? {});
  const forbidClone = perms.forbidClone === true || access.pageId !== undefined;
  const allowCopy = perms.allowCopy !== false && perms.forbidClone !== true && (access.role !== 'guest' || access.invite.allowCopy);
  const { pinned: _pin, ...rest } = stored;
  const project: Project = {
    ...rest, ownerPlan: plan, pages,
    permissions: { forbidClone, allowCopy: perms.allowCopy !== false && (access.role !== 'guest' || access.invite.allowCopy) },
  };
  const out = { role: access.role, rev: row.rev, canClone: !forbidClone, allowCopy, ownerPlan: plan, project };
  if (access.role === 'guest') {
    const pageRights: Record<string, PageRight> = {};
    for (const p of pages) pageRights[p.id] = invitePageRight(stored, access.invite, p.id);
    return { ...out, pageRights, defaultRole: access.invite.defaultRole };
  }
  return out;
}

function missingAssets(app: AppContext, project: Project): string[] {
  const need = new Set<string>();
  for (const pg of project.pages) for (const el of pg.elements) {
    const h = el.type === 'image' ? assetHashOf(el.src) : null;
    if (h) need.add(h);
  }
  if (need.size === 0) return [];
  const have = new Set((app.db.prepare(`SELECT hash FROM assets WHERE hash IN (${[...need].map(() => '?').join(',')})`).all(...need) as { hash: string }[]).map(r => r.hash));
  return [...need].filter(h => !have.has(h));
}

// ----- Маршруты -----

export function registerProjectRoutes(router: Router): void {
  router.get('/api/projects', ctx => {
    const user = requireUser(ctx);
    const rows = ctx.app.db.prepare(`SELECT id, title, rev, created_at, updated_at,
        json_array_length(data_json, '$.pages') AS page_count,
        json_extract(data_json, '$.pinned') AS pinned,
        CASE WHEN length(json_extract(data_json, '$.icon')) <= 16 THEN json_extract(data_json, '$.icon') END AS icon
      FROM projects WHERE owner_id = ? AND is_deleted = 0 ORDER BY updated_at DESC`).all(user.id) as {
      id: string; title: string; rev: number; created_at: number; updated_at: number; page_count: number | null; pinned: number | null; icon: string | null;
    }[];
    const plan = effectivePlan(user, ctx.app.now());
    return {
      json: {
        projects: rows.map(r => ({
          id: r.id, title: r.title, name: r.title, rev: r.rev, createdAt: r.created_at, updatedAt: r.updated_at,
          pageCount: r.page_count ?? 0, ownerPlan: plan,
          ...(r.pinned ? { pinned: true } : {}), ...(r.icon ? { icon: r.icon } : {}),
        })),
      },
    };
  });

  router.get('/api/projects/:id', ctx => {
    const app = ctx.app;
    const row = getActiveProject(app, ctx.params.id);
    if (!row) throw new HttpError(404, 'project-not-found');
    const pageId = ctx.query.get('pageId') || undefined;
    if (ctx.user && ctx.user.id === row.owner_id) return { json: viewFor(app, row, { role: 'host' }) };
    const token = ctx.query.get('invite');
    if (token) {
      const invite = findActiveInvite(app, token, row.id);
      if (!invite) throw new HttpError(404, 'invite-not-found');
      return { json: viewFor(app, row, { role: 'guest', invite, ...(pageId ? { pageId } : {}) }) };
    }
    return { json: viewFor(app, row, { role: 'viewer', ...(pageId ? { pageId } : {}) }) };
  });

  router.put('/api/projects/:id', async ctx => {
    const user = requireUser(ctx);
    const app = ctx.app;
    const id = ctx.params.id;
    const body = await ctx.body() as { project?: unknown; expectedRev?: unknown } | undefined;
    const parsed = parseProject(body?.project);
    if (!parsed) throw new HttpError(400, 'bad-project');
    if (parsed.id !== id) throw new HttpError(400, 'id-mismatch');
    const expectedRev = typeof body?.expectedRev === 'number' && Number.isInteger(body.expectedRev) ? body.expectedRev : undefined;
    // картинки из JSON — в хранилище (асинхронно, до чтения и записи строки проекта)
    const incoming = await ingestProjectImages(app, parsed, user.id);

    const row = getProjectRow(app, id);
    if (row && row.owner_id !== user.id) throw new HttpError(409, 'id-taken');
    const existing = row && row.is_deleted === 0 ? row : null;
    const plan = effectivePlan(user, app.now());
    if (app.opts.enforceLimits) {
      if (!existing && !canCreateProject(plan, activeCount(app, user.id))) throw new HttpError(403, 'plan-limit-projects');
      const oldPages = existing ? (JSON.parse(existing.data_json) as Project).pages.length : 0;
      if (isOverPageLimit(plan, incoming.pages.length) && incoming.pages.length > oldPages) throw new HttpError(403, 'plan-limit-pages');
    }
    const missing = missingAssets(app, incoming);
    if (missing.length > 0) throw new HttpError(409, 'missing-assets', { hashes: missing });

    let next: Project = { ...incoming, ownerPlan: plan, permissions: sanitizePermissionsForPlan(plan, incoming.permissions ?? {}) };
    if (existing && (expectedRev === undefined || expectedRev < existing.rev)) next = mergeStale(projectOf(existing), next);
    const rev = writeProject(app, {
      existing: row, ownerId: user.id, project: next, authorId: user.id,
      revision: { kind: existing ? 'put' : 'create', pages: next.pages.length, stale: existing ? expectedRev === undefined || expectedRev < existing.rev : false },
    });
    app.notifyProjectChanged(id, next);
    const updated = getProjectRow(app, id)!;
    return { json: { id, rev, ownerPlan: plan, permissions: next.permissions, updatedAt: updated.updated_at } };
  }, { maxBody: MAX_PROJECT_BODY });

  router.post('/api/projects/:id/patch', async ctx => {
    const app = ctx.app;
    const id = ctx.params.id;
    const body = await ctx.body();
    if (!isBoardPatch(body)) throw new HttpError(400, 'bad-patch');
    const first = getActiveProject(app, id);
    if (!first) throw new HttpError(404, 'project-not-found');
    const isOwner = !!ctx.user && ctx.user.id === first.owner_id;
    const token = ctx.query.get('invite');
    const invite = !isOwner && token ? findActiveInvite(app, token, id) : null;
    if (!isOwner && !invite) throw new HttpError(ctx.user || token ? 403 : 401, ctx.user || token ? 'forbidden' : 'unauthorized');

    // присланные элементы: проверка формы и вынос картинок (асинхронно), потом — одна синхронная запись
    const authorId = ctx.user?.id ?? null;
    const cleaned: ElementOp[] = [];
    for (const op of body.ops) {
      if (op.op !== 'put') { cleaned.push(op); continue; }
      const el = sanitizeElement(op.el);
      if (el) cleaned.push({ op: 'put', el: await ingestElement(app, el, authorId) });
    }

    const row = getActiveProject(app, id);
    if (!row) throw new HttpError(404, 'project-not-found');
    const project = projectOf(row);
    const page = project.pages.find(p => p.id === body.pageId);
    if (!page) throw new HttpError(404, 'page-not-found');
    if (!isOwner && invitePageRight(project, invite!, page.id) !== 'edit') throw new HttpError(403, 'no-edit-right');
    const known = new Map(page.elements.map(e => [e.id, e]));
    const ops: ElementOp[] = cleaned.map(op => (op.op === 'put'
      ? { op: 'put', el: isOwner ? hostElement(known.get(op.el.id), op.el) : guardedElement(known.get(op.el.id), op.el) }
      : op));
    const patch: BoardPatch = { ...body, ops, rev: row.rev + 1 };
    const next: Project = { ...project, updatedAt: app.now(), pages: project.pages.map(p => (p === page ? applyBoardPatch(p, patch) : p)) };
    const rev = writeProject(app, { existing: row, ownerId: row.owner_id, project: next, authorId, pageId: page.id, revision: patch });
    app.notifyProjectChanged(id, next);
    return { json: { ok: true, rev } };
  }, { maxBody: MAX_PATCH_BODY });

  router.post('/api/projects/:id/clone', async ctx => {
    const user = requireUser(ctx);
    const app = ctx.app;
    const row = getActiveProject(app, ctx.params.id);
    if (!row) throw new HttpError(404, 'project-not-found');
    const isOwner = row.owner_id === user.id;
    if (!isOwner && row.forbid_clone) throw new HttpError(403, 'clone-forbidden');
    const plan = effectivePlan(user, app.now());
    if (app.opts.enforceLimits && !canCreateProject(plan, activeCount(app, user.id))) throw new HttpError(403, 'plan-limit-projects');
    const token = ctx.query.get('invite');
    const invite = token ? findActiveInvite(app, token, row.id) : null;
    const source = projectOf(row);
    const hidden = isOwner ? new Set<string>() : new Set([
      ...hiddenPageIds(source),
      ...(invite ? source.pages.filter(p => invitePageRight(source, invite, p.id) === 'hidden').map(p => p.id) : []),
    ]);
    const visible = withoutPages(source, hidden);
    const clone = cloneProjectForViewer({ ...visible, pages: stripStudentData(visible.pages) }, { plan, id: randomUUID(), now: app.now() });
    const rev = writeProject(app, { existing: null, ownerId: user.id, project: clone, authorId: user.id, revision: { kind: 'clone', from: row.id } });
    return { status: 201, json: { id: clone.id, rev, ownerPlan: plan, project: clone } };
  });

  router.delete('/api/projects/:id', ctx => {
    const user = requireUser(ctx);
    const res = ctx.app.db.prepare('UPDATE projects SET is_deleted = 1, updated_at = ? WHERE id = ? AND owner_id = ? AND is_deleted = 0')
      .run(ctx.app.now(), ctx.params.id, user.id);
    if (res.changes === 0) throw new HttpError(404, 'project-not-found');
    ctx.app.notifyAccessChanged({ projectId: ctx.params.id, kind: 'deleted' });
    return { json: { ok: true } };
  });
}
