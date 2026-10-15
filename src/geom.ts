import type { Element, ShapeEl, StrokeEl, TextEl } from './types';

export interface AABB { x0: number; y0: number; x1: number; y1: number }

let measureCtx: CanvasRenderingContext2D | null = null;
function mctx(): CanvasRenderingContext2D {
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d')!;
  return measureCtx;
}

export const TEXT_FONT = (size: number) => `${size}px "Segoe UI", "Inter", system-ui, sans-serif`;

export function textSize(el: TextEl): { w: number; h: number } {
  const lines = el.text.split('\n');
  const ctx = mctx();
  ctx.font = TEXT_FONT(el.size);
  let w = 0;
  for (const l of lines) w = Math.max(w, ctx.measureText(l || ' ').width);
  return { w, h: lines.length * el.size * 1.25 };
}

export function wrapText(text: string, size: number, maxW: number): string[] {
  const ctx = mctx();
  ctx.font = TEXT_FONT(size);
  const out: string[] = [];
  for (const raw of text.split('\n')) {
    if (!raw) { out.push(''); continue; }
    let line = '';
    for (const word of raw.split(' ')) {
      const t = line ? line + ' ' + word : word;
      if (ctx.measureText(t).width <= maxW || !line) line = t;
      else { out.push(line); line = word; }
    }
    out.push(line);
  }
  return out;
}

export const NOTE_W = 216;
export const NOTE_H = 168;
export const NOTE_PAD = 14;
export const NOTE_FONT = 15;
export const NOTE_TEXT_COLOR = '#4a4633';
export const TEXT_SIZE = 24;

export function elementAABB(el: Element): AABB {
  switch (el.type) {
    case 'stroke': {
      const s = el as StrokeEl;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      const r = s.width * 0.8; // запас на давление и скругление
      if (s.pts.length === 0) return { x0: 0, y0: 0, x1: 0, y1: 0 };
      for (const p of s.pts) {
        if (p.x < x0) x0 = p.x;
        if (p.x > x1) x1 = p.x;
        if (p.y < y0) y0 = p.y;
        if (p.y > y1) y1 = p.y;
      }
      return { x0: x0 - r, y0: y0 - r, x1: x1 + r, y1: y1 + r };
    }
    case 'shape': {
      const s = el as ShapeEl;
      return {
        x0: Math.min(s.x, s.x + s.w), y0: Math.min(s.y, s.y + s.h),
        x1: Math.max(s.x, s.x + s.w), y1: Math.max(s.y, s.y + s.h),
      };
    }
    case 'text': {
      const t = textSize(el as TextEl);
      return { x0: el.x, y0: el.y, x1: el.x + t.w, y1: el.y + t.h };
    }
    case 'note':
      return { x0: el.x, y0: el.y, x1: el.x + el.w, y1: el.y + el.h };
  }
}

export function distToSeg(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Попадание точки (координаты сцены) в элемент; tol — допуск в юнитах сцены. */
export function hitTest(el: Element, x: number, y: number, tol: number): boolean {
  switch (el.type) {
    case 'stroke': {
      const s = el as StrokeEl;
      const t = tol + (s.width * 0.8) / 2;
      const pts = s.pts;
      if (pts.length === 1) return Math.hypot(x - pts[0].x, y - pts[0].y) <= t;
      for (let i = 1; i < pts.length; i++) {
        if (distToSeg(x, y, pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y) <= t) return true;
      }
      return false;
    }
    case 'shape': {
      const s = el as ShapeEl;
      if (s.shape === 'line' || s.shape === 'arrow')
        return distToSeg(x, y, s.x, s.y, s.x + s.w, s.y + s.h) <= tol + s.width;
      const a = elementAABB(s);
      if (s.shape === 'rect')
        return x >= a.x0 - tol && x <= a.x1 + tol && y >= a.y0 - tol && y <= a.y1 + tol;
      // ellipse: вся площадь (удобнее перемещать)
      const cx = (a.x0 + a.x1) / 2, cy = (a.y0 + a.y1) / 2;
      const rx = Math.max((a.x1 - a.x0) / 2, 0.5), ry = Math.max((a.y1 - a.y0) / 2, 0.5);
      return ((x - cx) / (rx + tol)) ** 2 + ((y - cy) / (ry + tol)) ** 2 <= 1;
    }
    case 'text': {
      const a = elementAABB(el);
      return x >= a.x0 - tol && x <= a.x1 + tol && y >= a.y0 - tol && y <= a.y1 + tol;
    }
    case 'note':
      return x >= el.x - tol && x <= el.x + el.w + tol && y >= el.y - tol && y <= el.y + el.h + tol;
  }
}

export function aabbUnion(a: AABB, b: AABB): AABB {
  return {
    x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0),
    x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1),
  };
}

export function aabbIntersects(a: AABB, b: AABB): boolean {
  return a.x0 <= b.x1 && a.x1 >= b.x0 && a.y0 <= b.y1 && a.y1 >= b.y0;
}
