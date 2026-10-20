import { describe, expect, it } from 'vitest';
import {
  aabbIntersects, aabbUnion, applyHandle, distToSeg, elementAABB, elementHandles, gridStepFor,
  hitTest, insertPolyNode, pointInPoly, presentCamera, removePolyNode, snapValue, TEXT_FONT, textSize, wrapText,
} from '../../src/geom';
import type { Handle, ImageEl, NoteEl, PolyEl, ShapeEl, SolidEl, StrokeEl, TextEl } from '../../src/types';

const pt = (x: number, y: number) => ({ x, y, p: 0.5 });

const rect = (o: Partial<ShapeEl> = {}): ShapeEl =>
  ({ id: 'r', type: 'shape', shape: 'rect', x: 0, y: 0, w: 100, h: 50, color: '#000', width: 2, ...o });
const stroke = (pts = [pt(0, 0), pt(100, 0)], width = 4): StrokeEl =>
  ({ id: 's', type: 'stroke', tool: 'pen', color: '#000', width, pts });
const poly = (closed: boolean, pts = [pt(0, 0), pt(100, 0), pt(100, 100), pt(0, 100)]): PolyEl =>
  ({ id: 'p', type: 'poly', closed, color: '#000', width: 2, pts });
const text = (o: Partial<TextEl> = {}): TextEl =>
  ({ id: 't', type: 'text', x: 10, y: 20, text: 'abcd', size: 20, color: '#000', ...o });
const note = (o: Partial<NoteEl> = {}): NoteEl =>
  ({ id: 'n', type: 'note', x: 0, y: 0, w: 200, h: 150, text: '', color: '#ffe066', ...o });
const image = (o: Partial<ImageEl> = {}): ImageEl =>
  ({ id: 'i', type: 'image', x: 0, y: 0, w: 100, h: 50, src: 'data:', ...o });
const cube: SolidEl = { id: 'c', type: 'solid', solid: 'cube', x: 0, y: 100, w: 100, d: 100, h: 100, color: '#000', width: 2 };

describe('шрифт и текст', () => {
  it('TEXT_FONT учитывает начертание', () => {
    expect(TEXT_FONT(20)).toMatch(/^20px /);
    expect(TEXT_FONT(20, true)).toMatch(/^700 20px/);
    expect(TEXT_FONT(20, false, true)).toMatch(/^italic 20px/);
    expect(TEXT_FONT(20, true, true)).toMatch(/^italic 700 20px/);
  });

  it('textSize: ширина по самой длинной строке, высота 1.25em на строку', () => {
    const s = textSize(text({ text: 'ab\nabcdef', size: 20 }));
    expect(s.w).toBe(6 * 10);
    expect(s.h).toBe(2 * 20 * 1.25);
  });

  it('textSize: пустая строка меряется как пробел', () => {
    expect(textSize(text({ text: '', size: 20 })).w).toBe(10);
  });

  it('wrapText переносит по словам и сохраняет пустые строки', () => {
    // 10px шрифт => 5px на символ; maxW 30 => не более 6 символов
    expect(wrapText('aa bb cc dd', 10, 30)).toEqual(['aa bb', 'cc dd']);
    expect(wrapText('one\n\ntwo', 10, 100)).toEqual(['one', '', 'two']);
  });

  it('wrapText не рвёт длинное слово', () => {
    expect(wrapText('verylongword x', 10, 20)).toEqual(['verylongword', 'x']);
  });
});

