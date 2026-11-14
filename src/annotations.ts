import type { Camera, CommentThread, Element } from './types';
import { elementAABB } from './geom';

// Пилюли реакций и пины комментариев на доске. Раскладка в экранных пикселях: одна и та же для отрисовки
// (renderer.ts) и для нажатий (controller.ts). Только расчёт, без рисования.

export const PILL_H = 22;
const PILL_GAP = 4;
const PILL_OFFSET = 6;
export const MAX_PILLS = 6;
export const PIN_R = 11;

export interface PillBox { x: number; y: number; w: number; h: number; elId: string; emoji: string; count: number; mine: boolean }
export interface PinBox { x: number; y: number; r: number; threadId: string; count: number; resolved: boolean }

/** Ширина пилюли: отступы, эмодзи и число — без измерения текста, чтобы раскладка не зависела от холста. */
export function pillWidth(count: number): number {
  return 10 + 16 + 4 + 7 * String(count).length + 8;
}

/** Пилюли под нижней границей каждого элемента с реакциями; те, что целиком за экраном, пропускаются. */
export function layoutPills(els: readonly Element[], cam: Camera, userId: string, viewW: number, viewH: number): PillBox[] {
  const out: PillBox[] = [];
  for (const el of els) {
    if (!el.reactions) continue;
    const a = elementAABB(el);
    const y = (a.y1 - cam.y) * cam.zoom + PILL_OFFSET;
    let x = (a.x0 - cam.x) * cam.zoom;
    if (y > viewH || y + PILL_H < 0 || (a.x1 - cam.x) * cam.zoom < 0 || x > viewW) continue;
    let shown = 0;
    for (const [emoji, users] of Object.entries(el.reactions)) {
      if (users.length === 0 || shown >= MAX_PILLS) continue;
      const w = pillWidth(users.length);
      out.push({ x, y, w, h: PILL_H, elId: el.id, emoji, count: users.length, mine: users.includes(userId) });
      x += w + PILL_GAP;
      shown++;
    }
  }
  return out;
}

/** Пины комментариев в их точках; те, что за экраном, пропускаются. */
export function layoutPins(threads: readonly CommentThread[] | undefined, cam: Camera, viewW: number, viewH: number): PinBox[] {
  const out: PinBox[] = [];
  for (const t of threads ?? []) {
    const x = (t.x - cam.x) * cam.zoom;
    const y = (t.y - cam.y) * cam.zoom;
    if (x < -PIN_R || y < -PIN_R || x > viewW + PIN_R || y > viewH + PIN_R) continue;
    out.push({ x, y, r: PIN_R, threadId: t.id, count: t.messages.length, resolved: !!t.resolved });
  }
  return out;
}

export type AnnotationHit = { kind: 'pill'; pill: PillBox } | { kind: 'pin'; pin: PinBox };

/** Что под точкой экрана: пин важнее пилюли (он рисуется сверху). */
export function hitAnnotation(pills: readonly PillBox[], pins: readonly PinBox[], x: number, y: number): AnnotationHit | null {
  for (let i = pins.length - 1; i >= 0; i--) {
    const p = pins[i];
    if (Math.hypot(x - p.x, y - p.y) <= p.r + 2) return { kind: 'pin', pin: p };
  }
  for (let i = pills.length - 1; i >= 0; i--) {
    const p = pills[i];
    if (x >= p.x && x <= p.x + p.w && y >= p.y && y <= p.y + p.h) return { kind: 'pill', pill: p };
  }
  return null;
}
