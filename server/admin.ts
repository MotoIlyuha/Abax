import { createHmac } from 'node:crypto';
import { normalizePromoCode } from '../src/billing';
import { isPlanTier } from '../src/limits';
import { AUDIT_OPERATIONS, type AdminAlias, type AdminAudit, type AdminPage, type AdminPayment, type AdminPromo, type AdminSummary, type AdminUser, type AuditOperation } from '../shared/admin';
import { endAdminSession } from './admin-auth';
import { createPromoCode, promoDefinition, promoStatus } from './billing';
import type { AppContext } from './context';
import type { PromoCodeRow, UserRow } from './db';
import { listAliasesForModeration, setAliasBlocked } from './invites';
import { HttpError, type Ctx, type Router } from './router';
import { effectivePlan, getUser, setUserPlanRow, validPlanDays } from './users';

const PAGE_SIZE = 25;
const MAX_BODY = 4096;
const ROOT = '/api/admin';

function pagination(ctx: Ctx) {
  const page = Number(ctx.query.get('page') ?? '1');
  if (!Number.isSafeInteger(page) || page < 1 || page > 1_000_000) throw new HttpError(400, 'bad-page');
  return { page, offset: (page - 1) * PAGE_SIZE, limit: PAGE_SIZE + 1 };
}

function paged<T>(items: T[], page: number): AdminPage<T> {
  return { items: items.slice(0, PAGE_SIZE), page, hasMore: items.length > PAGE_SIZE };
}

function search(query: URLSearchParams, name = 'q'): string {
  const value = (query.get(name) ?? '').trim().toLowerCase();
  if (value.length > 200) throw new HttpError(400, 'bad-search');
  return value;
}

async function confirmed(ctx: Ctx): Promise<Record<string, unknown> & { reason: string }> {
  const body = await ctx.body() as Record<string, unknown> | null;
  const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';
  if (body?.confirmed !== true) throw new HttpError(400, 'confirmation-required');
  if (!reason || reason.length > 500) throw new HttpError(400, 'bad-reason');
  return { ...body, reason };
}

function audit(ctx: Ctx, operation: AuditOperation, objectId: string, reason: string, change: Record<string, unknown>, now: number): void {
  ctx.app.db.prepare('INSERT INTO admin_audit (admin_id, created_at, operation, object_id, reason, change_json) VALUES (?, ?, ?, ?, ?, ?)')
    .run(ctx.user!.id, now, operation, objectId, reason, JSON.stringify(change));
}

type UserSummaryRow = Pick<UserRow,
  'id' | 'display_name' | 'email' | 'google_email' | 'google_sub' | 'tg_id' | 'tg_username' | 'plan' | 'plan_expires_at' | 'plan_trial' | 'created_at'>;

function userView(row: UserSummaryRow, now: number): AdminUser {
  const plan = effectivePlan(row, now);
  return {
    id: row.id, displayName: row.display_name, email: row.email, googleEmail: row.google_email, google: row.google_sub !== null,
    telegramId: row.tg_id, telegramUsername: row.tg_username, storedPlan: row.plan, plan, expiresAt: row.plan_expires_at,
    expired: row.plan_expires_at !== null && row.plan_expires_at <= now, trial: plan !== 'free' && row.plan_trial === 1,
    createdAt: row.created_at,
  };
}

function findUser(app: AppContext, id: string): UserRow {
  const user = getUser(app.db, id);
  if (!user) throw new HttpError(404, 'not-found');
  return user;
}

function planSnapshot(row: UserRow) {
  return { plan: row.plan, expiresAt: row.plan_expires_at, trial: row.plan_trial === 1 };
}

function promoReference(app: AppContext, code: string): string {
  return 'promo:' + createHmac('sha256', app.opts.jwtSecret).update('admin-promo:' + code).digest('hex').slice(0, 24);
}

function promoView(app: AppContext, row: PromoCodeRow, now: number): AdminPromo {
  return {
    code: row.code, reference: promoReference(app, row.code), plan: row.plan, days: row.days, uses: row.uses, maxUses: row.max_uses,
    expiresAt: row.expires_at, disabledAt: row.disabled_at, status: promoStatus(row, now),
  };
}

function findAlias(app: AppContext, alias: string) {
  const row = listAliasesForModeration(app, { alias, limit: 1 })[0];
  if (!row) throw new HttpError(404, 'not-found');
  return row;
}