describe('elementAABB', () => {
  it('штрих — с запасом на толщину', () => {
    expect(elementAABB(stroke([pt(0, 0), pt(10, 20)], 10))).toEqual({ x0: -8, y0: -8, x1: 18, y1: 28 });
  });

  it('пустой штрих — нулевой бокс', () => {
    expect(elementAABB(stroke([]))).toEqual({ x0: 0, y0: 0, x1: 0, y1: 0 });
  });

  it('фигура с отрицательными w/h нормализуется', () => {
    expect(elementAABB(rect({ shape: 'line', x: 10, y: 10, w: -10, h: -5 }))).toEqual({ x0: 0, y0: 5, x1: 10, y1: 10 });
  });

  it('повёрнутый прямоугольник: бокс повёрнутых углов', () => {
    const a = elementAABB(rect({ w: 100, h: 50, rot: Math.PI / 2 }));
    expect(a.x0).toBeCloseTo(25);
    expect(a.x1).toBeCloseTo(75);
    expect(a.y0).toBeCloseTo(-25);
    expect(a.y1).toBeCloseTo(75);
  });

  it('ломаная — с полутолщиной', () => {
    expect(elementAABB(poly(false, [pt(0, 0), pt(10, 10)]))).toEqual({ x0: -2, y0: -2, x1: 12, y1: 12 });
  });

  it('текст, стикер, картинка', () => {
    expect(elementAABB(text({ text: 'ab', size: 20 }))).toEqual({ x0: 10, y0: 20, x1: 30, y1: 45 });
    expect(elementAABB(note({ x: 5, y: 6, w: 10, h: 20 }))).toEqual({ x0: 5, y0: 6, x1: 15, y1: 26 });
    expect(elementAABB(image())).toEqual({ x0: 0, y0: 0, x1: 100, y1: 50 });
  });

  it('повёрнутая картинка', () => {
    const a = elementAABB(image({ rot: Math.PI / 2 }));
    expect(a.x0).toBeCloseTo(25);
    expect(a.y0).toBeCloseTo(-25);
  });

  it('тело — оболочка проекции с запасом на толщину', () => {
    const a = elementAABB(cube);
    expect(a.x0).toBeCloseTo(-2);
    expect(a.y1).toBeCloseTo(102);
    // глубина уходит вправо-вверх: 100 * 0.5 * cos45
    expect(a.x1).toBeCloseTo(100 + 50 * Math.SQRT1_2 + 2);
    expect(a.y0).toBeCloseTo(-50 * Math.SQRT1_2 - 2);
  });
});

describe('геометрические примитивы', () => {
  it('distToSeg: до отрезка, за концом и вырожденный', () => {
    expect(distToSeg(5, 3, 0, 0, 10, 0)).toBe(3);
    expect(distToSeg(13, 4, 0, 0, 10, 0)).toBe(5);
    expect(distToSeg(3, 4, 0, 0, 0, 0)).toBe(5);
  });

  it('pointInPoly', () => {
    const sq = [pt(0, 0), pt(10, 0), pt(10, 10), pt(0, 10)];
    expect(pointInPoly(5, 5, sq)).toBe(true);
    expect(pointInPoly(15, 5, sq)).toBe(false);
  });

  it('aabbUnion / aabbIntersects', () => {
    const a = { x0: 0, y0: 0, x1: 10, y1: 10 };
    const b = { x0: 5, y0: -5, x1: 20, y1: 5 };
    expect(aabbUnion(a, b)).toEqual({ x0: 0, y0: -5, x1: 20, y1: 10 });
    expect(aabbIntersects(a, b)).toBe(true);
    expect(aabbIntersects(a, { x0: 11, y0: 0, x1: 12, y1: 1 })).toBe(false);
  });

  it('gridStepFor: LOD по 4x, пока шаг меньше 18px', () => {
    expect(gridStepFor(1)).toBe(40);
    expect(gridStepFor(0.4)).toBe(160);
    expect(gridStepFor(0.1)).toBe(640);
  });

  it('snapValue', () => {
    expect(snapValue(57, 40)).toBe(40);
    expect(snapValue(61, 40)).toBe(80);
    expect(snapValue(57, 0)).toBe(57);
  });
});

