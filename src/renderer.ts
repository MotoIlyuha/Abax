import type { Camera, Element, GridMode, ImageEl, ShapeEl, SolidEl } from './types';
import { foreignSelections } from './collab';
import {
  cornerRadius, elementAABB, elementHandles, fitShapeText, imageFrame, presentCamera, shapeHoldsText, shapeTextBox,
  wrapText, TEXT_FONT, NOTE_PAD, NOTE_FONT, NOTE_TEXT_COLOR, SHAPE_TEXT_LH,
} from './geom';
import { ribbonPath } from './stroke';
import { fitSolid, solidGeometry, type SolidPrim } from './solid';
import { state } from './state';
import { ERASER_PATHS, ERASER_TIP } from './toolbar';

/** Сколько картинок догрузилось: кэш сцены, собранный с заглушкой, устаревает. */
let imgEpoch = 0;

/** Превью, снятое при меньшем значении, могло нарисоваться с незагруженными картинками. */
export function imageEpoch(): number {
  return imgEpoch;
}

// Кэш загруженных картинок (импортированные PDF-страницы).
const imgCache = new WeakMap<ImageEl, HTMLImageElement>();

function imageOf(el: ImageEl): HTMLImageElement {
  let img = imgCache.get(el);
  if (!img) {
    img = new Image();
    img.onload = () => {
      imgEpoch++;
      requestRender();
    };
    img.src = el.src;
    imgCache.set(el, img);
  }
  return img;
}

/** Ждёт картинок среди элементов, которые ещё грузятся; null — все уже готовы. */
export function imagesLoaded(els: readonly Element[]): Promise<void> | null {
  const pending = els.filter((e): e is ImageEl => e.type === 'image').map(imageOf).filter(img => !img.complete);
  if (pending.length === 0) return null;
  return Promise.all(pending.map(img => img.decode().catch(() => undefined))).then(() => undefined);
}

type ShapeTextFit = { size: number; lines: string[] };

interface ElCacheEntry {
  aabb: { x0: number; y0: number; x1: number; y1: number };
  path: Path2D | null;
  lines: string[] | null;
  /** Надпись фигуры, разложенная по строкам с подобранным кеглем. */
  fit: ShapeTextFit | null;
}

// Элементы иммутабельны: кэш живёт столько же, сколько объект элемента.
const elCache = new WeakMap<Element, ElCacheEntry>();

