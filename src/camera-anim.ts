import type { Camera } from './types';
import { state, update, ZOOM_MAX, ZOOM_MIN } from './state';

// Плавный перелёт камеры (SPEC_NIGHT5 §8): к курсору участника, по «Позвать всех» и автопереходу за автором.
// Математика — чистые функции; запуск — animateCameraTo (src/controller.ts прерывает его жестом пользователя).

export const CAMERA_ANIM_MS = 320;

export function easeInOutCubic(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

export function clampZoom(z: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
}

/** Камера, у которой мировая точка (wx, wy) — в центре экрана w×h. */
export function cameraCentering(wx: number, wy: number, zoom: number, w: number, h: number): Camera {
  const z = clampZoom(zoom);
  return { zoom: z, x: wx - w / 2 / z, y: wy - h / 2 / z };
}

/** Центр экрана в мировых координатах и зум (то, что участник шлёт в {t:'view'}). */
export function viewCenter(cam: Camera, w: number, h: number): { vx: number; vy: number; vz: number } {
  return { vx: cam.x + w / 2 / cam.zoom, vy: cam.y + h / 2 / cam.zoom, vz: cam.zoom };
}

/** Промежуточная камера: центр — по прямой, зум — по логарифму (одинаковая скорость приближения и удаления). */
export function cameraLerp(from: Camera, to: Camera, t: number, w: number, h: number): Camera {
  if (t <= 0) return { ...from };
  if (t >= 1) return { ...to };
  const a = viewCenter(from, w, h);
  const b = viewCenter(to, w, h);
  const zoom = Math.exp(Math.log(from.zoom) + (Math.log(to.zoom) - Math.log(from.zoom)) * t);
  return cameraCentering(a.vx + (b.vx - a.vx) * t, a.vy + (b.vy - a.vy) * t, zoom, w, h);
}

/** Анимации выключены: настройка «Motion анимации», «Анимации интерфейса» или системное «уменьшить движение». */
export function motionReduced(): boolean {
  if (typeof document !== 'undefined' && (document.body.classList.contains('no-motion') || document.body.classList.contains('no-ui-anim'))) return true;
  try { return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true; } catch { return false; }
}

/** Размер холста (CSS px): к нему относится камера. */
export function viewportSize(): { w: number; h: number } {
  const c = typeof document !== 'undefined' ? document.getElementById('board') : null;
  const w = c?.clientWidth || (typeof window !== 'undefined' ? window.innerWidth : 0) || 0;
  const h = c?.clientHeight || (typeof window !== 'undefined' ? window.innerHeight : 0) || 0;
  return { w, h };
}

export interface CameraAnimDeps {
  now?: () => number;
  raf?: (fn: (t: number) => void) => number;
  caf?: (id: number) => void;
  size?: () => { w: number; h: number };
  reduced?: () => boolean;
}

let running: { frame: number; caf: (id: number) => void } | null = null;

/** Остановить перелёт (жест пользователя или новый перелёт); камера остаётся там, где была. */
export function cancelCameraAnim(): void {
  if (!running) return;
  running.caf(running.frame);
  running = null;
}

export function cameraAnimating(): boolean {
  return running !== null;
}

/**
 * Плавно навести камеру центром на мировую точку (wx, wy); zoom — новый масштаб (нет — текущий).
 * Без анимаций (настройки или reduced motion) — сразу.
 */
export function animateCameraTo(wx: number, wy: number, zoom?: number, durationMs = CAMERA_ANIM_MS, deps: CameraAnimDeps = {}): void {
  if (!Number.isFinite(wx) || !Number.isFinite(wy)) return;
  cancelCameraAnim();
  const { w, h } = (deps.size ?? viewportSize)();
  const from = { ...state.camera };
  const to = cameraCentering(wx, wy, zoom !== undefined && Number.isFinite(zoom) && zoom > 0 ? zoom : from.zoom, w, h);
  const reduced = (deps.reduced ?? motionReduced)();
  const raf = deps.raf ?? ((fn: (t: number) => void) => window.requestAnimationFrame(fn));
  const caf = deps.caf ?? ((id: number) => window.cancelAnimationFrame(id));
  if (reduced || durationMs <= 0 || typeof raf !== 'function') {
    state.camera = to;
    update();
    return;
  }
  const now = deps.now ?? (() => performance.now());
  const start = now();
  const anim = { frame: 0, caf };
  const step = (): void => {
    if (running !== anim) return;
    const t = Math.min(1, (now() - start) / durationMs);
    state.camera = cameraLerp(from, to, easeInOutCubic(t), w, h);
    update();
    if (t >= 1) { running = null; return; }
    anim.frame = raf(step);
  };
  running = anim;
  anim.frame = raf(step);
}
