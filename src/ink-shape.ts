import { distToSeg } from './geom';
import { measurePath } from './ink-path';
import type { PolyEl, Pt, ShapeEl } from './types';

type Point = Pick<Pt, 'x' | 'y'>;
type StyleKey = 'id' | 'color' | 'width' | 'opacity';
type InkShape = Omit<ShapeEl, StyleKey> | Omit<PolyEl, StyleKey>;

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const offset = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
const dot = (a: Point, b: Point) => a.x * b.x + a.y * b.y;
const cross = (a: Point, b: Point) => a.x * b.y - a.y * b.x;
const turn = (a: Point, b: Point) => Math.atan2(cross(a, b), dot(a, b));
const normal = (u: Point): Point => ({ x: -u.y, y: u.x });
const unit = (p: Point): Point => {
  const len = Math.hypot(p.x, p.y);
  return { x: p.x / len, y: p.y / len };
};

function bounds(points: readonly Point[], u: Point, origin: Point) {
  const v = normal(u);
  let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
  for (const point of points) {
    const p = offset(point, origin);
    const x = dot(p, u), y = dot(p, v);
    left = Math.min(left, x); right = Math.max(right, x);
    top = Math.min(top, y); bottom = Math.max(bottom, y);
  }
  const w = right - left, h = bottom - top;
  const cx = origin.x + u.x * (left + w / 2) + v.x * (top + h / 2);
  const cy = origin.y + u.y * (left + w / 2) + v.y * (top + h / 2);
  return { x: cx - w / 2, y: cy - h / 2, w, h, rot: Math.atan2(u.y, u.x) };
}

function ellipse(points: Point[], minSize: number): InkShape | null {
  // Равномерная выборка по длине не зависит от того, где рука двигалась медленнее.
  const path = measurePath(points);
  const sample = Array.from({ length: 96 }, (_, i) => path.at(i / 96));
  const mean = sample.reduce((m, p) => ({ x: m.x + p.x / sample.length, y: m.y + p.y / sample.length }), { x: 0, y: 0 });
  let xx = 0, yy = 0, xy = 0;
  for (const p of sample) {
    const { x, y } = offset(p, mean);
    xx += x * x; yy += y * y; xy += x * y;
  }
  const angle = Math.atan2(2 * xy, xx - yy) / 2;
  const u = { x: Math.cos(angle), y: Math.sin(angle) }, v = normal(u);
  const box = bounds(points, u, mean);
  if (Math.min(box.w, box.h) < minSize) return null;
  const center = { x: box.x + box.w / 2, y: box.y + box.h / 2 };
  const normalized = sample.map(p => {
    const d = offset(p, center);
    return { x: 2 * dot(d, u) / box.w, y: 2 * dot(d, v) / box.h };
  });
  let squaredError = 0, sweep = 0, travel = 0;
  for (let i = 0; i < normalized.length; i++) {
    const p = normalized[i];
    const error = Math.abs(Math.hypot(p.x, p.y) - 1);
    if (error > 0.38) return null;
    squaredError += error * error;
    const change = turn(p, normalized[(i + 1) % normalized.length]);
    sweep += change;
    travel += Math.abs(change);
  }
  if (squaredError / sample.length > 0.12 ** 2 || Math.abs(sweep) < 6 || travel > 7.5) return null;
  return { type: 'shape', shape: 'ellipse', ...box };
}

/** Упрощаем две дуги замкнутого контура, чтобы начало могло лежать посреди стороны. */
function corners(points: Point[], opposite: number, tolerance: number): number[] {
  const last = points.length - 1;
  const indices = [0, opposite];
  const spans = [[0, opposite], [opposite, last]];
  while (spans.length) {
    const [start, end] = spans.pop()!;
    const a = points[start], b = points[end];
    let max = tolerance, split = start;
    for (let i = start + 1; i < end; i++) {
      const p = points[i];
      const error = distToSeg(p.x, p.y, a.x, a.y, b.x, b.y);
      if (error > max) { max = error; split = i; }
    }
    if (split === start) continue;
    indices.push(split);
    if (indices.length > 33) return [];
    spans.push([start, split], [split, end]);
  }
  indices.sort((a, b) => a - b);
  for (let i = 0; i < indices.length && indices.length > 3;) {
    const a = points[indices[(i + indices.length - 1) % indices.length]];
    const p = points[indices[i]], b = points[indices[(i + 1) % indices.length]];
    if (distToSeg(p.x, p.y, a.x, a.y, b.x, b.y) <= tolerance) {
      indices.splice(i, 1);
      i = Math.max(0, i - 1);
    } else i++;
  }
  return indices;
}

