import { beforeEach, describe, expect, it } from 'vitest';
import {
  addCommentReply, createCommentThread, resolveCommentThread, syncCommentsWithMovedElements, toggleElementReaction,
} from '../../src/comments';
import { parseProject, sanitizeComments, sanitizeElement } from '../../src/file';
import { addElement, blankProject, openProject, replaceElements, state, undo, redo, pushHistory } from '../../src/state';
import { translateElement } from '../../src/geom';
import type { Page, ShapeEl } from '../../src/types';

const rect = (id: string, x = 0, y = 0, w = 10, h = 10): ShapeEl =>
  ({ id, type: 'shape', shape: 'rect', x, y, w, h, color: '#000000', width: 2 });
const page = (els: ShapeEl[] = [rect('a', 100, 50)]): Page => ({ id: 'pg', name: 'Стр', grid: 'square', elements: els });
const author = { authorId: 'u1', authorName: 'Анна' };

describe('реакции', () => {
  it('ставит и снимает; пустое не остаётся', () => {
    const a = rect('a');
    const on = toggleElementReaction(a, '👍', 'u1');
    expect(on.reactions).toEqual({ '👍': ['u1'] });
    expect(a).not.toHaveProperty('reactions'); // исходный элемент не менялся
    const two = toggleElementReaction(on, '👍', 'u2');
    expect(two.reactions).toEqual({ '👍': ['u1', 'u2'] });
    const one = toggleElementReaction(two, '👍', 'u1');
    expect(one.reactions).toEqual({ '👍': ['u2'] });
    const off = toggleElementReaction(one, '👍', 'u2');
    expect(off).not.toHaveProperty('reactions');
    expect(off).toEqual(a);
  });

  it('разные эмодзи независимы; остальные поля сохраняются', () => {
    let el: ShapeEl = rect('a', 3, 4);
    el = toggleElementReaction(el, '👍', 'u1') as ShapeEl;
    el = toggleElementReaction(el, '❤️', 'u1') as ShapeEl;
    expect(Object.keys(el.reactions!)).toEqual(['👍', '❤️']);
    el = toggleElementReaction(el, '👍', 'u1') as ShapeEl;
    expect(el.reactions).toEqual({ '❤️': ['u1'] });
    expect(el).toMatchObject({ x: 3, y: 4 });
  });

  it('пустое или слишком длинное эмодзи и пустой пользователь игнорируются', () => {
    const a = rect('a');
    expect(toggleElementReaction(a, '', 'u1')).toBe(a);
    expect(toggleElementReaction(a, 'x'.repeat(17), 'u1')).toBe(a);
    expect(toggleElementReaction(a, '👍', '')).toBe(a);
  });
});

describe('ветки комментариев', () => {
  it('создание ветки с привязкой к элементу', () => {
    const p = createCommentThread(page(), { x: 5, y: 6, targetElementId: 'a', ...author, text: '  Почему так?  ', id: 't1', messageId: 'm1', now: 1000 });
    expect(p.comments).toEqual([{
      id: 't1', x: 5, y: 6, targetElementId: 'a',
      messages: [{ id: 'm1', authorId: 'u1', authorName: 'Анна', text: 'Почему так?', createdAt: 1000 }],
    }]);
  });

  it('привязка к отсутствующему элементу отбрасывается; без привязки — свободная ветка', () => {
    const p = createCommentThread(page(), { x: 1, y: 2, targetElementId: 'нет', ...author, text: 'Привет' });
    expect(p.comments![0]).not.toHaveProperty('targetElementId');
    expect(p.comments![0].id).toBeTruthy();
  });

  it('пустой текст и неверные координаты отклоняются', () => {
    const base = page();
    expect(createCommentThread(base, { x: 1, y: 1, ...author, text: '   ' })).toBe(base);
    expect(createCommentThread(base, { x: NaN, y: 1, ...author, text: 'а' })).toBe(base);
    expect(createCommentThread(base, { x: 1, y: 1, authorId: '', authorName: '', text: 'а' })).toBe(base);
  });

  it('длинный текст обрезается до 2000', () => {
    const p = createCommentThread(page(), { x: 1, y: 1, ...author, text: 'я'.repeat(5000) });
    expect(p.comments![0].messages[0].text).toHaveLength(2000);
  });

  it('ответ добавляется в конец; неизвестная ветка и пустой ответ отклоняются', () => {
    const p1 = createCommentThread(page(), { x: 1, y: 1, ...author, text: 'Вопрос', id: 't1', now: 1 });
    const p2 = addCommentReply(p1, 't1', { authorId: 'u2', authorName: 'Борис', text: 'Ответ' }, { now: 2, id: 'm2' });
    expect(p2.comments![0].messages.map(m => [m.authorId, m.text, m.createdAt])).toEqual([['u1', 'Вопрос', 1], ['u2', 'Ответ', 2]]);
    expect(p1.comments![0].messages).toHaveLength(1); // иммутабельно
    expect(addCommentReply(p1, 'нет', { authorId: 'u2', authorName: '', text: 'x' })).toBe(p1);
    expect(addCommentReply(p1, 't1', { authorId: 'u2', authorName: '', text: ' ' })).toBe(p1);
  });

  it('закрытие и возврат в обсуждение', () => {
    const p1 = createCommentThread(page(), { x: 1, y: 1, ...author, text: 'в', id: 't1' });
    const closed = resolveCommentThread(p1, 't1');
    expect(closed.comments![0].resolved).toBe(true);
    expect(resolveCommentThread(closed, 't1')).toBe(closed); // уже закрыта
    const reopened = resolveCommentThread(closed, 't1', false);
    expect(reopened.comments![0]).not.toHaveProperty('resolved');
    expect(resolveCommentThread(p1, 'нет')).toBe(p1);
    expect(resolveCommentThread(p1, 't1', false)).toBe(p1);
  });
});

