// Крошечный движок пружин для анимаций интерфейса (по мотивам motion.js с designbookmark.com/motion).
// Пружина — {x, v, t, k, c}: положение, скорость, цель, жёсткость, затухание.
// Один цикл requestAnimationFrame на всех; когда все компоненты успокоились, цикл засыпает
// и просыпается по wake() — доска не тратит кадры, пока ничего не движется.

import type { AnimationMode } from './types';

export interface Spring { x: number; v: number; t: number; k: number; c: number }

/** Подставка для jsdom и случаев, когда matchMedia недоступен. */
export function reduceMotion(): boolean {
  try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}

/** Пружины включены: режим анимаций «улучшенные» (в остальных режимах класс no-motion на body). */
export const motionEnabled = (): boolean => !document.body.classList.contains('no-motion');

/** Режим «выкл»: пружины встают на цель сразу, панели и меню без появления (класс no-ui-anim). */
export const uiAnimOff = (): boolean => document.body.classList.contains('no-ui-anim');

/**
 * Режим из сохранённых настроек. Если режима ещё нет, он выводится из двух старых флажков
 * (motionAnimations и uiAnimations). Потерянное при этом: сочетание «панели выкл, пружины вкл»
 * больше не существует, такой случай становится «улучшенные».
 */
export function resolveAnimationMode(saved: { animationMode?: unknown; motionAnimations?: unknown; uiAnimations?: unknown } | null | undefined): AnimationMode {
  if (saved && (saved.animationMode === 'off' || saved.animationMode === 'normal' || saved.animationMode === 'enhanced')) return saved.animationMode;
  if (saved && saved.motionAnimations === false) return saved.uiAnimations === false ? 'off' : 'normal';
  return 'enhanced';
}

export const S = (x: number, k = 400, c = 30): Spring => ({ x, v: 0, t: x, k, c });

/** Меняет жёсткость и затухание; при «уменьшить движение» затухание критическое — без перелёта. */
export function tune(s: Spring, k: number, c: number): void {
  s.k = k;
  s.c = reduceMotion() ? 2 * Math.sqrt(k) : c;
}

export function step(s: Spring, dt: number): void {
  const a = -s.k * (s.x - s.t) - s.c * s.v;
  s.v += a * dt;
  s.x += s.v * dt;
}

export const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));

/** Пружина дошла до цели и стоит. */
export const atRest = (s: Spring, eps = 0.01): boolean => Math.abs(s.x - s.t) < eps && Math.abs(s.v) < eps;

/** Мгновенно ставит пружину в цель. */
export function snap(s: Spring): void {
  s.x = s.t;
  s.v = 0;
}

/** «k c» из CSS-переменной (токены пружин лежат в style.css) → [жёсткость, затухание]. */
export function spring(name: string, fallback: readonly [number, number]): [number, number] {
  try {
    const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    const [k, c] = raw.split(/\s+/).map(Number);
    if (Number.isFinite(k) && Number.isFinite(c) && k > 0 && c > 0) return [k, c];
  } catch { /* нет CSS — берём запасные значения */ }
  return [fallback[0], fallback[1]];
}

export interface MotionComponent {
  /** Шаг симуляции; dt — секунды. */
  frame(dt: number): void;
  /** Запись результата в DOM. */
  render(): void;
  /** Всё стоит на месте — цикл может уснуть. */
  settled(): boolean;
}

const comps: MotionComponent[] = [];
let running = false;
let last = 0;

function loop(now: number): void {
  // первый кадр после пробуждения — номинальный: метка кадра и performance.now() могут идти от разных начал
  // (jsdom) или кадр мог начаться раньше вызова wake(); шаг назад во времени раскачал бы пружины
  const dt = last < 0 ? 1 / 60 : Math.max(0, Math.min((now - last) / 1000, 1 / 30));
  last = now;
  const sub = 4; // подшаги: жёсткие пружины устойчивы только при мелком шаге
  for (let k = 0; k < sub; k++) for (const c of comps) c.frame(dt / sub);
  for (const c of comps) c.render();
  if (comps.every(c => c.settled())) { running = false; return; }
  requestAnimationFrame(loop);
}

export function register(c: MotionComponent): void {
  comps.push(c);
}

/** Снимает компонент с цикла (компонент, который живёт не всё время, например в окне). */
export function unregister(c: MotionComponent): void {
  const i = comps.indexOf(c);
  if (i >= 0) comps.splice(i, 1);
}

/** Будит цикл: вызывать после любого изменения целей пружин. */
export function wake(): void {
  if (running) return;
  running = true;
  last = -1;
  requestAnimationFrame(loop);
}