function cacheOf(el: Element): ElCacheEntry {
  let c = elCache.get(el);
  if (!c) {
    c = { aabb: elementAABB(el), path: null, lines: null, fit: null };
    if (el.type === 'stroke') c.path = ribbonPath(el.pts, el.width);
    if (el.type === 'note') c.lines = wrapText(el.text, NOTE_FONT, el.w - NOTE_PAD * 2);
    if (shapeHoldsText(el) && el.text) {
      const box = shapeTextBox(el);
      c.fit = fitShapeText(el.text, box.w, box.h);
    }
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
const LASER_TTL = 550; // мс жизни точки следа указки
const LASER_R = 4.5; // полуширина следа у головы, px экрана
const LASER_COLOR = '#ff2d2d';
const FADE_MS = 650; // мс угасания росчерка исчезающего маркера
const FLASH_MS = 1400; // мс подсветки контура
const FLASH_IN = 140;
const FLASH_OUT = 600;
const FLASH_COLOR = '#ff9f1c';
const FLASH_R = 4; // толщина контура подсветки, px экрана
const GUIDE_COLOR = '#f2357b';

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
  // риски: шаг подстраивается под зум (LOD)
  ctx.lineWidth = 1;
  ctx.beginPath();
  let tstep = GRID_STEP;
  while (tstep * z < 18) tstep *= 4;
  const tx0 = Math.ceil(cam.x / tstep) * tstep;
  for (let x = tx0; x <= cam.x + w / z; x += tstep) {
    if (x === 0) continue;
    const sx = (x - cam.x) * z;
    ctx.moveTo(sx, oy - 3);
    ctx.lineTo(sx, oy + 3);
  }
  const ty0 = Math.ceil(cam.y / tstep) * tstep;
  for (let y = ty0; y <= cam.y + h / z; y += tstep) {
    if (y === 0) continue;
    const sy = (y - cam.y) * z;
    ctx.moveTo(ox - 3, sy);
    ctx.lineTo(ox + 3, sy);
  }
  ctx.stroke();
  // числовые деления в математических единицах (клетка = 1):
  // наименьший удобочитаемый шаг, минимум 0.25 единицы (четверть клетки)
  if (!state.settings.coordLabels) return;
  let lstep = GRID_STEP / 4; // 0.25 единицы
  while (lstep * z < 34 && lstep < GRID_STEP * 4096) lstep *= 2;
  const fmt = (v: number): string => {
    const n = v / GRID_STEP;
    if (Number.isInteger(n)) return String(n);
    return String(Math.round(n * 100) / 100);
  };
  ctx.font = '11px "Segoe UI", system-ui, sans-serif';
  if (xVisible) {
    const lx0 = Math.ceil(cam.x / lstep) * lstep;
    for (let x = lx0; x <= cam.x + w / z; x += lstep) {
      if (x === 0) continue;
      const sx = (x - cam.x) * z;
      ctx.fillText(fmt(x), sx + 3, oy + 14);
    }
  }
  if (yVisible) {
    ctx.textAlign = 'right';
    const ly0 = Math.ceil(cam.y / lstep) * lstep;
    for (let y = ly0; y <= cam.y + h / z; y += lstep) {
      if (y === 0) continue;
      const sy = (y - cam.y) * z;
      // ось Y в математике смотрит вверх, а экранная — вниз: выше оси X положительные значения
      ctx.fillText(fmt(-y), ox - 5, sy + 4);
    }
    ctx.textAlign = 'left';
  }
}

/** Поворот фигуры вокруг её центра (вызывающий делает save/restore). */
function rotateShape(ctx: CanvasRenderingContext2D, el: ShapeEl, rot: number): void {
  const cx = el.x + el.w / 2;
  const cy = el.y + el.h / 2;
  ctx.translate(cx, cy);
  ctx.rotate(rot);
  ctx.translate(-cx, -cy);
}

function drawShapeEl(ctx: CanvasRenderingContext2D, el: ShapeEl, text: ShapeTextFit | null = null): void {
  const rot = el.rot ?? 0;
  if (rot) {
    ctx.save();
    rotateShape(ctx, el, rot);
  }
  ctx.strokeStyle = el.color;
  ctx.lineWidth = el.width;
  ctx.lineCap = 'round';
  ctx.lineJoin = el.shape === 'triangle' ? 'round' : 'miter';
  ctx.beginPath();
  if (el.shape === 'rect') {
    const x = Math.min(el.x, el.x + el.w), y = Math.min(el.y, el.y + el.h);
    const r = cornerRadius(el);
    if (r > 0) ctx.roundRect(x, y, Math.abs(el.w), Math.abs(el.h), r);
    else ctx.rect(x, y, Math.abs(el.w), Math.abs(el.h));
  } else if (el.shape === 'triangle') {
    const x0 = Math.min(el.x, el.x + el.w), y0 = Math.min(el.y, el.y + el.h);
    const x1 = Math.max(el.x, el.x + el.w), y1 = Math.max(el.y, el.y + el.h);
    ctx.moveTo((x0 + x1) / 2, y0);
    ctx.lineTo(x1, y1);
    ctx.lineTo(x0, y1);
    ctx.closePath();
  } else if (el.shape === 'ellipse') {
    const cx = el.x + el.w / 2;
    const cy = el.y + el.h / 2;
    ctx.ellipse(cx, cy, Math.abs(el.w / 2) || 0.5, Math.abs(el.h / 2) || 0.5, 0, 0, Math.PI * 2);
  } else {
    ctx.moveTo(el.x, el.y);
    ctx.lineTo(el.x + el.w, el.y + el.h);
  }
  if (el.shape === 'arrow') {
    // наконечник — в том же контуре: у полупрозрачной стрелки острие не темнее древка
    const tipx = el.x + el.w;
    const tipy = el.y + el.h;
    const ang = Math.atan2(el.h, el.w);
    const hl = Math.min(Math.max(el.width * 4.5, 12), 46);
    for (const s of [-0.45, 0.45]) {
      ctx.moveTo(tipx, tipy);
      ctx.lineTo(tipx - hl * Math.cos(ang + s), tipy - hl * Math.sin(ang + s));
    }
  }
  ctx.stroke();
  if (text) drawShapeText(ctx, el, text);
  if (rot) ctx.restore();
}

/** Надпись по центру области текста фигуры (поворот уже применён). */
function drawShapeText(ctx: CanvasRenderingContext2D, el: ShapeEl, fit: ShapeTextFit): void {
  const box = shapeTextBox(el);
  const lh = fit.size * SHAPE_TEXT_LH;
  const top = box.y + (box.h - fit.lines.length * lh) / 2;
  const cx = box.x + box.w / 2;
  ctx.font = TEXT_FONT(fit.size);
  ctx.fillStyle = el.color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let i = 0; i < fit.lines.length; i++) ctx.fillText(fit.lines[i], cx, top + (i + 0.5) * lh);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
}

/** Только надпись фигуры (контур уже нарисован) — с её поворотом и прозрачностью. */
function drawShapeCaption(ctx: CanvasRenderingContext2D, el: ShapeEl): void {
  if (!el.text) return;
  const box = shapeTextBox(el);
  ctx.save();
  ctx.globalAlpha = el.opacity ?? 1;
  if (el.rot) rotateShape(ctx, el, el.rot);
  drawShapeText(ctx, el, fitShapeText(el.text, box.w, box.h));
  ctx.restore();
}

function traceSolidPrims(ctx: CanvasRenderingContext2D, prims: SolidPrim[], hidden: boolean): void {
  for (const p of prims) {
    if (p.hidden !== hidden) continue;
    if (p.k === 'seg') {
      ctx.moveTo(p.x0, p.y0);
      ctx.lineTo(p.x1, p.y1);
    } else {
      // без moveTo дуга соединилась бы линией с концом предыдущей
      ctx.moveTo(p.cx + p.rx * Math.cos(p.a0), p.cy + p.ry * Math.sin(p.a0));
      ctx.ellipse(p.cx, p.cy, Math.max(p.rx, 0.01), Math.max(p.ry, 0.01), 0, p.a0, p.a1);
    }
  }
}

