// Профиль на сервере (Ночь №4): миграция V2, PATCH /api/me, имя провайдера не затирает своё.
import { afterEach, describe, expect, it } from 'vitest';
import { signTelegramPayload } from '../../server/auth';
import { openDb } from '../../server/db';
import { BOT_TOKEN, anon, call, closeApps, makeApp, setPlan } from './helpers';

afterEach(closeApps);

function tgPayload(now: number, over: Record<string, string | number> = {}) {
  const fields: Record<string, string | number> = { id: 777001, first_name: 'Анна', last_name: 'Иванова', username: 'anna_i', auth_date: Math.floor(now / 1000), ...over };
  return { ...fields, hash: signTelegramPayload(fields, BOT_TOKEN) };
}

describe('миграция V2', () => {
  it('колонки профиля и таблицы входа; повторное открытие не ломает базу', () => {
    const db = openDb(':memory:');
    expect(db.pragma('user_version', { simple: true })).toBe(2);
    const cols = (db.prepare('PRAGMA table_info(users)').all() as { name: string }[]).map(c => c.name);
    expect(cols).toEqual(expect.arrayContaining(['cursor_id', 'name_custom', 'email', 'google_sub']));
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map(t => t.name);
    expect(tables).toEqual(expect.arrayContaining(['email_codes', 'auth_flows']));
    db.close();
  });
});

describe('GET/PATCH /api/me', () => {
  it('новый пользователь: классический курсор, имя не своё, способов входа нет', async () => {
    const app = await makeApp();
    const a = await anon(app);
    expect(a.body.user).toMatchObject({ cursorId: 'default', nameCustom: false, email: null, telegram: false, google: false, isAnonymous: true });
  });

  it('имя и бесплатный курсор сохраняются; имя нормализуется', async () => {
    const app = await makeApp();
    const a = await anon(app);
    const r = await call(app, 'PATCH', '/api/me', { displayName: '  Бодрый‮   Енот ', cursorId: 'mint' }, { token: a.token });
    expect(r.status).toBe(200);
    expect(r.body.user).toMatchObject({ displayName: 'Бодрый Енот', nameCustom: true, cursorId: 'mint' });
    const me = await call(app, 'GET', '/api/me', undefined, { token: a.token });
    expect(me.body.user).toMatchObject({ displayName: 'Бодрый Енот', cursorId: 'mint' });
    const long = await call(app, 'PATCH', '/api/me', { displayName: 'я'.repeat(100) }, { token: a.token });
    expect(Array.from(long.body.user.displayName)).toHaveLength(40);
  });

  it('ошибки: без сессии 401, пустое имя, неизвестный курсор, Pro без тарифа', async () => {
    const app = await makeApp();
    const a = await anon(app);
    expect((await call(app, 'PATCH', '/api/me', { displayName: 'X' })).status).toBe(401);
    expect((await call(app, 'PATCH', '/api/me', { displayName: '   ' }, { token: a.token })).body.error).toBe('bad-name');
    expect((await call(app, 'PATCH', '/api/me', { cursorId: '<x>' }, { token: a.token })).body.error).toBe('bad-cursor');
    const pro = await call(app, 'PATCH', '/api/me', { cursorId: 'neon' }, { token: a.token });
    expect(pro.status).toBe(403);
    expect(pro.body.error).toBe('plan-cursor');
    expect((await call(app, 'GET', '/api/me', undefined, { token: a.token })).body.user.cursorId).toBe('default');
  });

  it('Pro-курсор на тарифе pro; после истечения тарифа выбор сохраняется', async () => {
    const app = await makeApp();
    const a = await anon(app);
    setPlan(app, a.id, 'pro', app.clock.t + 1000);
    const r = await call(app, 'PATCH', '/api/me', { cursorId: 'aurora' }, { token: a.token });
    expect(r.body.user.cursorId).toBe('aurora');
    app.clock.t += 2000;
    const me = await call(app, 'GET', '/api/me', undefined, { token: a.token });
    expect(me.body.plan).toBe('free');
    expect(me.body.user.cursorId).toBe('aurora'); // хранится; действующий курсор клиент понизит сам
  });

  it('dev-провайдеры разрешают Pro-курсор без тарифа', async () => {
    const app = await makeApp({ devAuth: true });
    const a = await anon(app);
    expect((await call(app, 'PATCH', '/api/me', { cursorId: 'gold' }, { token: a.token })).body.user.cursorId).toBe('gold');
  });

  it('CORS разрешает PATCH', async () => {
    const app = await makeApp();
    const r = await call(app, 'OPTIONS', '/api/me');
    expect(r.headers.get('access-control-allow-methods')).toContain('PATCH');
  });
});

describe('имя от Telegram и своё имя', () => {
  it('вход через Telegram не перезаписывает имя, заданное пользователем', async () => {
    const app = await makeApp();
    const a = await anon(app);
    await call(app, 'PATCH', '/api/me', { displayName: 'Капибара' }, { token: a.token });
    const t = await call(app, 'POST', '/api/auth/telegram', tgPayload(app.clock.t), { token: a.token });
    expect(t.body.user).toMatchObject({ id: a.id, displayName: 'Капибара', telegram: true, isAnonymous: false });
    const again = await call(app, 'POST', '/api/auth/telegram', tgPayload(app.clock.t, { first_name: 'Аня' }));
    expect(again.body.user.displayName).toBe('Капибара');
  });

  it('без своего имени имя берётся из Telegram (до 40 символов)', async () => {
    const app = await makeApp();
    const t = await call(app, 'POST', '/api/auth/telegram', tgPayload(app.clock.t, { first_name: 'Ж'.repeat(50) }));
    expect(t.body.user.nameCustom).toBe(false);
    expect(Array.from(t.body.user.displayName as string).length).toBeLessThanOrEqual(40);
  });
});
