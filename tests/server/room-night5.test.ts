// Протокол хабов Ночи №5 (SPEC_NIGHT5 §3): одинаковые сценарии для src/room-host.ts и его зеркала electron/room.cjs.
import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoomHub as createTsHub } from '../../src/room-host';

const require = createRequire(import.meta.url);
const { createRoomHub: createCjsHub } = require('../../electron/room.cjs');

type Msg = Record<string, any>;

class FakeSock {
  readyState = 1;
  sent: Msg[] = [];
  closed: { code?: number; reason?: string } | null = null;
  private h: { message: ((raw: any) => void)[]; close: (() => void)[] } = { message: [], close: [] };
  send(text: string) { this.sent.push(JSON.parse(text)); }
  close(code?: number, reason?: string) {
    if (this.readyState !== 1) return;
    this.readyState = 3;
    this.closed = { code, reason };
    this.h.close.forEach(fn => fn());
  }
  on(ev: 'message' | 'close', fn: any) { this.h[ev].push(fn); }
  recv(m: unknown) { this.h.message.forEach(fn => fn(JSON.stringify(m))); }
  last(t: string) { return [...this.sent].reverse().find(m => m.t === t); }
  all(t: string) { return this.sent.filter(m => m.t === t); }
}

const demo = (extra: Msg = {}) => ({
  id: 'demo', name: 'Демо', createdAt: 1, updatedAt: 2,
  pages: [
    { id: 'pg1', name: 'Первая', grid: 'square', elements: [] as unknown[] },
    { id: 'pg2', name: 'Вторая', grid: 'square', elements: [] as unknown[] },
  ],
  ...extra,
});

interface HubKind {
  name: string;
  /** Хаб без ограничений тарифа (pro у TS, обычный у Electron). */
  make(opts?: Msg): any;
  /** Хаб бесплатного тарифа, если он у этого хаба есть. */
  free?: (opts?: Msg) => any;
}

const kinds: HubKind[] = [
  { name: 'src/room-host.ts', make: (o = {}) => createTsHub({ code: 'R', plan: 'pro', ...o }), free: (o = {}) => createTsHub({ code: 'R', plan: 'free', ...o }) },
  { name: 'electron/room.cjs', make: (o = {}) => createCjsHub({ code: 'R', ...o }) },
];

function room(hub: any, project: Msg = demo()) {
  const host = new FakeSock();
  hub.attach(host, { isHost: true, name: 'Учитель' });
  host.recv({ t: 'project', project });
  const join = (name = 'Гость', opts: Msg = {}) => {
    const s = new FakeSock();
    const uid = hub.attach(s, { name, ...opts });
    return { s, uid: uid as number | null };
  };
  return { hub, host, join };
}

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(1_000_000); });
afterEach(() => { vi.useRealTimers(); });

