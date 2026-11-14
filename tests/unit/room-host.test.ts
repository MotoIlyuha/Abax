import { describe, expect, it } from 'vitest';
import { closedNotice } from '../../src/collab';
import { createRoomHub, PROTO, normalizeName, type RoomHubOptions, type RoomSocket } from '../../src/room-host';
import type { BoardPatch } from '../../src/delta';
import type { Element, Project, ShapeEl } from '../../src/types';

type Msg = Record<string, any>;

/** Сокет по контракту RoomSocket без сети. */
class FakeSock implements RoomSocket {
  readyState = 1;
  sent: Msg[] = [];
  closed: { code?: number; reason?: string } | null = null;
  private handlers: { message: ((raw: any) => void)[]; close: (() => void)[] } = { message: [], close: [] };
  send(text: string) { this.sent.push(JSON.parse(text)); }
  close(code?: number, reason?: string) {
    if (this.readyState !== 1) return;
    this.readyState = 3;
    this.closed = { code, reason };
    this.handlers.close.forEach(fn => fn());
  }
  on(ev: 'message' | 'close', fn: any) { this.handlers[ev].push(fn); }
  recv(m: unknown) { this.handlers.message.forEach(fn => fn(typeof m === 'string' ? m : JSON.stringify(m))); }
  recvBytes(m: unknown) { this.handlers.message.forEach(fn => fn(new TextEncoder().encode(JSON.stringify(m)))); }
  last(t: string) { return [...this.sent].reverse().find(m => m.t === t); }
  all(t: string) { return this.sent.filter(m => m.t === t); }
}

const rect = (id: string, o: Partial<ShapeEl> = {}): ShapeEl =>
  ({ id, type: 'shape', shape: 'rect', x: 0, y: 0, w: 1, h: 1, color: '#000000', width: 1, ...o });
const demo = (extra: Partial<Project> = {}): Project => ({
  id: 'demo', name: 'Демо', createdAt: 1, updatedAt: 2,
  pages: [
    { id: 'pg1', name: 'Первая', grid: 'square', elements: [] },
    { id: 'pg2', name: 'Вторая', grid: 'square', elements: [] },
  ],
  ...extra,
});
const patch = (pageId: string, ops: BoardPatch['ops'], rev = 0): BoardPatch => ({ t: 'patch', pageId, rev, ops });

function setup(opts: Partial<RoomHubOptions> = {}, project: Project = demo()) {
  const hub = createRoomHub({ code: 'ROOM', ...opts });
  const host = new FakeSock();
  hub.attach(host, { isHost: true, name: 'Учитель', patches: true });
  host.recv({ t: 'project', project });
  const join = (name = '', patches = true) => {
    const s = new FakeSock();
    const uid = hub.attach(s, { name, patches });
    return { s, uid: uid as number };
  };
  return { hub, host, join };
}

