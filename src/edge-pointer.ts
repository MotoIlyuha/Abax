// Краевые курсоры (SPEC_NIGHT5 §8): участник на моей странице, но за пределами видимой области — стрелка у края
// безопасной области экрана, повёрнутая в его сторону. Чистая геометрия без DOM.

export interface SafeInsets { top: number; right: number; bottom: number; left: number }

export interface EdgePointer {
  /** Точка на внутренней рамке безопасной области (экранные координаты). */
  x: number;
  y: number;
  /** Направление из центра безопасной области к участнику, радианы (Math.atan2(dy, dx)). */
  angle: number;
}

/**
 * Где рисовать краевой курсор для экранной точки (sx, sy) на экране w×h с отступами insets.
 * null — точка видна (внутри безопасной области) или область вырождена.
 */
export function computeEdgePointer(sx: number, sy: number, w: number, h: number, insets: SafeInsets): EdgePointer | null {
  if (!Number.isFinite(sx) || !Number.isFinite(sy)) return null;
  const left = insets.left;
  const top = insets.top;
  const right = w - insets.right;
  const bottom = h - insets.bottom;
  if (right - left < 2 || bottom - top < 2) return null;
  if (sx >= left && sx <= right && sy >= top && sy <= bottom) return null;
  const cx = (left + right) / 2;
  const cy = (top + bottom) / 2;
  const dx = sx - cx;
  const dy = sy - cy;
  // доля пути от центра до точки, на которой луч выходит на рамку
  const tx = dx !== 0 ? ((dx > 0 ? right : left) - cx) / dx : Infinity;
  const ty = dy !== 0 ? ((dy > 0 ? bottom : top) - cy) / dy : Infinity;
  const t = Math.min(tx, ty);
  return { x: cx + dx * t, y: cy + dy * t, angle: Math.atan2(dy, dx) };
}
