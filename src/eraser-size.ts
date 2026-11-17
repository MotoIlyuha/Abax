// Размер ластика для пера и маркера зависит от скорости руки — как курсор на Mac, который
// разрастается, когда его «трясут» в поисках. Обычное движение — маленький кружок для
// точной стирки; чем быстрее двигают, тем он крупнее (пропорционально скорости сверх порога),
// а когда рука успокаивается, плавно сжимается обратно. Модуль чистый: время передаёт вызывающий.

/** Радиус ластика в покое, px экрана. */
export const ERASER_BASE_R = 5;
/** Предел разрастания, px экрана. */
export const ERASER_MAX_R = 56;
/** Скорость (px/с) до которой ластик остаётся маленьким: спокойная аккуратная стирка. */
const CALM_SPEED = 350;
/** Прирост радиуса на каждый px/с скорости сверх порога. */
const GROWTH_PER_SPEED = 0.02;
/** Постоянные времени, мс: сглаживание скорости, рост и сжатие радиуса. */
const SPEED_TAU = 45;
const GROW_TAU = 70;
const SHRINK_TAU = 320;
/** Пауза между событиями, после которой скорость не считаем (рука отпущена, новый заход). */
const STALE_MS = 150;

/** Радиус, к которому стремится ластик при данной скорости (px/с). */
export function targetEraserRadius(speed: number): number {
  const extra = Math.max(0, speed - CALM_SPEED) * GROWTH_PER_SPEED;
  return Math.min(ERASER_MAX_R, ERASER_BASE_R + extra);
}

export interface EraserMotion {
  x: number;
  y: number;
  /** Время последнего события, мс. */
  t: number;
  /** Сглаженная скорость на момент t, px/с. */
  speed: number;
  /** Радиус на момент t, px экрана. */
  r: number;
}

export function newEraserMotion(): EraserMotion {
  return { x: 0, y: 0, t: -Infinity, speed: 0, r: ERASER_BASE_R };
}

/** Радиус в момент now без изменения состояния: пока событий нет, скорость затухает, радиус сжимается. */
export function eraserRadiusAt(m: EraserMotion, now: number): number {
  const dt = now - m.t;
  if (!(dt > 0) || !Number.isFinite(dt)) return m.r;
  const target = targetEraserRadius(m.speed * Math.exp(-dt / SPEED_TAU));
  return target >= m.r ? m.r : target + (m.r - target) * Math.exp(-dt / SHRINK_TAU);
}

/** Движение указателя в экранной точке (x, y) в момент t: возвращает новое состояние. */
export function moveEraser(m: EraserMotion, x: number, y: number, t: number): EraserMotion {
  const dt = t - m.t;
  const r0 = eraserRadiusAt(m, t);
  if (!(dt > 0) || dt > STALE_MS) return { x, y, t, speed: 0, r: r0 };
  const inst = Math.hypot(x - m.x, y - m.y) / (dt / 1000);
  const k = 1 - Math.exp(-dt / SPEED_TAU);
  const speed = m.speed * (1 - k) + inst * k;
  const target = targetEraserRadius(speed);
  const r = target > r0 ? r0 + (target - r0) * (1 - Math.exp(-dt / GROW_TAU)) : r0;
  return { x, y, t, speed, r };
}

/** Ластик ещё крупнее покоя — нужен ли кадр анимации сжатия. */
export function eraserSettled(r: number): boolean {
  return r - ERASER_BASE_R < 0.15;
}

// ----- Общее состояние (один указатель на приложение) -----

let motion = newEraserMotion();

export function trackEraser(x: number, y: number, t: number = performance.now()): void {
  motion = moveEraser(motion, x, y, t);
}

/** Текущий радиус ластика, px экрана. */
export function eraserRadius(now: number = performance.now()): number {
  return eraserRadiusAt(motion, now);
}

/** Указатель ушёл с холста — новый заход начнётся с покоя. */
export function resetEraser(): void {
  motion = newEraserMotion();
}