describe('syncCommentsWithMovedElements', () => {
  const withThread = (targetElementId?: string) => createCommentThread(page(), { x: 110, y: 40, targetElementId, ...author, text: 'к', id: 't1' });

  it('привязанная ветка сдвигается на (dx, dy) элемента', () => {
    const p = withThread('a');
    const next = [translateElement(p.elements[0], 30, -20)];
    const out = syncCommentsWithMovedElements(p, p.elements, next);
    expect(out.comments![0]).toMatchObject({ x: 140, y: 20 });
    expect(p.comments![0]).toMatchObject({ x: 110, y: 40 }); // исходная страница не менялась
  });

  it('свободная ветка и неподвижный элемент — без изменений', () => {
    const free = withThread();
    expect(syncCommentsWithMovedElements(free, free.elements, [translateElement(free.elements[0], 5, 5)])).toBe(free);
    const p = withThread('a');
    expect(syncCommentsWithMovedElements(p, p.elements, [{ ...p.elements[0] }])).toBe(p); // тот же объект по значению
    expect(syncCommentsWithMovedElements(p, p.elements, p.elements)).toBe(p);
  });

  it('удалённый элемент ветку не двигает и не удаляет', () => {
    const p = withThread('a');
    const out = syncCommentsWithMovedElements(p, p.elements, []);
    expect(out).toBe(p);
    expect(out.comments![0].targetElementId).toBe('a');
  });

  it('двигаются только ветки своего элемента', () => {
    let p = page([rect('a', 0, 0), rect('b', 200, 200)]);
    p = createCommentThread(p, { x: 1, y: 1, targetElementId: 'a', ...author, text: '1', id: 'ta' });
    p = createCommentThread(p, { x: 201, y: 201, targetElementId: 'b', ...author, text: '2', id: 'tb' });
    const next = [p.elements[0], translateElement(p.elements[1], 10, 0)];
    const out = syncCommentsWithMovedElements(p, p.elements, next);
    expect(out.comments!.map(t => [t.x, t.y])).toEqual([[1, 1], [211, 201]]);
  });
});

describe('сохранение (file.ts)', () => {
  it('реакции и комментарии переживают сохранение и загрузку', () => {
    let pg = page();
    pg = { ...pg, elements: [toggleElementReaction(pg.elements[0], '👍', 'u1') as ShapeEl] };
    pg = createCommentThread(pg, { x: 1, y: 2, targetElementId: 'a', ...author, text: 'Смотри', id: 't1', messageId: 'm1', now: 5 });
    pg = resolveCommentThread(pg, 't1');
    const project = { ...blankProject('П'), pages: [pg] };
    const back = parseProject(JSON.parse(JSON.stringify(project)))!;
    expect(back.pages[0].comments).toEqual(pg.comments);
    expect(back.pages[0].elements[0].reactions).toEqual({ '👍': ['u1'] });
  });

  it('испорченное чистится: пустые реакции, ветки без сообщений, чужие типы', () => {
    expect(sanitizeElement({ ...rect('a'), reactions: { '👍': [], '❤️': ['u1', 5, 'u1'], [' '.repeat(40)]: ['u'], x: 'нет' } })!.reactions).toEqual({ '❤️': ['u1'] });
    expect(sanitizeElement({ ...rect('a'), reactions: 5 })).not.toHaveProperty('reactions');
    const good = { id: 't', x: 1, y: 2, messages: [{ id: 'm', authorId: 'u', authorName: 'А', text: 'да', createdAt: 1 }] };
    expect(sanitizeComments([
      good,
      { ...good, id: 'empty', messages: [] },
      { ...good, id: 'bad', messages: [{ id: 'm', text: 5 }] },
      { ...good, id: 'nan', x: NaN },
      'мусор',
    ]).map(t => t.id)).toEqual(['t']);
    expect(sanitizeComments('нет')).toEqual([]);
    const p = parseProject({ id: 'p', pages: [{ id: 'g', elements: [], comments: 'нет' }] })!;
    expect(p.pages[0]).not.toHaveProperty('comments');
  });
});

describe('привязка к состоянию доски', () => {
  beforeEach(() => {
    openProject(blankProject('Тест'));
    addElement(rect('a', 0, 0));
    state.board.comments = createCommentThread(state.board, { x: 10, y: 10, targetElementId: 'a', ...author, text: 'к', id: 't1' }).comments;
  });

  it('перемещение элемента через replaceElements двигает комментарий, а undo/redo возвращают', () => {
    const before = state.board.elements;
    pushHistory(before);
    replaceElements(before.map(e => translateElement(e, 40, 25)));
    expect(state.board.comments![0]).toMatchObject({ x: 50, y: 35 });
    undo();
    expect(state.board.comments![0]).toMatchObject({ x: 10, y: 10 });
    redo();
    expect(state.board.comments![0]).toMatchObject({ x: 50, y: 35 });
  });

  it('страницы без комментариев не страдают', () => {
    delete state.board.comments;
    replaceElements(state.board.elements.map(e => translateElement(e, 1, 1)));
    expect(state.board).not.toHaveProperty('comments');
  });
});
