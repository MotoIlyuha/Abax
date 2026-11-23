import { createHmac } from 'node:crypto';
import { afterEach, expect, it } from 'vitest';
import { anon, BOT_TOKEN, call, closeApps, makeApp } from './helpers';

afterEach(closeApps);

function signed(now: number, token = BOT_TOKEN) {
  const user = JSON.stringify({ id: 364234, first_name: 'Анна' });
  const date = String(Math.floor(now / 1000));
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  const hash = createHmac('sha256', secret).update('auth_date=' + date + '\nuser=' + user).digest('hex');
  return new URLSearchParams({ user, hash, auth_date: date }).toString();
}

it('привязывает Telegram к анониму и переносит общую cookie на второй домен', async () => {
  const app = await makeApp({ secureCookies: true, cookieDomain: '.abaxboard.ru' });
  const guest = await anon(app);
  const data = { initData: signed(app.clock.t) };
  const login = await call(app, 'POST', '/api/auth/tma', data, guest);
  expect(login.status).toBe(200);
  expect(login.body.user.id).toBe(guest.id);
  expect(login.body.user.telegram).toBe(true);
  const cookie = login.headers.get('set-cookie')!;
  expect(cookie).toContain('Domain=.abaxboard.ru');
  const resumed = await call(app, 'POST', '/api/auth/session', {}, { headers: { Cookie: cookie.split(';')[0] } });
  expect(resumed.body.user.id).toBe(guest.id);
  expect((await call(app, 'POST', '/api/auth/tma', data)).body.user.id).toBe(guest.id);
  expect((await call(app, 'POST', '/api/auth/logout')).headers.get('set-cookie')).toContain('Domain=.abaxboard.ru');
});

it('проверяет подпись, уникальность полей, время и доступность тестового ключа', async () => {
  const app = await makeApp();
  for (const initData of [signed(app.clock.t - 86401000), signed(app.clock.t + 400000), signed(app.clock.t, 'x'), signed(app.clock.t) + '&user=123', '']) {
    expect((await call(app, 'POST', '/api/auth/tma', { initData })).status).toBe(401);
  }
  const local = await makeApp({ devAuth: true, telegramBotToken: null });
  const data = { initData: signed(local.clock.t, 'abax-dev-mini-app') };
  expect((await call(local, 'POST', '/api/auth/tma', data)).status).toBe(200);
  const prod = await makeApp({ telegramBotToken: null });
  expect((await call(prod, 'POST', '/api/auth/tma', data)).status).toBe(503);
});
