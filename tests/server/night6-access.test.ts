// Сервер Ночи №6 (SPEC_NIGHT6 §5): роли ссылки, пауза и сброс, /j/:x, именные адреса, просмотр по ссылке (D2),
// клонирование по приглашению (D7), роли и последний вход приглашений по почте.
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { listAliasesForModeration, setAliasBlocked } from '../../server/invites';
import { memoryMailer } from '../../server/mailer';
import { addInvite, anon, call, closeApps, makeApp, proj, putProject, rectEl, setPlan, type TestApp } from './helpers';

afterEach(closeApps);

async function setup(plan = 'pro', over: Parameters<typeof makeApp>[0] = {}) {
  const app = await makeApp({ roomSaveMs: 20, roomIdleMs: 80, ...over });
  const owner = await anon(app);
  setPlan(app, owner.id, plan);
  await putProject(app, owner.token, proj('a', {
    pages: [
      { id: 'a-p1', name: 'Первая', grid: 'square', elements: [rectEl('r1')] },
      { id: 'a-p2', name: 'Вторая', grid: 'square', elements: [rectEl('r2')] },
    ],
  }));
  return { app, owner };
}

const link = (app: TestApp, token: string, body: Record<string, unknown> = {}) =>
  call(app, 'POST', '/api/invites', { projectId: 'a', ...body }, { token });
const open = (app: TestApp, key: string) => call(app, 'GET', `/api/invites/${encodeURIComponent(key)}`);
const setAlias = (app: TestApp, token: string, alias: string, projectId = 'a') =>
  call(app, 'PUT', `/api/projects/${projectId}/alias`, { alias }, { token });

async function until<T>(fn: () => T | undefined | null | false, ms = 3000): Promise<T> {
  const t0 = Date.now();
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error('условие не выполнилось за отведённое время');
    await new Promise(r => setTimeout(r, 5));
  }
}
const sockets: WebSocket[] = [];
afterEach(() => { for (const s of sockets.splice(0)) s.terminate(); });
function joinRoom(app: TestApp, hello: Record<string, unknown>) {
  const ws = new WebSocket(`${app.base.replace('http', 'ws')}/ws/room/a`);
  sockets.push(ws);
  const inbox: Record<string, any>[] = [];
  const closed = new Promise<number>(r => ws.on('close', code => r(code)));
  ws.on('message', d => { try { inbox.push(JSON.parse(d.toString())); } catch { /* не JSON */ } });
  ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', proto: 1, ...hello })));
  ws.on('error', () => {});
  return { inbox, closed, last: (t: string) => [...inbox].reverse().find(m => m.t === t) };
}

describe('роли общей ссылки', () => {
  it('новые роли принимаются; ответ — роль как хранится и старый синоним для прежних клиентов', async () => {
    const { app, owner } = await setup();
    const r = await link(app, owner.token, { defaultRole: 'reader' });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ role: 'reader', defaultRole: 'view', enabled: true, alias: null });
    expect((await link(app, owner.token, { defaultRole: 'commenter' })).body).toMatchObject({ role: 'commenter', defaultRole: 'view' });
    expect((await link(app, owner.token, { defaultRole: 'админ' })).status).toBe(400);
    // без роли — прежняя роль ссылки; у новой ссылки — старый синоним edit (как у клиентов Ночей №3–5)
    expect((await link(app, owner.token)).body.role).toBe('commenter');
  });

  it('старый синоним, совпадающий с синонимом новой роли, роль не меняет (не расширяем молча)', async () => {
    const { app, owner } = await setup();
    await link(app, owner.token, { defaultRole: 'reader' });
    expect((await link(app, owner.token, { defaultRole: 'view' })).body.role).toBe('reader');
    expect((await link(app, owner.token, { defaultRole: 'edit' })).body.role).toBe('edit');
  });

  it('гость по ссылке видит роль: старый синоним в role, новую — в accessRole', async () => {
    const { app, owner } = await setup();
    const { body } = await link(app, owner.token, { defaultRole: 'reader' });
    const v = await open(app, body.token);
    expect(v.status).toBe(200);
    expect(v.body).toMatchObject({ role: 'view', accessRole: 'reader', legacy: false, via: 'token' });
    const p = await call(app, 'GET', `/api/projects/a?invite=${body.token}`);
    expect(p.body).toMatchObject({ defaultRole: 'view', accessRole: 'reader', caps: { comment: false, chat: false } });
  });
});

