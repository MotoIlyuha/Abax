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

describe('дельта-патчи', () => {
  const patch = (extra: Msg = {}) => ({ t: 'patch', pageId: 'pg1', rev: 0, ops: [{ op: 'put', el: rect('p1') }], ...extra });

  it('init сообщает о поддержке патчей', () => {
    const { guest } = setup();
    expect(guest.sent.find(m => m.t === 'init')!.patches).toBe(true);
  });

  it('патч редактора применяется к странице хаба и уходит автору патчем, а без caps — проектом', () => {
    const { hub, host, guest, uid } = setup();
    hub.setRights(uid, { pages: { pg1: 'edit' } });
    host.recv({ t: 'caps', patches: true });
    guest.recv(patch());
    expect(hub.room.project.pages[0].elements.map((e: Msg) => e.id)).toEqual(['p1']);
    expect(host.last('patch')).toMatchObject({ pageId: 'pg1', by: uid, rev: 1 });
    // другая страница не тронута
    expect(hub.room.project.pages[1].elements).toEqual([]);
    // участник без caps получает полный проект
    const third = new FakeSock();
    hub.attach(third, { name: 'Вова' });
    hub.setRights(hub.room.nextUid - 1, { pages: { pg1: 'view' } });
    third.sent.length = 0;
    guest.recv(patch({ ops: [{ op: 'put', el: { ...rect('p1'), x: 5 } }] }));
    expect(third.last('patch')).toBeUndefined();
    expect(third.last('project')!.project.pages[0].elements[0].x).toBe(5);
    // ревизии растут
    expect(host.last('patch')!.rev).toBe(2);
  });

  it('участник с patches в attach получает патчи без caps', () => {
    const hub = createRoomHub({ code: 'P' });
    const host = new FakeSock();
    hub.attach(host, { isHost: true });
    host.recv({ t: 'project', project: demo() });
    const g = new FakeSock();
    const uid = hub.attach(g, { patches: true });
    hub.setRights(uid, { pages: { pg1: 'view' } });
    expect(hub.pushPatch(patch())).toBe(true);
    expect(g.last('patch')).toMatchObject({ by: -1 });
  });

  it('патч без права edit, на скрытую страницу и неизвестную страницу не принимается', () => {
    const { hub, guest, uid } = setup();
    guest.recv(patch());
    expect(hub.room.project.pages[0].elements).toEqual([]);
    hub.setRights(uid, { pages: { pg1: 'edit' } });
    guest.recv(patch({ pageId: 'нет' }));
    guest.recv(patch({ pageId: 'pg2' }));
    expect(hub.room.project.pages[1].elements).toEqual([]);
    expect(hub.pushPatch(patch({ pageId: 'нет' }))).toBe(false);
  });

  it('патч скрытой от участника страницы до него не доходит', () => {
    const { hub, host, guest, uid } = setup();
    hub.setRights(uid, { pages: { pg2: 'hidden' } });
    guest.sent.length = 0;
    guest.recv({ t: 'caps', patches: true });
    host.recv({ t: 'caps', patches: true });
    host.recv(patch({ pageId: 'pg2' }));
    expect(guest.last('patch')).toBeUndefined();
    expect(guest.last('project')).toBeUndefined();
    host.recv(patch());
    expect(guest.last('patch')).toMatchObject({ pageId: 'pg1' });
  });

  it('del, order, сетка и фон; мусорные патчи игнорируются', () => {
    const { hub, host } = setup();
    host.recv(patch({ ops: [{ op: 'put', el: rect('a') }, { op: 'put', el: rect('b') }] }));
    host.recv(patch({ ops: [{ op: 'order', ids: ['b', 'a'] }], grid: 'dots', backgroundColor: '#112233' }));
    expect(hub.room.project.pages[0]).toMatchObject({ grid: 'dots', backgroundColor: '#112233' });
    expect(hub.room.project.pages[0].elements.map((e: Msg) => e.id)).toEqual(['b', 'a']);
    host.recv(patch({ ops: [{ op: 'del', id: 'b' }], backgroundColor: null }));
    expect(hub.room.project.pages[0].elements.map((e: Msg) => e.id)).toEqual(['a']);
    expect(hub.room.project.pages[0]).not.toHaveProperty('backgroundColor');
    const before = hub.room.project;
    for (const bad of [
      { ops: 'нет' }, { ops: [{ op: 'put', el: { type: 'x' } }] }, { ops: [{ op: 'взлом' }] }, { grid: 'круги' }, { rev: 'x' },
      { ops: Array(10001).fill({ op: 'del', id: 'a' }) },
    ]) host.recv(patch(bad));
    expect(hub.room.project).toBe(before);
  });
});

