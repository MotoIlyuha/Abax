import { randomUUID } from 'node:crypto';
import { PERIOD_DAYS, PLAN_TITLES, PRICES, type BillingPeriod, type PaidPlan } from '../src/billing';
import type { AppContext } from './context';
import type { PaymentRow, UserRow } from './db';
import { HttpError } from './router';
import { grantPlan } from './billing';
import { getUser } from './users';

interface CheckoutRow extends PaymentRow {
  provider_id: string | null;
  request_json: string;
  confirmation_url: string | null;
}

interface ProviderPayment {
  id: string;
  status: string;
  paid?: boolean;
  amount?: { value?: string; currency?: string };
  metadata?: { paymentId?: string };
  confirmation?: { confirmation_url?: string };
}

const SELECT = 'SELECT p.*, c.provider_id, c.request_json, c.confirmation_url FROM payments p JOIN yookassa_checkouts c ON c.payment_id = p.id';

export function yookassaEnabled(app: AppContext): boolean {
  if (!app.opts.yookassaShopId || !app.opts.yookassaSecretKey) return false;
  try { return new URL(app.opts.publicWebUrl).protocol === 'https:'; } catch { return false; }
}

/** Все запросы идут только в API провайдера; секрет и тело ошибки не попадают в ответ клиенту. */
async function request(app: AppContext, path: string, body?: string, key?: string): Promise<ProviderPayment> {
  if (!yookassaEnabled(app)) throw new HttpError(503, 'payments-disabled');
  try {
    const r = await app.fetch(`https://api.yookassa.ru/v3/payments${path}`, {
      method: body ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(15_000),
      headers: {
        Authorization: `Basic ${Buffer.from(`${app.opts.yookassaShopId}:${app.opts.yookassaSecretKey}`).toString('base64')}`,
        'Content-Type': 'application/json', ...(key ? { 'Idempotence-Key': key } : {}),
      },
      ...(body ? { body } : {}),
    });
    if (!r.ok) throw new Error('provider');
    const p = await r.json() as ProviderPayment;
    if (!p || typeof p.id !== 'string' || !/^[a-zA-Z0-9-]{1,64}$/.test(p.id) || !['pending', 'waiting_for_capture', 'succeeded', 'canceled'].includes(p.status)) throw new Error('provider');
    return p;
  } catch { throw new HttpError(502, 'payment-provider-unavailable'); }
}

/** Разрешены только страницы подтверждения ЮKassa, включая тестовый магазин. */
function confirmationUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && !u.username && !u.password && !u.port
      && ['yoomoney.ru', 'yookassa.ru'].includes(u.hostname) ? u.href : null;
  } catch { return null; }
}

/** Проверяем сумму и привязку по данным API, а не по телу уведомления. Выдача и статус — одна транзакция. */
function applyPayment(app: AppContext, row: CheckoutRow, p: ProviderPayment): void {
  if ((row.provider_id && row.provider_id !== p.id) || p.metadata?.paymentId !== row.id
    || p.amount?.currency !== 'RUB' || p.amount?.value !== row.amount.toFixed(2)) throw new HttpError(502, 'payment-mismatch');
  const url = confirmationUrl(p.confirmation?.confirmation_url);
  app.db.transaction(() => {
    app.db.prepare('UPDATE yookassa_checkouts SET provider_id = ?, confirmation_url = COALESCE(?, confirmation_url) WHERE payment_id = ?')
      .run(p.id, url, row.id);
    if (p.status === 'succeeded' && p.paid === true) {
      const updated = app.db.prepare("UPDATE payments SET status = 'paid' WHERE id = ? AND status = 'pending'").run(row.id);
      if (updated.changes) grantPlan(app.db, getUser(app.db, row.user_id)!, { plan: row.plan as PaidPlan, days: row.days }, app.now());
    } else if (p.status === 'canceled') {
      app.db.prepare("UPDATE payments SET status = 'canceled' WHERE id = ? AND status = 'pending'").run(row.id);
    }
  })();
}