describe('подключение и лимит гостей', () => {
  it('автор получает init, гость — проект и права', () => {
    const { host, join } = setup({ plan: 'pro' });
    expect(host.last('init')).toMatchObject({ proto: PROTO, userId: 0 });
    const g = join('Ученик');
    const init = g.s.last('init')!;
    expect(init.userId).toBe(g.uid);
    expect(init.name).toBe('Ученик');
    expect(init.project.pages).toHaveLength(2);
    expect(init.rights).toEqual({ default: 'view', pages: { pg1: 'view', pg2: 'view' } });
    expect(init.allowCopy).toBe(true);
  });

  it('free: один гость подключается', () => {
    const { hub, join } = setup({ plan: 'free' });
    const g = join();
    expect(g.s.closed).toBeNull();
    expect(hub.users()).toHaveLength(2); // автор + 1 гость
  });

  it('free: второму гостю отказ free-limit-reached', () => {
    const { hub, join } = setup({ plan: 'free' });
    join();
    const second = join();
    expect(second.uid).toBeNull();
    expect(second.s.last('denied')).toEqual({ t: 'denied', reason: 'free-limit-reached' });
    expect(second.s.closed?.code).toBe(4402);
    expect(second.s.last('init')).toBeUndefined();
    expect(closedNotice(4402).title).toBe('Бесплатная комната занята');
    expect(hub.users()).toHaveLength(2);
  });

  it('free по умолчанию: проект без ownerPlan — бесплатный', () => {
    const { join } = setup();
    join();
    expect(join().uid).toBeNull();
  });

  it('место освобождается, когда гость ушёл', () => {
    const { join } = setup({ plan: 'free' });
    const first = join();
    first.s.close();
    expect(join().uid).not.toBeNull();
  });

  it('pro и tutor — без лимита; тариф берётся и из проекта', () => {
    const a = setup({ plan: 'pro' });
    for (let i = 0; i < 6; i++) expect(a.join().uid).not.toBeNull();
    const b = setup({}, demo({ ownerPlan: 'tutor' }));
    for (let i = 0; i < 6; i++) expect(b.join().uid).not.toBeNull();
  });

  it('maxGuests из опций важнее тарифа', () => {
    const { join } = setup({ plan: 'pro', maxGuests: 2 });
    join(); join();
    expect(join().uid).toBeNull();
  });

  it('второй автор отклоняется, а имя нормализуется', () => {
    const { hub, join } = setup({ plan: 'pro' });
    const second = new FakeSock();
    expect(hub.attach(second, { isHost: true })).toBeNull();
    expect(second.closed?.code).toBe(4409);
    expect(normalizeName('  А\u202Eб \n в  ')).toBe('А б в');
    expect(join('x'.repeat(100)).s.last('init')!.name).toHaveLength(40);
  });
});

describe('права по страницам и скрытые страницы', () => {
  it('hidden не попадает в проект гостя, пока автор не откроет', () => {
    const { hub, join } = setup({ plan: 'pro' });
    const g = join();
    hub.setRights(g.uid, { pages: { pg2: 'hidden' } });
    const view = g.s.last('project')!;
    expect(view.project.pages.map((p: any) => p.id)).toEqual(['pg1']);
    expect(g.s.last('rights')!.rights.pages).toEqual({ pg1: 'view', pg2: 'hidden' });
    hub.setRights(g.uid, { pages: { pg2: 'view' } });
    expect(g.s.last('project')!.project.pages).toHaveLength(2);
  });

  it('начальные права гостя берутся из permissions.pageRights', () => {
    const { join } = setup({ plan: 'pro' }, demo({ permissions: { pageRights: { pg1: 'edit', pg2: 'hidden' } } }));
    const g = join();
    expect(g.s.last('init')!.project.pages.map((p: any) => p.id)).toEqual(['pg1']);
    expect(g.s.last('init')!.rights.pages).toEqual({ pg1: 'edit', pg2: 'hidden' });
  });

  it('автор видит всё и его права менять нельзя; мусорные права игнорируются', () => {
    const { hub, join } = setup({ plan: 'pro' });
    expect(hub.setRights(0, { all: 'view' }).ok).toBe(false);
    const g = join();
    hub.setRights(g.uid, { pages: { pg1: 'суперправо' as never } });
    expect(g.s.last('rights')!.rights.pages.pg1).toBe('view');
  });

  it('allowCopy уходит в init и rights', () => {
    const { hub, join } = setup({ plan: 'pro' }, demo({ ownerPlan: 'pro', permissions: { allowCopy: false } }));
    const g = join();
    expect(g.s.last('init')!.allowCopy).toBe(false);
    hub.setRights(g.uid, { default: 'edit' });
    expect(g.s.last('rights')!.allowCopy).toBe(false);
    // forbidClone тоже запрещает копирование
    const f = setup({ plan: 'pro' }, demo({ ownerPlan: 'pro', permissions: { forbidClone: true } }));
    expect(f.join().s.last('init')!.allowCopy).toBe(false);
  });

  it('на free запреты проекта не действуют; опция allowCopy важнее', () => {
    const a = setup({ plan: 'free' }, demo({ permissions: { allowCopy: false } }));
    expect(a.join().s.last('init')!.allowCopy).toBe(true);
    const b = setup({ plan: 'pro', allowCopy: false });
    expect(b.join().s.last('init')!.allowCopy).toBe(false);
  });

  it('лимит редакторов: free — 4, pro — без лимита, опция важнее', () => {
    const free = setup({ plan: 'free', maxGuests: 10 });
    const guests = Array.from({ length: 4 }, () => free.join());
    for (const g of guests.slice(0, 3)) expect(free.hub.setRights(g.uid, { default: 'edit' }).ok).toBe(true); // автор + 3 = 4
    expect(free.hub.setRights(guests[3].uid, { default: 'edit' })).toEqual({ ok: false, error: 'Максимум 4 одновременных редакторов' });
    const pro = setup({ plan: 'pro' });
    for (let i = 0; i < 8; i++) expect(pro.hub.setRights(pro.join().uid, { default: 'edit' }).ok).toBe(true);
    const custom = setup({ plan: 'pro', maxEditors: 2 });
    expect(custom.hub.setRights(custom.join().uid, { default: 'edit' }).ok).toBe(true);
    expect(custom.hub.setRights(custom.join().uid, { default: 'edit' }).ok).toBe(false);
  });

  it('закрытые сокеты в лимите редакторов не считаются', () => {
    const { hub, join } = setup({ plan: 'pro', maxEditors: 2, maxGuests: 5 });
    const a = join();
    hub.setRights(a.uid, { default: 'edit' });
    a.s.readyState = 3; // обрыв без события close
    expect(hub.setRights(join().uid, { default: 'edit' }).ok).toBe(true);
  });
});

