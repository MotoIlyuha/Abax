// Клиент совместной работы против настоящего сервера (electron/share.cjs).
// Второй участник — «голый» WebSocket из теста: так видно, что именно уходит в сеть.
import { createRequire } from 'node:module';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Project } from '../../src/types';

const require = createRequire(import.meta.url);
const { createShareServer } = require('../../electron/share.cjs');

type Collab = typeof import('../../src/collab');
type State = typeof import('../../src/state');
type Storage = typeof import('../../src/storage');
type Msg = Record<string, any>;

interface Peer { ws: WebSocket; inbox: Msg[] }
interface ShareServer {
  port: number;
  code: string;
  hostKey: string;
  room: { project: Project | null; clients: Map<unknown, { uid: number; selection: string[]; cursor: unknown; pageId: string | null }> };
  setRights(uid: number, patch: unknown): { ok: boolean; error?: string };
  attach(sock: unknown, opts: { isHost?: boolean; name?: string }): number | null;
  refresh(sock: unknown): boolean;
  close(): void;
}

const demo = (): Project => ({
  id: 'proj', name: 'Демо', createdAt: 1, updatedAt: 2,
  pages: [
    { id: 'pg1', name: 'Первая', grid: 'square', elements: [] },
    { id: 'pg2', name: 'Вторая', grid: 'dots', elements: [] },
  ],
});
const rect = (id: string) => ({ id, type: 'shape', shape: 'rect', x: 0, y: 0, w: 10, h: 10, color: '#000000', width: 2 });

async function until<T>(fn: () => T | undefined | null | false, ms = 3000): Promise<T> {
  const t0 = Date.now();
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error('условие не выполнилось за отведённое время');
    await new Promise(r => setTimeout(r, 15));
  }
}

function peer(url: string): Promise<Peer> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const inbox: Msg[] = [];
    ws.onmessage = ev => inbox.push(JSON.parse(String(ev.data)));
    ws.onopen = () => resolve({ ws, inbox });
    ws.onerror = reject;
  });
}
const last = (p: Peer, t: string) => [...p.inbox].reverse().find(m => m.t === t);

let server: ShareServer;
let base: string;
let collab: Collab;
let st: State;
let storageMod: Storage;
const peers: Peer[] = [];

async function freshModules(): Promise<void> {
  vi.resetModules();
  storageMod = await import('../../src/storage');
  st = await import('../../src/state');
  collab = await import('../../src/collab');
}

beforeAll(async () => {
  server = await createShareServer({ port: 0, code: 'TEST01' });
  base = `ws://127.0.0.1:${server.port}/ws?code=${server.code}`;
});
afterAll(() => server.close());

beforeEach(async () => {
  document.body.innerHTML = '<div id="canvas-wrap"></div>';
  localStorage.clear();
  server.room.project = demo();
  await freshModules();
});
afterEach(async () => {
  collab.stopCollab();
  for (const p of peers.splice(0)) p.ws.close();
  await until(() => server.room.clients.size === 0);
});