describe('пауза и сброс общей ссылки', () => {
  it('пауза: ссылка не открывается (link-paused), владелец её видит; включение — тот же токен снова работает', async () => {
    const { app, owner } = await setup();
    const { body } = await link(app, owner.token);
    const paused = await link(app, owner.token, { enabled: false });
    expect(paused.body).toMatchObject({ token: body.token, enabled: false });
    expect(await open(app, body.token)).toMatchObject({ status: 404, body: { error: 'link-paused' } });
    expect((await call(app, 'GET', '/api/invites?projectId=a', undefined, { token: owner.token })).body.invite).toMatchObject({ token: body.token, enabled: false });
    const again = await link(app, owner.token, { enabled: true });
    expect(again.body).toMatchObject({ token: body.token, enabled: true });
    expect((await open(app, body.token)).status).toBe(200);
  });

  it('пауза отключает подключённых гостей (4403)', async () => {
    const { app, owner } = await setup();
    const { body } = await link(app, owner.token);
    const g = joinRoom(app, { invite: body.token });
    await until(() => g.last('init'));
    await link(app, owner.token, { enabled: false });
    expect(await g.closed).toBe(4403);
  });

  it('сброс: новый токен с теми же ролью и копированием, старый мёртв; чужой сброс — 404', async () => {
    const { app, owner } = await setup();
    const { body } = await link(app, owner.token, { defaultRole: 'reader', allowCopy: false });
    const r = await call(app, 'POST', `/api/invites/${body.token}/reset`, undefined, { token: owner.token });
    expect(r.status).toBe(201);
    expect(r.body.token).not.toBe(body.token);
    expect(r.body.token).toMatch(/^[A-Za-z0-9_-]{24}$/);
    expect(r.body).toMatchObject({ role: 'reader', allowCopy: false, enabled: true });
    expect(await open(app, body.token)).toMatchObject({ status: 404, body: { error: 'invite-not-found' } });
    expect((await open(app, r.body.token)).status).toBe(200);
    const stranger = await anon(app);
    expect((await call(app, 'POST', `/api/invites/${r.body.token}/reset`, undefined, { token: stranger.token })).status).toBe(404);
  });
});

describe('/j/:x', () => {
  it('JSON — как /api/invites/:x; HTML — 302 на адрес с параметрами; не токен и не адрес — 404', async () => {
    const { app, owner } = await setup();
    const { body } = await link(app, owner.token);
    const json = await call(app, 'GET', `/j/${body.token}`, undefined, { headers: { Accept: 'application/json' } });
    expect(json.body.projectId).toBe('a');
    const html = await fetch(`${app.base}/j/${body.token}`, { redirect: 'manual', headers: { Accept: 'text/html' } });
    expect(html.status).toBe(302);
    expect(html.headers.get('location')).toBe(`https://abax.example/?route=collab&token=${body.token}`);
    const alias = await fetch(`${app.base}/j/physics-9a-2026`, { redirect: 'manual', headers: { Accept: 'text/html' } });
    expect(alias.headers.get('location')).toBe('https://abax.example/?route=collab&token=physics-9a-2026');
    const junk = await fetch(`${app.base}/j/${encodeURIComponent('не адрес!')}`, { redirect: 'manual' });
    expect(junk.status).toBe(404);
  });

  it('чистая ссылка prettyUrl — только когда клиента раздаёт этот сервер', async () => {
    const plain = await setup();
    expect((await link(plain.app, plain.owner.token)).body.prettyUrl).toBeNull();
    const pretty = await setup('pro', { prettyLinks: true });
    const r = await link(pretty.app, pretty.owner.token);
    expect(r.body.prettyUrl).toBe(`https://abax.example/j/${r.body.token}`);
    await setAlias(pretty.app, pretty.owner.token, 'physics-9a-2026');
    expect((await link(pretty.app, pretty.owner.token)).body.prettyUrl).toBe('https://abax.example/j/physics-9a-2026');
  });
});

