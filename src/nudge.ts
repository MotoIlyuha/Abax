// Перенос выделенного стрелками: нажатие сдвигает на шаг, удержание после паузы едет плавно,
// две непротивоположные стрелки — по диагонали.

/** Направление каждой стрелки в координатах экрана (y вниз). */
const DIRS: Record<string, readonly [number, number]> = {
  ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1],
};

/** Пауза после нажатия, после которой удержанная стрелка переходит от шага к плавному движению, мс. */
export const NUDGE_HOLD_MS = 350;
/** Скорость плавного движения, px экрана в секунду; с Shift — втрое быстрее. */
export const NUDGE_SPEED = 420;
export const NUDGE_FAST = 3;
/** Шаг одного нажатия без привязки к сетке, единиц сцены; с Shift — в десять раз больше. */
export const NUDGE_STEP = 1;
export const NUDGE_STEP_FAST = 10;

export function isArrowKey(code: string): boolean {
  return code in DIRS;
}

/**
 * Направление по удержанным стрелкам: противоположные гасят друг друга, две соседние дают диагональ
 * (единичной длины — по диагонали едут не быстрее, чем по прямой).
 */
export function arrowDirection(held: Iterable<string>): { x: number; y: number } {
  let x = 0, y = 0;
  for (const code of held) {
    const d = DIRS[code];
    if (d) { x += d[0]; y += d[1]; }
  }
  const len = Math.hypot(x, y);
  return len === 0 ? { x: 0, y: 0 } : { x: x / len, y: y / len };
}

/** Сдвиг одного нажатия стрелки: step — шаг в единицах сцены. */
export function arrowStep(code: string, step: number): { x: number; y: number } {
  const d = DIRS[code];
  return d ? { x: d[0] * step, y: d[1] * step } : { x: 0, y: 0 };
}
