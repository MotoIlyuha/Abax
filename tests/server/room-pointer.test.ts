// Очистка сообщений указки на сервере (electron/room.cjs) обязана совпадать с src/room-host.ts.
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { VIEW_ZOOM_MAX, VIEW_ZOOM_MIN, cleanPointer, cleanView, maskUsersFor, stripAccess, type UserSnapshot } from '../../src/room-host';
import * as access from '../../src/access';
import * as guard from '../../src/element-guard';
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

describe('правила доступа room-access.cjs совпадают с src/access.ts (SPEC_NIGHT6 §2)', () => {
  const cjsAccess = require('../../electron/room-access.cjs');
  const RIGHTS = [undefined, 'edit', 'view', 'hidden'] as const;
  const ROLES = ['editor', 'commenter', 'reader'] as const;

  it('роли и синонимы', () => {
    for (const raw of ['edit', 'view', 'editor', 'commenter', 'reader', 'owner', '', null, 3]) {
      expect(cjsAccess.normalizeRole(raw)).toEqual(access.normalizeRole(raw));
    }
    for (const r of ROLES) expect(cjsAccess.legacyRoleOf(r)).toBe(access.legacyRoleOf(r));
  });

  it('итоговое право на странице — все сочетания', () => {
    for (const owner of [false, true]) for (const legacy of [false, true]) for (const role of ROLES) {
      for (const pageSetting of RIGHTS) for (const personal of RIGHTS) {
        const input = { owner, legacy, role, pageSetting, personal };
        expect(cjsAccess.effectivePageAccess(input)).toBe(access.effectivePageAccess(input));
      }
    }
  });

  it('возможности участника', () => {
    const permsList = [undefined, {}, { allowCopy: false }, { forbidClone: true }, { summon: 'editors' as const }, { allowCopy: true, summon: 'owner' as const }];
    for (const owner of [false, true]) for (const legacy of [false, true]) for (const role of ROLES) for (const inviteAllowCopy of [undefined, true, false]) {
      for (const perms of permsList) {
        const a = { owner, role, legacy, inviteAllowCopy };
        expect(cjsAccess.participantCaps(a, perms)).toEqual(access.participantCaps(a, perms));
      }
    }
  });

  it('права проекта в хабе Electron: защита от копирования — только у Pro/Tutor', () => {
    expect(cjsAccess.hubPermissions({ permissions: { allowCopy: false, forbidClone: true } })).toMatchObject({ allowCopy: true, forbidClone: false });
    expect(cjsAccess.hubPermissions({ ownerPlan: 'pro', permissions: { allowCopy: false, forbidClone: true, summon: 'editors', protectElements: true } }))
      .toEqual({ allowCopy: false, forbidClone: true, summon: 'editors', protectElements: true });
  });

  it('снимок для гостя без сведений о доступе', () => {
    const users = [{ userId: 1, access: { role: 'reader', source: 'p2p' } }, { userId: 2 }];
    expect(cjsRoom.stripAccess(users)).toEqual(stripAccess(users as never));
  });
});

describe('защита элементов room-guard.cjs совпадает с src/element-guard.ts (SPEC_NIGHT6 §4)', () => {
  const cjsGuard = require('../../electron/room-guard.cjs');
  const r = (id: string, by?: string, x = 0) => ({ id, type: 'shape', shape: 'rect', x, y: 0, w: 1, h: 1, color: '#000', width: 1, ...(by ? { by } : {}) });
  const t = (extra = {}) => ({ id: 't', type: 'task', x: 0, y: 0, w: 1, h: 1, taskId: 'k', examType: 'custom', topic: '', statementMd: 'У', answer: '1', ...extra });
  const page = (els: unknown[], extra = {}) => ({ id: 'p', name: 'С', grid: 'square', elements: els, ...extra });
  const whos = [
    { privileged: true, principal: null, protect: true },
    { privileged: false, principal: 'c:a', protect: true },
    { privileged: false, principal: 'c:a', protect: false },
    { privileged: false, principal: null, protect: true },
    { privileged: false, principal: null, protect: false },
  ];
  const known = page([r('o'), r('a', 'c:a'), r('b', 'c:b'), t({ studentDraft: 'x' })]);
  const patches = [
    { t: 'patch', pageId: 'p', rev: 1, ops: [{ op: 'del', id: 'o' }, { op: 'del', id: 'a' }, { op: 'put', el: r('n', 'c:z') }] },
    { t: 'patch', pageId: 'p', rev: 1, ops: [{ op: 'put', el: r('o', undefined, 5) }, { op: 'put', el: r('b', 'c:b') }, { op: 'put', el: t({ statementMd: 'Подмена', studentDraft: 'y' }) }] },
    { t: 'patch', pageId: 'p', rev: 1, ops: [{ op: 'order', ids: ['b', 'o', 'a', 't'] }], grid: 'none' },
    { t: 'patch', pageId: 'p', rev: 1, ops: [{ op: 'order', ids: ['a', 'o', 'b', 't'] }], backgroundColor: null },
  ];
  const pages = [
    page([r('a', 'c:a', 3), r('o', undefined, 9), r('n')], { name: 'Другое' }),
    page([r('b', 'c:b'), r('t'), r('a', 'c:a'), r('o')]),
    page(known.elements),
  ];
  it('патчи', () => {
    for (const who of whos) for (const p of patches) expect(cjsGuard.guardPatch(known, p, who)).toEqual(guard.guardPatch(known as never, p as never, who));
  });
  it('страница целиком', () => {
    for (const who of whos) for (const p of pages) expect(cjsGuard.guardPageReplace(known, p, who)).toEqual(guard.guardPageReplace(known as never, p as never, who));
  });
});
