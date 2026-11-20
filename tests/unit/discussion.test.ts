// Обсуждение объекта и разница реакций/комментариев (SPEC_COMMENTS §3, §6).
import { describe, expect, it } from 'vitest';
import {
  addedComments, addedReactions, detachedThreads, discussionMessages, discussionResolved, elementCommentCount, elementLabel,
  elementThreads, replyThread,
} from '../../src/discussion';
import type { CommentThread, Element, ShapeEl } from '../../src/types';

const rect = (id: string, extra: Partial<ShapeEl> = {}): ShapeEl =>
  ({ id, type: 'shape', shape: 'rect', x: 0, y: 0, w: 10, h: 10, color: '#000', width: 1, ...extra });
const msg = (id: string, at: number, text = id) => ({ id, authorId: 'u1', authorName: 'Аня', text, createdAt: at });
const thread = (id: string, target: string | undefined, msgs: ReturnType<typeof msg>[], resolved = false): CommentThread =>
  ({ id, x: 0, y: 0, ...(target ? { targetElementId: target } : {}), messages: msgs, ...(resolved ? { resolved: true } : {}) });

describe('обсуждение объекта', () => {
  const comments = [
    thread('t1', 'a', [msg('m1', 10), msg('m3', 30)], true),
    thread('t2', 'a', [msg('m2', 20)]),
    thread('t3', 'b', [msg('m4', 5)]),
    thread('t4', undefined, [msg('m5', 1)]),
  ];

  it('ветки, сообщения по времени и счётчик', () => {
    expect(elementThreads(comments, 'a').map(t => t.id)).toEqual(['t1', 't2']);
    expect(discussionMessages(elementThreads(comments, 'a')).map(m => [m.id, m.threadId, m.resolved])).toEqual([
      ['m1', 't1', true], ['m2', 't2', false], ['m3', 't1', true],
    ]);
    expect(elementCommentCount(comments, 'a')).toBe(3);
    expect(elementCommentCount(comments, 'нет')).toBe(0);
    expect(elementCommentCount(undefined, 'a')).toBe(0);
  });

  it('ответ — в открытую ветку со свежим сообщением; все решены — новая ветка', () => {
    expect(replyThread(elementThreads(comments, 'a'))?.id).toBe('t2');
    expect(replyThread([thread('x', 'a', [msg('q', 1)], true)])).toBeNull();
    expect(replyThread([thread('x', 'a', [msg('q', 1)]), thread('y', 'a', [msg('w', 9)])])?.id).toBe('y');
    expect(discussionResolved([thread('x', 'a', [], true)])).toBe(true);
    expect(discussionResolved(elementThreads(comments, 'a'))).toBe(false);
    expect(discussionResolved([])).toBe(false);
  });

  it('пины — ветки без объекта или с удалённым объектом', () => {
    expect(detachedThreads(comments, [rect('a')]).map(t => t.id)).toEqual(['t3', 't4']);
    expect(detachedThreads(undefined, [])).toEqual([]);
  });
});

describe('разница для уведомлений', () => {
  it('новые реакции: у кого и какая; снятые и прежние не в счёт', () => {
    const before: Element = rect('a', { reactions: { '👍': ['u1'], '🔥': ['u2'] } } as Partial<ShapeEl>);
    const after: Element = rect('a', { reactions: { '👍': ['u1', 'u3'], '❤️': ['u2'] } } as Partial<ShapeEl>);
    expect(addedReactions(before, after)).toEqual([{ emoji: '👍', userId: 'u3' }, { emoji: '❤️', userId: 'u2' }]);
    expect(addedReactions(after, before)).toEqual([{ emoji: '🔥', userId: 'u2' }]);
    expect(addedReactions(undefined, after)).toHaveLength(3);
    expect(addedReactions(after, rect('a'))).toEqual([]);
    // ключи прототипа у прежнего элемента не мешают
    expect(addedReactions(rect('a'), rect('a', { reactions: { constructor: ['u1'] } } as Partial<ShapeEl>))).toEqual([{ emoji: 'constructor', userId: 'u1' }]);
  });

  it('новые сообщения: новая ветка и ответ', () => {
    const prev = [thread('t1', 'a', [msg('m1', 1)])];
    const next = [thread('t1', 'a', [msg('m1', 1), msg('m2', 2)]), thread('t2', 'b', [msg('m3', 3)])];
    expect(addedComments(prev, next).map(c => [c.message.id, c.thread.id, c.isNewThread])).toEqual([['m2', 't1', false], ['m3', 't2', true]]);
    expect(addedComments(next, prev)).toEqual([]);
    expect(addedComments(undefined, undefined)).toEqual([]);
  });
});

describe('подпись объекта', () => {
  it('тип и короткий текст', () => {
    expect(elementLabel(rect('a'))).toBe('Фигура');
    expect(elementLabel(rect('a', { text: '  Привет,\n мир ' }))).toBe('Фигура «Привет, мир»');
    expect(elementLabel({ id: 't', type: 'text', x: 0, y: 0, text: 'я'.repeat(40), color: '#000', size: 16 } as unknown as Element, 10)).toBe(`Текст «${'я'.repeat(9)}…»`);
    expect(elementLabel(undefined)).toBe('Объект');
  });
});
