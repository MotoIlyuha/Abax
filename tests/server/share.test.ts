import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { createShareServer, MAX_EDITORS } = require('../../electron/share.cjs');

type Msg = Record<string, any>;
interface Peer { ws: WebSocket; inbox: Msg[]; closed: Promise<void> }

const demo = () => ({
  id: 'demo', name: 'Демо', createdAt: 1, updatedAt: 2,
  pages: [
    { id: 'pg1', name: 'Первая', grid: 'square', elements: [] as unknown[] },
    { id: 'pg2', name: 'Вторая', grid: 'square', elements: [] as unknown[] },
  ],
});
const rect = (id: string) => ({ id, type: 'shape', shape: 'rect', x: 0, y: 0, w: 1, h: 1, color: '#000', width: 1 });

async function until<T>(fn: () => T | undefined | null | false, ms = 3000): Promise<T> {
  const t0 = Date.now();
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error('условие не выполнилось за отведённое время');
    await new Promise(r => setTimeout(r, 10));
  }
}
const tick = (ms = 80) => new Promise(r => setTimeout(r, ms));

let distDir: string;
let server: any;
const peers: Peer[] = [];

/** Подключение с кодом комнаты; host=1 — ещё и с ключом автора (отказы проверяет share-auth.test.ts). */
function connect(query = ''): Promise<Peer> {
  const q = new URLSearchParams(query);
  q.set('code', server.code);
  if (q.get('host') === '1') q.set('key', server.hostKey);
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}/ws?${q}`);
    const inbox: Msg[] = [];
    let onClose!: () => void;
    const closed = new Promise<void>(r => { onClose = r; });
    ws.onmessage = ev => inbox.push(JSON.parse(String(ev.data)));
    ws.onclose = () => onClose();
    ws.onerror = reject;
    ws.onopen = () => { const p = { ws, inbox, closed }; peers.push(p); resolve(p); };
  });
}
const init = (p: Peer) => until(() => p.inbox.find(m => m.t === 'init'));
const last = (p: Peer, t: string) => [...p.inbox].reverse().find(m => m.t === t);
const send = (p: Peer, m: unknown) => p.ws.send(JSON.stringify(m));

async function start(opts: Record<string, unknown> = {}): Promise<void> {
  server = await createShareServer({ port: 0, code: 'ROOM42', ...opts });
  server.setDistDir(distDir);
}
async function hostWithProject(): Promise<Peer> {
  const host = await connect('?host=1&name=' + encodeURIComponent('Учитель'));
  await init(host);
  send(host, { t: 'project', project: demo() });
  await until(() => server.room.project);
  return host;
}

beforeAll(() => {
  distDir = fs.mkdtempSync(path.join(os.tmpdir(), 'doska-dist-'));
  fs.writeFileSync(path.join(distDir, 'index.html'), '<!doctype html><title>Доска</title>');
  fs.mkdirSync(path.join(distDir, 'assets'));
  fs.writeFileSync(path.join(distDir, 'assets', 'app.js'), 'console.log(1)');
  fs.writeFileSync(path.join(distDir, 'assets', 'style.css'), 'body{}');
});

afterEach(async () => {
  for (const p of peers.splice(0)) p.ws.close();
  server?.close();
  server = null;
});

describe('HTTP: раздача клиента', () => {
  it('отдаёт index.html на / и файлы с правильным типом', async () => {
    await start();
    const base = `http://127.0.0.1:${server.port}`;
    const root = await fetch(`${base}/?room=ROOM42`);
    expect(root.status).toBe(200);
    expect(root.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(await root.text()).toContain('Доска');
    const js = await fetch(`${base}/assets/app.js`);
    expect(js.headers.get('content-type')).toBe('text/javascript');
    const css = await fetch(`${base}/assets/style.css`);
    expect(css.headers.get('content-type')).toBe('text/css');
  });

  it('404 для отсутствующих файлов, каталогов и выхода за пределы dist', async () => {
    await start();
    const base = `http://127.0.0.1:${server.port}`;
    expect((await fetch(`${base}/nope.js`)).status).toBe(404);
    expect((await fetch(`${base}/assets`)).status).toBe(404);
    expect((await fetch(`${base}/..%2f..%2fetc/passwd`)).status).toBe(404);
    expect((await fetch(`${base}/../../etc/passwd`)).status).toBe(404);
  });

  it('порт занят — ошибка при запуске', async () => {
    await start();
    await expect(createShareServer({ port: server.port, code: 'X' })).rejects.toMatchObject({ code: 'EADDRINUSE' });
  });
});

