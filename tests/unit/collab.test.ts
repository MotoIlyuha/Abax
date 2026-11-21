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
type Center = typeof import('../../src/notify-center');
type Msg = Record<string, any>;

interface Peer { ws: WebSocket; inbox: Msg[] }
interface ShareServer {
  port: number;
  code: string;
  hostKey: string;
  room: {
    project: Project | null; clients: Map<unknown, { uid: number; selection: string[]; cursor: unknown; pageId: string | null }>;
    /** Личные права, запомненные за участниками (возвращаются при перезаходе). */
    rightsBy: Map<string, unknown>;
  };
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

/** Сервер принял caps автора: до этого он получал бы вместо патчей полный проект. */
async function hostCaps(): Promise<void> {
  await until(() => [...server.room.clients.values()].some(c => (c as unknown as { host: boolean; patches: boolean }).host && (c as unknown as { patches: boolean }).patches));
}

let server: ShareServer;
let base: string;
let collab: Collab;
let center: Center;
let st: State;
let storageMod: Storage;
const peers: Peer[] = [];

async function freshModules(): Promise<void> {
  vi.resetModules();
  storageMod = await import('../../src/storage');
  st = await import('../../src/state');
  collab = await import('../../src/collab');
  center = await import('../../src/notify-center');
}

/** Уведомления центра одной строкой (то, что видно в стопке и слышно при чтении с экрана). */
const noticeTexts = (): string[] => center.notices().map(center.noticeText);

beforeAll(async () => {
  server = await createShareServer({ port: 0, code: 'TEST01' });
  base = `ws://127.0.0.1:${server.port}/ws?code=${server.code}`;
});
afterAll(() => server.close());

beforeEach(async () => {
  document.body.innerHTML = '<div id="canvas-wrap"></div>';
  localStorage.clear();
  server.room.project = demo();
  // хаб общий для файла, а гость при подключении возобновляется тем же участником: права прошлого теста
  // вернулись бы к нему (так и задумано для перезахода) — каждый тест начинается с чистого гостя
  server.room.rightsBy.clear();
  await freshModules();
});
afterEach(async () => {
  collab.stopCollab();
  for (const p of peers.splice(0)) p.ws.close();
  await until(() => server.room.clients.size === 0);
});

describe('гость', () => {
  it('до подключения: не активен, права - только просмотр', () => {
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
    const evil = '<img src=x onerror="__pwned=1">'; // не длиннее лимита имени (32)
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
    expect(label.querySelector<HTMLElement>('i.rc-arrow')!.style.color).not.toBe('');
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
    // у хаба ещё нет проекта: первый проект задаёт автор (иначе init вернул бы автору его же проект)
    server.room.project = null;
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
    expect(collab.closedNotice(1006).title).toBe('Соединение с автором прервано');
    expect(collab.closedNotice(1006, true).title).toBe('Не удалось подключиться к серверу');
    expect(collab.closedNotice(4410, true).title).toBe('Совместная работа завершена');
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
    expect(events.at(-1)).toEqual({ code: 1006, reason: '', neverOpened: true });
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
  const KEY = new Uint8Array(32).map((_, i) => i);
  const K = Buffer.from(KEY).toString('base64url');

  it('parseCloudInvite: ретранслятор, комната, ключ и имя из якоря', () => {
    expect(tr.parseCloudInvite(`#relay=${encodeURIComponent('wss://relay.example.com/')}&r=${ROOM}&k=${K}`))
      .toEqual({ relayUrl: 'wss://relay.example.com', room: ROOM, key: KEY, name: null });
    expect(tr.parseCloudInvite(`#relay=wss%3A%2F%2Fexample.com%2Frelay&r=${ROOM}&k=${K}&name=%D0%9C%D0%B0%D1%88%D0%B0`))
      .toMatchObject({ relayUrl: 'wss://example.com/relay', room: ROOM, name: 'Маша' });
    expect(tr.parseCloudInvite(`#relay=ws%3A%2F%2F127.0.0.1%3A8080&r=${ROOM}&k=${K}`)!.relayUrl).toBe('ws://127.0.0.1:8080');
  });

  it('parseCloudInvite: испорченные и чужие ссылки отклоняются', () => {
    for (const hash of [
      '', '#', `#r=${ROOM}&k=${K}`, `#relay=wss%3A%2F%2Fa.example&k=${K}`,
      `#relay=wss%3A%2F%2Fa.example&r=short&k=${K}`, `#relay=wss%3A%2F%2Fa.example&r=${ROOM}x&k=${K}`,
      `#relay=ws%3A%2F%2Frelay.example.com&r=${ROOM}&k=${K}`, // ws:// не на своей машине
      `#relay=https%3A%2F%2Fa.example&r=${ROOM}&k=${K}`, `#relay=javascript%3Aalert(1)&r=${ROOM}&k=${K}`,
      `#relay=wss%3A%2F%2Fu%3Ap%40a.example&r=${ROOM}&k=${K}`, `#relay=wss%3A%2F%2Fa.example%3Fx%3D1&r=${ROOM}&k=${K}`,
      `#relay=не-адрес&r=${ROOM}&k=${K}`,
      // без ключа или с испорченным ключом
      `#relay=wss%3A%2F%2Fa.example&r=${ROOM}`, `#relay=wss%3A%2F%2Fa.example&r=${ROOM}&k=${K.slice(1)}`,
      `#relay=wss%3A%2F%2Fa.example&r=${ROOM}&k=${K}AA`, `#relay=wss%3A%2F%2Fa.example&r=${ROOM}&k=не+ключ`,
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
      const key = new Uint8Array(Buffer.from(link.status().key, 'base64url'));
      await collab.connectCollab(tr.cloudTransport(`ws://127.0.0.1:${relay.port}`, link.status().room, key, 'Из облака', ev => events.push(ev)), false);
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

describe('шифрованный транспорт гостя', () => {
  it('чужой ключ - автор отключает с 4403, гость видит «Неверная ссылка»; правки с верным ключом проходят', async () => {
    const tr = await import('../../src/collab-transport');
    const { createRelay } = require('../../relay/server.cjs');
    const { createCloudLink } = require('../../electron/cloud-link.cjs');
    const relay = await createRelay({ port: 0, host: '127.0.0.1', statsIntervalMs: 0, log: () => {} });
    const link = createCloudLink({ relayUrl: `ws://127.0.0.1:${relay.port}`, attach: server.attach, refresh: server.refresh });
    try {
      await link.start();
      const events: Msg[] = [];
      document.addEventListener('doska:collab-closed', e => events.push((e as CustomEvent).detail));
      const wrong = crypto.getRandomValues(new Uint8Array(32));
      await collab.connectCollab(tr.cloudTransport(`ws://127.0.0.1:${relay.port}`, link.status().room, wrong, 'Чужой'), false);
      await until(() => events.length > 0);
      expect(events[0].code).toBe(4403);
      expect(collab.closedNotice(events[0].code).title).toBe('Неверная ссылка');

      await freshModules();
      const tr2 = await import('../../src/collab-transport');
      const key = new Uint8Array(Buffer.from(link.status().key, 'base64url'));
      await collab.connectCollab(tr2.cloudTransport(`ws://127.0.0.1:${relay.port}`, link.status().room, key, 'Свой'), false);
      await until(() => st.state.project.id === 'proj');
      const uid = [...server.room.clients.values()].find(c => (c as any).name === 'Свой')!.uid;
      server.setRights(uid, { all: 'edit' });
      await until(() => !collab.readOnly('pg1'));
      collab.noteSelection(['через-шифр']);
      await until(() => [...server.room.clients.values()].some(c => c.selection.includes('через-шифр')));
    } finally {
      link.stop();
      await relay.close();
    }
  });
});


describe('дельта-патчи', () => {
  const patchOf = (host: Peer) => last(host, 'patch');

  async function editor() {
    await collab.startCollab(base, false, 'Ученик');
    await until(() => st.state.project.id === 'proj');
    const uid = [...server.room.clients.values()][0].uid;
    server.setRights(uid, { all: 'edit' });
    await until(() => collab.pageRight('pg1') === 'edit');
    const host = await peer(`${base}&host=1&key=${encodeURIComponent(server.hostKey)}`);
    peers.push(host);
    host.ws.send(JSON.stringify({ t: 'caps', patches: true }));
    await hostCaps();
    return { uid, host };
  }

  it('правка элементов уходит патчем, а не проектом', async () => {
    const { host } = await editor();
    host.inbox.length = 0;
    st.addElement(rect('mine') as never);
    const msg = await until(() => patchOf(host));
    expect(msg).toMatchObject({ pageId: 'pg1' });
    expect(msg.ops).toEqual([{ op: 'put', el: expect.objectContaining({ id: 'mine' }) }]);
    expect(server.room.project!.pages[0].elements.map(e => e.id)).toEqual(['mine']);
    expect(last(host, 'project')).toBeUndefined();
    // удаление — del
    host.inbox.length = 0;
    st.state.selection = new Set(['mine']);
    st.deleteSelected();
    const del = await until(() => patchOf(host));
    expect(del.ops).toEqual([{ op: 'del', id: 'mine' }]);
  });

  it('сетка страницы идёт в патче', async () => {
    const { host } = await editor();
    host.inbox.length = 0;
    st.setGrid('dots');
    const msg = await until(() => patchOf(host));
    expect(msg.grid).toBe('dots');
    expect(msg.ops).toEqual([]);
  });

  it('частые правки склеиваются: патч не чаще раза в 100 мс', async () => {
    const { host } = await editor();
    host.inbox.length = 0;
    for (let i = 0; i < 20; i++) st.addElement(rect(`r${i}`) as never);
    await until(() => host.inbox.filter(m => m.t === 'patch').flatMap(m => m.ops).length >= 20);
    expect(host.inbox.filter(m => m.t === 'patch').length).toBeLessThan(6);
  });

  it('чужой патч применяется без сброса отмены и выделения', async () => {
    const { host } = await editor();
    st.addElement(rect('mine') as never);
    st.setSelection(['mine']);
    await until(() => server.room.project!.pages[0].elements.length === 1);
    const events: Event[] = [];
    document.addEventListener('doska:collab-project', e => events.push(e));
    host.inbox.length = 0;
    host.ws.send(JSON.stringify({ t: 'patch', pageId: 'pg1', rev: 0, ops: [{ op: 'put', el: rect('theirs') }] }));
    await until(() => st.state.board.elements.length === 2);
    expect(st.canUndo()).toBe(true);
    expect([...st.state.selection]).toEqual(['mine']);
    expect(events).toHaveLength(0); // проект целиком не открывался заново
    // удалённое выделенное выпадает из выделения
    host.ws.send(JSON.stringify({ t: 'patch', pageId: 'pg1', rev: 0, ops: [{ op: 'del', id: 'mine' }] }));
    await until(() => st.state.board.elements.length === 1);
    expect([...st.state.selection]).toEqual([]);
    // принятый патч не возвращается обратно как собственная правка
    await new Promise(r => setTimeout(r, 250));
    expect(host.inbox.filter(m => m.t === 'patch')).toHaveLength(0);
  });

  it('патч для другой страницы меняет её, активная остаётся', async () => {
    const { host } = await editor();
    host.ws.send(JSON.stringify({ t: 'patch', pageId: 'pg2', rev: 0, ops: [{ op: 'put', el: rect('far') }], grid: 'none' }));
    await until(() => st.state.project.pages[1].elements.length === 1);
    expect(st.state.project.pages[1].grid).toBe('none');
    expect(st.state.pageId).toBe('pg1');
    expect(st.state.board.elements).toHaveLength(0);
  });

  it('пока идёт жест, чужие патчи ждут его окончания', async () => {
    const { gestureActive: _g, addGestureProbe } = await import('../../src/gesture');
    const { host } = await editor();
    let busy = true;
    const off = addGestureProbe(() => busy);
    host.ws.send(JSON.stringify({ t: 'patch', pageId: 'pg1', rev: 0, ops: [{ op: 'put', el: rect('late') }] }));
    await new Promise(r => setTimeout(r, 250));
    expect(st.state.board.elements).toHaveLength(0);
    busy = false;
    await until(() => st.state.board.elements.length === 1);
    off();
  });

  it('смена состава проекта (имя страницы) уходит полным проектом', async () => {
    const { host } = await editor();
    host.inbox.length = 0;
    st.renamePage('pg1', 'Новое имя');
    collab.sendProject(st.state.project);
    const msg = await until(() => last(host, 'project'));
    expect(msg.project.pages[0].name).toBe('Новое имя');
  });

  it('без поддержки патчей хаб получает прежний полный проект', async () => {
    await collab.startCollab(base, false, 'Ученик');
    await until(() => st.state.project.id === 'proj');
    const uid = [...server.room.clients.values()][0].uid;
    server.setRights(uid, { all: 'edit' });
    await until(() => collab.pageRight('pg1') === 'edit');
    const host = await peer(`${base}&host=1&key=${encodeURIComponent(server.hostKey)}`);
    peers.push(host);
    // у участника-автора нет caps: ему шлётся проект, а клиент гостя по-прежнему отправляет patch (хаб поддерживает)
    st.addElement(rect('x') as never);
    const msg = await until(() => last(host, 'project'));
    expect(msg.project.pages[0].elements[0].id).toBe('x');
  });
});

describe('ввод ученика в задание', () => {
  const task = (extra: Record<string, unknown> = {}) => ({
    id: 'task', type: 'task', x: 0, y: 0, w: 360, h: 220, taskId: 't', examType: 'oge', topic: '', statementMd: 'У', answer: '5', ...extra,
  });
  const withTask = (): Project => ({ ...demo(), pages: [{ id: 'pg1', name: 'П1', grid: 'square', elements: [task() as never] }, demo().pages[1]] });

  it('вне комнаты ввод не отправляется - вызывающий применит его у себя', () => {
    expect(collab.taskInputOnline()).toBe(false);
    expect(collab.sendTaskDraft('pg1', 'task', 'x')).toBe(false);
    expect(collab.sendTaskSubmit('pg1', 'task', 'x')).toBe(false);
  });

  it('гость с правом view: черновик с троттлингом и ответ, результат приходит правкой хаба без ответа', async () => {
    server.room.project = withTask();
    await collab.startCollab(base, false, 'Ученик');
    await until(() => st.state.project.id === 'proj');
    await until(() => collab.taskInputOnline());
    expect(collab.readOnly('pg1')).toBe(true);
    const host = await peer(`${base}&host=1&key=${encodeURIComponent(server.hostKey)}`);
    peers.push(host);
    host.ws.send(JSON.stringify({ t: 'caps', patches: true }));
    await hostCaps();
    host.inbox.length = 0;
    for (const d of ['1', '12', '123']) collab.sendTaskDraft('pg1', 'task', d);
    await until(() => (server.room.project!.pages[0].elements[0] as never as { studentDraft?: string }).studentDraft === '123');
    // сообщение автору может прийти чуть позже, чем хаб обновил своё состояние
    await until(() => host.inbox.filter(m => m.t === 'patch').at(-1)?.ops[0].el.studentDraft === '123');
    const drafts = host.inbox.filter(m => m.t === 'patch');
    expect(drafts.length).toBeLessThanOrEqual(3);
    expect(drafts.at(-1)!.ops[0].el.studentDraft).toBe('123');
    // результат виден у самого ученика
    await until(() => (st.state.board.elements[0] as never as { studentDraft?: string }).studentDraft === '123');

    collab.sendTaskDraft('pg1', 'task', '12345'); // отложенный черновик не должен вернуться после ответа
    collab.sendTaskSubmit('pg1', 'task', '5');
    await until(() => (st.state.board.elements[0] as never as { attempts?: { isCorrect: boolean }[] }).attempts?.[0]?.isCorrect === true);
    await new Promise(r => setTimeout(r, 400));
    const mine = st.state.board.elements[0] as never as { answer: string; studentDraft?: string };
    expect(mine.answer).toBe(''); // ученик не получил ответ
    expect(mine.studentDraft).toBeUndefined();
    expect((server.room.project!.pages[0].elements[0] as never as { answer: string }).answer).toBe('5');
    // а локально ничего не отправлялось как «своя правка»: хаб не вернул её автору лишний раз
    expect(st.canUndo()).toBe(false);
  });
});

describe('реакции и комментарии через хаб', () => {
  const withEls = (): Project => ({ ...demo(), pages: [{ id: 'pg1', name: 'П1', grid: 'square', elements: [rect('a') as never] }, demo().pages[1]] });

  it('вне комнаты ничего не отправляется', () => {
    expect(collab.noteOnline()).toBe(false);
    expect(collab.sendReaction('pg1', 'a', '👍')).toBe(false);
    expect(collab.sendComment('pg1', { op: 'reply', threadId: 't', text: 'х' })).toBe(false);
  });

  it('читатель ставит реакцию и пишет комментарий - оба доходят до него же и до остальных', async () => {
    server.room.project = withEls();
    await collab.startCollab(base, false, 'Ученик');
    await until(() => st.state.project.id === 'proj');
    await until(() => collab.noteOnline());
    expect(collab.readOnly('pg1')).toBe(true);
    const host = await peer(`${base}&host=1&key=${encodeURIComponent(server.hostKey)}`);
    peers.push(host);
    host.ws.send(JSON.stringify({ t: 'caps', patches: true }));
    await hostCaps();
    host.inbox.length = 0;

    expect(collab.sendReaction('pg1', 'a', '👍')).toBe(true);
    await until(() => st.state.board.elements[0].reactions?.['👍']?.length === 1);
    expect(last(host, 'patch')!.ops[0].el.reactions['👍']).toHaveLength(1);
    expect(st.canUndo()).toBe(false); // реакции в историю отмены не попадают

    collab.sendComment('pg1', { op: 'create', x: 5, y: 6, targetElementId: 'a', text: 'Почему?' });
    await until(() => st.state.board.comments?.length === 1);
    expect(st.state.board.comments![0].messages[0]).toMatchObject({ text: 'Почему?', authorName: 'Ученик' });
    expect(last(host, 'comments')!.comments).toHaveLength(1);
    const id = st.state.board.comments![0].id;
    collab.sendComment('pg1', { op: 'resolve', threadId: id, resolved: true });
    await until(() => st.state.board.comments![0].resolved === true);

    // чужие комментарии приходят и в удалённую страницу, не трогая проект целиком
    const events: Event[] = [];
    document.addEventListener('doska:collab-project', e => events.push(e));
    host.ws.send(JSON.stringify({ t: 'comment', op: 'reply', pageId: 'pg1', threadId: id, text: 'Ответ' }));
    await until(() => st.state.board.comments![0].messages.length === 2);
    expect(events).toHaveLength(0);
    expect(server.room.project!.pages[0].comments![0].messages).toHaveLength(2);
  });
});

describe('указка в совместной работе', () => {
  async function pair() {
    await collab.startCollab(base, false, 'Ученик');
    await until(() => st.state.project.id === 'proj');
    await until(() => collab.collabActive());
    const other = await peer(`${base}&host=1&key=${encodeURIComponent(server.hostKey)}`);
    peers.push(other);
    await until(() => last(other, 'init'));
    other.inbox.length = 0;
    return other;
  }

  it('мой лазер, маркер и подсветка уходят остальным пачками; конец росчерка помечен', async () => {
    const other = await pair();
    collab.sendLaser([{ x: 1, y: 1, p: 0.5 }], '#2dc75c', false);
    collab.sendLaser([{ x: 2, y: 2, p: 0.5 }, { x: 3, y: 3, p: 0.5 }], '#2dc75c', false);
    collab.sendLaser([], '#2dc75c', true);
    await until(() => other.inbox.some(m => m.t === 'pointer' && m.end));
    const msgs = other.inbox.filter(m => m.t === 'pointer');
    expect(msgs.flatMap(m => m.pts)).toEqual([{ x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 3 }]);
    expect(msgs.every(m => m.k === 'laser' && m.color === '#2dc75c' && m.pageId === 'pg1')).toBe(true);
    expect(msgs.filter(m => m.end)).toHaveLength(1);

    other.inbox.length = 0;
    collab.sendFadeStroke('s1', { color: '#305bab', width: 12.8 }, [{ x: 5, y: 5, p: 0.5 }], false);
    collab.sendFadeStroke('s1', { color: '#305bab', width: 12.8 }, [], true);
    collab.sendFlash(['a']);
    await until(() => other.inbox.some(m => m.k === 'flash') && other.inbox.some(m => m.k === 'fade' && m.end));
    expect(other.inbox.filter(m => m.k === 'fade').flatMap(m => m.pts)).toEqual([{ x: 5, y: 5, p: 0.5 }]); // на конце ничего не дублируется
    expect(last(other, 'pointer')).toBeDefined();
  });

  it('вне комнаты ничего не уходит', () => {
    expect(() => { collab.sendLaser([{ x: 1, y: 1, p: 0.5 }], '#ff2d2d', true); collab.sendFlash(['a']); }).not.toThrow();
  });

  it('чужой лазер ложится в state.remoteLasers с цветом росчерка и рвётся между росчерками', async () => {
    const other = await pair();
    const send = (m: Msg) => other.ws.send(JSON.stringify({ t: 'pointer', pageId: 'pg1', ...m }));
    send({ k: 'laser', color: '#2dc75c', pts: [{ x: 10, y: 20 }, { x: 11, y: 21 }] });
    await until(() => st.state.remoteLasers.size === 1);
    const [uid, r] = [...st.state.remoteLasers][0];
    expect(typeof uid).toBe('number');
    expect(r.down).toBe(true);
    expect(r.pts.map(p => p.start)).toEqual(['#2dc75c', undefined]);
    send({ k: 'laser', color: '#2dc75c', pts: [{ x: 12, y: 22 }], end: true });
    await until(() => st.state.remoteLasers.get(uid)!.down === false && st.state.remoteLasers.get(uid)!.pts.length === 3);
    send({ k: 'laser', color: '#ff0000', pts: [{ x: 50, y: 50 }] });
    await until(() => st.state.remoteLasers.get(uid)!.pts.length === 4);
    expect(st.state.remoteLasers.get(uid)!.pts.map(p => p.start)).toEqual(['#2dc75c', undefined, undefined, '#ff0000']);
  });

  it('чужой маркер дописывается в один росчерк и гаснет после конца; подсветка - только на этой странице', async () => {
    const other = await pair();
    const send = (m: Msg) => other.ws.send(JSON.stringify({ t: 'pointer', pageId: 'pg1', ...m }));
    send({ k: 'fade', sid: 's', color: '#305bab', width: 12.8, opacity: 0.5, pts: [{ x: 1, y: 1 }] });
    send({ k: 'fade', sid: 's', color: '#305bab', width: 12.8, opacity: 0.5, pts: [{ x: 2, y: 2 }, { x: 3, y: 3 }] });
    await until(() => st.state.fadeStrokes.length === 1 && st.state.fadeStrokes[0].pts.length === 3);
    expect(st.state.fadeStrokes[0]).toMatchObject({ color: '#305bab', width: 12.8, opacity: 0.5, endT: null });
    send({ k: 'fade', sid: 's', color: '#305bab', width: 12.8, pts: [{ x: 4, y: 4 }], end: true });
    await until(() => st.state.fadeStrokes[0].endT !== null);
    expect(st.state.fadeStrokes).toHaveLength(1);

    send({ k: 'flash', ids: ['a'] });
    await until(() => st.state.flashes.length === 1);
    expect(st.state.flashes[0].ids).toEqual(['a']);
    st.state.flashes = [];
    st.switchPage('pg2');
    send({ k: 'flash', ids: ['a'] });
    send({ k: 'laser', color: '#2dc75c', pts: [{ x: 1, y: 1 }] });
    await new Promise(r => setTimeout(r, 150));
    expect(st.state.flashes).toEqual([]);
    expect(st.state.remoteLasers.size).toBe(0); // чужая страница — указка не рисуется
  });

  it('при выходе из комнаты чужие указки пропадают', async () => {
    const other = await pair();
    other.ws.send(JSON.stringify({ t: 'pointer', pageId: 'pg1', k: 'laser', color: '#2dc75c', pts: [{ x: 1, y: 1 }] }));
    await until(() => st.state.remoteLasers.size === 1);
    collab.stopCollab();
    expect(st.state.remoteLasers.size).toBe(0);
  });
});

describe('персональные курсоры (Ночь №4)', () => {
  const setProfileRaw = (p: Record<string, unknown>) => localStorage.setItem('doska.profile', JSON.stringify({ name: '', cursorId: 'default', onboarded: true, updatedAt: 1, ...p }));

  it('свой курсор уходит параметром подключения, чужой виден с бейджем своего цвета', async () => {
    setProfileRaw({ cursorId: 'mint' });
    await collab.startCollab(base, false, 'Ученик');
    await until(() => st.state.project.id === 'proj');
    await until(() => [...server.room.clients.values()].some(c => (c as unknown as { cursorId?: string }).cursorId === 'mint'));
    const other = await peer(`${base}&name=Аня&cursor=coral`);
    peers.push(other);
    other.ws.send(JSON.stringify({ t: 'cursor', x: 10, y: 10, pageId: 'pg1' }));
    const el = await until(() => document.querySelector<HTMLElement>('#remote-cursors .remote-cursor'));
    expect(el.querySelector('svg path')!.getAttribute('fill')).toBe('#ffa8a8');
    const label = el.querySelector('span')!;
    expect(label.textContent).toBe('Аня');
    expect(label.style.background).toBe('rgb(201, 42, 42)'); // badgeBg «Коралла»
    // узел не пересоздаётся при движении
    other.ws.send(JSON.stringify({ t: 'cursor', x: 30, y: 10, pageId: 'pg1' }));
    await until(() => el.style.left === '30px');
    expect(document.querySelector('#remote-cursors .remote-cursor')).toBe(el);
    // рамка выделения — цвет выделения его курсора
    other.ws.send(JSON.stringify({ t: 'selection', ids: ['a'], pageId: 'pg1' }));
    await until(() => collab.foreignSelections().length === 1);
    expect(collab.foreignSelections()[0].color).toBe('#e03131');
  });

  it('без курсора (старая версия) - классическая стрелка и цвет от хаба', async () => {
    await collab.startCollab(base, false, 'Ученик');
    await until(() => st.state.project.id === 'proj');
    const other = await peer(`${base}&name=Старый&cursor=%3Cx%3E`);
    peers.push(other);
    other.ws.send(JSON.stringify({ t: 'cursor', x: 10, y: 10, pageId: 'pg1' }));
    const el = await until(() => document.querySelector<HTMLElement>('#remote-cursors .remote-cursor'));
    expect(el.querySelector('svg path')!.getAttribute('fill')).toBe('#ffffff');
    expect(el.querySelector('span')!.style.background).not.toBe('');
  });

  it('смена профиля на лету доходит до остальных', async () => {
    setProfileRaw({ name: 'Ученик', cursorId: 'default' });
    await collab.startCollab(base, false, 'Ученик');
    await until(() => st.state.project.id === 'proj');
    const other = await peer(`${base}&name=Аня`);
    peers.push(other);
    const profile = await import('../../src/profile');
    profile.setProfile({ name: 'Бодрый Енот', cursorId: 'lavender' });
    await until(() => last(other, 'users')?.users.some((u: Msg) => u.name === 'Бодрый Енот' && u.cursorId === 'lavender'));
  });
});

describe('аватары участников', () => {
  const PHOTO = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==';
  const pillTexts = noticeTexts;

  it('свой аватар уходит сразу после входа и при смене; чужое фото приходит отдельно, смена - пилюля', async () => {
    localStorage.setItem('doska.profile', JSON.stringify({ name: 'Ученик', cursorId: 'default', avatar: '🦊', onboarded: true, updatedAt: 1 }));
    const other = await peer(`${base}&name=Аня`);
    peers.push(other);
    await collab.startCollab(base, false, 'Ученик');
    await until(() => st.state.project.id === 'proj');
    const me = collab.myCollabId();
    // первое сообщение об аватаре — без пилюли у остальных (хаб не считает его сменой)
    await until(() => last(other, 'users')?.users.some((u: Msg) => u.userId === me && u.avatar === '🦊'));
    const profile = await import('../../src/profile');
    profile.setProfile({ avatar: PHOTO });
    await until(() => last(other, 'avatar')?.photo === PHOTO);
    await until(() => last(other, 'users')?.users.some((u: Msg) => u.userId === me && u.avatar === 'photo:1'));
    // чужой аватар: фото, затем смайл — пилюли «сменил аватар» (первое сообщение — без пилюли)
    const otherId = (last(other, 'init') as Msg).userId as number;
    other.ws.send(JSON.stringify({ t: 'profile', avatar: PHOTO }));
    await until(() => collab.collabAvatar(collab.collabUsers().find(u => u.userId === otherId)!) === PHOTO);
    expect(pillTexts()).not.toContain('Аня сменил аватар');
    other.ws.send(JSON.stringify({ t: 'profile', avatar: '🐼' }));
    await until(() => pillTexts().includes('Аня сменил аватар'));
    expect(collab.collabAvatar(collab.collabUsers().find(u => u.userId === otherId)!)).toBe('🐼');
  });
});

describe('уведомления и чат комнаты (Ночь №5)', () => {
  const pillTexts = noticeTexts;

  it('вход и выход участника - пилюли; своё подключение - без пилюли', async () => {
    await collab.startCollab(base, false, 'Ученик');
    await until(() => st.state.project.id === 'proj');
    expect(pillTexts()).toEqual([]);
    const other = await peer(`${base}&name=${encodeURIComponent('Капибара')}`);
    await until(() => pillTexts().includes('Капибара присоединился к доске'));
    other.ws.send(JSON.stringify({ t: 'profile', name: 'Бодрый Енот' }));
    await until(() => pillTexts().includes('Капибара теперь Бодрый Енот'));
    other.ws.close();
    await until(() => pillTexts().includes('Бодрый Енот покинул доску'));
  });

  it('сообщение уходит в комнату и приходит в ленту; история - из init', async () => {
    const other = await peer(`${base}&name=${encodeURIComponent('Лемур')}`);
    peers.push(other);
    other.ws.send(JSON.stringify({ t: 'chat', text: 'до вас' }));
    await until(() => last(other, 'chat'));
    await collab.startCollab(base, false, 'Ученик');
    await until(() => st.state.project.id === 'proj');
    const chat = await import('../../src/collab-chat');
    expect(chat.chatMessages().map(m => m.text)).toEqual(['до вас']);
    expect(document.getElementById('btn-notify')).toBeNull(); // в тестовой разметке кнопки ЧУ нет — модуль не падает
    expect(collab.sendChat('  привет  ')).toBe(true);
    await until(() => [...other.inbox].some(m => m.t === 'chat' && m.text === 'привет' && m.name === 'Ученик'));
    other.ws.send(JSON.stringify({ t: 'chat', text: 'и тебе' }));
    await until(() => chat.chatMessages().some(m => m.text === 'и тебе'));
    expect(chat.chatUnread()).toBe(1);
    expect(pillTexts()).toContain('Лемур: и тебе');
    // уведомление чата — структурное: имя, текст, участник для аватара
    const n = center.notices().find(x => x.kind === 'chat')!;
    expect(n).toMatchObject({ title: 'Лемур', body: 'и тебе', read: false, user: { name: 'Лемур' } });
    expect(center.unreadCount()).toBe(1);
  });

  it('смена моих прав - пилюля', async () => {
    await collab.startCollab(base, false, 'Ученик');
    await until(() => st.state.project.id === 'proj');
    const uid = [...server.room.clients.values()][0].uid;
    server.setRights(uid, { pages: { pg1: 'edit' } });
    await until(() => pillTexts().includes('Автор изменил права доступа'));
  });

  it('«Позвать всех»: пилюля и событие перехода на страницу', async () => {
    await collab.startCollab(base, false, 'Ученик');
    await until(() => st.state.project.id === 'proj');
    const got: unknown[] = [];
    document.addEventListener('doska:collab-summon', e => got.push((e as CustomEvent).detail));
    const host = await peer(`${base}&host=1&key=${encodeURIComponent(server.hostKey)}`);
    peers.push(host);
    host.ws.send(JSON.stringify({ t: 'summon', pageId: 'pg2', vx: 10, vy: 20, vz: 2 }));
    await until(() => got.length === 1);
    expect(got[0]).toMatchObject({ pageId: 'pg2', vx: 10, vy: 20, vz: 2 });
    expect(pillTexts()).toContain('Автор позвал всех на страницу «Вторая»');
  });

  it('«Позвать к себе» одного: пилюля «позвал вас»; автор убрал - соединение закрыто с кодом 4411', async () => {
    await collab.startCollab(base, false, 'Ученик');
    await until(() => st.state.project.id === 'proj');
    const host = await peer(`${base}&host=1&key=${encodeURIComponent(server.hostKey)}`);
    peers.push(host);
    const me = collab.myCollabId();
    host.ws.send(JSON.stringify({ t: 'summon', pageId: 'pg2', vx: 0, vy: 0, vz: 1, to: me }));
    await until(() => pillTexts().includes('Автор позвал вас на страницу «Вторая»'));
    const closed: number[] = [];
    document.addEventListener('doska:collab-closed', e => closed.push((e as CustomEvent).detail.code), { once: true });
    host.ws.send(JSON.stringify({ t: 'remove', uid: me }));
    await until(() => closed.length === 1);
    expect(closed[0]).toBe(4411);
    expect(collab.collabActive()).toBe(false);
    expect(collab.closedNotice(4411).title).toBe('Вас отключили от доски');
  });

  it('скрытый курсор участника не рисуется; «Скрыть курсоры других» - ни один', async () => {
    const vis = await import('../../src/cursor-visibility');
    document.body.insertAdjacentHTML('beforeend', '<div id="canvas-wrap"></div>');
    await collab.startCollab(base, false, 'Ученик');
    await until(() => st.state.project.id === 'proj');
    const other = await peer(`${base}&name=${encodeURIComponent('Лемур')}`);
    peers.push(other);
    other.ws.send(JSON.stringify({ t: 'cursor', x: 5, y: 5, pageId: st.state.pageId }));
    const nodes = () => document.querySelectorAll('#remote-cursors .remote-cursor').length;
    await until(() => nodes() === 1);
    const uid = collab.collabUsers().find(u => u.name === 'Лемур')!.userId;
    vis.setUserCursorHidden(uid, true);
    expect(nodes()).toBe(0);
    vis.setUserCursorHidden(uid, false);
    expect(nodes()).toBe(1);
    vis.setOthersCursorsHidden(true);
    expect(nodes()).toBe(0);
    vis.setOthersCursorsHidden(false);
    expect(nodes()).toBe(1);
    document.getElementById('canvas-wrap')?.remove();
  });

  it('автопереход: состояние из init и сообщений', async () => {
    const host = await peer(`${base}&host=1&key=${encodeURIComponent(server.hostKey)}`);
    peers.push(host);
    host.ws.send(JSON.stringify({ t: 'follow-host', enabled: true }));
    await until(() => last(host, 'follow-host'));
    await collab.startCollab(base, false, 'Ученик');
    await until(() => st.state.project.id === 'proj');
    expect(collab.hostFollowEnabled()).toBe(true);
    host.ws.send(JSON.stringify({ t: 'follow-host', enabled: false }));
    await until(() => !collab.hostFollowEnabled());
  });

  it('конец совместной работы убирает уведомления и выключает чат', async () => {
    const chat = await import('../../src/collab-chat');
    await collab.startCollab(base, false, 'Ученик');
    await until(() => st.state.project.id === 'proj');
    expect(chat.chatAvailable()).toBe(true);
    const other = await peer(`${base}&name=${encodeURIComponent('Корги')}`);
    peers.push(other);
    await until(() => pillTexts().length > 0);
    expect(center.unreadCount()).toBeGreaterThan(0);
    collab.stopCollab();
    expect(pillTexts()).toEqual([]);
    expect(center.unreadCount()).toBe(0);
    expect(chat.chatAvailable()).toBe(false);
    expect(collab.sendChat('x')).toBe(false);
  });

  it('отклики на мои действия - тихие (прочитаны сразу), события от других - нет', async () => {
    await collab.startCollab(base, false, 'Ученик');
    await until(() => st.state.project.id === 'proj');
    const other = await peer(`${base}&name=${encodeURIComponent('Корги')}`);
    peers.push(other);
    await until(() => pillTexts().includes('Корги присоединился к доске'));
    const join = center.notices().find(n => n.icon === 'join')!;
    expect(join).toMatchObject({ title: 'Корги', body: 'присоединился к доске', level: 'ok', read: false, user: { name: 'Корги' } });
    expect(join.quiet).toBeUndefined();
    const presence = await import('../../src/collab-presence');
    presence.goToParticipant({ ...collab.collabUsers().find(u => u.name === 'Корги')!, hiddenPage: true, pageId: null }, 'avatar');
    const hidden = center.notices().find(n => n.title === 'Участник сейчас на скрытой странице')!;
    expect(hidden).toMatchObject({ quiet: true, read: true });
    expect(center.unreadCount()).toBe(1);
  });
});

describe('присутствие: камера, автопереход, «Позвать всех» (Ночь №5, TASK-06)', () => {
  type RoomClient = { uid: number; host: boolean; view?: { pageId: string; vx: number; vy: number; vz: number } | null };
  const guestClient = () => [...server.room.clients.values()].find(c => !(c as unknown as RoomClient).host) as unknown as RoomClient | undefined;
  const hostUrl = () => `${base}&host=1&key=${encodeURIComponent(server.hostKey)}`;

  it('view: сразу после входа и при смене страницы; камера - после остановки (дебаунс)', async () => {
    await collab.startCollab(base, false, 'Ученик');
    await until(() => st.state.project.id === 'proj');
    const first = await until(() => guestClient()?.view);
    expect(first.pageId).toBe(st.state.pageId);
    expect(first.vz).toBe(st.state.camera.zoom);
    // камера двигается: пока движется — не отправляется
    for (let i = 1; i <= 5; i++) { st.state.camera = { ...st.state.camera, x: st.state.camera.x + 10 }; st.update(); }
    await new Promise(r => setTimeout(r, collab.VIEW_SEND_MS / 3));
    expect(guestClient()!.view!.vx).toBe(first.vx);
    await until(() => guestClient()!.view!.vx === first.vx + 50);
    // смена страницы — сразу
    const other = st.state.project.pages.find(p => p.id !== st.state.pageId)!;
    st.switchPage(other.id);
    await until(() => guestClient()!.view!.pageId === other.id, 200);
  });

  it('автопереход: автор сменил страницу - гость переходит к нему; на скрытой странице - нет', async () => {
    const host = await peer(hostUrl());
    peers.push(host);
    host.ws.send(JSON.stringify({ t: 'follow-host', enabled: true }));
    await until(() => last(host, 'follow-host'));
    await collab.startCollab(base, false, 'Ученик');
    await until(() => st.state.project.id === 'proj');
    const goto: Msg[] = [];
    document.addEventListener('doska:collab-goto', e => goto.push((e as CustomEvent).detail));
    host.ws.send(JSON.stringify({ t: 'view', pageId: 'pg2', vx: 100, vy: 50, vz: 2 }));
    await until(() => goto.length === 1);
    expect(goto[0]).toEqual({ pageId: 'pg2', x: 100, y: 50, zoom: 2, reason: 'follow' });
    // только камера автора — гостя не двигает
    host.ws.send(JSON.stringify({ t: 'view', pageId: 'pg2', vx: 300, vy: 50, vz: 2 }));
    await until(() => collab.collabUsers().some(u => u.host && u.view?.vx === 300));
    expect(goto).toHaveLength(1);
    // страница pg1 скрыта от гостя: автор на ней — гость остаётся
    server.setRights(guestClient()!.uid, { pages: { pg1: 'hidden' } });
    host.ws.send(JSON.stringify({ t: 'view', pageId: 'pg1', vx: 1, vy: 1, vz: 1 }));
    await until(() => collab.collabUsers().some(u => u.host && u.hiddenPage));
    expect(goto).toHaveLength(1);
    // вернулся на открытую страницу — гость снова за ним
    host.ws.send(JSON.stringify({ t: 'view', pageId: 'pg2', vx: 7, vy: 8, vz: 1 }));
    await until(() => goto.length === 2);
    expect(goto[1]).toMatchObject({ pageId: 'pg2', x: 7, y: 8 });
    // хаб общий для всех тестов: выключаем автопереход
    host.ws.send(JSON.stringify({ t: 'follow-host', enabled: false }));
    await until(() => !collab.hostFollowEnabled());
  });

  it('без автоперехода смена страницы автором гостя не двигает', async () => {
    const host = await peer(hostUrl());
    peers.push(host);
    await collab.startCollab(base, false, 'Ученик');
    await until(() => st.state.project.id === 'proj');
    expect(collab.hostFollowEnabled()).toBe(false);
    const goto: Msg[] = [];
    document.addEventListener('doska:collab-goto', e => goto.push((e as CustomEvent).detail));
    host.ws.send(JSON.stringify({ t: 'view', pageId: 'pg2', vx: 1, vy: 1, vz: 1 }));
    await until(() => collab.collabUsers().some(u => u.host && u.pageId === 'pg2'));
    expect(goto).toEqual([]);
  });

  it('автор: sendSummon и sendFollowHost уходят в комнату; гостю они не доступны', async () => {
    const guest = await peer(`${base}&name=Гость`);
    peers.push(guest);
    st.openProject(demo());
    await collab.startHostConnection(server.port, server.code, server.hostKey, 'Автор');
    await until(() => collab.myCollabId() >= 0);
    expect(collab.sendSummon('pg2')).toBe(true);
    const s = await until(() => last(guest, 'summon'));
    expect(s.pageId).toBe('pg2');
    expect(Number.isFinite(s.vx) && Number.isFinite(s.vy) && s.vz > 0).toBe(true);
    expect(collab.sendFollowHost(true)).toBe(true);
    expect(collab.hostFollowEnabled()).toBe(true);
    await until(() => last(guest, 'follow-host')?.enabled === true);
    collab.sendFollowHost(false);
    await until(() => last(guest, 'follow-host')?.enabled === false);
    collab.stopCollab();
    await collab.startCollab(base, false, 'Ученик');
    expect(collab.sendSummon('pg1')).toBe(false);
    expect(collab.sendFollowHost(true)).toBe(false);
  });

  it('sendProjectNow: проект уходит сразу, следом - summon (гость видит открытую страницу)', async () => {
    // хаб общий для файла: проект прошлого теста пришёл бы автору в init вместо его собственного (с правами)
    server.room.project = null;
    const guest = await peer(`${base}&name=Гость`);
    peers.push(guest);
    const p = demo();
    p.permissions = { pageRights: { pg2: 'hidden' } };
    st.openProject(p);
    await collab.startHostConnection(server.port, server.code, server.hostKey, 'Автор');
    await until(() => collab.myCollabId() >= 0 && server.room.project?.permissions?.pageRights?.pg2 === 'hidden');
    st.state.project.permissions = { pageRights: { pg2: 'view' } };
    collab.sendProjectNow(st.state.project);
    collab.sendSummon('pg2');
    const s = await until(() => last(guest, 'summon'));
    expect(s.pageId).toBe('pg2');
  });
});

describe('живые права страниц у гостя (Ночь №5, TASK-07)', () => {
  // хаб общий для файла и помнит права страниц прошлого теста: сбрасываем их через хаб
  beforeEach(() => { (server as unknown as { pushProject(p: Project): void }).pushProject(demo()); });
  async function guestWithHost(): Promise<Peer> {
    await collab.startCollab(base, false, 'Ученик');
    await until(() => st.state.project.id === 'proj' && st.state.project.pages.length === 2);
    const host = await peer(`${base}&host=1&key=${encodeURIComponent(server.hostKey)}`);
    peers.push(host);
    await until(() => last(host, 'init'));
    return host;
  }
  const withRights = (pageRights: Record<string, string>): Project => ({ ...demo(), permissions: { pageRights: pageRights as never } });

  it('страницу под гостем скрыли: жест отменён, переход на ближайшую доступную и пилюля', async () => {
    const host = await guestWithHost();
    const inter = await import('../../src/interaction');
    let cancelled = 0;
    inter.onCancelInteraction(() => { cancelled++; });
    st.switchPage('pg2');
    st.setSelection(['x']);
    host.ws.send(JSON.stringify({ t: 'project', project: withRights({ pg2: 'hidden' }) }));
    await until(() => st.state.project.pages.length === 1);
    expect(st.state.pageId).toBe('pg1');
    expect(st.state.selection.size).toBe(0);
    expect(cancelled).toBe(1);
    expect(noticeTexts()).toContain(collab.PAGE_HIDDEN_PILL);
  });

  it('скрыли другую страницу: гость остаётся на своей без пилюли', async () => {
    const host = await guestWithHost();
    host.ws.send(JSON.stringify({ t: 'project', project: withRights({ pg2: 'hidden' }) }));
    await until(() => st.state.project.pages.length === 1);
    expect(st.state.pageId).toBe('pg1');
    expect(noticeTexts()).not.toContain(collab.PAGE_HIDDEN_PILL);
  });

  it('скрыли все страницы: баннер, холст только для чтения, ничего не отправляется; открыли - баннер уходит', async () => {
    const host = await guestWithHost();
    const uid = [...server.room.clients.values()].find(c => !(c as unknown as { host: boolean }).host)!.uid;
    server.setRights(uid, { default: 'edit' });
    await until(() => collab.pageRight('pg1') === 'edit');
    host.ws.send(JSON.stringify({ t: 'project', project: withRights({ pg1: 'hidden', pg2: 'hidden' }) }));
    await until(() => collab.allPagesHidden());
    const banner = document.getElementById('all-pages-hidden-banner')!;
    expect(banner.hidden).toBe(false);
    expect(banner.textContent).toBe(collab.ALL_HIDDEN_TEXT);
    expect(document.body.classList.contains('all-pages-hidden')).toBe(true);
    expect(st.state.project.pages.map(p => p.id)).toEqual([collab.HIDDEN_PLACEHOLDER_ID]);
    expect(collab.readOnly()).toBe(true);
    // сохранение и отправка заглушки не уходят хабу
    const before = host.inbox.length;
    await collab.netStorage.save(st.state.project);
    collab.sendProject(st.state.project);
    await new Promise(r => setTimeout(r, 400));
    expect(host.inbox.slice(before).filter(m => m.t === 'project' || m.t === 'patch')).toEqual([]);
    expect(server.room.project!.pages.map(p => p.id)).toEqual(['pg1', 'pg2']);
    // автор открыл вторую страницу
    host.ws.send(JSON.stringify({ t: 'project', project: withRights({ pg1: 'hidden', pg2: 'view' }) }));
    await until(() => !collab.allPagesHidden());
    expect(banner.hidden).toBe(true);
    expect(document.body.classList.contains('all-pages-hidden')).toBe(false);
    expect(st.state.pageId).toBe('pg2');
    expect(st.state.project.pages.map(p => p.id)).toEqual(['pg2']);
  });

  it('остановка совместной работы снимает баннер', async () => {
    const host = await guestWithHost();
    host.ws.send(JSON.stringify({ t: 'project', project: withRights({ pg1: 'hidden', pg2: 'hidden' }) }));
    await until(() => collab.allPagesHidden());
    collab.stopCollab();
    expect(collab.allPagesHidden()).toBe(false);
    expect(document.body.classList.contains('all-pages-hidden')).toBe(false);
  });

  it('отказ хаба запоминается и приходит в событии закрытия', async () => {
    const t = { send: () => true, close: () => {}, onopen: null as null | (() => void), onmessage: null as null | ((d: string) => void), onclose: null as null | ((c: number, r: string) => void) };
    const closed: unknown[] = [];
    document.addEventListener('doska:collab-closed', e => closed.push((e as CustomEvent).detail));
    const p = collab.connectCollab(t as never, false);
    t.onopen!();
    await p;
    t.onmessage!(JSON.stringify({ t: 'denied', reason: 'room-full', maxGuests: 3, planLimited: false }));
    t.onclose!(4430, 'room full');
    expect(collab.lastCollabDenied()).toEqual({ reason: 'room-full', maxGuests: 3, planLimited: false });
    expect(collab.lastCollabClose()).toEqual({ code: 4430, reason: 'room full', denied: { reason: 'room-full', maxGuests: 3, planLimited: false } });
    expect(closed).toEqual([collab.lastCollabClose()]);
  });
});

describe('защита чужих элементов у гостя (Ночь №6, TASK-05)', () => {
  const lesson = (protect: boolean): Project => ({
    ...demo(),
    permissions: protect ? { protectElements: true } : {},
    pages: [{ id: 'pg1', name: 'Задачи', grid: 'square', elements: [rect('teacher') as never] }, demo().pages[1]],
  });
  async function asEditor(protect: boolean) {
    server.room.project = lesson(protect);
    await collab.startCollab(base, false, 'Аня');
    await until(() => st.state.project.id === 'proj' && collab.myCollabId() > 0);
    server.setRights(collab.myCollabId(), { role: 'editor' });
    await until(() => collab.myCollabRole() === 'editor' && !collab.readOnly('pg1'));
    const host = await peer(`${base}&host=1&key=${encodeURIComponent(server.hostKey)}`);
    peers.push(host);
    host.ws.send(JSON.stringify({ t: 'caps', patches: true }));
    await hostCaps();
    return host;
  }
  const teacher = () => st.state.board.elements.find(e => e.id === 'teacher')!;
  const mine = () => st.state.board.elements.find(e => e.id === 'mine');

  it('свой элемент - свой (автор от хаба), чужой не выделяется и подписан; ластик и Undo не трогают чужое', async () => {
    const host = await asEditor(true);
    expect(collab.protectionActive()).toBe(true);
    expect(collab.myPrincipal()).toMatch(/^c:/);
    expect(collab.canTouchElement(teacher())).toBe(false);
    expect(collab.foreignElementHint(teacher())).toBe('Элемент преподавателя');
    // рисую свой элемент: он мой сразу и после того, как хаб поставил автора
    st.pushHistory(st.state.board.elements);
    st.replaceElements([...st.state.board.elements, rect('mine') as never]);
    expect(collab.canTouchElement(mine()!)).toBe(true);
    await until(() => server.room.project!.pages[0].elements.find(e => e.id === 'mine')?.by === collab.myPrincipal());
    await until(() => mine()?.by === collab.myPrincipal());
    expect(collab.canTouchElement(mine()!)).toBe(true);
    // выделение: только своё
    st.setSelection(['teacher', 'mine']);
    expect([...st.state.selection]).toEqual(['mine']);
    // учитель двигает свой элемент; мой Undo откатывает только моё и не возвращает учителя назад
    host.ws.send(JSON.stringify({ t: 'patch', pageId: 'pg1', rev: 1, ops: [{ op: 'put', el: { ...rect('teacher'), x: 50 } }] }));
    await until(() => (teacher() as never as { x: number }).x === 50);
    st.undo();
    expect(mine()).toBeUndefined();
    expect((teacher() as never as { x: number }).x).toBe(50);
    await new Promise(r => setTimeout(r, 250));
    expect(server.room.project!.pages[0].elements.map(e => e.id)).toEqual(['teacher']);
    expect((server.room.project!.pages[0].elements[0] as never as { x: number }).x).toBe(50);
  });

  it('удалённый учителем элемент не воскресает при Undo гостя', async () => {
    const host = await asEditor(true);
    st.pushHistory(st.state.board.elements);
    st.replaceElements([...st.state.board.elements, rect('mine') as never]);
    await until(() => server.room.project!.pages[0].elements.some(e => e.id === 'mine'));
    host.ws.send(JSON.stringify({ t: 'patch', pageId: 'pg1', rev: 2, ops: [{ op: 'del', id: 'teacher' }] }));
    await until(() => !st.state.board.elements.some(e => e.id === 'teacher'));
    st.undo();
    expect(st.state.board.elements).toEqual([]);
  });

  it('без защиты - как раньше: чужой элемент выделяется и Undo работает по снимку', async () => {
    await asEditor(false);
    expect(collab.protectionActive()).toBe(false);
    expect(collab.canTouchElement(teacher())).toBe(true);
    st.setSelection(['teacher']);
    expect([...st.state.selection]).toEqual(['teacher']);
  });
});

describe('интерфейс гостя по возможностям (Ночь №6, TASK-07)', () => {
  it('старая ссылка - комментатор: комментирует и пишет в чат; читатель - нет; смена роли - пилюля; копирование - по возможностям', async () => {
    const { canAnnotate } = await import('../../src/comments-ui');
    const chat = await import('../../src/collab-chat');
    server.room.project = { ...demo(), ownerPlan: 'pro', permissions: { allowCopy: false } } as Project;
    await collab.startCollab(base, false, 'Пётр');
    await until(() => st.state.project.id === 'proj' && collab.myCollabId() > 0);
    expect(collab.myCollabRole()).toBe('commenter');
    expect(collab.myCollabCaps()).toMatchObject({ comment: true, chat: true, pointer: true, copy: false });
    expect(canAnnotate()).toBe(true);
    expect(st.canCopyCurrentBoard()).toBe(false);
    server.setRights(collab.myCollabId(), { role: 'reader' });
    await until(() => collab.myCollabRole() === 'reader');
    expect(collab.myCollabCaps()).toMatchObject({ comment: false, chat: false, pointer: false });
    expect(canAnnotate()).toBe(false);
    expect(noticeTexts()).toContain('Автор изменил вашу роль: Читатель');
    expect(chat.chatCanWrite()).toBe(false);
    expect(chat.sendChatMessage('привет')).toBe('readonly');
    server.setRights(collab.myCollabId(), { role: 'editor' });
    await until(() => collab.myCollabRole() === 'editor');
    expect(st.canCopyCurrentBoard()).toBe(true); // редактор копирует всегда
    expect(chat.chatCanWrite()).toBe(true);
  });
});
