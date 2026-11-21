import { randomUUID } from 'node:crypto';
import {
  DEV_PROMO_CODES, PERIOD_DAYS, PRICES, TRIAL_DAYS, TRIAL_PLAN, extendPlan, isBillingPeriod, isPaidPlan, normalizePromoCode,
  type BillingInfo, type PaidPlan, type PaymentInfo, type PromoEffect, type PromoRedemptionInfo,
} from '../src/billing';
import type { AppContext } from './context';
import type { Db, PaymentRow, PromoCodeRow, PromoRedemptionRow, UserRow } from './db';
import { DEV_GOOGLE, DEV_TELEGRAM } from './auth-flows';
import { requireUser } from './auth';
import { HttpError, type Ctx, type Router } from './router';
import { effectivePlan, getUser, isAnonymousUser, meResponse } from './users';
import { createCheckout, paymentNotification, refreshPayments, yookassaEnabled } from './yookassa';

// Подписка (окно подписки и раздел настроек «Подписка»): сведения, покупка, пробный период Tutor и промокоды.
// Купить, взять пробный период и ввести промокод можно только после входа (аноним — 403 login-required).
// ЮKassa выдаёт тариф после подтверждения; без её настроек на dev-сервере оплата тестовая и проходит сразу.
// Промокоды проверяет только сервер; один аккаунт активирует
// код один раз. Тестовые коды (DEV_PROMO_CODES) — только на dev-сервере и только у тестового аккаунта.

/** Попыток ввода промокода на аккаунт в час (перебор кодов). */
export const PROMO_RATE_MAX = 10;
const PROMO_RATE_WINDOW_MS = 3600_000;

/** Тестовый аккаунт: dev-вход Telegram или Google либо почта в зарезервированной зоне abax.test. */
export function isTestAccount(user: UserRow): boolean {
  return user.tg_id === DEV_TELEGRAM.subject || user.google_sub === DEV_GOOGLE.subject || /@(?:[a-z0-9-]+\.)*abax\.test$/i.test(user.email ?? '');
}

/** Настроенная ЮKassa имеет приоритет перед тестовой оплатой. */
export function paymentsEnabled(app: AppContext): boolean {
  return yookassaEnabled(app) || (!app.opts.yookassaShopId && !app.opts.yookassaSecretKey && app.opts.devAuth);
}

function requireAccount(ctx: Ctx): UserRow {
  const user = requireUser(ctx);
  if (isAnonymousUser(user)) throw new HttpError(403, 'login-required');
  return user;
}

/** Выдать тариф на срок (покупка, промокод, пробный период): см. extendPlan. */
export function grantPlan(db: Db, user: UserRow, grant: { plan: PaidPlan; days: number }, now: number, trial = false): void {
  const next = extendPlan({ plan: effectivePlan(user, now), expiresAt: user.plan_expires_at }, grant, now);
  db.prepare('UPDATE users SET plan = ?, plan_expires_at = ?, plan_trial = ?, updated_at = ? WHERE id = ?')
    .run(next.plan, next.expiresAt, trial ? 1 : 0, now, user.id);
}

export function billingInfo(app: AppContext, user: UserRow): BillingInfo {
  const now = app.now();
  const plan = effectivePlan(user, now);
  const payments = (app.db.prepare('SELECT * FROM payments WHERE user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 100').all(user.id) as PaymentRow[])
    .filter(p => isPaidPlan(p.plan))
    .map((p): PaymentInfo => ({
      id: p.id, plan: p.plan as PaidPlan, period: isBillingPeriod(p.period) ? p.period : null, days: p.days,
      amount: p.amount, status: p.status === 'trial' ? 'trial' : p.status === 'pending' ? 'pending' : p.status === 'canceled' ? 'canceled' : 'paid', createdAt: p.created_at,
    }));
  const promos = (app.db.prepare('SELECT * FROM promo_redemptions WHERE user_id = ? ORDER BY redeemed_at DESC, rowid DESC LIMIT 100').all(user.id) as PromoRedemptionRow[])
    .filter(r => isPaidPlan(r.plan))
    .map((r): PromoRedemptionInfo => ({ code: r.code, effect: { plan: r.plan as PaidPlan, days: r.days }, redeemedAt: r.redeemed_at }));
  return {
    plan,
    planExpiresAt: plan === 'free' ? null : user.plan_expires_at,
    trial: plan !== 'free' && user.plan_trial === 1,
    trialAvailable: user.trial_used_at === null && !isAnonymousUser(user),
    paymentsEnabled: paymentsEnabled(app),
    payments,
    promos,
  };
}

/** Ответ после изменения подписки: сведения о подписке и то же, что /api/me. */
function changed(app: AppContext, userId: string, extra: Record<string, unknown> = {}) {
  const user = getUser(app.db, userId)!;
  return { json: { ...extra, billing: billingInfo(app, user), me: meResponse(user, app.now(), app.opts.enforceLimits) } };
}

/** Промокод из базы или (dev-сервер, тестовый аккаунт) из тестового списка; null — такого нет или он закончился. */
function findPromo(app: AppContext, user: UserRow, code: string): { effect: PromoEffect; row: PromoCodeRow | null } | null {
  const row = (app.db.prepare('SELECT * FROM promo_codes WHERE code = ?').get(code) as PromoCodeRow | undefined) ?? null;
  if (row) {
    if (!isPaidPlan(row.plan) || !(row.days >= 1)) return null;
    if (row.expires_at !== null && row.expires_at <= app.now()) return null;
    if (row.max_uses !== null && row.uses >= row.max_uses) return null;
    return { effect: { plan: row.plan, days: row.days }, row };
  }
  const dev = DEV_PROMO_CODES[code];
  if (dev && app.opts.devAuth && isTestAccount(user)) return { effect: dev, row: null };
  return null;
}

