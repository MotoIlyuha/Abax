import { beforeEach, describe, expect, it } from 'vitest';
import {
  animateCameraTo, cameraAnimating, cameraCentering, cameraLerp, cancelCameraAnim, clampZoom, easeInOutCubic, viewCenter,
} from '../../src/camera-anim';
import { ZOOM_MAX, ZOOM_MIN, state } from '../../src/state';

const W = 1000;
const H = 600;
const size = () => ({ w: W, h: H });

/** Ручной requestAnimationFrame: кадры вызываются тестом. */
function frames() {
  let t = 0;
  const queue = new Map<number, (t: number) => void>();
  let id = 0;
  return {
    now: () => t,
    raf: (fn: (t: number) => void) => { queue.set(++id, fn); return id; },
    caf: (i: number) => { queue.delete(i); },
    tick(ms: number) {
      t += ms;
      const fns = [...queue.values()];
      queue.clear();
      for (const fn of fns) fn(t);
    },
    pending: () => queue.size,
  };
}

describe('математика перелёта камеры', () => {
  it('easeInOutCubic: границы, середина, монотонность', () => {
    expect(easeInOutCubic(0)).toBe(0);
    expect(easeInOutCubic(1)).toBe(1);
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5);
    expect(easeInOutCubic(-1)).toBe(0);
    expect(easeInOutCubic(2)).toBe(1);
    let prev = 0;
    for (let i = 1; i <= 20; i++) { const v = easeInOutCubic(i / 20); expect(v).toBeGreaterThanOrEqual(prev); prev = v; }
  });

  it('камера с точкой в центре и обратно', () => {
    const cam = cameraCentering(300, -40, 2, W, H);
    expect(cam.zoom).toBe(2);
    const c = viewCenter(cam, W, H);
    expect(c.vx).toBeCloseTo(300);
    expect(c.vy).toBeCloseTo(-40);
    expect(c.vz).toBe(2);
    expect(clampZoom(1000)).toBe(ZOOM_MAX);
    expect(clampZoom(0)).toBe(ZOOM_MIN);
    expect(cameraCentering(0, 0, 999, W, H).zoom).toBe(ZOOM_MAX);
  });

  it('промежуточная камера: центр по прямой, зум по логарифму', () => {
    const a = cameraCentering(0, 0, 1, W, H);
    const b = cameraCentering(100, 200, 4, W, H);
    expect(cameraLerp(a, b, 0, W, H)).toEqual(a);
    expect(cameraLerp(a, b, 1, W, H)).toEqual(b);
    const mid = cameraLerp(a, b, 0.5, W, H);
    expect(mid.zoom).toBeCloseTo(2);
    const c = viewCenter(mid, W, H);
    expect(c.vx).toBeCloseTo(50);
    expect(c.vy).toBeCloseTo(100);
  });
});

describe('animateCameraTo', () => {
  beforeEach(() => {
    cancelCameraAnim();
    state.camera = { x: 0, y: 0, zoom: 1 };
    document.body.className = '';
  });

  it('без анимаций (reduced motion) — сразу в точку', () => {
    animateCameraTo(500, 400, 2, 320, { size, reduced: () => true });
    expect(cameraAnimating()).toBe(false);
    const c = viewCenter(state.camera, W, H);
    expect(c.vx).toBeCloseTo(500);
    expect(c.vy).toBeCloseTo(400);
    expect(state.camera.zoom).toBe(2);
  });

  it('класс no-motion на body — тоже сразу', () => {
    document.body.classList.add('no-motion');
    const f = frames();
    animateCameraTo(10, 20, undefined, 320, { size, raf: f.raf, caf: f.caf, now: f.now });
    expect(f.pending()).toBe(0);
    expect(viewCenter(state.camera, W, H).vx).toBeCloseTo(10);
    expect(state.camera.zoom).toBe(1); // без zoom — масштаб прежний
  });

  it('плавно: кадры приближают камеру, в конце точка в центре', () => {
    const f = frames();
    animateCameraTo(1000, 0, 4, 320, { size, raf: f.raf, caf: f.caf, now: f.now, reduced: () => false });
    expect(cameraAnimating()).toBe(true);
    f.tick(160);
    const mid = viewCenter(state.camera, W, H);
    expect(mid.vx).toBeGreaterThan(500);
    expect(mid.vx).toBeLessThan(1000);
    expect(state.camera.zoom).toBeGreaterThan(1);
    expect(state.camera.zoom).toBeLessThan(4);
    f.tick(200);
    expect(cameraAnimating()).toBe(false);
    expect(viewCenter(state.camera, W, H).vx).toBeCloseTo(1000);
    expect(state.camera.zoom).toBe(4);
    expect(f.pending()).toBe(0);
  });

  it('прерывание: камера остаётся, где была, кадры больше не двигают её', () => {
    const f = frames();
    animateCameraTo(1000, 0, 1, 320, { size, raf: f.raf, caf: f.caf, now: f.now, reduced: () => false });
    f.tick(100);
    const at = { ...state.camera };
    cancelCameraAnim();
    expect(cameraAnimating()).toBe(false);
    f.tick(300);
    expect(state.camera).toEqual(at);
  });

  it('новый перелёт отменяет прежний', () => {
    const f = frames();
    animateCameraTo(1000, 0, 1, 320, { size, raf: f.raf, caf: f.caf, now: f.now, reduced: () => false });
    f.tick(50);
    animateCameraTo(-500, 0, 1, 320, { size, raf: f.raf, caf: f.caf, now: f.now, reduced: () => false });
    f.tick(400);
    expect(viewCenter(state.camera, W, H).vx).toBeCloseTo(-500);
  });

  it('нечисловая цель — ничего', () => {
    animateCameraTo(Number.NaN, 0, 1, 320, { size, reduced: () => true });
    expect(state.camera).toEqual({ x: 0, y: 0, zoom: 1 });
  });
});
