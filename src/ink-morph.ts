import { measurePath, type InkPoint } from './ink-path';
import type { Pt, ShapeEl, PolyEl } from './types';

const SAMPLES = 96;
const wrap = (value: number) => value - Math.floor(value);

function outline(shape: ShapeEl | PolyEl): InkPoint[] {
  if (shape.type === 'poly') return [...shape.pts, shape.pts[0]];
  const { x, y, w, h } = shape;
  if (shape.shape === 'line') return [{ x, y }, { x: x + w, y: y + h }];
  const a = w / 2, b = h / 2;
  let local: number[][];
  if (shape.shape === 'ellipse') {
    local = Array.from({ length: SAMPLES }, (_, i) => {
      const t = 2 * Math.PI * i / SAMPLES;
      return [a * Math.cos(t), b * Math.sin(t)];
    });
  } else if (shape.shape === 'triangle') local = [[0, -b], [a, b], [-a, b]];
  else local = [[-a, -b], [a, -b], [a, b], [-a, b]];
  const cos = Math.cos(shape.rot ?? 0), sin = Math.sin(shape.rot ?? 0);
  const points = local.map(([dx, dy]) => ({ x: x + a + dx * cos - dy * sin, y: y + b + dx * sin + dy * cos }));
  return [...points, points[0]];
}

/** Совмещаем направление обхода и начало контура, иначе при переходе фигура перекрутится. */
export function prepareInkMorph(stroke: Pt[], shape: ShapeEl | PolyEl) {
  const source = measurePath(stroke);
  const target = measurePath(outline(shape));
  const closed = shape.type === 'poly' || shape.shape !== 'line';
  const fractions = Array.from({ length: SAMPLES + 1 }, (_, i) => i / SAMPLES);
  let start = 0, direction = 1;
  if (closed) {
    const from = fractions.slice(0, -1).map(source.at);
    const to = fractions.slice(0, -1).map(target.at);
    let best = Infinity;
    for (const sign of [1, -1]) {
      for (let k = 0; k < SAMPLES; k++) {
        let cost = 0;
        for (let i = 0; i < SAMPLES; i += 3) {
          const p = to[(k + sign * i + SAMPLES) % SAMPLES];
          cost += (from[i].x - p.x) ** 2 + (from[i].y - p.y) ** 2;
        }
        if (cost < best) { best = cost; start = k / SAMPLES; direction = sign; }
      }
    }
    // Вершины должны оказаться точно в конечном контуре даже при неравных сторонах.
    for (const length of target.lengths) fractions.push(wrap(direction * (length / target.length - start)));
  }
  if (stroke.length <= 256) {
    for (const length of source.lengths) fractions.push(length / source.length);
  }
  const times = [...new Set(fractions)].sort((a, b) => a - b);
  return {
    from: times.map(source.at),
    to: times.map(t => target.at(closed ? wrap(start + direction * t) : t)),
  };
}

export function inkMorphFrame(morph: ReturnType<typeof prepareInkMorph>, progress: number): Pt[] {
  const t = progress * progress * (3 - 2 * progress);
  return morph.from.map((a, i) => {
    const b = morph.to[i];
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, p: a.p + (0.5 - a.p) * t };
  });
}
