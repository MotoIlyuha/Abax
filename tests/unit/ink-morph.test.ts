import { describe, expect, it } from 'vitest';
import { inkMorphFrame, prepareInkMorph } from '../../src/ink-morph';
import type { PolyEl, Pt } from '../../src/types';

describe('переход штриха в контур фигуры', () => {
  const style = { id: 'figure', width: 3, color: '#123' };
  it('выпрямляет линию постепенно и приводит давление к толщине фигуры', () => {
    const stroke = [{ x: 110, y: 40, p: .9 }, { x: 60, y: 45, p: .8 }, { x: 10, y: 40, p: .3 }];
    const morph = prepareInkMorph(stroke, { ...style, type: 'shape', shape: 'line', x: 110, y: 40, w: -100, h: 0 });
    const middle = morph.from.findIndex(p => p.x === 60);
    expect(inkMorphFrame(morph, 0)[middle]).toEqual(stroke[1]);
    expect(inkMorphFrame(morph, 0.5)[middle].y).toBeCloseTo(42.5);
    expect(inkMorphFrame(morph, 1)[middle]).toMatchObject({ y: 40, p: .5 });
  });

  it('совмещает обратный обход со стартом посреди стороны и сохраняет углы', () => {
    const pt = (x: number, y: number): Pt => ({ x, y, p: .5 });
    const vertices = [pt(0, 0), pt(100, 0), pt(100, 45), pt(0, 45)];
    const shape: PolyEl = { ...style, type: 'poly', closed: true, pts: vertices };
    const stroke = [pt(48, 0), vertices[0], vertices[3], vertices[2], vertices[1], pt(52, 0)];
    const morph = prepareInkMorph(stroke, shape);
    expect(Math.max(...morph.from.map((p, i) => Math.hypot(p.x - morph.to[i].x, p.y - morph.to[i].y)))).toBeLessThan(4);
    for (const v of vertices) expect(morph.to.some(p => Math.hypot(p.x - v.x, p.y - v.y) < 0.001)).toBe(true);
    const last = morph.to[morph.to.length - 1];
    expect(last.x).toBeCloseTo(morph.to[0].x);
    expect(last.y).toBeCloseTo(morph.to[0].y);
  });
});
