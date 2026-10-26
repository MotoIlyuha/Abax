// Цвета иконки приложения (раздел «Экспериментальные»): логотип — круг и треугольник одним цветом
// и точка в центре другим. Свои цвета меняют значок вкладки, логотипы в окне настроек
// и иконку окна приложения для компьютера (Electron). Хранятся на этом устройстве.

import { doskaApi } from './storage';

export interface IconColors {
  /** Круг и треугольник. */
  main: string;
  /** Точка в центре. */
  accent: string;
}

/** Как в public/logo.svg. */
export const DEFAULT_ICON_COLORS: IconColors = { main: '#315b3c', accent: '#a8600a' };
const BG = '#f3f1e7';
const KEY = 'doska.iconColors';
const HEX = /^#[0-9a-f]{6}$/i;

/** Смесь двух цветов #rrggbb: t = 0 — a, 1 — b. */
function mix(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const ch = (shift: number) => Math.round(((pa >> shift) & 255) * (1 - t) + ((pb >> shift) & 255) * t);
  return `#${[16, 8, 0].map(s => ch(s).toString(16).padStart(2, '0')).join('')}`;
}

/** Логотип в SVG с заданными цветами (рамка — светлый оттенок основного, как в исходном). */
export function logoSvg(c: IconColors): string {
  const frame = mix(BG, c.main, 0.25);
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="256" height="256" aria-hidden="true">'
    + `<rect x="0.6" y="0.6" width="62.8" height="62.8" rx="14.4" fill="${BG}" stroke="${frame}" stroke-width="1.2"/>`
    + `<circle cx="32" cy="32" r="19" fill="none" stroke="${c.main}" stroke-width="3.6"/>`
    + `<path d="M32 13 L48.45 41.5 L15.55 41.5 Z" fill="none" stroke="${c.main}" stroke-width="3.6" stroke-linejoin="round"/>`
    + `<circle cx="32" cy="32" r="2.6" fill="${c.accent}"/></svg>`;
}

export function logoDataUrl(c: IconColors): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(logoSvg(c))}`;
}

export function sameColors(a: IconColors, b: IconColors): boolean {
  return a.main.toLowerCase() === b.main.toLowerCase() && a.accent.toLowerCase() === b.accent.toLowerCase();
}

/** Сохранённые цвета; своих нет — по умолчанию. */
export function iconColors(): IconColors {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || 'null') as Partial<IconColors> | null;
    if (v && typeof v.main === 'string' && HEX.test(v.main) && typeof v.accent === 'string' && HEX.test(v.accent)) {
      return { main: v.main.toLowerCase(), accent: v.accent.toLowerCase() };
    }
  } catch { /* битые — по умолчанию */ }
  return { ...DEFAULT_ICON_COLORS };
}

/** Сохранить и применить; цвета по умолчанию не храним (null — сброс). */
export function saveIconColors(c: IconColors | null): void {
  const next = c ? { main: c.main.toLowerCase(), accent: c.accent.toLowerCase() } : { ...DEFAULT_ICON_COLORS };
  try {
    if (sameColors(next, DEFAULT_ICON_COLORS)) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, JSON.stringify(next));
  } catch { /* не сохранится — применим хотя бы сейчас */ }
  applyAppIcon(next);
}

/** Адрес логотипа для <img>: по умолчанию — файл из public/, свои цвета — SVG на лету. */
export function logoSrc(c: IconColors = iconColors()): string {
  return sameColors(c, DEFAULT_ICON_COLORS) ? 'logo.svg' : logoDataUrl(c);
}

/** PNG 256×256 из SVG — для иконки окна Electron (SVG она не берёт). */
async function logoPng(c: IconColors): Promise<string | null> {
  const img = new Image();
  img.src = logoDataUrl(c);
  try {
    await img.decode();
  } catch {
    return null;
  }
  const cv = document.createElement('canvas');
  cv.width = cv.height = 256;
  const ctx = cv.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, 256, 256);
  return cv.toDataURL('image/png');
}

/** Значок вкладки, логотипы на странице и иконка окна приложения. */
export function applyAppIcon(c: IconColors = iconColors()): void {
  const src = logoSrc(c);
  const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (link) link.href = src;
  for (const img of document.querySelectorAll<HTMLImageElement>('img.app-logo')) img.src = src;
  if (doskaApi?.setAppIcon) {
    const api = doskaApi;
    void logoPng(c).then(png => { if (png) void api.setAppIcon?.(png); });
  }
}

/** Запуск: свои цвета сохранены — применить (по умолчанию всё и так на месте). */
export function initAppIcon(): void {
  const c = iconColors();
  if (!sameColors(c, DEFAULT_ICON_COLORS)) applyAppIcon(c);
}