describe('полные проекты (t: project)', () => {
  it('правка гостя с edit доходит до остальных, view — отбрасывается', () => {
    const { hub, host, join } = setup({ plan: 'pro' });
    const editor = join(), viewer = join();
    hub.setRights(editor.uid, { pages: { pg1: 'edit' } });
    const base = demo();
    const edited = { ...base, pages: [{ ...base.pages[0], elements: [rect('e1')] }, { ...base.pages[1], elements: [rect('e2')] }] };
    editor.s.recv({ t: 'project', project: edited });
    expect(host.last('project')!.project.pages[0].elements).toHaveLength(1); // pg1 принят
    expect(host.last('project')!.project.pages[1].elements).toHaveLength(0); // pg2 — только просмотр
    expect(host.last('project')!.by).toBe(editor.uid);
    viewer.s.recv({ t: 'project', project: edited });
    expect(hub.room.project!.pages[1].elements).toHaveLength(0);
  });

  it('гость не меняет id, тариф и права проекта; первый проект — только от автора', () => {
    const { hub, join } = setup({ plan: 'pro' }, demo({ ownerPlan: 'pro', permissions: { allowCopy: false } }));
    const g = join();
    hub.setRights(g.uid, { default: 'edit' });
    g.s.recv({ t: 'project', project: { ...demo(), id: 'чужой', ownerPlan: 'free', permissions: { allowCopy: true } } });
    expect(hub.room.project!.id).toBe('demo');
    expect(hub.room.project!.permissions).toEqual({ allowCopy: false });
    const empty = createRoomHub({ code: 'X' });
    const s = new FakeSock();
    empty.attach(s, { name: 'Гость' });
    s.recv({ t: 'project', project: demo() });
    expect(empty.room.project).toBeNull();
  });

  it('free: гость не может сверх лимита добавить страницы', () => {
    const base = demo({ pages: [1, 2, 3].map(i => ({ id: `p${i}`, name: `П${i}`, grid: 'square' as const, elements: [] })) });
    const { hub, join } = setup({ plan: 'free' }, base);
    const g = join();
    hub.setRights(g.uid, { default: 'edit' });
    g.s.recv({ t: 'project', project: { ...base, pages: [...base.pages, { id: 'p4', name: 'П4', grid: 'square', elements: [] }] } });
    expect(hub.room.project!.pages).toHaveLength(3);
    // на pro — можно
    const pro = setup({ plan: 'pro' }, base);
    const g2 = pro.join();
    pro.hub.setRights(g2.uid, { default: 'edit' });
    g2.s.recv({ t: 'project', project: { ...base, pages: [...base.pages, { id: 'p4', name: 'П4', grid: 'square', elements: [] }] } });
    expect(pro.hub.room.project!.pages).toHaveLength(4);
  });

  it('испорченный проект и не-JSON игнорируются; байты UTF-8 принимаются', () => {
    const { hub, host } = setup({ plan: 'pro' });
    host.recv('{oops');
    host.recv({ t: 'project', project: { pages: 'нет' } });
    expect(hub.room.project!.id).toBe('demo');
    host.recvBytes({ t: 'project', project: demo({ name: 'Из байтов' }) });
    expect(hub.room.project!.name).toBe('Из байтов');
  });
});

