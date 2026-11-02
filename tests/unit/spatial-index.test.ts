import { describe, expect, it } from 'vitest';
import { SpatialIndex } from '../../src/spatial-index';

describe('пространственный индекс', () => {
  it('возвращает пересекающиеся объекты в порядке слоёв, без повторов', () => {
    const items = [
      { x0: -1100, y0: -20, x1: 1100, y1: 20 },
      { x0: 9000, y0: 9000, x1: 9100, y1: 9100 },
      { x0: -20, y0: -20, x1: 20, y1: 20 },
      { x0: -100000, y0: -100000, x1: 100000, y1: 100000 },
    ];
    const index = new SpatialIndex(items, x => x);
    expect(index.query({ x0: -10, y0: -10, x1: 10, y1: 10 })).toEqual([items[0], items[2], items[3]]);
    expect(index.query({ x0: -1e9, y0: -1e9, x1: 1e9, y1: 1e9 })).toBe(items);
  });

  it('не теряет пересекающиеся объекты для разных положений и размеров', () => {
    const items = Array.from({ length: 1000 }, (_, i) => ({
      x0: (i * 317 % 15000) - 7500, y0: (i * 751 % 15000) - 7500,
      x1: (i * 317 % 15000) - 7300, y1: (i * 751 % 15000) - 7200,
    }));
    const index = new SpatialIndex(items, x => x);
    for (let x = -8000; x < 8000; x += 1300) {
      const view = { x0: x, y0: x / 2, x1: x + 1700, y1: x / 2 + 1300 };
      const expected = items.filter(b => b.x0 <= view.x1 && b.x1 >= view.x0 && b.y0 <= view.y1 && b.y1 >= view.y0);
      const actual = index.query(view).filter(b => b.x0 <= view.x1 && b.x1 >= view.x0 && b.y0 <= view.y1 && b.y1 >= view.y0);
      expect(actual).toEqual(expected);
    }
  });
});