export function registerAdminRoutes(router: Router, app: AppContext): void {
  app.db.function('abax_lower', { deterministic: true }, value => typeof value === 'string' ? value.toLowerCase() : '');

  router.get(ROOT + '/session', ctx => ({ json: { id: ctx.user!.id, displayName: ctx.user!.display_name } }));
  router.delete(ROOT + '/session', ctx => ({ status: 204, headers: { 'Set-Cookie': endAdminSession(ctx.app, ctx.req) } }), { maxBody: MAX_BODY });

  router.get(ROOT + '/summary', ctx => {
    const summary = ctx.app.db.prepare(`
      SELECT (SELECT count(*) FROM users) AS users,
        (SELECT count(*) FROM promo_codes WHERE disabled_at IS NULL AND (expires_at IS NULL OR expires_at > ?)
          AND (max_uses IS NULL OR uses < max_uses) AND plan IN ('pro', 'tutor') AND days >= 1) AS promos,
        (SELECT count(*) FROM payments WHERE status = 'pending') AS pendingPayments,
        (SELECT count(*) FROM public_aliases WHERE blocked_at IS NOT NULL) AS blockedAliases
    `).get(ctx.app.now()) as AdminSummary;
    return { json: summary };
  });

  router.get(ROOT + '/users', ctx => {
    const { page, offset, limit } = pagination(ctx);
    const q = search(ctx.query);
    const now = ctx.app.now();
    const rows = ctx.app.db.prepare(`
      SELECT id, display_name, email, google_email, google_sub, tg_id, tg_username, plan, plan_expires_at, plan_trial, created_at
      FROM users
      WHERE @q = '' OR instr(abax_lower(id), @q) OR instr(abax_lower(display_name), @q)
        OR instr(abax_lower(email), @q) OR instr(abax_lower(google_email), @q)
        OR instr(abax_lower(tg_id), @q) OR instr('@' || abax_lower(tg_username), @q) AND tg_username IS NOT NULL
      ORDER BY created_at DESC, id LIMIT @limit OFFSET @offset
    `).all({ q, limit, offset }) as UserSummaryRow[];
    return { json: paged(rows.map(row => userView(row, now)), page) };
  });
  router.get(ROOT + '/users/:id', ctx => ({ json: userView(findUser(ctx.app, ctx.params.id), ctx.app.now()) }));

  router.patch(ROOT + '/users/:id/plan', async ctx => {
    const { plan, days, reason } = await confirmed(ctx);
    const { db } = ctx.app;
    return db.transaction(() => {
      const now = ctx.app.now();
      if (!isPlanTier(plan) || (days != null && !validPlanDays(days, now))) throw new HttpError(400, 'bad-plan');
      const before = findUser(ctx.app, ctx.params.id);
      setUserPlanRow(db, before.id, plan, now, days ?? undefined);
      const after = findUser(ctx.app, before.id);
      audit(ctx, 'plan.set', before.id, reason, { before: planSnapshot(before), after: planSnapshot(after) }, now);
      return { json: userView(after, now) };
    }).immediate();
  }, { maxBody: MAX_BODY });

  router.get(ROOT + '/promos', ctx => {
    const { page, limit, offset } = pagination(ctx);
    const q = search(ctx.query);
    const now = ctx.app.now();
    const rows = ctx.app.db.prepare('SELECT * FROM promo_codes WHERE instr(code, ?) > 0 ORDER BY created_at DESC, code LIMIT ? OFFSET ?')
      .all(q.toUpperCase(), limit, offset) as PromoCodeRow[];
    return { json: paged(rows.map(row => promoView(ctx.app, row, now)), page) };
  });
  router.post(ROOT + '/promos', async ctx => {
    const { code, plan, days, maxUses, validDays, reason } = await confirmed(ctx);
    const { db } = ctx.app;
    return db.transaction(() => {
      const now = ctx.app.now();
      const promo = promoDefinition({ code, plan, days, maxUses, validDays }, now);
      if (!promo) throw new HttpError(400, 'bad-promo');
      if (!createPromoCode(db, promo.code, promo.effect, now, promo)) throw new HttpError(409, 'promo-exists');
      const reference = promoReference(ctx.app, promo.code);
      audit(ctx, 'promo.create', reference, reason, { ...promo.effect, maxUses: promo.maxUses, expiresAt: promo.expiresAt }, now);
      return { status: 201, json: { reference } };
    }).immediate();
  }, { maxBody: MAX_BODY });
  router.patch(ROOT + '/promos/disable', async ctx => {
    const { reason, code: raw } = await confirmed(ctx);
    const code = normalizePromoCode(raw);
    if (!code) throw new HttpError(404, 'not-found');
    const { db } = ctx.app;
    return db.transaction(() => {
      const now = ctx.app.now();
      const before = db.prepare('SELECT disabled_at, uses FROM promo_codes WHERE code = ?').get(code) as Pick<PromoCodeRow, 'disabled_at' | 'uses'> | undefined;
      if (!before) throw new HttpError(404, 'not-found');
      if (before.disabled_at !== null) throw new HttpError(409, 'no-change');
      db.prepare('UPDATE promo_codes SET disabled_at = ? WHERE code = ?').run(now, code);
      audit(ctx, 'promo.disable', promoReference(ctx.app, code), reason, { disabledAt: now, uses: before.uses }, now);
      return { json: { ok: true } };
    }).immediate();
  }, { maxBody: MAX_BODY });

  router.get(ROOT + '/payments', ctx => {
    const { page, limit, offset } = pagination(ctx);
    const q = search(ctx.query);
    const rows = ctx.app.db.prepare(`
      SELECT p.id, c.provider_id AS providerId, p.user_id AS userId, u.display_name AS userName,
        COALESCE(u.email, u.google_email) AS email, p.plan, p.amount, p.status, p.provider,
        p.created_at AS createdAt, p.resolved_at AS resolvedAt
      FROM payments p JOIN users u ON u.id = p.user_id LEFT JOIN yookassa_checkouts c ON c.payment_id = p.id
      WHERE @q = '' OR instr(abax_lower(p.id), @q) OR instr(abax_lower(c.provider_id), @q) OR instr(abax_lower(u.id), @q)
        OR instr(abax_lower(u.display_name), @q) OR instr(abax_lower(u.email), @q) OR instr(abax_lower(u.google_email), @q)
      ORDER BY p.created_at DESC, p.id LIMIT @limit OFFSET @offset
    `).all({ q, limit, offset }) as AdminPayment[];
    return { json: paged(rows, page) };
  });

  router.get(ROOT + '/aliases', ctx => {
    const { page, offset, limit } = pagination(ctx);
    const rows: AdminAlias[] = listAliasesForModeration(ctx.app, { limit, offset, search: search(ctx.query) })
      .map(({ alias, state, ownerId, ownerName, ownerEmail, projectId, blockedAt, blockedReason }) =>
        ({ alias, state, ownerId, ownerName, ownerEmail, projectId, blockedAt, blockedReason }));
    return { json: paged(rows, page) };
  });
  router.patch(ROOT + '/aliases/:alias', async ctx => {
    const { blocked, reason } = await confirmed(ctx);
    if (typeof blocked !== 'boolean') throw new HttpError(400, 'bad-request');
    return ctx.app.db.transaction(() => {
      const before = findAlias(ctx.app, ctx.params.alias);
      if ((before.blockedAt !== null) === blocked) throw new HttpError(409, 'no-change');
      setAliasBlocked(ctx.app, before.alias, blocked, blocked ? reason : null);
      const after = findAlias(ctx.app, before.alias);
      audit(ctx, blocked ? 'alias.block' : 'alias.unblock', before.alias, reason,
        { before: before.blockedAt, after: after.blockedAt, state: before.state }, ctx.app.now());
      return { json: { ok: true } };
    }).immediate();
  }, { maxBody: MAX_BODY });

  router.get(ROOT + '/audit', ctx => {
    const { page, limit, offset } = pagination(ctx);
    const operation = ctx.query.get('operation') ?? '';
    if (operation && !Object.hasOwn(AUDIT_OPERATIONS, operation)) throw new HttpError(400, 'bad-operation');
    const q = search(ctx.query);
    const rows = ctx.app.db.prepare(`
      SELECT a.id, a.admin_id AS adminId, u.display_name AS adminName, a.created_at AS createdAt, a.operation,
        a.object_id AS objectId, a.reason, a.change_json AS changeJson
      FROM admin_audit a LEFT JOIN users u ON u.id = a.admin_id
      WHERE (@operation = '' OR a.operation = @operation)
        AND (@q = '' OR instr(abax_lower(a.admin_id), @q) OR instr(abax_lower(u.display_name), @q) OR instr(abax_lower(a.object_id), @q))
      ORDER BY a.id DESC LIMIT @limit OFFSET @offset
    `).all({ q, operation, limit, offset }) as (Omit<AdminAudit, 'change'> & { changeJson: string })[];
    return { json: paged(rows.map(({ changeJson, ...row }) => ({ ...row, change: JSON.parse(changeJson) as AdminAudit['change'] })), page) };
  });
}
