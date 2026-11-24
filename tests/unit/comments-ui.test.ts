// Реакции и комментарии: постановка и снятие реакций, открытие обсуждения.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addReaction, annotationsAvailable, closeThread, commentAt, deleteComment, moveComment, hasMyReaction, initCommentsUi, openDiscussion, openDiscussionId, openThread,
  removeReaction, startComment, threadOpen, toggleReactionOn,
} from '../../src/comments-ui';
import { recentReactions } from '../../src/annot-prefs';
import { clientId, resetClientId } from '../../src/identity';
import { createCommentThread, resolveCommentThread } from '../../src/comments';
import { addElement, blankProject, canUndo, deleteSelected, openProject, setSelection, state, update } from '../../src/state';
import type { ShapeEl } from '../../src/types';

const rect = (id: string, x = 100, y = 100): ShapeEl =>
  ({ id, type: 'shape', shape: 'rect', x, y, w: 100, h: 50, color: '#000000', width: 2 });
const click = (el: Element | null) => (el as HTMLElement).click();
const mine = () => clientId();
const reactions = (id: string) => state.board.elements.find(e => e.id === id)!.reactions;

let inited = false;
beforeEach(() => {
  document.body.innerHTML = '<div id="canvas-wrap"><div id="ctx-layer"></div></div>';
  localStorage.clear();
  resetClientId();
  openProject(blankProject('Тест'));
  state.collabRole = null;
  state.linkMode = null;
  state.view = 'board';
  state.camera = { x: 0, y: 0, zoom: 1 };
  addElement(rect('a'));
  addElement(rect('b', 400, 100));
  closeThread(true);
  if (!inited) { initCommentsUi(); inited = true; }
});

describe('реакции у автора без комнаты', () => {
  it('ставятся и снимаются мимо истории отмены', () => {
    const history = canUndo();
    toggleReactionOn('a', '👍');
    expect(reactions('a')).toEqual({ '👍': [mine()] });
    expect(canUndo()).toBe(history && true);
    toggleReactionOn('a', '👍');
    expect(reactions('a')).toBeUndefined();
  });

  it('«поставить» не снимает уже свою, «убрать» не ставит; можно несколько разных; недавние - свежая первой', () => {
    addReaction('a', '🔥');
    addReaction('a', '🔥');
    expect(reactions('a')).toEqual({ '🔥': [mine()] });
    addReaction('a', '🦄');
    expect(reactions('a')).toEqual({ '🔥': [mine()], '🦄': [mine()] });
    expect(hasMyReaction('a', '🦄')).toBe(true);
    expect(recentReactions().slice(0, 2)).toEqual(['🦄', '🔥']);
    removeReaction('a', '🔥');
    removeReaction('a', '🔥');
    expect(reactions('a')).toEqual({ '🦄': [mine()] });
    // картинка из окна смайлов реакцией не бывает
    addReaction('a', 'data:image/png;base64,AAAA');
    expect(Object.keys(reactions('a')!)).toEqual(['🦄']);
  });

  it('по ссылке просмотра и на черновике их нет вовсе', () => {
    state.linkMode = 'view-project';
    expect(annotationsAvailable()).toBe(false);
    toggleReactionOn('a', '👍');
    expect(reactions('a')).toBeUndefined();
  });
});