/** Завести промокод (оператор, server/promo-cli.ts). false — такой код уже есть. */
export function createPromoCode(db: Db, code: string, effect: PromoEffect, now: number, opts: { maxUses?: number | null; expiresAt?: number | null } = {}): boolean {
  const r = db.prepare('INSERT OR IGNORE INTO promo_codes (code, plan, days, max_uses, uses, expires_at, created_at) VALUES (?, ?, ?, ?, 0, ?, ?)')
    .run(code, effect.plan, effect.days, opts.maxUses ?? null, opts.expiresAt ?? null, now);
  return r.changes > 0;
}

export function registerBillingRoutes(router: Router): void {
  router.get('/api/billing', async ctx => {
    const user = requireUser(ctx);
    await refreshPayments(ctx.app, user.id);
    return { json: billingInfo(ctx.app, getUser(ctx.app.db, user.id)!) };
  });

  router.post('/api/billing/yookassa/webhook', async ctx => {
    const body = await ctx.body() as { type?: unknown; event?: unknown; object?: { id?: unknown } } | undefined;
    if (body?.type !== 'notification' || !['payment.succeeded', 'payment.canceled'].includes(String(body.event))
      || typeof body.object?.id !== 'string' || !/^[a-zA-Z0-9-]{1,64}$/.test(body.object.id)) throw new HttpError(400, 'bad-request');
    if (!ctx.app.rateLimit(`payment-webhook:${ctx.ip}`, 120, 60_000)) throw new HttpError(429, 'rate-limited');
    await paymentNotification(ctx.app, body.object.id);
    return { json: { ok: true } };
  }, { maxBody: 65536 });

  router.post('/api/billing/checkout', async ctx => {
    const app = ctx.app;
    const user = requireAccount(ctx);
    const body = await ctx.body() as { plan?: unknown; period?: unknown } | undefined;
    if (!isPaidPlan(body?.plan) || !isBillingPeriod(body?.period)) throw new HttpError(400, 'bad-request');
    if (!paymentsEnabled(app)) throw new HttpError(503, 'payments-disabled');
    const { plan, period } = body;
    if (yookassaEnabled(app)) {
      const confirmationUrl = await createCheckout(app, user, plan, period);
      return changed(app, user.id, confirmationUrl ? { confirmationUrl } : {});
    }
    const now = app.now();
    app.db.transaction(() => {
      app.db.prepare('INSERT INTO payments (id, user_id, plan, period, days, amount, status, provider, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(randomUUID(), user.id, plan, period, PERIOD_DAYS[period], PRICES[plan][period], 'paid', 'dev', now);
      grantPlan(app.db, getUser(app.db, user.id)!, { plan, days: PERIOD_DAYS[period] }, now);
    })();
    return changed(app, user.id);
  }, { maxBody: 4096 });

  router.post('/api/billing/trial', ctx => {
    const app = ctx.app;
    const user = requireAccount(ctx);
    const now = app.now();
    if (user.trial_used_at !== null) throw new HttpError(409, 'trial-used');
    // пробный период не съедает уже оплаченный тариф
    if (effectivePlan(user, now) !== 'free') throw new HttpError(409, 'plan-active');
    app.db.transaction(() => {
      app.db.prepare('INSERT INTO payments (id, user_id, plan, period, days, amount, status, provider, created_at) VALUES (?, ?, ?, NULL, ?, 0, ?, ?, ?)')
        .run(randomUUID(), user.id, TRIAL_PLAN, TRIAL_DAYS, 'trial', 'trial', now);
      app.db.prepare('UPDATE users SET trial_used_at = ? WHERE id = ?').run(now, user.id);
      grantPlan(app.db, getUser(app.db, user.id)!, { plan: TRIAL_PLAN, days: TRIAL_DAYS }, now, true);
    })();
    return changed(app, user.id);
  }, { maxBody: 1024 });

  router.post('/api/billing/promo', async ctx => {
    const app = ctx.app;
    const user = requireAccount(ctx);
    const body = await ctx.body() as { code?: unknown } | undefined;
    const code = normalizePromoCode(body?.code);
    if (!code) throw new HttpError(400, 'bad-promo');
    if (!app.rateLimit(`promo:${user.id}`, PROMO_RATE_MAX, PROMO_RATE_WINDOW_MS)) throw new HttpError(429, 'rate-limited');
    const now = app.now();
    const effect = app.db.transaction((): PromoEffect => {
      if (app.db.prepare('SELECT 1 FROM promo_redemptions WHERE user_id = ? AND code = ?').get(user.id, code)) throw new HttpError(409, 'promo-used');
      const found = findPromo(app, user, code);
      if (!found) throw new HttpError(404, 'promo-not-found');
      if (found.row) app.db.prepare('UPDATE promo_codes SET uses = uses + 1 WHERE code = ?').run(code);
      app.db.prepare('INSERT INTO promo_redemptions (user_id, code, plan, days, redeemed_at) VALUES (?, ?, ?, ?, ?)')
        .run(user.id, code, found.effect.plan, found.effect.days, now);
      grantPlan(app.db, getUser(app.db, user.id)!, found.effect, now);
      return found.effect;
    })();
    return changed(app, user.id, { effect });
  }, { maxBody: 4096 });
}