describe('именной адрес', () => {
  it('формат, резерв и тариф: bad-alias, Free — plan-limit-alias', async () => {
    const { app, owner } = await setup('free');
    for (const bad of ['ab', 'geo', 'fizika', 'fizika-2026', 'Physics', '9a-x', 'a--b', 'api', 'x'.repeat(24)]) expect((await setAlias(app, owner.token, bad)).body.error).toBe('bad-alias');
    expect(await setAlias(app, owner.token, 'physics-9a-2026')).toMatchObject({ status: 403, body: { error: 'plan-limit-alias' } });
  });

  it('адрес ведёт на общую ссылку доски и не раскрывает её токен', async () => {
    const { app, owner } = await setup();
    const { body } = await link(app, owner.token, { defaultRole: 'commenter' });
    expect((await setAlias(app, owner.token, 'physics-9a-2026')).body).toMatchObject({ alias: 'physics-9a-2026', former: [] });
    const v = await open(app, 'physics-9a-2026');
    expect(v.status).toBe(200);
    expect(v.body).toMatchObject({ token: 'physics-9a-2026', projectId: 'a', accessRole: 'commenter', via: 'alias' });
    expect(JSON.stringify(v.body)).not.toContain(body.token);
    expect((await call(app, 'GET', '/api/projects/a/alias', undefined, { token: owner.token })).body).toMatchObject({ alias: 'physics-9a-2026', former: [] });
  });

  it('переименование: старый адрес — бывший и ведёт туда же; освобождение — «больше не используется»', async () => {
    const { app, owner } = await setup();
    await link(app, owner.token);
    await setAlias(app, owner.token, 'physics-9a-2026');
    expect((await setAlias(app, owner.token, 'fizika-9a-2026')).body).toMatchObject({ alias: 'fizika-9a-2026', former: ['physics-9a-2026'] });
    expect((await open(app, 'physics-9a-2026')).body.projectId).toBe('a');
    expect((await open(app, 'fizika-9a-2026')).body.projectId).toBe('a');
    expect((await call(app, 'DELETE', '/api/projects/a/alias/physics-9a-2026', undefined, { token: owner.token })).status).toBe(200);
    expect(await open(app, 'physics-9a-2026')).toMatchObject({ status: 404, body: { error: 'alias-released' } });
    // свой освобождённый адрес владелец может занять снова
    expect((await setAlias(app, owner.token, 'physics-9a-2026')).status).toBe(200);
    expect((await open(app, 'physics-9a-2026')).status).toBe(200);
  });

  it('адрес другого аккаунта (в т.ч. освобождённый) не достаётся никому', async () => {
    const { app, owner } = await setup();
    await setAlias(app, owner.token, 'physics-9a-2026');
    const other = await anon(app);
    setPlan(app, other.id, 'pro');
    await putProject(app, other.token, proj('b'));
    expect(await setAlias(app, other.token, 'physics-9a-2026', 'b')).toMatchObject({ status: 409, body: { error: 'alias-taken' } });
    await call(app, 'DELETE', '/api/projects/a/alias/physics-9a-2026', undefined, { token: owner.token });
    expect(await setAlias(app, other.token, 'physics-9a-2026', 'b')).toMatchObject({ status: 409, body: { error: 'alias-taken' } });
  });

  it('ссылка на паузе или нет ссылки — link-paused; Free — alias-inactive; доска удалена — board-deleted', async () => {
    const { app, owner } = await setup();
    await setAlias(app, owner.token, 'physics-9a-2026');
    expect((await open(app, 'physics-9a-2026')).body.error).toBe('link-paused'); // общей ссылки ещё нет
    await link(app, owner.token, { enabled: false });
    expect((await open(app, 'physics-9a-2026')).body.error).toBe('link-paused');
    await link(app, owner.token, { enabled: true });
    expect((await open(app, 'physics-9a-2026')).status).toBe(200);
    setPlan(app, owner.id, 'free');
    expect(await open(app, 'physics-9a-2026')).toMatchObject({ status: 404, body: { error: 'alias-inactive' } });
    setPlan(app, owner.id, 'pro');
    await call(app, 'DELETE', '/api/projects/a', undefined, { token: owner.token });
    expect((await open(app, 'physics-9a-2026')).body.error).toBe('board-deleted');
  });

  it('новый адрес — не короче 12 символов; свой старый короткий адрес работает и возвращается', async () => {
    const { app, owner } = await setup();
    await link(app, owner.token);
    for (const short of ['geo', 'fizika', 'fizika-2026']) expect(await setAlias(app, owner.token, short)).toMatchObject({ status: 400, body: { error: 'bad-alias' } });
    // адрес, занятый до введения минимума
    const now = app.clock.t;
    app.db.prepare("INSERT INTO public_aliases (alias, project_id, owner_id, state, created_at, updated_at) VALUES ('geo', 'a', ?, 'active', ?, ?)").run(owner.id, now, now);
    expect((await open(app, 'geo')).body).toMatchObject({ projectId: 'a', via: 'alias' });
    expect((await setAlias(app, owner.token, 'geography-9a')).body).toMatchObject({ alias: 'geography-9a', former: ['geo'] });
    expect((await setAlias(app, owner.token, 'geo')).body).toMatchObject({ alias: 'geo', former: ['geography-9a'] });
  });

  it('занятый адрес: свободные похожие — ни разу никем не занятые', async () => {
    const { app, owner } = await setup();
    await setAlias(app, owner.token, 'fizika-shkola');
    await setAlias(app, owner.token, 'fizika-shkola-2026'); // ближайшая подсказка уже занята (бывший адрес владельца)
    const other = await anon(app);
    setPlan(app, other.id, 'pro');
    await putProject(app, other.token, proj('b'));
    const r = await setAlias(app, other.token, 'fizika-shkola', 'b');
    expect(r).toMatchObject({ status: 409, body: { error: 'alias-taken' } });
    const sug: string[] = r.body.suggestions;
    expect(sug).toHaveLength(3);
    expect(sug).not.toContain('fizika-shkola-2026');
    expect(new Set(sug).size).toBe(3);
    for (const s of sug) {
      expect(s.startsWith('fizika-shkola-')).toBe(true);
      expect((await open(app, s)).body.error).toBe('invite-not-found');
    }
    // подсказка действительно свободна
    expect((await setAlias(app, other.token, sug[0], 'b')).status).toBe(200);
  });

  it('проверка на лету: свободен, свой, занят, короток — без записи в базу; только владельцу', async () => {
    const { app, owner } = await setup();
    await setAlias(app, owner.token, 'fizika-shkola');
    const check = (token: string, alias: string, projectId = 'a') =>
      call(app, 'GET', `/api/projects/${projectId}/alias/check?alias=${encodeURIComponent(alias)}`, undefined, { token });
    expect((await check(owner.token, 'algebra-uroki')).body).toEqual({ alias: 'algebra-uroki', status: 'free', suggestions: [] });
    expect((await check(owner.token, 'fizika-shkola')).body).toMatchObject({ status: 'own', suggestions: [] });
    expect((await check(owner.token, 'Физика')).body).toMatchObject({ status: 'bad', suggestions: [] });
    // короткий: похожие уже нужной длины
    const short = (await check(owner.token, 'fizika')).body;
    expect(short.status).toBe('short');
    expect(short.suggestions).toHaveLength(3);
    for (const sug of short.suggestions) expect(sug.length).toBeGreaterThanOrEqual(12);
    const other = await anon(app);
    setPlan(app, other.id, 'pro');
    await putProject(app, other.token, proj('b'));
    const taken = (await check(other.token, 'fizika-shkola', 'b')).body;
    expect(taken.status).toBe('taken');
    expect(taken.suggestions).toHaveLength(3);
    expect((await check(other.token, 'algebra-uroki')).status).toBe(404); // чужая доска
    expect(listAliasesForModeration(app.app).map(r => r.alias)).toEqual(['fizika-shkola']); // проверка ничего не заняла
    setAliasBlocked(app.app, 'fizika-shkola', true);
    expect((await check(owner.token, 'fizika-shkola')).body.status).toBe('blocked');
  });

  it('модерация: кто и когда занял адрес; блокировка закрывает вход и не даёт занять адрес даже владельцу; снятие — как было', async () => {
    const { app, owner } = await setup();
    await link(app, owner.token);
    await setAlias(app, owner.token, 'physics-9a-2026');
    const createdAt = app.clock.t;
    app.clock.t += 60_000;
    await setAlias(app, owner.token, 'fizika-9a-2026');
    const rows = listAliasesForModeration(app.app);
    expect(rows.map(r => r.alias)).toEqual(['fizika-9a-2026', 'physics-9a-2026']); // свежие сначала
    expect(rows[1]).toMatchObject({ alias: 'physics-9a-2026', state: 'former', ownerId: owner.id, projectId: 'a', projectTitle: expect.any(String), createdAt, blockedAt: null });
    expect(listAliasesForModeration(app.app, { since: createdAt + 1 }).map(r => r.alias)).toEqual(['fizika-9a-2026']);
    expect(listAliasesForModeration(app.app, { ownerId: 'nobody' })).toEqual([]);

    expect(setAliasBlocked(app.app, 'fizika-9a-2026', true, 'оскорбительный адрес')).toBe(true);
    expect(setAliasBlocked(app.app, 'no-such-alias', true)).toBe(false);
    expect(listAliasesForModeration(app.app)[0]).toMatchObject({ alias: 'fizika-9a-2026', state: 'active', blockedAt: app.clock.t, blockedReason: 'оскорбительный адрес' });
    expect(await open(app, 'fizika-9a-2026')).toMatchObject({ status: 404, body: { error: 'alias-blocked' } });
    // владелец не видит заблокированный адрес, не может его вернуть или освободить
    expect((await call(app, 'GET', '/api/projects/a/alias', undefined, { token: owner.token })).body).toMatchObject({ alias: null, former: ['physics-9a-2026'] });
    expect((await link(app, owner.token)).body.alias).toBeNull();
    expect(await setAlias(app, owner.token, 'fizika-9a-2026')).toMatchObject({ status: 409, body: { error: 'alias-blocked' } });
    expect((await call(app, 'DELETE', '/api/projects/a/alias/fizika-9a-2026', undefined, { token: owner.token })).status).toBe(404);

    expect(setAliasBlocked(app.app, 'fizika-9a-2026', false)).toBe(true);
    expect((await open(app, 'fizika-9a-2026')).body.projectId).toBe('a');
    expect(listAliasesForModeration(app.app)[0]).toMatchObject({ alias: 'fizika-9a-2026', state: 'active', blockedAt: null, blockedReason: null });
  });

  it('не больше 20 адресов на аккаунт', async () => {
    const { app, owner } = await setup();
    for (let i = 0; i < 20; i++) expect((await setAlias(app, owner.token, `board-number-${i}`)).status).toBe(200);
    expect(await setAlias(app, owner.token, 'board-number-x')).toMatchObject({ status: 429, body: { error: 'alias-limit' } });
  });

  it('вход в комнату по адресу; пауза ссылки отключает вошедших по адресу (4403)', async () => {
    const { app, owner } = await setup();
    await link(app, owner.token, { defaultRole: 'reader' });
    await setAlias(app, owner.token, 'physics-9a-2026');
    const g = joinRoom(app, { invite: 'physics-9a-2026', name: 'Ученик' });
    const init = await until(() => g.last('init'));
    expect(init).toMatchObject({ role: 'reader', caps: { chat: false } });
    await link(app, owner.token, { enabled: false });
    expect(await g.closed).toBe(4403);
  });
});

