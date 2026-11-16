import { describe, expect, it } from 'vitest';
import { S, atRest, clamp, snap, spring, step, tune } from '../../src/motion';

describe('движок пружин', () => {
  it('пружина приходит к цели и успокаивается', () => {
    const s = S(0, 620, 36);
    s.t = 100;
    for (let i = 0; i < 2000; i++) step(s, 1 / 240);
    expect(s.x).toBeCloseTo(100, 1);
    expect(atRest(s, 0.05)).toBe(true);
  });

  it('мягкое затухание даёт перелёт, критическое — нет', () => {
    const run = (k: number, c: number) => {
      const s = S(0, k, c);
      s.t = 1;
      let max = 0;
      for (let i = 0; i < 2000; i++) { step(s, 1 / 240); max = Math.max(max, s.x); }
      return max;
    };
    expect(run(520, 16)).toBeGreaterThan(1.05);
    expect(run(620, 2 * Math.sqrt(620))).toBeLessThan(1.001);
  });

  it('tune меняет жёсткость и затухание', () => {
    const s = S(0);
    tune(s, 190, 19);
    expect([s.k, s.c]).toEqual([190, 19]);
  });

  it('snap ставит пружину в цель и гасит скорость', () => {
    const s = S(0);
    s.t = 5;
    s.v = 3;
    snap(s);
    expect([s.x, s.v]).toEqual([5, 0]);
  });

  it('spring читает токен «k c» и подставляет запасное значение без CSS', () => {
    expect(spring('--нет-такого', [620, 36])).toEqual([620, 36]);
    document.documentElement.style.setProperty('--spring-test', '190 19');
    expect(spring('--spring-test', [1, 1])).toEqual([190, 19]);
    document.documentElement.style.removeProperty('--spring-test');
  });

  it('clamp', () => {
    expect([clamp(5, 0, 3), clamp(-1, 0, 3), clamp(2, 0, 3)]).toEqual([3, 0, 2]);
  });
});
