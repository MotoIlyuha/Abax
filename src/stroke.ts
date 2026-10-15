import type { Pt } from './types';

/** Ширина в точке: давление 0..1 модулирует базовую толщину (~0.55x..1.45x). */
export function widthAt(base: number, p: number): number {
  const t = Math.max(0, Math.min(1, p));
  return base * (0.55 + 0.9 * t);
}

/**
 * Строит замкнутый контур переменной толщины («ленту») одним Path2D.
 * Один fill = без швов между сегментами и без двойного затемнения у маркера.
 * Все координаты — юниты сцены (масштабируются трансформом камеры).
 */
export function ribbonPath(pts: Pt[], base: number): Path2D {
  const path = new Path2D();
  const n = pts.length;
  if (n === 0) return path;
  if (n === 1) {
    const r = widthAt(base, pts[0].p) / 2;
    path.moveTo(pts[0].x + r, pts[0].y);
    path.arc(pts[0].x, pts[0].y, r, 0, Math.PI * 2);
    return path;
  }
  const nx = new Float64Array(n), ny = new Float64Array(n), hw = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    nx[i] = -dy / len; ny[i] = dx / len; // левая нормаль
    hw[i] = widthAt(base, pts[i].p) / 2;
  }
  path.moveTo(pts[0].x + nx[0] * hw[0], pts[0].y + ny[0] * hw[0]);
  for (let i = 1; i < n; i++) path.lineTo(pts[i].x + nx[i] * hw[i], pts[i].y + ny[i] * hw[i]);
  { // торцевая полудуга в последней точке, разворот на правую сторону
    const i = n - 1;
    const th = Math.atan2(ny[i], nx[i]);
    path.arc(pts[i].x, pts[i].y, hw[i], th, th - Math.PI, true);
  }
  for (let i = n - 2; i >= 0; i--) path.lineTo(pts[i].x - nx[i] * hw[i], pts[i].y - ny[i] * hw[i]);
  { // полудуга в первой точке, замыкание контура
    const th = Math.atan2(ny[0], nx[0]);
    path.arc(pts[0].x, pts[0].y, hw[0], th + Math.PI, th, true);
  }
  path.closePath();
  return path;
}