describe('гость', () => {
  it('до подключения: не активен, права — только просмотр', () => {
    expect(collab.collabActive()).toBe(false);
    expect(collab.readOnly()).toBe(false);
    expect(collab.isHost()).toBe(false);
    expect(collab.myColor()).toBe('#e03131');
    expect(collab.myName()).toBe('');
    expect(collab.foreignSelections()).toEqual([]);
  });

  it('получает проект при подключении и права view', async () => {
    await collab.startCollab(base, false, 'Ученик');
    expect(collab.collabActive()).toBe(true);
    await until(() => st.state.project.id === 'proj');
    expect(st.state.project.pages.map(p => p.name)).toEqual(['Первая', 'Вторая']);
    await until(() => collab.myName() === 'Ученик');
    expect(collab.myColor()).toMatch(/^#[0-9a-f]{6}$/);
    expect(collab.pageRight('pg1')).toBe('view');
    expect(collab.readOnly()).toBe(true);
  });

  it('права edit/hidden приходят от сервера', async () => {
    await collab.startCollab(base, false, 'Ученик');
    await until(() => st.state.project.id === 'proj');
    const uid = [...server.room.clients.values()][0].uid;
    server.setRights(uid, { pages: { pg1: 'edit', pg2: 'hidden' } });
    await until(() => collab.pageRight('pg1') === 'edit');
    expect(collab.readOnly('pg1')).toBe(false);
    expect(collab.pageRight('pg2')).toBe('hidden');
    expect(collab.readOnly('pg2')).toBe(true);
  });

  it('применяет чужие правки, сохраняя страницу и камеру', async () => {
    await collab.startCollab(base, false, 'Ученик');
    await until(() => st.state.project.id === 'proj');
    st.switchPage('pg2');
    st.state.camera = { x: 5, y: 6, zoom: 2 };
    const events: Event[] = [];
    document.addEventListener('doska:collab-project', e => events.push(e));
    const host = await peer(`${base}&host=1&key=${encodeURIComponent(server.hostKey)}`);
    peers.push(host);
    const p = demo();
    p.pages[1].elements = [rect('r1') as never];
    host.ws.send(JSON.stringify({ t: 'project', project: p }));
    await until(() => st.state.board.elements.length === 1);
    expect(st.state.pageId).toBe('pg2');
    expect(st.state.camera).toEqual({ x: 5, y: 6, zoom: 2 });
    expect(events.length).toBeGreaterThan(0);
  });

  it('курсор отправляется с троттлингом и рисуется у других', async () => {
    await collab.startCollab(base, false, 'Ученик');
    await until(() => st.state.project.id === 'proj');
    const other = await peer(`${base}&name=${encodeURIComponent('Второй')}`);
    peers.push(other);
    collab.noteCursor(10, 20);
    collab.noteCursor(11, 21); // в пределах 40мс — отложен
    collab.noteCursor(12, 22);
    await until(() => last(other, 'users')?.users.some((u: Msg) => u.name === 'Ученик' && u.cursor?.x === 12));
    const me = last(other, 'users')!.users.find((u: Msg) => u.name === 'Ученик');
    expect(me).toMatchObject({ cursor: { x: 12, y: 22 }, pageId: 'pg1' });

    // курсор второго участника — DOM-метка поверх холста
    other.ws.send(JSON.stringify({ t: 'cursor', x: 100, y: 50, pageId: 'pg1' }));
    const label = await until(() => document.querySelector('#remote-cursors .remote-cursor'));
    expect(label.textContent).toContain('Второй');
    expect((label as HTMLElement).style.left).toBe('100px');
    // курсор на другой странице не показывается
    other.ws.send(JSON.stringify({ t: 'cursor', x: 1, y: 1, pageId: 'pg2' }));
    await until(() => !document.querySelector('#remote-cursors .remote-cursor'));
  });

  it('имя участника с разметкой показывается как текст, а не HTML', async () => {
    await collab.startCollab(base, false, 'Ученик');
    await until(() => st.state.project.id === 'proj');
    const evil = '<img src=x onerror="window.__pwned=1">';
    const other = await peer(`${base}&name=${encodeURIComponent(encodeURIComponent(evil))}`);
    peers.push(other);
    other.ws.send(JSON.stringify({ t: 'cursor', x: 10, y: 10, pageId: 'pg1' }));
    const label = await until(() => document.querySelector<HTMLElement>('#remote-cursors .remote-cursor'));
    expect(label.textContent).toBe(evil);
    expect(label.querySelector('img')).toBeNull();
    expect(document.querySelector('#remote-cursors img, #remote-cursors [onerror]')).toBeNull();
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
    // цвет — свойство style, а не подстановка в разметку
    const span = label.querySelector('span')!;
    expect(span.style.background).not.toBe('');
    expect(label.querySelector('i')!.style.borderColor).not.toBe('');
  });

  it('метка «Отошёл» у бездействующего участника', async () => {
    await collab.startCollab(base, false, 'Ученик');
    await until(() => st.state.project.id === 'proj');
    const other = await peer(`${base}&name=Соня`);
    peers.push(other);
    other.ws.send(JSON.stringify({ t: 'cursor', x: 1, y: 1, pageId: 'pg1' }));
    await until(() => document.querySelector('.remote-cursor'));
    const info = [...server.room.clients.values()].find(c => c.uid !== 0 && c.cursor && (c as { name?: string }).name === 'Соня')!;
    (info as unknown as { last: number }).last = 0;
    collab.noteCursor(3, 3); // любое сообщение заставит сервер разослать состояние
    const label = await until(() => document.querySelector('.remote-cursor.away'));
    expect(label.textContent).toContain('Отошёл');
  });

  it('выделения других участников на активной странице', async () => {
    await collab.startCollab(base, false, 'Ученик');
    await until(() => st.state.project.id === 'proj');
    const other = await peer(`${base}&name=Соня`);
    peers.push(other);
    other.ws.send(JSON.stringify({ t: 'selection', ids: ['a', 'b'], pageId: 'pg1' }));
    await until(() => collab.foreignSelections().length === 1);
    expect(collab.foreignSelections()[0].ids).toEqual(['a', 'b']);
    other.ws.send(JSON.stringify({ t: 'selection', ids: ['a'], pageId: 'pg2' }));
    await until(() => collab.foreignSelections().length === 0);
  });

  it('noteSelection сообщает серверу своё выделение', async () => {
    await collab.startCollab(base, false, 'Ученик');
    await until(() => st.state.project.id === 'proj');
    collab.noteSelection(['x1']);
    await until(() => [...server.room.clients.values()].some(c => c.selection.includes('x1')));
  });

  it('netStorage: save рассылает проект с дебаунсом', async () => {
    await collab.startCollab(base, false, 'Ученик');
    await until(() => st.state.project.id === 'proj');
    const uid = [...server.room.clients.values()][0].uid;
    server.setRights(uid, { all: 'edit' });
    await until(() => collab.pageRight('pg1') === 'edit');
    const host = await peer(`${base}&host=1&key=${encodeURIComponent(server.hostKey)}`);
    peers.push(host);
    const p = demo();
    p.pages[0].elements = [rect('mine') as never];
    expect(await collab.netStorage.list()).toEqual([]);
    expect(await collab.netStorage.load('proj')).toBeNull();
    await collab.netStorage.save(p);
    await collab.netStorage.remove();
    expect(await collab.netStorage.list()).toEqual([expect.objectContaining({ id: 'proj', pageCount: 2 })]);
    expect((await collab.netStorage.load('proj'))?.id).toBe('proj');
    expect(await collab.netStorage.load('other')).toBeNull();
    collab.setNetProject(demo());
    const msg = await until(() => last(host, 'project'));
    expect(msg.project.pages[0].elements[0].id).toBe('mine');
    expect(server.room.project!.pages[0].elements).toHaveLength(1);
  });

  it('после отключения сервер больше не нужен: отправки молча игнорируются', async () => {
    await collab.startCollab(base, false, 'Ученик');
    collab.stopCollab();
    expect(collab.collabActive()).toBe(false);
    expect(() => { collab.noteCursor(1, 1); collab.noteSelection([]); collab.sendProject(demo()); }).not.toThrow();
    expect(document.getElementById('remote-cursors')!.children).toHaveLength(0);
  });

  it('битые сообщения игнорируются', async () => {
    const raw = await peer(`${base}&host=1&key=${encodeURIComponent(server.hostKey)}`);
    peers.push(raw);
    await collab.startCollab(base, false, 'Ученик');
    await until(() => st.state.project.id === 'proj');
    // сервер пересылает только валидные проекты; проверяем, что клиент жив после мусора от сервера
    raw.ws.send('не json');
    raw.ws.send(JSON.stringify({ t: 'project', project: { pages: 'нет' } }));
    collab.noteSelection(['ok']);
    await until(() => [...server.room.clients.values()].some(c => c.selection.includes('ok')));
  });
});

describe('автор', () => {
  it('startHostConnection: права edit везде и рассылка проекта', async () => {
    const guest = await peer(`${base}&name=Гость`);
    peers.push(guest);
    st.openProject(demo());
    await collab.startHostConnection(server.port, server.code, server.hostKey, 'Автор');
    expect(collab.isHost()).toBe(true);
    expect(collab.readOnly()).toBe(false);
    expect(collab.pageRight('любая')).toBe('edit');
    await until(() => last(guest, 'project')?.by === 0);
  });

  it('сохранение автора пишет в локальное хранилище и уходит гостям', async () => {
    const guest = await peer(`${base}&name=Гость`);
    peers.push(guest);
    const local = { list: vi.fn(async () => []), load: vi.fn(async () => null), save: vi.fn(async () => undefined), remove: vi.fn(async () => undefined) };
    storageMod.setStorage(local);
    st.openProject(demo());
    await collab.startHostConnection(server.port, server.code, server.hostKey, 'Автор');
    guest.inbox.length = 0;

    const p = demo();
    p.pages[0].elements = [rect('host-rect') as never];
    await storageMod.storage.save(p);
    expect(local.save).toHaveBeenCalledWith(p);
    const msg = await until(() => guest.inbox.find(m => m.t === 'project' && m.project.pages[0].elements.length === 1));
    expect(msg.project.pages[0].elements[0].id).toBe('host-rect');

    // после выключения хранилище снова чисто локальное
    collab.stopCollab();
    expect(storageMod.storage).toBe(local);
  });
});

/** Транспорт-заглушка: тест сам открывает канал, присылает сообщения и закрывает его. */
function fakeTransport() {
  const t = {
    sent: [] as Msg[],
    closedByClient: false,
    send(data: string) { t.sent.push(JSON.parse(data)); return true; },
    close() { t.closedByClient = true; },
    onopen: null as (() => void) | null,
    onmessage: null as ((data: string) => void) | null,
    onclose: null as ((code: number, reason: string) => void) | null,
    deliver(m: unknown) { t.onmessage?.(JSON.stringify(m)); },
  };
  return t;
}
const initMsg = (over: Msg = {}) => ({ t: 'init', proto: 1, userId: 7, color: '#1971c2', name: 'Ученик', project: demo(), rights: { default: 'view', pages: {} }, users: [], ...over });

describe('транспорт и версия протокола', () => {
  it('connectCollab работает через любой транспорт', async () => {
    const t = fakeTransport();
    const ready = collab.connectCollab(t, false);
    t.onopen!();
    await ready;
    expect(collab.collabActive()).toBe(true);
    t.deliver(initMsg());
    expect(st.state.project.id).toBe('proj');
    collab.noteSelection(['a']);
    expect(t.sent).toContainEqual({ t: 'selection', ids: ['a'], pageId: st.state.pageId });
  });

  it('startCollab сообщает серверу версию протокола', async () => {
    await collab.startCollab(base, false, 'Ученик');
    await until(() => server.room.clients.size === 1);
    // сервер пустил клиента (не 4426) и прислал ту же версию
    expect(collab.collabActive()).toBe(true);
    expect(collab.PROTO).toBe(require('../../electron/share.cjs').PROTO);
  });

  it('сервер другой версии: соединение закрывается, гость получает событие 4426', async () => {
    const events: Msg[] = [];
    document.addEventListener('doska:collab-closed', e => events.push((e as CustomEvent).detail));
    const t = fakeTransport();
    const ready = collab.connectCollab(t, false);
    t.onopen!();
    await ready;
    t.deliver(initMsg({ proto: 2, project: { ...demo(), id: 'чужой' } }));
    expect(t.closedByClient).toBe(true);
    expect(collab.collabActive()).toBe(false);
    expect(st.state.project.id).not.toBe('чужой'); // проект от несовместимого сервера не применён
    expect(events).toEqual([{ code: 4426, reason: 'protocol mismatch' }]);
  });

  it('отказ сервера приходит событием с кодом', async () => {
    const events: Msg[] = [];
    document.addEventListener('doska:collab-closed', e => events.push((e as CustomEvent).detail));
    await collab.startCollab(`ws://127.0.0.1:${server.port}/ws?code=WRONG`, false, 'Ученик');
    await until(() => events.length > 0);
    expect(events[0].code).toBe(4403);
    expect(collab.collabActive()).toBe(false);
  });

  it('stopCollab закрывает канал без события об обрыве', async () => {
    const events: Msg[] = [];
    document.addEventListener('doska:collab-closed', e => events.push((e as CustomEvent).detail));
    const t = fakeTransport();
    const ready = collab.connectCollab(t, false);
    t.onopen!();
    await ready;
    collab.stopCollab();
    t.onclose!(1000, ''); // запоздалый close от закрытого нами канала
    expect(t.closedByClient).toBe(true);
    expect(events).toEqual([]);
  });

  it('события прежнего канала после переподключения игнорируются', async () => {
    const old = fakeTransport();
    void collab.connectCollab(old, false);
    const t = fakeTransport();
    const ready = collab.connectCollab(t, false);
    t.onopen!();
    await ready;
    old.deliver(initMsg({ project: { ...demo(), id: 'старый' } }));
    old.onclose!(1006, '');
    expect(st.state.project.id).not.toBe('старый');
    expect(collab.collabActive()).toBe(true);
  });

  it('сообщение гостю: своё для известных кодов, общее для прочих; разметка не исполняется', () => {
    expect(collab.closedNotice(4426).title).toBe('Версии доски не совпадают');
    expect(collab.closedNotice(4404).title).toBe('Доска не найдена');
    expect(collab.closedNotice(4410).title).toBe('Совместная работа завершена');
    expect(collab.closedNotice(4430).title).toBe('Нет свободных мест');
    expect(collab.closedNotice(4503).title).toBe('Автор сейчас не в сети');
    expect(collab.closedNotice(4429).title).toBe('Слишком много подключений');
    expect(collab.closedNotice(4408).title).toBe('Соединение слишком медленное');
    expect(collab.closedNotice(4403).title).toBe('Неверная ссылка');
    for (const code of [1006, 1001, 4400, 4000, 4999]) expect(collab.closedNotice(code).title).toBe('Соединение с автором прервано');
    collab.showCollabNotice('<b>заголовок</b>', '<img src=x onerror=alert(1)>');
    collab.showCollabNotice('Второй', 'текст');
    const cards = document.querySelectorAll('#collab-notice');
    expect(cards).toHaveLength(1); // новое сообщение заменяет прежнее
    collab.showCollabNotice('<b>заголовок</b>', '<img src=x onerror=alert(1)>');
    const card = document.getElementById('collab-notice')!;
    expect(card.querySelector('img, b')).toBeNull();
    expect(card.textContent).toContain('<img src=x onerror=alert(1)>');
  });
});

describe('канал, который не открылся', () => {
  it('connectCollab не зависает: промис выполняется, collabActive() === false, событие с кодом', async () => {
    const events: Msg[] = [];
    document.addEventListener('doska:collab-closed', e => events.push((e as CustomEvent).detail));
    const t = fakeTransport();
    const ready = collab.connectCollab(t, false);
    t.onclose!(1006, '');
    await ready;
    expect(collab.collabActive()).toBe(false);
    expect(events.at(-1)).toEqual({ code: 1006, reason: '' });
  });
});

describe('уведомления ретранслятора', () => {
  it('host-away показывает «Автор переподключается…», host-back убирает', () => {
    collab.relayNotice('host-away');
    expect(document.getElementById('collab-notice')!.textContent).toContain('Автор переподключается…');
    collab.relayNotice('host-back');
    expect(document.getElementById('collab-notice')).toBeNull();
  });
});

describe('приглашение через интернет', () => {
  type Transport = typeof import('../../src/collab-transport');
  let tr: Transport;
  beforeEach(async () => { tr = await import('../../src/collab-transport'); });
  const ROOM = 'AbCdEfGhIjKlMnOpQrStUv';

  it('parseCloudInvite: ретранслятор, комната и имя из якоря', () => {
    expect(tr.parseCloudInvite(`#relay=${encodeURIComponent('wss://relay.example.com/')}&r=${ROOM}`))
      .toEqual({ relayUrl: 'wss://relay.example.com', room: ROOM, name: null });
    expect(tr.parseCloudInvite(`#relay=wss%3A%2F%2Fexample.com%2Frelay&r=${ROOM}&name=%D0%9C%D0%B0%D1%88%D0%B0`))
      .toEqual({ relayUrl: 'wss://example.com/relay', room: ROOM, name: 'Маша' });
    expect(tr.parseCloudInvite(`#relay=ws%3A%2F%2F127.0.0.1%3A8080&r=${ROOM}`)!.relayUrl).toBe('ws://127.0.0.1:8080');
  });

  it('parseCloudInvite: испорченные и чужие ссылки отклоняются', () => {
    for (const hash of [
      '', '#', `#r=${ROOM}`, '#relay=wss%3A%2F%2Fa.example',
      `#relay=wss%3A%2F%2Fa.example&r=short`, `#relay=wss%3A%2F%2Fa.example&r=${ROOM}x`,
      `#relay=ws%3A%2F%2Frelay.example.com&r=${ROOM}`, // ws:// не на своей машине
      `#relay=https%3A%2F%2Fa.example&r=${ROOM}`, `#relay=javascript%3Aalert(1)&r=${ROOM}`,
      `#relay=wss%3A%2F%2Fu%3Ap%40a.example&r=${ROOM}`, `#relay=wss%3A%2F%2Fa.example%3Fx%3D1&r=${ROOM}`,
      `#relay=не-адрес&r=${ROOM}`,
    ]) expect(tr.parseCloudInvite(hash), hash).toBeNull();
  });

  it('гость через настоящий ретранслятор: hello, проект, имя; уведомление о переподключении автора', async () => {
    const { createRelay } = require('../../relay/server.cjs');
    const { createCloudLink } = require('../../electron/cloud-link.cjs');
    const WS = require('ws');
    const hostSockets: any[] = [];
    class Tracked extends WS { constructor(...a: any[]) { super(...a); hostSockets.push(this); } }
    const relay = await createRelay({ port: 0, host: '127.0.0.1', statsIntervalMs: 0, log: () => {} });
    const link = createCloudLink({
      relayUrl: `ws://127.0.0.1:${relay.port}`, attach: server.attach, refresh: server.refresh,
      WebSocketImpl: Tracked, backoffMs: [30],
    });
    try {
      await link.start();
      const events: string[] = [];
      await collab.connectCollab(tr.cloudTransport(`ws://127.0.0.1:${relay.port}`, link.status().room, 'Из облака', ev => events.push(ev)), false);
      await until(() => st.state.project.id === 'proj');
      await until(() => collab.myName() === 'Из облака');
      expect(collab.readOnly()).toBe(true);
      // автор пропал — гость получает уведомление ретранслятора, а не сообщение комнаты
      hostSockets.at(-1).terminate();
      await until(() => events.includes('host-away'));
      await until(() => events.includes('host-back'), 4000);
      expect(collab.collabActive()).toBe(true);
    } finally {
      link.stop();
      await relay.close();
    }
  });
});
