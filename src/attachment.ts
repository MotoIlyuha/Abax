import { hitTest } from './geom';
import type { Element } from './types';

/** The uppermost eligible foundation containing at least two thirds of the object. */
export function foundationFor(item: Element, elements: Element[], excluded = new Set<string>()): Element | undefined {
  if (item.type !== 'stroke' && item.type !== 'note') return undefined;
  const itemIndex = elements.findIndex(e => e.id === item.id);
  // Only objects below the item in the layer stack can be foundations.
  const candidates = elements.slice(0, itemIndex < 0 ? elements.length : itemIndex).filter(e => !excluded.has(e.id) && e.id !== item.id &&
    (item.type === 'note' ? e.type === 'image' : e.type === 'image' || e.type === 'note' || (e.type === 'shape' && e.shape !== 'line' && e.shape !== 'arrow')));
  for (const base of candidates.reverse()) {
    let inside = 0, total = 0;
    if (item.type === 'note') {
      const n = 30;
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        total++; if (hitTest(base, item.x + item.w * (x + .5) / n, item.y + item.h * (y + .5) / n, 0)) inside++;
      }
    } else {
      const pts = item.pts;
      if (pts.length === 1) { total = 1; inside = hitTest(base, pts[0].x, pts[0].y, 0) ? 1 : 0; }
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i], length = Math.hypot(b.x - a.x, b.y - a.y);
        const n = Math.max(1, Math.ceil(length / 2));
        for (let j = 0; j < n; j++) {
          const t = (j + .5) / n, weight = length / n;
          total += weight; if (hitTest(base, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, 0)) inside += weight;
        }
      }
    }
    if (total > 0 && inside / total >= 2 / 3) return base;
  }
}

export function withAttached(ids: Set<string>, elements: Element[]): Set<string> {
  const result = new Set(ids);
  let changed = true;
  while (changed) {
    changed = false;
    for (const item of elements) {
      if (result.has(item.id)) continue;
      const base = foundationFor(item, elements);
      if (base && result.has(base.id)) { result.add(item.id); changed = true; }
    }
  }
  return result;
}