describe('WebSocket: подключение', () => {
  it('сокет не на /ws закрывается', async () => {
    await start();
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}/other`);
    await new Promise<void>(r => { ws.onclose = () => r(); });
    expect(server.room.clients.size).toBe(0);
  });

  it('автор — uid 0, красный, edit; гость — следующий uid, view', async () => {
    await start();
    const host = await connect('?host=1');
    const h = await init(host);
    expect(h).toMatchObject({ userId: 0, color: '#e03131', name: 'Автор', project: null });
    const guest = await connect();
    const g = await init(guest);
    expect(g.userId).toBe(1);
    expect(g.name).toBe('Гость 1');
    expect(g.rights.default).toBe('view');
    expect(g.users.map((u: Msg) => u.userId)).toEqual([0, 1]);
  });

  it('имя из параметра декодируется (клиент кодирует его дважды)', async () => {
    await start();
    const p = await connect('?name=' + encodeURIComponent(encodeURIComponent('Маша К.')));
    expect((await init(p)).name).toBe('Маша К.');
  });

  it('openEdit: гости сразу редакторы', async () => {
    await start({ openEdit: true });
    const g = await connect();
    expect((await init(g)).rights.default).toBe('edit');
  });

  it('новый участник и уход участника рассылаются остальным', async () => {
    await start();
    const host = await connect('?host=1');
    await init(host);
    const guest = await connect('?name=Петя');
    await init(guest);
    await until(() => last(host, 'users')?.users.some((u: Msg) => u.name === 'Петя'));
    guest.ws.close();
    await until(() => last(host, 'users')?.users.length === 1);
  });

  it('гость получает только видимые ему страницы', async () => {
    await start();
    await hostWithProject();
    const guest = await connect();
    const g = await init(guest);
    server.setRights(g.userId, { pages: { pg2: 'hidden' } });
    const guest2 = await connect();
    expect((await init(guest2)).project.pages).toHaveLength(2);
    const guest3 = await connect();
    const g3 = await init(guest3);
    server.setRights(g3.userId, { all: 'hidden' });
    expect(server.room.visiblePages(g3.userId)).toEqual([]);
    expect(server.room.visiblePages(g.userId).map((p: Msg) => p.id)).toEqual(['pg1']);
  });
});

describe('presence', () => {
  it('курсор и выделение транслируются всем', async () => {
    await start();
    const host = await hostWithProject();
    const guest = await connect('?name=Гость');
    const g = await init(guest);
    send(guest, { t: 'cursor', x: 1, y: 2, pageId: 'pg2' });
    await until(() => last(host, 'users')?.users.find((u: Msg) => u.userId === g.userId)?.cursor?.x === 1);
    send(guest, { t: 'selection', ids: ['a'], pageId: 'pg1' });
    const u = await until(() => last(host, 'users')?.users.find((x: Msg) => x.userId === g.userId && x.selection.length));
    expect(u).toMatchObject({ selection: ['a'], pageId: 'pg1', cursor: { x: 1, y: 2 }, away: false });
    send(guest, { t: 'selection' }); // без ids — пустое выделение, страница прежняя
    await until(() => last(host, 'users')?.users.find((x: Msg) => x.userId === g.userId)?.selection.length === 0);
  });

  it('бездействующий участник — away', async () => {
    await start();
    await hostWithProject();
    const guest = await connect();
    const g = await init(guest);
    const info = [...server.room.clients.values()].find((c: Msg) => c.uid === g.userId) as Msg;
    info.last = 0;
    expect(server.users().find((u: Msg) => u.userId === g.userId).away).toBe(true);
    send(guest, { t: 'cursor', x: 0, y: 0 }); // любое сообщение возвращает из «Отошёл»
    await until(() => !server.users().find((u: Msg) => u.userId === g.userId).away);
  });

  it('мусор вместо JSON игнорируется', async () => {
    await start();
    const host = await hostWithProject();
    host.ws.send('{не json');
    send(host, { t: 'unknown' });
    send(host, { t: 'project', project: { pages: 'не массив' } });
    await tick();
    expect(server.room.project.id).toBe('demo');
  });
});

describe('права и синхронизация проекта', () => {
  it('первый присланный проект принимается как есть и рассылается', async () => {
    await start();
    const guest = await connect();
    await init(guest);
    await hostWithProject();
    const msg = await until(() => last(guest, 'project'));
    expect(msg).toMatchObject({ by: 0, project: { id: 'demo' } });
  });

  it('гость без права edit не может менять страницы', async () => {
    await start();
    const host = await hostWithProject();
    const guest = await connect();
    await init(guest);
    const hacked = demo();
    hacked.pages[0].elements = [rect('x')];
    hacked.pages.push({ id: 'pg3', name: 'Чужая', grid: 'square', elements: [] });
    send(guest, { t: 'project', project: hacked });
    await until(() => last(host, 'project'));
    expect(server.room.project.pages[0].elements).toEqual([]);
    expect(server.room.project.pages).toHaveLength(2); // без единого edit страницы не добавить
  });

  it('edit на странице разрешает правку только её', async () => {
    await start();
    const host = await hostWithProject();
    const guest = await connect();
    const g = await init(guest);
    expect(server.setRights(g.userId, { pages: { pg1: 'edit' } })).toEqual({ ok: true });
    const rights = await until(() => last(guest, 'rights'));
    expect(rights.rights.pages).toEqual({ pg1: 'edit', pg2: 'view' });
    const changed = demo();
    changed.pages[0].elements = [rect('a')];
    changed.pages[1].elements = [rect('b')];
    changed.pages.push({ id: 'pg3', name: 'Новая', grid: 'square', elements: [] });
    send(guest, { t: 'project', project: changed });
    const got = await until(() => last(host, 'project'));
    expect(got.by).toBe(g.userId);
    expect(server.room.project.pages[0].elements).toHaveLength(1);
    expect(server.room.project.pages[1].elements).toHaveLength(0);
    expect(server.room.project.pages.map((p: Msg) => p.id)).toEqual(['pg1', 'pg2', 'pg3']);
  });

  it('скрытые страницы не уходят гостю при рассылке', async () => {
    await start();
    const host = await hostWithProject();
    const guest = await connect();
    const g = await init(guest);
    server.setRights(g.userId, { pages: { pg2: 'hidden' } });
    const p = demo();
    p.pages[1].elements = [rect('secret')];
    send(host, { t: 'project', project: p });
    const msg = await until(() => last(guest, 'project'));
    expect(msg.project.pages.map((x: Msg) => x.id)).toEqual(['pg1']);
    expect(JSON.stringify(msg)).not.toContain('secret');
  });

  it('скрытие страницы сразу убирает её у гостя, открытие — возвращает', async () => {
    await start();
    await hostWithProject();
    const guest = await connect();
    const g = await init(guest);
    server.setRights(g.userId, { pages: { pg2: 'hidden' } });
    await until(() => last(guest, 'project')?.project.pages.length === 1);
    server.setRights(g.userId, { pages: { pg2: 'view' } });
    await until(() => last(guest, 'project')?.project.pages.length === 2);
  });

  it('автор всегда редактор — права автору не меняются', async () => {
    await start();
    await hostWithProject();
    expect(server.setRights(0, { all: 'view' })).toEqual({ ok: false, error: 'Автор всегда редактор' });
    expect(server.room.userPageRight(0, 'pg1')).toBe('edit');
  });

  it('патчи прав: default, all, pages', async () => {
    await start();
    await hostWithProject();
    const guest = await connect();
    const g = await init(guest);
    server.setRights(g.userId, { default: 'edit' });
    expect(server.room.userPageRight(g.userId, 'pg1')).toBe('edit');
    server.setRights(g.userId, { pages: { pg1: 'view' } });
    expect(server.room.userPageRight(g.userId, 'pg1')).toBe('view');
    expect(server.room.userPageRight(g.userId, 'pg2')).toBe('edit');
    server.setRights(g.userId, { all: 'view' });
    expect(server.room.userPageRight(g.userId, 'pg1')).toBe('view');
    expect(server.room.userCanEditAnything(g.userId)).toBe(false);
    expect(server.room.userPageRight(999, 'pg1')).toBe('view');
    expect(server.room.userCanEditAnything(999)).toBe(false);
  });

  it(`не больше ${MAX_EDITORS} редакторов одновременно (автор считается)`, async () => {
    await start();
    await hostWithProject();
    const results = [];
    for (let i = 0; i < MAX_EDITORS + 1; i++) {
      const g = await connect();
      const gi = await init(g);
      results.push(server.setRights(gi.userId, { all: 'edit' }));
    }
    expect(results.filter(r => r.ok)).toHaveLength(MAX_EDITORS - 1);
    expect(results.at(-1)).toEqual({ ok: false, error: `Максимум ${MAX_EDITORS} одновременных редакторов` });
    expect(server.room.editorsCount()).toBe(MAX_EDITORS);
    // уже редактор может менять свои права без проверки лимита
    const editor = results.findIndex(r => r.ok) + 1;
    expect(server.setRights(editor, { pages: { pg1: 'view' } }).ok).toBe(true);
  });

  it('pushProject рассылает проект всем от имени сервера', async () => {
    await start();
    const host = await hostWithProject();
    const guest = await connect();
    await init(guest);
    server.pushProject({ ...demo(), name: 'Сервер' });
    expect((await until(() => last(guest, 'project'))).by).toBe(-1);
    expect((await until(() => last(host, 'project'))).project.name).toBe('Сервер');
  });

  it('setRights неизвестному участнику не падает', async () => {
    await start();
    await hostWithProject();
    expect(server.setRights(42, { all: 'edit' }).ok).toBe(true);
  });

  it('close отключает всех', async () => {
    await start();
    const host = await connect('?host=1');
    await init(host);
    const guest = await connect();
    await init(guest);
    server.close();
    await Promise.all([host.closed, guest.closed]);
    server = null;
  });
});