/** Каркас тела: сначала невидимые линии пунктиром, поверх — видимые. */
function drawSolidEl(ctx: CanvasRenderingContext2D, el: SolidEl): void {
  const g = solidGeometry(el);
  ctx.strokeStyle = el.color;
  ctx.lineWidth = el.width;
  ctx.lineJoin = 'round';
  if (g.prims.some(p => p.hidden)) {
    const dash = Math.max(5, el.width * 2.2);
    ctx.lineCap = 'butt';
    ctx.setLineDash([dash, dash * 0.7]);
    ctx.beginPath();
    traceSolidPrims(ctx, g.prims, true);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.lineCap = 'round';
  ctx.beginPath();
  traceSolidPrims(ctx, g.prims, false);
  ctx.stroke();
}

function drawElement(
  ctx: CanvasRenderingContext2D, el: Element,
  vx0: number, vy0: number, vx1: number, vy1: number,
): void {
  const c = cacheOf(el);
  if (c.aabb.x1 < vx0 || c.aabb.x0 > vx1 || c.aabb.y1 < vy0 || c.aabb.y0 > vy1) return;
  // у картинки прозрачна только рамка — её непрозрачность выставляется при рисовании рамки
  const alpha = el.type !== 'image' && el.type !== 'note' ? el.opacity ?? 1 : 1;
  if (alpha < 1) ctx.globalAlpha = alpha;
  drawElementBody(ctx, el, c);
  if (alpha < 1) ctx.globalAlpha = 1;
}

function drawElementBody(ctx: CanvasRenderingContext2D, el: Element, c: ElCacheEntry): void {
  switch (el.type) {
    case 'stroke':
      ctx.fillStyle = el.tool === 'highlighter' ? hexA(el.color, HIGHLIGHTER_ALPHA) : el.color;
      ctx.fill(c.path!);
      break;
    case 'shape':
      // надпись, которую правят на месте, показывает редактор
      drawShapeEl(ctx, el, el.id === state.hideTextId ? null : c.fit);
      break;
    case 'solid':
      drawSolidEl(ctx, el);
      break;
    case 'text': {
      ctx.font = TEXT_FONT(el.size, el.bold, el.italic);
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
      const rot = el.rot ?? 0;
      if (rot) {
        const cx = el.x + el.w / 2, cy = el.y + el.h / 2;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(rot);
        ctx.translate(-cx, -cy);
      }
      const r = cornerRadius(el);
      if (r > 0) {
        ctx.save();
        ctx.beginPath();
        ctx.roundRect(el.x, el.y, el.w, el.h, r);
        ctx.clip();
      }
      if (img.complete && img.naturalWidth > 0) {
        ctx.drawImage(img, el.x, el.y, el.w, el.h);
      } else {
        ctx.fillStyle = '#f0f2f5';
        ctx.fillRect(el.x, el.y, el.w, el.h);
      }
      if (r > 0) ctx.restore();
      const frame = imageFrame(el);
      if (frame) {
        // рамка — внутри картинки: габарит элемента не меняется
        const bw = Math.min(frame.width, el.w / 2, el.h / 2);
        ctx.globalAlpha = el.opacity ?? 1;
        ctx.strokeStyle = frame.color;
        ctx.lineWidth = bw;
        ctx.lineJoin = 'miter';
        ctx.beginPath();
        ctx.roundRect(el.x + bw / 2, el.y + bw / 2, el.w - bw, el.h - bw, Math.max(0, r - bw / 2));
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      if (rot) ctx.restore();
      break;
    }
    case 'poly': {
      ctx.strokeStyle = el.color;
      ctx.lineWidth = el.width;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(el.pts[0].x, el.pts[0].y);
      for (let i = 1; i < el.pts.length; i++) ctx.lineTo(el.pts[i].x, el.pts[i].y);
      if (el.closed) ctx.closePath();
      ctx.stroke();
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
  // честный z-порядок: элементы рисуются строго по порядку массива,
  // слои (выше/ниже) работают одинаково для всех типов
  for (const el of elements) {
    if (!exclude?.has(el.id)) {
      drawElement(ctx, el, vx0, vy0, vx1, vy1);
    }
  }
}

// ----- Битмап-кэш сцены -----
// Статика (фон + все элементы) рисуется в offscreen-канвас один раз и blit'ается
// каждый кадр. Новые элементы дописываются в кэш инкрементально (префикс-проверка
// массива). Изменение камеры НЕ инвалидирует кэш мгновенно: во время pan/zoom
// устаревший кэш рисуется с трансформом (мгновенно), а резкая перерисовка
// происходит через REBUILD_DELAY после остановки движения.
// Кэш свой у каждого холста: основного и окна демонстрации.

const REBUILD_DELAY = 120; // мс покоя камеры до резкой перерисовки
const HEAVY_BOARD = 1500; // элементов: выше — переносим выделенное поверх ради плавности
const PART_ERASE_R = 12; // радиус ластика для пера и маркера, px экрана

let canvas: HTMLCanvasElement | null = null;
let ctx: CanvasRenderingContext2D | null = null;
let cssW = 0;
let cssH = 0;
let dpr = 1;
let rafId = 0;
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

/** true, если newArr = oldArr + добавленные в конец элементы. */
function isPrefixExtension(newArr: Element[], oldArr: Element[]): boolean {
  if (newArr.length < oldArr.length) return false;
  for (let i = 0; i < oldArr.length; i++) {
    if (newArr[i] !== oldArr[i]) return false;
  }
  return true;
}

class SceneCache {
  readonly canvas = document.createElement('canvas');
  private readonly ctx = this.canvas.getContext('2d');
  /** Камера, с которой снят кэш; null — кэш ещё не собран. */
  cam: Camera | null = null;
  private w = 0;
  private h = 0;
  private dpr = 1;
  private arr: Element[] | null = null;
  private grid: GridMode = 'none';
  private coordLabels = true;
  private liveEdit = false;
  private hideId: string | null = null;
  private hideTextId: string | null = null;
  private imgEpoch = 0;
  private stale = false;

  resize(wPx: number, hPx: number): void {
    this.canvas.width = wPx;
    this.canvas.height = hPx;
    this.stale = true;
  }

  /** Приводит кэш к текущей сцене; пока камера движется, резкая перерисовка откладывается. */
  sync(cam: Camera, w: number, h: number, dpr: number, camSettled: boolean): void {
    if (!this.ctx || (!this.cam && (w === 0 || h === 0))) return;
    const c = this.cam;
    if (!c || c.x !== cam.x || c.y !== cam.y || c.zoom !== cam.zoom || w !== this.w || h !== this.h || dpr !== this.dpr) {
      this.stale = true;
    }
    if (state.board.grid !== this.grid || state.settings.coordLabels !== this.coordLabels || state.liveEdit !== this.liveEdit
      || state.hideElId !== this.hideId || state.hideTextId !== this.hideTextId || imgEpoch !== this.imgEpoch) this.stale = true;
    const arr = state.board.elements;
    if (arr !== this.arr) {
      if (this.arr && !this.stale && isPrefixExtension(arr, this.arr)) this.append(this.arr.length);
      else this.stale = true;
    }
    if (!this.stale) return;
    if (camSettled || !this.cam) this.rebuild(cam, w, h, dpr);
    else scheduleSettleRender(); // камера ещё движется: резкая перерисовка после остановки
  }

  private rebuild(cam: Camera, w: number, h: number, dpr: number): void {
    // выделение исключается из кэша только на очень больших досках,
    // где полная перерисовка каждый кадр переноса дорога; иначе честные слои
    const excl = new Set<string>();
    if (state.liveEdit && state.board.elements.length > HEAVY_BOARD) {
      for (const id of state.selection) excl.add(id);
    }
    if (state.hideElId) excl.add(state.hideElId);
    renderScene(this.ctx!, state.board.elements, cam, w, h, dpr, state.board.grid, excl.size ? excl : undefined);
    this.cam = { ...cam };
    this.w = w;
    this.h = h;
    this.dpr = dpr;
    this.arr = state.board.elements;
    this.grid = state.board.grid;
    this.coordLabels = state.settings.coordLabels;
    this.liveEdit = state.liveEdit;
    this.hideId = state.hideElId;
    this.hideTextId = state.hideTextId;
    this.imgEpoch = imgEpoch;
    this.stale = false;
  }

  /** Дописывает только новые элементы поверх существующего кэша. */
  private append(from: number): void {
    const cam = this.cam!;
    const zx = this.dpr * cam.zoom;
    this.ctx!.setTransform(zx, 0, 0, zx, -cam.x * zx, -cam.y * zx);
    const vx1 = cam.x + this.w / cam.zoom;
    const vy1 = cam.y + this.h / cam.zoom;
    const arr = state.board.elements;
    for (let i = from; i < arr.length; i++) {
      const el = arr[i];
      if ((el.type === 'stroke' && el.tool === 'highlighter') || el.type === 'image') {
        // маркер/картинка должны лечь ПОД существующее — инвалидируем кэш
        this.stale = true;
        return;
      }
      drawElement(this.ctx!, el, cam.x, cam.y, vx1, vy1);
    }
    this.arr = arr;
  }

  /** Кэш покрывает сцену [cam .. cam + w/zoom]; рисуем его в координатах камеры cam. */
  blit(ctx: CanvasRenderingContext2D, cam: Camera, w: number, h: number, dpr: number): void {
    const c = this.cam;
    if (!c) return;
    const dx = (c.x - cam.x) * cam.zoom;
    const dy = (c.y - cam.y) * cam.zoom;
    const dw = (this.w / c.zoom) * cam.zoom;
    const dh = (this.h / c.zoom) * cam.zoom;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(this.canvas, 0, 0, this.canvas.width, this.canvas.height, dx, dy, dw, dh);
  }
}

const mainCache = new SceneCache();

// ----- Основной канвас -----

export function initRenderer(c: HTMLCanvasElement): void {
  canvas = c;
  ctx = c.getContext('2d');
  new ResizeObserver(resize).observe(c.parentElement!);
  // после разворота свёрнутого окна rAF заморожен и кадр не приходит — перерисовываем сами
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      rafId = 0;
      requestRender();
    }
  });
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
  mainCache.resize(canvas.width, canvas.height);
  requestRender();
}

export function requestRender(): void {
  if (rafId || !ctx) return;
  rafId = requestAnimationFrame(() => {
    rafId = 0;
    draw();
  });
}

/**
 * Кадр сразу и начисто, не дожидаясь rAF и покоя камеры: после смены страницы
 * кэш не должен показывать прежнюю страницу, а переход снимает готовый кадр новой.
 */
export function renderNow(): void {
  if (!ctx) return;
  if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = 0;
  }
  lastCamRef = state.camera;
  lastCamChange = -Infinity;
  draw();
}