describe('просмотр по ссылке на доску (D2) и клонирование (D7)', () => {
  it('linkView: false — без приглашения доска неотличима от несуществующей; с приглашением и владельцу — видна', async () => {
    const { app, owner } = await setup();
    expect((await call(app, 'GET', '/api/projects/a')).status).toBe(200);
    await putProject(app, owner.token, proj('a', { permissions: { linkView: false } }), 1);
    expect(await call(app, 'GET', '/api/projects/a')).toMatchObject({ status: 404, body: { error: 'project-not-found' } });
    const viewer = await anon(app);
    expect((await call(app, 'POST', '/api/projects/a/clone', undefined, { token: viewer.token })).status).toBe(404);
    const { body } = await link(app, owner.token);
    expect((await call(app, 'GET', `/api/projects/a?invite=${body.token}`)).status).toBe(200);
    expect((await call(app, 'GET', '/api/projects/a', undefined, { token: owner.token })).status).toBe(200);
  });

  it('клон по приглашению — по праву копирования роли: старая ссылка с запретом — 403, новый редактор — можно', async () => {
    const { app, owner } = await setup();
    addInvite(app, 'old-view', 'a', owner.id, { defaultRole: 'view', allowCopy: 0 });
    const viewer = await anon(app);
    expect(await call(app, 'POST', '/api/projects/a/clone?invite=old-view', undefined, { token: viewer.token })).toMatchObject({ status: 403, body: { error: 'clone-forbidden' } });
    await putProject(app, owner.token, proj('a', { permissions: { allowCopy: false } }), 1);
    addInvite(app, 'new-editor', 'a', owner.id, { defaultRole: 'editor' });
    addInvite(app, 'new-reader', 'a', owner.id, { defaultRole: 'reader' });
    expect((await call(app, 'POST', '/api/projects/a/clone?invite=new-editor', undefined, { token: viewer.token })).status).toBe(201);
    expect((await call(app, 'POST', '/api/projects/a/clone?invite=new-reader', undefined, { token: viewer.token })).status).toBe(403);
  });
});

