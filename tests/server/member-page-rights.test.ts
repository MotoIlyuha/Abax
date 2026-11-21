// Личные права участника на страницы (меню аватара «Настройки доступа») сохраняются за пользователем:
// переживают перезаход и выгрузку комнаты, действуют в REST (просмотр, /api/invites, патчи, копия), не задевают других.
// Удаление вместе с доской — тест миграции V7 (tests/server/profile.test.ts).
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { memberPageRights } from '../../server/invites';
import { addInvite, anon, call, closeApps, makeApp, proj, putProject, rectEl, setPlan, type TestApp } from './helpers';

afterEach(closeApps);

async function setup() {
  const app = await makeApp({ roomSaveMs: 20, roomIdleMs: 80 });
  const owner = await anon(app);
  setPlan(app, owner.id, 'pro');
  await putProject(app, owner.token, proj('a', {
    pages: [
      { id: 'a-p1', name: 'Первая', grid: 'square', elements: [rectEl('r1')] },
      { id: 'a-p2', name: 'Вторая', grid: 'square', elements: [rectEl('r2')] },
    ],
  }));
  addInvite(app, 'link-x', 'a', owner.id, { defaultRole: 'editor' });
  return { app, owner };
}

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
  return {
    ws, inbox, closed,
    last: (t: string) => [...inbox].reverse().find(m => m.t === t),
    send: (m: unknown) => ws.send(JSON.stringify(m)),
  };
}
const pageIds = (m: any): string[] => m.project.pages.map((p: any) => p.id);

describe('личные права участника на страницы', () => {
  it('сохраняются за пользователем: перезаход, выгрузка комнаты и REST; другого гостя не задевают', async () => {
    const { app, owner } = await setup();
    const anna = await anon(app);
    const boris = await anon(app);
    const host = joinRoom(app, { session: owner.token, name: 'Автор' });
    await until(() => host.last('init'));
    const a = joinRoom(app, { invite: 'link-x', session: anna.token, name: 'Аня' });
    const b = joinRoom(app, { invite: 'link-x', session: boris.token, name: 'Боря' });
    const aUid = (await until(() => a.last('init'))).userId as number;
    await until(() => b.last('init'));

    host.send({ t: 'set-rights', uid: aUid, pages: { 'a-p2': 'hidden' } });
    await until(() => a.last('project') && pageIds(a.last('project')).length === 1);
    expect(memberPageRights(app.app, 'a', anna.id)).toEqual({ 'a-p2': 'hidden' });
    expect(memberPageRights(app.app, 'a', boris.id)).toEqual({});

    // перезаход при живой комнате
    a.ws.close();
    await a.closed;
    const a2 = joinRoom(app, { invite: 'link-x', session: anna.token, name: 'Аня' });
    expect(pageIds(await until(() => a2.last('init')))).toEqual(['a-p1']);
    expect(pageIds(await until(() => b.last('project') ?? b.last('init')))).toEqual(['a-p1', 'a-p2']);

    // все ушли, комната выгружена — права берутся из базы
    for (const s of [a2, b, host]) { s.ws.close(); await s.closed; }
    await until(() => app.rooms.count() === 0);
    const a3 = joinRoom(app, { invite: 'link-x', session: anna.token, name: 'Аня' });
    const init3 = await until(() => a3.last('init'));
    expect(pageIds(init3)).toEqual(['a-p1']);
    expect(init3.rights.pages['a-p2']).toBe('hidden');

    // REST по той же ссылке: Ане страница скрыта, Боре и гостю без сессии — нет
    const view = (token?: string) => call(app, 'GET', '/api/projects/a?invite=link-x', undefined, token ? { token } : {});
    expect((await view(anna.token)).body.project.pages.map((p: any) => p.id)).toEqual(['a-p1']);
    expect((await view(boris.token)).body.project.pages.map((p: any) => p.id)).toEqual(['a-p1', 'a-p2']);
    expect((await view()).body.project.pages).toHaveLength(2);
    const inv = await call(app, 'GET', '/api/invites/link-x', undefined, { token: anna.token });
    expect(inv.body.project.pages.map((p: any) => p.id)).toEqual(['a-p1']);
    expect(inv.body.pageRights['a-p2']).toBeUndefined();
    // правка скрытой страницы — отказ; Боре — можно
    const patch = { t: 'patch', pageId: 'a-p2', rev: 0, ops: [{ op: 'put', el: rectEl('n1') }] };
    expect((await call(app, 'POST', '/api/projects/a/patch?invite=link-x', patch, { token: anna.token })).status).toBe(403);
    expect((await call(app, 'POST', '/api/projects/a/patch?invite=link-x', patch, { token: boris.token })).status).toBe(200);
    // копия себе — без скрытой страницы
    const clone = await call(app, 'POST', '/api/projects/a/clone?invite=link-x', {}, { token: anna.token });
    expect(clone.status).toBe(201);
    expect(clone.body.project.pages).toHaveLength(1);

    // «По роли» — право снимается и из базы
    const host2 = joinRoom(app, { session: owner.token, name: 'Автор' });
    await until(() => host2.last('init'));
    const aUid3 = init3.userId as number;
    host2.send({ t: 'set-rights', uid: aUid3, pages: { 'a-p2': null } });
    await until(() => a3.last('project') && pageIds(a3.last('project')).length === 2);
    expect(memberPageRights(app.app, 'a', anna.id)).toEqual({});
    expect(app.app.db.prepare('SELECT COUNT(*) AS n FROM member_page_rights').get()).toEqual({ n: 0 });
  });

  it('гость не может задать права через комнату - только автор', async () => {
    const { app, owner } = await setup();
    const anna = await anon(app);
    const boris = await anon(app);
    const host = joinRoom(app, { session: owner.token, name: 'Автор' });
    await until(() => host.last('init'));
    const a = joinRoom(app, { invite: 'link-x', session: anna.token, name: 'Аня' });
    const b = joinRoom(app, { invite: 'link-x', session: boris.token, name: 'Боря' });
    const aUid = (await until(() => a.last('init'))).userId as number;
    const bUid = (await until(() => b.last('init'))).userId as number;
    b.send({ t: 'set-rights', uid: aUid, pages: { 'a-p2': 'hidden' } });
    a.send({ t: 'set-rights', uid: bUid, pages: { 'a-p1': 'hidden' } });
    host.send({ t: 'set-rights', uid: bUid, pages: { 'a-p1': 'view' } });
    await until(() => memberPageRights(app.app, 'a', boris.id)['a-p1'] === 'view');
    expect(memberPageRights(app.app, 'a', anna.id)).toEqual({});
  });
});
