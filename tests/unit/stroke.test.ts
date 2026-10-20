import { describe, expect, it } from 'vitest';
import { ribbonPath, widthAt } from '../../src/stroke';

type Op = [string, ...number[]];
const opsOf = (p: Path2D) => (p as unknown as { ops: Op[] }).ops;

describe('widthAt', () => {
  it('модулирует толщину давлением в диапазоне 0.55x..1.45x', () => {
    expect(widthAt(10, 0)).toBeCloseTo(5.5);
    expect(widthAt(10, 0.5)).toBeCloseTo(10);
    expect(widthAt(10, 1)).toBeCloseTo(14.5);
  });

  it('ограничивает давление отрезком 0..1', () => {
    expect(widthAt(10, -3)).toBeCloseTo(widthAt(10, 0));
    expect(widthAt(10, 7)).toBeCloseTo(widthAt(10, 1));
  });
});

describe('ribbonPath', () => {
  it('пустой штрих — пустой контур', () => {
    expect(opsOf(ribbonPath([], 4))).toEqual([]);
  });

  it('одна точка — круг радиусом в полширины', () => {
    const ops = opsOf(ribbonPath([{ x: 10, y: 20, p: 0.5 }], 4));
    expect(ops[0]).toEqual(['moveTo', 12, 20]);
    expect(ops[1][0]).toBe('arc');
    expect(ops[1].slice(1, 4)).toEqual([10, 20, 2]);
  });

  it('отрезок — замкнутая лента с полудугами на концах', () => {
    const ops = opsOf(ribbonPath([{ x: 0, y: 0, p: 0.5 }, { x: 10, y: 0, p: 0.5 }], 4));
    const kinds = ops.map(o => o[0]);
    expect(kinds).toEqual(['moveTo', 'lineTo', 'arc', 'lineTo', 'arc', 'closePath']);
    // левая сторона ленты: нормаль (0, 1) при движении вправо, полуширина 2
    expect(ops[0]).toEqual(['moveTo', 0, 2]);
    expect(ops[1]).toEqual(['lineTo', 10, 2]);
    // правая сторона — обратный проход
    expect(ops[3]).toEqual(['lineTo', 0, -2]);
  });

  it('совпадающие точки не дают NaN в нормалях', () => {
    const ops = opsOf(ribbonPath([{ x: 5, y: 5, p: 0.5 }, { x: 5, y: 5, p: 0.5 }], 4));
    for (const op of ops) for (const v of op.slice(1)) expect(Number.isFinite(v)).toBe(true);
  });
});
