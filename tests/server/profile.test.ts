// Профиль на сервере (Ночь №4): миграция V2, PATCH /api/me, имя провайдера не затирает своё.
import { afterEach, describe, expect, it } from 'vitest';
import { signTelegramPayload } from '../../server/auth';
import Database from 'better-sqlite3';
import { migrate, openDb } from '../../server/db';
import { BOT_TOKEN, anon, call, closeApps, makeApp, setPlan } from './helpers';

afterEach(closeApps);

function tgPayload(now: number, over: Record<string, string | number> = {}) {
  const fields: Record<string, string | number> = { id: 777001, first_name: 'Анна', last_name: 'Иванова', username: 'anna_i', auth_date: Math.floor(now / 1000), ...over };
  return { ...fields, hash: signTelegramPayload(fields, BOT_TOKEN) };
}

describe('миграция V2', () => {
  it('колонки профиля и таблицы входа; повторное открытие не ломает базу', () => {
    const db = openDb(':memory:');
    expect(db.pragma('user_version', { simple: true })).toBe(5); // V5 — модерация именных адресов
    const cols = (db.prepare('PRAGMA table_info(users)').all() as { name: string }[]).map(c => c.name);
    expect(cols).toEqual(expect.arrayContaining(['cursor_id', 'name_custom', 'email', 'google_sub']));
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map(t => t.name);
    expect(tables).toEqual(expect.arrayContaining(['email_codes', 'auth_flows']));
    db.close();
  });
});

describe('миграция V3 (Ночь №5)', () => {
  it('поверх базы V2: данные целы, у приглашений вид link, новые колонка и таблица', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    migrate(db, 2);
    expect(db.pragma('user_version', { simple: true })).toBe(2);
    db.prepare("INSERT INTO users (id, display_name, plan, created_at, updated_at, email) VALUES ('u1', 'Анна', 'free', 1, 1, 'a@b.ru')").run();
    db.prepare("INSERT INTO projects (id, owner_id, title, rev, data_json, created_at, updated_at) VALUES ('p1', 'u1', 'Доска', 1, '{}', 1, 1)").run();
    db.prepare("INSERT INTO invites (token, project_id, created_by, created_at) VALUES ('t1', 'p1', 'u1', 1)").run();
    migrate(db, 3);
    expect(db.pragma('user_version', { simple: true })).toBe(3);
    expect(db.prepare('SELECT display_name, email, google_email FROM users').get()).toEqual({ display_name: 'Анна', email: 'a@b.ru', google_email: null });
    expect(db.prepare('SELECT token, kind FROM invites').get()).toEqual({ token: 't1', kind: 'link' });
    expect(db.prepare('SELECT title FROM projects').get()).toEqual({ title: 'Доска' });
    const cols = (db.prepare('PRAGMA table_info(project_email_invites)').all() as { name: string }[]).map(c => c.name);
    expect(cols).toEqual(expect.arrayContaining(['id', 'project_id', 'host_user_id', 'email', 'role', 'token', 'status', 'created_at', 'updated_at']));
    // приглашение по почте ссылается на свой токен; одно на адрес в проекте
    db.prepare("INSERT INTO invites (token, project_id, created_by, created_at, kind) VALUES ('t2', 'p1', 'u1', 2, 'email')").run();
    db.prepare("INSERT INTO project_email_invites (id, project_id, host_user_id, email, role, token, created_at, updated_at) VALUES ('e1', 'p1', 'u1', 's@x.ru', 'view', 't2', 2, 2)").run();
    expect(db.prepare('SELECT status FROM project_email_invites').get()).toEqual({ status: 'pending' });
    expect(() => db.prepare("INSERT INTO project_email_invites (id, project_id, host_user_id, email, role, token, created_at, updated_at) VALUES ('e2', 'p1', 'u1', 's@x.ru', 'view', 't1', 2, 2)").run()).toThrow();
    migrate(db, 3); // повторно — без изменений
    expect(db.pragma('user_version', { simple: true })).toBe(3);
    db.close();
  });
});

