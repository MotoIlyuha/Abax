// Каталог персональных курсоров (Ночь №4). Чистый модуль без DOM: его используют клиент,
// хабы комнат и сервер (белый список и проверка тарифа).
// За пресетом жёстко закреплены три вещи: вид курсора, цвет выделения и цвет бейджа с именем.
// SVG курсоров собирается только из констант этого файла — пользовательские данные в разметку не попадают.

import type { PlanTier } from './types';

export type CursorTier = 'free' | 'pro';
export type CursorEffect = 'none' | 'glow' | 'trail' | 'sparkle';
export type CursorPattern = 'geometry' | 'cosmos' | 'neon' | 'holo' | 'pixel' | 'gold' | 'flame' | 'aurora';

export interface CursorPreset {
  id: string;
  /** Название в каталоге. */
  name: string;
  tier: CursorTier;
  /** Заливка стрелки: цвет (у узоров — основной цвет под узором). */
  fill: string;
  /** Контур стрелки. */
  outline: string;
  pattern?: CursorPattern;
  /** Рамка выделения, ручки и рамка выделения областью. */
  selectionColor: string;
  /** Плашка с именем у курсора в совместной работе. */
  badgeBg: string;
  badgeText: string;
  effect: CursorEffect;
  /** Цвет частиц или свечения. */
  effectColor: string;
}

export const DEFAULT_CURSOR_ID = 'default';

export const CURSOR_PRESETS: readonly CursorPreset[] = [
  // ----- бесплатные -----
  { id: 'default', name: 'Классика', tier: 'free', fill: '#ffffff', outline: '#1f2329', selectionColor: '#3273f5', badgeBg: '#2160dd', badgeText: '#ffffff', effect: 'none', effectColor: '#3273f5' },
  { id: 'graphite', name: 'Графит', tier: 'free', fill: '#2b2f36', outline: '#ffffff', selectionColor: '#e8590c', badgeBg: '#2b2f36', badgeText: '#ffa94d', effect: 'none', effectColor: '#e8590c' },
  { id: 'mint', name: 'Мята', tier: 'free', fill: '#96f2d7', outline: '#0b4f3c', selectionColor: '#0ca678', badgeBg: '#087f5b', badgeText: '#ffffff', effect: 'none', effectColor: '#0ca678' },
  { id: 'coral', name: 'Коралл', tier: 'free', fill: '#ffa8a8', outline: '#7a1f1f', selectionColor: '#e03131', badgeBg: '#c92a2a', badgeText: '#ffffff', effect: 'none', effectColor: '#e03131' },
  { id: 'lavender', name: 'Лаванда', tier: 'free', fill: '#d0bfff', outline: '#3b2a7a', selectionColor: '#7048e8', badgeBg: '#6741d9', badgeText: '#ffffff', effect: 'none', effectColor: '#7048e8' },
  { id: 'amber', name: 'Янтарь', tier: 'free', fill: '#ffd43b', outline: '#5c3c00', selectionColor: '#cc6a00', badgeBg: '#ffd43b', badgeText: '#3d2a00', effect: 'none', effectColor: '#f59f00' },
  // ----- Pro -----
  { id: 'geometry', name: 'Геометрия', tier: 'pro', fill: '#4c6ef5', outline: '#1b2a6b', pattern: 'geometry', selectionColor: '#4263eb', badgeBg: '#364fc7', badgeText: '#ffffff', effect: 'trail', effectColor: '#748ffc' },
  { id: 'cosmos', name: 'Космос', tier: 'pro', fill: '#1b1f3b', outline: '#e5dbff', pattern: 'cosmos', selectionColor: '#7950f2', badgeBg: '#1b1f3b', badgeText: '#d0bfff', effect: 'sparkle', effectColor: '#d0bfff' },
  { id: 'neon', name: 'Неон', tier: 'pro', fill: '#0b0f14', outline: '#3bf0ff', pattern: 'neon', selectionColor: '#0c8599', badgeBg: '#0b0f14', badgeText: '#3bf0ff', effect: 'glow', effectColor: '#3bf0ff' },
  { id: 'hologram', name: 'Голограмма', tier: 'pro', fill: '#c39bff', outline: '#4a2a6b', pattern: 'holo', selectionColor: '#ae3ec9', badgeBg: '#9c36b5', badgeText: '#ffffff', effect: 'trail', effectColor: '#da77f2' },
  { id: 'pixel', name: 'Пиксель', tier: 'pro', fill: '#40c057', outline: '#123d1b', pattern: 'pixel', selectionColor: '#2b8a3e', badgeBg: '#1e6e30', badgeText: '#ffffff', effect: 'trail', effectColor: '#69db7c' },
  { id: 'gold', name: 'Золото', tier: 'pro', fill: '#fcc419', outline: '#7a4a00', pattern: 'gold', selectionColor: '#d9480f', badgeBg: '#5c3c00', badgeText: '#ffe066', effect: 'sparkle', effectColor: '#ffd43b' },
  { id: 'flame', name: 'Пламя', tier: 'pro', fill: '#ff6b00', outline: '#5c1300', pattern: 'flame', selectionColor: '#f03e3e', badgeBg: '#1f1300', badgeText: '#ffa94d', effect: 'trail', effectColor: '#ff922b' },
  { id: 'aurora', name: 'Аврора', tier: 'pro', fill: '#22b8cf', outline: '#0b3d4a', pattern: 'aurora', selectionColor: '#1098ad', badgeBg: '#0b7285', badgeText: '#ffffff', effect: 'glow', effectColor: '#63e6be' },
];

