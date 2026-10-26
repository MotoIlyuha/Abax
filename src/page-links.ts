// Страницы на холсте (раздел «Экспериментальные»): страницу перетаскивают из списка на холст —
// получается превью-ссылка (картинка с полем page, см. types.ts). Клик по нему приближает его
// на весь экран и бесшовно открывает страницу: в последнем кадре превью и страница совпадают.

import type { Camera, ImageEl, Page } from './types';
import { pageLinkView, type AABB } from './geom';

/** Ширина нового превью на экране, CSS px; соотношение сторон — как у холста. */
const NEW_LINK_PX = 320;
const FRAME_COLOR = '#9aa3b2';
const FRAME_PX = 2;
const RADIUS_PX = 12;

/** Превью страницы с центром в точке сцены at при камере cam на холсте viewW×viewH (CSS px). */
export function newPageLink(id: string, page: Page, at: { x: number; y: number }, cam: Camera, viewW: number, viewH: number): ImageEl {
  const aspect = viewW > 0 && viewH > 0 ? viewW / viewH : 16 / 10;
  const w = NEW_LINK_PX / cam.zoom;
  const h = w / aspect;
  return {
    id, type: 'image', src: '', page: page.id,
    x: at.x - w / 2, y: at.y - h / 2, w, h,
    // рамка — как у картинки, её можно поменять или убрать; без неё белое превью сливалось бы с доской
    color: FRAME_COLOR, width: FRAME_PX / cam.zoom, radius: RADIUS_PX / cam.zoom,
  };
}

/**
 * Камеры перехода по ссылке на холсте viewW×viewH: fill — превью вписано в экран (конец приближения),
 * target — камера открытой страницы, при которой она лежит на экране ровно там же, где было превью.
 */
export function linkCameras(el: ImageEl, page: Page, viewW: number, viewH: number, view: AABB = pageLinkView(page.elements, el.w / el.h)): { fill: Camera; target: Camera } {
  const z = Math.min(viewW / el.w, viewH / el.h);
  const fill: Camera = { zoom: z, x: el.x + el.w / 2 - viewW / (2 * z), y: el.y + el.h / 2 - viewH / (2 * z) };
  // точка p страницы в превью — в el.x + (p - view.x0) * s; на экране — (… - fill.x) * z.
  // Камера страницы с тем же экраном: zoom = s * z, x = view.x0 - (el.x - fill.x) / s
  const s = el.w / (view.x1 - view.x0);
  const target: Camera = { zoom: s * z, x: view.x0 - (el.x - fill.x) / s, y: view.y0 - (el.y - fill.y) / s };
  return { fill, target };
}

/**
 * Камера на доле t ∈ [0, 1] пути от a к b: масштаб меняется равномерно в логарифме, а точка,
 * которая на экране у a и b одна и та же, стоит на месте — как приближение колёсиком к этой точке.
 * Масштаб почти тот же — просто сдвиг.
 */
export function zoomPath(a: Camera, b: Camera, t: number): Camera {
  if (t <= 0) return { ...a };
  if (t >= 1) return { ...b };
  if (Math.abs(b.zoom - a.zoom) < a.zoom * 1e-4) {
    return { zoom: a.zoom + (b.zoom - a.zoom) * t, x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  }
  const zoom = a.zoom * Math.pow(b.zoom / a.zoom, t);
  // неподвижная точка: (p - a.x) * a.zoom = (p - b.x) * b.zoom
  const px = (b.x * b.zoom - a.x * a.zoom) / (b.zoom - a.zoom);
  const py = (b.y * b.zoom - a.y * a.zoom) / (b.zoom - a.zoom);
  return { zoom, x: px - (px - a.x) * a.zoom / zoom, y: py - (py - a.y) * a.zoom / zoom };
}

/** Длительность приближения: дольше, если приближать сильнее (мс). */
export function zoomDuration(a: Camera, b: Camera): number {
  const k = Math.abs(Math.log2(b.zoom / a.zoom));
  return Math.round(Math.min(900, Math.max(420, 420 + k * 130)));
}

export function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/** События, которые не доходят до приложения, пока идёт переход. */
const BLOCKED = [
  'keydown', 'keyup', 'keypress', 'wheel', 'pointerdown', 'pointermove', 'pointerup', 'mousedown', 'mouseup',
  'click', 'dblclick', 'contextmenu', 'touchstart', 'touchmove', 'touchend', 'paste', 'copy', 'cut', 'drop', 'dragover',
] as const;

/**
 * Блокирует ввод на время анимации перехода: прозрачный щит поверх окна и перехват событий
 * в самом начале их пути. Возвращает снятие блокировки.
 */
export function lockInput(): () => void {
  (document.activeElement as HTMLElement | null)?.blur?.();
  const shield = document.createElement('div');
  shield.id = 'input-lock';
  document.body.appendChild(shield);
  const block = (e: Event) => {
    e.preventDefault();
    e.stopImmediatePropagation();
  };
  for (const t of BLOCKED) window.addEventListener(t, block, { capture: true, passive: false });
  document.body.classList.add('input-locked');
  return () => {
    for (const t of BLOCKED) window.removeEventListener(t, block, { capture: true });
    shield.remove();
    document.body.classList.remove('input-locked');
  };
}
