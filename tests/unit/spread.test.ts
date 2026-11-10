import { describe, expect, it } from 'vitest';
import { spreadElements, spreadTargets } from '../../src/spread';
import type { Element, ImageEl, ShapeEl, StrokeEl } from '../../src/types';

const rect = (id: string, y: number, h = 20, extra: Partial<ShapeEl> = {}): ShapeEl =>
  ({ id, type: 'shape', shape: 'rect', x: 0, y, w: 40, h, color: '#000', width: 2, ...extra });
const stroke = (id: string, y0: number, y1: number, extra: Partial<StrokeEl> = {}): StrokeEl =>
  ({ id, type: 'stroke', tool: 'pen', color: '#000', width: 2, pts: [{ x: 10, y: y0, p: 0.5 }, { x: 30, y: y1, p: 0.5 }], ...extra });
const image = (id: string, y: number, h: number): ImageEl =>
  ({ id, type: 'image', x: -100, y, w: 400, h, src: '' });

describe('spreadTargets', () => {
  it('сдвигается только то, что целиком ниже линии', () => {
    const els: Element[] = [rect('above', 0), rect('cut', 90), rect('below', 120), stroke('line', 200, 210)];
    expect([...spreadTargets(els, 100)].sort()).toEqual(['below', 'line']);
  });

  it('группа, которую режет линия, остаётся на месте целиком', () => {
    const els: Element[] = [rect('a', 50, 20, { groupId: 'g' }), rect('b', 150, 20, { groupId: 'g' }), rect('c', 150, 20, { groupId: 'h' })];
    expect([...spreadTargets(els, 100)]).toEqual(['c']);
  });

  it('надписи на разрезанной картинке не отрываются от неё', () => {
    const els: Element[] = [image('pdf', 0, 400), stroke('on-pdf', 200, 210), stroke('outside', 500, 510)];
    expect([...spreadTargets(els, 100)]).toEqual(['outside']);
  });

  it('прикреплённое к сдвигаемой основе едет вместе с ней', () => {
    const els: Element[] = [image('pic', 150, 100), stroke('on-pic', 160, 170)];
    expect([...spreadTargets(els, 100)].sort()).toEqual(['on-pic', 'pic']);
  });
});

describe('spreadElements', () => {
  it('сдвигает выбранные вниз, остальные не трогает', () => {
    const els: Element[] = [rect('a', 0), rect('b', 120)];
    const out = spreadElements(els, new Set(['b']), 30);
    expect(out[0]).toBe(els[0]);
    expect(out[1]).toMatchObject({ id: 'b', x: 0, y: 150 });
  });

  it('без сдвига — тот же массив', () => {
    const els: Element[] = [rect('a', 0)];
    expect(spreadElements(els, new Set(['a']), 0)).toBe(els);
  });
});
