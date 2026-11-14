import { describe, expect, it } from 'vitest';
import { applyBoardPatch, diffElements, isBoardPatch, type BoardPatch } from '../../src/delta';
import type { Element, Page, ShapeEl } from '../../src/types';

type Pin = { layerPin?: 'top' | 'bottom' };
const rect = (id: string, o: Partial<ShapeEl> & Pin = {}): ShapeEl & Pin =>
  ({ id, type: 'shape', shape: 'rect', x: 0, y: 0, w: 10, h: 10, color: '#000000', width: 2, ...o });
const page = (elements: Element[]): Page => ({ id: 'pg', name: 'Стр', grid: 'square', elements });
const patch = (ops: BoardPatch['ops'], extra: Partial<BoardPatch> = {}): BoardPatch => ({ t: 'patch', pageId: 'pg', rev: 1, ops, ...extra });
const ids = (p: Page) => p.elements.map(e => e.id);

/** Туда и обратно: патч из diff превращает prev в next. */
function roundTrip(prev: Element[], next: Element[]): Page {
  return applyBoardPatch(page(prev), patch(diffElements(prev, next)));
}

describe('diffElements', () => {
  it('одинаковое — пусто', () => {
    const a = [rect('a'), rect('b')];
    expect(diffElements(a, a)).toEqual([]);
    expect(diffElements(a, structuredClone(a))).toEqual([]); // равные по значению — не изменились
  });

  it('создание: put, порядок не нужен', () => {
    const a = rect('a'), b = rect('b');
    expect(diffElements([a], [a, b])).toEqual([{ op: 'put', el: b }]);
  });

  it('редактирование: put только изменившегося', () => {
    const a = rect('a'), b = rect('b');
    const b2 = { ...b, x: 5 };
    expect(diffElements([a, b], [a, b2])).toEqual([{ op: 'put', el: b2 }]);
  });

  it('удаление: del', () => {
    const a = rect('a'), b = rect('b');
    expect(diffElements([a, b], [b])).toEqual([{ op: 'del', id: 'a' }]);
  });

  it('смена слоёв: только order', () => {
    const a = rect('a'), b = rect('b'), c = rect('c');
    expect(diffElements([a, b, c], [c, a, b])).toEqual([{ op: 'order', ids: ['c', 'a', 'b'] }]);
  });

  it('новый элемент не сверху — put и order', () => {
    const a = rect('a'), b = rect('b'), n = rect('n');
    expect(diffElements([a, b], [a, n, b])).toEqual([{ op: 'put', el: n }, { op: 'order', ids: ['a', 'n', 'b'] }]);
  });

  it('смесь: удаление, правка, создание и перестановка', () => {
    const a = rect('a'), b = rect('b'), c = rect('c'), d = rect('d');
    const b2 = { ...b, color: '#ff0000' };
    const ops = diffElements([a, b, c], [d, b2, c]);
    expect(ops).toEqual([{ op: 'del', id: 'a' }, { op: 'put', el: d }, { op: 'put', el: b2 }, { op: 'order', ids: ['d', 'b', 'c'] }]);
  });

  it('закреплённые слои не порождают лишний order', () => {
    const bottom = rect('bg', { layerPin: 'bottom' }), a = rect('a'), top = rect('t', { layerPin: 'top' });
    const prev = [bottom, a, top];
    const next = [bottom, a, rect('b'), top]; // новый элемент ложится под «верхний» закреплённый, как в replaceElements
    expect(diffElements(prev, next)).toEqual([{ op: 'put', el: next[2] }]);
  });
});