describe('дельта-патчи (t: patch)', () => {
  it('патч гостя с edit применяется и рассылается остальным с доступом', () => {
    const { hub, host, join } = setup({ plan: 'pro' });
    const editor = join(), reader = join(), blind = join();
    hub.setRights(editor.uid, { pages: { pg1: 'edit' } });
    hub.setRights(blind.uid, { pages: { pg1: 'hidden' } });
    const before = blind.s.sent.length;
    editor.s.recv(patch('pg1', [{ op: 'put', el: rect('n1') }]));
    expect(hub.room.project!.pages[0].elements.map(e => e.id)).toEqual(['n1']);
    const got = reader.s.last('patch')!;
    expect(got).toMatchObject({ pageId: 'pg1', rev: 1, by: editor.uid });
    expect(got.ops[0].el.id).toBe('n1');
    expect(host.last('patch')!.rev).toBe(1);
    expect(editor.s.all('patch')).toHaveLength(0); // автору патча он не возвращается
    expect(blind.s.sent.length).toBe(before); // скрытая страница до участника не доходит
    editor.s.recv(patch('pg1', [{ op: 'del', id: 'n1' }]));
    expect(hub.room.project!.pages[0].elements).toHaveLength(0);
    expect(reader.s.last('patch')!.rev).toBe(2);
  });

  it('патч гостя с правом view отбрасывается', () => {
    const { hub, host, join } = setup({ plan: 'pro' });
    const viewer = join();
    const updatedAt = hub.room.project!.updatedAt;
    viewer.s.recv(patch('pg1', [{ op: 'put', el: rect('hack') }]));
    expect(hub.room.project!.pages[0].elements).toHaveLength(0);
    expect(host.all('patch')).toHaveLength(0);
    expect(hub.room.project!.updatedAt).toBe(updatedAt);
  });

  it('право на одну страницу не даёт править другую', () => {
    const { hub, join } = setup({ plan: 'pro' });
    const g = join();
    hub.setRights(g.uid, { pages: { pg1: 'edit' } });
    g.s.recv(patch('pg2', [{ op: 'put', el: rect('x') }]));
    expect(hub.room.project!.pages[1].elements).toHaveLength(0);
  });

  it('негодные элементы вычищаются, испорченные патчи и неизвестные страницы игнорируются', () => {
    const { hub, host, join } = setup({ plan: 'pro' });
    const g = join();
    hub.setRights(g.uid, { default: 'edit' });
    g.s.recv(patch('pg1', [{ op: 'put', el: { id: 'bad', type: 'shape' } as unknown as Element }, { op: 'put', el: rect('ok') }]));
    expect(hub.room.project!.pages[0].elements.map(e => e.id)).toEqual(['ok']);
    expect(host.last('patch')!.ops).toHaveLength(1);
    g.s.recv(patch('нет-такой', [{ op: 'put', el: rect('z') }]));
    g.s.recv({ t: 'patch', pageId: 'pg1', rev: 'x', ops: [] });
    g.s.recv({ t: 'patch', pageId: 'pg1', rev: 1, ops: [{ op: 'взрыв' }] });
    expect(hub.room.project!.pages[0].elements).toHaveLength(1);
    expect(host.all('patch')).toHaveLength(1);
  });

  it('участники без поддержки патчей получают полный проект; поддержка включается сообщением caps', () => {
    const { hub, join } = setup({ plan: 'pro' });
    const editor = join();
    const old = join('', false);
    hub.setRights(editor.uid, { default: 'edit' });
    editor.s.recv(patch('pg1', [{ op: 'put', el: rect('a') }]));
    expect(old.s.all('patch')).toHaveLength(0);
    expect(old.s.last('project')!.project.pages[0].elements).toHaveLength(1);
    old.s.recv({ t: 'caps', patches: true });
    editor.s.recv(patch('pg1', [{ op: 'put', el: rect('b') }]));
    expect(old.s.last('patch')!.ops[0].el.id).toBe('b');
  });

  it('скрытая от участника страница не уходит ему даже полным проектом', () => {
    const { hub, join } = setup({ plan: 'pro' });
    const editor = join(), old = join('', false);
    hub.setRights(editor.uid, { default: 'edit' });
    hub.setRights(old.uid, { pages: { pg1: 'hidden' } });
    const n = old.s.all('project').length;
    editor.s.recv(patch('pg1', [{ op: 'put', el: rect('a') }]));
    expect(old.s.all('project')).toHaveLength(n);
  });

  it('патч от автора программно: pushPatch', () => {
    const { hub, join } = setup({ plan: 'pro' });
    const g = join();
    expect(hub.pushPatch(patch('pg2', [{ op: 'put', el: rect('h') }]))).toBe(true);
    expect(g.s.last('patch')).toMatchObject({ pageId: 'pg2', by: -1 });
    expect(hub.pushPatch(patch('нет', []))).toBe(false);
  });

  it('патч от автора по сети принимается без прав', () => {
    const { hub, host, join } = setup({ plan: 'pro' });
    const g = join();
    host.recv(patch('pg1', [{ op: 'put', el: rect('h') }]));
    expect(g.s.last('patch')!.by).toBe(0);
    expect(hub.room.project!.pages[0].elements).toHaveLength(1);
  });
});

