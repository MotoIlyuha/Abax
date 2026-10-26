import { describe, expect, it } from 'vitest';
import {
  aabbIntersects, aabbUnion, alignGuides, alignShift, applyHandle, boxAnchors, cornerRadius, distToSeg, elementAABB, elementHandles, erasePart, fitShapeText,
  gridStepFor, hitTest, imageFrame, insertPolyNode, parseTextSize, pointInPoly, presentCamera, removePolyNode, shapeCaption,
  shapeHoldsText, shapeTextBox, snapValue, stepTextSize, SHAPE_TEXT_LH, SHAPE_TEXT_MAX, SHAPE_TEXT_MIN, TEXT_FONT, TEXT_SIZES,
  textSize, wrapText,
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

describe('надпись в фигуре', () => {
  it('пишут в прямоугольнике, эллипсе и треугольнике', () => {
    expect(shapeHoldsText(rect())).toBe(true);
    expect(shapeHoldsText(rect({ shape: 'ellipse' }))).toBe(true);
    expect(shapeHoldsText(rect({ shape: 'triangle' }))).toBe(true);
    expect(shapeHoldsText(rect({ shape: 'line' }))).toBe(false);
    expect(shapeHoldsText(rect({ shape: 'arrow' }))).toBe(false);
    expect(shapeHoldsText(text())).toBe(false);
    expect(shapeHoldsText(null)).toBe(false);
  });

  it('область текста: прямоугольник без полей, вписанный прямоугольник эллипса, низ треугольника', () => {
    expect(shapeTextBox(rect({ w: 200, h: 100 }))).toEqual({ x: 8, y: 8, w: 184, h: 84 });
    const e = shapeTextBox(rect({ shape: 'ellipse', w: 200, h: 200 }));
    const side = 200 / Math.SQRT2;
    expect(e.w).toBeCloseTo(side - 16);
    expect(e.x + e.w / 2).toBeCloseTo(100);
    expect(e.y + e.h / 2).toBeCloseTo(100);
    expect(shapeTextBox(rect({ shape: 'triangle', w: 200, h: 200 }))).toEqual({ x: 58, y: 108, w: 84, h: 84 });
    // отрицательные размеры — та же область
    expect(shapeTextBox(rect({ x: 200, y: 100, w: -200, h: -100 }))).toEqual(shapeTextBox(rect({ w: 200, h: 100 })));
  });

  it('кегль уменьшается, пока текст не влезет', () => {
    expect(fitShapeText('ab', 200, 100)).toEqual({ size: SHAPE_TEXT_MAX, lines: ['ab'] });
    const long = 'один два три четыре пять шесть семь восемь';
    const fit = fitShapeText(long, 120, 60);
    expect(fit.size).toBeLessThan(SHAPE_TEXT_MAX);
    expect(fit.lines.length * fit.size * SHAPE_TEXT_LH).toBeLessThanOrEqual(60);
    expect(fit.lines.join(' ')).toBe(long);
    // не влезает и мелким — останавливается на минимуме
    expect(fitShapeText(long.repeat(20), 20, 10).size).toBe(SHAPE_TEXT_MIN);
  });

  it('заданный кегль не подбирается — только переносятся строки', () => {
    const long = 'один два три четыре пять шесть семь восемь';
    const fit = fitShapeText(long, 120, 60, { size: 30 });
    expect(fit.size).toBe(30);
    expect(fit.lines.length).toBeGreaterThan(2);
  });

  it('раскладка надписи: выравнивание по горизонтали и вертикали', () => {
    const s = rect({ w: 200, h: 100, text: 'ab', textSize: 20 });
    const box = shapeTextBox(s);
    const mid = shapeCaption(s);
    expect(mid).toMatchObject({ align: 'center', valign: 'middle', size: 20, lines: ['ab'], x: box.x + box.w / 2 });
    expect(mid.top).toBeCloseTo(box.y + (box.h - 20 * SHAPE_TEXT_LH) / 2);
    const lt = shapeCaption({ ...s, align: 'left', valign: 'top' });
    expect(lt).toMatchObject({ x: box.x, top: box.y });
    const rb = shapeCaption({ ...s, align: 'right', valign: 'bottom' });
    expect(rb.x).toBe(box.x + box.w);
    expect(rb.top).toBeCloseTo(box.y + box.h - 20 * SHAPE_TEXT_LH);
    // набираемый в редакторе текст — вместо сохранённого
    expect(shapeCaption(s, 'xyz').lines).toEqual(['xyz']);
  });

  it('скругление не больше половины меньшей стороны; рамка картинки — только с цветом и толщиной', () => {
    expect(cornerRadius(rect({ radius: 10 }))).toBe(10);
    expect(cornerRadius(rect({ radius: 80 }))).toBe(25);
    expect(cornerRadius(rect())).toBe(0);
    expect(cornerRadius(image({ radius: 100 }))).toBe(25);
    expect(imageFrame(image())).toBeNull();
    expect(imageFrame(image({ color: '#ff0000' }))).toBeNull();
    expect(imageFrame(image({ color: '#ff0000', width: 0 }))).toBeNull();
    expect(imageFrame(image({ color: '#ff0000', width: 3 }))).toEqual({ color: '#ff0000', width: 3 });
  });
});

describe('кегль текста', () => {
  it('стрелки — соседние готовые значения; за крайними — без изменений', () => {
    expect(TEXT_SIZES).toEqual([10, 12, 14, 18, 24, 36, 80, 144, 288]);
    expect(stepTextSize(24, 1)).toBe(36);
    expect(stepTextSize(24, -1)).toBe(18);
    expect(stepTextSize(20, 1)).toBe(24);
    expect(stepTextSize(20, -1)).toBe(18);
    expect(stepTextSize(288, 1)).toBe(288);
    expect(stepTextSize(10, -1)).toBe(10);
    expect(stepTextSize(300, -1)).toBe(288);
    expect(stepTextSize(8, 1)).toBe(10);
  });

  it('ввод вручную: целое в пределах, ошибки — понятным текстом', () => {
    expect(parseTextSize('50')).toEqual({ size: 50 });
    expect(parseTextSize(' 12,6 ')).toEqual({ size: 13 });
    expect(parseTextSize('abc')).toEqual({ error: 'Введите число, например 24' });
    expect(parseTextSize('')).toEqual({ error: 'Введите число, например 24' });
    expect(parseTextSize('5')).toEqual({ error: 'Размер — от 6 до 400' });
    expect(parseTextSize('401')).toEqual({ error: 'Размер — от 6 до 400' });
  });
});

describe('направляющие выравнивания', () => {
  const box = (x0: number, y0: number, x1: number, y1: number) => ({ x0, y0, x1, y1 });

  it('опорные линии — края и центр', () => {
    expect(boxAnchors(box(0, 10, 100, 50), 'x')).toEqual([0, 50, 100]);
    expect(boxAnchors(box(0, 10, 100, 50), 'y')).toEqual([10, 30, 50]);
  });

  it('сдвиг — к ближайшей опорной линии соседа в пределах допуска', () => {
    const others = [box(200, 0, 300, 100), box(0, 400, 50, 450)];
    // левый край 203 → 200 (край соседа), правый край 253 → 250 (его центр) — ближе на 3
    expect(alignShift([203, 228, 253], others, 'x', 6)).toBe(-3);
    // ближе всего центр второго соседа: 23 → 25
    expect(alignShift([23], others, 'x', 6)).toBe(2);
    expect(alignShift([120], others, 'x', 6)).toBeNull();
    expect(alignShift([404], others, 'y', 6)).toBe(-4);
  });

  it('линия идёт от рамки до соседа, совпадения на одной линии сливаются', () => {
    const moving = box(200, 300, 260, 340);
    const others = [box(200, 0, 300, 100), box(150, 500, 250, 600), box(600, 300, 700, 320)];
    const xs = alignGuides(moving, boxAnchors(moving, 'x'), others, 'x', 0.01);
    // x = 200: левый край первого соседа и центр второго — одна линия от y=0 до y=600
    expect(xs).toEqual([{ axis: 'x', at: 200, from: 0, to: 600 }]);
    const ys = alignGuides(moving, boxAnchors(moving, 'y'), others, 'y', 0.01);
    // верх и низ рамки совпали с верхом и низом третьего соседа
    expect(ys).toEqual([{ axis: 'y', at: 300, from: 200, to: 700 }, { axis: 'y', at: 320, from: 200, to: 700 }]);
    expect(alignGuides(moving, [], others, 'x', 0.01)).toEqual([]);
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

  it('пропорции у боковой ручки: вторая сторона растёт от середины', () => {
    const p = applyHandle(rect(), resize(1, 0), pt(200, 25), { proportional: true }) as ShapeEl;
    expect(p).toMatchObject({ x: 0, w: 200, h: 100, y: -25 });
    const v = applyHandle(rect(), resize(0, -1), pt(50, -50), { proportional: true }) as ShapeEl;
    expect(v).toMatchObject({ y: -50, h: 100, w: 200, x: -50 });
    // и у повёрнутой картинки
    const img = applyHandle(image({ rot: Math.PI / 2 }), resize(1, 0), pt(50, 175), { proportional: true }) as ImageEl;
    expect(img.w / img.h).toBeCloseTo(2);
    expect(img.w).toBeCloseTo(200);
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

describe('erasePart: ластик для пера и маркера', () => {
  // горизонтальная линия из двух точек: 0…100 по x, толщина 2
  const line = [{ x: 0, y: 0, p: 0.5 }, { x: 100, y: 0, p: 0.5 }];

  it('мимо линии — null', () => {
    expect(erasePart(line, 2, 50, 40, 5)).toBeNull();
    expect(erasePart(line, 2, 300, 0, 5)).toBeNull();
  });

  it('середина длинного отрезка разрезает линию надвое, край — ровно у ластика', () => {
    const pieces = erasePart(line, 2, 50, 0, 5)!;
    expect(pieces).toHaveLength(2);
    const [left, right] = pieces;
    const leftEnd = left[left.length - 1].x, rightStart = right[0].x;
    // стёрто только под кругом (радиус 5 + полтолщины), а не до концов отрезка
    expect(leftEnd).toBeGreaterThan(40);
    expect(leftEnd).toBeLessThan(45);
    expect(rightStart).toBeGreaterThan(55);
    expect(rightStart).toBeLessThan(60);
    expect(left[0]).toEqual(line[0]);
    expect(right[right.length - 1]).toEqual(line[1]);
  });

  it('конец линии — укорачивает без новых кусков', () => {
    const pieces = erasePart(line, 2, 100, 0, 5)!;
    expect(pieces).toHaveLength(1);
    expect(pieces[0][0]).toEqual(line[0]);
    expect(pieces[0][pieces[0].length - 1].x).toBeLessThan(95);
  });

  it('ластик больше линии стирает её целиком', () => {
    expect(erasePart([{ x: 0, y: 0, p: 0.5 }, { x: 4, y: 0, p: 0.5 }], 2, 2, 0, 10)).toEqual([]);
  });

  it('давление в новых точках — по интерполяции', () => {
    const ramp = [{ x: 0, y: 0, p: 0 }, { x: 100, y: 0, p: 1 }];
    const [left] = erasePart(ramp, 2, 50, 0, 5)!;
    const last = left[left.length - 1];
    expect(last.p).toBeCloseTo(last.x / 100, 5);
  });
});