/** Ручки редактирования единственного выделенного элемента (экранные координаты). */
function drawHandles(ctx: CanvasRenderingContext2D, cam: Camera): void {
  const el = state.board.elements.find(e => state.selection.has(e.id));
  if (!el) return;
  const hs = elementHandles(el, cam.zoom);
  if (hs.length === 0) return;
  // направляющие параметров (высота, радиус) — под ручками
  ctx.strokeStyle = '#3273f5';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 3]);
  ctx.beginPath();
  for (const { x, y, from } of hs) {
    if (!from) continue;
    ctx.moveTo((from.x - cam.x) * cam.zoom, (from.y - cam.y) * cam.zoom);
    ctx.lineTo((x - cam.x) * cam.zoom, (y - cam.y) * cam.zoom);
  }
  ctx.stroke();
  ctx.setLineDash([]);
  for (const { from } of hs) {
    if (!from) continue;
    ctx.fillStyle = '#3273f5';
    ctx.beginPath();
    ctx.arc((from.x - cam.x) * cam.zoom, (from.y - cam.y) * cam.zoom, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }
  for (const { h, x, y } of hs) {
    const sx = (x - cam.x) * cam.zoom;
    const sy = (y - cam.y) * cam.zoom;
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#3273f5';
    ctx.lineWidth = 1.5;
    if (h.kind === 'insert') {
      ctx.beginPath();
      ctx.arc(sx, sy, 2.5, 0, Math.PI * 2);
      ctx.fillStyle = '#3273f5';
      ctx.fill();
      continue;
    }
    if (h.kind === 'resize') {
      ctx.beginPath();
      ctx.rect(sx - 3.5, sy - 3.5, 7, 7);
      ctx.fill();
      ctx.stroke();
      continue;
    }
    if (h.kind === 'param') {
      // параметр тела — залитая точка, отличается от ручек размера и узлов
      ctx.beginPath();
      ctx.arc(sx, sy, 5.5, 0, Math.PI * 2);
      ctx.fillStyle = '#3273f5';
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.stroke();
      continue;
    }
    if (h.kind === 'rotate' && (el.type === 'shape' || el.type === 'image')) {
      // линия от центра верхней грани ФИГУРЫ (с учётом её поворота), не от AABB
      const rot = el.rot ?? 0;
      let anchorX = el.x + el.w / 2;
      let anchorY = el.y;
      if (rot) {
        const cx = el.x + el.w / 2, cy = el.y + el.h / 2;
        const cos = Math.cos(rot), sin = Math.sin(rot);
        anchorX = cx + (el.h / 2) * sin;
        anchorY = cy - (el.h / 2) * cos;
      }
      const topX = (anchorX - cam.x) * cam.zoom;
      const topY = (anchorY - cam.y) * cam.zoom;
      ctx.beginPath();
      ctx.moveTo(topX, topY);
      ctx.lineTo(sx, sy);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(sx, sy, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      continue;
    }
    // end/node
    ctx.beginPath();
    ctx.arc(sx, sy, 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
}

/** Направляющие выравнивания: пунктир по линии совпадения краёв или центров (экранные координаты). */
function drawGuides(ctx: CanvasRenderingContext2D, cam: Camera): void {
  ctx.strokeStyle = GUIDE_COLOR;
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 3]);
  ctx.beginPath();
  for (const g of state.guides) {
    // полпикселя — чтобы однопиксельная линия была резкой
    const at = Math.round((g.axis === 'x' ? g.at - cam.x : g.at - cam.y) * cam.zoom) + 0.5;
    const from = (g.axis === 'x' ? g.from - cam.y : g.from - cam.x) * cam.zoom;
    const to = (g.axis === 'x' ? g.to - cam.y : g.to - cam.x) * cam.zoom;
    if (g.axis === 'x') {
      ctx.moveTo(at, from);
      ctx.lineTo(at, to);
    } else {
      ctx.moveTo(from, at);
      ctx.lineTo(to, at);
    }
  }
  ctx.stroke();
  ctx.setLineDash([]);
}

/** Содержимое доски без интерфейса: кэш статики и превью живых объектов. */
function drawContent(ctx: CanvasRenderingContext2D, cache: SceneCache, cam: Camera, w: number, h: number, dpr: number): void {
  if (cache.cam) {
    cache.blit(ctx, cam, w, h, dpr);
    // во время перетаскивания выделенное исключено из кэша — рисуем поверх;
    // в покое выделенный рендерится в кэше на своём слое
    if (state.liveEdit && state.board.elements.length > HEAVY_BOARD && state.selection.size > 0) {
      const zx0 = dpr * cam.zoom;
      ctx.setTransform(zx0, 0, 0, zx0, -cam.x * zx0, -cam.y * zx0);
      const ex0 = cam.x, ey0 = cam.y;
      const ex1 = cam.x + w / cam.zoom, ey1 = cam.y + h / cam.zoom;
      for (const el of state.board.elements) {
        if (!state.selection.has(el.id) || el.id === state.hideElId) continue;
        drawElement(ctx, el, ex0, ey0, ex1, ey1);
      }
    }
  }

  // превью живых объектов — поверх blit, в координатах сцены
  const zx = dpr * cam.zoom;
  ctx.setTransform(zx, 0, 0, zx, -cam.x * zx, -cam.y * zx);
  if (state.liveNote) {
    const n = state.liveNote;
    ctx.fillStyle = n.color;
    ctx.beginPath();
    ctx.roundRect(n.x, n.y, n.w, n.h, 6);
    ctx.fill();
    ctx.strokeStyle = 'rgba(74, 70, 51, 0.18)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  if (state.liveStroke) {
    const ls = state.liveStroke;
    const base = ls.tool === 'highlighter' ? ls.width * 3.2 : ls.width;
    ctx.globalAlpha = ls.opacity ?? 1;
    ctx.fillStyle = ls.tool === 'highlighter' ? hexA(ls.color, HIGHLIGHTER_ALPHA) : ls.color;
    ctx.fill(ribbonPath(ls.pts, base));
    ctx.globalAlpha = 1;
  }
  if (state.liveShape) {
    const ls = state.liveShape;
    ctx.globalAlpha = ls.opacity ?? 1;
    drawShapeEl(ctx, {
      id: '', type: 'shape', shape: ls.shape,
      x: ls.x0, y: ls.y0, w: ls.x1 - ls.x0, h: ls.y1 - ls.y0,
      color: ls.color, width: ls.width,
    });
    ctx.globalAlpha = 1;
  }
  if (state.liveSolid) {
    const ls = state.liveSolid;
    ctx.globalAlpha = ls.opacity ?? 1;
    drawSolidEl(ctx, fitSolid(ls.solid, ls.x0, ls.y0, ls.x1, ls.y1, { id: '', color: ls.color, width: ls.width }));
    ctx.globalAlpha = 1;
  }
  if (state.livePoly) {
    const lp = state.livePoly;
    ctx.globalAlpha = state.style.opacity ?? 1;
    ctx.strokeStyle = state.style.color;
    ctx.lineWidth = state.style.width * 1.1;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (lp.pts.length > 1) {
      ctx.beginPath();
      ctx.moveTo(lp.pts[0].x, lp.pts[0].y);
      for (let i = 1; i < lp.pts.length; i++) ctx.lineTo(lp.pts[i].x, lp.pts[i].y);
      ctx.stroke();
    }
    if (lp.cursor && lp.pts.length > 0) {
      // резинка до курсора
      ctx.save();
      ctx.setLineDash([6 / cam.zoom, 4 / cam.zoom]);
      ctx.beginPath();
      ctx.moveTo(lp.pts[lp.pts.length - 1].x, lp.pts[lp.pts.length - 1].y);
      ctx.lineTo(lp.cursor.x, lp.cursor.y);
      ctx.stroke();
      ctx.restore();
    }
    ctx.globalAlpha = 1;
    // узлы: поставленные точки + колечко на первой (замыкание)
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#3273f5';
    ctx.lineWidth = 1.5 / cam.zoom;
    for (let i = 0; i < lp.pts.length; i++) {
      const r = i === 0 ? 6 / cam.zoom : 4 / cam.zoom;
      ctx.beginPath();
      ctx.arc(lp.pts[i].x, lp.pts[i].y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }
  if (state.fadeStrokes.length > 0) drawFadeStrokes(ctx);
}

const mainFlash: FlashScratch = { shape: document.createElement('canvas'), ring: document.createElement('canvas') };

function draw(): void {
  if (!ctx || !canvas) return;
  const cam = state.camera;
  if (cam !== lastCamRef) {
    lastCamRef = cam;
    lastCamChange = performance.now();
  }
  const camSettled = performance.now() - lastCamChange >= REBUILD_DELAY;

  mainCache.sync(cam, cssW, cssH, dpr, camSettled);
  drawContent(ctx, mainCache, cam, cssW, cssH, dpr);
  // оверлеи в экранных координатах
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (state.flashes.length > 0) drawFlashes(ctx, cam, cssW, cssH, dpr, mainFlash);
  if (state.selection.size > 0) {
    ctx.strokeStyle = '#3273f5';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 4]);
    for (const el of state.board.elements) {
      if (!state.selection.has(el.id) || el.id === state.hideElId) continue;
      const a = cacheOf(el).aabb;
      const x = (a.x0 - cam.x) * cam.zoom - 4;
      const y = (a.y0 - cam.y) * cam.zoom - 4;
      ctx.strokeRect(x, y, (a.x1 - a.x0) * cam.zoom + 8, (a.y1 - a.y0) * cam.zoom + 8);
    }
    ctx.setLineDash([]);
    if (state.selection.size === 1) drawHandles(ctx, cam);
  }
  if (state.guides.length > 0) drawGuides(ctx, cam);
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
  // выделения других участников совместной работы — рамки их цвета
  for (const fs of foreignSelections()) {
    ctx.strokeStyle = fs.color;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 4]);
    for (const el of state.board.elements) {
      if (!fs.ids.includes(el.id)) continue;
      const a = cacheOf(el).aabb;
      const fx = (a.x0 - cam.x) * cam.zoom - 4;
      const fy = (a.y0 - cam.y) * cam.zoom - 4;
      ctx.strokeRect(fx, fy, (a.x1 - a.x0) * cam.zoom + 8, (a.y1 - a.y0) * cam.zoom + 8);
    }
    ctx.setLineDash([]);
  }
  // у объектного ластика курсор — его иконка (CSS), кружок — только у ластика для пера и маркера
  if (state.tool === 'partEraser' && state.hover) {
    ctx.strokeStyle = '#7a828e';
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    ctx.arc(state.hover.x, state.hover.y, PART_ERASE_R, 0, Math.PI * 2);
    ctx.stroke();
  }
  drawLaser(ctx);
  if (present) drawPresent(camSettled);
}