describe('копирование в облачной комнате на участника (D1)', () => {
  it('вход по приглашению на почту не снимает запрет копирования у гостей общей ссылки', async () => {
    const { app, owner } = await setup();
    addInvite(app, 'link-nocopy', 'a', owner.id, { defaultRole: 'view', allowCopy: 0 });
    app.db.prepare("INSERT INTO invites (token, project_id, created_by, default_role, allow_copy, page_rights_json, created_at, kind) VALUES ('mail-tok', 'a', ?, 'commenter', 1, '{}', 1, 'email')").run(owner.id);
    const a = joinRoom(app, { invite: 'link-nocopy', name: 'По ссылке' });
    expect((await until(() => a.last('init'))).allowCopy).toBe(false);
    const m = joinRoom(app, { invite: 'mail-tok', name: 'По почте' });
    expect((await until(() => m.last('init'))).allowCopy).toBe(true);
    const b = joinRoom(app, { invite: 'link-nocopy', name: 'Ещё по ссылке' });
    expect((await until(() => b.last('init'))).allowCopy).toBe(false);
    expect(a.inbox.filter(x => x.t === 'rights' && x.allowCopy === true)).toEqual([]);
  });

  it('владелец видит, откуда у гостя доступ', async () => {
    const { app, owner } = await setup();
    addInvite(app, 'link-x', 'a', owner.id, { defaultRole: 'reader' });
    const host = joinRoom(app, { session: owner.token, name: 'Автор' });
    await until(() => host.last('init'));
    const g = joinRoom(app, { invite: 'link-x', name: 'Гость' });
    await until(() => g.last('init'));
    const users = await until(() => host.last('users')?.users?.length === 2 && host.last('users')!.users);
    expect(users.find((u: any) => !u.host).access).toEqual({ role: 'reader', source: 'link' });
    expect((await until(() => g.last('users'))).users.every((u: any) => u.access === undefined)).toBe(true);
    // последний вход по ссылке записан
    expect((app.db.prepare("SELECT last_used_at FROM invites WHERE token = 'link-x'").get() as { last_used_at: number }).last_used_at).toBe(app.clock.t);
  });
});

