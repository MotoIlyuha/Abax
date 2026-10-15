import type { Camera, Element, GridMode, ImageEl, ShapeEl } from './types';
import {
  elementAABB, wrapText, TEXT_FONT,
  NOTE_PAD, NOTE_FONT, NOTE_TEXT_COLOR,
} from './geom';
import { ribbonPath } from './stroke';
import { state } from './state';

// Кэш загруженных картинок (импортированные PDF-страницы).
const imgCache = new WeakMap<ImageEl, HTMLImageElement>();

function imageOf(el: ImageEl): HTMLImageElement {
  let img = imgCache.get(el);
  if (!img) {
    img = new Image();
    img.onload = () => requestRender();
    img.src = el.src;
    imgCache.set(el, img);
  }
  return img;
}

interface ElCacheEntry {
  aabb: { x0: number; y0: number; x1: number; y1: number };
  path: Path2D | null;
  lines: string[] | null;
}

// Элементы иммутабельны: кэш живёт столько же, сколько объект элемента.
const elCache = new WeakMap<Element, ElCacheEntry>();

function cacheOf(el: Element): ElCacheEntry {
  let c = elCache.get(el);
  if (!c) {
    c = { aabb: elementAABB(el), path: null, lines: null };
    if (el.type === 'stroke') c.path = ribbonPath(el.pts, el.width);
    if (el.type === 'note') c.lines = wrapText(el.text, NOTE_FONT, el.w - NOTE_PAD * 2);
    elCache.set(el, c);
  }
  return c;
}

function hexA(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

const HIGHLIGHTER_ALPHA = 0.42;
const GRID_STEP = 40; // юниты сцены
const LASER_TTL = 800; // мс жизни следа указки

function drawGrid(ctx: CanvasRenderingContext2D, cam: Camera, w: number, h: number, mode: GridMode): void {
  const z = cam.zoom;
  let step = GRID_STEP;
  while (step * z < 18) step *= 4; // LOD: не рисуем чаще ~18px на экране
  const isMinor = step === GRID_STEP;
  if (mode === 'dots') {
    ctx.fillStyle = isMinor ? '#c9cfd9' : '#d8dde5';
    const r = isMinor ? 1.2 : 1.6;
    const d = r * 2;
    const sx0 = ((cam.x % step) + step) % step;
    const sy0 = ((cam.y % step) + step) % step;
    for (let sx = (sx0 - step) * z; sx < w; sx += step * z) {
      if (sx < -d) continue;
      for (let sy = (sy0 - step) * z; sy < h; sy += step * z) {
        if (sy < -d) continue;
        ctx.fillRect(sx - r, sy - r, d, d);
      }
    }
    return;
  }
  // square: тонкие минорные + чуть темнее мажорные каждые 5 шагов
  ctx.beginPath();
  const sx0 = Math.floor(cam.x / step) * step;
  const sy0 = Math.floor(cam.y / step) * step;
  for (let x = sx0; x <= cam.x + w / z; x += step) {
    const sx = (x - cam.x) * z;
    ctx.moveTo(sx, 0);
    ctx.lineTo(sx, h);
  }
  for (let y = sy0; y <= cam.y + h / z; y += step) {
    const sy = (y - cam.y) * z;
    ctx.moveTo(0, sy);
    ctx.lineTo(w, sy);
  }
  ctx.strokeStyle = isMinor ? '#eef0f4' : '#e8ebf1';
  ctx.lineWidth = 1;
  ctx.stroke();
  const major = step * 5;
  if (major * z > 40) {
    ctx.beginPath();
    const mx0 = Math.floor(cam.x / major) * major;
    const my0 = Math.floor(cam.y / major) * major;
    for (let x = mx0; x <= cam.x + w / z; x += major) {
      const sx = (x - cam.x) * z;
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, h);
    }
    for (let y = my0; y <= cam.y + h / z; y += major) {
      const sy = (y - cam.y) * z;
      ctx.moveTo(0, sy);
      ctx.lineTo(w, sy);
    }
    ctx.strokeStyle = '#dfe3ea';
    ctx.stroke();
  }
  if (mode === 'coord') drawCoordAxes(ctx, cam, w, h);
}

