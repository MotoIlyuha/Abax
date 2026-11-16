import type { Camera, Element } from './types';
import { aabbUnion, elementAABB } from './geom';
import { state, update } from './state';

// Ссылки на доску: разбор и сборка — в board-url.ts (там нет DOM); здесь то, что наводит камеру на объекты.

import { FOCUS_FLASH_MS, FOCUS_PADDING, FOCUS_ZOOM_MAX, FOCUS_ZOOM_MIN } from './board-url';

export * from './board-url';

/**
 * Камера, в которой элементы els целиком видны на холсте viewportW×viewportH с отступом padding (px экрана),
 * масштаб — в пределах 0.1…4. null — нечего показывать или холст нулевой.
 */
export function computeFocusCamera(els: readonly Element[], viewportW: number, viewportH: number, padding = FOCUS_PADDING): Camera | null {
  if (els.length === 0 || !(viewportW > 0) || !(viewportH > 0)) return null;
  const bb = els.map(elementAABB).reduce(aabbUnion);
  const bw = bb.x1 - bb.x0, bh = bb.y1 - bb.y0;
  // холст меньше двух отступов: отступ только мешал бы
  const pad = Math.max(0, padding);
  const px = viewportW > pad * 2 ? pad : 0;
  const py = viewportH > pad * 2 ? pad : 0;
  const fits: number[] = [];
  if (bw > 0) fits.push((viewportW - px * 2) / bw);
  if (bh > 0) fits.push((viewportH - py * 2) / bh);
  const zoom = Math.min(FOCUS_ZOOM_MAX, Math.max(FOCUS_ZOOM_MIN, fits.length > 0 ? Math.min(...fits) : FOCUS_ZOOM_MAX));
  const cx = (bb.x0 + bb.x1) / 2, cy = (bb.y0 + bb.y1) / 2;
  return { zoom, x: cx - viewportW / (2 * zoom), y: cy - viewportH / (2 * zoom) };
}

/**
 * Наводит камеру на элементы активной страницы и подсвечивает их контур на 2 секунды.
 * Отсутствующие id пропускаются. false — ни одного элемента не нашлось, камера не тронута.
 */
export function focusElementsOnBoard(ids: readonly string[], viewportW: number, viewportH: number): boolean {
  const want = new Set(ids);
  const found = state.board.elements.filter(el => want.has(el.id));
  const camera = computeFocusCamera(found, viewportW, viewportH);
  if (!camera) return false;
  state.camera = camera;
  state.flashes.push({ ids: found.map(el => el.id), t: performance.now(), ms: FOCUS_FLASH_MS });
  update();
  return true;
}
