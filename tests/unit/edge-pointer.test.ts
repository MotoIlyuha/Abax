import { describe, expect, it } from 'vitest';
import { computeEdgePointer } from '../../src/edge-pointer';

const insets = { top: 50, right: 10, bottom: 60, left: 40 };
// безопасная область: x 40..990, y 50..740 при экране 1000×800; центр (515, 395)

describe('краевой курсор', () => {
  it('точка внутри безопасной области — не нужен', () => {
    expect(computeEdgePointer(500, 400, 1000, 800, insets)).toBeNull();
    expect(computeEdgePointer(40, 50, 1000, 800, insets)).toBeNull();
  });

  it('точка под шапкой (на экране, но вне безопасной области) — нужен', () => {
    const p = computeEdgePointer(515, 20, 1000, 800, insets)!;
    expect(p.x).toBeCloseTo(515);
    expect(p.y).toBeCloseTo(50);
    expect(p.angle).toBeCloseTo(-Math.PI / 2);
  });

  it('справа по горизонтали — на правой рамке, угол 0', () => {
    const p = computeEdgePointer(3000, 395, 1000, 800, insets)!;
    expect(p).toMatchObject({ x: 990, y: 395 });
    expect(p.angle).toBeCloseTo(0);
  });

  it('слева — угол π', () => {
    const p = computeEdgePointer(-500, 395, 1000, 800, insets)!;
    expect(p.x).toBeCloseTo(40);
    expect(Math.abs(p.angle)).toBeCloseTo(Math.PI);
  });

  it('по диагонали — точка лежит на луче и на рамке', () => {
    const p = computeEdgePointer(2000, 2000, 1000, 800, insets)!;
    const onRight = Math.abs(p.x - 990) < 1e-9;
    const onBottom = Math.abs(p.y - 740) < 1e-9;
    expect(onRight || onBottom).toBe(true);
    expect(p.x).toBeGreaterThanOrEqual(40);
    expect(p.x).toBeLessThanOrEqual(990);
    expect(p.y).toBeGreaterThanOrEqual(50);
    expect(p.y).toBeLessThanOrEqual(740);
    // направление совпадает с лучом из центра
    expect(Math.atan2(p.y - 395, p.x - 515)).toBeCloseTo(p.angle);
    expect(p.angle).toBeCloseTo(Math.atan2(2000 - 395, 2000 - 515));
  });

  it('вырожденная область и нечисловые координаты — нет курсора', () => {
    expect(computeEdgePointer(5000, 5000, 50, 50, insets)).toBeNull();
    expect(computeEdgePointer(Number.NaN, 0, 1000, 800, insets)).toBeNull();
    expect(computeEdgePointer(Infinity, 0, 1000, 800, insets)).toBeNull();
  });
});
