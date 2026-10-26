import { describe, expect, it } from 'vitest';
import { arrowDirection, arrowStep, isArrowKey } from '../../src/nudge';

describe('перенос стрелками', () => {
  it('одна стрелка — своё направление, y растёт вниз', () => {
    expect(arrowDirection(['ArrowLeft'])).toEqual({ x: -1, y: 0 });
    expect(arrowDirection(['ArrowRight'])).toEqual({ x: 1, y: 0 });
    expect(arrowDirection(['ArrowUp'])).toEqual({ x: 0, y: -1 });
    expect(arrowDirection(['ArrowDown'])).toEqual({ x: 0, y: 1 });
  });

  it('две непротивоположные — диагональ единичной длины', () => {
    const d = arrowDirection(['ArrowRight', 'ArrowDown']);
    expect(d.x).toBeCloseTo(Math.SQRT1_2);
    expect(d.y).toBeCloseTo(Math.SQRT1_2);
    expect(Math.hypot(d.x, d.y)).toBeCloseTo(1);
    const back = arrowDirection(['ArrowLeft', 'ArrowUp']);
    expect(back.x).toBeCloseTo(-Math.SQRT1_2);
    expect(back.y).toBeCloseTo(-Math.SQRT1_2);
  });

  it('противоположные гасят друг друга; третья стрелка оставляет движение по оставшейся оси', () => {
    expect(arrowDirection(['ArrowLeft', 'ArrowRight'])).toEqual({ x: 0, y: 0 });
    expect(arrowDirection(['ArrowUp', 'ArrowDown'])).toEqual({ x: 0, y: 0 });
    expect(arrowDirection(['ArrowLeft', 'ArrowRight', 'ArrowDown'])).toEqual({ x: 0, y: 1 });
    expect(arrowDirection(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'])).toEqual({ x: 0, y: 0 });
    expect(arrowDirection([])).toEqual({ x: 0, y: 0 });
  });

  it('шаг нажатия и распознавание стрелок', () => {
    expect(arrowStep('ArrowLeft', 10)).toEqual({ x: -10, y: 0 });
    expect(arrowStep('ArrowDown', 2)).toEqual({ x: 0, y: 2 });
    expect(arrowStep('KeyA', 5)).toEqual({ x: 0, y: 0 });
    expect(isArrowKey('ArrowUp')).toBe(true);
    expect(isArrowKey('KeyW')).toBe(false);
  });
});