describe('applyBoardPatch', () => {
  it('создание, правка, удаление и перестановка воспроизводят next', () => {
    const a = rect('a'), b = rect('b'), c = rect('c');
    const cases: [Element[], Element[]][] = [
      [[a], [a, b]],
      [[a, b], [a, { ...b, w: 99 }]],
      [[a, b, c], [a, c]],
      [[a, b, c], [c, b, a]],
      [[a, b, c], [rect('n'), c, { ...a, x: 1 }]],
      [[], [a, b]],
      [[a, b], []],
    ];
    for (const [prev, next] of cases) expect(roundTrip(prev, next).elements).toEqual(next);
  });

  it('исходная страница не меняется', () => {
    const base = page([rect('a')]);
    const before = JSON.stringify(base);
    const out = applyBoardPatch(base, patch([{ op: 'put', el: rect('b') }, { op: 'del', id: 'a' }]));
    expect(JSON.stringify(base)).toBe(before);
    expect(out).not.toBe(base);
    expect(ids(out)).toEqual(['b']);
  });

  it('идемпотентность: повторное применение даёт то же', () => {
    const a = rect('a'), b = rect('b'), c = rect('c');
    const p = patch(diffElements([a, b, c], [c, rect('n'), { ...a, x: 3 }]), { grid: 'dots', backgroundColor: '#eeeeee' });
    const once = applyBoardPatch(page([a, b, c]), p);
    const twice = applyBoardPatch(once, p);
    expect(twice).toEqual(once);
    expect(twice.elements).toBe(once.elements); // ничего не изменилось — тот же массив и те же объекты
    expect(twice.elements.every((e, i) => e === once.elements[i])).toBe(true);
  });

  it('put прогоняется через sanitizeElement: негодное пропускается, чужие поля остаются', () => {
    const bad = { id: 'x', type: 'shape' } as unknown as Element;
    const weird = { ...rect('w'), opacity: 'много', future: 1 } as unknown as Element;
    const out = applyBoardPatch(page([]), patch([{ op: 'put', el: bad }, { op: 'put', el: weird }, { op: 'put', el: { id: 'u', type: 'нечто' } as never }]));
    expect(ids(out)).toEqual(['w']);
    expect(out.elements[0]).not.toHaveProperty('opacity');
    expect(out.elements[0]).toMatchObject({ future: 1 });
  });

  it('order: неизвестные id игнорируются, пропущенные остаются сверху', () => {
    const out = applyBoardPatch(page([rect('a'), rect('b'), rect('c')]), patch([{ op: 'order', ids: ['c', 'нет', 'a', 'c'] }]));
    expect(ids(out)).toEqual(['c', 'a', 'b']);
  });

  it('закрепления слоёв соблюдаются после применения', () => {
    const out = applyBoardPatch(page([rect('a')]), patch([{ op: 'put', el: rect('bg', { layerPin: 'bottom' }) }, { op: 'put', el: rect('b') }]));
    expect(ids(out)).toEqual(['bg', 'a', 'b']);
  });

  it('del несуществующего и put существующего без изменений безвредны', () => {
    const a = rect('a');
    const base = page([a]);
    const out = applyBoardPatch(base, patch([{ op: 'del', id: 'нет' }, { op: 'put', el: { ...a } }]));
    expect(out.elements).toBe(base.elements);
  });

  it('сетка и фон страницы', () => {
    const base = { ...page([]), backgroundColor: '#ffffff' };
    expect(applyBoardPatch(base, patch([], { grid: 'coord' })).grid).toBe('coord');
    expect(applyBoardPatch(base, patch([], { backgroundColor: '#112233' })).backgroundColor).toBe('#112233');
    expect(applyBoardPatch(base, patch([], { backgroundColor: null }))).not.toHaveProperty('backgroundColor');
    expect(applyBoardPatch(base, patch([], { grid: 'мусор' as never })).grid).toBe('square');
    expect(applyBoardPatch(base, patch([])).backgroundColor).toBe('#ffffff');
  });
});

describe('isBoardPatch', () => {
  it('принимает корректный и отвергает испорченные', () => {
    expect(isBoardPatch(patch([{ op: 'del', id: 'a' }, { op: 'order', ids: ['a'] }, { op: 'put', el: rect('a') }]))).toBe(true);
    expect(isBoardPatch(null)).toBe(false);
    expect(isBoardPatch({ ...patch([]), t: 'project' })).toBe(false);
    expect(isBoardPatch({ ...patch([]), pageId: '' })).toBe(false);
    expect(isBoardPatch({ ...patch([]), rev: NaN })).toBe(false);
    expect(isBoardPatch({ ...patch([]), ops: 'нет' })).toBe(false);
    expect(isBoardPatch(patch([{ op: 'del' } as never]))).toBe(false);
    expect(isBoardPatch(patch([{ op: 'order', ids: [1] } as never]))).toBe(false);
    expect(isBoardPatch(patch([{ op: 'ломать' } as never]))).toBe(false);
    expect(isBoardPatch(patch([], { grid: 'x' as never }))).toBe(false);
  });
});