describe('обсуждение объекта у автора без комнаты', () => {
  const pop = () => document.querySelector<HTMLElement>('.comment-pop');
  const send = (text: string) => {
    const i = pop()!.querySelector('textarea')!;
    i.value = text;
    i.dispatchEvent(new Event('input'));
    i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  };

  it('создаёт, перемещает и удаляет ветку на холсте', () => {
    commentAt({ x: 80, y: 120 }, null);
    send('Обсудить');
    const thread = state.board.comments![0];
    expect(thread).toMatchObject({ x: 80, y: 120, messages: [{ text: 'Обсудить' }] });
    expect(thread).not.toHaveProperty('targetElementId');
    expect(threadOpen()).toBe(false);

    moveComment(thread.id, { x: 140, y: 170 });
    expect(state.board.comments![0]).toEqual({ ...thread, x: 140, y: 170 });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    try {
      deleteComment(thread.id);
      expect(state.board.comments).toHaveLength(1);
      deleteComment(thread.id);
      expect(state.board.comments).toHaveLength(0);
    } finally { confirm.mockRestore(); }
  });

  it('запрашивает подтверждение только для объектов с нерешённой веткой', () => {
    commentAt({ x: 110, y: 110 }, state.board.elements[0]);
    send('Проверить');
    const thread = state.board.comments![0];
    expect(thread).toMatchObject({ targetElementId: 'a', offset: { x: 10, y: 10 } });
    setSelection(['a']);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    try {
      expect(deleteSelected()).toBe(false);
      expect(state.selection.has('a')).toBe(true);
      expect(confirm).toHaveBeenCalledTimes(1);
      state.board.comments = resolveCommentThread(state.board, thread.id).comments;
      expect(deleteSelected()).toBe(true);
      expect(confirm).toHaveBeenCalledTimes(1);
      expect(state.board.comments![0].id).toBe(thread.id);
    } finally { confirm.mockRestore(); }
  });

  it('новое обсуждение: «Новый комментарий», первое сообщение - новая ветка у объекта; панель остаётся открытой', () => {
    startComment(state.board.elements[0]);
    expect(pop()!.querySelector('.cp-title')!.textContent).toBe('Новый комментарий');
    expect(pop()!.querySelector('.cp-sub')!.textContent).toBe('Фигура');
    expect(pop()!.querySelector<HTMLElement>('.cp-resolve')!.hidden).toBe(true);
    send('   '); // пустой текст — ничего
    expect(state.board.comments).toBeUndefined();
    send('  Проверьте это  ');
    expect(threadOpen()).toBe(true);
    const t = state.board.comments![0];
    expect(t).toMatchObject({ x: 200, y: 100, targetElementId: 'a' });
    expect(t.messages[0]).toMatchObject({ text: 'Проверьте это', authorName: 'Автор', authorId: mine() });
    expect(state.dirty).toBe(true);
    expect(canUndo()).toBe(true); // историю дали элементы, комментарий её не пополнил
    expect(pop()!.querySelector('.cp-title')!.textContent).toBe('Комментарии · 1');
    expect(pop()!.querySelector('.cp-msg.mine .cp-text')!.textContent).toBe('Проверьте это');
    // второе сообщение — ответ в ту же ветку
    send('И ещё');
    expect(state.board.comments).toHaveLength(1);
    expect(state.board.comments![0].messages.map(m => m.text)).toEqual(['Проверьте это', 'И ещё']);
    expect(pop()!.querySelectorAll('.cp-msg.grouped')).toHaveLength(1);
  });

  it('чужие сообщения - текстом, слева с именем; «Решено» закрывает все ветки, новое сообщение - новая ветка', () => {
    let page = createCommentThread(state.board, { x: 0, y: 0, targetElementId: 'a', authorId: 'u1', authorName: '<b>Маша</b>', text: '<img src=x onerror=1>' });
    page = createCommentThread(page, { x: 0, y: 0, targetElementId: 'a', authorId: 'u2', authorName: 'Вова', text: 'второй' });
    state.board.comments = page.comments;
    openDiscussion('a');
    expect(pop()!.querySelector('.cp-author')!.textContent).toBe('<b>Маша</b>');
    expect(pop()!.querySelector('.cp-text')!.textContent).toBe('<img src=x onerror=1>');
    expect(pop()!.querySelector('.cp-list img, .cp-list b')).toBeNull();
    expect(pop()!.querySelectorAll('.cp-msg:not(.mine)')).toHaveLength(2);
    click(pop()!.querySelector('.cp-resolve'));
    expect(state.board.comments!.every(t => t.resolved)).toBe(true);
    expect(pop()!.classList.contains('resolved')).toBe(true);
    expect(pop()!.querySelector('.cp-banner')!.textContent).toContain('Обсуждение решено');
    send('Снова вопрос');
    expect(state.board.comments).toHaveLength(3);
    expect(state.board.comments![2]).toMatchObject({ targetElementId: 'a' });
    expect(state.board.comments![2].resolved).toBeUndefined();
    expect(pop()!.classList.contains('resolved')).toBe(false);
  });

  it('сохранённую ветку без объекта можно открыть из списка и ответить; Esc закрывает', () => {
    state.board.comments = [{
      id: 'legacy', x: 50, y: 60,
      messages: [{ id: 'legacy-msg', authorId: 'u1', authorName: 'А', text: 'т', createdAt: 1 }],
    }];
    openThread('legacy');
    expect(pop()!.querySelector('.cp-sub')!.textContent).toBe('Комментарий на доске');
    send('Отвечаю');
    expect(state.board.comments![0].messages.map(m => m.text)).toEqual(['т', 'Отвечаю']);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(threadOpen()).toBe(false);
    openDiscussion('a');
    expect(openDiscussionId()).toBe('a');
    openDiscussion('a');
    expect(threadOpen()).toBe(false);
  });

  it('объект удалён - панель закрывается сама', () => {
    openDiscussion('b');
    expect(threadOpen()).toBe(true);
    state.board.elements = state.board.elements.filter(e => e.id !== 'b');
    update();
    expect(threadOpen()).toBe(false);
  });

  it('нажатие мимо панели закрывает её', () => {
    openDiscussion('a');
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(threadOpen()).toBe(false);
  });

  it('читатель видит ленту, но не пишет', async () => {
    state.board.comments = createCommentThread(state.board, { x: 0, y: 0, targetElementId: 'a', authorId: 'u1', authorName: 'А', text: 'т' }).comments;
    const collab = await import('../../src/collab');
    const spy = vi.spyOn(collab, 'myCollabCaps').mockReturnValue({ comment: false, chat: false, pointer: false, copy: true, summon: false });
    openDiscussion('a');
    expect(pop()!.querySelector('textarea')).toBeNull();
    expect(pop()!.querySelector('.cp-readonly')!.textContent).toBe('Читатели не пишут комментарии');
    expect(pop()!.querySelector<HTMLElement>('.cp-resolve')!.hidden).toBe(true);
    spy.mockRestore();
  });
});
