// Пипетка внутри окна приложения: прицел поверх всего, лупа с пиксельной сеткой, живой цвет под курсором.
// Пиксели доски читаются с холстов, остальное окно — по фону элементов (getComputedStyle):
// снимок экрана браузер странице не даёт, а встроенный EyeDropper не сообщает цвет до щелчка.

import { S, atRest, clamp, motionEnabled, register, snap, spring, step, tune, unregister, wake, type MotionComponent } from './motion';

/** Сторона клетки лупы, CSS px; лупа увеличивает пиксели экрана во столько раз. */
const CELL = 10;
export const LOUPE_MIN = 70;
export const LOUPE_MAX = 250;
/** Размер лупы помнится между вызовами пипетки. */
let loupeSize = 130;

let active = false;
/** Пипетка ждёт щелчка: Esc принадлежит ей (глобальные обработчики Esc его пропускают). */
export function eyedropperActive(): boolean { return active; }

export function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map(n => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')).join('');
}

/** 'rgb(…)' / 'rgba(…)' из getComputedStyle → hex; прозрачный — null. */
export function cssColorToHex(css: string): string | null {
  const m = /^rgba?\(([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?/.exec(css);
  if (!m || (m[4] !== undefined && Number(m[4]) === 0)) return null;
  return rgbToHex(Number(m[1]), Number(m[2]), Number(m[3]));
}

/**
 * Сэмплер одного кадра: фон элемента и область холста читаются один раз на кадр,
 * поэтому сетка лупы (сотни точек) не дёргает getComputedStyle и getImageData на каждую клетку.
 */
class FrameSampler {
  private readonly bg = new Map<globalThis.Element, string | null>();
  private readonly regions = new Map<HTMLCanvasElement, { x0: number; y0: number; w: number; h: number; data: Uint8ClampedArray | null; sx: number; sy: number; r: DOMRect }>();

  constructor(private readonly skip: globalThis.Element, private readonly cx: number, private readonly cy: number, private readonly half: number) {}

  at(x: number, y: number): string | null {
    // быстрый путь: верхний элемент (пипетка на время кадра прозрачна для попаданий, см. draw)
    const top = document.elementFromPoint(x, y);
    if (top && !this.skip.contains(top)) {
      const c = this.colorOf(top, x, y);
      if (c) return c;
    }
    for (const node of document.elementsFromPoint(x, y)) {
      if (node === top) continue;
      if (this.skip.contains(node)) continue;
      const c = this.colorOf(node, x, y);
      if (c) return c;
    }
    return null;
  }

  private colorOf(node: globalThis.Element, x: number, y: number): string | null {
    if (node instanceof HTMLCanvasElement) return this.canvasPixel(node, x, y);
    let c = this.bg.get(node);
    if (c === undefined) { c = cssColorToHex(getComputedStyle(node).backgroundColor); this.bg.set(node, c); }
    return c;
  }

  private canvasPixel(cv: HTMLCanvasElement, x: number, y: number): string | null {
    let reg = this.regions.get(cv);
    if (!reg) {
      const r = cv.getBoundingClientRect();
      const sx = r.width ? cv.width / r.width : 1, sy = r.height ? cv.height / r.height : 1;
      // вся область лупы этого холста — одним чтением
      const x0 = clamp(Math.floor((this.cx - this.half - r.left) * sx), 0, cv.width);
      const y0 = clamp(Math.floor((this.cy - this.half - r.top) * sy), 0, cv.height);
      const x1 = clamp(Math.ceil((this.cx + this.half + 1 - r.left) * sx), 0, cv.width);
      const y1 = clamp(Math.ceil((this.cy + this.half + 1 - r.top) * sy), 0, cv.height);
      let data: Uint8ClampedArray | null = null;
      if (x1 > x0 && y1 > y0) {
        try { data = cv.getContext('2d')?.getImageData(x0, y0, x1 - x0, y1 - y0).data ?? null; } catch { data = null; } // «грязный» холст или не 2D
      }
      reg = { x0, y0, w: x1 - x0, h: y1 - y0, data, sx, sy, r };
      this.regions.set(cv, reg);
    }
    if (!reg.data) return null;
    const px = Math.floor((x + 0.5 - reg.r.left) * reg.sx) - reg.x0;
    const py = Math.floor((y + 0.5 - reg.r.top) * reg.sy) - reg.y0;
    if (px < 0 || py < 0 || px >= reg.w || py >= reg.h) return null;
    const i = (py * reg.w + px) * 4;
    if (reg.data[i + 3] === 0) return null;
    return rgbToHex(reg.data[i], reg.data[i + 1], reg.data[i + 2]);
  }
}

/** Цвет окна приложения под точкой (вне пипетки). */
export function sampleColorAt(x: number, y: number, skip: globalThis.Element): string | null {
  return new FrameSampler(skip, x, y, 0).at(x, y);
}


/**
 * Пипетка: курсор-прицел поверх окна и лупа с пиксельной сеткой; колесо меняет размер лупы
 * (плавно — при «улучшенных» анимациях). onHover — цвет под курсором, щелчок — onPick,
 * Esc или правая кнопка — onCancel.
 */
export function startEyedropper(onHover: (hex: string) => void, onPick: (hex: string) => void, onCancel: () => void): void {
  const overlay = document.createElement('div');
  overlay.className = 'eyedropper-overlay';
  const loupe = document.createElement('div');
  loupe.className = 'eyedropper-loupe';
  loupe.hidden = true;
  const grid = document.createElement('canvas');
  const label = document.createElement('div');
  label.className = 'eyedropper-hex';
  loupe.append(grid, label);
  overlay.appendChild(loupe);
  document.body.appendChild(overlay);
  active = true;

  const size = S(loupeSize);
  tune(size, ...spring('--spring-soft', [260, 24]));
  let x = -1, y = -1;
  let current: string | null = null;
  let queued = 0;

  const draw = () => {
    queued = 0;
    if (x < 0) return;
    const d = Math.round(size.x);
    const n = Math.ceil(d / CELL / 2) * 2 + 1; // нечётное: центральная клетка — под курсором
    const half = (n - 1) / 2;
    const dpr = window.devicePixelRatio || 1;
    if (grid.width !== Math.round(d * dpr)) { grid.width = Math.round(d * dpr); grid.height = grid.width; }
    grid.style.width = grid.style.height = `${d}px`;
    loupe.style.width = `${d}px`;
    loupe.style.height = `${d}px`;
    loupe.style.transform = `translate(${x - d / 2 + 0.5}px, ${y - d / 2 + 0.5}px)`; // центр лупы — на курсоре
    loupe.hidden = false;
    const ctx = grid.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, d, d);
    const sampler = new FrameSampler(overlay, x, y, half);
    overlay.style.pointerEvents = 'none'; // elementFromPoint видит то, что под пипеткой
    const off = d / 2 - CELL / 2 - half * CELL; // центр центральной клетки — в центре лупы
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        ctx.fillStyle = sampler.at(x + i - half, y + j - half) ?? '#ffffff';
        ctx.fillRect(off + i * CELL, off + j * CELL, CELL, CELL);
      }
    }
    // пиксельная сетка
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.12)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let k = 0; k <= n; k++) {
      const p = Math.round(off + k * CELL) + 0.5;
      ctx.moveTo(p, 0); ctx.lineTo(p, d);
      ctx.moveTo(0, p); ctx.lineTo(d, p);
    }
    ctx.stroke();
    // центральная клетка — выбираемый цвет
    const c0 = d / 2 - CELL / 2;
    ctx.strokeStyle = '#000';
    ctx.strokeRect(c0 - 0.5, c0 - 0.5, CELL + 1, CELL + 1);
    ctx.strokeStyle = '#fff';
    ctx.strokeRect(c0 + 0.5, c0 + 0.5, CELL - 1, CELL - 1);
    const c = sampler.at(x, y);
    overlay.style.pointerEvents = '';
    if (c && c !== current) { current = c; onHover(c); }
    label.textContent = current ?? '';
    loupe.style.setProperty('--loupe-color', current ?? 'transparent');
  };
  const schedule = () => { if (!queued) queued = requestAnimationFrame(draw); };

  // пружина размера: перерисовка лупы на каждом кадре движения
  const comp: MotionComponent = {
    frame: dt => step(size, dt),
    render: draw,
    settled: () => atRest(size, 0.05),
  };
  register(comp);

  const finish = () => {
    active = false;
    if (queued) cancelAnimationFrame(queued);
    unregister(comp);
    overlay.remove();
    window.removeEventListener('keydown', onKey, true);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    e.preventDefault(); e.stopPropagation();
    finish(); onCancel();
  };
  overlay.addEventListener('pointermove', e => { x = Math.floor(e.clientX); y = Math.floor(e.clientY); schedule(); });
  overlay.addEventListener('wheel', e => {
    e.preventDefault();
    loupeSize = clamp(loupeSize - e.deltaY * 0.25, LOUPE_MIN, LOUPE_MAX);
    size.t = loupeSize;
    if (motionEnabled()) wake();
    else { snap(size); schedule(); }
  }, { passive: false });
  overlay.addEventListener('pointerdown', e => {
    e.preventDefault(); e.stopPropagation();
    if (e.button !== 0) { finish(); onCancel(); return; }
    x = Math.floor(e.clientX); y = Math.floor(e.clientY);
    draw();
    finish();
    if (current) onPick(current); else onCancel();
  });
  overlay.addEventListener('contextmenu', e => e.preventDefault());
  window.addEventListener('keydown', onKey, true);
}
