// Сервер Abax: сессии, анонимный вход, Telegram Login, слияние аккаунтов, /api/me.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { signSession, signTelegramPayload, verifySession, verifyTelegramLogin } from '../../server/auth';
import { loadJwtSecret } from '../../server/config';
import { openDb } from '../../server/db';
import { BOT_TOKEN, anon, call, closeApps, makeApp, setPlan } from './helpers';

afterEach(closeApps);

const DAY = 24 * 3600 * 1000;

function tgPayload(now: number, over: Record<string, string | number> = {}, token = BOT_TOKEN) {
  const fields: Record<string, string | number> = {
    id: 777000111, first_name: 'Анна', last_name: 'Иванова', username: 'anna_i',
    photo_url: 'https://t.me/i/userpic/320/anna.jpg', auth_date: Math.floor(now / 1000), ...over,
  };
  return { ...fields, hash: signTelegramPayload(fields, token) };
}

describe('сессионные токены', () => {
  const now = 1_700_000_000_000;
  it('подписанный токен проверяется; чужой секрет, порча и срок — нет', () => {
    const t = signSession('s1', 'user-1', now);
    expect(verifySession('s1', t, now)).toEqual({ sub: 'user-1' });
    expect(verifySession('s2', t, now)).toBeNull();
    expect(verifySession('s1', t, now + 31 * DAY)).toBeNull();
    const [h, b, s] = t.split('.');
    const forged = Buffer.from(JSON.stringify({ sub: 'admin', exp: 9_999_999_999 })).toString('base64url');
    expect(verifySession('s1', `${h}.${forged}.${s}`, now)).toBeNull();
    expect(verifySession('s1', `${h}.${b}`, now)).toBeNull();
    expect(verifySession('s1', 'мусор', now)).toBeNull();
  });

  it('alg=none и другие алгоритмы отвергаются', () => {
    const none = `${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub: 'x', exp: 9_999_999_999 })).toString('base64url')}.`;
    expect(verifySession('s1', none, now)).toBeNull();
  });
});