/** Оси координат через сцену (0,0): линии, стрелки, риски, подписи. */
function drawCoordAxes(ctx: CanvasRenderingContext2D, cam: Camera, w: number, h: number): void {
  const z = cam.zoom;
  const ox = (0 - cam.x) * z; // экранная позиция оси Y (сцена x=0)
  const oy = (0 - cam.y) * z; // экранная позиция оси X (сцена y=0)
  const yVisible = ox >= -20 && ox <= w + 20;
  const xVisible = oy >= -20 && oy <= h + 20;
  if (!yVisible && !xVisible) return;
  ctx.strokeStyle = '#8a94a3';
  ctx.fillStyle = '#8a94a3';
  ctx.lineWidth = 1.5;
  ctx.font = '12px "Segoe UI", system-ui, sans-serif';
  ctx.textBaseline = 'alphabetic';
  // стрелки на концах видимых осей
  const arrow = (x: number, y: number, dx: number, dy: number) => {
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - dx * 9 - dy * 4, y - dy * 9 + dx * 4);
    ctx.lineTo(x - dx * 9 + dy * 4, y - dy * 9 - dx * 4);
    ctx.closePath();
    ctx.fill();
  };
  if (yVisible) {
    ctx.beginPath();
    ctx.moveTo(ox, 0);
    ctx.lineTo(ox, h);
    ctx.stroke();
    arrow(ox, 0, 0, -1);
    ctx.fillText('y', ox + 6, 12);
  }
  if (xVisible) {
    ctx.beginPath();
    ctx.moveTo(0, oy);
    ctx.lineTo(w, oy);
    ctx.stroke();
    arrow(w, oy, 1, 0);
    ctx.fillText('x', w - 10, oy - 6);
  }
  if (xVisible && yVisible) ctx.fillText('0', ox - 12, oy + 14);
  // риски каждые GRID_STEP юнитов сцены
  ctx.lineWidth = 1;
  ctx.beginPath();
  const sx0 = Math.ceil(cam.x / GRID_STEP) * GRID_STEP;
  for (let x = sx0; x <= cam.x + w / z; x += GRID_STEP) {
    if (x === 0) continue;
    const sx = (x - cam.x) * z;
    ctx.moveTo(sx, oy - 3);
    ctx.lineTo(sx, oy + 3);
  }
  const sy0 = Math.ceil(cam.y / GRID_STEP) * GRID_STEP;
  for (let y = sy0; y <= cam.y + h / z; y += GRID_STEP) {
    if (y === 0) continue;
    const sy = (y - cam.y) * z;
    ctx.moveTo(ox - 3, sy);
    ctx.lineTo(ox + 3, sy);
  }
  ctx.stroke();
}

function drawShapeEl(ctx: CanvasRenderingContext2D, el: ShapeEl): void {
  ctx.strokeStyle = el.color;
  ctx.lineWidth = el.width;
  ctx.lineCap = 'round';
  ctx.beginPath();
  if (el.shape === 'rect') {
    ctx.rect(Math.min(el.x, el.x + el.w), Math.min(el.y, el.y + el.h), Math.abs(el.w), Math.abs(el.h));
  } else if (el.shape === 'ellipse') {
    const cx = el.x + el.w / 2;
    const cy = el.y + el.h / 2;
    ctx.ellipse(cx, cy, Math.abs(el.w / 2) || 0.5, Math.abs(el.h / 2) || 0.5, 0, 0, Math.PI * 2);
  } else {
    ctx.moveTo(el.x, el.y);
    ctx.lineTo(el.x + el.w, el.y + el.h);
  }
  ctx.stroke();
  if (el.shape === 'arrow') {
    const tipx = el.x + el.w;
    const tipy = el.y + el.h;
    const ang = Math.atan2(el.h, el.w);
    const hl = Math.min(Math.max(el.width * 4.5, 12), 46);
    for (const s of [-0.45, 0.45]) {
      ctx.beginPath();
      ctx.moveTo(tipx, tipy);
      ctx.lineTo(tipx - hl * Math.cos(ang + s), tipy - hl * Math.sin(ang + s));
      ctx.stroke();
    }
  }
}