describe('приглашения по почте: роли и последний вход', () => {
  it('роль по умолчанию — редактор, принимаются новые роли и синонимы; lastUsedAt — после входа по ссылке', async () => {
    const mailer = memoryMailer();
    const { app, owner } = await setup('pro', { mailer });
    const a = await call(app, 'POST', '/api/projects/a/email-invites', { email: 'one@example.com' }, { token: owner.token });
    expect(a.body.invite).toMatchObject({ role: 'editor', lastUsedAt: null });
    const b = await call(app, 'POST', '/api/projects/a/email-invites', { email: 'two@example.com', role: 'reader' }, { token: owner.token });
    expect(b.body.invite.role).toBe('reader');
    expect((await call(app, 'POST', '/api/projects/a/email-invites', { email: 'x@example.com', role: 'owner' }, { token: owner.token })).body.error).toBe('bad-role');
    const token = /token=([A-Za-z0-9_-]+)/.exec(mailer.outbox.at(-1)!.text)![1];
    expect((await open(app, token)).body).toMatchObject({ accessRole: 'reader', via: 'token' });
    const list = await call(app, 'GET', '/api/projects/a/email-invites', undefined, { token: owner.token });
    expect(list.body.invites.find((i: any) => i.email === 'two@example.com').lastUsedAt).toBe(app.clock.t);
    expect(mailer.outbox.at(-1)!.text).toContain('посмотреть доску');
  });
});

