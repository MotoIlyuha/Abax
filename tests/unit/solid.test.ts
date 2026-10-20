import { describe, expect, it } from 'vitest';
import {
  applySolidParam, fitSolid, hasBaseSides, isRevolution, SIDES_MAX, SIDES_MIN, SOLID_CLICK_SIZE,
  SOLID_MIN, solidGeometry, solidHandles, solidKeepsAspect, solidSides,
} from '../../src/solid';
import type { SolidEl, SolidKind } from '../../src/types';

const ALL: SolidKind[] = ['cube', 'box', 'prism', 'pyramid', 'truncPyramid', 'cylinder', 'cone', 'truncCone', 'sphere'];
const style = { id: 'x', color: '#123456', width: 3 };

const solid = (kind: SolidKind, o: Partial<SolidEl> = {}): SolidEl =>
  ({ id: kind, type: 'solid', solid: kind, x: 0, y: 0, w: 100, d: 80, h: 120, color: '#000', width: 2, ...o });

describe('классификация тел', () => {
  it('тела вращения и многогранники', () => {
    expect(ALL.filter(isRevolution)).toEqual(['cylinder', 'cone', 'truncCone', 'sphere']);
    expect(ALL.filter(hasBaseSides)).toEqual(['prism', 'pyramid', 'truncPyramid']);
    expect(ALL.filter(solidKeepsAspect)).toEqual(['cube', 'sphere']);
  });

  it('для каждого тела задан размер по клику', () => {
    for (const k of ALL) expect(SOLID_CLICK_SIZE[k]).toHaveLength(2);
  });
});

describe('solidSides', () => {
  it('значения по умолчанию: призма — треугольная, пирамиды — четырёхугольные', () => {
    expect(solidSides(solid('prism'))).toBe(3);
    expect(solidSides(solid('pyramid'))).toBe(4);
    expect(solidSides(solid('truncPyramid'))).toBe(4);
    expect(solidSides(solid('cube'))).toBe(4);
  });

  it('ограничивает n диапазоном', () => {
    expect(solidSides(solid('pyramid', { n: 1 }))).toBe(SIDES_MIN);
    expect(solidSides(solid('pyramid', { n: 99 }))).toBe(SIDES_MAX);
    expect(solidSides(solid('prism', { n: 6 }))).toBe(6);
  });
});

describe('solidGeometry', () => {
  it('куб: 12 рёбер, из них 3 невидимых', () => {
    const g = solidGeometry(solid('cube', { w: 100, d: 100, h: 100 }));
    const segs = g.prims.filter(p => p.k === 'seg');
    expect(segs).toHaveLength(12);
    expect(segs.filter(p => p.hidden)).toHaveLength(3);
    expect(g.hull.length).toBeGreaterThanOrEqual(6);
  });

  it('тетраэдр (треугольная пирамида): 6 рёбер, одно невидимое', () => {
    const g = solidGeometry(solid('pyramid', { n: 3 }));
    expect(g.prims).toHaveLength(6);
    expect(g.prims.filter(p => p.hidden)).toHaveLength(1);
  });

  it('n-угольная призма: 3n рёбер, усечённая пирамида тоже', () => {
    for (let n = SIDES_MIN; n <= SIDES_MAX; n++) {
      expect(solidGeometry(solid('prism', { n })).prims).toHaveLength(3 * n);
      expect(solidGeometry(solid('truncPyramid', { n, t: 0.4 })).prims).toHaveLength(3 * n);
      expect(solidGeometry(solid('pyramid', { n })).prims).toHaveLength(2 * n);
    }
  });

  it('кэш по объекту элемента', () => {
    const el = solid('box');
    expect(solidGeometry(el)).toBe(solidGeometry(el));
    expect(solidGeometry({ ...el })).not.toBe(solidGeometry(el));
  });

  it('шар: контур и экватор с невидимой задней половиной', () => {
    const g = solidGeometry(solid('sphere', { w: 100, d: 30 }));
    expect(g.prims).toHaveLength(3);
    expect(g.prims.filter(p => p.hidden)).toHaveLength(1);
  });

  it('цилиндр: две образующие, две дуги основания и верхний эллипс', () => {
    const g = solidGeometry(solid('cylinder'));
    expect(g.prims.filter(p => p.k === 'seg')).toHaveLength(2);
    expect(g.prims.filter(p => p.k === 'arc')).toHaveLength(3);
    expect(g.prims.filter(p => p.hidden)).toHaveLength(1);
  });

  it('конус: образующие сходятся в вершину, верхнего основания нет', () => {
    const el = solid('cone', { x: 0, y: 0, h: 120 });
    const g = solidGeometry(el);
    const segs = g.prims.filter(p => p.k === 'seg');
    expect(segs).toHaveLength(2);
    for (const s of segs) if (s.k === 'seg') expect([s.x1, s.y1]).toEqual([0, -120]);
    expect(g.prims.filter(p => p.k === 'arc')).toHaveLength(2);
  });

  it('приплюснутый конус: вершина внутри основания — контур = эллипс', () => {
    const g = solidGeometry(solid('cone', { h: 10, d: 80 }));
    expect(g.prims.filter(p => p.k === 'seg')).toHaveLength(0);
    // вершина всё равно входит в оболочку
    expect(Math.min(...g.hull.map(p => p.y))).toBeLessThanOrEqual(-10);
  });

  it('усечённый конус: верхнее основание меньше нижнего', () => {
    const g = solidGeometry(solid('truncCone', { t: 0.5 }));
    const top = g.prims.find(p => p.k === 'arc' && p.cy === -120);
    expect(top && top.k === 'arc' && top.rx).toBe(25);
  });
});

