// Очистка сообщений указки на сервере (electron/room.cjs) обязана совпадать с src/room-host.ts.
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { cleanPointer } from '../../src/room-host';

const require = createRequire(import.meta.url);
const { cleanPointer: cjs } = require('../../electron/room.cjs');

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
