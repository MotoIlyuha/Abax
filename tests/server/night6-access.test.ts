// Сервер Ночи №6 (SPEC_NIGHT6 §5): роли ссылки, пауза и сброс, /j/:x, именные адреса, просмотр по ссылке (D2),
// клонирование по приглашению (D7), роли и последний вход приглашений по почте.
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
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
    const alias = await fetch(`${app.base}/j/physics-9a`, { redirect: 'manual', headers: { Accept: 'text/html' } });
    expect(alias.headers.get('location')).toBe('https://abax.example/?route=collab&token=physics-9a');
    const junk = await fetch(`${app.base}/j/${encodeURIComponent('не адрес!')}`, { redirect: 'manual' });
    expect(junk.status).toBe(404);
  });

  it('чистая ссылка prettyUrl — только когда клиента раздаёт этот сервер', async () => {
    const plain = await setup();
    expect((await link(plain.app, plain.owner.token)).body.prettyUrl).toBeNull();
    const pretty = await setup('pro', { prettyLinks: true });
    const r = await link(pretty.app, pretty.owner.token);
    expect(r.body.prettyUrl).toBe(`https://abax.example/j/${r.body.token}`);
    await setAlias(pretty.app, pretty.owner.token, 'physics-9a');
    expect((await link(pretty.app, pretty.owner.token)).body.prettyUrl).toBe('https://abax.example/j/physics-9a');
  });
});

describe('именной адрес', () => {
  it('формат, резерв и тариф: bad-alias, Free — plan-limit-alias', async () => {
    const { app, owner } = await setup('free');
    for (const bad of ['ab', 'Physics', '9a-x', 'a--b', 'api', 'x'.repeat(24)]) expect((await setAlias(app, owner.token, bad)).body.error).toBe('bad-alias');
    expect(await setAlias(app, owner.token, 'physics-9a')).toMatchObject({ status: 403, body: { error: 'plan-limit-alias' } });
  });

  it('адрес ведёт на общую ссылку доски и не раскрывает её токен', async () => {
    const { app, owner } = await setup();
    const { body } = await link(app, owner.token, { defaultRole: 'commenter' });
    expect((await setAlias(app, owner.token, 'physics-9a')).body).toMatchObject({ alias: 'physics-9a', former: [] });
    const v = await open(app, 'physics-9a');
    expect(v.status).toBe(200);
    expect(v.body).toMatchObject({ token: 'physics-9a', projectId: 'a', accessRole: 'commenter', via: 'alias' });
    expect(JSON.stringify(v.body)).not.toContain(body.token);
    expect((await call(app, 'GET', '/api/projects/a/alias', undefined, { token: owner.token })).body).toMatchObject({ alias: 'physics-9a', former: [] });
  });

  it('переименование: старый адрес — бывший и ведёт туда же; освобождение — «больше не используется»', async () => {
    const { app, owner } = await setup();
    await link(app, owner.token);
    await setAlias(app, owner.token, 'physics-9a');
    expect((await setAlias(app, owner.token, 'fizika-9a')).body).toMatchObject({ alias: 'fizika-9a', former: ['physics-9a'] });
    expect((await open(app, 'physics-9a')).body.projectId).toBe('a');
    expect((await open(app, 'fizika-9a')).body.projectId).toBe('a');
    expect((await call(app, 'DELETE', '/api/projects/a/alias/physics-9a', undefined, { token: owner.token })).status).toBe(200);
    expect(await open(app, 'physics-9a')).toMatchObject({ status: 404, body: { error: 'alias-released' } });
    // свой освобождённый адрес владелец может занять снова
    expect((await setAlias(app, owner.token, 'physics-9a')).status).toBe(200);
    expect((await open(app, 'physics-9a')).status).toBe(200);
  });

  it('адрес другого аккаунта (в т.ч. освобождённый) не достаётся никому', async () => {
    const { app, owner } = await setup();
    await setAlias(app, owner.token, 'physics-9a');
    const other = await anon(app);
    setPlan(app, other.id, 'pro');
    await putProject(app, other.token, proj('b'));
    expect(await setAlias(app, other.token, 'physics-9a', 'b')).toMatchObject({ status: 409, body: { error: 'alias-taken' } });
    await call(app, 'DELETE', '/api/projects/a/alias/physics-9a', undefined, { token: owner.token });
    expect(await setAlias(app, other.token, 'physics-9a', 'b')).toMatchObject({ status: 409, body: { error: 'alias-taken' } });
  });

  it('ссылка на паузе или нет ссылки — link-paused; Free — alias-inactive; доска удалена — board-deleted', async () => {
    const { app, owner } = await setup();
    await setAlias(app, owner.token, 'physics-9a');
    expect((await open(app, 'physics-9a')).body.error).toBe('link-paused'); // общей ссылки ещё нет
    await link(app, owner.token, { enabled: false });
    expect((await open(app, 'physics-9a')).body.error).toBe('link-paused');
    await link(app, owner.token, { enabled: true });
    expect((await open(app, 'physics-9a')).status).toBe(200);
    setPlan(app, owner.id, 'free');
    expect(await open(app, 'physics-9a')).toMatchObject({ status: 404, body: { error: 'alias-inactive' } });
    setPlan(app, owner.id, 'pro');
    await call(app, 'DELETE', '/api/projects/a', undefined, { token: owner.token });
    expect((await open(app, 'physics-9a')).body.error).toBe('board-deleted');
  });

  it('не больше 20 адресов на аккаунт', async () => {
    const { app, owner } = await setup();
    for (let i = 0; i < 20; i++) expect((await setAlias(app, owner.token, `board-${i}`)).status).toBe(200);
    expect(await setAlias(app, owner.token, 'board-x')).toMatchObject({ status: 429, body: { error: 'alias-limit' } });
  });

  it('вход в комнату по адресу; пауза ссылки отключает вошедших по адресу (4403)', async () => {
    const { app, owner } = await setup();
    await link(app, owner.token, { defaultRole: 'reader' });
    await setAlias(app, owner.token, 'physics-9a');
    const g = joinRoom(app, { invite: 'physics-9a', name: 'Ученик' });
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
