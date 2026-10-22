import { beforeEach, describe, expect, it } from 'vitest';
import { CLIP_MIME, COPY_STEP_PX, copySelection, pasteFromMemory, pasteFromSystem } from '../../src/clipboard';
import {
  addElement, addPage, blankProject, canUndo, duplicateSelected, insertCopies, openProject, setSelection, state,
  switchPage, undo,
} from '../../src/state';
import type { AABB } from '../../src/geom';
import type { ShapeEl, StrokeEl } from '../../src/types';

const rect = (id: string, o: Partial<ShapeEl> = {}): ShapeEl =>
  ({ id, type: 'shape', shape: 'rect', x: 0, y: 0, w: 10, h: 10, color: '#000000', width: 2, ...o });
const stroke = (id: string): StrokeEl =>
  ({ id, type: 'stroke', tool: 'pen', color: '#000000', width: 2, pts: [{ x: 0, y: 0, p: 0.5 }, { x: 10, y: 5, p: 0.5 }] });

/** DataTransfer в jsdom нет: хватает setData/getData. */
function fakeData(init: Record<string, string> = {}): DataTransfer {
  const store = { ...init };
  return {
    setData: (t: string, v: string) => { store[t] = v; },
    getData: (t: string) => store[t] ?? '',
  } as unknown as DataTransfer;
}

const VIEW: AABB = { x0: -500, y0: -500, x1: 500, y1: 500 };
const STEP = COPY_STEP_PX;
const byId = (id: string) => state.board.elements.find(e => e.id === id)!;

beforeEach(() => {
  openProject(blankProject('Тест'));
  state.camera = { x: 0, y: 0, zoom: 1 };
});

describe('insertCopies / duplicateSelected', () => {
  it('копии получают новые id, сдвиг и выделение; оригинал не меняется', () => {
    addElement(rect('a', { x: 5, y: 7 }));
    addElement(stroke('s'));
    setSelection(['a', 's']);
    duplicateSelected(10, 20);
    const els = state.board.elements;
    expect(els).toHaveLength(4);
    const [ca, cs] = els.slice(2);
    expect(ca.id).not.toBe('a');
    expect(ca).toMatchObject({ type: 'shape', x: 15, y: 27 });
    expect((cs as StrokeEl).pts[1]).toMatchObject({ x: 20, y: 25 });
    expect(byId('a')).toMatchObject({ x: 5, y: 7 });
    expect([...state.selection]).toEqual([ca.id, cs.id]);
  });

  it('группа в копии сохраняется, но под новым groupId', () => {
    addElement(rect('a', { groupId: 'g' }));
    addElement(rect('b', { groupId: 'g' }));
    addElement(rect('c'));
    const copies = insertCopies(state.board.elements, 0, 0);
    expect(copies[0].groupId).toBeTruthy();
    expect(copies[0].groupId).not.toBe('g');
    expect(copies[1].groupId).toBe(copies[0].groupId);
    expect(copies[2].groupId).toBeUndefined();
  });

  it('копия независима от оригинала (глубокая) и отменяется одним шагом', () => {
    addElement(stroke('s'));
    const [copy] = insertCopies([byId('s')], 0, 0) as StrokeEl[];
    expect(copy.pts).not.toBe((byId('s') as StrokeEl).pts);
    undo();
    expect(state.board.elements.map(e => e.id)).toEqual(['s']);
  });

  it('пустой набор ничего не делает', () => {
    expect(insertCopies([], 1, 1)).toEqual([]);
    expect(canUndo()).toBe(false);
  });
});

describe('буфер обмена', () => {
  it('без выделения копировать нечего', () => {
    addElement(rect('a'));
    const data = fakeData();
    expect(copySelection(data)).toBe(false);
    expect(data.getData(CLIP_MIME)).toBe('');
  });

  it('копирование кладёт элементы в системный буфер, вставка — лесенкой', () => {
    addElement(rect('a', { x: 100, y: 100 }));
    setSelection(['a']);
    const data = fakeData();
    expect(copySelection(data)).toBe(true);
    expect(JSON.parse(data.getData(CLIP_MIME)).elements).toHaveLength(1);
    expect(pasteFromSystem(data, VIEW)).toBe(true);
    expect(pasteFromSystem(data, VIEW)).toBe(true);
    const [, p1, p2] = state.board.elements;
    expect(p1).toMatchObject({ x: 100 + STEP, y: 100 + STEP });
    expect(p2).toMatchObject({ x: 100 + 2 * STEP, y: 100 + 2 * STEP });
    expect([...state.selection]).toEqual([p2.id]);
  });

  it('шаг сдвига — в пикселях экрана', () => {
    addElement(rect('a', { x: 100, y: 100 }));
    setSelection(['a']);
    copySelection();
    state.camera = { x: 0, y: 0, zoom: 2 };
    pasteFromMemory(VIEW);
    expect(state.board.elements[1]).toMatchObject({ x: 100 + STEP / 2, y: 100 + STEP / 2 });
  });

  it('вырезание удаляет оригинал, первая вставка — на его место', () => {
    addElement(rect('a', { x: 100, y: 100 }));
    setSelection(['a']);
    const data = fakeData();
    copySelection(data, true);
    expect(state.board.elements).toHaveLength(0);
    pasteFromSystem(data, VIEW);
    pasteFromSystem(data, VIEW);
    expect(state.board.elements.map(e => (e as ShapeEl).x)).toEqual([100, 100 + STEP]);
  });

  it('на другой странице первая вставка — на то же место', () => {
    addElement(rect('a', { x: 100, y: 100 }));
    setSelection(['a']);
    copySelection();
    addPage();
    pasteFromMemory(VIEW);
    expect(state.board.elements[0]).toMatchObject({ x: 100, y: 100 });
  });

  it('оригинал за экраном — копия ложится по центру видимой области', () => {
    addElement(rect('a', { x: 5000, y: 5000, w: 100, h: 50 }));
    setSelection(['a']);
    copySelection();
    pasteFromMemory({ x0: 0, y0: 0, x1: 1000, y1: 800 });
    expect(state.board.elements[1]).toMatchObject({ x: 450 + STEP, y: 375 + STEP });
  });

  it('буфер из другого окна принимается, мусор — нет', () => {
    const foreign = fakeData({ [CLIP_MIME]: JSON.stringify({ key: 'other', pageId: 'p', elements: [rect('x', { x: 1, y: 2 })] }) });
    expect(pasteFromSystem(foreign, VIEW)).toBe(true);
    expect(state.board.elements[0]).toMatchObject({ x: 1, y: 2 });
    expect(state.board.elements[0].id).not.toBe('x');
    expect(pasteFromSystem(fakeData({ [CLIP_MIME]: '{нет' }), VIEW)).toBe(false);
    expect(pasteFromSystem(fakeData({ [CLIP_MIME]: '{"elements":[]}' }), VIEW)).toBe(false);
    expect(pasteFromSystem(fakeData(), VIEW)).toBe(false);
    expect(pasteFromSystem(null, VIEW)).toBe(false);
  });

  it('копия в буфере не меняется вместе с оригиналом', () => {
    addElement(rect('a', { x: 100, y: 100 }));
    setSelection(['a']);
    copySelection();
    const first = state.pageId;
    addPage();
    switchPage(first);
    state.board.elements = state.board.elements.map(e => ({ ...e, x: 300 }));
    pasteFromMemory(VIEW);
    expect(state.board.elements[1]).toMatchObject({ x: 100 + STEP });
  });
});