// ----- Окно демонстрации -----
// Второй холст в отдельном окне (его показывают в видеозвонке): та же область доски,
// что видна в основном окне, но без интерфейса — ни выделения, ни ручек, ни рамки.
// Рисуется из этого же rAF, поэтому всегда синхронно с основным холстом.

interface PresentTarget {
  win: Window;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  w: number;
  h: number;
  dpr: number;
  cache: SceneCache;
  flash: FlashScratch;
}
let present: PresentTarget | null = null;

/** Подключает холст окна демонстрации (canvas живёт в документе win). */
export function attachPresent(win: Window, c: HTMLCanvasElement): void {
  const pctx = c.getContext('2d');
  if (!pctx) return;
  present = {
    win, canvas: c, ctx: pctx, w: 0, h: 0, dpr: 1, cache: new SceneCache(),
    flash: { shape: document.createElement('canvas'), ring: document.createElement('canvas') },
  };
  requestRender();
}

export function detachPresent(): void {
  present = null;
}

export function presenting(): boolean {
  return present !== null;
}

/** Холст окна демонстрации, если оно открыто. */
export function presentCanvas(): HTMLCanvasElement | null {
  return present && !present.win.closed ? present.canvas : null;
}

function drawPresent(camSettled: boolean): void {
  const p = present!;
  if (p.win.closed) { present = null; return; }
  const w = p.win.innerWidth;
  const h = p.win.innerHeight;
  const pdpr = Math.min(p.win.devicePixelRatio || 1, 2);
  if (w !== p.w || h !== p.h || pdpr !== p.dpr) {
    p.w = w;
    p.h = h;
    p.dpr = pdpr;
    p.canvas.width = Math.round(w * pdpr);
    p.canvas.height = Math.round(h * pdpr);
    p.cache.resize(p.canvas.width, p.canvas.height);
  }
  if (w === 0 || h === 0 || cssW === 0 || cssH === 0) return;
  const cam = state.camera;
  const pcam = presentCamera(cam, cssW, cssH, w, h);
  const c = p.ctx;
  p.cache.sync(pcam, w, h, pdpr, camSettled);
  drawContent(c, p.cache, pcam, w, h, pdpr);
  if (state.liveText) {
    // текст в процессе ввода: в основном окне его показывает редактор поверх холста
    const zx = pdpr * pcam.zoom;
    c.setTransform(zx, 0, 0, zx, -pcam.x * zx, -pcam.y * zx);
    // у фигуры контур уже в кэше — дорисовываем только надпись
    if (state.liveText.type === 'shape') drawShapeCaption(c, state.liveText);
    else drawElement(c, state.liveText, pcam.x, pcam.y, pcam.x + w / pcam.zoom, pcam.y + h / pcam.zoom);
  }
  c.setTransform(pdpr, 0, 0, pdpr, 0, 0);
  if (state.flashes.length > 0) drawFlashes(c, pcam, w, h, pdpr, p.flash);
  // экранные координаты основного холста (указка, курсор) → окно демонстрации
  const k = pcam.zoom / cam.zoom;
  const ox = (cam.x - pcam.x) * pcam.zoom;
  const oy = (cam.y - pcam.y) * pcam.zoom;
  const hover = state.hover;
  if (hover && state.tool !== 'laser') {
    const x = hover.x * k + ox;
    const y = hover.y * k + oy;
    if (state.tool === 'partEraser') {
      c.strokeStyle = '#7a828e';
      c.lineWidth = 1.25;
      c.beginPath();
      c.arc(x, y, PART_ERASE_R * k, 0, Math.PI * 2);
      c.stroke();
    } else if (state.tool === 'eraser') {
      drawEraser(c, x, y);
    } else {
      drawPointer(c, x, y);
    }
  }
  c.setTransform(pdpr * k, 0, 0, pdpr * k, pdpr * ox, pdpr * oy);
  drawLaser(c);
}