function polygon(points: Point[], opposite: number, tolerance: number, perimeter: number): Point[] | null {
  const indices = corners(points, opposite, tolerance);
  if (indices.length < 3) return null;
  const vertices = indices.map(i => points[i]);
  const n = vertices.length, sampleCount = points.length - 1;
  let outline = 0;
  for (let i = 0; i < n; i++) {
    const p = vertices[i], prev = vertices[(i + n - 1) % n], next = vertices[(i + 1) % n];
    const edge = distance(p, next);
    outline += edge;
    if (edge < tolerance * 2) return null;

    // У настоящей вершины поворот сосредоточен около угла, у гладкой кривой он размазан по дуге.
    const radius = Math.min(distance(p, prev), edge) * 0.23;
    const nearby = (dir: number): Point => {
      let a = p;
      for (let j = (indices[i] + dir + sampleCount) % sampleCount; j !== indices[i]; j = (j + dir + sampleCount) % sampleCount) {
        const b = points[j], d = distance(p, b);
        if (d >= radius) {
          const t = (radius - distance(p, a)) / (d - distance(p, a));
          return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
        }
        a = b;
      }
      return p;
    };
    const fullTurn = turn(offset(p, prev), offset(next, p));
    const localTurn = turn(offset(p, nearby(-1)), offset(nearby(1), p));
    if (Math.abs(fullTurn) > 2.9 || Math.abs(fullTurn) < 0.28 || localTurn / fullTurn < 0.54) return null;
  }
  if (perimeter > outline * 1.14) return null;

  for (let i = 0; i < n; i++) {
    const a = vertices[i], b = vertices[(i + 1) % n];
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      const c = vertices[j], d = vertices[(j + 1) % n];
      if (cross(offset(b, a), offset(c, a)) * cross(offset(b, a), offset(d, a)) < 0 &&
          cross(offset(d, c), offset(a, c)) * cross(offset(d, c), offset(b, c)) < 0) return null;
    }
  }
  return vertices;
}

function rectangle(points: Point[]): InkShape | null {
  const edges = points.map((p, i) => offset(points[(i + 1) % 4], p));
  const directions = edges.map(unit);
  if (directions.some((u, i) => Math.abs(dot(u, directions[(i + 1) % 4])) > 0.36)) return null;
  if (dot(directions[0], directions[2]) >= 0 || dot(directions[1], directions[3]) >= 0) return null;
  const i = distance(points[0], points[1]) > distance(points[1], points[2]) ? 0 : 1;
  const u = unit(offset(directions[i], directions[i + 2]));
  const center = points.reduce((sum, p) => ({ x: sum.x + p.x / 4, y: sum.y + p.y / 4 }), { x: 0, y: 0 });
  const v = normal(u);
  const w = points.reduce((sum, p) => sum + Math.abs(dot(offset(p, center), u)) / 2, 0);
  const h = points.reduce((sum, p) => sum + Math.abs(dot(offset(p, center), v)) / 2, 0);
  const tolerance = Math.min(w, h) * 0.20;
  for (const p of points) {
    const d = offset(p, center);
    if (Math.abs(Math.abs(dot(d, u)) - w / 2) > tolerance ||
        Math.abs(Math.abs(dot(d, v)) - h / 2) > tolerance) return null;
  }
  return { type: 'shape', shape: 'rect', x: center.x - w / 2, y: center.y - h / 2, w, h, rot: Math.atan2(u.y, u.x) };
}