function drawElement(
  ctx: CanvasRenderingContext2D, el: Element,
  vx0: number, vy0: number, vx1: number, vy1: number,
): void {
  const c = cacheOf(el);
  if (c.aabb.x1 < vx0 || c.aabb.x0 > vx1 || c.aabb.y1 < vy0 || c.aabb.y0 > vy1) return;
  switch (el.type) {
    case 'stroke':
      ctx.fillStyle = el.tool === 'highlighter' ? hexA(el.color, HIGHLIGHTER_ALPHA) : el.color;
      ctx.fill(c.path!);
      break;
    case 'shape':
      drawShapeEl(ctx, el);
      break;
    case 'text': {
      ctx.font = TEXT_FONT(el.size);
      ctx.fillStyle = el.color;
      ctx.textBaseline = 'alphabetic';
      const lh = el.size * 1.25;
      const lines = el.text.split('\n');
      for (let i = 0; i < lines.length; i++) ctx.fillText(lines[i], el.x, el.y + el.size + i * lh);
      break;
    }
    case 'note': {
      ctx.fillStyle = el.color;
      ctx.beginPath();
      ctx.roundRect(el.x, el.y, el.w, el.h, 6);
      ctx.fill();
      ctx.strokeStyle = hexA('#4a4633', 0.18);
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.save();
      ctx.beginPath();
      ctx.rect(el.x, el.y, el.w, el.h);
      ctx.clip();
      ctx.font = TEXT_FONT(NOTE_FONT);
      ctx.fillStyle = NOTE_TEXT_COLOR;
      const lh = NOTE_FONT * 1.35;
      const lines = c.lines ?? [];
      for (let i = 0; i < lines.length; i++) {
        ctx.fillText(lines[i], el.x + NOTE_PAD, el.y + NOTE_PAD + NOTE_FONT + i * lh);
      }
      ctx.restore();
      break;
    }
    case 'image': {
      const img = imageOf(el);
      if (img.complete && img.naturalWidth > 0) {
        ctx.drawImage(img, el.x, el.y, el.w, el.h);
      } else {
        ctx.fillStyle = '#f0f2f5';
        ctx.fillRect(el.x, el.y, el.w, el.h);
      }
      break;
    }
  }
}

/** Полный рендер набора элементов. Используется для кэша сцены и экспорта PNG. */
export function renderScene(
  ctx: CanvasRenderingContext2D, elements: Element[],
  cam: Camera, wCss: number, hCss: number, dpr: number, grid: GridMode,
  exclude?: Set<string>,
): void {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, wCss, hCss);
  if (grid !== 'none') drawGrid(ctx, cam, wCss, hCss, grid);

  const zx = dpr * cam.zoom;
  ctx.setTransform(zx, 0, 0, zx, -cam.x * zx, -cam.y * zx);
  const vx0 = cam.x;
  const vy0 = cam.y;
  const vx1 = cam.x + wCss / cam.zoom;
  const vy1 = cam.y + hCss / cam.zoom;
  // сначала картинки (фон для аннотаций), затем маркер — всегда под остальным
  for (const el of elements) {
    if (el.type === 'image' && !exclude?.has(el.id)) {
      drawElement(ctx, el, vx0, vy0, vx1, vy1);
    }
  }
  for (const el of elements) {
    if (el.type === 'stroke' && el.tool === 'highlighter' && !exclude?.has(el.id)) {
      drawElement(ctx, el, vx0, vy0, vx1, vy1);
    }
  }
  for (const el of elements) {
    if (el.type !== 'image' && !(el.type === 'stroke' && el.tool === 'highlighter') && !exclude?.has(el.id)) {
      drawElement(ctx, el, vx0, vy0, vx1, vy1);
    }
  }
}

// ----- Основной канвас с битмап-кэшем сцены -----
//
// Статика (фон + все элементы) рисуется в offscreen-канвас один раз и blit'ается
// каждый кадр. Новые элементы дописываются в кэш инкрементально (префикс-проверка
// массива). Изменение камеры НЕ инвалидирует кэш мгновенно: во время pan/zoom
// устаревший кэш рисуется с трансформом (мгновенно), а резкая перерисовка
// происходит через REBUILD_DELAY после остановки движения.

const REBUILD_DELAY = 120; // мс покоя камеры до резкой перерисовки

let canvas: HTMLCanvasElement | null = null;
let ctx: CanvasRenderingContext2D | null = null;
let cssW = 0;
let cssH = 0;
let dpr = 1;
let rafId = 0;
const ERASE_R = 12;

const sceneCache = document.createElement('canvas');
let cacheCtx: CanvasRenderingContext2D | null = null;
let cacheCam: Camera | null = null;
let cacheArr: Element[] | null = null;
let cacheGrid: GridMode = 'none';
let cacheStale = false;
let cacheSel: Set<string> | null = null;
let lastCamRef: Camera | null = null;
let lastCamChange = 0;
let settleTimer = 0;

