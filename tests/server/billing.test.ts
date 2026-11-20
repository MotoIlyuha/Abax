// Подписка: покупка (тестовая на dev-сервере), пробный период Tutor, промокоды и история.
import { afterEach, describe, expect, it } from 'vitest';
import { DAY_MS, PRICES } from '../../src/billing';
import { createPromoCode } from '../../server/billing';
import { anon, call, closeApps, makeApp, type TestApp } from './helpers';

afterEach(closeApps);

/** Вход по почте на dev-сервере: код приходит в ответе. */
async function emailLogin(app: TestApp, email: string): Promise<{ token: string; id: string }> {
  const a = await anon(app);
  const s = await call(app, 'POST', '/api/auth/email/start', { email });
  const v = await call(app, 'POST', '/api/auth/email/verify', { email, code: s.body.devCode }, { token: a.token });
  if (v.status !== 200) throw new Error(`login: ${v.status} ${JSON.stringify(v.body)}`);
  return { token: v.body.token, id: v.body.user.id };
}

describe('подписка: покупка и пробный период', () => {
  it('аноним видит сведения, но купить, взять пробный и ввести промокод не может', async () => {
    const app = await makeApp({ devAuth: true });
    const a = await anon(app);
    const info = await call(app, 'GET', '/api/billing', undefined, { token: a.token });
    expect(info.status).toBe(200);
    expect(info.body).toMatchObject({ plan: 'free', trial: false, trialAvailable: false, payments: [], promos: [] });
    for (const [path, body] of [['/api/billing/checkout', { plan: 'pro', period: 'month' }], ['/api/billing/trial', {}], ['/api/billing/promo', { code: 'ABAX-PRO-30' }]] as const) {
      const r = await call(app, 'POST', path, body, { token: a.token });
      expect(r.status).toBe(403);
      expect(r.body.error).toBe('login-required');
    }
  });

  it('dev-сервер: оплата проходит сразу, срок того же тарифа складывается, платёж — в истории', async () => {
    const app = await makeApp({ devAuth: true });
    const u = await emailLogin(app, 'kapi@bara.ru');
    const now = app.clock.t;
    const r = await call(app, 'POST', '/api/billing/checkout', { plan: 'pro', period: 'quarter' }, { token: u.token });
    expect(r.status).toBe(200);
    expect(r.body.me.plan).toBe('pro');
    expect(r.body.billing.planExpiresAt).toBe(now + 90 * DAY_MS);
    expect(r.body.billing.payments).toEqual([expect.objectContaining({ plan: 'pro', period: 'quarter', amount: PRICES.pro.quarter, status: 'paid', days: 90 })]);
    const again = await call(app, 'POST', '/api/billing/checkout', { plan: 'pro', period: 'month' }, { token: u.token });
    expect(again.body.billing.planExpiresAt).toBe(now + 120 * DAY_MS);
    expect(again.body.billing.payments).toHaveLength(2);
    // Tutor старше Pro — начинается сейчас
    const tutor = await call(app, 'POST', '/api/billing/checkout', { plan: 'tutor', period: 'year' }, { token: u.token });
    expect(tutor.body.me.plan).toBe('tutor');
    expect(tutor.body.billing.planExpiresAt).toBe(now + 365 * DAY_MS);
    expect((await call(app, 'POST', '/api/billing/checkout', { plan: 'max', period: 'month' }, { token: u.token })).status).toBe(400);
  });

  it('без dev-сервера оплата выключена (503), тариф не меняется', async () => {
    const app = await makeApp({ devAuth: false });
    const a = await anon(app);
    app.db.prepare("UPDATE users SET email = 'x@y.ru' WHERE id = ?").run(a.id);
    const r = await call(app, 'POST', '/api/billing/checkout', { plan: 'pro', period: 'month' }, { token: a.token });
    expect(r.status).toBe(503);
    expect(r.body.error).toBe('payments-disabled');
    expect((await call(app, 'GET', '/api/billing', undefined, { token: a.token })).body).toMatchObject({ plan: 'free', paymentsEnabled: false });
  });

  it('пробный Tutor на 14 дней — один раз; истекает в free', async () => {
    const app = await makeApp({ devAuth: true });
    const u = await emailLogin(app, 'trial@bara.ru');
    expect((await call(app, 'GET', '/api/billing', undefined, { token: u.token })).body.trialAvailable).toBe(true);
    const r = await call(app, 'POST', '/api/billing/trial', {}, { token: u.token });
    expect(r.status).toBe(200);
    expect(r.body.billing).toMatchObject({ plan: 'tutor', trial: true, trialAvailable: false, planExpiresAt: app.clock.t + 14 * DAY_MS });
    expect(r.body.me.planTrial).toBe(true);
    expect(r.body.billing.payments[0]).toMatchObject({ status: 'trial', amount: 0, days: 14, period: null });
    expect((await call(app, 'POST', '/api/billing/trial', {}, { token: u.token })).body.error).toBe('trial-used');
    app.clock.t += 15 * DAY_MS;
    const later = await call(app, 'GET', '/api/billing', undefined, { token: u.token });
    expect(later.body).toMatchObject({ plan: 'free', trial: false, trialAvailable: false, planExpiresAt: null });
  });

  it('пробный период не берётся поверх оплаченного тарифа; покупка снимает признак пробного', async () => {
    const app = await makeApp({ devAuth: true });
    const u = await emailLogin(app, 'paid@bara.ru');
    await call(app, 'POST', '/api/billing/checkout', { plan: 'pro', period: 'month' }, { token: u.token });
    expect((await call(app, 'POST', '/api/billing/trial', {}, { token: u.token })).body.error).toBe('plan-active');
    const v = await emailLogin(app, 'trial2@bara.ru');
    await call(app, 'POST', '/api/billing/trial', {}, { token: v.token });
    const bought = await call(app, 'POST', '/api/billing/checkout', { plan: 'tutor', period: 'month' }, { token: v.token });
    expect(bought.body.billing).toMatchObject({ plan: 'tutor', trial: false, planExpiresAt: app.clock.t + 44 * DAY_MS });
  });
});

