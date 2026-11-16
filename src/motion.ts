// Крошечный движок пружин для анимаций интерфейса (по мотивам motion.js с designbookmark.com/motion).
// Пружина — {x, v, t, k, c}: положение, скорость, цель, жёсткость, затухание.
// Один цикл requestAnimationFrame на всех; когда все компоненты успокоились, цикл засыпает
// и просыпается по wake() — доска не тратит кадры, пока ничего не движется.

export interface Spring { x: number; v: number; t: number; k: number; c: number }

/** Подставка для jsdom и случаев, когда matchMedia недоступен. */
export function reduceMotion(): boolean {
  try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}

/** «Motion анимации» включены в настройках (выключенные — класс no-motion на body). */
export const motionEnabled = (): boolean => !document.body.classList.contains('no-motion');

/** «Анимация меню и панелей» выключена: пружины встают на цель сразу. */
export const uiAnimOff = (): boolean => document.body.classList.contains('no-ui-anim');

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
  const dt = Math.min((now - last) / 1000, 1 / 30);
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

/** Будит цикл: вызывать после любого изменения целей пружин. */
export function wake(): void {
  if (running) return;
  running = true;
  last = performance.now();
  requestAnimationFrame(loop);
}
