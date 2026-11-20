// Реакции и комментарии: постановка и снятие реакций, нажатия на пины, поповер ветки.
import { beforeEach, describe, expect, it } from 'vitest';
import {
  addReaction, annotationClick, annotationsAvailable, closeThread, hasMyReaction, initCommentsUi, openThread, removeReaction,
  startComment, threadOpen, toggleReactionOn,
} from '../../src/comments-ui';
import { layoutPins } from '../../src/annotations';
import { recentReactions } from '../../src/annot-prefs';
import { clientId, resetClientId } from '../../src/identity';
import { createCommentThread } from '../../src/comments';
import { addElement, blankProject, canUndo, openProject, state, update } from '../../src/state';
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
  closeThread();
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

  it('«поставить» не снимает уже свою, «убрать» не ставит; можно несколько разных; недавние — свежая первой', () => {
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
    expect(annotationClick(110, 167)).toBe(false);
  });
});

describe('комментарии у автора без комнаты', () => {
  const pop = () => document.querySelector<HTMLElement>('.comment-pop');
  const typeIn = (text: string) => { const i = pop()!.querySelector('textarea')!; i.value = text; };

  it('новая ветка к выделенному элементу: пин у правого верхнего угла, подпись «Автор»', () => {
    startComment(state.board.elements[0]);
    expect(pop()!.querySelector('.cp-title')!.textContent).toBe('Новый комментарий');
    click(pop()!.querySelector('.cp-send')); // пустой текст — ничего
    expect(state.board.comments).toBeUndefined();
    typeIn('  Проверьте это  ');
    click(pop()!.querySelector('.cp-send'));
    expect(threadOpen()).toBe(false);
    const t = state.board.comments![0];
    expect(t).toMatchObject({ x: 200, y: 100, targetElementId: 'a' });
    expect(t.messages[0]).toMatchObject({ text: 'Проверьте это', authorName: 'Автор', authorId: mine() });
    expect(state.dirty).toBe(true);
    expect(canUndo()).toBe(true); // историю дали элементы, комментарий её не пополнил
  });

  it('пин открывает ветку: сообщения текстом, ответ, «Решено» и возврат; Esc закрывает', () => {
    state.board.comments = createCommentThread(state.board, { x: 50, y: 60, authorId: 'u1', authorName: '<b>Маша</b>', text: '<img src=x onerror=1>' }).comments;
    const pin = layoutPins(state.board.comments, state.board.elements, state.camera, 800, 600)[0];
    expect(annotationClick(pin.x, pin.y)).toBe(true);
    expect(pop()).not.toBeNull();
    expect(pop()!.querySelector('.cp-author')!.textContent).toBe('<b>Маша</b>');
    expect(pop()!.querySelector('.cp-text')!.textContent).toBe('<img src=x onerror=1>');
    expect(pop()!.querySelector('img, b')).toBeNull();
    typeIn('Отвечаю');
    click(pop()!.querySelector('.cp-send'));
    expect(state.board.comments![0].messages.map(m => m.text)).toEqual(['<img src=x onerror=1>', 'Отвечаю']);
    expect(pop()!.querySelectorAll('.cp-msg')).toHaveLength(2);
    expect(pop()!.querySelector('textarea')!.value).toBe('');
    click(pop()!.querySelector('.cp-resolve'));
    expect(state.board.comments![0].resolved).toBe(true);
    expect(pop()!.querySelector('.cp-resolve')!.textContent).toBe('Вернуть в обсуждение');
    click(pop()!.querySelector('.cp-resolve'));
    expect(state.board.comments![0].resolved).toBeUndefined();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(threadOpen()).toBe(false);
  });

  it('ветка пропала (страница сменилась) — поповер закрывается сам', () => {
    state.board.comments = createCommentThread(state.board, { x: 50, y: 60, authorId: 'u1', authorName: 'А', text: 'т' }).comments;
    openThread(state.board.comments![0].id);
    expect(threadOpen()).toBe(true);
    delete state.board.comments;
    update();
    expect(threadOpen()).toBe(false);
  });

  it('нажатие мимо поповера закрывает его', () => {
    state.board.comments = createCommentThread(state.board, { x: 50, y: 60, authorId: 'u1', authorName: 'А', text: 'т' }).comments;
    openThread(state.board.comments![0].id);
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(threadOpen()).toBe(false);
  });
});
