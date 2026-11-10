// Комната без сети (electron/room.cjs): участники подключаются «сокетами»-заглушками.
// Так видно, что логике комнаты не нужен WebSocket — облачный транспорт подключится так же.
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { createRoomHub, PROTO, MAX_SELECTION } = require('../../electron/room.cjs');

type Msg = Record<string, any>;

/** Сокет по контракту RoomSocket: исходящие копятся в sent, входящие — sock.recv(...). */
class FakeSock extends EventEmitter {
  readyState = 1;
  sent: Msg[] = [];
  closed: { code?: number; reason?: string } | null = null;
  send(text: string) { this.sent.push(JSON.parse(text)); }
  close(code?: number, reason?: string) {
    if (this.readyState !== 1) return;
    this.readyState = 3;
    this.closed = { code, reason };
    this.emit('close');
  }
  recv(m: unknown) { this.emit('message', Buffer.from(typeof m === 'string' ? m : JSON.stringify(m))); }
  last(t: string) { return [...this.sent].reverse().find(m => m.t === t); }
}

const demo = () => ({
  id: 'demo', name: 'Демо', createdAt: 1, updatedAt: 2, icon: '📐',
  pages: [
    { id: 'pg1', name: 'Первая', grid: 'square', elements: [] as unknown[] },
    { id: 'pg2', name: 'Вторая', grid: 'square', elements: [] as unknown[] },
  ],
});
const rect = (id: string) => ({ id, type: 'shape', shape: 'rect', x: 0, y: 0, w: 1, h: 1, color: '#000', width: 1 });

function setup(opts: Record<string, unknown> = {}) {
  const hub = createRoomHub({ code: 'ROOM42', ...opts });
  const host = new FakeSock();
  hub.attach(host, { isHost: true, name: 'Учитель' });
  host.recv({ t: 'project', project: demo() });
  const guest = new FakeSock();
  const uid = hub.attach(guest, { name: 'Маша' });
  return { hub, host, guest, uid };
}

describe('подключение через attach', () => {
  it('init с версией протокола, проектом и правами', () => {
    const { guest, uid } = setup();
    const init = guest.sent.find(m => m.t === 'init')!;
    expect(init).toMatchObject({ proto: PROTO, userId: uid, name: 'Маша', rights: { default: 'view' } });
    expect(init.project.pages.map((p: Msg) => p.id)).toEqual(['pg1', 'pg2']);
  });

  it('пустое имя — «Гость N», у автора — «Автор»', () => {
    const hub = createRoomHub({ code: 'X' });
    const h = new FakeSock();
    const g = new FakeSock();
    hub.attach(h, { isHost: true });
    const uid = hub.attach(g);
    expect(h.sent[0].name).toBe('Автор');
    expect(g.sent[0].name).toBe(`Гость ${uid}`);
  });

  it('второй автор отклоняется с кодом 4409', () => {
    const { hub } = setup();
    const second = new FakeSock();
    expect(hub.attach(second, { isHost: true })).toBeNull();
    expect(second.closed).toEqual({ code: 4409, reason: 'host already connected' });
    expect(second.sent).toEqual([]);
  });

  it('закрытый сокет не получает рассылок и не роняет комнату', () => {
    const { hub, host, guest } = setup();
    guest.readyState = 3; // закрывается, но close ещё не пришёл
    guest.send = () => { throw new Error('сокет закрыт'); };
    expect(() => host.recv({ t: 'cursor', x: 1, y: 2, pageId: 'pg1' })).not.toThrow();
    expect(() => hub.pushProject(demo())).not.toThrow();
  });

  it('closeAll закрывает всех и убирает их из комнаты', () => {
    const { hub, host, guest } = setup();
    hub.closeAll();
    expect(host.closed).not.toBeNull();
    expect(guest.closed).not.toBeNull();
    expect(hub.room.clients.size).toBe(0);
  });
});

