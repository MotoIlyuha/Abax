import type { Camera, Element, Guide, Handle, HandlePos, ImageEl, PolyEl, Pt, ShapeEl, StrokeEl, TextAlign, TextEl, TextVAlign } from './types';
import { applySolidParam, solidGeometry, solidHandles } from './solid';
import { widthAt } from './stroke';

export interface AABB { x0: number; y0: number; x1: number; y1: number }

let measureCtx: CanvasRenderingContext2D | null = null;
function mctx(): CanvasRenderingContext2D {
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d')!;
  return measureCtx;
}

export const TEXT_FONT = (size: number, bold = false, italic = false) =>
  `${italic ? 'italic ' : ''}${bold ? '700 ' : ''}${size}px "Segoe UI", "Inter", system-ui, sans-serif`;

export function textSize(el: TextEl): { w: number; h: number } {
  const lines = el.text.split('\n');
  const ctx = mctx();
  ctx.font = TEXT_FONT(el.size, el.bold, el.italic);
  let w = 0;
  for (const l of lines) w = Math.max(w, ctx.measureText(l || ' ').width);
  return { w, h: lines.length * el.size * 1.25 };
}

export function wrapText(text: string, size: number, maxW: number, bold = false, italic = false): string[] {
  const ctx = mctx();
  ctx.font = TEXT_FONT(size, bold, italic);
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

/** Ширина строки текста шрифтом size. */
export function lineWidth(text: string, size: number, bold = false, italic = false): number {
  const ctx = mctx();
  ctx.font = TEXT_FONT(size, bold, italic);
  return ctx.measureText(text).width;
}

// ----- Кегль текста: стрелки в меню выделения ходят по этим значениям -----

export const TEXT_SIZES = [10, 12, 14, 18, 24, 36, 80, 144, 288];
export const TEXT_SIZE_MIN = 6;
export const TEXT_SIZE_MAX = 400;

/** Следующий (dir = 1) или предыдущий кегль из TEXT_SIZES; за крайними значениями — без изменений. */
export function stepTextSize(cur: number, dir: 1 | -1): number {
  if (dir > 0) return TEXT_SIZES.find(s => s > cur) ?? cur;
  return [...TEXT_SIZES].reverse().find(s => s < cur) ?? cur;
}

/** Кегль, набранный вручную: целое число в пределах TEXT_SIZE_MIN…TEXT_SIZE_MAX; иначе — что не так. */
export function parseTextSize(text: string): { size: number } | { error: string } {
  const m = /^\s*(\d+(?:[.,]\d+)?)\s*$/.exec(text);
  if (!m) return { error: 'Введите число, например 24' };
  const size = Math.round(Number(m[1].replace(',', '.')));
  if (size < TEXT_SIZE_MIN || size > TEXT_SIZE_MAX) return { error: `Размер — от ${TEXT_SIZE_MIN} до ${TEXT_SIZE_MAX}` };
  return { size };
}

// ----- Надпись внутри фигуры (как в Miro): по центру, кегль уменьшается, пока текст не влезет -----

export const SHAPE_TEXT_MAX = TEXT_SIZE;
export const SHAPE_TEXT_MIN = 6;
export const SHAPE_TEXT_LH = 1.25;
const SHAPE_TEXT_PAD = 8;

/** Фигуры, в которых можно писать: прямоугольник, эллипс, треугольник. */
export function shapeHoldsText(el: Element | null | undefined): el is ShapeEl {
  return !!el && el.type === 'shape' && (el.shape === 'rect' || el.shape === 'ellipse' || el.shape === 'triangle');
}

/**
 * Область надписи без учёта поворота: у прямоугольника — он сам без полей, у эллипса — вписанный
 * прямоугольник, у треугольника — вписанный наибольший (нижняя половина, по центру).
 */
export function shapeTextBox(s: ShapeEl): { x: number; y: number; w: number; h: number } {
  const x0 = Math.min(s.x, s.x + s.w), y0 = Math.min(s.y, s.y + s.h);
  const w = Math.abs(s.w), h = Math.abs(s.h);
  let bx = x0, by = y0, bw = w, bh = h;
  if (s.shape === 'ellipse') {
    bw = w / Math.SQRT2;
    bh = h / Math.SQRT2;
    bx = x0 + (w - bw) / 2;
    by = y0 + (h - bh) / 2;
  } else if (s.shape === 'triangle') {
    bw = w / 2;
    bh = h / 2;
    bx = x0 + w / 4;
    by = y0 + h / 2;
  }
  const pad = Math.min(SHAPE_TEXT_PAD, bw / 8, bh / 8);
  return { x: bx + pad, y: by + pad, w: Math.max(1, bw - pad * 2), h: Math.max(1, bh - pad * 2) };
}

/** Начертание надписи: заданный кегль (нет — подбирается) и жирность с курсивом. */
export interface CaptionFont { size?: number; bold?: boolean; italic?: boolean }

/**
 * Кегль и строки надписи в области w×h. Кегль задан — только переносим строки;
 * нет — от SHAPE_TEXT_MAX вниз, пока не влезет (не меньше SHAPE_TEXT_MIN).
 */
export function fitShapeText(text: string, w: number, h: number, font: CaptionFont = {}): { size: number; lines: string[] } {
  const b = !!font.bold, i = !!font.italic;
  if (font.size) return { size: font.size, lines: wrapText(text, font.size, w, b, i) };
  let size = SHAPE_TEXT_MAX;
  for (;;) {
    const lines = wrapText(text, size, w, b, i);
    const fits = lines.length * size * SHAPE_TEXT_LH <= h && lines.every(l => lineWidth(l, size, b, i) <= w);
    if (fits || size <= SHAPE_TEXT_MIN) return { size, lines };
    size = Math.max(SHAPE_TEXT_MIN, size - Math.max(1, Math.round(size * 0.1)));
  }
}

/** Раскладка надписи фигуры (без поворота): область, кегль, строки, межстрочие и выравнивание. */
export interface Caption {
  box: { x: number; y: number; w: number; h: number };
  size: number;
  lines: string[];
  lh: number;
  align: TextAlign;
  valign: TextVAlign;
  /** x опорной точки строк (левый край, середина или правый край области) и верх первой строки. */
  x: number;
  top: number;
}

/** Надпись фигуры s — с её текстом или с text (то, что сейчас набирают в редакторе). */
export function shapeCaption(s: ShapeEl, text = s.text ?? ''): Caption {
  const box = shapeTextBox(s);
  const { size, lines } = fitShapeText(text, box.w, box.h, { size: s.textSize, bold: s.bold, italic: s.italic });
  const lh = size * SHAPE_TEXT_LH;
  const align = s.align ?? 'center';
  const valign = s.valign ?? 'middle';
  const x = align === 'left' ? box.x : align === 'right' ? box.x + box.w : box.x + box.w / 2;
  const free = box.h - lines.length * lh;
  const top = valign === 'top' ? box.y : valign === 'bottom' ? box.y + free : box.y + free / 2;
  return { box, size, lines, lh, align, valign, x, top };
}

/** Радиус скругления, который реально помещается в элемент (не больше половины меньшей стороны). */
export function cornerRadius(el: ShapeEl | ImageEl): number {
  return Math.max(0, Math.min(el.radius ?? 0, Math.abs(el.w) / 2, Math.abs(el.h) / 2));
}

/** У картинки есть рамка: задан цвет и ненулевая толщина. */
export function imageFrame(el: ImageEl): { color: string; width: number } | null {
  return el.color && (el.width ?? 0) > 0 ? { color: el.color, width: el.width! } : null;
}

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
      const x0 = Math.min(s.x, s.x + s.w), y0 = Math.min(s.y, s.y + s.h);
      const x1 = Math.max(s.x, s.x + s.w), y1 = Math.max(s.y, s.y + s.h);
      if (s.shape !== 'line' && s.shape !== 'arrow' && s.rot) {
        // bbox повёрнутого прямоугольника: поворачиваем углы вокруг центра
        const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
        const cos = Math.cos(s.rot), sin = Math.sin(s.rot);
        let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
        for (const [px, py] of [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] as [number, number][]) {
          const rx = cx + (px - cx) * cos - (py - cy) * sin;
          const ry = cy + (px - cx) * sin + (py - cy) * cos;
          bx0 = Math.min(bx0, rx); bx1 = Math.max(bx1, rx);
          by0 = Math.min(by0, ry); by1 = Math.max(by1, ry);
        }
        return { x0: bx0, y0: by0, x1: bx1, y1: by1 };
      }
      return { x0, y0, x1, y1 };
    }
    case 'poly': {
      const s = el as PolyEl;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      const r = s.width / 2 + 1;
      for (const p of s.pts) {
        x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x);
        y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
      }
      return { x0: x0 - r, y0: y0 - r, x1: x1 + r, y1: y1 + r };
    }
    case 'text': {
      const t = textSize(el as TextEl);
      return { x0: el.x, y0: el.y, x1: el.x + t.w, y1: el.y + t.h };
    }
    case 'note':
      return { x0: el.x, y0: el.y, x1: el.x + el.w, y1: el.y + el.h };
    case 'image': {
      if (el.rot) {
        const cx = el.x + el.w / 2, cy = el.y + el.h / 2;
        const cos = Math.cos(el.rot), sin = Math.sin(el.rot);
        let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
        for (const [px, py] of [[el.x, el.y], [el.x + el.w, el.y], [el.x + el.w, el.y + el.h], [el.x, el.y + el.h]] as [number, number][]) {
          const rx = cx + (px - cx) * cos - (py - cy) * sin;
          const ry = cy + (px - cx) * sin + (py - cy) * cos;
          bx0 = Math.min(bx0, rx); bx1 = Math.max(bx1, rx);
          by0 = Math.min(by0, ry); by1 = Math.max(by1, ry);
        }
        return { x0: bx0, y0: by0, x1: bx1, y1: by1 };
      }
      return { x0: el.x, y0: el.y, x1: el.x + el.w, y1: el.y + el.h };
    }
    case 'solid': {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const p of solidGeometry(el).hull) {
        x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x);
        y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
      }
      const r = el.width / 2 + 1;
      return { x0: x0 - r, y0: y0 - r, x1: x1 + r, y1: y1 + r };
    }
  }
}