describe('миграция V4 (Ночь №6)', () => {
  it('поверх базы V3: приглашения целы и включены, новые колонки и таблица именных адресов', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    migrate(db, 3);
    db.prepare("INSERT INTO users (id, display_name, plan, created_at, updated_at) VALUES ('u1', 'Анна', 'pro', 1, 1)").run();
    db.prepare("INSERT INTO projects (id, owner_id, title, rev, data_json, created_at, updated_at) VALUES ('p1', 'u1', 'Доска', 1, '{}', 1, 1)").run();
    db.prepare("INSERT INTO invites (token, project_id, created_by, created_at, default_role) VALUES ('t1', 'p1', 'u1', 1, 'view')").run();
    migrate(db, 4);
    expect(db.pragma('user_version', { simple: true })).toBe(4);
    expect(db.prepare('SELECT token, kind, default_role, disabled_at, last_used_at FROM invites').get())
      .toEqual({ token: 't1', kind: 'link', default_role: 'view', disabled_at: null, last_used_at: null });
    db.prepare("INSERT INTO public_aliases (alias, project_id, owner_id, created_at, updated_at) VALUES ('physics-9a', 'p1', 'u1', 2, 2)").run();
    expect(db.prepare('SELECT state FROM public_aliases').get()).toEqual({ state: 'active' });
    expect(() => db.prepare("INSERT INTO public_aliases (alias, project_id, owner_id, created_at, updated_at) VALUES ('physics-9a', 'p1', 'u1', 3, 3)").run()).toThrow();
    // удаление аккаунта оставляет адрес надгробием (owner_id = NULL), а не освобождает его
    db.prepare('DELETE FROM projects').run();
    db.prepare('DELETE FROM invites').run();
    db.prepare('DELETE FROM users').run();
    expect(db.prepare('SELECT alias, project_id, owner_id FROM public_aliases').get()).toEqual({ alias: 'physics-9a', project_id: null, owner_id: null });
    migrate(db, 4);
    expect(db.pragma('user_version', { simple: true })).toBe(4);
    db.close();
  });
});

describe('миграция V5 (модерация именных адресов)', () => {
  it('поверх базы V4: адреса целы и не заблокированы, есть колонки блокировки и индекс по дате создания', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    migrate(db, 4);
    db.prepare("INSERT INTO users (id, display_name, plan, created_at, updated_at) VALUES ('u1', 'Анна', 'pro', 1, 1)").run();
    db.prepare("INSERT INTO projects (id, owner_id, title, rev, data_json, created_at, updated_at) VALUES ('p1', 'u1', 'Доска', 1, '{}', 1, 1)").run();
    db.prepare("INSERT INTO public_aliases (alias, project_id, owner_id, created_at, updated_at) VALUES ('geo', 'p1', 'u1', 2, 2)").run();
    migrate(db);
    expect(db.pragma('user_version', { simple: true })).toBe(5);
    expect(db.prepare('SELECT alias, owner_id, state, created_at, blocked_at, blocked_reason FROM public_aliases').get())
      .toEqual({ alias: 'geo', owner_id: 'u1', state: 'active', created_at: 2, blocked_at: null, blocked_reason: null });
    const idx = (db.prepare('PRAGMA index_list(public_aliases)').all() as { name: string }[]).map(i => i.name);
    expect(idx).toContain('idx_aliases_created');
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
    expect(Array.from(long.body.user.displayName)).toHaveLength(32);
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

  it('без своего имени имя берётся из Telegram (до 32 символов)', async () => {
    const app = await makeApp();
    const t = await call(app, 'POST', '/api/auth/telegram', tgPayload(app.clock.t, { first_name: 'Ж'.repeat(50) }));
    expect(t.body.user.nameCustom).toBe(false);
    expect(Array.from(t.body.user.displayName as string).length).toBeLessThanOrEqual(32);
  });
});
