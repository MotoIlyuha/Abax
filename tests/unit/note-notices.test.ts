// Уведомления о чужих комментариях и реакциях (SPEC_COMMENTS §6).
import { beforeEach, describe, expect, it } from 'vitest';
import { initNoteNotices, noticeComments, noticeReactions } from '../../src/note-notices';
import { NOTES_EVENT } from '../../src/collab';
import { clearNotices, notices } from '../../src/notify-center';
import { createCommentThread, addCommentReply } from '../../src/comments';
import { clientId, resetClientId } from '../../src/identity';
import { addElement, addPage, blankProject, openProject, state } from '../../src/state';
import type { ShapeEl } from '../../src/types';

const rect = (id: string, extra: Partial<ShapeEl> = {}): ShapeEl =>
  ({ id, type: 'shape', shape: 'rect', x: 0, y: 0, w: 10, h: 10, color: '#000', width: 1, text: 'Задача', ...extra });

beforeEach(() => {
  localStorage.clear();
  resetClientId();
  clearNotices();
  openProject(blankProject('Тест'));
  state.view = 'board';
  addElement(rect('a'));
});

describe('комментарии', () => {
  it('чужое сообщение - уведомление «Перейти» / «Посмотреть» со ссылкой на объект; своё - нет', () => {
    const p1 = createCommentThread(state.board, { x: 0, y: 0, targetElementId: 'a', authorId: 'u1', authorName: 'Маша', text: '  Почему\nтак? ', now: 5 });
    expect(noticeComments({ pageId: state.pageId, kind: 'comments', prev: undefined, next: p1.comments! })).toBe(1);
    const n = notices()[0];
    expect(n).toMatchObject({ kind: 'comment', title: 'Маша', emoji: '💬', ref: { pageId: state.pageId, elId: 'a' }, ts: 5 });
    expect(n.body).toBe('Фигура «Задача»: Почему так?');
    expect([n.action!.label, ...n.actions!.map(a => a.label)]).toEqual(['Перейти', 'Посмотреть']);
    const p2 = addCommentReply(p1, p1.comments![0].id, { authorId: clientId(), authorName: 'Я', text: 'ответ' });
    expect(noticeComments({ pageId: state.pageId, kind: 'comments', prev: p1.comments, next: p2.comments! })).toBe(0);
    expect(notices()).toHaveLength(1);
  });

  it('на другой странице - с её названием; через событие комнаты', () => {
    initNoteNotices();
    const first = state.pageId;
    const other = addPage()!;
    state.pageId = other.id;
    const page = state.project.pages.find(p => p.id === first)!;
    const next = createCommentThread(page, { x: 0, y: 0, targetElementId: 'a', authorId: 'u1', authorName: 'Маша', text: 'т' }).comments!;
    document.dispatchEvent(new CustomEvent(NOTES_EVENT, { detail: { pageId: first, kind: 'comments', prev: undefined, next } }));
    expect(notices()[0].body).toBe(`Фигура «Задача» на странице «${page.name}»: т`);
  });
});

describe('реакции', () => {
  it('новые чужие реакции - одно уведомление на участника и объект; свои и снятые - нет', () => {
    const before = [rect('a', { reactions: { '👍': ['u1'] } }), rect('b')];
    const after = [rect('a', { reactions: { '👍': ['u1', 'u2', clientId()], '🔥': ['u2'] } }), rect('b', { reactions: { '❤️': ['u3'] } })];
    expect(noticeReactions({ pageId: state.pageId, kind: 'elements', ids: ['a'], prev: before, next: after })).toBe(1);
    const n = notices()[0];
    expect(n).toMatchObject({ kind: 'comment', title: 'Участник', emoji: '👍', ref: { pageId: state.pageId, elId: 'a' } });
    expect(n.body).toBe('реакция 👍 🔥 · Фигура «Задача»');
    // элементы не из патча не смотрим
    expect(notices()).toHaveLength(1);
    expect(noticeReactions({ pageId: state.pageId, kind: 'elements', ids: ['a'], prev: after, next: before })).toBe(0);
  });
});