const BY_ID = new Map(CURSOR_PRESETS.map(p => [p.id, p]));

export const CURSOR_IDS: readonly string[] = CURSOR_PRESETS.map(p => p.id);

export function isCursorId(v: unknown): v is string {
  return typeof v === 'string' && BY_ID.has(v);
}

/** Пресет по идентификатору; неизвестный — классический. */
export function cursorPreset(id: string | null | undefined): CursorPreset {
  return (id && BY_ID.get(id)) || BY_ID.get(DEFAULT_CURSOR_ID)!;
}

/** Доступен ли курсор на тарифе: бесплатные — всем, Pro — на pro и tutor. */
export function canUseCursor(id: string, plan: PlanTier): boolean {
  const p = BY_ID.get(id);
  if (!p) return false;
  return p.tier === 'free' || plan !== 'free';
}

/**
 * Идентификатор из сети или хранилища: не строка или не из каталога — undefined;
 * Pro-курсор без права — классический.
 */
export function cleanCursorId(raw: unknown, allowPro: boolean): string | undefined {
  if (!isCursorId(raw)) return undefined;
  if (!allowPro && BY_ID.get(raw)!.tier === 'pro') return DEFAULT_CURSOR_ID;
  return raw;
}

// ----- SVG -----

/** Скруглённая стрелка 32×32 (единая форма всех курсоров), кончик в (3, 3) — горячая точка курсора. */
export const ARROW_PATH = 'M20.54 14.32C23.29 12.84 24.67 12.1 25.01 11.21C25.32 10.44 25.23 9.57 24.79 8.87C24.27 8.06 22.78 7.6 19.79 6.68L8.51 3.21C5.99 2.43 4.73 2.04 3.9 2.36C3.17 2.63 2.61 3.21 2.35 3.95C2.07 4.79 2.49 6.04 3.35 8.53L7.13 19.58C8.18 22.64 8.71 24.18 9.55 24.66C10.27 25.09 11.16 25.13 11.93 24.79C12.81 24.39 13.49 22.91 14.85 19.97L15.85 17.79C16.06 17.32 16.17 17.09 16.32 16.89C16.45 16.7 16.61 16.54 16.78 16.4C16.97 16.24 17.2 16.12 17.66 15.87L20.54 14.32Z';
export const CURSOR_HOTSPOT = { x: 3, y: 3 } as const;