/** Повтор создания после сетевого сбоя использует сохранённые тело и ключ идемпотентности. */
async function resolvePayment(app: AppContext, row: CheckoutRow): Promise<void> {
  // ЮKassa хранит ключ 24 часа: неопределённый старый запрос нельзя отправлять как новую покупку.
  if (!row.provider_id && app.now() - row.created_at >= 23 * 3600_000) throw new HttpError(409, 'payment-review-required');
  const p = row.provider_id
    ? await request(app, `/${encodeURIComponent(row.provider_id)}`)
    : await request(app, '', row.request_json, row.id);
  applyPayment(app, row, p);
}

export async function createCheckout(app: AppContext, user: UserRow, plan: PaidPlan, period: BillingPeriod): Promise<string | null> {
  if (!app.rateLimit(`checkout:${user.id}`, 10, 60_000)) throw new HttpError(429, 'rate-limited');
  let row = app.db.prepare(`${SELECT} WHERE p.user_id = ? AND p.plan = ? AND p.period = ? AND p.status = 'pending' ORDER BY p.created_at DESC LIMIT 1`)
    .get(user.id, plan, period) as CheckoutRow | undefined;
  if (!row) {
    const id = randomUUID();
    const body = JSON.stringify({
      amount: { value: PRICES[plan][period].toFixed(2), currency: 'RUB' }, capture: true,
      confirmation: { type: 'redirect', return_url: app.opts.publicWebUrl },
      description: `Abax: ${PLAN_TITLES[plan]}, ${PERIOD_DAYS[period]} дней`, metadata: { paymentId: id },
    });
    app.db.transaction(() => {
      app.db.prepare('INSERT INTO payments (id, user_id, plan, period, days, amount, status, provider, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(id, user.id, plan, period, PERIOD_DAYS[period], PRICES[plan][period], 'pending', 'yookassa', app.now());
      app.db.prepare('INSERT INTO yookassa_checkouts (payment_id, request_json) VALUES (?, ?)').run(id, body);
    })();
    row = app.db.prepare(`${SELECT} WHERE p.id = ?`).get(id) as CheckoutRow;
  }
  await resolvePayment(app, row);
  const latest = app.db.prepare(`${SELECT} WHERE p.id = ?`).get(row.id) as CheckoutRow;
  if (latest.status === 'canceled') throw new HttpError(409, 'payment-canceled');
  if (latest.status === 'paid') return null;
  if (!latest.confirmation_url) throw new HttpError(502, 'payment-provider-unavailable');
  return latest.confirmation_url;
}

/** Возврат в приложение также проверяет незавершённые покупки, если уведомление задержалось. */
export async function refreshPayments(app: AppContext, userId: string): Promise<void> {
  if (!yookassaEnabled(app) || !app.rateLimit(`payment-refresh:${userId}`, 1, 5000)) return;
  const rows = app.db.prepare(`${SELECT} WHERE p.user_id = ? AND p.status = 'pending' ORDER BY p.created_at DESC LIMIT 10`).all(userId) as CheckoutRow[];
  await Promise.all(rows.map(async row => {
    try { await resolvePayment(app, row); } catch { /* Недоступность провайдера не скрывает историю подписки. */ }
  }));
}

export async function paymentNotification(app: AppContext, id: string): Promise<void> {
  if (!yookassaEnabled(app)) throw new HttpError(503, 'payments-disabled');
  // После сбоя создания provider_id может ещё отсутствовать: восстанавливаем привязку по проверенным metadata.
  let row = app.db.prepare(`${SELECT} WHERE c.provider_id = ?`).get(id) as CheckoutRow | undefined;
  if (row && row.status !== 'pending') return;
  const p = await request(app, `/${encodeURIComponent(id)}`);
  if (p.id !== id) throw new HttpError(502, 'payment-mismatch');
  if (!row && p.metadata?.paymentId) row = app.db.prepare(`${SELECT} WHERE p.id = ?`).get(p.metadata.paymentId) as CheckoutRow | undefined;
  if (row) applyPayment(app, row, p);
}
