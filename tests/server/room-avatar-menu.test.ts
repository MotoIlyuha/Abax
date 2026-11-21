// Меню аватаров: «Позвать к себе» одного участника (summon с to), «Настройки доступа» (set-rights)
// и «Исключить» (remove).
// Одинаковые сценарии для src/room-host.ts и его зеркала electron/room.cjs.
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

import { CLOSE_REMOVED } from '../../src/collab-transport';
import { REMOVED_REASON } from '../../src/room-host';

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(1_000_000); });
afterEach(() => { vi.useRealTimers(); });

describe.each(kinds)('$name', kind => {
  describe('«Позвать к себе» одного участника (summon с to)', () => {
    it('приходит только ему и с to; остальные не получают', () => {
      const { host, join } = room(kind.make());
      const a = join('Аня');
      const b = join('Боря');
      host.recv({ t: 'summon', pageId: 'pg2', vx: 3, vy: 4, vz: 2, to: b.uid });
      expect(b.s.last('summon')).toEqual({ t: 'summon', pageId: 'pg2', vx: 3, vy: 4, vz: 2, by: 0, to: b.uid });
      expect(a.s.last('summon')).toBeUndefined();
      expect(host.last('summon')).toBeUndefined();
    });

    it('страница скрыта от участника, неверный to или зовёт себя - ничего', () => {
      const { hub, host, join } = room(kind.make());
      const a = join();
      hub.setRights(a.uid, { pages: { pg2: 'hidden' } });
      host.recv({ t: 'summon', pageId: 'pg2', vx: 0, vy: 0, vz: 1, to: a.uid });
      host.recv({ t: 'summon', pageId: 'pg1', vx: 0, vy: 0, vz: 1, to: 'все' });
      host.recv({ t: 'summon', pageId: 'pg1', vx: 0, vy: 0, vz: 1, to: 1.5 });
      host.recv({ t: 'summon', pageId: 'pg1', vx: 0, vy: 0, vz: 1, to: 9999 });
      expect(a.s.all('summon')).toHaveLength(0);
      a.s.recv({ t: 'summon', pageId: 'pg1', vx: 0, vy: 0, vz: 1, to: a.uid });
      expect(a.s.all('summon')).toHaveLength(0);
    });

    it('гость без права звать не зовёт и одного', () => {
      const { join } = room(kind.make());
      const a = join();
      const b = join();
      a.s.recv({ t: 'summon', pageId: 'pg1', vx: 0, vy: 0, vz: 1, to: b.uid });
      expect(b.s.all('summon')).toHaveLength(0);
    });
  });

  describe('«Настройки доступа» одного участника (set-rights)', () => {
    it('автор скрывает страницу только от одного гостя: ему - права и проект без страницы, автору - личные права в снимке', () => {
      const { hub, host, join } = room(kind.make());
      const a = join('Аня');
      const b = join('Боря');
      host.recv({ t: 'set-rights', uid: a.uid, pages: { pg2: 'hidden' } });
      expect(a.s.last('rights')!.rights.pages.pg2).toBe('hidden');
      expect(a.s.last('project')!.project.pages.map((p: Msg) => p.id)).toEqual(['pg1']);
      expect(b.s.last('rights')).toBeUndefined();
      const snap = (sock: FakeSock, uid: number | null) => sock.last('users')!.users.find((u: Msg) => u.userId === uid);
      expect(snap(host, a.uid).access.personal).toEqual({ pg2: 'hidden' });
      expect(snap(host, b.uid).access.personal).toBeUndefined();
      // гостям личные права других не приходят
      expect(snap(b.s, a.uid).access).toBeUndefined();
      expect(hub.users().find((u: Msg) => u.userId === a.uid).rights.pages.pg2).toBe('hidden');
      // «Только просмотр», затем «По роли» (null) — личное право снимается
      host.recv({ t: 'set-rights', uid: a.uid, pages: { pg1: 'view', pg2: null } });
      expect(snap(host, a.uid).access.personal).toEqual({ pg1: 'view' });
      expect(a.s.last('project')!.project.pages.map((p: Msg) => p.id)).toEqual(['pg1', 'pg2']);
      host.recv({ t: 'set-rights', uid: a.uid, pages: { pg1: null } });
      expect(snap(host, a.uid).access.personal).toBeUndefined();
    });

    it('права сохраняются за участником: перезаход с секретом возобновления возвращает их, новый гость - без них', () => {
      const { hub, host, join } = room(kind.make());
      const a = join('Аня');
      const secret = a.s.last('init')!.resume as string;
      host.recv({ t: 'set-rights', uid: a.uid, pages: { pg2: 'hidden' } });
      a.s.close();
      const back = join('Аня');
      expect(back.s.last('init')!.project.pages).toHaveLength(2);
      back.s.recv({ t: 'resume', secret });
      expect(back.s.last('resume')).toMatchObject({ ok: true });
      expect(back.s.last('rights')!.rights.pages.pg2).toBe('hidden');
      expect(back.s.last('project')!.project.pages.map((p: Msg) => p.id)).toEqual(['pg1']);
      expect(host.last('users')!.users.find((u: Msg) => u.userId === back.uid).access.personal).toEqual({ pg2: 'hidden' });
      // другой гость (без секрета Ани) прав Ани не получает
      const other = join('Боря');
      expect(other.s.last('init')!.project.pages).toHaveLength(2);
      // «По роли» тоже запоминается: после следующего перезахода страница снова видна
      host.recv({ t: 'set-rights', uid: back.uid, pages: { pg2: null } });
      back.s.close();
      // после возобновления у участника прежний секрет
      const again = join('Аня');
      again.s.recv({ t: 'resume', secret });
      expect(again.s.last('resume')).toMatchObject({ ok: true });
      expect(again.s.last('init')!.project.pages).toHaveLength(2);
      expect(hub.users().find((u: Msg) => u.userId === again.uid).access.personal).toBeUndefined();
    });

    it('гость не меняет права; автору нельзя; чужие страницы, «edit» и мусор - пропускаются', () => {
      const hub = kind.make({ multiHost: true });
      const { host, join } = room(hub);
      const tablet = new FakeSock();
      const tabletUid = hub.attach(tablet, { isHost: true, name: 'Учитель' });
      const a = join();
      const b = join();
      const before = a.s.all('rights').length;
      b.s.recv({ t: 'set-rights', uid: a.uid, pages: { pg2: 'hidden' } });
      a.s.recv({ t: 'set-rights', uid: a.uid, pages: { pg2: 'view' } });
      host.recv({ t: 'set-rights', uid: tabletUid, pages: { pg2: 'hidden' } });
      host.recv({ t: 'set-rights', uid: 0, pages: { pg2: 'hidden' } });
      host.recv({ t: 'set-rights', uid: String(a.uid), pages: { pg2: 'hidden' } });
      host.recv({ t: 'set-rights', uid: a.uid, pages: { pg2: 'edit', nope: 'hidden' } });
      host.recv({ t: 'set-rights', uid: a.uid, pages: ['hidden'] });
      host.recv({ t: 'set-rights', uid: a.uid });
      expect(a.s.all('rights')).toHaveLength(before);
      expect(hub.users().find((u: Msg) => u.userId === a.uid).access.personal).toBeUndefined();
      expect(tablet.last('rights')).toBeUndefined();
    });
  });

  describe('«Исключить» (remove)', () => {
    it('автор убирает гостя: соединение закрыто кодом 4411, остальные видят обновлённый состав', () => {
      const { hub, host, join } = room(kind.make());
      const a = join('Аня');
      const b = join('Боря');
      host.recv({ t: 'remove', uid: a.uid });
      expect(a.s.closed).toEqual({ code: CLOSE_REMOVED, reason: REMOVED_REASON });
      expect(b.s.closed).toBeNull();
      expect(hub.users().map((u: Msg) => u.userId)).not.toContain(a.uid);
      expect(b.s.last('users')!.users.map((u: Msg) => u.userId)).not.toContain(a.uid);
    });

    it('гость не может убрать никого; автора и его устройства не убрать', () => {
      const hub = kind.make({ multiHost: true });
      const { host, join } = room(hub);
      const tablet = new FakeSock();
      const tabletUid = hub.attach(tablet, { isHost: true, name: 'Учитель' });
      const a = join();
      const b = join();
      a.s.recv({ t: 'remove', uid: b.uid });
      a.s.recv({ t: 'remove', uid: 0 });
      expect(b.s.closed).toBeNull();
      expect(host.closed).toBeNull();
      host.recv({ t: 'remove', uid: tabletUid });
      host.recv({ t: 'remove', uid: 0 });
      host.recv({ t: 'remove', uid: String(b.uid) });
      expect(tablet.closed).toBeNull();
      expect(host.closed).toBeNull();
      expect(b.s.closed).toBeNull();
    });
  });
});