function scheduleSettleRender(): void {
  if (settleTimer) return;
  const wait = Math.max(0, REBUILD_DELAY - (performance.now() - lastCamChange));
  settleTimer = window.setTimeout(() => {
    settleTimer = 0;
    requestRender();
  }, wait + 1);
}

export function initRenderer(c: HTMLCanvasElement): void {
  canvas = c;
  ctx = c.getContext('2d');
  cacheCtx = sceneCache.getContext('2d');
  new ResizeObserver(resize).observe(c.parentElement!);
  resize();
}

function resize(): void {
  if (!canvas) return;
  const r = canvas.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return;
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  cssW = r.width;
  cssH = r.height;
  canvas.width = Math.round(r.width * dpr);
  canvas.height = Math.round(r.height * dpr);
  sceneCache.width = canvas.width;
  sceneCache.height = canvas.height;
  cacheStale = true;
  requestRender();
}

export function requestRender(): void {
  if (rafId || !ctx) return;
  rafId = requestAnimationFrame(() => {
    rafId = 0;
    draw();
  });
}

/** true, если newArr = oldArr + добавленные в конец элементы. */
function isPrefixExtension(newArr: Element[], oldArr: Element[]): boolean {
  if (newArr.length < oldArr.length) return false;
  for (let i = 0; i < oldArr.length; i++) {
    if (newArr[i] !== oldArr[i]) return false;
  }
  return true;
}

function rebuildCache(): void {
  if (!cacheCtx) return;
  const cam = state.camera;
  renderScene(cacheCtx, state.board.elements, cam, cssW, cssH, dpr, state.grid, state.selection);
  cacheCam = { ...cam };
  cacheArr = state.board.elements;
  cacheGrid = state.grid;
  cacheSel = state.selection;
  cacheStale = false;
}

function appendToCache(from: number): void {
  // дописываем только новые элементы поверх существующего кэша
  if (!cacheCtx) return;
  const cam = cacheCam;
  if (!cam) return;
  const zx = dpr * cam.zoom;
  cacheCtx.setTransform(zx, 0, 0, zx, -cam.x * zx, -cam.y * zx);
  const vx0 = cam.x;
  const vy0 = cam.y;
  const vx1 = cam.x + cssW / cam.zoom;
  const vy1 = cam.y + cssH / cam.zoom;
  const arr = state.board.elements;
  for (let i = from; i < arr.length; i++) {
    const el = arr[i];
    if ((el.type === 'stroke' && el.tool === 'highlighter') || el.type === 'image') {
      // маркер/картинка должны лечь ПОД существующее — инвалидируем кэш
      cacheStale = true;
      return;
    }
    drawElement(cacheCtx, el, vx0, vy0, vx1, vy1);
  }
  cacheArr = arr;
}

function blitCache(): void {
  if (!ctx || !cacheCam) return;
  const cam = state.camera;
  // кэш покрывает сцену [cacheCam .. cacheCam + css/cacheZoom]; рисуем его
  // в координатах текущей камеры
  const dx = (cacheCam.x - cam.x) * cam.zoom;
  const dy = (cacheCam.y - cam.y) * cam.zoom;
  const dw = (cssW / cacheCam.zoom) * cam.zoom;
  const dh = (cssH / cacheCam.zoom) * cam.zoom;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, cssW, cssH);
  ctx.drawImage(sceneCache, 0, 0, sceneCache.width, sceneCache.height, dx, dy, dw, dh);
}