/** Узор внутри стрелки: определения (defs), заливка и декор поверх заливки (обрезается по стрелке). */
function patternParts(p: CursorPreset, pre: string): { defs: string; fill: string; decor: string } {
  const g = (stops: [number, string][], x2 = 1, y2 = 1) =>
    `<linearGradient id="${pre}g" x1="0" y1="0" x2="${x2}" y2="${y2}">${stops.map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`).join('')}</linearGradient>`;
  switch (p.pattern) {
    case 'geometry':
      return {
        defs: `<pattern id="${pre}p" width="6" height="6" patternUnits="userSpaceOnUse"><rect width="6" height="6" fill="${p.fill}"/><path d="M0 6L3 0.8L6 6Z" fill="#91a7ff"/><circle cx="3" cy="4.2" r="0.8" fill="#ffffff"/></pattern>`,
        fill: `url(#${pre}p)`, decor: '',
      };
    case 'cosmos':
      return {
        defs: g([[0, '#1b1f3b'], [0.6, '#3b2a6b'], [1, '#5f3dc4']], 0.6, 1),
        fill: `url(#${pre}g)`,
        decor: [[6, 6, 0.7], [11, 7.5, 0.6], [18, 9.5, 0.7], [8, 11, 0.8], [14, 12.5, 0.6], [16, 15, 1.1], [10, 16, 0.7], [9.5, 21, 0.6]]
          .map(([x, y, r], i) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${i === 5 ? '#b197fc' : '#ffffff'}"/>`).join(''),
      };
    case 'neon':
      return {
        defs: '',
        fill: p.fill,
        decor: `<path d="M7 6.5L18 9.8M6 10L9.5 20" stroke="#ff3bd4" stroke-width="1" stroke-linecap="round" opacity=".9"/>`,
      };
    case 'holo':
      return {
        defs: g([[0, '#ff8cc6'], [0.35, '#7ae7ff'], [0.65, '#fff59d'], [1, '#c39bff']])
          + `<pattern id="${pre}p" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="1.2" height="4" fill="#ffffff" opacity=".45"/></pattern>`,
        fill: `url(#${pre}g)`,
        decor: `<rect width="32" height="32" fill="url(#${pre}p)"/>`,
      };
    case 'pixel':
      return {
        defs: `<pattern id="${pre}p" width="4" height="4" patternUnits="userSpaceOnUse"><rect width="4" height="4" fill="${p.fill}"/><rect width="2" height="2" fill="#2f9e44"/><rect x="2" y="2" width="2" height="2" fill="#8ce99a"/></pattern>`,
        fill: `url(#${pre}p)`, decor: '',
      };
    case 'gold':
      return {
        defs: g([[0, '#fff3bf'], [0.45, '#fcc419'], [1, '#e67700']], 0.4, 1),
        fill: `url(#${pre}g)`,
        decor: '<path d="M2 12L12 2L15 2L2 15Z" fill="#ffffff" opacity=".55"/><path d="M2 19L18 3L19 3L2 20Z" fill="#ffffff" opacity=".35"/>',
      };
    case 'flame':
      return {
        defs: g([[0, '#ffd43b'], [0.5, '#ff6b00'], [1, '#e03131']], 0, 1),
        fill: `url(#${pre}g)`,
        decor: '<path d="M7 20C7 16 10 15 9 11C11.5 13 12 15.5 11 18C12.5 17 13 16 13 14.5C15 17 14.5 21 11 23C9 23.5 7 22.5 7 20Z" fill="#fff3bf" opacity=".8"/>',
      };
    case 'aurora':
      return {
        defs: g([[0, '#63e6be'], [0.4, '#22b8cf'], [0.75, '#845ef7'], [1, '#e599f7']], 0.3, 1),
        fill: `url(#${pre}g)`,
        decor: '<path d="M2 11C7 9 9 13 14 11S20 13 24 12" stroke="#ffffff" stroke-width="1" fill="none" opacity=".6"/><path d="M2 17C7 15 9 19 14 17S20 19 24 18" stroke="#ffffff" stroke-width=".8" fill="none" opacity=".45"/>',
      };
    default:
      return { defs: '', fill: p.fill, decor: '' };
  }
}

export interface CursorSvgOptions {
  /** Ширина и высота в пикселях (по умолчанию 32). */
  size?: number;
  /** Класс корневого элемента (для иконок в интерфейсе). */
  className?: string;
}

/** Самодостаточная SVG-разметка курсора; неизвестный идентификатор — классический курсор. */
export function cursorSvg(id: string | null | undefined, opts: CursorSvgOptions = {}): string {
  const p = cursorPreset(id);
  const size = opts.size ?? 32;
  const pre = `abc-${p.id}-`;
  const parts = patternParts(p, pre);
  const clip = parts.decor ? `<clipPath id="${pre}c"><path d="${ARROW_PATH}"/></clipPath>` : '';
  const defs = parts.defs || clip ? `<defs>${parts.defs}${clip}</defs>` : '';
  // свечение вшито в сам курсор: широкий полупрозрачный контур под стрелкой
  const glow = p.effect === 'glow'
    ? `<path d="${ARROW_PATH}" fill="none" stroke="${p.effectColor}" stroke-width="4" stroke-linejoin="round" opacity=".35"/>`
    : '';
  const decor = parts.decor ? `<g clip-path="url(#${pre}c)">${parts.decor}</g>` : '';
  const cls = opts.className ? ` class="${opts.className}"` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg"${cls} width="${size}" height="${size}" viewBox="0 0 32 32" aria-hidden="true">${defs}${glow}`
    + `<path d="${ARROW_PATH}" fill="${parts.fill}"/>${decor}`
    + `<path d="${ARROW_PATH}" fill="none" stroke="${p.outline}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

/** Значение CSS cursor: аппаратный курсор из SVG (data URL), запасной — системная стрелка. */
export function cursorCss(id: string | null | undefined): string {
  return `url("data:image/svg+xml,${encodeURIComponent(cursorSvg(id))}") ${CURSOR_HOTSPOT.x} ${CURSOR_HOTSPOT.y}, default`;
}

// ----- контраст (WCAG 2.x) -----

function luminance(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return 0;
  const ch = [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16) / 255)
    .map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

/** Контраст двух цветов #rrggbb (1…21). */
export function contrastRatio(a: string, b: string): number {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