describe('hitTest', () => {
  it('штрих: попадание у линии и промах вдали', () => {
    const s = stroke();
    expect(hitTest(s, 50, 2, 1)).toBe(true);
    expect(hitTest(s, 50, 30, 1)).toBe(false);
  });

  it('штрих из одной точки', () => {
    const s = stroke([pt(0, 0)]);
    expect(hitTest(s, 1, 1, 1)).toBe(true);
    expect(hitTest(s, 10, 10, 1)).toBe(false);
  });

  it('линия и стрелка — по расстоянию до отрезка', () => {
    const l = rect({ shape: 'arrow', w: 100, h: 0 });
    expect(hitTest(l, 50, 3, 1)).toBe(true);
    expect(hitTest(l, 50, 10, 1)).toBe(false);
  });

  it('прямоугольник — вся площадь, с учётом поворота', () => {
    expect(hitTest(rect(), 50, 25, 0)).toBe(true);
    expect(hitTest(rect(), 150, 25, 0)).toBe(false);
    const r = rect({ rot: Math.PI / 2 });
    expect(hitTest(r, 50, -20, 0)).toBe(true); // после поворота фигура вытянута по вертикали
    expect(hitTest(r, 5, 25, 0)).toBe(false);
  });

  it('эллипс', () => {
    const e = rect({ shape: 'ellipse' });
    expect(hitTest(e, 50, 25, 0)).toBe(true);
    expect(hitTest(e, 2, 2, 0)).toBe(false);
  });

  it('треугольник: вершина сверху по центру', () => {
    const t = rect({ shape: 'triangle', w: 100, h: 100 });
    expect(hitTest(t, 50, 90, 0)).toBe(true);
    expect(hitTest(t, 5, 5, 0)).toBe(false);
    expect(hitTest(t, 50, 120, 0)).toBe(false);
  });

  it('открытая ломаная: только у рёбер', () => {
    const p = poly(false);
    expect(hitTest(p, 50, 1, 1)).toBe(true);
    expect(hitTest(p, 50, 50, 1)).toBe(false);
  });

  it('замкнутая ломаная: и внутри', () => {
    expect(hitTest(poly(true), 50, 50, 1)).toBe(true);
    expect(hitTest(poly(true), 150, 50, 1)).toBe(false);
  });

  it('ломаная из одной точки', () => {
    expect(hitTest(poly(false, [pt(0, 0)]), 1, 0, 1)).toBe(true);
  });

  it('текст, стикер, картинка', () => {
    expect(hitTest(text(), 15, 30, 0)).toBe(true);
    expect(hitTest(text(), 0, 0, 0)).toBe(false);
    expect(hitTest(note(), 100, 100, 0)).toBe(true);
    expect(hitTest(note(), 300, 100, 0)).toBe(false);
    expect(hitTest(image({ rot: Math.PI / 2 }), 50, -20, 0)).toBe(true);
    expect(hitTest(image(), 150, 0, 0)).toBe(false);
  });

  it('тело — вся проекция и контур с допуском', () => {
    expect(hitTest(cube, 50, 50, 0)).toBe(true);
    expect(hitTest(cube, -3, 50, 3)).toBe(true);
    expect(hitTest(cube, 500, 500, 3)).toBe(false);
  });
});

describe('elementHandles', () => {
  it('линия — две концевые ручки', () => {
    const hs = elementHandles(rect({ shape: 'line', x: 1, y: 2, w: 10, h: 20 }), 1);
    expect(hs).toEqual([
      { h: { kind: 'end', i: 0 }, x: 1, y: 2 },
      { h: { kind: 'end', i: 1 }, x: 11, y: 22 },
    ]);
  });

  it('прямоугольник — 8 ручек размера и ручка поворота над фигурой', () => {
    const hs = elementHandles(rect(), 2);
    expect(hs).toHaveLength(9);
    const rot = hs.find(h => h.h.kind === 'rotate')!;
    expect(rot.x).toBeCloseTo(50);
    expect(rot.y).toBeCloseTo(-15); // 30px экрана при zoom=2
  });

  it('ломаная — узлы и середины рёбер', () => {
    expect(elementHandles(poly(false), 1).filter(h => h.h.kind === 'node')).toHaveLength(4);
    expect(elementHandles(poly(false), 1).filter(h => h.h.kind === 'insert')).toHaveLength(3);
    expect(elementHandles(poly(true), 1).filter(h => h.h.kind === 'insert')).toHaveLength(4);
  });

  it('стикер — 8 ручек без поворота, картинка — с поворотом', () => {
    expect(elementHandles(note(), 1)).toHaveLength(8);
    expect(elementHandles(image(), 1).some(h => h.h.kind === 'rotate')).toBe(true);
  });

  it('тело — ручки параметров, текст и штрих — без ручек', () => {
    expect(elementHandles(cube, 1)).toEqual([expect.objectContaining({ h: { kind: 'param', key: 'a' } })]);
    expect(elementHandles(text(), 1)).toEqual([]);
    expect(elementHandles(stroke(), 1)).toEqual([]);
  });
});

