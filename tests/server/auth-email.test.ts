// Вход по почте: код, лимиты, попытки, слияние анонима, привязка (SPEC_NIGHT4 §7.2).
import { afterEach, describe, expect, it } from 'vitest';
import { memoryMailer } from '../../server/mailer';
import { normalizeEmail } from '../../server/auth-flows';
import { anon, call, closeApps, makeApp, putProject, proj } from './helpers';

afterEach(closeApps);

const codeOf = (text: string) => /(\d{6})/.exec(text)![1];

async function setup(over: Parameters<typeof makeApp>[0] = {}) {
  const mailer = memoryMailer();
  const app = await makeApp({ mailer, ...over });
  return { app, mailer };
}

describe('вход по почте', () => {
  it('адрес нормализуется и проверяется', () => {
    expect(normalizeEmail('  Kapi@Bara.RU ')).toBe('kapi@bara.ru');
    for (const bad of ['', 'nope', 'a@b', 'a b@c.ru', 'a@b.ru\r\nBcc:x@y.ru', 5, 'x'.repeat(250) + '@a.ru']) expect(normalizeEmail(bad)).toBeNull();
  });

  it('код приходит письмом; верный код — вход, аноним получает почту на месте', async () => {
    const { app, mailer } = await setup();
    const a = await anon(app);
    await putProject(app, a.token, proj('p1'));
    const s = await call(app, 'POST', '/api/auth/email/start', { email: 'Kapi@Bara.ru' });
    expect(s.status).toBe(200);
    expect(s.body).toEqual({ ok: true }); // без dev-режима кода в ответе нет
    expect(mailer.outbox).toHaveLength(1);
    expect(mailer.outbox[0].to).toBe('kapi@bara.ru');
    const code = codeOf(mailer.outbox[0].text);
    expect(mailer.outbox[0].subject).toContain(code);
    // в базе — только хеш
    expect(JSON.stringify(app.db.prepare('SELECT * FROM email_codes').all())).not.toContain(code);
    const v = await call(app, 'POST', '/api/auth/email/verify', { email: 'kapi@bara.ru', code }, { token: a.token });
    expect(v.status).toBe(200);
    expect(v.body.user).toMatchObject({ id: a.id, email: 'kapi@bara.ru', isAnonymous: false });
    expect(v.body.token).toBeTruthy();
    // код одноразовый
    expect((await call(app, 'POST', '/api/auth/email/verify', { email: 'kapi@bara.ru', code })).body.error).toBe('bad-code');
  });

  it('вход в существующий аккаунт: доски анонима переходят к нему', async () => {
    const { app, mailer } = await setup();
    const first = await anon(app);
    await call(app, 'POST', '/api/auth/email/start', { email: 'a@b.ru' });
    await call(app, 'POST', '/api/auth/email/verify', { email: 'a@b.ru', code: codeOf(mailer.outbox[0].text) }, { token: first.token });
    const second = await anon(app);
    await putProject(app, second.token, proj('p2'));
    await call(app, 'POST', '/api/auth/email/start', { email: 'a@b.ru' });
    const v = await call(app, 'POST', '/api/auth/email/verify', { email: 'a@b.ru', code: codeOf(mailer.outbox[1].text) }, { token: second.token });
    expect(v.body.user.id).toBe(first.id);
    const list = await call(app, 'GET', '/api/projects', undefined, { token: v.body.token });
    expect(list.body.projects.map((p: { id: string }) => p.id)).toContain('p2');
    expect(app.db.prepare('SELECT COUNT(*) n FROM users WHERE id = ?').get(second.id)).toEqual({ n: 0 });
  });

  it('привязка почты к аккаунту; почта другого аккаунта — 409 identity-taken', async () => {
    const { app, mailer } = await setup();
    const a = await anon(app);
    await call(app, 'POST', '/api/auth/email/start', { email: 'a@b.ru' });
    const la = await call(app, 'POST', '/api/auth/email/verify', { email: 'a@b.ru', code: codeOf(mailer.outbox[0].text), mode: 'link' }, { token: a.token });
    expect(la.body.user).toMatchObject({ id: a.id, email: 'a@b.ru' });
    const b = await anon(app);
    await call(app, 'POST', '/api/auth/email/start', { email: 'a@b.ru' });
    const lb = await call(app, 'POST', '/api/auth/email/verify', { email: 'a@b.ru', code: codeOf(mailer.outbox[1].text), mode: 'link' }, { token: b.token });
    expect(lb.status).toBe(409);
    expect(lb.body.error).toBe('identity-taken');
    // привязка без сессии — 401
    expect((await call(app, 'POST', '/api/auth/email/verify', { email: 'a@b.ru', code: '000000', mode: 'link' })).status).toBe(401);
  });

  it('5 неверных попыток — код сгорает; просроченный код — code-expired', async () => {
    const { app, mailer } = await setup();
    await call(app, 'POST', '/api/auth/email/start', { email: 'a@b.ru' });
    const right = codeOf(mailer.outbox[0].text);
    const wrong = right === '000000' ? '111111' : '000000';
    for (let i = 0; i < 4; i++) expect((await call(app, 'POST', '/api/auth/email/verify', { email: 'a@b.ru', code: wrong })).body.error).toBe('bad-code');
    const fifth = await call(app, 'POST', '/api/auth/email/verify', { email: 'a@b.ru', code: wrong });
    expect(fifth.status).toBe(429);
    expect(fifth.body.error).toBe('too-many-attempts');
    expect((await call(app, 'POST', '/api/auth/email/verify', { email: 'a@b.ru', code: right })).body.error).toBe('bad-code');
    await call(app, 'POST', '/api/auth/email/start', { email: 'a@b.ru' });
    app.clock.t += 11 * 60_000;
    expect((await call(app, 'POST', '/api/auth/email/verify', { email: 'a@b.ru', code: codeOf(mailer.outbox[1].text) })).body.error).toBe('code-expired');
  });

  it('лимит писем на адрес: 5 в час', async () => {
    const { app } = await setup();
    for (let i = 0; i < 5; i++) expect((await call(app, 'POST', '/api/auth/email/start', { email: 'a@b.ru' })).status).toBe(200);
    expect((await call(app, 'POST', '/api/auth/email/start', { email: 'a@b.ru' })).status).toBe(429);
  });

  it('неверный адрес — 400; почта не настроена — 503; ошибка отправки — 502', async () => {
    const { app } = await setup();
    expect((await call(app, 'POST', '/api/auth/email/start', { email: 'nope' })).body.error).toBe('bad-email');
    const off = await makeApp();
    expect((await call(off, 'POST', '/api/auth/email/start', { email: 'a@b.ru' })).status).toBe(503);
    const broken = await makeApp({ mailer: { kind: 'memory', send: async () => { throw new Error('smtp down'); } } });
    expect((await call(broken, 'POST', '/api/auth/email/start', { email: 'a@b.ru' })).body.error).toBe('mail-failed');
  });

  it('dev-провайдеры: код в ответе, письмо не нужно', async () => {
    const logs: string[] = [];
    const app = await makeApp({ devAuth: true, log: m => logs.push(m) });
    const s = await call(app, 'POST', '/api/auth/email/start', { email: 'dev@b.ru' });
    expect(s.body.devCode).toMatch(/^\d{6}$/);
    expect(logs.join('\n')).toContain(s.body.devCode);
    const v = await call(app, 'POST', '/api/auth/email/verify', { email: 'dev@b.ru', code: s.body.devCode });
    expect(v.body.user.email).toBe('dev@b.ru');
  });
});