describe('промокоды', () => {
  it('код из базы: даёт тариф, повторно — нельзя, история с датой и эффектом', async () => {
    const app = await makeApp({ devAuth: false });
    createPromoCode(app.db, 'SPRING-2026', { plan: 'pro', days: 30 }, app.clock.t);
    const a = await anon(app);
    app.db.prepare("UPDATE users SET email = 'p@bara.ru' WHERE id = ?").run(a.id);
    const r = await call(app, 'POST', '/api/billing/promo', { code: ' spring-2026 ' }, { token: a.token });
    expect(r.status).toBe(200);
    expect(r.body.effect).toEqual({ plan: 'pro', days: 30 });
    expect(r.body.me.plan).toBe('pro');
    expect(r.body.billing.promos).toEqual([{ code: 'SPRING-2026', effect: { plan: 'pro', days: 30 }, redeemedAt: app.clock.t }]);
    const again = await call(app, 'POST', '/api/billing/promo', { code: 'SPRING-2026' }, { token: a.token });
    expect(again.status).toBe(409);
    expect(again.body.error).toBe('promo-used');
    expect((await call(app, 'POST', '/api/billing/promo', { code: 'NOPE-NOPE' }, { token: a.token })).body.error).toBe('promo-not-found');
    expect((await call(app, 'POST', '/api/billing/promo', { code: '!' }, { token: a.token })).body.error).toBe('bad-promo');
  });

  it('лимит активаций и срок кода', async () => {
    const app = await makeApp({ devAuth: true });
    createPromoCode(app.db, 'ONE-USE', { plan: 'tutor', days: 7 }, app.clock.t, { maxUses: 1 });
    createPromoCode(app.db, 'OLD-CODE', { plan: 'pro', days: 7 }, app.clock.t, { expiresAt: app.clock.t + 1000 });
    const a = await emailLogin(app, 'a@bara.ru');
    const b = await emailLogin(app, 'b@bara.ru');
    expect((await call(app, 'POST', '/api/billing/promo', { code: 'ONE-USE' }, { token: a.token })).status).toBe(200);
    expect((await call(app, 'POST', '/api/billing/promo', { code: 'ONE-USE' }, { token: b.token })).body.error).toBe('promo-not-found');
    app.clock.t += 2000;
    expect((await call(app, 'POST', '/api/billing/promo', { code: 'OLD-CODE' }, { token: b.token })).body.error).toBe('promo-not-found');
  });

  it('тестовые коды — только на dev-сервере и только у тестового аккаунта', async () => {
    const dev = await makeApp({ devAuth: true });
    const tester = await emailLogin(dev, 'me@abax.test');
    const stranger = await emailLogin(dev, 'me@bara.ru');
    const ok = await call(dev, 'POST', '/api/billing/promo', { code: 'abax-pro-30' }, { token: tester.token });
    expect(ok.status).toBe(200);
    expect(ok.body.me.plan).toBe('pro');
    expect((await call(dev, 'POST', '/api/billing/promo', { code: 'ABAX-PRO-30' }, { token: tester.token })).body.error).toBe('promo-used');
    const tutor = await call(dev, 'POST', '/api/billing/promo', { code: 'ABAX-TUTOR-7' }, { token: tester.token });
    expect(tutor.body.me.plan).toBe('tutor');
    expect(tutor.body.billing.promos.map((p: { code: string }) => p.code)).toEqual(['ABAX-TUTOR-7', 'ABAX-PRO-30']);
    expect((await call(dev, 'POST', '/api/billing/promo', { code: 'ABAX-PRO-30' }, { token: stranger.token })).body.error).toBe('promo-not-found');

    const prod = await makeApp({ devAuth: false });
    const a = await anon(prod);
    prod.db.prepare("UPDATE users SET email = 'me@abax.test' WHERE id = ?").run(a.id);
    expect((await call(prod, 'POST', '/api/billing/promo', { code: 'ABAX-PRO-30' }, { token: a.token })).body.error).toBe('promo-not-found');
  });

  it('перебор кодов ограничен', async () => {
    const app = await makeApp({ devAuth: true });
    const u = await emailLogin(app, 'brute@bara.ru');
    let last = 0;
    for (let i = 0; i < 11; i++) last = (await call(app, 'POST', '/api/billing/promo', { code: `GUESS-${i}` }, { token: u.token })).status;
    expect(last).toBe(429);
  });
});