describe('задания (task-draft, task-submit) и маскировка ответов', () => {
  const task = (extra: Msg = {}) => ({
    id: 'task', type: 'task', x: 0, y: 0, w: 360, h: 220, taskId: 't', examType: 'oge', topic: '', statementMd: 'Условие',
    answer: '0,75', solutionMd: 'решение', subject: 'math', ...extra,
  });
  const withTask = () => ({ ...demo(), pages: [{ id: 'pg1', name: 'П1', grid: 'square', elements: [task()] }, { id: 'pg2', name: 'П2', grid: 'square', elements: [] }] });
  function room() {
    const hub = createRoomHub({ code: 'T' });
    const host = new FakeSock();
    hub.attach(host, { isHost: true, name: 'Учитель' });
    host.recv({ t: 'project', project: withTask() });
    host.recv({ t: 'caps', patches: true });
    const g = new FakeSock();
    const uid = hub.attach(g, { name: 'Маша' });
    g.recv({ t: 'caps', patches: true });
    return { hub, host, g, uid };
  }
  const stored = (hub: any) => hub.room.project.pages[0].elements[0];

  it('ученику не уходят ответ и решение: ни в init, ни в проекте, ни в правах', () => {
    const { hub, host, g, uid } = room();
    expect(g.sent.find(m => m.t === 'init')!.project.pages[0].elements[0]).toMatchObject({ answer: '' });
    expect(g.sent.find(m => m.t === 'init')!.project.pages[0].elements[0]).not.toHaveProperty('solutionMd');
    hub.setRights(uid, { all: 'view' });
    expect(g.last('project')!.project.pages[0].elements[0].answer).toBe('');
    hub.pushProject(withTask());
    expect(g.last('project')!.project.pages[0].elements[0].answer).toBe('');
    expect(host.last('project')?.project?.pages?.[0]?.elements?.[0]?.answer ?? '0,75').toBe('0,75');
    expect(stored(hub).answer).toBe('0,75');
  });

  it('черновик и ответ ученика с правом view; проверка по настоящему ответу', () => {
    const { hub, host, g } = room();
    g.recv({ t: 'task-draft', pageId: 'pg1', elId: 'task', draft: '3/' });
    expect(stored(hub).studentDraft).toBe('3/');
    expect(host.last('patch')!.ops[0].el.studentDraft).toBe('3/');
    g.recv({ t: 'task-submit', pageId: 'pg1', elId: 'task', value: ' 0.750 ' });
    g.recv({ t: 'task-submit', pageId: 'pg1', elId: 'task', value: '0.5' });
    expect(stored(hub).attempts.map((a: Msg) => a.isCorrect)).toEqual([true, false]);
    expect(stored(hub)).not.toHaveProperty('studentDraft');
    expect(g.last('patch')!.ops[0].el.answer).toBe('');
    expect(g.last('patch')).toMatchObject({ by: -1 });
    expect(host.last('patch')!.ops[0].el.answer).toBe('0,75');
  });

  it('мусор, скрытые страницы и не-задания игнорируются', () => {
    const { hub, host, g, uid } = room();
    hub.setRights(uid, { pages: { pg2: 'hidden' } });
    host.sent.length = 0;
    for (const m of [
      { t: 'task-draft', pageId: 'pg1', elId: 'нет', draft: 'x' }, { t: 'task-draft', pageId: 'pg1', elId: 'task', draft: 5 },
      { t: 'task-submit', pageId: 'pg1', elId: 'task', value: null }, { t: 'task-submit', pageId: '', elId: 'task', value: '1' },
      { t: 'task-submit', pageId: 'pg1', elId: 'task', value: '   ' },
    ]) g.recv(m);
    expect(host.sent.filter(m => m.t === 'patch')).toHaveLength(0);
    expect(stored(hub)).not.toHaveProperty('attempts');
  });

  it('ученик с edit не меняет ответ и условие, автор не теряет ввод ученика при правке карточки', () => {
    const { hub, host, g, uid } = room();
    hub.setRights(uid, { all: 'edit' });
    const stale = stored(hub);
    g.recv({ t: 'patch', t0: 0, pageId: 'pg1', rev: 0, ops: [{ op: 'put', el: { ...stale, answer: 'взлом', statementMd: 'чужое', studentDraft: 'ввод' } }] });
    expect(stored(hub)).toMatchObject({ answer: '0,75', statementMd: 'Условие', studentDraft: 'ввод' });
    g.recv({ t: 'task-submit', pageId: 'pg1', elId: 'task', value: '0.75' });
    host.recv({ t: 'patch', pageId: 'pg1', rev: 0, ops: [{ op: 'put', el: { ...stale, x: 77, markedHard: true } }] });
    expect(stored(hub)).toMatchObject({ x: 77, markedHard: true });
    expect(stored(hub).attempts).toHaveLength(1);
    expect(stored(hub).studentDraft).toBeUndefined();
    // полным проектом от гостя то же самое
    g.recv({ t: 'project', project: { ...hub.room.project, pages: [{ ...hub.room.project.pages[0], elements: [{ ...stored(hub), answer: 'взлом2' }] }, hub.room.project.pages[1]] } });
    expect(stored(hub).answer).toBe('0,75');
  });
});
