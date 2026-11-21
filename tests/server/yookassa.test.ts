import { afterEach, describe, expect, it, vi } from 'vitest';
import { DAY_MS, PRICES } from '../../src/billing';
import { anon, call, closeApps, makeApp } from './helpers';

afterEach(closeApps);

async function setup() {
  let payment: any;
  let fail = false;
  const requests: RequestInit[] = [];
  const provider = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    expect(String(input)).toMatch(/^https:\/\/api\.yookassa\.ru\/v3\/payments/);
    expect((init?.headers as Record<string, string>).Authorization).toBe(`Basic ${Buffer.from('shop:secret').toString('base64')}`);
    if (init?.method === 'POST') {
      requests.push(init);
      const body = JSON.parse(init.body as string);
      payment ??= { id: 'provider-payment-1', status: 'pending', paid: false, amount: body.amount,
        metadata: body.metadata, confirmation: { confirmation_url: 'https://yoomoney.ru/checkout/payments/test' } };
    }
    if (fail) throw new Error('обрыв сети');
    return Response.json(payment);
  });
  const app = await makeApp({ devAuth: true, yookassaShopId: 'shop', yookassaSecretKey: 'secret', fetch: provider });
  const user = await anon(app);
  app.db.prepare("UPDATE users SET email = 'buyer@example.com' WHERE id = ?").run(user.id);
  const buy = () => call(app, 'POST', '/api/billing/checkout', { plan: 'pro', period: 'month', amount: 1 }, { token: user.token });
  const info = () => call(app, 'GET', '/api/billing', undefined, { token: user.token });
  const notify = (object: any = { id: 'provider-payment-1', status: 'succeeded', paid: true }) =>
    call(app, 'POST', '/api/billing/yookassa/webhook', { type: 'notification', event: 'payment.succeeded', object });
  return { app, user, buy, info, notify, requests, provider, payment: () => payment, fail: (v: boolean) => { fail = v; } };
}

describe('ЮKassa', () => {
  it('цена и срок берутся с сервера; до подтверждения тариф бесплатный, секреты не выдаются', async () => {
    const t = await setup();
    const r = await t.buy();
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ confirmationUrl: 'https://yoomoney.ru/checkout/payments/test', me: { plan: 'free' },
      billing: { paymentsEnabled: true, payments: [{ amount: PRICES.pro.month, status: 'pending', days: 30 }] } });
    const sent = JSON.parse(t.requests[0].body as string);
    expect(sent).toMatchObject({ capture: true, amount: { value: '399.00', currency: 'RUB' },
      confirmation: { type: 'redirect', return_url: 'https://abax.example' } });
    expect(JSON.stringify(r.body)).not.toContain('secret');
    await t.buy();
    expect(t.requests).toHaveLength(1);
    expect(t.app.db.prepare('SELECT count(*) AS n FROM payments').get()).toEqual({ n: 1 });
  });

  it('поддельный статус уведомления не выдаёт тариф; подтверждение через API выдаёт один раз', async () => {
    const t = await setup();
    await t.buy();
    expect((await t.notify()).status).toBe(200);
    expect((await t.info()).body.plan).toBe('free');
    t.payment().status = 'succeeded';
    t.payment().paid = true;
    await Promise.all([t.notify(), t.notify(), t.info()]);
    expect((await t.info()).body).toMatchObject({ plan: 'pro', planExpiresAt: t.app.clock.t + 30 * DAY_MS });
    await t.notify();
    expect((await t.info()).body.planExpiresAt).toBe(t.app.clock.t + 30 * DAY_MS);
  });

  it.each(['amount', 'currency', 'metadata', 'id'])('несовпадение %s не выдаёт подписку', async field => {
    const t = await setup();
    await t.buy();
    t.payment().status = 'succeeded';
    t.payment().paid = true;
    if (field === 'amount') t.payment().amount.value = '1.00';
    if (field === 'currency') t.payment().amount.currency = 'USD';
    if (field === 'metadata') t.payment().metadata.paymentId = 'other';
    if (field === 'id') t.payment().id = 'other';
    expect((await t.notify()).status).toBe(502);
    expect((await t.info()).body.plan).toBe('free');
  });

  it('отмена сохраняется в истории, тариф не выдаётся', async () => {
    const t = await setup();
    await t.buy();
    t.payment().status = 'canceled';
    await t.notify();
    expect((await t.info()).body).toMatchObject({ plan: 'free', payments: [{ status: 'canceled' }] });
  });

  it('сбой создания: повтор использует те же тело и ключ, уведомление может восстановить привязку', async () => {
    const t = await setup();
    t.fail(true);
    expect((await t.buy()).status).toBe(502);
    t.fail(false);
    expect((await t.buy()).status).toBe(200);
    expect(t.requests[0].body).toBe(t.requests[1].body);
    expect(t.requests[0].headers).toEqual(t.requests[1].headers);
    t.app.db.prepare('UPDATE yookassa_checkouts SET provider_id = NULL').run();
    t.payment().status = 'succeeded';
    t.payment().paid = true;
    expect((await t.notify()).status).toBe(200);
    expect((await t.info()).body.plan).toBe('pro');
  });

  it('старый неопределённый запрос не создаёт повторный платёж после истечения ключа', async () => {
    const t = await setup();
    t.fail(true);
    await t.buy();
    t.fail(false);
    t.app.clock.t += DAY_MS;
    expect((await t.buy()).body.error).toBe('payment-review-required');
    expect(t.requests).toHaveLength(1);
  });

  it('возвращение проверяет оплату без webhook; недоступность API не скрывает историю', async () => {
    const t = await setup();
    await t.buy();
    t.fail(true);
    expect((await t.info()).body.plan).toBe('free');
    t.fail(false);
    t.payment().status = 'succeeded';
    t.payment().paid = true;
    t.app.clock.t += 5001;
    expect((await t.info()).body.plan).toBe('pro');
  });

  it('частичная конфигурация не включает тестовую выдачу даже на dev-сервере', async () => {
    const app = await makeApp({ devAuth: true, yookassaShopId: 'shop' });
    const u = await anon(app);
    app.db.prepare("UPDATE users SET email = 'a@b.ru' WHERE id = ?").run(u.id);
    expect((await call(app, 'POST', '/api/billing/checkout', { plan: 'pro', period: 'month' }, { token: u.token })).status).toBe(503);
  });
});
