import { mkdtempSync, rmSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DAY_MS } from '../../src/billing';
import { migrate, openDb } from '../../server/db';
import { createUser, getUser } from '../../server/users';
import { anon, call, closeApps, makeApp, proj, putProject, setPlan, type Resp, type TestApp } from './helpers';

const origin = 'https://admin.abax.example';
const host = new URL(origin).host;
const adminId = 'c5703697-4e79-4632-8199-0ca761c01e59';
const adminMail = 'admin@abax.test';
const confirmation = { confirmed: true, reason: 'Решение по обращению' };

afterEach(closeApps);

async function setup(options: Parameters<typeof makeApp>[0] = {}) {
  const app = await makeApp({ adminOrigin: origin, secureCookies: true, adminAccounts: [[adminId, adminMail]], devAuth: true, ...options });
  const user = createUser(app.db, app.clock.t, { display_name: 'Администратор' });
  app.db.prepare('UPDATE users SET id = ?, email = ? WHERE id = ?').run(adminId, adminMail, user.id);
  return app;
}

function adminCall(app: TestApp, method: string, path: string, body?: unknown, cookie?: string, override?: Record<string, string>) {
  const data = body === undefined ? undefined : JSON.stringify(body);
  const headers = {
    Host: host, Origin: origin, ...(cookie ? { Cookie: cookie } : {}),
    ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}), ...override,
  };
  return new Promise<Resp>((resolve, reject) => {
    const req = request(app.base + path, { method, headers }, res => {
      const chunks: Buffer[] = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('error', reject);
      res.on('end', () => {
        const headers = new Headers();
        for (const [k, v] of Object.entries(res.headers)) if (v !== undefined) headers.set(k, String(v));
        const text = Buffer.concat(chunks).toString('utf8');
        resolve({ status: res.statusCode!, headers, body: text ? JSON.parse(text) : null });
      });
    });
    req.on('error', reject);
    req.end(data);
  });
}

async function login(app: TestApp, email = adminMail) {
  const start = await adminCall(app, 'POST', '/api/auth/email/start', { email });
  expect(start.status).toBe(200);
  return adminCall(app, 'POST', '/api/auth/email/verify', { email, code: start.body.devCode });
}

async function session(app: TestApp) {
  const result = await login(app);
  expect(result.status).toBe(200);
  return result.headers.get('set-cookie')!.split(';')[0];
}