function triangle(points: Point[]): InkShape | null {
  let best: InkShape | null = null;
  let bestScore = Infinity;
  for (let i = 0; i < 3; i++) {
    const a = points[i], b = points[(i + 1) % 3], apex = points[(i + 2) % 3];
    const base = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const d = offset(apex, base);
    let u = unit(offset(b, a));
    if (cross(u, d) > 0) u = { x: -u.x, y: -u.y };
    const w = distance(a, b), h = -cross(u, d);
    const error = Math.abs(dot(u, d)) / Math.min(w, h);
    const score = error + 0.18 * Math.abs(u.y);
    if (error > 0.24 || score >= bestScore) continue;
    const center = { x: base.x + u.y * h / 2, y: base.y - u.x * h / 2 };
    best = { type: 'shape', shape: 'triangle', x: center.x - w / 2, y: center.y - h / 2, w, h, rot: Math.atan2(u.y, u.x) };
    bestScore = score;
  }
  return best;
}

function nativePolygon(vertices: Point[] | null): InkShape | null {
  if (vertices?.length === 3) return triangle(vertices);
  if (vertices?.length === 4) return rectangle(vertices);
  return null;
}

/** При перехлёсте ищем место встречи только у концов: внутренние петли сохраняются. */
function closeOutline(points: readonly Point[], path: ReturnType<typeof measurePath>, size: number) {
  const start = points[0], end = points[points.length - 1];
  const gap = distance(start, end);
  let best = gap, from = 0, to = 1;
  if (gap > size * 0.02) {
    const head = Array.from({ length: 17 }, (_, i) => path.at(i / 200));
    const tail = Array.from({ length: 17 }, (_, i) => path.at(1 - i / 200));
    for (let i = 0; i < head.length; i++) {
      for (let j = 0; j < tail.length; j++) {
        const d = distance(head[i], tail[j]);
        const score = d + path.length * (i + j) / 200 * 0.14;
        if (d <= size * 0.075 && score < best) {
          best = score; from = i / 200; to = 1 - j / 200;
        }
      }
    }
  }
  if (!from && to === 1) return [...points, start];
  const seam = path.at(from);
  return [seam, ...points.filter((_, i) => path.lengths[i] > from * path.length && path.lengths[i] < to * path.length), path.at(to), seam];
}

/** Подбирает геометрию по сырым координатам пера в единицах сцены. */
export function recognizeInkShape(path: readonly Point[], zoom: number): InkShape | null {
  if (path.length < 2) return null;
  const first = path[0], last = path[path.length - 1];
  const measured = measurePath(path);
  const gap = distance(first, last), length = measured.length;
  if (gap * zoom >= 20 && length <= gap * 1.08) {
    const tolerance = Math.max(2 / zoom, gap * 0.05);
    if (path.every(p => distToSeg(p.x, p.y, first.x, first.y, last.x, last.y) <= tolerance)) {
      return { type: 'shape', shape: 'line', x: first.x, y: first.y, w: last.x - first.x, h: last.y - first.y };
    }
  }

  const minSize = 14 / zoom;
  const box = bounds(path, { x: 1, y: 0 }, first);
  const size = Math.min(box.w, box.h);
  if (size < minSize || Math.max(box.w, box.h) * zoom < 20 || gap > Math.min(size * 0.42, length * 0.105)) return null;
  const closed = closeOutline(path, measured, size);
  let opposite = 0;
  for (let i = 1; i < closed.length; i++) {
    if (distance(closed[i], closed[0]) > distance(closed[opposite], closed[0])) opposite = i;
  }
  const perimeter = measurePath(closed).length;
  const vertices = polygon(closed, opposite, Math.max(2 / zoom, size * 0.035), perimeter);
  const fitted = nativePolygon(vertices);
  if (fitted) return fitted;
  // Скруглённый угол или выгнутая сторона иногда дают две вершины при мелком допуске.
  const hasShallowTurn = vertices?.some((p, i) => {
    const before = vertices[(i + vertices.length - 1) % vertices.length], after = vertices[(i + 1) % vertices.length];
    return Math.abs(turn(offset(p, before), offset(after, p))) < 0.65;
  });
  if (!vertices || hasShallowTurn) {
    const coarse = nativePolygon(polygon(closed, opposite, Math.max(2 / zoom, size * 0.13), perimeter));
    if (coarse) return coarse;
  }
  if (vertices) {
    return { type: 'poly', closed: true, pts: vertices.map(p => ({ ...p, p: 0.5 })) };
  }
  return ellipse(closed, minSize);
}