describe('защита чужих элементов на сервере (SPEC_NIGHT6 §4)', () => {
  async function lesson(protect = true) {
    const ctx = await setup();
    await putProject(ctx.app, ctx.owner.token, proj('a', {
      permissions: protect ? { protectElements: true } : {},
      pages: [{ id: 'a-p1', name: 'Задачи', grid: 'square', elements: [rectEl('teacher')] }],
    }), 1);
    addInvite(ctx.app, 'inv-ed', 'a', ctx.owner.id, { defaultRole: 'editor' });
    return ctx;
  }
  const stored = (app: TestApp) => JSON.parse((app.db.prepare("SELECT data_json FROM projects WHERE id = 'a'").get() as { data_json: string }).data_json);
  const patch = (ops: unknown[]) => ({ t: 'patch', pageId: 'a-p1', rev: 1, ops });

  it('REST-патч: свой элемент — с автором из сессии, элемент учителя не стирается и не меняется (refused)', async () => {
    const { app } = await lesson();
    const guest = await anon(app);
    const a = await call(app, 'POST', '/api/projects/a/patch?invite=inv-ed', patch([{ op: 'put', el: { ...rectEl('mine'), by: 'u:teacher' } }]), { token: guest.token });
    expect(a.body).toMatchObject({ ok: true, refused: [] });
    expect(stored(app).pages[0].elements.find((e: any) => e.id === 'mine').by).toBe(`u:${guest.id}`);
    const b = await call(app, 'POST', '/api/projects/a/patch?invite=inv-ed', patch([{ op: 'del', id: 'teacher' }, { op: 'put', el: { ...rectEl('teacher'), x: 50 } }]), { token: guest.token });
    expect(b.body.refused).toEqual(['teacher', 'teacher']);
    expect(stored(app).pages[0].elements.find((e: any) => e.id === 'teacher')).toEqual(rectEl('teacher'));
    // без сессии при защите новые элементы не принимаются (автор неизвестен)
    const c = await call(app, 'POST', '/api/projects/a/patch?invite=inv-ed', patch([{ op: 'put', el: rectEl('anon') }]));
    expect(c.body.refused).toEqual(['anon']);
  });

  it('без защиты REST-патч гостя правит элемент учителя, как раньше', async () => {
    const { app } = await lesson(false);
    const r = await call(app, 'POST', '/api/projects/a/patch?invite=inv-ed', patch([{ op: 'put', el: { ...rectEl('teacher'), x: 50 } }]));
    expect(r.body.refused).toEqual([]);
    expect(stored(app).pages[0].elements[0].x).toBe(50);
  });

  it('устаревшее сохранение владельца (mergeStale) не теряет автора элемента гостя', async () => {
    const { app, owner } = await lesson();
    const guest = await anon(app);
    await call(app, 'POST', '/api/projects/a/patch?invite=inv-ed', patch([{ op: 'put', el: rectEl('mine') }]), { token: guest.token });
    // старый клиент владельца прислал элемент без by и с устаревшей ревизией
    await putProject(app, owner.token, proj('a', {
      permissions: { protectElements: true },
      pages: [{ id: 'a-p1', name: 'Задачи', grid: 'square', elements: [rectEl('teacher'), { ...rectEl('mine'), x: 2 }] }],
    }), 1);
    expect(stored(app).pages[0].elements.find((e: any) => e.id === 'mine')).toMatchObject({ x: 2, by: `u:${guest.id}` });
  });

  it('облачная комната: два устройства одного аккаунта — один автор; переподключение анонимного гостя — тот же автор', async () => {
    const { app } = await lesson();
    const guest = await anon(app);
    const d1 = joinRoom(app, { invite: 'inv-ed', session: guest.token });
    const init1 = await until(() => d1.last('init'));
    const d2 = joinRoom(app, { invite: 'inv-ed', session: guest.token });
    const init2 = await until(() => d2.last('init'));
    expect(init1.principal).toBe(`u:${guest.id}`);
    expect(init2.principal).toBe(`u:${guest.id}`);
    expect(init1.resume).toBeUndefined(); // автор из сессии — секрет возобновления не нужен
    // элемент, нарисованный на первом устройстве, правится со второго
    const ws1 = sockets[sockets.length - 2];
    const ws2 = sockets[sockets.length - 1];
    ws1.send(JSON.stringify({ t: 'caps', patches: true }));
    ws1.send(JSON.stringify(patch([{ op: 'put', el: { ...rectEl('stroke'), by: init1.principal } }])));
    await until(() => app.rooms.projectOf('a')?.pages[0].elements.some(e => e.id === 'stroke'));
    ws2.send(JSON.stringify(patch([{ op: 'put', el: { ...rectEl('stroke'), x: 11, by: init2.principal } }])));
    await until(() => (app.rooms.projectOf('a')?.pages[0].elements.find(e => e.id === 'stroke') as any)?.x === 11);
    ws2.send(JSON.stringify(patch([{ op: 'del', id: 'teacher' }])));
    await new Promise(r => setTimeout(r, 50));
    expect(app.rooms.projectOf('a')!.pages[0].elements.some(e => e.id === 'teacher')).toBe(true);
  });
});
