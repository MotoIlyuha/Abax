// Серверные функции реакций и комментариев (electron/room-comments.cjs) обязаны вести себя так же, как src/comments.ts.
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import * as ts from '../../src/comments';
import type { Element, Page, ShapeEl } from '../../src/types';

const require = createRequire(import.meta.url);
const cjs = require('../../electron/room-comments.cjs');

const rect = (id: string, extra: Partial<ShapeEl> = {}): ShapeEl =>
  ({ id, type: 'shape', shape: 'rect', x: 0, y: 0, w: 10, h: 10, color: '#000', width: 1, ...extra });
const page = (extra: Partial<Page> = {}): Page => ({ id: 'p', name: 'П', grid: 'square', elements: [rect('a')], ...extra });

describe('room-comments.cjs совпадает с comments.ts', () => {
  it('реакции', () => {
    const base: Element = rect('a');
    const withOne = ts.toggleElementReaction(base, '👍', 'u1');
    const cases: [Element, unknown, unknown][] = [
      [base, '👍', 'u1'], [withOne, '👍', 'u1'], [withOne, '👍', 'u2'], [withOne, '🔥', 'u1'], [base, '', 'u1'],
      [base, 'я'.repeat(17), 'u1'], [base, '👍', ''], [base, 5, 'u1'], [base, '👍', null],
    ];
    for (const [el, emoji, user] of cases) {
      expect(cjs.toggleElementReaction(el, emoji, user), `${String(emoji)} ${String(user)}`)
        .toEqual(ts.toggleElementReaction(el, emoji as string, user as string));
    }
  });

  it('ветки: создание, ответ, закрытие', () => {
    const fixed = { id: 't1', messageId: 'm1', now: 1000 };
    const params = { x: 5, y: 6, targetElementId: 'a', authorId: 'u1', authorName: '  Маша   Иванова ', text: '  Привет  ' };
    const a = ts.createCommentThread(page(), { ...params, ...fixed });
    const b = cjs.createCommentThread(page(), { ...params, ...fixed });
    expect(b).toEqual(a);
    for (const bad of [{ ...params, text: '   ' }, { ...params, x: NaN }, { ...params, authorId: '' }, { ...params, targetElementId: 'нет' }, { ...params, text: 'я'.repeat(2500) }]) {
      expect(cjs.createCommentThread(page(), { ...bad, ...fixed })).toEqual(ts.createCommentThread(page(), { ...bad, ...fixed }));
    }
    const reply = { authorId: 'u2', authorName: 'Вова', text: ' ответ ' };
    expect(cjs.addCommentReply(a, 't1', reply, { id: 'm2', now: 2000 })).toEqual(ts.addCommentReply(a, 't1', reply, { id: 'm2', now: 2000 }));
    expect(cjs.addCommentReply(a, 'нет', reply)).toBe(a);
    expect(cjs.addCommentReply(a, 't1', { ...reply, text: '' })).toBe(a);
    const done = ts.resolveCommentThread(a, 't1', true);
    expect(cjs.resolveCommentThread(a, 't1', true)).toEqual(done);
    expect(cjs.resolveCommentThread(done, 't1', false)).toEqual(ts.resolveCommentThread(done, 't1', false));
    expect(cjs.resolveCommentThread(done, 't1', true)).toBe(done);
    expect(cjs.resolveCommentThread(a, 'нет', true)).toBe(a);
  });

  it('комментарии на холсте и перемещение привязанного комментария', () => {
    const params = { x: 5, y: 6, authorId: 'u1', authorName: 'Автор', text: 'Текст', id: 't1', messageId: 'm1', now: 1 };
    const free = ts.createCommentThread(page(), params);
    expect(free.comments?.[0]).not.toHaveProperty('targetElementId');
    expect(cjs.createCommentThread(page(), params)).toEqual(free);
    expect(cjs.moveCommentThread(free, 't1', 17, 18)).toEqual(ts.moveCommentThread(free, 't1', 17, 18));
    expect(cjs.deleteCommentThread(free, 't1')).toEqual(ts.deleteCommentThread(free, 't1'));
    const attached = ts.createCommentThread(page(), { ...params, targetElementId: 'a' });
    expect(cjs.moveCommentThread(attached, 't1', 4, 5, { x: 4, y: 5 }))
      .toEqual(ts.moveCommentThread(attached, 't1', 4, 5, { x: 4, y: 5 }));
  });

  it('идентификатор автора', () => {
    expect(cjs.cleanUserId('masha')).toBe('masha');
    expect(cjs.cleanUserId('  a\u0000b ')).toBe('ab');
    for (const bad of ['', '   ', 'x'.repeat(65), 5, null, undefined]) expect(cjs.cleanUserId(bad)).toBeNull();
  });
});
