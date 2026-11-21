import { describe, expect, it } from 'vitest';
import {
  ERASER_BASE_R, ERASER_MAX_R, eraserRadiusAt, eraserSettled, moveEraser, newEraserMotion, targetEraserRadius,
} from '../../src/eraser-size';

/** Прогоняет движение с постоянной скоростью (px/с) на частоте 120 Гц, возвращает состояние. */
function run(speed: number, ms: number, from = newEraserMotion(), t0 = 1000) {
  let m = moveEraser(from, 0, 0, t0);
  const dt = 1000 / 120;
  let x = 0;
  for (let t = dt; t <= ms; t += dt) {
    x += speed * dt / 1000;
    m = moveEraser(m, x, 0, t0 + t);
  }
  return m;
}

describe('размер ластика от скорости', () => {
  it('в покое и при спокойной руке - маленький', () => {
    expect(targetEraserRadius(0)).toBe(ERASER_BASE_R);
    expect(targetEraserRadius(300)).toBe(ERASER_BASE_R);
    expect(run(200, 600).r).toBeCloseTo(ERASER_BASE_R, 5);
  });

  it('чем быстрее рука, тем крупнее, но не больше предела', () => {
    const slow = run(900, 800).r;
    const fast = run(2200, 800).r;
    expect(slow).toBeGreaterThan(ERASER_BASE_R + 3);
    expect(fast).toBeGreaterThan(slow + 5);
    expect(run(50000, 800).r).toBeLessThanOrEqual(ERASER_MAX_R);
    expect(run(50000, 800).r).toBeGreaterThan(ERASER_MAX_R - 3);
  });

  it('когда рука остановилась, ластик плавно сжимается до маленького', () => {
    const fast = run(2500, 800);
    const t = fast.t;
    const r0 = eraserRadiusAt(fast, t);
    const r1 = eraserRadiusAt(fast, t + 200);
    const r2 = eraserRadiusAt(fast, t + 1500);
    expect(r0).toBeGreaterThan(20);
    expect(r1).toBeLessThan(r0);
    expect(r1).toBeGreaterThan(r2);
    expect(eraserSettled(eraserRadiusAt(fast, t + 4000))).toBe(true);
    expect(eraserRadiusAt(fast, t - 5)).toBe(fast.r); // время назад не ломает
  });

  it('после долгой паузы скорость не считается: прыжок указателя не раздувает ластик', () => {
    const m = moveEraser(newEraserMotion(), 0, 0, 1000);
    const jumped = moveEraser(m, 3000, 0, 1400);
    expect(jumped.r).toBe(ERASER_BASE_R);
    expect(jumped.speed).toBe(0);
  });

  it('чистая функция: исходное состояние не меняется', () => {
    const m = run(2000, 300);
    const copy = { ...m };
    eraserRadiusAt(m, m.t + 500);
    moveEraser(m, 5, 5, m.t + 8);
    expect(m).toEqual(copy);
  });
});