describe.each(kinds)('$name', kind => {
  describe('чат', () => {
    it('сообщение после trim уходит всем, включая отправителя, с именем и курсором', () => {
      const { host, join } = room(kind.make());
      const g = join('Маша', { cursorId: 'mint' });
      g.s.recv({ t: 'chat', text: '  привет  ' });
      for (const s of [host, g.s]) {
        expect(s.last('chat')).toMatchObject({ t: 'chat', by: g.uid, name: 'Маша', cursorId: 'mint', text: 'привет', ts: 1_000_000 });
        expect(typeof s.last('chat')!.id).toBe('string');
      }
      host.recv({ t: 'chat', text: 'ответ' });
      expect(g.s.last('chat')).toMatchObject({ by: 0, name: 'Учитель', text: 'ответ' });
      expect(g.s.last('chat')!.cursorId).toBeUndefined();
    });

    it('пустое, длиннее 500 символов и не строка — отказ (без обрезки)', () => {
      const { host, join } = room(kind.make());
      const g = join();
      for (const text of ['   ', '', 'я'.repeat(501), 42, null]) g.s.recv({ t: 'chat', text });
      expect(host.all('chat')).toHaveLength(0);
      g.s.recv({ t: 'chat', text: 'я'.repeat(500) });
      expect(host.last('chat')!.text).toHaveLength(500);
    });

    it('флуд: шестое сообщение за 3 секунды отбрасывается молча', () => {
      const { host, join } = room(kind.make());
      const g = join();
      for (let i = 0; i < 6; i++) g.s.recv({ t: 'chat', text: `m${i}` });
      expect(host.all('chat').map(m => m.text)).toEqual(['m0', 'm1', 'm2', 'm3', 'm4']);
      vi.setSystemTime(1_003_000);
      g.s.recv({ t: 'chat', text: 'снова' });
      expect(host.last('chat')!.text).toBe('снова');
      // лимит у каждого свой
      host.recv({ t: 'chat', text: 'автор' });
      expect(g.s.last('chat')!.text).toBe('автор');
    });

    it('буфер последних 100 сообщений приходит новым участникам в init; проект чат не хранит', () => {
      const { hub, host, join } = room(kind.make());
      for (let i = 0; i < 105; i++) {
        vi.setSystemTime(1_000_000 + i * 1000);
        host.recv({ t: 'chat', text: `m${i}` });
      }
      const late = join('Опоздавший');
      const chat = late.s.last('init')!.chat;
      expect(chat).toHaveLength(100);
      expect(chat[0].text).toBe('m5');
      expect(chat[99].text).toBe('m104');
      expect(JSON.stringify(hub.room.project)).not.toContain('m104');
    });
  });

  describe('камера участника (view)', () => {
    it('правильный view попадает в users; неправильный — нет', () => {
      const { hub, host, join } = room(kind.make());
      const g = join();
      g.s.recv({ t: 'view', pageId: 'pg2', vx: 10, vy: -5, vz: 1.5 });
      const me = host.last('users')!.users.find((u: Msg) => u.userId === g.uid);
      expect(me).toMatchObject({ pageId: 'pg2', view: { pageId: 'pg2', vx: 10, vy: -5, vz: 1.5 } });
      for (const bad of [
        { pageId: 'нет', vx: 0, vy: 0, vz: 1 }, { pageId: 'pg1', vx: Number.NaN, vy: 0, vz: 1 },
        { pageId: 'pg1', vx: 0, vy: 0, vz: 0 }, { pageId: 'pg1', vx: 0, vy: 0, vz: 100 }, { pageId: 'pg1', vx: '1', vy: 0, vz: 1 },
      ]) g.s.recv({ t: 'view', ...bad });
      expect(hub.users().find((u: Msg) => u.userId === g.uid).view.pageId).toBe('pg2');
    });

    it('view на скрытой для себя странице не принимается', () => {
      const { hub, join } = room(kind.make());
      const g = join();
      hub.setRights(g.uid, { pages: { pg2: 'hidden' } });
      g.s.recv({ t: 'view', pageId: 'pg2', vx: 0, vy: 0, vz: 1 });
      expect(hub.users().find((u: Msg) => u.userId === g.uid).view).toBeUndefined();
    });
  });

  describe('маскировка скрытой страницы (§3.1)', () => {
    it('участник на скрытой для получателя странице приходит без страницы, курсора, камеры и выделения', () => {
      const { hub, host, join } = room(kind.make());
      const a = join('Аня');
      const b = join('Боря');
      hub.setRights(a.uid, { pages: { pg2: 'hidden' } });
      host.recv({ t: 'view', pageId: 'pg2', vx: 1, vy: 2, vz: 1 });
      host.recv({ t: 'cursor', x: 5, y: 6, pageId: 'pg2' });
      host.recv({ t: 'selection', ids: ['x'], pageId: 'pg2' });
      const seenByA = a.s.last('users')!.users.find((u: Msg) => u.userId === 0);
      expect(seenByA).toMatchObject({ host: true, pageId: null, cursor: null, view: null, selection: [], hiddenPage: true });
      const seenByB = b.s.last('users')!.users.find((u: Msg) => u.userId === 0);
      expect(seenByB).toMatchObject({ pageId: 'pg2', cursor: { x: 5, y: 6 }, selection: ['x'] });
      expect(seenByB.hiddenPage).toBeUndefined();
      // правило для любого участника, и в init нового гостя — тоже
      b.s.recv({ t: 'view', pageId: 'pg2', vx: 0, vy: 0, vz: 1 });
      expect(a.s.last('users')!.users.find((u: Msg) => u.userId === b.uid).hiddenPage).toBe(true);
      // себя участник видит как есть, автор видит всех
      expect(host.last('users')!.users.every((u: Msg) => !u.hiddenPage)).toBe(true);
      // страница снова видна — маскировки нет
      hub.setRights(a.uid, { pages: { pg2: 'view' } });
      expect(a.s.last('users')!.users.find((u: Msg) => u.userId === 0).pageId).toBe('pg2');
    });

    it('init гостя, у которого страница скрыта, уже замаскирован', () => {
      const project = demo({ ownerPlan: 'pro', permissions: { pageRights: { pg2: 'hidden' } } });
      const { host, join } = room(kind.make(), project);
      host.recv({ t: 'cursor', x: 1, y: 1, pageId: 'pg2' });
      const g = join();
      expect(g.s.last('init')!.users.find((u: Msg) => u.userId === 0)).toMatchObject({ hiddenPage: true, cursor: null });
    });
  });

  describe('«Позвать всех» (summon)', () => {
    it('от автора — гостям, которым страница видна; от гостя — ничего', () => {
      const { hub, host, join } = room(kind.make());
      const a = join();
      const b = join();
      hub.setRights(b.uid, { pages: { pg2: 'hidden' } });
      host.recv({ t: 'summon', pageId: 'pg2', vx: 3, vy: 4, vz: 2 });
      expect(a.s.last('summon')).toEqual({ t: 'summon', pageId: 'pg2', vx: 3, vy: 4, vz: 2, by: 0 });
      expect(b.s.last('summon')).toBeUndefined();
      expect(host.last('summon')).toBeUndefined();
      a.s.recv({ t: 'summon', pageId: 'pg1', vx: 0, vy: 0, vz: 1 });
      expect(b.s.last('summon')).toBeUndefined();
      host.recv({ t: 'summon', pageId: 'нет', vx: 0, vy: 0, vz: 1 });
      expect(a.s.all('summon')).toHaveLength(1);
    });
  });

  describe('«Автопереход за мной» (follow-host)', () => {
    it('автор включает — всем рассылка и состояние в init; гость не может', () => {
      const { host, join } = room(kind.make());
      const g = join();
      g.s.recv({ t: 'follow-host', enabled: true });
      expect(g.s.last('follow-host')).toBeUndefined();
      host.recv({ t: 'follow-host', enabled: true });
      expect(g.s.last('follow-host')).toEqual({ t: 'follow-host', enabled: true, by: 0 });
      expect(join().s.last('init')!.followHost).toBe(true);
      host.recv({ t: 'follow-host', enabled: false });
      expect(g.s.last('follow-host')!.enabled).toBe(false);
      expect(join().s.last('init')!.followHost).toBe(false);
    });

    it('тариф без автоперехода — пакет игнорируется', () => {
      const hub = kind.free ? kind.free({ maxGuests: Infinity }) : kind.make({ canFollowHost: false });
      const { host, join } = room(hub);
      const g = join();
      host.recv({ t: 'follow-host', enabled: true });
      expect(g.s.last('follow-host')).toBeUndefined();
      expect(join().s.last('init')!.followHost).toBe(false);
    });
  });

  describe('живые права страниц (§3.2)', () => {
    it('автор скрыл страницу в permissions — гость получает права и проект без неё; открыл — страница вернулась', () => {
      const { host, join } = room(kind.make());
      const g = join();
      host.recv({ t: 'project', project: demo({ permissions: { pageRights: { pg2: 'hidden' } } }) });
      expect(g.s.last('rights')!.rights.pages).toMatchObject({ pg1: 'view', pg2: 'hidden' });
      expect(g.s.last('project')!.project.pages.map((p: Msg) => p.id)).toEqual(['pg1']);
      expect(host.last('users')!.users.find((u: Msg) => u.userId === g.uid).rights.pages).toEqual({ pg2: 'hidden' });
      host.recv({ t: 'project', project: demo({ permissions: { pageRights: { pg2: 'edit' } } }) });
      expect(g.s.last('rights')!.rights.pages.pg2).toBe('edit');
      expect(g.s.last('project')!.project.pages.map((p: Msg) => p.id)).toEqual(['pg1', 'pg2']);
      // право снято — действует право по умолчанию
      host.recv({ t: 'project', project: demo({ permissions: {} }) });
      expect(g.s.last('rights')!.rights.pages.pg2).toBe('view');
    });

    it('личные права других страниц не трогаются; без смены прав rights не рассылается', () => {
      const { hub, host, join } = room(kind.make());
      const g = join();
      hub.setRights(g.uid, { pages: { pg1: 'edit' } });
      const before = g.s.all('rights').length;
      host.recv({ t: 'project', project: demo({ name: 'Другое имя' }) });
      expect(g.s.all('rights')).toHaveLength(before);
      host.recv({ t: 'project', project: demo({ permissions: { pageRights: { pg2: 'hidden' } } }) });
      expect(g.s.last('rights')!.rights.pages).toEqual({ pg1: 'edit', pg2: 'hidden' });
    });

    it('гость не может сменить права, прислав проект', () => {
      const { hub, join } = room(kind.make());
      const a = join();
      const b = join();
      hub.setRights(a.uid, { all: 'edit' });
      a.s.recv({ t: 'project', project: demo({ permissions: { pageRights: { pg1: 'hidden' } } }) });
      expect(b.s.last('project')?.project.pages.map((p: Msg) => p.id) ?? ['pg1', 'pg2']).toContain('pg1');
      expect(hub.users().find((u: Msg) => u.userId === b.uid).rights.pages.pg1).toBeUndefined();
    });

    it('pushProject (с сервера) тоже доносит смену прав', () => {
      const { hub, join } = room(kind.make());
      const g = join();
      hub.pushProject(demo({ permissions: { pageRights: { pg1: 'hidden' } } }));
      expect(g.s.last('rights')!.rights.pages.pg1).toBe('hidden');
      expect(g.s.last('project')!.project.pages.map((p: Msg) => p.id)).toEqual(['pg2']);
    });
  });

  describe('лимит гостей автора (§3.3)', () => {
    it('Pro-проект с maxGuests: лишнему гостю — denied room-full и код 4430', () => {
      const hub = kind.name.endsWith('.ts') ? createTsHub({ code: 'R' }) : kind.make();
      const { join } = room(hub, demo({ ownerPlan: 'pro', permissions: { maxGuests: 2 } }));
      expect(join().uid).not.toBeNull();
      expect(join().uid).not.toBeNull();
      const third = join();
      expect(third.uid).toBeNull();
      expect(third.s.last('denied')).toEqual({ t: 'denied', reason: 'room-full', maxGuests: 2, planLimited: false });
      expect(third.s.closed?.code).toBe(4430);
      expect(third.s.last('init')).toBeUndefined();
    });

    it('у бесплатного проекта maxGuests не действует', () => {
      const hub = kind.name.endsWith('.ts') ? createTsHub({ code: 'R', maxGuests: Infinity }) : kind.make();
      const { join } = room(hub, demo({ permissions: { maxGuests: 1 } }));
      for (let i = 0; i < 3; i++) expect(join().uid).not.toBeNull();
    });

    it('явный maxGuests в опциях', () => {
      const { join } = room(kind.make({ maxGuests: 1 }));
      expect(join().uid).not.toBeNull();
      const second = join();
      expect(second.uid).toBeNull();
      expect(second.s.last('denied')).toMatchObject({ maxGuests: 1 });
    });
  });

  describe('несколько устройств автора (multiHost)', () => {
    it('по умолчанию второй автор — отказ 4409', () => {
      const { hub } = room(kind.make());
      const second = new FakeSock();
      expect(hub.attach(second, { isHost: true })).toBeNull();
      expect(second.closed?.code).toBe(4409);
    });

    it('multiHost: второе устройство — тоже автор, со своим uid, гостевой слот не занимает', () => {
      const hub = kind.free ? kind.free({ multiHost: true }) : kind.make({ multiHost: true, maxGuests: 1 });
      const { host, join } = room(hub);
      const tablet = new FakeSock();
      const uid = hub.attach(tablet, { isHost: true, name: 'Учитель' });
      expect(uid).not.toBeNull();
      expect(uid).not.toBe(0);
      expect(tablet.last('init')!.project.pages).toHaveLength(2);
      expect(hub.users().filter((u: Msg) => u.host)).toHaveLength(2);
      const g = join();
      expect(g.uid).not.toBeNull(); // единственный гостевой слот свободен
      // правки одного устройства автора доходят до другого
      host.recv({ t: 'project', project: demo({ name: 'С ноутбука' }) });
      expect(tablet.last('project')!.project.name).toBe('С ноутбука');
      // второе устройство тоже может звать всех
      tablet.recv({ t: 'summon', pageId: 'pg1', vx: 0, vy: 0, vz: 1 });
      expect(g.s.last('summon')).toMatchObject({ by: uid });
    });
  });
});

describe('src/room-host.ts: лимит тарифа Free', () => {
  it('второму гостю — denied с прежней причиной, maxGuests 1, planLimited и код 4402', () => {
    const { join } = room(createTsHub({ code: 'R', plan: 'free' }));
    join();
    const second = join();
    expect(second.s.last('denied')).toEqual({ t: 'denied', reason: 'free-limit-reached', maxGuests: 1, planLimited: true });
    expect(second.s.closed?.code).toBe(4402);
  });
});
