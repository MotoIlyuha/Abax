import { describe, expect, it } from 'vitest';
import {
  FLOAT_MARGIN, clampFloat, dragFloat, floatSide, orientOfPos, rotateFloat, sanitizeToolbarFloat, sizeIn,
} from '../../src/toolbar-float';

const area = { w: 1000, h: 600, top: 24 };
/** Колонка 46×450: в строке — 450×46. */
const col = { w: 46, h: 450 };

describe('откреплённая панель инструментов', () => {
  it('сохранённое значение: битое — null, координаты округляются', () => {
    expect(sanitizeToolbarFloat(null)).toBeNull();
    expect(sanitizeToolbarFloat({ x: 1, y: 2, orient: 'd' })).toBeNull();
    expect(sanitizeToolbarFloat({ x: 'a', y: 2, orient: 'v' })).toBeNull();
    expect(sanitizeToolbarFloat({ x: Infinity, y: 2, orient: 'v' })).toBeNull();
    expect(sanitizeToolbarFloat({ x: 10.4, y: 20.6, orient: 'h' })).toEqual({ x: 10, y: 21, orient: 'h' });
  });

  it('ориентация краёв и размер после поворота', () => {
    expect(orientOfPos('left')).toBe('v');
    expect(orientOfPos('right')).toBe('v');
    expect(orientOfPos('top')).toBe('h');
    expect(orientOfPos('bottom')).toBe('h');
    expect(sizeIn(col, 'v', 'h')).toEqual({ w: 450, h: 46 });
    expect(sizeIn(col, 'v', 'v')).toBe(col);
  });

  it('держится в пределах холста, сверху — место под ручку', () => {
    expect(clampFloat({ x: -50, y: -50, orient: 'v' }, col, area)).toEqual({ x: FLOAT_MARGIN, y: area.top, orient: 'v' });
    expect(clampFloat({ x: 2000, y: 2000, orient: 'v' }, col, area))
      .toEqual({ x: area.w - col.w - FLOAT_MARGIN, y: area.h - col.h - FLOAT_MARGIN, orient: 'v' });
  });

  it('перенос: ручка под курсором, ориентация не меняется, пока панель помещается', () => {
    const f = dragFloat(300, 50, 'v', col, area);
    expect(f).toEqual({ x: 300 - col.w / 2, y: 50, orient: 'v' });
  });

  it('колонку опустили низко — не помещается и становится строкой', () => {
    const f = dragFloat(500, 400, 'v', col, area);
    expect(f.orient).toBe('h');
    expect(f).toEqual({ x: 500 - 450 / 2, y: 400, orient: 'h' });
  });

  it('строку потащили к боковому краю — становится колонкой', () => {
    const row = sizeIn(col, 'v', 'h');
    const f = dragFloat(40, 100, 'h', row, area);
    expect(f.orient).toBe('v');
    expect(f.x).toBe(40 - col.w / 2);
  });

  it('не помещается ни так, ни так — та ориентация, что вылезает меньше, прижатая к краю', () => {
    const f = dragFloat(990, 590, 'v', col, area);
    expect(f.orient).toBe('h');
    expect(f).toEqual(clampFloat(f, sizeIn(col, 'v', 'h'), area));
    // на холсте, где строка не влезает по ширине вовсе, колонка остаётся колонкой (и прижимается к низу)
    const narrow = { w: 300, h: 600, top: 24 };
    expect(dragFloat(150, 590, 'v', col, narrow).orient).toBe('v');
  });

  it('нажатие на ручку поворачивает панель вокруг ручки', () => {
    const f = rotateFloat({ x: 400, y: 50, orient: 'v' }, col, area);
    expect(f).toEqual({ x: 400 + col.w / 2 - 450 / 2, y: 50, orient: 'h' });
    // и обратно — на то же место
    expect(rotateFloat(f, sizeIn(col, 'v', 'h'), area)).toEqual({ x: 400, y: 50, orient: 'v' });
  });

  it('поворот у края — в пределах холста', () => {
    const f = rotateFloat({ x: FLOAT_MARGIN, y: 100, orient: 'v' }, col, area);
    expect(f).toEqual({ x: FLOAT_MARGIN, y: 100, orient: 'h' });
  });

  it('выше линии top (шапка доски) панель не поднимается', () => {
    const high = { ...area, top: 86 };
    expect(dragFloat(300, 10, 'v', col, high).y).toBe(86);
  });

  it('сторона для панелей групп и подсказок — по месту на холсте', () => {
    expect(floatSide({ x: 100, y: 50, orient: 'v' }, col, area)).toBe('left');
    expect(floatSide({ x: 800, y: 50, orient: 'v' }, col, area)).toBe('right');
    const row = sizeIn(col, 'v', 'h');
    expect(floatSide({ x: 100, y: 50, orient: 'h' }, row, area)).toBe('top');
    expect(floatSide({ x: 100, y: 500, orient: 'h' }, row, area)).toBe('bottom');
  });
});
