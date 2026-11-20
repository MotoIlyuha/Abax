// Откреплённая панель инструментов (настройка «Разрешить откреплять панель инструментов»,
// раздел «Дополнительные»): ручка сверху, перенос по холсту и смена ориентации.
// Здесь — чистая геометрия без DOM: где встать панели и как ей быть повёрнутой.

import type { ToolbarFloat, ToolbarOrient, ToolbarPos } from './types';

export type { ToolbarFloat, ToolbarOrient };

export interface Size { w: number; h: number }
/** Холст; top — выше этой линии панель не поднимается (над ней — ручка и шапка доски). */
export interface Area extends Size { top: number }

/** Отступ панели от краёв холста. */
export const FLOAT_MARGIN = 8;
/** Высота ручки над панелью (вместе с зазором): столько места панели нужно сверху. */
export const GRIP_ROOM = 20;

/** Сохранённое значение → положение или null (панель пристыкована). */
export function sanitizeToolbarFloat(v: unknown): ToolbarFloat | null {
  if (!v || typeof v !== 'object') return null;
  const r = v as Record<string, unknown>;
  if (typeof r.x !== 'number' || typeof r.y !== 'number' || !Number.isFinite(r.x) || !Number.isFinite(r.y)) return null;
  if (r.orient !== 'v' && r.orient !== 'h') return null;
  return { x: Math.round(r.x), y: Math.round(r.y), orient: r.orient };
}

/** Ориентация пристыкованной панели. */
export function orientOfPos(pos: ToolbarPos): ToolbarOrient {
  return pos === 'left' || pos === 'right' ? 'v' : 'h';
}

/** Размер панели в другой ориентации: те же кнопки, строка вместо колонки — стороны меняются местами. */
export function sizeIn(size: Size, from: ToolbarOrient, to: ToolbarOrient): Size {
  return from === to ? size : { w: size.h, h: size.w };
}

/** На сколько панель вылезает за холст (0 — помещается). */
function overflow(x: number, y: number, s: Size, area: Area): number {
  const m = FLOAT_MARGIN;
  return Math.max(0, m - x) + Math.max(0, area.top - y)
    + Math.max(0, x + s.w - (area.w - m)) + Math.max(0, y + s.h - (area.h - m));
}

/** Панель этого размера помещается на холсте хотя бы где-нибудь. */
function fitsArea(s: Size, area: Area): boolean {
  return s.w <= area.w - FLOAT_MARGIN * 2 && s.h <= area.h - FLOAT_MARGIN - area.top;
}

/** Держит панель в пределах холста (не помещается целиком — прижата к левому/верхнему краю). */
export function clampFloat(f: ToolbarFloat, s: Size, area: Area): ToolbarFloat {
  const m = FLOAT_MARGIN;
  const x = Math.max(m, Math.min(f.x, area.w - s.w - m));
  const y = Math.max(area.top, Math.min(f.y, area.h - s.h - m));
  return { x: Math.round(x), y: Math.round(y), orient: f.orient };
}

/**
 * Перенос за ручку: ручка (середина верхнего края) — в точке (gx, gy). Панель остаётся повёрнутой как была,
 * пока помещается; не помещается, а повёрнутая — помещается (или вылезает меньше), — меняет ориентацию.
 * size — размер панели в ориентации orient.
 */
export function dragFloat(gx: number, gy: number, orient: ToolbarOrient, size: Size, area: Area): ToolbarFloat {
  const other: ToolbarOrient = orient === 'v' ? 'h' : 'v';
  const at = (o: ToolbarOrient) => {
    const s = sizeIn(size, orient, o);
    return { x: gx - s.w / 2, y: gy, s };
  };
  const cur = at(orient);
  const alt = at(other);
  const curOver = overflow(cur.x, cur.y, cur.s, area);
  const altOver = overflow(alt.x, alt.y, alt.s, area);
  // повёрнутая, которая не влезает на холст вовсе, проигрывает той, что влезает (у края)
  const altBetter = curOver > 0 && (altOver === 0
    || (fitsArea(alt.s, area) === fitsArea(cur.s, area) ? altOver < curOver : fitsArea(alt.s, area)));
  const pick = altBetter ? { ...alt, o: other } : { ...cur, o: orient };
  return clampFloat({ x: pick.x, y: pick.y, orient: pick.o }, pick.s, area);
}

/** Нажатие на ручку: панель поворачивается, ручка остаётся на месте (насколько позволяет холст). */
export function rotateFloat(f: ToolbarFloat, size: Size, area: Area): ToolbarFloat {
  const to: ToolbarOrient = f.orient === 'v' ? 'h' : 'v';
  const s = sizeIn(size, f.orient, to);
  const gx = f.x + size.w / 2;
  return clampFloat({ x: gx - s.w / 2, y: f.y, orient: to }, s, area);
}

/**
 * С какой стороны экрана откреплённая панель — для всего, что раскладывается от неё (панели групп,
 * подсказки, плашка отмены): колонка — «слева» или «справа», строка — «сверху» или «снизу», по её середине.
 */
export function floatSide(f: ToolbarFloat, size: Size, area: Area): ToolbarPos {
  if (f.orient === 'v') return f.x + size.w / 2 <= area.w / 2 ? 'left' : 'right';
  return f.y + size.h / 2 <= area.h / 2 ? 'top' : 'bottom';
}