describe('свойства проекта меняет только автор', () => {
  it('гость не может подменить id, название и иконку, правки страниц проходят', () => {
    const { hub, host, guest, uid } = setup();
    hub.setRights(uid, { all: 'edit' });
    const p = { ...demo(), id: 'другая-доска-автора', name: 'Взлом', icon: '💀', updatedAt: 99 };
    p.pages[0].elements = [rect('r1')];
    guest.recv({ t: 'project', project: p });
    expect(hub.room.project).toMatchObject({ id: 'demo', name: 'Демо', icon: '📐', updatedAt: 99 });
    expect(hub.room.project.pages[0].elements).toHaveLength(1);
    expect(host.last('project')!.project.id).toBe('demo');
  });

  it('гость без updatedAt не сбрасывает его', () => {
    const { hub, guest, uid } = setup();
    hub.setRights(uid, { all: 'edit' });
    const { updatedAt: _drop, ...p } = demo();
    guest.recv({ t: 'project', project: p });
    expect(hub.room.project.updatedAt).toBe(2);
  });

  it('автор меняет свойства проекта', () => {
    const { hub, host, guest } = setup();
    host.recv({ t: 'project', project: { ...demo(), name: 'Новое имя', icon: '🧮' } });
    expect(hub.room.project).toMatchObject({ name: 'Новое имя', icon: '🧮' });
    expect(guest.last('project')!.project.name).toBe('Новое имя');
  });
});

describe('проверка входящих сообщений', () => {
  it('курсор: только конечные числа и строковый pageId', () => {
    const { hub, guest, uid } = setup();
    const cursor = () => hub.users().find((u: Msg) => u.userId === uid).cursor;
    for (const bad of [
      { x: '1', y: 2 }, { x: 1 }, { x: NaN, y: 1 }, { x: 1, y: Infinity }, { x: 1, y: 2, pageId: 5 },
      { x: 1, y: 2, pageId: 'x'.repeat(500) }, { x: 1, y: 2, pageId: '' },
    ]) guest.recv({ t: 'cursor', ...bad });
    // NaN и Infinity JSON превращает в null — тоже отказ
    expect(cursor()).toBeNull();
    guest.recv({ t: 'cursor', x: 3, y: 4, pageId: 'pg2' });
    expect(cursor()).toEqual({ x: 3, y: 4 });
  });

  it('выделение: массив строковых id в пределах лимита', () => {
    const { hub, guest, uid } = setup();
    const sel = () => hub.users().find((u: Msg) => u.userId === uid).selection;
    guest.recv({ t: 'selection', ids: ['a', 'b'], pageId: 'pg1' });
    expect(sel()).toEqual(['a', 'b']);
    for (const bad of [{ ids: 'a' }, { ids: [1] }, { ids: [{}] }, { ids: Array(MAX_SELECTION + 1).fill('a') }]) {
      guest.recv({ t: 'selection', ...bad });
    }
    expect(sel()).toEqual(['a', 'b']);
  });

  it('битый проект не принимается и не рассылается', () => {
    const { hub, host, guest } = setup();
    const sentBefore = guest.sent.length;
    const page = (over: Msg) => ({ ...demo(), pages: [{ id: 'pg1', name: 'x', grid: 'square', elements: [], ...over }] });
    for (const bad of [
      null, 'проект', [], { ...demo(), id: 5 }, { ...demo(), pages: {} },
      page({ id: undefined }), page({ elements: 'нет' }), page({ elements: [null] }),
      page({ elements: [{ type: 'shape' }] }), page({ elements: [{ id: 'e', type: 7 }] }),
      { ...demo(), pages: [demo().pages[0], demo().pages[0]] }, // повтор id страницы
    ]) host.recv({ t: 'project', project: bad });
    expect(hub.room.project).toEqual(demo());
    expect(guest.sent.length).toBe(sentBefore);
  });

  it('не объект и мусор игнорируются, комната живёт', () => {
    const { hub, guest, uid } = setup();
    for (const raw of ['не json', '42', 'null', '[1,2]', '"строка"']) guest.recv(raw);
    guest.recv({ t: 'cursor', x: 1, y: 1 });
    expect(hub.users().find((u: Msg) => u.userId === uid).cursor).toEqual({ x: 1, y: 1 });
  });
});