let eraserPaths: Path2D[] | null = null;

/** Курсор объектного ластика в окне демонстрации — как в основном окне (см. ERASER_CURSOR). */
function drawEraser(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  eraserPaths ??= ERASER_PATHS.map(d => new Path2D(d));
  ctx.save();
  ctx.translate(x - ERASER_TIP.x, y - ERASER_TIP.y);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.fillStyle = '#ffffff';
  ctx.fill(eraserPaths[0]);
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 4;
  for (const p of eraserPaths) ctx.stroke(p);
  ctx.strokeStyle = '#1f2329';
  ctx.lineWidth = 1.8;
  for (const p of eraserPaths) ctx.stroke(p);
  ctx.restore();
}

/** Курсор учителя: в окне демонстрации системного курсора нет, ученик видит этот. */
function drawPointer(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, 16);
  ctx.lineTo(4.2, 12.2);
  ctx.lineTo(7, 18.4);
  ctx.lineTo(9.6, 17.2);
  ctx.lineTo(6.9, 11.2);
  ctx.lineTo(12, 11.2);
  ctx.closePath();
  ctx.lineJoin = 'round';
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = '#ffffff';
  ctx.fillStyle = '#1f2329';
  ctx.stroke();
  ctx.fill();
  ctx.restore();
}