describe('applyHandle', () => {
  const resize = (dx: -1 | 0 | 1, dy: -1 | 0 | 1): Handle => ({ kind: 'resize', dx, dy });

  it('концы линии', () => {
    const l = rect({ shape: 'line', x: 0, y: 0, w: 10, h: 10 });
    expect(applyHandle(l, { kind: 'end', i: 0 }, pt(5, 5))).toMatchObject({ x: 5, y: 5, w: 10, h: 10 });
    expect(applyHandle(l, { kind: 'end', i: 1 }, pt(30, 40))).toMatchObject({ x: 0, y: 0, w: 30, h: 40 });
  });

  it('правый нижний угол растягивает прямоугольник', () => {
    expect(applyHandle(rect(), resize(1, 1), pt(200, 100))).toMatchObject({ x: 0, y: 0, w: 200, h: 100 });
  });

  it('левая ручка не даёт схлопнуть фигуру меньше минимума', () => {
    const r = applyHandle(rect(), resize(-1, 0), pt(500, 25)) as ShapeEl;
    expect(r.w).toBe(4);
    expect(r.x).toBe(96);
  });

  it('Shift сохраняет пропорции, Alt — от центра', () => {
    const p = applyHandle(rect(), resize(1, 1), pt(200, 60), { proportional: true }) as ShapeEl;
    expect(p.w / p.h).toBeCloseTo(2);
    expect(p.w).toBe(200);
    const c = applyHandle(rect(), resize(1, 0), pt(150, 25), { fromCenter: true }) as ShapeEl;
    expect(c.x).toBe(-50);
    expect(c.w).toBe(200);
    const pc = applyHandle(rect(), resize(1, 1), pt(150, 25), { proportional: true, fromCenter: true }) as ShapeEl;
    expect(pc.w / pc.h).toBeCloseTo(2);
    expect(pc.x + pc.w / 2).toBeCloseTo(50);
  });

  it('Alt по вертикали растит от центра', () => {
    const c = applyHandle(rect(), resize(0, 1), pt(50, 75), { fromCenter: true }) as ShapeEl;
    expect(c.h).toBe(100);
    expect(c.y).toBe(-25);
  });

  it('пропорции от левого верхнего угла', () => {
    const p = applyHandle(rect(), resize(-1, -1), pt(-100, -10), { proportional: true }) as ShapeEl;
    expect(p.w / p.h).toBeCloseTo(2);
    expect(p.x + p.w).toBeCloseTo(100);
    expect(p.y + p.h).toBeCloseTo(50);
  });

  it('поворот с примагничиванием к 45°', () => {
    const r = applyHandle(rect(), { kind: 'rotate' }, pt(0, 0), undefined, Math.PI / 4 + 0.03) as ShapeEl;
    expect(r.rot).toBeCloseTo(Math.PI / 4);
    const free = applyHandle(rect(), { kind: 'rotate' }, pt(0, 0), undefined, 0.3) as ShapeEl;
    expect(free.rot).toBeCloseTo(0.3);
    const zero = applyHandle(rect({ rot: 1 }), { kind: 'rotate' }, pt(0, 0), undefined, 0.01) as ShapeEl;
    expect(zero.rot).toBeUndefined();
  });

  it('поворот по позиции курсора нормализуется в (-π, π]', () => {
    // курсор справа от центра => угол atan2 = 0, +π/2
    const r = applyHandle(rect(), { kind: 'rotate' }, pt(200, 25)) as ShapeEl;
    expect(r.rot).toBeCloseTo(Math.PI / 2);
    const big = applyHandle(rect(), { kind: 'rotate' }, pt(0, 0), undefined, 3 * Math.PI / 2 + 0.3) as ShapeEl;
    expect(big.rot).toBeCloseTo(-Math.PI / 2 + 0.3);
  });

  it('ресайз повёрнутой фигуры в локальной системе', () => {
    const r = applyHandle(rect({ rot: Math.PI / 2 }), resize(1, 0), pt(50, 125)) as ShapeEl;
    expect(r.w).toBeCloseTo(150);
    expect(r.h).toBeCloseTo(50);
  });

  it('картинка: ресайз и поворот', () => {
    expect(applyHandle(image(), resize(1, 1), pt(200, 100))).toMatchObject({ w: 200, h: 100 });
    const rot = applyHandle(image(), { kind: 'rotate' }, pt(0, 0), undefined, Math.PI / 2 - 0.02) as ImageEl;
    expect(rot.rot).toBeCloseTo(Math.PI / 2);
    expect((applyHandle(image(), { kind: 'rotate' }, pt(0, 0), undefined, -6.5) as ImageEl).rot).toBeCloseTo(-6.5 + 2 * Math.PI);
  });

  it('стикер: ресайз с минимальным размером', () => {
    expect(applyHandle(note(), resize(1, 1), pt(300, 200))).toMatchObject({ x: 0, y: 0, w: 300, h: 200 });
    const tiny = applyHandle(note(), resize(1, 1), pt(1, 1)) as NoteEl;
    expect(tiny.w).toBe(80);
    expect(tiny.h).toBe(60);
    const left = applyHandle(note(), resize(-1, -1), pt(-50, -50)) as NoteEl;
    expect(left).toMatchObject({ x: -50, y: -50, w: 250, h: 200 });
  });

  it('узел ломаной перемещается', () => {
    const p = applyHandle(poly(false), { kind: 'node', i: 1 }, pt(7, 8)) as PolyEl;
    expect(p.pts[1]).toEqual({ x: 7, y: 8, p: 0.5 });
  });

  it('параметр тела', () => {
    const c = applyHandle(cube, { kind: 'param', key: 'a' }, pt(150, -50)) as SolidEl;
    expect(c.w).toBe(150);
    expect(c.h).toBe(150);
  });

  it('неподходящая ручка возвращает элемент как есть', () => {
    const t = text();
    expect(applyHandle(t, { kind: 'rotate' }, pt(0, 0))).toBe(t);
    const r = rect();
    expect(applyHandle(r, { kind: 'node', i: 0 }, pt(0, 0))).toBe(r);
  });
});

