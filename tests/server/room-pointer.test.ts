// Очистка сообщений указки на сервере (electron/room.cjs) обязана совпадать с src/room-host.ts.
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { VIEW_ZOOM_MAX, VIEW_ZOOM_MIN, cleanPointer, cleanView, maskUsersFor, type UserSnapshot } from '../../src/room-host';
import { CURSOR_IDS } from '../../src/cursors';
import * as chat from '../../src/room-chat';

const require = createRequire(import.meta.url);
const { cleanPointer: cjs, CURSOR_IDS: cjsCursorIds, ...cjsRoom } = require('../../electron/room.cjs');

const pts = (n: number) => Array.from({ length: n }, (_, i) => ({ x: i, y: -i, p: 0.3 }));
const SAMPLES: Record<string, unknown>[] = [
  { k: 'laser', pageId: 'p', color: '#ff2d2d', pts: pts(2) },
  { k: 'laser', pageId: 'p', color: '#ff2d2d', pts: pts(64), end: true },
  { k: 'laser', pageId: 'p', color: '#ff2d2d', pts: pts(65) },
  { k: 'laser', pageId: 'p', color: 'red', pts: pts(1) },
  { k: 'laser', pageId: '', color: '#ff2d2d', pts: pts(1) },
  { k: 'laser', pageId: 'p', color: '#ff2d2d', pts: [{ x: Infinity, y: 0 }] },
  { k: 'fade', pageId: 'p', sid: 's', color: '#00ff00', width: 12.8, opacity: 0.4, pts: pts(3) },
  { k: 'fade', pageId: 'p', sid: 's', color: '#00ff00', width: 12.8, opacity: 1, pts: [{ x: 1, y: 1, p: 9 }], end: true },
  { k: 'fade', pageId: 'p', sid: 's', color: '#00ff00', width: 201, pts: pts(1) },
  { k: 'fade', pageId: 'p', color: '#00ff00', width: 5, pts: pts(1) },
  { k: 'flash', pageId: 'p', ids: ['a', 'b'] },
  { k: 'flash', pageId: 'p', ids: [] },
  { k: 'flash', pageId: 'p', ids: [1, 2] },
  { k: 'flash', pageId: 'p', ids: Array.from({ length: 2001 }, (_, i) => `e${i}`) },
  { k: 'x', pageId: 'p' },
  {},
];

describe('room.cjs очищает указку так же, как room-host.ts', () => {
  it('одинаковый результат на разных сообщениях', () => {
    for (const m of SAMPLES) expect(cjs(m), JSON.stringify(m).slice(0, 80)).toEqual(cleanPointer(m));
  });
});

describe('белый список курсоров room.cjs совпадает с каталогом src/cursors.ts', () => {
  it('те же идентификаторы в том же порядке', () => {
    expect(cjsCursorIds).toEqual([...CURSOR_IDS]);
  });
});

describe('чат, камера и маскировка room.cjs совпадают с room-host.ts и room-chat.ts (SPEC_NIGHT5 §3)', () => {
  it('константы', () => {
    expect(cjsRoom.CHAT_MAX_LEN).toBe(chat.CHAT_MAX_LEN);
    expect(cjsRoom.CHAT_HISTORY).toBe(chat.CHAT_HISTORY);
    expect(cjsRoom.CHAT_RATE_COUNT).toBe(chat.CHAT_RATE_COUNT);
    expect(cjsRoom.CHAT_RATE_MS).toBe(chat.CHAT_RATE_MS);
    expect(cjsRoom.VIEW_ZOOM_MIN).toBe(VIEW_ZOOM_MIN);
    expect(cjsRoom.VIEW_ZOOM_MAX).toBe(VIEW_ZOOM_MAX);
  });

  it('текст сообщения', () => {
    for (const v of ['  а  ', '', '   ', 'я'.repeat(500), 'я'.repeat(501), 5, null, undefined, {}]) {
      expect(cjsRoom.normalizeChatText(v), String(v).slice(0, 20)).toBe(chat.normalizeChatText(v));
    }
  });

  it('ограничитель частоты', () => {
    const a = chat.createRateLimiter();
    const b = cjsRoom.createRateLimiter();
    for (const t of [0, 10, 20, 30, 40, 50, 2999, 3000, 3010, 3020, 3030, 3040, 9000]) expect(b(t)).toBe(a(t));
  });

  it('камера', () => {
    const samples = [
      { pageId: 'p', vx: 1, vy: 2, vz: 1 }, { pageId: 'p', vx: 1, vy: 2, vz: 0.05 }, { pageId: 'p', vx: 1, vy: 2, vz: 32 },
      { pageId: 'p', vx: 1, vy: 2, vz: 0.04 }, { pageId: 'p', vx: 1, vy: 2, vz: 33 }, { pageId: '', vx: 1, vy: 2, vz: 1 },
      { pageId: 'p', vx: Infinity, vy: 2, vz: 1 }, { pageId: 'p', vx: 1, vy: 2 }, { pageId: 'p', vx: 1, vy: 2, vz: 1, junk: 1 }, {},
    ];
    for (const m of samples) expect(cjsRoom.cleanView(m), JSON.stringify(m)).toEqual(cleanView(m));
  });

  it('маскировка снимка участников', () => {
    const users: UserSnapshot[] = [
      { userId: 0, name: 'А', color: '#000', host: true, away: false, cursor: { x: 1, y: 1 }, pageId: 'h', selection: ['x'], rights: { default: 'edit', pages: {} }, view: { pageId: 'h', vx: 0, vy: 0, vz: 1 } },
      { userId: 1, name: 'Б', color: '#000', host: false, away: false, cursor: null, pageId: 'v', selection: [], rights: { default: 'view', pages: {} } },
      { userId: 2, name: 'В', color: '#000', host: false, away: false, cursor: null, pageId: null, selection: [], rights: { default: 'view', pages: {} }, view: { pageId: 'h', vx: 0, vy: 0, vz: 1 } },
    ];
    for (const hidden of [new Set<string>(), new Set(['h']), new Set(['v']), new Set(['h', 'v'])]) {
      for (const viewer of [0, 1, 2]) expect(cjsRoom.maskUsersFor(users, viewer, hidden)).toEqual(maskUsersFor(users, viewer, hidden));
    }
  });
});