describe('Доступ к панели', () => {
  it('закрыт без конфигурации, без сессии, на домене доски и для сессии доски', async () => {
    const disabled = await setup({ adminAccounts: [] });
    expect((await adminCall(disabled, 'GET', '/api/admin/session')).status).toBe(403);
    const app = await setup();
    expect((await adminCall(app, 'GET', '/api/admin/summary')).status).toBe(401);
    expect((await adminCall(app, 'PATCH', '/api/admin/users/id/plan', confirmation)).status).toBe(401);
    expect((await call(app, 'GET', '/api/admin/session')).status).toBe(404);
    expect((await call(app, 'GET', '/api//admin/session')).status).toBe(404);
    const boardStart = await call(app, 'POST', '/api/auth/email/start', { email: adminMail });
    expect((await adminCall(app, 'POST', '/api/auth/email/verify', { email: adminMail, code: boardStart.body.devCode })).status).toBe(400);
    const board = await call(app, 'POST', '/api/auth/email/verify', { email: adminMail, code: boardStart.body.devCode });
    expect(board.body.user.id).toBe(adminId);
    const r = await adminCall(app, 'GET', '/api/admin/users', undefined, board.headers.get('set-cookie')!.split(';')[0], { Authorization: 'Bearer ' + board.body.token });
    expect(r.status).toBe(401);
    expect(r.headers.get('access-control-allow-origin')).toBeNull();
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect((await call(app, 'GET', '/api/me', undefined, { token: board.body.token })).status).toBe(200);
  });

  it('подтверждённая почта обычного владельца платной доски и анонимный вход не дают доступа', async () => {
    const app = await setup();
    const owner = await anon(app);
    app.db.prepare("UPDATE users SET plan = 'tutor', email = 'owner@abax.test' WHERE id = ?").run(owner.id);
    expect((await putProject(app, owner.token, proj('owner-board'))).status).toBe(200);
    const denied = await login(app, 'owner@abax.test');
    expect(denied).toMatchObject({ status: 403, body: { error: 'admin-forbidden' } });
    expect(denied.headers.get('set-cookie')).toBeNull();
    const guest = await anon(app);
    app.app.opts.adminAccounts = new Map([[guest.id, 'new@abax.test']]);
    expect((await adminCall(app, 'GET', '/api/admin/users', undefined, undefined, { Authorization: 'Bearer ' + guest.token })).status).toBe(401);
    expect((await login(app, 'new@abax.test')).status).toBe(403);
    expect(app.db.prepare("SELECT 1 FROM users WHERE email = 'new@abax.test'").get()).toBeUndefined();
  });

  it('отдельная cookie выдается по коду, отзывается при выходе, а право и срок проверяются повторно', async () => {
    const app = await setup();
    const result = await login(app);
    expect(result.body).toEqual({ ok: true });
    const header = result.headers.get('set-cookie')!;
    expect(header).toMatch(/^__Host-abax_admin=.*; HttpOnly; Path=\/; SameSite=Strict; Max-Age=28800; Secure$/);
    expect(header).not.toContain('Domain=');
    const cookie = header.split(';')[0];
    expect((await adminCall(app, 'GET', '/api/admin/session', undefined, cookie)).body).toMatchObject({ id: adminId });
    expect((await adminCall(app, 'GET', '/api/me', undefined, cookie)).status).toBe(404);
    expect((await call(app, 'GET', '/api/admin/session', undefined, { headers: { Cookie: cookie } })).status).toBe(404);
    expect((await adminCall(app, 'POST', '/api/auth/email/start', { email: adminMail }, undefined, { Origin: 'https://board.abax.example' })).status).toBe(403);
    const invalid: Record<string, string>[] = [{ Origin: 'https://board.abax.example' }, { Origin: '' }, { 'Content-Type': 'text/plain' }];
    for (const headers of invalid) {
      expect((await adminCall(app, 'DELETE', '/api/admin/session', {}, cookie, headers)).status).toBe(403);
    }
    app.app.opts.adminAccounts = new Map([['other', adminMail]]);
    expect((await adminCall(app, 'GET', '/api/admin/session', undefined, cookie)).status).toBe(403);
    app.app.opts.adminAccounts = new Map([[adminId, adminMail]]);
    const exit = await adminCall(app, 'DELETE', '/api/admin/session', {}, cookie);
    expect(exit.status).toBe(204);
    expect(exit.headers.get('set-cookie')).toContain('Max-Age=0');
    expect((await adminCall(app, 'GET', '/api/admin/session', undefined, cookie)).status).toBe(401);
    const next = await session(app);
    app.clock.t += 8 * 3600_000;
    expect((await adminCall(app, 'GET', '/api/admin/session', undefined, next)).status).toBe(401);
  });

  it('перепривязка почты на доске не даёт доступ к панели с новым адресом', async () => {
    const app = await setup();
    const cookie = await session(app);
    const boardStart = await call(app, 'POST', '/api/auth/email/start', { email: adminMail });
    const board = await call(app, 'POST', '/api/auth/email/verify', { email: adminMail, code: boardStart.body.devCode });
    const email = 'different@abax.test';
    const start = await call(app, 'POST', '/api/auth/email/start', { email });
    const changed = await call(app, 'POST', '/api/auth/email/verify', { email, code: start.body.devCode, mode: 'link' }, { token: board.body.token });
    expect(changed.body.user).toMatchObject({ id: adminId, email });
    expect((await login(app, email)).status).toBe(403);
    expect((await adminCall(app, 'GET', '/api/admin/session', undefined, cookie)).status).toBe(403);
  });
});