describe('анонимный вход', () => {
  it('создаёт free-пользователя, выдаёт токен и cookie abax_session', async () => {
    const app = await makeApp();
    const r = await call(app, 'POST', '/api/auth/anon', { deviceToken: 'a'.repeat(43) });
    expect(r.status).toBe(200);
    expect(r.body.user).toMatchObject({ isAnonymous: true, plan: 'free', displayName: 'Гость', tgUsername: null });
    expect(r.body.plan).toBe('free');
    expect(r.body.limits).toEqual({ maxProjects: 3, maxPagesPerProject: 3, maxRoomGuests: 1, canForbidClone: false, canDisableCopy: false });
    expect(r.body.limitsEnforced).toBe(true);
    const cookie = r.headers.get('set-cookie')!;
    expect(cookie).toContain(`abax_session=${r.body.token}`);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
    expect(cookie).toMatch(/Path=\//);
  });

  it('тот же токен устройства — тот же пользователь; в базе только хэш токена', async () => {
    const app = await makeApp();
    const a = await anon(app, 'b'.repeat(43));
    const again = await anon(app, 'b'.repeat(43));
    const other = await anon(app, 'c'.repeat(43));
    expect(again.id).toBe(a.id);
    expect(other.id).not.toBe(a.id);
    const row = app.db.prepare('SELECT device_token_hash FROM users WHERE id = ?').get(a.id) as { device_token_hash: string };
    expect(row.device_token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(app.db.prepare('SELECT * FROM users').all())).not.toContain('b'.repeat(43));
  });

  it('негодный токен устройства — 400', async () => {
    const app = await makeApp();
    for (const deviceToken of [undefined, '', 'короткий', 'x'.repeat(31), 'x'.repeat(129), 'нельзя русские буквы!!!!!!!!!!!!!!!!!!!!!!!!!!!', 5]) {
      expect((await call(app, 'POST', '/api/auth/anon', { deviceToken })).status).toBe(400);
    }
    expect((await call(app, 'POST', '/api/auth/anon', '{не json')).status).toBe(400);
    expect(app.db.prepare('SELECT COUNT(*) n FROM users').get()).toEqual({ n: 0 });
  });

  it('не больше N новых анонимов с одного адреса за окно; знакомые устройства входят всегда', async () => {
    const app = await makeApp({ anonRateMax: 2 });
    const a = await anon(app, 'd'.repeat(43));
    await anon(app, 'e'.repeat(43));
    const third = await call(app, 'POST', '/api/auth/anon', { deviceToken: 'f'.repeat(43) });
    expect(third.status).toBe(429);
    expect(third.body.error).toBe('rate-limited');
    expect((await anon(app, 'd'.repeat(43))).id).toBe(a.id);
    app.clock.t += 2 * 3600_000;
    expect((await call(app, 'POST', '/api/auth/anon', { deviceToken: 'f'.repeat(43) })).status).toBe(200);
  });
});

describe('GET /api/me', () => {
  it('Bearer и cookie принимаются; без сессии — 401 и пользователь не создаётся', async () => {
    const app = await makeApp();
    expect((await call(app, 'GET', '/api/me')).status).toBe(401);
    expect(app.db.prepare('SELECT COUNT(*) n FROM users').get()).toEqual({ n: 0 });
    const a = await anon(app);
    const bearer = await call(app, 'GET', '/api/me', undefined, { token: a.token });
    expect(bearer.status).toBe(200);
    expect(bearer.body.user.id).toBe(a.id);
    const cookie = await call(app, 'GET', '/api/me', undefined, { headers: { Cookie: `x=1; abax_session=${a.token}` } });
    expect(cookie.body.user.id).toBe(a.id);
  });

  it('поддельный и просроченный токены — 401', async () => {
    const app = await makeApp();
    const a = await anon(app);
    expect((await call(app, 'GET', '/api/me', undefined, { token: a.token + 'x' })).status).toBe(401);
    app.clock.t += 31 * DAY;
    expect((await call(app, 'GET', '/api/me', undefined, { token: a.token })).status).toBe(401);
  });

  it('токен удалённого пользователя — 401', async () => {
    const app = await makeApp();
    const a = await anon(app);
    app.db.prepare('DELETE FROM users WHERE id = ?').run(a.id);
    expect((await call(app, 'GET', '/api/me', undefined, { token: a.token })).status).toBe(401);
  });

  it('pro и tutor: лимиты без ограничений (null); истёкший plan_expires_at — free', async () => {
    const app = await makeApp();
    const a = await anon(app);
    setPlan(app, a.id, 'pro', app.clock.t + DAY);
    let me = (await call(app, 'GET', '/api/me', undefined, { token: a.token })).body;
    expect(me.plan).toBe('pro');
    expect(me.user.plan).toBe('pro');
    expect(me.planExpiresAt).toBe(app.clock.t + DAY);
    expect(me.limits).toEqual({ maxProjects: null, maxPagesPerProject: null, maxRoomGuests: null, canForbidClone: true, canDisableCopy: true });
    setPlan(app, a.id, 'tutor', null);
    expect((await call(app, 'GET', '/api/me', undefined, { token: a.token })).body.plan).toBe('tutor');
    app.clock.t += 2 * DAY;
    setPlan(app, a.id, 'pro', app.clock.t - 1000);
    me = (await call(app, 'GET', '/api/me', undefined, { token: a.token })).body;
    expect(me.plan).toBe('free');
    expect(me.limits.maxProjects).toBe(3);
    expect(me.planExpiresAt).toBe(app.clock.t - 1000);
  });

  it('limitsEnforced отражает настройку сервера', async () => {
    const app = await makeApp({ enforceLimits: false });
    const a = await anon(app);
    expect(a.body.limitsEnforced).toBe(false);
  });
});

describe('вход через Telegram', () => {
  it('верная подпись: пользователь создаётся с профилем Telegram', async () => {
    const app = await makeApp();
    const r = await call(app, 'POST', '/api/auth/telegram', tgPayload(app.clock.t));
    expect(r.status).toBe(200);
    expect(r.body.user).toMatchObject({ isAnonymous: false, displayName: 'Анна Иванова', tgUsername: 'anna_i', plan: 'free' });
    expect(r.body.user.avatarUrl).toBe('https://t.me/i/userpic/320/anna.jpg');
    const again = await call(app, 'POST', '/api/auth/telegram', tgPayload(app.clock.t));
    expect(again.body.user.id).toBe(r.body.user.id);
    expect(app.db.prepare('SELECT COUNT(*) n FROM users').get()).toEqual({ n: 1 });
    expect((await call(app, 'GET', '/api/me', undefined, { token: r.body.token })).status).toBe(200);
  });

  it('неверная подпись, чужой бот, изменённое поле, отсутствующий hash — 401', async () => {
    const app = await makeApp();
    const good = tgPayload(app.clock.t);
    expect((await call(app, 'POST', '/api/auth/telegram', { ...good, hash: '0'.repeat(64) })).status).toBe(401);
    expect((await call(app, 'POST', '/api/auth/telegram', { ...good, hash: 'zz' })).status).toBe(401);
    expect((await call(app, 'POST', '/api/auth/telegram', { ...good, id: 1 })).status).toBe(401);
    expect((await call(app, 'POST', '/api/auth/telegram', { ...good, first_name: 'Взломщик' })).status).toBe(401);
    expect((await call(app, 'POST', '/api/auth/telegram', { ...good, extra: 'поле' })).status).toBe(401);
    expect((await call(app, 'POST', '/api/auth/telegram', tgPayload(app.clock.t, {}, 'другой:токен'))).status).toBe(401);
    const { hash: _h, ...noHash } = good;
    expect((await call(app, 'POST', '/api/auth/telegram', noHash)).status).toBe(401);
    expect((await call(app, 'POST', '/api/auth/telegram', 'null')).status).toBe(401);
    expect(app.db.prepare('SELECT COUNT(*) n FROM users').get()).toEqual({ n: 0 });
  });

  it('просроченный (старше суток) и «из будущего» auth_date — 401', async () => {
    const app = await makeApp();
    const sec = Math.floor(app.clock.t / 1000);
    expect((await call(app, 'POST', '/api/auth/telegram', tgPayload(app.clock.t, { auth_date: sec - 24 * 3600 - 10 }))).status).toBe(401);
    expect((await call(app, 'POST', '/api/auth/telegram', tgPayload(app.clock.t, { auth_date: sec - 23 * 3600 }))).status).toBe(200);
    expect((await call(app, 'POST', '/api/auth/telegram', tgPayload(app.clock.t, { auth_date: sec + 3600 }))).status).toBe(401);
  });

  it('verifyTelegramLogin: поля в любом порядке, лишние null игнорируются', () => {
    const now = 1_700_000_000_000;
    const p = tgPayload(now);
    const shuffled = Object.fromEntries(Object.entries(p).reverse());
    expect(verifyTelegramLogin(shuffled, BOT_TOKEN, now)).toBe(true);
    expect(verifyTelegramLogin({ ...p, last_name: null }, BOT_TOKEN, now)).toBe(false);
    expect(verifyTelegramLogin([], BOT_TOKEN, now)).toBe(false);
    expect(verifyTelegramLogin(null, BOT_TOKEN, now)).toBe(false);
  });

  it('без токена бота вход через Telegram отключён — 503', async () => {
    const app = await makeApp({ telegramBotToken: null });
    expect((await call(app, 'POST', '/api/auth/telegram', tgPayload(app.clock.t))).status).toBe(503);
  });
});

describe('слияние аккаунтов', () => {
  const addProject = (app: Awaited<ReturnType<typeof makeApp>>, id: string, owner: string) =>
    app.db.prepare('INSERT INTO projects (id, owner_id, title, data_json, created_at, updated_at) VALUES (?, ?, ?, ?, 1, 1)').run(id, owner, id, '{}');

  it('аноним входит через новый Telegram-аккаунт: тот же пользователь, проекты на месте', async () => {
    const app = await makeApp();
    const a = await anon(app);
    addProject(app, 'p1', a.id);
    addProject(app, 'p2', a.id);
    const r = await call(app, 'POST', '/api/auth/telegram', tgPayload(app.clock.t), { token: a.token });
    expect(r.status).toBe(200);
    expect(r.body.user.id).toBe(a.id);
    expect(r.body.user.isAnonymous).toBe(false);
    expect(app.db.prepare('SELECT COUNT(*) n FROM projects WHERE owner_id = ?').get(a.id)).toEqual({ n: 2 });
    // устройство продолжает входить в тот же аккаунт
    expect((await anon(app, a.device)).id).toBe(a.id);
  });

  it('аноним входит в уже существующий Telegram-аккаунт: проекты, приглашения, ассеты и ревизии переходят, аноним удаляется', async () => {
    const app = await makeApp();
    const t = await call(app, 'POST', '/api/auth/telegram', tgPayload(app.clock.t));
    const tgUser = t.body.user.id as string;
    addProject(app, 'tp', tgUser);
    const a = await anon(app);
    addProject(app, 'ap1', a.id);
    addProject(app, 'ap2', a.id);
    app.db.prepare("INSERT INTO invites (token, project_id, created_by, created_at) VALUES ('tok1', 'ap1', ?, 1)").run(a.id);
    app.db.prepare("INSERT INTO assets (hash, mime_type, size_bytes, storage_key, uploaded_by, created_at) VALUES (?, 'image/png', 1, 'k', ?, 1)").run('a'.repeat(64), a.id);
    app.db.prepare("INSERT INTO project_revisions (project_id, rev, author_id, patch_json, created_at) VALUES ('ap1', 2, ?, '{}', 1)").run(a.id);

    const r = await call(app, 'POST', '/api/auth/telegram', tgPayload(app.clock.t), { token: a.token });
    expect(r.status).toBe(200);
    expect(r.body.user.id).toBe(tgUser);
    const owners = app.db.prepare('SELECT id, owner_id FROM projects ORDER BY id').all();
    expect(owners).toEqual([{ id: 'ap1', owner_id: tgUser }, { id: 'ap2', owner_id: tgUser }, { id: 'tp', owner_id: tgUser }]);
    expect(app.db.prepare("SELECT created_by FROM invites WHERE token = 'tok1'").get()).toEqual({ created_by: tgUser });
    expect(app.db.prepare('SELECT uploaded_by FROM assets').get()).toEqual({ uploaded_by: tgUser });
    expect(app.db.prepare('SELECT author_id FROM project_revisions').get()).toEqual({ author_id: tgUser });
    expect(app.db.prepare('SELECT COUNT(*) n FROM users WHERE id = ?').get(a.id)).toEqual({ n: 0 });
    // устройство анонима теперь ведёт в Telegram-аккаунт
    expect((await anon(app, a.device)).id).toBe(tgUser);
  });

  it('вход Telegram-пользователя без сессии или из чужой Telegram-сессии ничего не сливает', async () => {
    const app = await makeApp();
    const first = await call(app, 'POST', '/api/auth/telegram', tgPayload(app.clock.t, { id: 1001 }));
    addProject(app, 'x1', first.body.user.id);
    const second = await call(app, 'POST', '/api/auth/telegram', tgPayload(app.clock.t, { id: 1002 }), { token: first.body.token });
    expect(second.body.user.id).not.toBe(first.body.user.id);
    expect(app.db.prepare('SELECT owner_id FROM projects').get()).toEqual({ owner_id: first.body.user.id });
  });

  it('слияние атомарно: при сбое ничего не переносится', async () => {
    const app = await makeApp();
    const t = await call(app, 'POST', '/api/auth/telegram', tgPayload(app.clock.t));
    const a = await anon(app);
    addProject(app, 'ap', a.id);
    // ломаем последний шаг переноса: триггер на project_revisions не даёт обновить author_id
    app.db.exec("CREATE TRIGGER fail_rev BEFORE UPDATE ON project_revisions BEGIN SELECT RAISE(ABORT, 'нельзя'); END");
    app.db.prepare("INSERT INTO project_revisions (project_id, rev, author_id, patch_json, created_at) VALUES ('ap', 2, ?, '{}', 1)").run(a.id);
    const r = await call(app, 'POST', '/api/auth/telegram', tgPayload(app.clock.t), { token: a.token });
    expect(r.status).toBe(500);
    expect(app.db.prepare("SELECT owner_id FROM projects WHERE id = 'ap'").get()).toEqual({ owner_id: a.id });
    expect(app.db.prepare('SELECT COUNT(*) n FROM users WHERE id = ?').get(a.id)).toEqual({ n: 1 });
    expect(t.status).toBe(200);
  });
});

describe('выход, CORS и общие ответы', () => {
  it('logout стирает cookie', async () => {
    const app = await makeApp();
    const r = await call(app, 'POST', '/api/auth/logout');
    expect(r.status).toBe(200);
    expect(r.headers.get('set-cookie')).toMatch(/abax_session=;.*Max-Age=0/);
  });

  it('CORS: предзапрос и обычные ответы открыты для любого источника, без credentials; nosniff', async () => {
    const app = await makeApp();
    const pre = await call(app, 'OPTIONS', '/api/projects/x');
    expect(pre.status).toBe(204);
    expect(pre.headers.get('access-control-allow-origin')).toBe('*');
    expect(pre.headers.get('access-control-allow-headers')).toMatch(/Authorization/);
    expect(pre.headers.get('access-control-allow-credentials')).toBeNull();
    const r = await call(app, 'GET', '/api/me');
    expect(r.headers.get('access-control-allow-origin')).toBe('*');
    expect(r.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('неизвестный путь API — 404, неверный метод — 405, слишком большое тело — 413', async () => {
    const app = await makeApp();
    expect((await call(app, 'GET', '/api/нет')).status).toBe(404);
    expect((await call(app, 'GET', '/api/auth/anon')).status).toBe(405);
    const big = await call(app, 'POST', '/api/auth/anon', JSON.stringify({ deviceToken: 'x'.repeat(2 * 1024 * 1024) }), { headers: { 'Content-Type': 'application/json' } });
    expect(big.status).toBe(413);
  });
});

describe('секрет сессий и база', () => {
  it('JWT_SECRET из окружения; в проде обязателен; в разработке создаётся файл и переиспользуется', () => {
    const dir = mkdtempSync(join(tmpdir(), 'abax-secret-'));
    try {
      expect(loadJwtSecret({ JWT_SECRET: 'из-окружения' }, dir)).toBe('из-окружения');
      expect(() => loadJwtSecret({ NODE_ENV: 'production' }, dir)).toThrow(/JWT_SECRET/);
      const s1 = loadJwtSecret({}, join(dir, 'data'));
      expect(s1).toMatch(/^[0-9a-f]{64}$/);
      expect(loadJwtSecret({}, join(dir, 'data'))).toBe(s1);
      expect(readFileSync(join(dir, 'data', 'jwt-secret'), 'utf8').trim()).toBe(s1);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('база: WAL у файла, внешние ключи, все таблицы и повторная миграция безопасна', () => {
    const dir = mkdtempSync(join(tmpdir(), 'abax-db-'));
    try {
      const path = join(dir, 'sub', 'abax.db');
      const db = openDb(path);
      expect(db.pragma('journal_mode', { simple: true })).toBe('wal');
      expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
      const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[]).map(t => t.name).sort();
      expect(tables).toEqual(['assets', 'auth_flows', 'email_codes', 'invites', 'project_revisions', 'projects', 'users']); // + таблицы входа Ночи №4
      db.prepare("INSERT INTO users (id, created_at, updated_at) VALUES ('u', 1, 1)").run();
      db.close();
      const again = openDb(path);
      expect(again.prepare('SELECT COUNT(*) n FROM users').get()).toEqual({ n: 1 });
      expect(() => again.prepare("INSERT INTO projects (id, owner_id, title, data_json, created_at, updated_at) VALUES ('p', 'нет', 't', '{}', 1, 1)").run()).toThrow();
      again.close();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('каскад: удаление пользователя убирает его проекты, ревизии и приглашения', async () => {
    const app = await makeApp();
    const a = await anon(app);
    app.db.prepare("INSERT INTO projects (id, owner_id, title, data_json, created_at, updated_at) VALUES ('p', ?, 't', '{}', 1, 1)").run(a.id);
    app.db.prepare("INSERT INTO project_revisions (project_id, rev, patch_json, created_at) VALUES ('p', 2, '{}', 1)").run();
    app.db.prepare("INSERT INTO invites (token, project_id, created_by, created_at) VALUES ('t', 'p', ?, 1)").run(a.id);
    app.db.prepare('DELETE FROM users WHERE id = ?').run(a.id);
    for (const t of ['projects', 'project_revisions', 'invites']) expect(app.db.prepare(`SELECT COUNT(*) n FROM ${t}`).get()).toEqual({ n: 0 });
  });
});