describe('узлы ломаной', () => {
  it('insertPolyNode вставляет после i', () => {
    const p = insertPolyNode(poly(false), 0, pt(50, -5));
    expect(p.pts).toHaveLength(5);
    expect(p.pts[1]).toEqual({ x: 50, y: -5, p: 0.5 });
  });

  it('removePolyNode соблюдает минимум вершин', () => {
    expect(removePolyNode(poly(false), 0)!.pts).toHaveLength(3);
    expect(removePolyNode(poly(false, [pt(0, 0), pt(1, 1)]), 0)).toBeNull();
    expect(removePolyNode(poly(true, [pt(0, 0), pt(1, 1), pt(2, 0)]), 0)).toBeNull();
  });
});

describe('камера окна демонстрации', () => {
  const cam = { x: 100, y: 50, zoom: 2 };
  // основной холст 800×600 при zoom 2 показывает сцену [100..500] × [50..350], центр (300, 200)
  const center = (c: { x: number; y: number; zoom: number }, w: number, h: number) =>
    ({ x: c.x + w / c.zoom / 2, y: c.y + h / c.zoom / 2 });

  it('окно того же размера показывает ровно то же', () => {
    expect(presentCamera(cam, 800, 600, 800, 600)).toEqual(cam);
  });

  it('пропорциональное окно масштабирует ту же область', () => {
    const c = presentCamera(cam, 800, 600, 1600, 1200);
    expect(c).toEqual({ x: 100, y: 50, zoom: 4 });
  });

  it('широкое окно: видимая область целиком по высоте, по центру', () => {
    const c = presentCamera(cam, 800, 600, 1920, 1080);
    expect(c.zoom).toBeCloseTo(2 * 1080 / 600);
    expect(center(c, 1920, 1080)).toEqual({ x: 300, y: 200 });
    // по высоте — ровно видимая область, по ширине — с запасом
    expect(1080 / c.zoom).toBeCloseTo(300);
    expect(1920 / c.zoom).toBeGreaterThan(400);
  });

  it('узкое окно: видимая область целиком по ширине', () => {
    const c = presentCamera(cam, 800, 600, 400, 800);
    expect(c.zoom).toBeCloseTo(1);
    expect(400 / c.zoom).toBeCloseTo(400);
    expect(center(c, 400, 800)).toEqual({ x: 300, y: 200 });
  });
});
