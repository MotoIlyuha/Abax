// Меню аватаров: «Позвать к себе» одного участника (summon с to) и «Убрать из совместной работы» (remove).
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

    it('страница скрыта от участника, неверный to или зовёт себя — ничего', () => {
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

  describe('«Убрать из совместной работы» (remove)', () => {
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