describe('Операции панели', () => {
  it('пользователи: поиск по кириллице, страницы, истёкший и бессрочный тариф, история изменений', async () => {
    const app = await setup();
    const cookie = await session(app);
    const user = createUser(app.db, app.clock.t, { display_name: 'Анна Волкова', device_token_hash: 'device-hash', tg_id: '98' });
    app.db.prepare("UPDATE users SET plan = 'tutor', plan_expires_at = ?, plan_trial = 1, google_sub = 'private-google-sub', google_email = 'a@example.com' WHERE id = ?")
      .run(app.clock.t - 1, user.id);
    for (let i = 0; i < 30; i++) createUser(app.db, app.clock.t, { display_name: 'Тест ' + i });
    const first = await adminCall(app, 'GET', '/api/admin/users', undefined, cookie);
    const second = await adminCall(app, 'GET', '/api/admin/users?page=2', undefined, cookie);
    expect(first.body.items).toHaveLength(25);
    expect(first.body.hasMore).toBe(true);
    expect(second.body.items).toHaveLength(7);
    expect(second.body.hasMore).toBe(false);
    expect(new Set([...first.body.items, ...second.body.items].map((row: { id: string }) => row.id)).size).toBe(32);
    const found = await adminCall(app, 'GET', '/api/admin/users?q=' + encodeURIComponent('ВОЛКОВА'), undefined, cookie);
    expect(found.body.items).toMatchObject([{ id: user.id, storedPlan: 'tutor', plan: 'free', expired: true, googleEmail: 'a@example.com' }]);
    expect(JSON.stringify(found.body)).not.toMatch(/device-hash|private-google-sub/);
    const path = '/api/admin/users/' + user.id + '/plan';
    expect((await adminCall(app, 'PATCH', path, { plan: 'pro', reason: 'Причина' }, cookie)).status).toBe(400);
    expect((await adminCall(app, 'PATCH', path, { plan: 'pro', confirmed: true, reason: '  ' }, cookie)).status).toBe(400);
    expect((await adminCall(app, 'PATCH', path, { ...confirmation, plan: 'pro', days: 0 }, cookie)).status).toBe(400);
    expect((await adminCall(app, 'PATCH', path, { ...confirmation, plan: 'pro', days: null }, cookie)).body)
      .toMatchObject({ plan: 'pro', expiresAt: null, expired: false, trial: false });
    expect((await adminCall(app, 'PATCH', path, { ...confirmation, plan: 'tutor', days: 1.5 }, cookie)).body)
      .toMatchObject({ plan: 'tutor', expiresAt: app.clock.t + DAY_MS * 1.5 });
    expect((await adminCall(app, 'PATCH', path, { ...confirmation, plan: 'free', days: null }, cookie)).body)
      .toMatchObject({ plan: 'free', expiresAt: null });
    const audit = await adminCall(app, 'GET', '/api/admin/audit?operation=plan.set&q=' + user.id, undefined, cookie);
    expect(audit.body.items).toHaveLength(3);
    expect(audit.body.items[2]).toMatchObject({
      adminId, createdAt: app.clock.t, operation: 'plan.set', objectId: user.id, reason: confirmation.reason,
      change: { before: { plan: 'tutor', trial: true }, after: { plan: 'pro', expiresAt: null, trial: false } },
    });
  });

  it('аудит и операции записи откатываются вместе', async () => {
    const app = await setup();
    const cookie = await session(app);
    const user = createUser(app.db, app.clock.t);
    app.db.exec("CREATE TRIGGER reject_audit BEFORE INSERT ON admin_audit BEGIN SELECT RAISE(ABORT, 'audit failure'); END");
    const failure = await adminCall(app, 'PATCH', '/api/admin/users/' + user.id + '/plan', { ...confirmation, plan: 'pro' }, cookie);
    expect(failure.status).toBe(500);
    expect(getUser(app.db, user.id)?.plan).toBe('free');
    expect((await adminCall(app, 'POST', '/api/admin/promos', { ...confirmation, code: 'ATOMIC-TEST', plan: 'pro', days: 7 }, cookie)).status).toBe(500);
    expect(app.db.prepare('SELECT code FROM promo_codes').all()).toEqual([]);
    expect(app.db.prepare('SELECT id FROM admin_audit').all()).toEqual([]);
  });

  it('промокоды: нормализация, лимит, срок, гонка погашения и отключения, сохранение выданного тарифа', async () => {
    const app = await setup();
    const cookie = await session(app);
    const buyer = await anon(app);
    const other = await anon(app);
    app.db.prepare("UPDATE users SET email = id || '@abax.test' WHERE id IN (?, ?)").run(buyer.id, other.id);
    const create = (code: string, maxUses: number) => adminCall(app, 'POST', '/api/admin/promos',
      { ...confirmation, code, plan: 'pro', days: 7, validDays: 2, maxUses }, cookie);
    const disable = (code: string) => adminCall(app, 'PATCH', '/api/admin/promos/disable', { ...confirmation, code }, cookie);
    const redeem = (code: string, token: string) => call(app, 'POST', '/api/billing/promo', { code }, { token });
    expect((await create('!', 1)).status).toBe(400);
    expect((await create('  safe - new ', 2)).status).toBe(201);
    expect((await create('SAFE-NEW', 2)).status).toBe(409);
    expect((await redeem('safe-new', buyer.token)).status).toBe(200);
    expect((await disable('safe-new')).status).toBe(200);
    expect((await redeem('safe-new', other.token)).status).toBe(404);
    expect(getUser(app.db, buyer.id)).toMatchObject({ plan: 'pro', plan_expires_at: app.clock.t + 7 * DAY_MS });
    expect((await disable('safe-new')).status).toBe(409);
    expect((await create('RACE-PROMO', 1)).status).toBe(201);
    const [activation, disabling] = await Promise.all([redeem('RACE-PROMO', other.token), disable('RACE-PROMO')]);
    expect(disabling.status).toBe(200);
    expect([200, 404]).toContain(activation.status);
    const activeCount = activation.status === 200 ? 1 : 0;
    const promos = await adminCall(app, 'GET', '/api/admin/promos', undefined, cookie);
    expect(promos.body.items).toMatchObject([
      { code: 'RACE-PROMO', status: 'disabled', uses: activeCount, maxUses: 1, expiresAt: app.clock.t + 2 * DAY_MS },
      { code: 'SAFE-NEW', status: 'disabled', uses: 1 },
    ]);
    expect(app.db.prepare("SELECT code FROM promo_redemptions WHERE user_id = ? AND code = 'RACE-PROMO'").all(other.id)).toHaveLength(activeCount);
    const audit = await adminCall(app, 'GET', '/api/admin/audit?operation=promo.disable', undefined, cookie);
    expect(audit.body.items).toMatchObject([
      { objectId: promos.body.items[0].reference, change: { uses: activeCount } }, { objectId: promos.body.items[1].reference, change: { uses: 1 } },
    ]);
    expect(JSON.stringify(audit.body)).not.toMatch(/SAFE-NEW|RACE-PROMO/);
  });

  it('публичные адреса: блокировка старого адреса, исходная ссылка и права гостя сохраняются', async () => {
    const app = await setup();
    const cookie = await session(app);
    const owner = await anon(app);
    setPlan(app, owner.id, 'pro');
    await putProject(app, owner.token, proj('alias-board'));
    const invite = await call(app, 'POST', '/api/invites', { projectId: 'alias-board', defaultRole: 'view' }, { token: owner.token });
    expect(invite.status).toBe(201);
    const { token } = invite.body.invite ?? invite.body;
    app.db.prepare("INSERT INTO public_aliases (alias, project_id, owner_id, state, created_at, updated_at) VALUES ('old', 'alias-board', ?, 'active', 1, 1)").run(owner.id);
    const open = (key: string) => call(app, 'GET', '/api/invites/' + key);
    const previous = await open('old');
    expect(previous.status).toBe(200);
    expect((await adminCall(app, 'GET', '/api/admin/aliases', undefined, cookie)).body.items).toMatchObject([
      { alias: 'old', ownerId: owner.id, projectId: 'alias-board', blockedAt: null },
    ]);
    const change = (blocked: boolean) => adminCall(app, 'PATCH', '/api/admin/aliases/old', { ...confirmation, blocked }, cookie);
    expect((await change(true)).status).toBe(200);
    expect((await open('old')).body.error).toBe('alias-blocked');
    expect((await open(token)).status).toBe(200);
    expect((await change(false)).status).toBe(200);
    expect((await open('old')).body).toEqual(previous.body);
    const audit = await adminCall(app, 'GET', '/api/admin/audit?q=old', undefined, cookie);
    expect(audit.body.items).toMatchObject([{ operation: 'alias.unblock', objectId: 'old' }, { operation: 'alias.block', objectId: 'old' }]);
    expect(JSON.stringify(audit.body)).not.toContain(token);
  });

  it('платежи: поиск по внешнему ID и пользователю, дата только после подтверждения провайдера', async () => {
    let response: Record<string, unknown> = {};
    const provider = vi.fn(async (_url, init) => {
      if (init?.body) {
        const { metadata, amount } = JSON.parse(String(init.body));
        response = { id: 'yoo-test-1', amount, metadata, status: 'pending', paid: false, confirmation: { confirmation_url: 'https://yookassa.ru/hidden-link' } };
      }
      return Response.json(response);
    }) as typeof fetch;
    const app = await setup({ yookassaShopId: 'shop', yookassaSecretKey: 'secret', fetch: provider });
    const cookie = await session(app);
    const customer = await anon(app);
    app.db.prepare("UPDATE users SET email = 'user@abax.test' WHERE id = ?").run(customer.id);
    expect((await call(app, 'POST', '/api/billing/checkout', { plan: 'pro', period: 'month' }, { token: customer.token })).status).toBe(200);
    const pending = await adminCall(app, 'GET', '/api/admin/payments?q=yoo-test-1', undefined, cookie);
    expect(pending.body.items).toMatchObject([{ status: 'pending', resolvedAt: null, amount: 399, userId: customer.id }]);
    expect(JSON.stringify(pending.body)).not.toContain('hidden-link');
    expect(provider).toHaveBeenCalledTimes(1);
    app.clock.t += 1000;
    const notify = () => call(app, 'POST', '/api/billing/yookassa/webhook', { type: 'notification', event: 'payment.succeeded', object: { id: response.id } });
    await notify();
    expect((await adminCall(app, 'GET', '/api/admin/payments?q=yoo-test-1', undefined, cookie)).body.items[0].status).toBe('pending');
    Object.assign(response, { status: 'succeeded', paid: true });
    await notify();
    const paid = await adminCall(app, 'GET', '/api/admin/payments?q=user%40abax.test', undefined, cookie);
    expect(paid.body.items).toMatchObject([{ status: 'paid', providerId: 'yoo-test-1', createdAt: app.clock.t - 1000, resolvedAt: app.clock.t }]);
    const summary = await adminCall(app, 'GET', '/api/admin/summary', undefined, cookie);
    expect(summary.body).toEqual({ users: 2, promos: 0, pendingPayments: 0, blockedAliases: 0 });
  });
});

