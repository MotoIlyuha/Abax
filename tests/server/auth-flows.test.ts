// Вход через Telegram и Google с переходом на сайт провайдера, dev-провайдеры, привязка (SPEC_NIGHT4 §7.3).
import { afterEach, describe, expect, it } from 'vitest';
import { signTelegramPayload } from '../../server/auth';
import { allowedReturn, DEV_GOOGLE, DEV_TELEGRAM } from '../../server/auth-flows';
import { BOT_TOKEN, anon, call, closeApps, makeApp, putProject, proj, type TestApp } from './helpers';

afterEach(closeApps);

const RETURN = 'https://abax.example/?x=1';

/** Перейти по ссылке, не следуя перенаправлению: Location ответа. */
async function follow(url: string): Promise<string> {
  const r = await fetch(url, { redirect: 'manual' });
  expect(r.status).toBe(302);
  return r.headers.get('location')!;
}

async function flow(app: TestApp, body: Record<string, unknown>, token?: string) {
  return call(app, 'POST', '/api/auth/flow', { returnTo: RETURN, mode: 'login', ...body }, { token });
}

describe('способы входа сервера', () => {
  it('providers: что включено', async () => {
    const off = await makeApp({ telegramBotToken: null });
    expect((await call(off, 'GET', '/api/auth/providers')).body).toEqual({ email: false, telegram: false, google: false, dev: false, telegramBotId: null });
    const on = await makeApp({ googleClientId: 'gid', devAuth: true });
    expect((await call(on, 'GET', '/api/auth/providers')).body).toMatchObject({ email: true, telegram: true, google: true, dev: true, telegramBotId: '123456' });
  });

  it('returnTo: только разрешённые адреса', async () => {
    const app = await makeApp({ allowedOrigins: ['https://other.example'] });
    for (const bad of ['https://evil.example/', 'javascript:alert(1)', 'file:///x', 'https://user:pw@abax.example/', 5, 'http://localhost:5173/']) {
      expect(allowedReturn(app.app, bad), String(bad)).toBeNull();
    }
    expect(allowedReturn(app.app, 'https://abax.example/p/1#frag')).toBe('https://abax.example/p/1');
    expect(allowedReturn(app.app, 'https://other.example/')).toBe('https://other.example/');
    const dev = await makeApp({ devAuth: true });
    expect(allowedReturn(dev.app, 'http://localhost:5173/')).toBe('http://localhost:5173/');
    expect((await flow(app, { provider: 'google', returnTo: 'https://evil.example/' })).status).toBe(503); // google не настроен
    expect((await flow(dev, { provider: 'google', returnTo: 'https://evil.example/' })).body.error).toBe('bad-return');
  });

  it('dev-Telegram: мгновенный вход, аноним получает Telegram на месте', async () => {
    const app = await makeApp({ devAuth: true, telegramBotToken: null });
    const a = await anon(app);
    await putProject(app, a.token, proj('p1'));
    const f = await flow(app, { provider: 'telegram' }, a.token);
    expect(f.status).toBe(200);
    expect(f.body.url).toBe(`${app.base}/api/auth/dev/start?flow=${f.body.flowId}`);
    expect(await follow(f.body.url)).toBe(`${RETURN}#abaxAuth=${f.body.flowId}`);
    const done = await call(app, 'POST', '/api/auth/flow/complete', { flowId: f.body.flowId, secret: f.body.secret });
    expect(done.status).toBe(200);
    expect(done.body.user).toMatchObject({ id: a.id, telegram: true, tgUsername: DEV_TELEGRAM.tgUsername, displayName: DEV_TELEGRAM.displayName, isAnonymous: false });
    // одноразовый
    expect((await call(app, 'POST', '/api/auth/flow/complete', { flowId: f.body.flowId, secret: f.body.secret })).body.error).toBe('bad-flow');
  });

  it('неверный секрет и просроченный поток', async () => {
    const app = await makeApp({ devAuth: true, telegramBotToken: null });
    const f = await flow(app, { provider: 'google' });
    await follow(f.body.url);
    expect((await call(app, 'POST', '/api/auth/flow/complete', { flowId: f.body.flowId, secret: 'x'.repeat(32) })).body.error).toBe('bad-flow');
    const g = await flow(app, { provider: 'google' });
    app.clock.t += 11 * 60_000;
    expect((await fetch(g.body.url, { redirect: 'manual' })).status).toBe(400);
    expect((await call(app, 'POST', '/api/auth/flow/complete', { flowId: g.body.flowId, secret: g.body.secret })).body.error).toBe('flow-expired');
  });

  it('привязка: второй способ к тому же аккаунту; чужой способ — identity-taken', async () => {
    const app = await makeApp({ devAuth: true, telegramBotToken: null });
    // аккаунт A входит через dev-Google
    const a = await anon(app);
    const fa = await flow(app, { provider: 'google' }, a.token);
    await follow(fa.body.url);
    const ga = await call(app, 'POST', '/api/auth/flow/complete', { flowId: fa.body.flowId, secret: fa.body.secret });
    expect(ga.body.user).toMatchObject({ id: a.id, google: true, displayName: DEV_GOOGLE.displayName });
    // A привязывает dev-Telegram
    const fl = await flow(app, { provider: 'telegram', mode: 'link' }, ga.body.token);
    await follow(fl.body.url);
    const linked = await call(app, 'POST', '/api/auth/flow/complete', { flowId: fl.body.flowId, secret: fl.body.secret });
    expect(linked.body.user).toMatchObject({ id: a.id, google: true, telegram: true });
    // B (другой вошедший аккаунт) пытается привязать тот же Telegram
    const b = await anon(app);
    await call(app, 'PATCH', '/api/me', { displayName: 'Б' }, { token: b.token });
    app.db.prepare('UPDATE users SET email = ? WHERE id = ?').run('b@b.ru', b.id);
    const fb = await flow(app, { provider: 'telegram', mode: 'link' }, b.token);
    await follow(fb.body.url);
    const taken = await call(app, 'POST', '/api/auth/flow/complete', { flowId: fb.body.flowId, secret: fb.body.secret });
    expect(taken.status).toBe(409);
    expect(taken.body.error).toBe('identity-taken');
    // привязка без сессии — 401
    expect((await flow(app, { provider: 'telegram', mode: 'link' })).status).toBe(401);
  });

  it('dev-маршрут без dev-режима — 404', async () => {
    const app = await makeApp();
    expect((await fetch(`${app.base}/api/auth/dev/start?flow=${'a'.repeat(24)}`, { redirect: 'manual' })).status).toBe(404);
  });

  it('настоящий Telegram: ссылка на oauth.telegram.org, данные проверяются по подписи', async () => {
    const app = await makeApp();
    const f = await flow(app, { provider: 'telegram' });
    const u = new URL(f.body.url);
    expect(u.origin).toBe('https://oauth.telegram.org');
    expect(u.searchParams.get('bot_id')).toBe('123456');
    expect(u.searchParams.get('origin')).toBe('https://abax.example');
    expect(u.searchParams.get('return_to')).toBe(RETURN);
    const fields = { id: 4242, first_name: 'Тг', auth_date: Math.floor(app.clock.t / 1000) };
    const forged = await call(app, 'POST', '/api/auth/flow/complete', { flowId: f.body.flowId, secret: f.body.secret, telegram: { ...fields, hash: '0'.repeat(64) } });
    expect(forged.status).toBe(401);
    const g = await flow(app, { provider: 'telegram' });
    const ok = await call(app, 'POST', '/api/auth/flow/complete', { flowId: g.body.flowId, secret: g.body.secret, telegram: { ...fields, hash: signTelegramPayload(fields, BOT_TOKEN) } });
    expect(ok.body.user).toMatchObject({ telegram: true, displayName: 'Тг' });
  });

  it('настоящий Google: PKCE, обмен кода, проверка id_token', async () => {
    const calls: { url: string; body: URLSearchParams }[] = [];
    let claims: Record<string, unknown> = {};
    const fakeFetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, body: new URLSearchParams(String(init.body)) });
      const part = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
      return new Response(JSON.stringify({ id_token: `${part({ alg: 'RS256' })}.${part(claims)}.sig` }), { status: 200 });
    }) as unknown as typeof fetch;
    const app = await makeApp({ googleClientId: 'gid', googleClientSecret: 'gsecret', publicApiUrl: 'https://api.abax.example', fetch: fakeFetch });
    const exp = Math.floor(app.clock.t / 1000) + 600;
    const f = await flow(app, { provider: 'google' });
    expect(f.body.url).toBe(`https://api.abax.example/api/auth/google/start?flow=${f.body.flowId}`);
    const toGoogle = new URL(await follow(`${app.base}/api/auth/google/start?flow=${f.body.flowId}`));
    expect(toGoogle.origin + toGoogle.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(toGoogle.searchParams.get('code_challenge_method')).toBe('S256');
    expect(toGoogle.searchParams.get('redirect_uri')).toBe('https://api.abax.example/api/auth/google/callback');
    expect(toGoogle.searchParams.get('state')).toBe(f.body.flowId);
    claims = { iss: 'https://accounts.google.com', aud: 'gid', sub: 'g-123', exp, name: 'Гугл Пользователь', email: 'g@gmail.com' };
    expect(await follow(`${app.base}/api/auth/google/callback?state=${f.body.flowId}&code=c0de`)).toBe(`${RETURN}#abaxAuth=${f.body.flowId}`);
    expect(calls[0].body.get('code_verifier')).toBeTruthy();
    expect(calls[0].body.get('client_secret')).toBe('gsecret');
    const done = await call(app, 'POST', '/api/auth/flow/complete', { flowId: f.body.flowId, secret: f.body.secret });
    expect(done.body.user).toMatchObject({ google: true, displayName: 'Гугл Пользователь', email: null });
    // чужой aud — вход не засчитывается
    const g = await flow(app, { provider: 'google' });
    claims = { ...claims, aud: 'someone-else' };
    await follow(`${app.base}/api/auth/google/callback?state=${g.body.flowId}&code=c0de`);
    expect((await call(app, 'POST', '/api/auth/flow/complete', { flowId: g.body.flowId, secret: g.body.secret })).body.error).toBe('google-failed');
    // пользователь отказался на сайте Google
    const h = await flow(app, { provider: 'google' });
    await follow(`${app.base}/api/auth/google/callback?state=${h.body.flowId}&error=access_denied`);
    expect((await call(app, 'POST', '/api/auth/flow/complete', { flowId: h.body.flowId, secret: h.body.secret })).body.error).toBe('cancelled');
  });

  it('старый POST /api/auth/telegram по-прежнему входит (режим login)', async () => {
    const app = await makeApp();
    const a = await anon(app);
    const fields = { id: 9001, first_name: 'Старый', auth_date: Math.floor(app.clock.t / 1000) };
    const r = await call(app, 'POST', '/api/auth/telegram', { ...fields, hash: signTelegramPayload(fields, BOT_TOKEN) }, { token: a.token });
    expect(r.body.user).toMatchObject({ id: a.id, telegram: true });
  });
});