describe('ручки параметров', () => {
  it('куб — одна ручка ребра', () => {
    expect(solidHandles(solid('cube')).map(h => h.h)).toEqual([{ kind: 'param', key: 'a' }]);
  });

  it('параллелепипед и призмы: w, d, h; усечённая пирамида ещё и t', () => {
    expect(solidHandles(solid('box')).map(h => (h.h as { key: string }).key)).toEqual(['w', 'd', 'h']);
    expect(solidHandles(solid('truncPyramid')).map(h => (h.h as { key: string }).key)).toEqual(['w', 'd', 'h', 't']);
  });

  it('тела вращения: w, d, h; усечённый конус ещё и t; шар — w, d', () => {
    expect(solidHandles(solid('cylinder')).map(h => (h.h as { key: string }).key)).toEqual(['w', 'd', 'h']);
    expect(solidHandles(solid('truncCone')).map(h => (h.h as { key: string }).key)).toEqual(['w', 'd', 'h', 't']);
    expect(solidHandles(solid('sphere')).map(h => (h.h as { key: string }).key)).toEqual(['w', 'd']);
  });

  it('перетаскивание ручки в её же позицию не меняет параметр (обратимость)', () => {
    for (const k of ALL) {
      const dims = k === 'cube' ? { w: 100, d: 100, h: 100 } : { d: isRevolution(k) ? 40 : 80 };
      const el = solid(k, { n: k === 'prism' ? 5 : undefined, t: 0.5, ...dims });
      for (const hp of solidHandles(el)) {
        const key = (hp.h as { key: 'w' | 'd' | 'h' | 't' | 'a' }).key;
        const next = applySolidParam(el, key, { x: hp.x, y: hp.y });
        for (const f of ['w', 'd', 'h'] as const) expect(next[f]).toBeCloseTo(el[f]);
        if (key === 't') expect(next.t).toBeCloseTo(0.5);
      }
    }
  });

  it('ограничения: минимальный размер, t в [0.05, 0.95], эллипс не шире основания', () => {
    const box = solid('box');
    expect(applySolidParam(box, 'w', { x: -1000, y: 0 }).w).toBe(SOLID_MIN);
    expect(applySolidParam(box, 'h', { x: 0, y: 1000 }).h).toBe(SOLID_MIN);
    expect(applySolidParam(solid('truncPyramid'), 't', { x: 1e4, y: -1e4 }).t).toBe(0.95);
    expect(applySolidParam(solid('truncCone'), 't', { x: -1e4, y: -120 }).t).toBe(0.05);
    const cyl = solid('cylinder', { w: 100, d: 40 });
    expect(applySolidParam(cyl, 'd', { x: 0, y: 1000 }).d).toBe(100);
    expect(applySolidParam(cyl, 'd', { x: 0, y: -1000 }).d).toBe(4);
    expect(applySolidParam(solid('cylinder', { w: 100, d: 90 }), 'w', { x: 20, y: 0 })).toMatchObject({ w: 40, d: 40 });
    expect(applySolidParam(solid('cube'), 'a', { x: 200, y: -200 })).toMatchObject({ w: 200, d: 200, h: 200 });
  });

  it('неизвестная ручка — элемент без изменений', () => {
    const el = solid('cube');
    expect(applySolidParam(el, 'w', { x: 0, y: 0 })).toBe(el);
  });
});

describe('fitSolid', () => {
  it('каждое тело вписывается в протянутый прямоугольник', () => {
    for (const k of ALL) {
      const el = fitSolid(k, 100, 100, 400, 350, style);
      expect(el).toMatchObject({ id: 'x', type: 'solid', solid: k, color: '#123456', width: 3 });
      const hull = solidGeometry(el).hull;
      const xs = hull.map(p => p.x), ys = hull.map(p => p.y);
      expect(Math.min(...xs)).toBeGreaterThanOrEqual(100 - 1e-6);
      expect(Math.max(...xs)).toBeLessThanOrEqual(400 + 1e-6);
      expect(Math.min(...ys)).toBeGreaterThanOrEqual(100 - 1e-6);
      expect(Math.max(...ys)).toBeLessThanOrEqual(350 + 1e-6);
    }
  });

  it('многогранники занимают всю ширину', () => {
    for (const k of ['box', 'prism', 'pyramid', 'truncPyramid'] as SolidKind[]) {
      const xs = solidGeometry(fitSolid(k, 0, 0, 300, 300, style)).hull.map(p => p.x);
      expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(300);
    }
  });

  it('направление протягивания не важно', () => {
    expect(fitSolid('box', 400, 350, 100, 100, style)).toEqual(fitSolid('box', 100, 100, 400, 350, style));
  });

  it('вырожденный прямоугольник даёт тело минимального размера', () => {
    const el = fitSolid('cylinder', 0, 0, 0, 0, style);
    expect(el.w).toBe(SOLID_MIN * 2);
    expect(el.h).toBeGreaterThanOrEqual(SOLID_MIN);
  });

  it('параметры по умолчанию: n и t', () => {
    expect(fitSolid('prism', 0, 0, 100, 100, style).n).toBe(3);
    expect(fitSolid('pyramid', 0, 0, 100, 100, style).n).toBe(4);
    expect(fitSolid('truncPyramid', 0, 0, 100, 100, style)).toMatchObject({ n: 4, t: 0.5 });
    expect(fitSolid('truncCone', 0, 0, 100, 100, style).t).toBe(0.5);
    expect(fitSolid('box', 0, 0, 100, 100, style).n).toBeUndefined();
  });
});