export function distToSeg(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/**
 * Ластик для пера и маркера: стирает у линии (pts, базовая толщина width) всё, что под кругом
 * радиуса r с центром (x, y). Точка стирается, если её след касается круга, — тогда уцелевший
 * край линии доходит ровно до ластика. Отрезки возле круга дробятся, иначе редкие точки длинной
 * прямой стирались бы целиком, до соседних точек.
 * Возвращает уцелевшие куски (ноль, один или несколько); null — круг линию не задел.
 */
export function erasePart(pts: Pt[], width: number, x: number, y: number, r: number): Pt[][] | null {
  const reach = r + widthAt(width, 1) / 2;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) {
    if (p.x < x0) x0 = p.x;
    if (p.x > x1) x1 = p.x;
    if (p.y < y0) y0 = p.y;
    if (p.y > y1) y1 = p.y;
  }
  if (x < x0 - reach || x > x1 + reach || y < y0 - reach || y > y1 + reach) return null;
  const step = Math.max(r / 3, 0.25);
  const dense: Pt[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    if (distToSeg(x, y, a.x, a.y, b.x, b.y) <= reach) {
      const n = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step);
      for (let k = 1; k < n; k++) {
        const f = k / n;
        dense.push({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, p: a.p + (b.p - a.p) * f });
      }
    }
    dense.push(b);
  }
  const pieces: Pt[][] = [];
  let run: Pt[] = [];
  let hit = false;
  for (const p of dense) {
    if (Math.hypot(p.x - x, p.y - y) <= r + widthAt(width, p.p) / 2) {
      hit = true;
      if (run.length > 1) pieces.push(run); // одиночная точка у края — соринка, не оставляем
      run = [];
    } else {
      run.push(p);
    }
  }
  if (!hit) return null;
  if (run.length > 1) pieces.push(run);
  return pieces;
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
      const lx0 = Math.min(s.x, s.x + s.w), ly0 = Math.min(s.y, s.y + s.h);
      const lx1 = Math.max(s.x, s.x + s.w), ly1 = Math.max(s.y, s.y + s.h);
      let px = x, py = y;
      if (s.rot) {
        const cx = (lx0 + lx1) / 2, cy = (ly0 + ly1) / 2;
        const cos = Math.cos(-s.rot), sin = Math.sin(-s.rot);
        const dx = x - cx, dy = y - cy;
        px = cx + dx * cos - dy * sin;
        py = cy + dx * sin + dy * cos;
      }
      if (s.shape === 'rect')
        return px >= lx0 - tol && px <= lx1 + tol && py >= ly0 - tol && py <= ly1 + tol;
      if (s.shape === 'triangle') {
        // равнобедренный: вершина — центр верхней грани, основание — нижняя грань; вся площадь
        if (py < ly0 - tol || py > ly1 + tol) return false;
        const t = ly1 > ly0 ? Math.min(Math.max((py - ly0) / (ly1 - ly0), 0), 1) : 1;
        return Math.abs(px - (lx0 + lx1) / 2) <= t * (lx1 - lx0) / 2 + tol;
      }
      // ellipse: вся площадь (удобнее перемещать)
      const ccx = (lx0 + lx1) / 2, ccy = (ly0 + ly1) / 2;
      const rx = Math.max((lx1 - lx0) / 2, 0.5), ry = Math.max((ly1 - ly0) / 2, 0.5);
      return ((px - ccx) / (rx + tol)) ** 2 + ((py - ccy) / (ry + tol)) ** 2 <= 1;
    }
    case 'poly': {
      const s = el as PolyEl;
      const t = tol + s.width / 2;
      const n = s.pts.length;
      if (n === 1) return Math.hypot(x - s.pts[0].x, y - s.pts[0].y) <= t;
      const last = s.closed ? n : n - 1;
      for (let i = 0; i < last; i++) {
        const a = s.pts[i], b = s.pts[(i + 1) % n];
        if (distToSeg(x, y, a.x, a.y, b.x, b.y) <= t) return true;
      }
      return s.closed && pointInPoly(x, y, s.pts);
    }
    case 'text': {
      const a = elementAABB(el);
      return x >= a.x0 - tol && x <= a.x1 + tol && y >= a.y0 - tol && y <= a.y1 + tol;
    }
    case 'note':
      return x >= el.x - tol && x <= el.x + el.w + tol && y >= el.y - tol && y <= el.y + el.h + tol;
    case 'image': {
      let px = x, py = y;
      if (el.rot) {
        const cx = el.x + el.w / 2, cy = el.y + el.h / 2;
        const cos = Math.cos(-el.rot), sin = Math.sin(-el.rot);
        const dx = x - cx, dy = y - cy;
        px = cx + dx * cos - dy * sin;
        py = cy + dx * sin + dy * cos;
      }
      return px >= el.x - tol && px <= el.x + el.w + tol && py >= el.y - tol && py <= el.y + el.h + tol;
    }
    case 'solid': {
      // вся проекция тела: удобнее хватать и перемещать
      const hull = solidGeometry(el).hull;
      if (pointInPoly(x, y, hull)) return true;
      const t = tol + el.width / 2;
      for (let i = 0; i < hull.length; i++) {
        const a = hull[i], b = hull[(i + 1) % hull.length];
        if (distToSeg(x, y, a.x, a.y, b.x, b.y) <= t) return true;
      }
      return false;
    }
  }
}
/** Луч с чётным числом пересечений = внутри (для замкнутого контура). */
export function pointInPoly(x: number, y: number, pts: { x: number; y: number }[]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

const ROT_HANDLE_OFF_PX = 30; // отступ ручки поворота над фигурой, px экрана
const MIN_SHAPE_SIZE = 4;
const MIN_NOTE_W = 80;
const MIN_NOTE_H = 60;
const ROT_SNAP = Math.PI / 45; // ~4°: примагничивание к кратным 45°

/** Видимый шаг сетки при данном зуме (LOD как у рендера). */
export function gridStepFor(zoom: number): number {
  let s = 40;
  while (s * zoom < 18) s *= 4;
  return s;
}

/** Округляет координату к шагу сетки; step <= 0 — без привязки. */
export function snapValue(v: number, step: number): number {
  return step > 0 ? Math.round(v / step) * step : v;
}

/** Ручки редактирования элемента (координаты сцены); zoom нужен для экранных отступов. */
export function elementHandles(el: Element, zoom: number): HandlePos[] {
  switch (el.type) {
    case 'shape': {
      const s = el as ShapeEl;
      if (s.shape === 'line' || s.shape === 'arrow') {
        return [
          { h: { kind: 'end', i: 0 }, x: s.x, y: s.y },
          { h: { kind: 'end', i: 1 }, x: s.x + s.w, y: s.y + s.h },
        ];
      }
      const cx = s.x + s.w / 2, cy = s.y + s.h / 2;
      const rot = s.rot ?? 0;
      const cos = Math.cos(rot), sin = Math.sin(rot);
      const out: HandlePos[] = [];
      const dirs: [number, number][] = [[-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0]];
      for (const [dx, dy] of dirs) {
        const lx = dx * s.w / 2, ly = dy * s.h / 2;
        out.push({ h: { kind: 'resize', dx: dx as -1 | 0 | 1, dy: dy as -1 | 0 | 1 }, x: cx + lx * cos - ly * sin, y: cy + lx * sin + ly * cos });
      }
      const lx = 0, ly = -s.h / 2 - ROT_HANDLE_OFF_PX / zoom;
      out.push({ h: { kind: 'rotate' }, x: cx + lx * cos - ly * sin, y: cy + lx * sin + ly * cos });
      return out;
    }
    case 'poly': {
      const s = el as PolyEl;
      const out: HandlePos[] = s.pts.map((p, i) => ({ h: { kind: 'node', i } as Handle, x: p.x, y: p.y }));
      const n = s.pts.length;
      const last = s.closed ? n : n - 1;
      for (let i = 0; i < last; i++) {
        const a = s.pts[i], b = s.pts[(i + 1) % n];
        out.push({ h: { kind: 'insert', i }, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
      }
      return out;
    }
    case 'note': {
      // стикер масштабируется за края и углы, без поворота
      const out: HandlePos[] = [];
      const dirs: [number, number][] = [[-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0]];
      for (const [dx, dy] of dirs) {
        out.push({
          h: { kind: 'resize', dx: dx as -1 | 0 | 1, dy: dy as -1 | 0 | 1 },
          x: el.x + el.w / 2 + (dx * el.w) / 2,
          y: el.y + el.h / 2 + (dy * el.h) / 2,
        });
      }
      return out;
    }
    case 'image': {
      // картинка масштабируется и вращается как прямоугольник
      const cx = el.x + el.w / 2, cy = el.y + el.h / 2;
      const rot = el.rot ?? 0;
      const cos = Math.cos(rot), sin = Math.sin(rot);
      const out: HandlePos[] = [];
      const dirs: [number, number][] = [[-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0]];
      for (const [dx, dy] of dirs) {
        const lx = (dx * el.w) / 2, ly = (dy * el.h) / 2;
        out.push({ h: { kind: 'resize', dx: dx as -1 | 0 | 1, dy: dy as -1 | 0 | 1 }, x: cx + lx * cos - ly * sin, y: cy + lx * sin + ly * cos });
      }
      const lx = 0, ly = -el.h / 2 - ROT_HANDLE_OFF_PX / zoom;
      out.push({ h: { kind: 'rotate' }, x: cx + lx * cos - ly * sin, y: cy + lx * sin + ly * cos });
      return out;
    }
    case 'solid':
      return solidHandles(el);
    default:
      return [];
  }
}

export interface ResizeMods {
  /** Shift/Ctrl: сохранять пропорции (у боковой ручки вторая сторона меняется от середины). */
  proportional?: boolean;
  /** Alt: изменение размера от центра. */
  fromCenter?: boolean;
}

/**
 * Пост-обработка краёв прямоугольника под модификаторы Photoshop:
 * пропорции и/или рост от центра. Края задаются в локальной системе элемента.
 */
function applyResizeMods(
  box: { left: number; right: number; top: number; bottom: number },
  h: Extract<Handle, { kind: 'resize' }>,
  mods: ResizeMods | undefined,
  origW: number,
  origH: number,
  minSize: number,
): void {
  if (!mods) return;
  if (mods.fromCenter) {
    if (h.dx !== 0) {
      // края заданы в локальной системе от центра: box.right/left ≈ позиция курсора
      const half = Math.max(minSize / 2, Math.abs(h.dx > 0 ? box.right : box.left));
      box.left = -half;
      box.right = half;
    }
    if (h.dy !== 0) {
      const half = Math.max(minSize / 2, Math.abs(h.dy > 0 ? box.bottom : box.top));
      box.top = -half;
      box.bottom = half;
    }
  }
  if (mods.proportional && (h.dx !== 0 || h.dy !== 0)) {
    // угловая ручка — по большему растяжению, боковая — по своей стороне
    const fX = (box.right - box.left) / origW;
    const fY = (box.bottom - box.top) / origH;
    const f = Math.max(h.dx === 0 ? fY : h.dy === 0 ? fX : Math.max(fX, fY), minSize / origW, minSize / origH);
    const nw = origW * f, nh = origH * f;
    // сторона без ручки (у боковой) растёт от середины
    if (mods.fromCenter || h.dx === 0) { box.left = -nw / 2; box.right = nw / 2; }
    else if (h.dx > 0) box.right = box.left + nw;
    else box.left = box.right - nw;
    if (mods.fromCenter || h.dy === 0) { box.top = -nh / 2; box.bottom = nh / 2; }
    else if (h.dy > 0) box.bottom = box.top + nh;
    else box.top = box.bottom - nh;
  }
}

/**
 * Применяет перетаскивание ручки к элементу: возвращает клон с новой геометрией.
 * el — оригинал (без накопления ошибки), pt — позиция курсора в сцене.
 */
export function applyHandle(el: Element, h: Handle, pt: Pt, mods?: ResizeMods, rotateAngle?: number): Element {
  if (el.type === 'shape') {
    const s = el as ShapeEl;
    if (h.kind === 'end') {
      if (h.i === 0) return { ...s, x: pt.x, y: pt.y };
      return { ...s, w: pt.x - s.x, h: pt.y - s.y };
    }
    if (h.kind === 'rotate') {
      const cx = s.x + s.w / 2, cy = s.y + s.h / 2;
      let ang = rotateAngle !== undefined ? rotateAngle : Math.atan2(pt.y - cy, pt.x - cx) + Math.PI / 2;
      for (let k = 0; k < 8; k++) {
        const target = (k * Math.PI) / 4;
        let diff = ang - target;
        while (diff > Math.PI) diff -= 2 * Math.PI;
        while (diff < -Math.PI) diff += 2 * Math.PI;
        if (Math.abs(diff) < ROT_SNAP) { ang = target; break; }
      }
      while (ang > Math.PI) ang -= 2 * Math.PI;
      while (ang < -Math.PI) ang += 2 * Math.PI;
      return { ...s, rot: Math.abs(ang) < 0.002 ? undefined : ang };
    }
    if (h.kind === 'resize') {
      const cx = s.x + s.w / 2, cy = s.y + s.h / 2;
      const rot = s.rot ?? 0;
      const cos = Math.cos(-rot), sin = Math.sin(-rot);
      const dx = pt.x - cx, dy = pt.y - cy;
      const plx = dx * cos - dy * sin; // курсор в локальной системе
      const ply = dx * sin + dy * cos;
      const box = { left: -s.w / 2, right: s.w / 2, top: -s.h / 2, bottom: s.h / 2 };
      if (h.dx < 0) box.left = Math.min(plx, box.right - MIN_SHAPE_SIZE);
      if (h.dx > 0) box.right = Math.max(plx, box.left + MIN_SHAPE_SIZE);
      if (h.dy < 0) box.top = Math.min(ply, box.bottom - MIN_SHAPE_SIZE);
      if (h.dy > 0) box.bottom = Math.max(ply, box.top + MIN_SHAPE_SIZE);
      applyResizeMods(box, h, mods, s.w, s.h, MIN_SHAPE_SIZE);
      const { left, right, top, bottom } = box;
      const nw = right - left, nh = bottom - top;
      // новый центр: сдвиг локального центра нового прямоугольника
      const offx = (left + right) / 2, offy = (top + bottom) / 2;
      const ccos = Math.cos(rot), csin = Math.sin(rot);
      const ncx = cx + offx * ccos - offy * csin;
      const ncy = cy + offx * csin + offy * ccos;
      return { ...s, x: ncx - nw / 2, y: ncy - nh / 2, w: nw, h: nh };
    }
    return s;
  }
  if (el.type === 'image' && (h.kind === 'resize' || h.kind === 'rotate')) {
    if (h.kind === 'rotate') {
      const cx = el.x + el.w / 2, cy = el.y + el.h / 2;
      let ang = rotateAngle !== undefined ? rotateAngle : Math.atan2(pt.y - cy, pt.x - cx) + Math.PI / 2;
      for (let k = 0; k < 8; k++) {
        const target = (k * Math.PI) / 4;
        let diff = ang - target;
        while (diff > Math.PI) diff -= 2 * Math.PI;
        while (diff < -Math.PI) diff += 2 * Math.PI;
        if (Math.abs(diff) < ROT_SNAP) { ang = target; break; }
      }
      while (ang > Math.PI) ang -= 2 * Math.PI;
      while (ang < -Math.PI) ang += 2 * Math.PI;
      return { ...el, rot: Math.abs(ang) < 0.002 ? undefined : ang };
    }
    const cx = el.x + el.w / 2, cy = el.y + el.h / 2;
    const rot = el.rot ?? 0;
    const cos = Math.cos(-rot), sin = Math.sin(-rot);
    const dx = pt.x - cx, dy = pt.y - cy;
    const plx = dx * cos - dy * sin;
    const ply = dx * sin + dy * cos;
    const box = { left: -el.w / 2, right: el.w / 2, top: -el.h / 2, bottom: el.h / 2 };
    if (h.dx < 0) box.left = Math.min(plx, box.right - MIN_SHAPE_SIZE);
    if (h.dx > 0) box.right = Math.max(plx, box.left + MIN_SHAPE_SIZE);
    if (h.dy < 0) box.top = Math.min(ply, box.bottom - MIN_SHAPE_SIZE);
    if (h.dy > 0) box.bottom = Math.max(ply, box.top + MIN_SHAPE_SIZE);
    applyResizeMods(box, h, mods, el.w, el.h, MIN_SHAPE_SIZE);
    const { left, right, top, bottom } = box;
    const nw = right - left, nh = bottom - top;
    const offx = (left + right) / 2, offy = (top + bottom) / 2;
    const ccos = Math.cos(rot), csin = Math.sin(rot);
    const ncx = cx + offx * ccos - offy * csin;
    const ncy = cy + offx * csin + offy * ccos;
    return { ...el, x: ncx - nw / 2, y: ncy - nh / 2, w: nw, h: nh };
  }
  if (el.type === 'note' && h.kind === 'resize') {
    // приводим к центровой системе, чтобы модификаторы работали единообразно
    const ncx = el.x + el.w / 2, ncy = el.y + el.h / 2;
    const plx = pt.x - ncx, ply = pt.y - ncy;
    const box = { left: -el.w / 2, right: el.w / 2, top: -el.h / 2, bottom: el.h / 2 };
    if (h.dx < 0) box.left = Math.min(plx, box.right - MIN_NOTE_W);
    if (h.dx > 0) box.right = Math.max(plx, box.left + MIN_NOTE_W);
    if (h.dy < 0) box.top = Math.min(ply, box.bottom - MIN_NOTE_H);
    if (h.dy > 0) box.bottom = Math.max(ply, box.top + MIN_NOTE_H);
    applyResizeMods(box, h, mods, el.w, el.h, Math.min(MIN_NOTE_W, MIN_NOTE_H));
    return { ...el, x: ncx + box.left, y: ncy + box.top, w: box.right - box.left, h: box.bottom - box.top };
  }
  if (el.type === 'solid' && h.kind === 'param') return applySolidParam(el, h.key, pt);
  if (el.type === 'poly' && h.kind === 'node') {
    const pts = el.pts.slice();
    pts[h.i] = { x: pt.x, y: pt.y, p: 0.5 };
    return { ...el, pts };
  }
  return el;
}

/** Вставляет узел в ребро i (перед i+1) ломаной; возвращает клон. */
export function insertPolyNode(el: PolyEl, i: number, pt: Pt): PolyEl {
  const pts = el.pts.slice();
  pts.splice(i + 1, 0, { x: pt.x, y: pt.y, p: 0.5 });
  return { ...el, pts };
}

/** Удаляет узел i ломаной (сохраняя минимум вершин); null — удалять нельзя. */
export function removePolyNode(el: PolyEl, i: number): PolyEl | null {
  const min = el.closed ? 3 : 2;
  if (el.pts.length <= min) return null;
  return { ...el, pts: el.pts.filter((_, k) => k !== i) };
}

/** Сдвиг элемента на (dx, dy) в координатах сцены. */
export function translateElement(el: Element, dx: number, dy: number): Element {
  if (el.type === 'stroke' || el.type === 'poly') {
    return { ...el, pts: el.pts.map(p => ({ x: p.x + dx, y: p.y + dy, p: p.p })) };
  }
  return { ...el, x: el.x + dx, y: el.y + dy };
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

// ----- Направляющие выравнивания (как в Miro и Figma) -----

/** Опорные линии рамки по оси: оба края и центр. */
export function boxAnchors(b: AABB, axis: 'x' | 'y'): number[] {
  return axis === 'x' ? [b.x0, (b.x0 + b.x1) / 2, b.x1] : [b.y0, (b.y0 + b.y1) / 2, b.y1];
}

/**
 * Сдвиг по оси (по модулю не больше tol), совмещающий одно из values (опорные линии того, что тянут)
 * с ближайшей опорной линией соседей; null — рядом ничего нет.
 */
export function alignShift(values: number[], others: AABB[], axis: 'x' | 'y', tol: number): number | null {
  let best: number | null = null;
  for (const o of others) {
    for (const t of boxAnchors(o, axis)) {
      for (const v of values) {
        const d = t - v;
        if (Math.abs(d) <= tol && (best === null || Math.abs(d) < Math.abs(best))) best = d;
      }
    }
  }
  return best;
}

/**
 * Направляющие через совпавшие (с точностью eps) опорные линии: values — линии того, что тянут (его рамка — box),
 * линия идёт от box до каждого совпавшего соседа; совпадения на одной линии сливаются в одну.
 */
export function alignGuides(box: AABB, values: number[], others: AABB[], axis: 'x' | 'y', eps: number): Guide[] {
  const out: Guide[] = [];
  for (const o of others) {
    for (const t of boxAnchors(o, axis)) {
      if (!values.some(v => Math.abs(v - t) <= eps)) continue;
      const from = axis === 'x' ? Math.min(box.y0, o.y0) : Math.min(box.x0, o.x0);
      const to = axis === 'x' ? Math.max(box.y1, o.y1) : Math.max(box.x1, o.x1);
      const same = out.find(g => Math.abs(g.at - t) <= eps);
      if (same) {
        same.from = Math.min(same.from, from);
        same.to = Math.max(same.to, to);
      } else {
        out.push({ axis, at: t, from, to });
      }
    }
  }
  return out;
}

/**
 * Камера окна демонстрации: область сцены, видимая в основном холсте (mainW×mainH),
 * целиком и по центру окна w×h — лишнее по краям добирается соседней частью доски.
 */
export function presentCamera(cam: Camera, mainW: number, mainH: number, w: number, h: number): Camera {
  const zoom = cam.zoom * Math.min(w / mainW, h / mainH);
  return {
    x: cam.x + mainW / cam.zoom / 2 - w / zoom / 2,
    y: cam.y + mainH / cam.zoom / 2 - h / zoom / 2,
    zoom,
  };
}
