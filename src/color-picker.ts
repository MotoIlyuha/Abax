// Свой пикер цвета: квадрат насыщенность–яркость, радужная полоса тона и поле hex.
// Нужен панели цветов и разделу «Экспериментальные» (цвета иконки приложения).

import { EYEDROPPER_ICON } from './icons';

export function hsvToHex(h: number, s: number, v: number): string {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    const val = v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
    return Math.round(val * 255).toString(16).padStart(2, '0');
  };
  return `#${f(5)}${f(3)}${f(1)}`;
}

export function hexToHsv(hex: string): { h: number; s: number; v: number } {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = 60 * (((g - b) / d) % 6);
    else if (max === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
  }
  if (h < 0) h += 360;
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

/** Пиксель холста под точкой экрана; null — прозрачно или холст недоступен для чтения. */
function canvasPixel(cv: HTMLCanvasElement, x: number, y: number): string | null {
  const r = cv.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return null;
  const px = Math.floor((x - r.left) * cv.width / r.width);
  const py = Math.floor((y - r.top) * cv.height / r.height);
  if (px < 0 || py < 0 || px >= cv.width || py >= cv.height) return null;
  try {
    const d = cv.getContext('2d')?.getImageData(px, py, 1, 1).data;
    if (!d || d[3] === 0) return null;
    return rgbToHex(d[0], d[1], d[2]);
  } catch {
    return null; // «грязный» холст (чужая картинка) или не 2D
  }
}

function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map(n => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')).join('');
}

/** 'rgb(…)' / 'rgba(…)' из getComputedStyle → hex; прозрачный — null. */
function cssColorToHex(css: string): string | null {
  const m = /^rgba?\(([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?/.exec(css);
  if (!m || (m[4] !== undefined && Number(m[4]) === 0)) return null;
  return rgbToHex(Number(m[1]), Number(m[2]), Number(m[3]));
}

/** Цвет окна приложения под точкой: пиксель холста, иначе фон ближайшего непрозрачного элемента. */
export function sampleColorAt(x: number, y: number, skip?: globalThis.Element): string | null {
  for (const node of document.elementsFromPoint(x, y)) {
    if (node === skip) continue;
    if (node instanceof HTMLCanvasElement) {
      const c = canvasPixel(node, x, y);
      if (c) return c;
      continue;
    }
    const c = cssColorToHex(getComputedStyle(node).backgroundColor);
    if (c) return c;
  }
  return null;
}

/**
 * Пипетка: курсор-прицел поверх окна, onHover — цвет под курсором на каждое движение,
 * щелчок — onPick, Esc или правая кнопка — onCancel.
 */
let dropperActive = false;
/** Пипетка ждёт щелчка: Esc принадлежит ей (глобальные обработчики Esc его пропускают). */
export function eyedropperActive(): boolean { return dropperActive; }

function startEyedropper(onHover: (hex: string) => void, onPick: (hex: string) => void, onCancel: () => void): void {
  const overlay = document.createElement('div');
  overlay.className = 'eyedropper-overlay';
  const loupe = document.createElement('div');
  loupe.className = 'eyedropper-loupe';
  loupe.hidden = true;
  overlay.appendChild(loupe);
  document.body.appendChild(overlay);
  dropperActive = true;
  let current: string | null = null;
  const at = (e: PointerEvent) => {
    const c = sampleColorAt(e.clientX, e.clientY, overlay);
    loupe.hidden = false;
    loupe.style.left = `${e.clientX}px`;
    loupe.style.top = `${e.clientY}px`;
    if (!c) return;
    current = c;
    loupe.style.background = c;
    onHover(c);
  };
  const finish = () => {
    dropperActive = false;
    overlay.remove();
    window.removeEventListener('keydown', onKey, true);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    e.preventDefault(); e.stopPropagation();
    finish(); onCancel();
  };
  overlay.addEventListener('pointermove', at);
  overlay.addEventListener('pointerdown', e => {
    e.preventDefault(); e.stopPropagation();
    if (e.button !== 0) { finish(); onCancel(); return; }
    at(e);
    finish();
    if (current) onPick(current); else onCancel();
  });
  overlay.addEventListener('contextmenu', e => e.preventDefault());
  window.addEventListener('keydown', onKey, true);
}

/** Собственный пикер: SV-квадрат + радужная полоса + hex; eyedropper — кнопка «Пипетка» справа от превью. */
export function buildCustomColorPicker(host: HTMLElement, initial: string, onChange: (hex: string) => void, opts: { eyedropper?: boolean } = {}): void {
  host.textContent = '';
  let { h, s, v } = hexToHsv(initial);
  const sv = document.createElement('div');
  sv.className = 'picker-sv';
  const cursor = document.createElement('div');
  cursor.className = 'picker-cursor';
  sv.appendChild(cursor);
  const hue = document.createElement('input');
  hue.type = 'range';
  hue.min = '0';
  hue.max = '360';
  hue.value = String(Math.round(h));
  hue.className = 'picker-hue';
  const hexRow = document.createElement('div');
  hexRow.className = 'picker-hex';
  const hexInput = document.createElement('input');
  hexInput.value = initial;
  hexInput.maxLength = 7;
  const swatch = document.createElement('span');
  swatch.className = 'picker-swatch';
  hexRow.append(hexInput, swatch);
  host.append(sv, hue, hexRow);
  if (opts.eyedropper) {
    const dropper = document.createElement('button');
    dropper.type = 'button';
    dropper.className = 'picker-eyedropper';
    dropper.title = 'Пипетка';
    dropper.setAttribute('aria-label', 'Пипетка');
    dropper.innerHTML = EYEDROPPER_ICON; // константа иконки, не пользовательские данные
    // превью и hex показывают цвет под пипеткой; отмена возвращает прежний
    const preview = (hex: string) => { swatch.style.background = hex; hexInput.value = hex; };
    dropper.addEventListener('click', () => {
      dropper.classList.add('active');
      startEyedropper(preview, hex => {
        dropper.classList.remove('active');
        ({ h, s, v } = hexToHsv(hex));
        apply(true);
      }, () => {
        dropper.classList.remove('active');
        apply(false);
      });
    });
    hexRow.appendChild(dropper);
  }

  const apply = (emit: boolean) => {
    const base = hsvToHex(h, 1, 1);
    sv.style.background = `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, ${base})`;
    cursor.style.left = `${Math.round(s * 100)}%`;
    cursor.style.top = `${Math.round((1 - v) * 100)}%`;
    cursor.style.background = hsvToHex(h, s, v);
    hue.value = String(Math.round(h));
    const hex = hsvToHex(h, s, v);
    if (hexInput.value.toLowerCase() !== hex) hexInput.value = hex;
    swatch.style.background = hex;
    if (emit) onChange(hex);
  };
  const pointToSv = (e: PointerEvent) => {
    const r = sv.getBoundingClientRect();
    s = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    v = Math.max(0, Math.min(1, 1 - (e.clientY - r.top) / r.height));
    apply(true);
  };
  sv.addEventListener('pointerdown', e => {
    pointToSv(e);
    try { sv.setPointerCapture(e.pointerId); } catch { /* синтетика/потерянный pointer — цвет уже применён */ }
  });
  sv.addEventListener('pointermove', e => {
    if (e.buttons > 0) pointToSv(e);
  });
  hue.addEventListener('input', () => {
    h = Number(hue.value);
    apply(true);
  });
  hexInput.addEventListener('change', () => {
    if (/^#[0-9a-fA-F]{6}$/.test(hexInput.value)) {
      ({ h, s, v } = hexToHsv(hexInput.value.toLowerCase()));
      apply(true);
    }
  });
  apply(false);
}