/** Росчерки исчезающего маркера: рисуются маркером, после отрыва гаснут. */
function drawFadeStrokes(ctx: CanvasRenderingContext2D): void {
  const now = performance.now();
  state.fadeStrokes = state.fadeStrokes.filter(f => f.endT === null || now - f.endT < FADE_MS);
  for (const f of state.fadeStrokes) {
    const k = f.endT === null ? 1 : 1 - (now - f.endT) / FADE_MS;
    ctx.globalAlpha = k * k * (f.opacity ?? 1); // к концу гаснет быстрее
    ctx.fillStyle = hexA(f.color, HIGHLIGHTER_ALPHA); // полупрозрачный, как маркер
    ctx.fill(ribbonPath(f.pts, f.width));
  }
  ctx.globalAlpha = 1;
  if (state.fadeStrokes.some(f => f.endT !== null)) requestRender();
}

// Подсветка контура: силуэт элементов «раздувается» сдвинутыми копиями,
// затем сам силуэт вырезается — остаётся кольцо по форме объекта.
/** Служебные канвасы подсветки: свои у каждого холста. */
interface FlashScratch { shape: HTMLCanvasElement; ring: HTMLCanvasElement }

function flashAlpha(age: number): number {
  if (age < FLASH_IN) return age / FLASH_IN;
  if (age > FLASH_MS - FLASH_OUT) return Math.max(0, (FLASH_MS - age) / FLASH_OUT);
  return 1;
}