describe('прочее', () => {
  it('курсор и выделение рассылаются, мусор отбрасывается', () => {
    const { host, join } = setup({ plan: 'pro' });
    const g = join();
    g.s.recv({ t: 'cursor', x: 5, y: 6, pageId: 'pg1' });
    g.s.recv({ t: 'cursor', x: 'a', y: 6 });
    g.s.recv({ t: 'selection', ids: ['a', 'b'], pageId: 'pg1' });
    const me = host.last('users')!.users.find((u: any) => u.userId === g.uid);
    expect(me.cursor).toEqual({ x: 5, y: 6 });
    expect(me.selection).toEqual(['a', 'b']);
  });

  it('отошедший участник и refresh', () => {
    let t = 1000;
    const hub = createRoomHub({ code: 'R', plan: 'pro', awayMs: 100, now: () => t });
    const host = new FakeSock();
    hub.attach(host, { isHost: true });
    const s = new FakeSock();
    hub.attach(s, { name: 'Гость' });
    t += 500;
    expect(hub.users().every(u => u.away)).toBe(true);
    host.recv({ t: 'cursor', x: 1, y: 1 });
    expect(hub.users().find(u => u.host)!.away).toBe(false);
    const n = s.all('init').length;
    expect(hub.refresh(s)).toBe(true);
    expect(s.all('init')).toHaveLength(n + 1);
    expect(hub.refresh(new FakeSock())).toBe(false);
  });

  it('closeAll закрывает всех', () => {
    const { hub, host, join } = setup({ plan: 'pro' });
    const g = join();
    hub.closeAll();
    expect(host.readyState).toBe(3);
    expect(g.s.readyState).toBe(3);
  });
});
