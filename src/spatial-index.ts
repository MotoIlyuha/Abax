import type { AABB } from './geom';

const CELL = 1024;
const MAX_ELEMENT_CELLS = 64;
const MAX_QUERY_CELLS = 4096;

/** Индекс хранит позиции в исходном массиве, сохраняя порядок слоёв. */
export class SpatialIndex<T> {
  private readonly cells = new Map<string, number[]>();
  private readonly large: number[] = [];

  constructor(private readonly items: readonly T[], bounds: (item: T) => AABB) {
    items.forEach((item, i) => {
      const b = bounds(item);
      const x0 = Math.floor(b.x0 / CELL), x1 = Math.floor(b.x1 / CELL);
      const y0 = Math.floor(b.y0 / CELL), y1 = Math.floor(b.y1 / CELL);
      const count = (x1 - x0 + 1) * (y1 - y0 + 1);
      if (![x0, x1, y0, y1].every(Number.isSafeInteger) || count <= 0 || count > MAX_ELEMENT_CELLS) {
        this.large.push(i);
        return;
      }
      for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
        const key = `${x},${y}`;
        let cell = this.cells.get(key);
        if (!cell) this.cells.set(key, cell = []);
        cell.push(i);
      }
    });
  }

  query(b: AABB): readonly T[] {
    const x0 = Math.floor(b.x0 / CELL), x1 = Math.floor(b.x1 / CELL);
    const y0 = Math.floor(b.y0 / CELL), y1 = Math.floor(b.y1 / CELL);
    const count = (x1 - x0 + 1) * (y1 - y0 + 1);
    if (![x0, x1, y0, y1].every(Number.isSafeInteger) || count <= 0 || count > MAX_QUERY_CELLS) return this.items;
    const positions = new Set(this.large);
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
      for (const i of this.cells.get(`${x},${y}`) ?? []) positions.add(i);
    }
    return [...positions].sort((a, b) => a - b).map(i => this.items[i]);
  }
}