function drawFlashes(
  ctx: CanvasRenderingContext2D, cam: Camera, cssW: number, cssH: number, dpr: number, scratch: FlashScratch,
): void {
  const now = performance.now();
  state.flashes = state.flashes.filter(f => now - f.t < FLASH_MS);
  if (state.flashes.length === 0) return;
  const W = Math.round(cssW * dpr), H = Math.round(cssH * dpr);
  const { shape: flashShape, ring: flashRing } = scratch;
  for (const c of [flashShape, flashRing]) {
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
  }
  const sc = flashShape.getContext('2d')!;
  const rc = flashRing.getContext('2d')!;
  const vx1 = cam.x + cssW / cam.zoom, vy1 = cam.y + cssH / cam.zoom;
  const r = FLASH_R * dpr;
  const pad = r + 2;
  for (const f of state.flashes) {
    const ids = new Set(f.ids);
    const els = state.board.elements.filter(el => ids.has(el.id) && el.id !== state.hideElId);
    if (els.length === 0) continue;
    // работаем только в габарите подсвечиваемого — в пикселях канваса
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const el of els) {
      const a = cacheOf(el).aabb;
      x0 = Math.min(x0, a.x0); y0 = Math.min(y0, a.y0);
      x1 = Math.max(x1, a.x1); y1 = Math.max(y1, a.y1);
    }
    const bx = Math.max(0, Math.floor((x0 - cam.x) * cam.zoom * dpr - pad));
    const by = Math.max(0, Math.floor((y0 - cam.y) * cam.zoom * dpr - pad));
    const bw = Math.min(W, Math.ceil((x1 - cam.x) * cam.zoom * dpr + pad)) - bx;
    const bh = Math.min(H, Math.ceil((y1 - cam.y) * cam.zoom * dpr + pad)) - by;
    if (bw <= 0 || bh <= 0) continue;

    sc.setTransform(1, 0, 0, 1, 0, 0);
    sc.globalCompositeOperation = 'source-over';
    sc.clearRect(bx, by, bw, bh);
    const zx = dpr * cam.zoom;
    sc.setTransform(zx, 0, 0, zx, -cam.x * zx, -cam.y * zx);
    for (const el of els) drawElement(sc, el, cam.x, cam.y, vx1, vy1);
    sc.setTransform(1, 0, 0, 1, 0, 0);
    // полупрозрачное (маркер, сглаживание) уплотняем, затем красим силуэт
    sc.drawImage(flashShape, bx, by, bw, bh, bx, by, bw, bh);
    sc.drawImage(flashShape, bx, by, bw, bh, bx, by, bw, bh);
    sc.globalCompositeOperation = 'source-in';
    sc.fillStyle = FLASH_COLOR;
    sc.fillRect(bx, by, bw, bh);
    sc.globalCompositeOperation = 'source-over';

    rc.setTransform(1, 0, 0, 1, 0, 0);
    rc.globalCompositeOperation = 'source-over';
    rc.clearRect(bx, by, bw, bh);
    for (const rr of [r, r * 0.5]) {
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        rc.drawImage(flashShape, bx, by, bw, bh, bx + Math.cos(a) * rr, by + Math.sin(a) * rr, bw, bh);
      }
    }
    rc.globalCompositeOperation = 'destination-out';
    rc.drawImage(flashShape, bx, by, bw, bh, bx, by, bw, bh);
    rc.globalCompositeOperation = 'source-over';

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = flashAlpha(now - f.t);
    ctx.shadowColor = FLASH_COLOR;
    ctx.shadowBlur = 10 * dpr;
    ctx.drawImage(flashRing, bx, by, bw, bh, bx, by, bw, bh);
    ctx.restore();
  }
  requestRender(); // гоним кадры до конца подсветки
}

/** Сужающаяся лента по точкам экрана: hw — полуширина в каждой точке. */
function taperPath(xs: number[], ys: number[], hw: number[]): Path2D {
  const path = new Path2D();
  const n = xs.length;
  const nx: number[] = [], ny: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
    const dx = xs[b] - xs[a], dy = ys[b] - ys[a];
    const len = Math.hypot(dx, dy) || 1;
    nx.push(-dy / len); ny.push(dx / len);
  }
  path.moveTo(xs[0] + nx[0] * hw[0], ys[0] + ny[0] * hw[0]);
  for (let i = 1; i < n; i++) path.lineTo(xs[i] + nx[i] * hw[i], ys[i] + ny[i] * hw[i]);
  // скруглённая голова в последней точке
  const th = Math.atan2(ny[n - 1], nx[n - 1]);
  path.arc(xs[n - 1], ys[n - 1], hw[n - 1], th, th - Math.PI, true);
  for (let i = n - 2; i >= 0; i--) path.lineTo(xs[i] - nx[i] * hw[i], ys[i] - ny[i] * hw[i]);
  path.closePath();
  return path;
}

/** Лазерная указка: светящийся след, который сужается и гаснет к хвосту. */
function drawLaser(ctx: CanvasRenderingContext2D): void {
  const now = performance.now();
  const alive = state.laserPts.filter(p => now - p.t < LASER_TTL);
  if (alive.length !== state.laserPts.length) state.laserPts = alive;
  const hover = state.tool === 'laser' ? state.hover : null;
  if (alive.length === 0 && !hover) return;
  // свечение — широкий полупрозрачный ореол, а не shadowBlur: размытие
  // считается по габариту пути и на длинном следе стоит слишком дорого
  if (alive.length > 1) {
    const xs: number[] = [], ys: number[] = [], k: number[] = [];
    for (const p of alive) {
      xs.push(p.x);
      ys.push(p.y);
      k.push(Math.pow(1 - (now - p.t) / LASER_TTL, 0.7));
    }
    // хвост дотягиваем до курсора, чтобы голова не отставала
    if (hover) { xs.push(hover.x); ys.push(hover.y); k.push(1); }
    ctx.fillStyle = hexA(LASER_COLOR, 0.22);
    ctx.fill(taperPath(xs, ys, k.map(v => v * LASER_R * 2.2)));
    ctx.fillStyle = LASER_COLOR;
    ctx.fill(taperPath(xs, ys, k.map(v => v * LASER_R)));
    ctx.fillStyle = '#ffe3e3';
    ctx.fill(taperPath(xs, ys, k.map(v => v * LASER_R * 0.38)));
  }
  const head = hover ?? alive[alive.length - 1];
  if (head) {
    ctx.fillStyle = hexA(LASER_COLOR, 0.25);
    ctx.beginPath();
    ctx.arc(head.x, head.y, LASER_R * 2.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = LASER_COLOR;
    ctx.beginPath();
    ctx.arc(head.x, head.y, LASER_R + 1, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(head.x, head.y, 2.2, 0, Math.PI * 2);
    ctx.fill();
  }
  if (alive.length > 0) requestRender(); // гоним кадры, пока след гаснет
}

export const partEraseRadius = PART_ERASE_R;
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