function draw(): void {
  if (!ctx || !canvas) return;
  const cam = state.camera;

  if (cam !== lastCamRef) {
    lastCamRef = cam;
    lastCamChange = performance.now();
    cacheStale = true;
  }
  if (state.grid !== cacheGrid || state.selection !== cacheSel) cacheStale = true;

  const arr = state.board.elements;
  const arrRefChanged = arr !== cacheArr;
  const camSettled = performance.now() - lastCamChange >= REBUILD_DELAY;

  if (!cacheCtx || (!cacheCam && (cssW === 0 || cssH === 0))) return;

  if (arrRefChanged) {
    if (cacheArr && isPrefixExtension(arr, cacheArr) && !cacheStale) {
      appendToCache(cacheArr.length);
    } else {
      cacheStale = true;
    }
  }
  if (cacheStale) {
    if (camSettled || !cacheCam) {
      rebuildCache();
    } else {
      // камера ещё движется: договорисываем резкую перерисовку после остановки
      scheduleSettleRender();
    }
  }

  if (cacheCam) {
    blitCache();
    // выделенные элементы исключены из кэша — рисуем их поверх (двигаются без инвалидации)
    if (state.selection.size > 0) {
      const zx0 = dpr * cam.zoom;
      ctx.setTransform(zx0, 0, 0, zx0, -cam.x * zx0, -cam.y * zx0);
      const ex0 = cam.x, ey0 = cam.y;
      const ex1 = cam.x + cssW / cam.zoom, ey1 = cam.y + cssH / cam.zoom;
      for (const el of state.board.elements) {
        if (!state.selection.has(el.id)) continue;
        drawElement(ctx, el, ex0, ey0, ex1, ey1);
      }
    }
  }

  // превью живых объектов — поверх blit, в координатах сцены
  const zx = dpr * cam.zoom;
  ctx.setTransform(zx, 0, 0, zx, -cam.x * zx, -cam.y * zx);
  if (state.liveStroke) {
    const ls = state.liveStroke;
    const base = ls.tool === 'highlighter' ? ls.width * 3.2 : ls.width;
    ctx.fillStyle = ls.tool === 'highlighter' ? hexA(ls.color, HIGHLIGHTER_ALPHA) : ls.color;
    ctx.fill(ribbonPath(ls.pts, base));
  }
  if (state.liveShape) {
    const ls = state.liveShape;
    drawShapeEl(ctx, {
      id: '', type: 'shape', shape: ls.shape,
      x: ls.x0, y: ls.y0, w: ls.x1 - ls.x0, h: ls.y1 - ls.y0,
      color: ls.color, width: ls.width,
    });
  }

  // оверлеи в экранных координатах
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (state.selection.size > 0) {
    ctx.strokeStyle = '#3273f5';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 4]);
    for (const el of state.board.elements) {
      if (!state.selection.has(el.id)) continue;
      const a = cacheOf(el).aabb;
      const x = (a.x0 - cam.x) * cam.zoom - 4;
      const y = (a.y0 - cam.y) * cam.zoom - 4;
      ctx.strokeRect(x, y, (a.x1 - a.x0) * cam.zoom + 8, (a.y1 - a.y0) * cam.zoom + 8);
    }
    ctx.setLineDash([]);
  }
  if (state.marquee) {
    const m = state.marquee;
    ctx.strokeStyle = '#3273f5';
    ctx.fillStyle = 'rgba(50,115,245,0.06)';
    ctx.lineWidth = 1;
    const x = Math.min(m.x0, m.x1);
    const y = Math.min(m.y0, m.y1);
    ctx.fillRect(x, y, Math.abs(m.x1 - m.x0), Math.abs(m.y1 - m.y0));
    ctx.strokeRect(x, y, Math.abs(m.x1 - m.x0), Math.abs(m.y1 - m.y0));
  }
  if (state.tool === 'eraser' && state.hover) {
    ctx.strokeStyle = '#7a828e';
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    ctx.arc(state.hover.x, state.hover.y, ERASE_R, 0, Math.PI * 2);
    ctx.stroke();
  }
  if (state.laserPts.length > 0) {
    const now = performance.now();
    const alive = state.laserPts.filter(p => now - p.t < LASER_TTL);
    if (alive.length !== state.laserPts.length) state.laserPts = alive;
    for (let i = 0; i < alive.length; i++) {
      const p = alive[i];
      const age = (now - p.t) / LASER_TTL; // 0..1
      const sx = (p.x - cam.x) * cam.zoom;
      const sy = (p.y - cam.y) * cam.zoom;
      const isHead = i === alive.length - 1;
      ctx.globalAlpha = (1 - age) * 0.9;
      ctx.fillStyle = '#ff2d2d';
      ctx.beginPath();
      ctx.arc(sx, sy, isHead ? 6 : 4 - age * 2, 0, Math.PI * 2);
      ctx.fill();
      if (isHead) {
        ctx.globalAlpha = 0.95;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(sx, sy, 2.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    if (state.laserPts.length > 0) requestRender(); // гоним кадры, пока след гаснет
  }
}

export const eraseRadius = ERASE_R;
export function contentBBox(elements: Element[]) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const el of elements) {
    const a = elementAABB(el);
    x0 = Math.min(x0, a.x0);
    y0 = Math.min(y0, a.y0);
    x1 = Math.max(x1, a.x1);
    y1 = Math.max(y1, a.y1);
  }
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
}
