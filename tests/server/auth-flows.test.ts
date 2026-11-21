// Вход через Telegram и Google с переходом на сайт провайдера, dev-провайдеры, привязка (SPEC_NIGHT4 §7.3).
import { createHash, generateKeyPairSync, sign as cryptoSign } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { signTelegramPayload } from '../../server/auth';
import { allowedReturn, DEV_GOOGLE, DEV_TELEGRAM, googleNonce } from '../../server/auth-flows';
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

  it('привязка: второй способ к тому же аккаунту; чужой способ - identity-taken', async () => {
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

  it('dev-маршрут без dev-режима - 404', async () => {
    const app = await makeApp();
    expect((await fetch(`${app.base}/api/auth/dev/start?flow=${'a'.repeat(24)}`, { redirect: 'manual' })).status).toBe(404);
  });

  it('настоящий Telegram (OIDC): PKCE, обмен кода с Basic, подпись id_token по JWKS, iss/aud/exp', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'oidc-1', alg: 'RS256' };
    const sign = (claims: Record<string, unknown>, key = privateKey, kid = 'oidc-1') => {
      const part = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
      const input = `${part({ alg: 'RS256', kid, typ: 'JWT' })}.${part(claims)}`;
      return `${input}.${cryptoSign('sha256', Buffer.from(input), key).toString('base64url')}`;
    };
    let idToken = '';
    const calls: { url: string; init?: RequestInit }[] = [];
    const fakeFetch = (async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url === 'https://oauth.telegram.org/.well-known/jwks.json') return new Response(JSON.stringify({ keys: [jwk] }), { status: 200 });
      return new Response(JSON.stringify({ access_token: 'a', token_type: 'Bearer', expires_in: 3600, id_token: idToken }), { status: 200 });
    }) as unknown as typeof fetch;
    const app = await makeApp({ telegramClientSecret: 'tg-secret', publicApiUrl: 'https://api.abax.example', fetch: fakeFetch });
    expect((await call(app, 'GET', '/api/auth/providers')).body).toMatchObject({ telegram: true, telegramBotId: '123456' });
    const exp = Math.floor(app.clock.t / 1000) + 600;
    const good = { iss: 'https://oauth.telegram.org', aud: '123456', sub: '777', iat: exp - 600, exp, id: 4242, name: 'Тг Пользователь', preferred_username: 'tg_user', picture: 'https://cdn.telesco.pe/a.jpg' };

    const f = await flow(app, { provider: 'telegram' });
    expect(f.body.url).toBe(`https://api.abax.example/api/auth/telegram/start?flow=${f.body.flowId}`);
    const toTg = new URL(await follow(`${app.base}/api/auth/telegram/start?flow=${f.body.flowId}`));
    expect(toTg.origin + toTg.pathname).toBe('https://oauth.telegram.org/auth');
    expect(Object.fromEntries(toTg.searchParams)).toMatchObject({
      client_id: '123456', redirect_uri: 'https://api.abax.example/api/auth/telegram/callback', response_type: 'code',
      scope: 'openid profile', state: f.body.flowId, code_challenge_method: 'S256',
    });
    idToken = sign(good);
    expect(await follow(`${app.base}/api/auth/telegram/callback?state=${f.body.flowId}&code=c0de`)).toBe(`${RETURN}#abaxAuth=${f.body.flowId}`);
    const tokenCall = calls.find(c => c.url === 'https://oauth.telegram.org/token')!;
    expect((tokenCall.init!.headers as Record<string, string>).Authorization).toBe(`Basic ${Buffer.from('123456:tg-secret').toString('base64')}`);
    const body = new URLSearchParams(String(tokenCall.init!.body));
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('code_verifier')).toBeTruthy();
    expect(createHash('sha256').update(body.get('code_verifier')!).digest('base64url')).toBe(toTg.searchParams.get('code_challenge'));
    const done = await call(app, 'POST', '/api/auth/flow/complete', { flowId: f.body.flowId, secret: f.body.secret });
    expect(done.body.user).toMatchObject({ telegram: true, tgUsername: 'tg_user', displayName: 'Тг Пользователь', avatarUrl: 'https://cdn.telesco.pe/a.jpg' });
    // аккаунт — по числовому id Telegram (тот же, что у входа через виджет)
    expect(app.db.prepare('SELECT tg_id FROM users WHERE id = ?').get(done.body.user.id)).toEqual({ tg_id: '4242' });

    // плохие токены: чужой ключ, чужой aud, чужой iss, просрочен, нет id
    const other = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
    for (const bad of [sign(good, other), sign({ ...good, aud: '999' }), sign({ ...good, iss: 'https://evil' }), sign({ ...good, exp: exp - 1200 }), sign({ ...good, id: undefined })]) {
      const g = await flow(app, { provider: 'telegram' });
      idToken = bad;
      await follow(`${app.base}/api/auth/telegram/callback?state=${g.body.flowId}&code=c0de`);
      expect((await call(app, 'POST', '/api/auth/flow/complete', { flowId: g.body.flowId, secret: g.body.secret })).body.error).toBe('telegram-failed');
    }
    // пользователь не подтвердил вход
    const h = await flow(app, { provider: 'telegram' });
    await follow(`${app.base}/api/auth/telegram/callback?state=${h.body.flowId}&error=access_denied`);
    expect((await call(app, 'POST', '/api/auth/flow/complete', { flowId: h.body.flowId, secret: h.body.secret })).body.error).toBe('cancelled');
  });

  it('Telegram без Client Secret - выключен (без dev-режима)', async () => {
    const app = await makeApp();
    expect((await call(app, 'GET', '/api/auth/providers')).body.telegram).toBe(false);
    expect((await flow(app, { provider: 'telegram' })).status).toBe(503);
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
    expect(toGoogle.searchParams.get('scope')).toBe('openid email profile');
    // nonce (обязателен по документации Google) — в запросе и обратно в id_token
    const nonce = toGoogle.searchParams.get('nonce');
    expect(nonce).toBe(googleNonce(app.app, f.body.flowId));
    claims = { iss: 'https://accounts.google.com', aud: 'gid', sub: 'g-123', exp, nonce, name: 'Гугл Пользователь', email: 'g@gmail.com', picture: 'https://lh3.googleusercontent.com/photo' };
    expect(await follow(`${app.base}/api/auth/google/callback?state=${f.body.flowId}&code=c0de`)).toBe(`${RETURN}#abaxAuth=${f.body.flowId}`);
    expect(calls[0].body.get('code_verifier')).toBeTruthy();
    expect(calls[0].body.get('client_secret')).toBe('gsecret');
    const done = await call(app, 'POST', '/api/auth/flow/complete', { flowId: f.body.flowId, secret: f.body.secret });
    expect(done.body.user).toMatchObject({ google: true, displayName: 'Гугл Пользователь', email: null, avatarUrl: 'https://lh3.googleusercontent.com/photo' });
    // адрес Google без email_verified не сохраняется; подтверждённый — сохраняется (приглашения по почте, SPEC_NIGHT5 §4.1)
    const gEmail = () => (app.db.prepare("SELECT google_email FROM users WHERE google_sub = 'g-123'").get() as { google_email: string | null }).google_email;
    expect(gEmail()).toBeNull();
    const v = await flow(app, { provider: 'google' });
    claims = { ...claims, nonce: googleNonce(app.app, v.body.flowId), email: 'G@Gmail.com', email_verified: true };
    await follow(`${app.base}/api/auth/google/callback?state=${v.body.flowId}&code=c0de`);
    expect((await call(app, 'POST', '/api/auth/flow/complete', { flowId: v.body.flowId, secret: v.body.secret })).body.user).toMatchObject({ google: true });
    expect(gEmail()).toBe('g@gmail.com');
    claims = { ...claims, email_verified: undefined };
    // id_token с nonce другого потока (повтор) — вход не засчитывается
    const n = await flow(app, { provider: 'google' });
    await follow(`${app.base}/api/auth/google/callback?state=${n.body.flowId}&code=c0de`);
    expect((await call(app, 'POST', '/api/auth/flow/complete', { flowId: n.body.flowId, secret: n.body.secret })).body.error).toBe('google-failed');
    // чужой aud — вход не засчитывается
    const g = await flow(app, { provider: 'google' });
    claims = { ...claims, nonce: googleNonce(app.app, g.body.flowId), aud: 'someone-else' };
    await follow(`${app.base}/api/auth/google/callback?state=${g.body.flowId}&code=c0de`);
    expect((await call(app, 'POST', '/api/auth/flow/complete', { flowId: g.body.flowId, secret: g.body.secret })).body.error).toBe('google-failed');
    // пользователь отказался на сайте Google
    const h = await flow(app, { provider: 'google' });
    await follow(`${app.base}/api/auth/google/callback?state=${h.body.flowId}&error=access_denied`);
    expect((await call(app, 'POST', '/api/auth/flow/complete', { flowId: h.body.flowId, secret: h.body.secret })).body.error).toBe('cancelled');
  });

  it('фото провайдера доступно только из разрешённого источника и с ограничением размера', async () => {
    const fakeFetch = vi.fn(async (_url: string, _init: RequestInit) => new Response('photo', { headers: { 'content-type': 'image/jpeg' } }));
    const app = await makeApp({ fetch: fakeFetch as unknown as typeof fetch });
    const user = await anon(app);
    expect((await call(app, 'GET', '/api/me/provider-avatar')).status).toBe(401);
    app.db.prepare('UPDATE users SET avatar_url = ? WHERE id = ?').run('https://lh3.googleusercontent.com/photo', user.id);
    const photo = await call(app, 'GET', '/api/me/provider-avatar', undefined, { token: user.token });
    expect(photo.body.photo).toBe(`data:image/jpeg;base64,${Buffer.from('photo').toString('base64')}`);
    expect(fakeFetch.mock.calls[0][1]).toMatchObject({ redirect: 'error' });
    app.db.prepare('UPDATE users SET avatar_url = ? WHERE id = ?').run('https://googleusercontent.com.evil.example/photo', user.id);
    expect((await call(app, 'GET', '/api/me/provider-avatar', undefined, { token: user.token })).status).toBe(404);
    expect(fakeFetch).toHaveBeenCalledTimes(1);
    app.db.prepare('UPDATE users SET avatar_url = ? WHERE id = ?').run('https://cdn.telesco.pe/photo', user.id);
    fakeFetch.mockResolvedValueOnce(new Response(new Uint8Array(2_000_001), { headers: { 'content-type': 'image/png' } }));
    expect((await call(app, 'GET', '/api/me/provider-avatar', undefined, { token: user.token })).status).toBe(502);
  });

  it('старый POST /api/auth/telegram по-прежнему входит (режим login)', async () => {
    const app = await makeApp();
    const a = await anon(app);
    const fields = { id: 9001, first_name: 'Старый', auth_date: Math.floor(app.clock.t / 1000) };
    const r = await call(app, 'POST', '/api/auth/telegram', { ...fields, hash: signTelegramPayload(fields, BOT_TOKEN) }, { token: a.token });
    expect(r.body.user).toMatchObject({ id: a.id, telegram: true });
  });
});