it('миграция V9 сохраняет старые тарифы, платёж, промокод и активацию', () => {
  const dir = mkdtempSync(join(tmpdir(), 'abax-admin-migrate-'));
  const path = join(dir, 'abax.db');
  try {
    const old = new Database(path);
    try {
      migrate(old, 9);
      const user = createUser(old, 1);
      old.prepare("UPDATE users SET plan = 'pro' WHERE id = ?").run(user.id);
      old.prepare("INSERT INTO payments (id, user_id, plan, days, amount, status, provider, created_at) VALUES ('old-payment', ?, 'pro', 30, 399, 'paid', 'yookassa', 2)").run(user.id);
      old.prepare("INSERT INTO yookassa_checkouts (payment_id, provider_id, request_json) VALUES ('old-payment', 'yoo-old', '{}')").run();
      old.prepare("INSERT INTO promo_codes (code, plan, days, uses, created_at) VALUES ('OLD-PROMO', 'pro', 7, 1, 3)").run();
      old.prepare("INSERT INTO promo_redemptions VALUES (?, 'OLD-PROMO', 'pro', 7, 4)").run(user.id);
    } finally { old.close(); }
    const migrated = openDb(path);
    try {
      expect(migrated.pragma('user_version', { simple: true })).toBe(10);
      expect(migrated.pragma('integrity_check', { simple: true })).toBe('ok');
      expect(migrated.prepare('SELECT plan, plan_expires_at FROM users').get()).toEqual({ plan: 'pro', plan_expires_at: null });
      expect(migrated.prepare('SELECT status, resolved_at FROM payments').get()).toEqual({ status: 'paid', resolved_at: null });
      expect(migrated.prepare('SELECT provider_id FROM yookassa_checkouts').get()).toEqual({ provider_id: 'yoo-old' });
      expect(migrated.prepare('SELECT uses, disabled_at FROM promo_codes').get()).toEqual({ uses: 1, disabled_at: null });
      expect(migrated.prepare('SELECT code, redeemed_at FROM promo_redemptions').get()).toEqual({ code: 'OLD-PROMO', redeemed_at: 4 });
    } finally { migrated.close(); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
