import { beforeEach, describe, expect, it } from 'vitest';
import {
  FRAME_PAD, ITEM_GAP, MAX_SHOWN, MORE_W, PIN_R, REACT_BTN_W, ROW_GAP, commentWidth, hitPin, layoutAnnotRows, layoutPins, pillWidth,
  shownReactions,
} from '../../src/annotations';
import { clientId, resetClientId } from '../../src/identity';
import type { CommentThread, ShapeEl } from '../../src/types';

const rect = (id: string, x: number, y: number, extra: Partial<ShapeEl> = {}): ShapeEl =>
  ({ id, type: 'shape', shape: 'rect', x, y, w: 100, h: 50, color: '#000000', width: 2, ...extra });
const cam = { x: 0, y: 0, zoom: 1 };
const all = { toolsFor: null, showReactions: true, showComments: true };
const t = (id: string, x: number, y: number, extra: Partial<CommentThread> = {}): CommentThread =>
  ({ id, x, y, messages: [{ id: `m-${id}`, authorId: 'u', authorName: 'А', text: 'т', createdAt: 1 }], ...extra });

describe('строка объекта', () => {
  it('под правым нижним углом рамки; объекты без реакций, комментариев и кнопок пропускаются', () => {
    const el = rect('a', 40, 30, { reactions: { '👍': ['u1', 'u2'], '🔥': ['me'] } });
    const rows = layoutAnnotRows([el, rect('b', 0, 0)], undefined, cam, 800, 600, all);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ elId: 'a', right: 140 + FRAME_PAD, top: 80 + FRAME_PAD + ROW_GAP, shown: 2, comments: 0, tools: false });
    expect(rows[0].reactions).toEqual([['👍', ['u1', 'u2']], ['🔥', ['me']]]);
  });

  it('камера и масштаб учитываются; строка за экраном пропускается; пустые списки не реакции', () => {
    const el = rect('a', 100, 100, { reactions: { '👍': ['u'] } });
    expect(layoutAnnotRows([el], undefined, { x: 50, y: 50, zoom: 2 }, 800, 600, all)[0]).toMatchObject({ right: 300 + FRAME_PAD, top: 200 + FRAME_PAD + ROW_GAP });
    expect(layoutAnnotRows([el], undefined, { x: 5000, y: 0, zoom: 1 }, 800, 600, all)).toEqual([]);
    expect(layoutAnnotRows([rect('e', 0, 0, { reactions: { '👍': [] } })], undefined, cam, 800, 600, all)).toEqual([]);
  });

  it('счётчик комментариев — сообщения всех веток объекта; решено — когда решены все', () => {
    const comments = [t('t1', 0, 0, { targetElementId: 'a', resolved: true }), t('t2', 0, 0, { targetElementId: 'a', resolved: true }), t('t3', 0, 0)];
    expect(layoutAnnotRows([rect('a', 0, 0)], comments, cam, 800, 600, all)[0]).toMatchObject({ comments: 2, resolved: true });
    expect(layoutAnnotRows([rect('a', 0, 0)], comments, cam, 800, 600, { ...all, showComments: false })).toEqual([]);
  });

  it('кнопки — только у объекта toolsFor, и даже без реакций и комментариев', () => {
    const rows = layoutAnnotRows([rect('a', 0, 0), rect('b', 200, 0)], undefined, cam, 800, 600, { ...all, toolsFor: 'b' });
    expect(rows.map(r => [r.elId, r.tools])).toEqual([['b', true]]);
  });

  it('«Показывать реакции» выключено — пилюль нет', () => {
    const el = rect('a', 0, 0, { reactions: { '👍': ['u'] } });
    expect(layoutAnnotRows([el], undefined, cam, 800, 600, { ...all, showReactions: false })).toEqual([]);
  });
});

describe('сколько реакций видно', () => {
  it('до трёх; остальные — «+n»; минимум одна', () => {
    expect(shownReactions([], 500, 0)).toBe(0);
    expect(shownReactions([1, 1], 500, 0)).toBe(2);
    expect(shownReactions([1, 1, 1, 1, 1], 1000, 0)).toBe(MAX_SHOWN);
    expect(shownReactions([1, 1, 1], 10, 0)).toBe(1);
  });

  it('по ширине объекта вместе с кнопками и «+n»', () => {
    const p = pillWidth(1) + ITEM_GAP;
    const tools = REACT_BTN_W + ITEM_GAP + commentWidth(0);
    // ровно две пилюли и «+n» с кнопками
    expect(shownReactions([1, 1, 1, 1], 2 * p + MORE_W + ITEM_GAP + tools, tools)).toBe(2);
    expect(shownReactions([1, 1, 1, 1], 2 * p + MORE_W + ITEM_GAP + tools - 1, tools)).toBe(1);
    // все три влезают без «+n»
    expect(shownReactions([1, 1, 1], 3 * p, 0)).toBe(3);
    // у широкого объекта — три, узкий — одна
    const wide = layoutAnnotRows([rect('a', 0, 0, { w: 600, reactions: { a: ['u'], b: ['u'], c: ['u'], d: ['u'] } })], undefined, cam, 800, 600, all)[0];
    const narrow = layoutAnnotRows([rect('a', 0, 0, { w: 20, reactions: { a: ['u'], b: ['u'], c: ['u'], d: ['u'] } })], undefined, cam, 800, 600, all)[0];
    expect([wide.shown, narrow.shown]).toEqual([3, 1]);
  });
});

describe('пины веток без объекта', () => {
  it('в точках ветки, с числом сообщений и признаком «решено»; ветки при объекте — не пины', () => {
    const list = [t('t1', 100, 50), t('t2', 10, 10, { resolved: true }), t('t3', 0, 0, { targetElementId: 'a' }), t('t4', 30, 30, { targetElementId: 'gone' })];
    const pins = layoutPins(list, [rect('a', 0, 0)], { x: 5, y: 5, zoom: 2 }, 800, 600);
    expect(pins).toEqual([
      { x: 190, y: 90, r: PIN_R, threadId: 't1', count: 1, resolved: false },
      { x: 10, y: 10, r: PIN_R, threadId: 't2', count: 1, resolved: true },
      { x: 50, y: 50, r: PIN_R, threadId: 't4', count: 1, resolved: false },
    ]);
    expect(layoutPins(undefined, [], cam, 800, 600)).toEqual([]);
    expect(layoutPins([t('far', 9000, 9000)], [], cam, 800, 600)).toEqual([]);
  });

  it('нажатие по пину', () => {
    const pins = layoutPins([t('x', 60, 90)], [], cam, 800, 600);
    expect(hitPin(pins, 62, 92)?.threadId).toBe('x');
    expect(hitPin(pins, 5, 5)).toBeNull();
  });
});

describe('идентификатор клиента', () => {
  beforeEach(() => { localStorage.clear(); resetClientId(); history.replaceState(null, '', '/'); });

  it('создаётся один раз и запоминается', () => {
    const a = clientId();
    expect(a.length).toBeGreaterThan(8);
    expect(localStorage.getItem('doska.clientId')).toBe(a);
    resetClientId();
    expect(clientId()).toBe(a);
  });

  it('у тестового окна гостя (?name=…) — с суффиксом, чтобы не слиться с автором', () => {
    const base = clientId();
    resetClientId();
    history.replaceState(null, '', '/?name=Маша');
    expect(clientId()).toBe(`${base}:Маша`);
    resetClientId();
    history.replaceState(null, '', `/?name=${'я'.repeat(50)}`);
    expect(clientId()).toBe(`${base}:${'я'.repeat(20)}`);
  });
});
