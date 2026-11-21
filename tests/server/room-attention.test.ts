// Реакции и «Привлечь внимание» (SPEC_COMMENTS §4–5): noteId участника в снимке и пакет attention.
// Одинаковые сценарии для src/room-host.ts и его зеркала electron/room.cjs.
import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ATTENTION_RATE_COUNT, ATTENTION_RATE_MS, createRoomHub as createTsHub } from '../../src/room-host';

const require = createRequire(import.meta.url);
const cjsRoom = require('../../electron/room.cjs');

type Msg = Record<string, any>;

class FakeSock {
  readyState = 1;
  sent: Msg[] = [];
  private h: { message: ((raw: any) => void)[]; close: (() => void)[] } = { message: [], close: [] };
  send(text: string) { this.sent.push(JSON.parse(text)); }
  close() { if (this.readyState !== 1) return; this.readyState = 3; this.h.close.forEach(fn => fn()); }
  on(ev: 'message' | 'close', fn: any) { this.h[ev].push(fn); }
  recv(m: unknown) { this.h.message.forEach(fn => fn(JSON.stringify(m))); }
  last(t: string) { return [...this.sent].reverse().find(m => m.t === t); }
  all(t: string) { return this.sent.filter(m => m.t === t); }
}

const rect = (id: string, reactions?: Record<string, string[]>) =>
  ({ id, type: 'shape', shape: 'rect', x: 0, y: 0, w: 10, h: 10, color: '#000', width: 1, ...(reactions ? { reactions } : {}) });

const demo = () => ({
  id: 'demo', name: 'Демо', createdAt: 1, updatedAt: 2,
  pages: [
    { id: 'pg1', name: 'Первая', grid: 'square', elements: [rect('a', { '👍': ['n-host'] }), rect('b')] },
    { id: 'pg2', name: 'Вторая', grid: 'square', elements: [rect('c', { '🔥': ['n-host'] })] },
  ],
});

const kinds = [
  { name: 'src/room-host.ts', make: () => createTsHub({ code: 'R', plan: 'pro' }) },
  { name: 'electron/room.cjs', make: () => cjsRoom.createRoomHub({ code: 'R' }) },
];

function room(hub: any) {
  const host = new FakeSock();
  hub.attach(host, { isHost: true, name: 'Учитель' });
  host.recv({ t: 'project', project: demo() });
  const join = (name = 'Гость') => {
    const s = new FakeSock();
    const uid = hub.attach(s, { name }) as number;
    return { s, uid };
  };
  return { hub, host, join };
}

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(1_000_000); });
afterEach(() => { vi.useRealTimers(); });

it('частота «Привлечь внимание» в зеркале совпадает', () => {
  expect(cjsRoom.ATTENTION_RATE_COUNT).toBe(ATTENTION_RATE_COUNT);
  expect(cjsRoom.ATTENTION_RATE_MS).toBe(ATTENTION_RATE_MS);
});

describe.each(kinds)('$name', kind => {
  describe('noteId в снимке участников', () => {
    it('из caps: приходит всем в users; негодный не принимается', () => {
      const { host, join } = room(kind.make());
      const a = join('Аня');
      a.s.recv({ t: 'caps', patches: true, noteId: 'note-anya' });
      const u = host.last('users')!.users.find((x: Msg) => x.userId === a.uid);
      expect(u.noteId).toBe('note-anya');
      const b = join('Боря');
      b.s.recv({ t: 'caps', patches: true, noteId: 'x'.repeat(65) });
      expect(host.last('users')!.users.find((x: Msg) => x.userId === b.uid).noteId).toBeUndefined();
      b.s.recv({ t: 'caps', patches: true });
      expect(host.last('users')!.users.find((x: Msg) => x.userId === b.uid).noteId).toBeUndefined();
    });

    it('старый клиент без noteId в caps: берётся из первой реакции', () => {
      const { host, join } = room(kind.make());
      const a = join('Аня');
      a.s.recv({ t: 'caps', patches: true });
      a.s.recv({ t: 'react', pageId: 'pg1', elId: 'b', emoji: '❤️', userId: 'note-old' });
      expect(host.last('users')!.users.find((x: Msg) => x.userId === a.uid).noteId).toBe('note-old');
    });
  });

  describe('attention', () => {
    it('уходит всем, кроме отправителя, с by; нужна стоящая на объекте реакция', () => {
      const { host, join } = room(kind.make());
      const a = join('Аня');
      const b = join('Боря');
      a.s.recv({ t: 'attention', pageId: 'pg1', elId: 'a', emoji: '👍' });
      expect(b.s.last('attention')).toEqual({ t: 'attention', pageId: 'pg1', elId: 'a', emoji: '👍', by: a.uid });
      expect(host.last('attention')).toEqual({ t: 'attention', pageId: 'pg1', elId: 'a', emoji: '👍', by: a.uid });
      expect(a.s.last('attention')).toBeUndefined();
      const n = b.s.all('attention').length;
      // реакции нет, объекта нет, страницы нет, ключи прототипа, негодные поля
      for (const bad of [
        { pageId: 'pg1', elId: 'a', emoji: '🔥' }, { pageId: 'pg1', elId: 'b', emoji: '👍' }, { pageId: 'pg1', elId: 'нет', emoji: '👍' },
        { pageId: 'pg9', elId: 'a', emoji: '👍' }, { pageId: 'pg1', elId: 'a', emoji: 'constructor' }, { pageId: 'pg1', elId: 'a', emoji: '__proto__' },
        { pageId: 'pg1', elId: 'a', emoji: 5 }, { pageId: '', elId: 'a', emoji: '👍' },
      ]) a.s.recv({ t: 'attention', ...bad });
      expect(b.s.all('attention').length).toBe(n);
    });

    it('читатель не привлекает внимание; скрытая страница - не получает', () => {
      const { hub, host, join } = room(kind.make());
      const reader = join('Читатель');
      const b = join('Боря');
      hub.setRights(reader.uid, { role: 'reader' });
      reader.s.recv({ t: 'attention', pageId: 'pg1', elId: 'a', emoji: '👍' });
      expect(b.s.last('attention')).toBeUndefined();
      hub.setRights(b.uid, { pages: { pg2: 'hidden' } });
      host.recv({ t: 'attention', pageId: 'pg2', elId: 'c', emoji: '🔥' });
      expect(b.s.last('attention')).toBeUndefined();
      expect(reader.s.last('attention')).toMatchObject({ pageId: 'pg2', elId: 'c', by: 0 });
    });

    it(`не чаще ${ATTENTION_RATE_COUNT} раз за ${ATTENTION_RATE_MS} мс`, () => {
      const { join } = room(kind.make());
      const a = join('Аня');
      const b = join('Боря');
      for (let i = 0; i < ATTENTION_RATE_COUNT + 3; i++) a.s.recv({ t: 'attention', pageId: 'pg1', elId: 'a', emoji: '👍' });
      expect(b.s.all('attention')).toHaveLength(ATTENTION_RATE_COUNT);
      vi.setSystemTime(1_000_000 + ATTENTION_RATE_MS);
      a.s.recv({ t: 'attention', pageId: 'pg1', elId: 'a', emoji: '👍' });
      expect(b.s.all('attention')).toHaveLength(ATTENTION_RATE_COUNT + 1);
    });
  });
});
