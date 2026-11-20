// Все иконки интерфейса — одним каталогом. Это статичные константы: пользовательских данных
// в разметке нет, поэтому их безопасно вставлять через innerHTML.

import type { GridMode, TextAlign, TextVAlign } from './types';
import type { NoticeIcon } from './notify-center';

/** Обёртка контурной иконки 24×24: пути — константы каталога. */
export const svg = (paths: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

/** Невидимые линии на иконках тел — пунктиром, как на холсте. */
export const hid = (d: string) => `<path d="${d}" stroke-dasharray="2.2 2" stroke-width="1.4"/>`;

export const GRIP_ICON = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>';

export const ICONS = {
  home: svg('<path d="M3 11l9-8 9 8"/><path d="M5 10v10h5v-6h4v6h5V10"/>'),
  pages: svg('<rect x="8" y="3" width="12" height="15" rx="2"/><path d="M4.5 7v11.5A2.5 2.5 0 0 0 7 21h9"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  draft: svg('<path d="M4 20l1-4L16.5 4.5a2.1 2.1 0 0 1 3 3L8 19z"/><path d="M14.5 6.5l3 3"/>'),
  chevronUp: svg('<path d="M6 15l6-6 6 6"/>'),
  chevronDown: svg('<path d="M6 9l6 6 6-6"/>'),
  keyboard: svg('<rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M6 14h.01M18 14h.01M9 14h6"/>'),
  image: svg('<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10" r="1.5"/><path d="M21 15l-5-5L5 19"/>'),
  undo: svg('<path d="M4 10h9a5 5 0 0 1 0 10h-3"/><path d="M8 6l-4 4 4 4"/>'),
  redo: svg('<path d="M20 10h-9a5 5 0 0 0 0 10h3"/><path d="M16 6l4 4-4 4"/>'),
  fit: svg('<path d="M4 4v16M20 4v16M7 12h10M10 9l-3 3 3 3M14 9l3 3-3 3"/>'),
  export: svg('<path d="M12 3v12"/><path d="M8 11l4 4 4-4"/><path d="M4 19h16"/>'),
  present: svg('<rect x="2.5" y="4" width="19" height="13" rx="2"/><path d="M8 21h8M12 17v4"/><path d="M10.5 8.2l4 2.3-4 2.3z"/>'),
  pdf: svg('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M9 13h6M9 17h4"/>'),
  del: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  settings: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.1-1.55 1.7 1.7 0 0 0-1.88.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.55-1.1 1.7 1.7 0 0 0-.34-1.88l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34h.01a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55h.01a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v.01a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.55 1z"/>'),
  up: svg('<path d="M12 19V5"/><path d="M5 12l7-7 7 7"/>'),
  down: svg('<path d="M12 5v14"/><path d="M19 12l-7 7-7-7"/>'),
  group: svg('<rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="13" width="8" height="8" rx="1.5"/><path d="M11 11l2 2"/>'),
  duplicate: svg('<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>'),
  ungroup: svg('<rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="13" width="8" height="8" rx="1.5"/><path d="M13 6h4M15 4v4M7 13v4M5 15h4"/>'),
  trash: svg('<path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 13h10l1-13"/>'),
  toolbar: svg('<rect x="3" y="3" width="7" height="18" rx="2"/><path d="M14 7h7M14 12h7M14 17h7"/>'),
  chevron: svg('<path d="M9 6l6 6-6 6"/>'),
  star: svg('<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/>'),
  info: svg('<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 7.5v.01"/>'),
  flask: svg('<path d="M9 3h6"/><path d="M10 3v6.2L4.6 18.4A1.7 1.7 0 0 0 6.1 21h11.8a1.7 1.7 0 0 0 1.5-2.6L14 9.2V3"/><path d="M7.3 15h9.4"/>'),
  chevronLeft: svg('<path d="M15 6l-6 6 6 6"/>'),
  grid: svg('<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>'),
  list: svg('<path d="M9 6h11M9 12h11M9 18h11"/><path d="M4.5 6h.01M4.5 12h.01M4.5 18h.01"/>'),
  /** Иконки у проекта нет: смайлик с плюсом — «поставить». */
  addIcon: svg('<path d="M20.5 12A8.5 8.5 0 1 1 12 3.5"/><path d="M8.5 14.5a4.5 4.5 0 0 0 7 0"/><path d="M9 9.5h.01M15 9.5h.01"/><path d="M19 2.5v5M16.5 5h5"/>'),
  layers: svg('<path d="m12 3 9 5-9 5-9-5 9-5ZM3 12l9 5 9-5M3 16l9 5 9-5"/>'),
  layerTop: svg('<path d="m5 15 7-7 7 7"/>'),
  layerBottom: svg('<path d="m5 9 7 7 7-7"/>'),
  copyImage: svg('<rect x="3" y="3" width="14" height="14" rx="2"/><path d="m5 14 4-4 3 3 2-2 3 3M14 7h.01M7 21h12a2 2 0 0 0 2-2V7"/>'),
  sendChat: svg('<path d="M20 12.5a7.5 7.5 0 0 1-11 6.6L4 20.5l1.4-4.6A7.5 7.5 0 1 1 20 12.5z"/><path d="M12.5 15.5v-6M9.8 12l2.7-2.7 2.7 2.7"/>'),
  pen: svg('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>'),
  crop: svg('<path d="M6 3v13a2 2 0 0 0 2 2h13M3 6h13a2 2 0 0 1 2 2v13"/>'),
  link: svg('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>'),
  homeBack: svg('<path d="M19 12H5M11 6l-6 6 6 6"/>'),
  share: svg('<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/>'),
  menu: svg('<path d="M4 7h16M4 12h16M4 17h16"/>'),
  hideSection: svg('<path d="M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8"/><path d="M9.9 5.2A10 10 0 0 1 12 5c5 0 8.5 5 9 7a13 13 0 0 1-2.4 3.6M6.3 6.3A13 13 0 0 0 3 12c.5 2 4 7 9 7a10 10 0 0 0 4-.8"/>'),
  task: svg('<rect x="4" y="3.5" width="16" height="17" rx="2"/><path d="M8 8.5h8M8 12h8"/><path d="M8 16l1.8 1.8L13 14.5"/>'),
  openApp: svg('<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M9 17h6M12 6v7m-3-3 3 3 3-3"/>'),
  help: svg('<circle cx="12" cy="12" r="9"/><path d="M9.5 9.2a2.6 2.6 0 0 1 5 .9c0 1.7-2.5 2.3-2.5 4"/><path d="M12 17.2h.01"/>'),
  fullscreenExit: svg('<path d="M4 20l6-6M6 14h4v4M20 4l-6 6M18 10h-4V6"/>'),
  fullscreenEnter: svg('<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/>'),
  zoomOut: svg('<path d="M5 12h14"/>'),
  zoomIn: svg('<path d="M5 12h14M12 5v14"/>'),
  grip: GRIP_ICON,
  eye: svg('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
  eyeOff: svg('<path d="M10.6 5.1A10.4 10.4 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-2.6 3.5M6.6 6.6C3.7 8.4 2 12 2 12s3.5 7 10 7a9.8 9.8 0 0 0 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/><path d="M3 3l18 18"/>'),
  folder: svg('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
};

/** Контуры иконки ластика (24×24): из них же курсор объектного ластика на холсте. */
export const ERASER_PATHS = ['M20 20H8.5L3.6 15.1a2 2 0 0 1 0-2.8l8.6-8.6a2 2 0 0 1 2.8 0l6 6a2 2 0 0 1 0 2.8L13.5 19', 'M7 10.5l6.5 6.5'];

/** Середина стирающего края иконки — горячая точка курсора ластика. */
export const ERASER_TIP = { x: 6, y: 18 };


/** Иконки инструментов панели (кроме «select»: там курсор пользователя). */
export const TOOL_ICONS = {
  pan: svg('<path d="M12 3v18M3 12h18"/><path d="M9.5 5.5L12 3l2.5 2.5M9.5 18.5L12 21l2.5-2.5M5.5 9.5L3 12l2.5 2.5M18.5 9.5L21 12l-2.5 2.5"/>'),
  pen: svg('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>'),
  highlighter: svg('<path d="M9 11l-6 6v3h3l6-6"/><path d="M17.5 2.5l4 4L11 17l-4-4z"/>'),
  eraser: svg(ERASER_PATHS.map(d => `<path d="${d}"/>`).join('')),
  partEraser: svg('<path d="M10 12.5l5.6-5.6a1.6 1.6 0 0 1 2.3 0l1.6 1.6a1.6 1.6 0 0 1 0 2.3L14.5 15.8H11.6l-1.6-1.6a1.2 1.2 0 0 1 0-1.7z"/><path d="M2.5 19.5c1.5-1.5 2.8-1.5 4.2 0"/><path d="M16.8 19.5c1.5 1.5 3 1.5 4.7 0"/>'),
  text: svg('<path d="M5 7V5h14v2"/><path d="M12 5v14"/><path d="M9 19h6"/>'),
  note: svg('<rect x="4" y="5" width="16" height="14" rx="2"/><path d="M8 9.5h8"/><path d="M8 13h5"/>'),
  task: svg('<rect x="4" y="3.5" width="16" height="17" rx="2"/><path d="M8 8.5h8M8 12h8"/><path d="M8 16l1.8 1.8L13 14.5"/>'),
  spread: svg('<path d="M3 4h18"/><path d="M3 20h18" stroke-dasharray="2.5 2.5"/><path d="M12 7.5v9"/><path d="M8.5 13L12 16.5 15.5 13"/>'),
  rect: svg('<rect x="4" y="6" width="16" height="12" rx="1.5"/>'),
  ellipse: svg('<ellipse cx="12" cy="12" rx="8.5" ry="6.5"/>'),
  triangle: svg('<path d="M12 4.5L20.5 19H3.5z"/>'),
  line: svg('<path d="M5 19L19 5"/>'),
  arrow: svg('<path d="M5 19L18 6"/><path d="M12 6h6v6"/>'),
  poly: svg('<path d="M4 18l5-10 6 7 5-9"/>'),
  cube: svg('<path d="M4 9h11v11H4z"/><path d="M4 9l5-5h11l-5 5M20 4v11l-5 5"/>' + hid('M9 4v11h11M4 20l5-5')),
  box: svg('<path d="M2.5 11h14v9h-14z"/><path d="M2.5 11l5-5h14l-5 5M21.5 6v9l-5 5"/>' + hid('M7.5 6v9h14M2.5 20l5-5')),
  prism: svg('<path d="M6 4h13l-10.5 4z"/><path d="M6 4v13l2.5 4L19 17V4M8.5 8v13"/>' + hid('M6 17h13')),
  pyramid: svg('<path d="M3 20h12l5-5M3 20l8.5-17L15 20M11.5 3L20 15"/>' + hid('M20 15H8l-5 5M8 15l3.5-12')),
  truncPyramid: svg('<path d="M6 8h7l3-3H9z"/><path d="M2 20h13l6-5M2 20L6 8M15 20L13 8M21 15L16 5"/>' + hid('M21 15H8l-6 5M8 15L9 5')),
  cylinder: svg('<ellipse cx="12" cy="5" rx="7" ry="2.5"/><path d="M5 5v14M19 5v14M5 19a7 2.5 0 0 0 14 0"/>' + hid('M5 19a7 2.5 0 0 1 14 0')),
  cone: svg('<path d="M4 19L12 3l8 16M4 19a8 2.8 0 0 0 16 0"/>' + hid('M4 19a8 2.8 0 0 1 16 0')),
  truncCone: svg('<ellipse cx="12" cy="6" rx="4" ry="1.5"/><path d="M8 6L4 19M16 6l4 13M4 19a8 2.8 0 0 0 16 0"/>' + hid('M4 19a8 2.8 0 0 1 16 0')),
  sphere: svg('<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12a8.5 3 0 0 0 17 0"/>' + hid('M3.5 12a8.5 3 0 0 1 17 0')),
  laser: svg('<circle cx="15" cy="9" r="2.6"/><path d="M15 2.5v1.8M21.5 9h-1.8M19.6 4.4l-1.3 1.3"/><path d="M3 21c4.5-1.2 8-4.2 10.2-8.6"/>'),
  fadePen: svg('<path d="M18 2.5l3.5 3.5-8.5 8.5-3.5-3.5z"/><path d="M9.5 11l-4 4v2.5H8l4-4"/><path d="M3 21h4"/><path d="M10 21h3" opacity=".55"/><path d="M16 21h2" opacity=".25"/>'),
  flash: svg('<rect x="7.5" y="7.5" width="9" height="9" rx="2"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>'),
};


/** Категории выбора эмодзи. */
export const CATEGORY_ICONS = {
  s: svg('<circle cx="12" cy="12" r="9"/><path d="M8.5 14.5a4.5 4.5 0 0 0 7 0"/><path d="M9 9.5h.01M15 9.5h.01"/>'),
  a: svg('<circle cx="12" cy="13.5" r="6.5"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="6.5" r="2.5"/><path d="M10 13h.01M14 13h.01M11 16.5h2"/>'),
  f: svg('<path d="M5 10h12v3a6 6 0 0 1-12 0z"/><path d="M17 11h1.5a2.5 2.5 0 0 1 0 5H16"/><path d="M8 3.5c0 1.5 1 1.5 1 3M12 3.5c0 1.5 1 1.5 1 3"/>'),
  c: svg('<circle cx="12" cy="12" r="9"/><path d="M5.6 5.6c3 3 3 9.8 0 12.8M18.4 5.6c-3 3-3 9.8 0 12.8"/>'),
  t: svg('<path d="M5 16V11l2-5h10l2 5v5z"/><path d="M5 11h14"/><path d="M7 16v2.5M17 16v2.5"/><path d="M8 13.5h.01M16 13.5h.01"/>'),
  o: svg('<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.5 10.9V16h7v-2.1A6 6 0 0 0 12 3z"/>'),
  y: svg('<path d="M12 20s-7-4.4-7-9.5A3.8 3.8 0 0 1 12 8a3.8 3.8 0 0 1 7 2.5C19 15.6 12 20 12 20z"/>'),
  g: svg('<path d="M5 21V4"/><path d="M5 4h11l-2 4 2 4H5"/>'),
};

export const UPLOAD_ICON = svg('<path d="M12 15V4"/><path d="M8 8l4-4 4 4"/><path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>');

export const PIN_ICON = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M15.2 2.6a1 1 0 0 1 1.4 0l4.8 4.8a1 1 0 0 1 0 1.4l-.9.9a2 2 0 0 1-2.2.4l-2.6 2.6.3 3.5a1 1 0 0 1-.3.8l-1 1a1 1 0 0 1-1.4 0l-3.2-3.2-4.6 4.6a1 1 0 0 1-1.4-1.4l4.6-4.6-3.2-3.2a1 1 0 0 1 0-1.4l1-1a1 1 0 0 1 .8-.3l3.5.3 2.6-2.6a2 2 0 0 1 .4-2.2z"/></svg>';

export const CLOSE_ICON_BOLD = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';

export const GRID_ICONS: Record<GridMode, string> = {
  none: svg('<circle cx="12" cy="12" r="8"/><path d="M6.5 17.5l11-11"/>'),
  dots: svg('<circle cx="6" cy="6" r="1.2"/><circle cx="12" cy="6" r="1.2"/><circle cx="18" cy="6" r="1.2"/><circle cx="6" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="18" cy="12" r="1.2"/><circle cx="6" cy="18" r="1.2"/><circle cx="12" cy="18" r="1.2"/><circle cx="18" cy="18" r="1.2"/>'),
  square: svg('<rect x="4" y="4" width="7" height="7"/><rect x="13" y="4" width="7" height="7"/><rect x="4" y="13" width="7" height="7"/><rect x="13" y="13" width="7" height="7"/>'),
  coord: svg('<path d="M5 19V5M5 19h14"/><path d="M5 5l-2 3M5 5l2 3M19 19l-3-2M19 19l-3 2"/><circle cx="12" cy="12" r="1"/>'),
};

/** «Привязка к сетке»: магнит-подкова. */
/** Иконка «Плавное перемещение»: стрелка с затухающим следом. */
export const SMOOTH_PAN_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h5M4 12h9M4 16h5"/><path d="M14 8l5 4-5 4"/></svg>';

export const SNAP_ICON = svg('<path d="M6 4h4v9a2 2 0 0 0 4 0V4h4v9a6 6 0 0 1-12 0z"/><path d="M6 8h4M14 8h4"/>');

/** Иконка координатной плоскости с нулём в начале координат — когда деления включены. */
export const COORD_ICON_ZERO = svg('<path d="M5 19V5M5 19h14"/><path d="M5 5l-2 3M5 5l2 3M19 19l-3-2M19 19l-3 2"/><circle cx="12" cy="12" r="1"/><ellipse class="coord-zero" cx="1.9" cy="21.55" rx="1.3" ry="1.9" stroke-width="1.3"/>');

export const WIDTH_ICON = svg('<path d="M4 6h16" stroke-width="1.2"/><path d="M4 12h16" stroke-width="2.4"/><path d="M4 18.5h16" stroke-width="4"/>');

export const OPACITY_ICON = svg('<circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 0 0 16z" fill="currentColor"/>');

export const FONT_ICON = svg('<path d="M3 19l5-14 5 14"/><path d="M5.2 13.5h5.6"/><path d="M14.5 19l3.5-9 3.5 9"/><path d="M15.8 16h4.4"/>');

export const ALIGN_ICONS: Record<TextAlign, string> = {
  left: svg('<path d="M4 6h16M4 10h10M4 14h16M4 18h10"/>'),
  center: svg('<path d="M4 6h16M7 10h10M4 14h16M7 18h10"/>'),
  right: svg('<path d="M4 6h16M10 10h10M4 14h16M10 18h10"/>'),
};

export const VALIGN_ICONS: Record<TextVAlign, string> = {
  top: svg('<path d="M4 4h16"/><rect x="8" y="8" width="8" height="7" rx="1.5"/>'),
  middle: svg('<path d="M4 12h3.5M16.5 12h3.5"/><rect x="8" y="8.5" width="8" height="7" rx="1.5"/>'),
  bottom: svg('<path d="M4 20h16"/><rect x="8" y="9" width="8" height="7" rx="1.5"/>'),
};

export const PROFILE_ICON = svg('<circle cx="12" cy="8.5" r="3.5"/><path d="M5 20c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5"/>');

export const BACKGROUND_ICON = svg('<path d="M12 3C9.5 6.4 5 10 5 14a7 7 0 0 0 14 0c0-4-4.5-7.6-7-11z"/><path d="M12 3v18a7 7 0 0 0 7-7c0-4-4.5-7.6-7-11z" fill="currentColor" stroke="none"/>');

export const BACK_ARROW_ICON = svg('<path d="M19 12H5"/><path d="M11 6l-6 6 6 6"/>');

/** Дорожка ползунка: «клин» от тонкого к толстому. */
export const SLIDER_TRACK_ICON = `<svg viewBox="0 0 120 24" preserveAspectRatio="none"><path d="M3 12a2.4 2.4 0 0 1 2.4-2.4C40 7.5 70 3.5 103 3.5a8.5 8.5 0 0 1 0 17C70 20.5 40 16.5 5.4 14.4A2.4 2.4 0 0 1 3 12Z"/></svg>`;

/** Кнопка «Чат и уведомления» (ЧУ): облачко с точками. */
export const NOTIFY_ICON = svg('<path d="M3.5 14.2a6.2 6.2 0 1 1 3 5.3L3 20.5z" transform="translate(0 -1)"/><path d="M6.7 12.7h.01M9.5 12.7h.01M12.3 12.7h.01" stroke-width="2.4"/><g transform="translate(11.6 1.2) scale(.58)" stroke-width="2.9"><path d="M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/></g>');
/** Только чат: круглый пузырь с точками (вкладка «Чат»). */
export const CHAT_ICON = svg('<path d="M20.5 12A8.5 8.5 0 0 1 8.2 19.6L3.5 20.8l1.3-4.3A8.5 8.5 0 1 1 20.5 12z"/><path d="M8.5 12h.01M12 12h.01M15.5 12h.01" stroke-width="2.6"/>');
/** Только уведомления: колокольчик (вкладка «Уведомления»). */
export const BELL_ICON = svg('<path d="M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>');

/** Иконка ЧУ по вкладке: «Чат» — пузырь, «Уведомления» — колокольчик, «Все» — колокольчик с пузырём. */
export function notifyTabIcon(tab: string): string {
  return tab === 'chat' ? CHAT_ICON : tab === 'notices' ? BELL_ICON : NOTIFY_ICON;
}

/** «Не беспокоить»: залитый полумесяц (значок у кнопки ЧУ). */
export const DND_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 14.3A8.5 8.5 0 0 1 9.7 3.5a8.5 8.5 0 1 0 10.8 10.8z" fill="currentColor"/></svg>';

/** Значки событий в уведомлениях (src/notify-stack.ts): ключи — NoticeIcon центра уведомлений. */
export const NOTICE_ICONS: Record<NoticeIcon, string> = {
  bell: svg('<path d="M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>'),
  join: svg('<circle cx="10" cy="8" r="3.5"/><path d="M3.5 20c.7-3.4 3.3-5.5 6.5-5.5 1.4 0 2.6.4 3.6 1"/><path d="M18 14v6M15 17h6"/>'),
  leave: svg('<path d="M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4"/><path d="M15 16l4-4-4-4"/><path d="M19 12H9"/>'),
  rename: svg('<path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17z"/><path d="M13.5 20H20"/>'),
  cursor: svg('<path d="M5 4l5.5 15 2.2-6.3L19 10.5z"/>'),
  avatar: svg('<circle cx="12" cy="12" r="8.5"/><path d="M8.5 14a4.5 4.5 0 0 0 7 0"/><path d="M9.5 9.5h.01M14.5 9.5h.01"/>'),
  role: svg('<path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z"/><path d="M9 12l2 2 4-4"/>'),
  rights: svg('<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/><path d="M12 14.5v2"/>'),
  summon: svg('<circle cx="9" cy="8" r="3"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><path d="M16 11h6M19 8l3 3-3 3"/>'),
  follow: svg('<path d="M4 4l7 17 2.5-7.5L21 11z"/><path d="M15 15l5 5"/>'),
  link: svg('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>'),
  offline: svg('<path d="M2 8.8a15 15 0 0 1 4.2-2.7M22 8.8A15 15 0 0 0 10.7 5"/><path d="M5.5 12.4a10 10 0 0 1 3.4-2M18.5 12.4a10 10 0 0 0-2.3-1.6"/><path d="M9 15.9a5 5 0 0 1 6 0"/><path d="M12 19.5h.01"/><path d="M3 3l18 18"/>'),
  online: svg('<path d="M2 8.8a15 15 0 0 1 20 0"/><path d="M5.5 12.4a10 10 0 0 1 13 0"/><path d="M9 15.9a5 5 0 0 1 6 0"/><path d="M12 19.5h.01"/>'),
  hidden: svg('<path d="M10.6 5.1A10.4 10.4 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-2.6 3.5M6.6 6.6C3.7 8.4 2 12 2 12s3.5 7 10 7a9.8 9.8 0 0 0 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/><path d="M3 3l18 18"/>'),
  draft: svg('<path d="M4 20l1-4L16.5 4.5a2.1 2.1 0 0 1 3 3L8 19z"/><path d="M14.5 6.5l3 3"/>'),
  remove: svg('<circle cx="10" cy="8" r="3.5"/><path d="M3.5 20c.7-3.4 3.3-5.5 6.5-5.5 1.4 0 2.6.4 3.6 1"/><path d="M15 17h6"/>'),
  image: svg('<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10" r="1.5"/><path d="M21 15l-5-5L5 19"/>'),
  board: svg('<path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16"/><rect x="8" y="8" width="8" height="8" rx="1.5"/>'),
};

export const SUMMON_ICON = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="3"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><path d="M16 11h6M19 8l3 3-3 3"/></svg>';

/** «Настройки доступа» в меню чужого аватара: замок. */
export const ACCESS_ICON = svg('<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/><path d="M12 14.5v2"/>');
export const FOLLOW_ICON = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 4l7 17 2.5-7.5L21 11z"/><path d="M15 15l5 5"/></svg>';

export const CHEVRON_UP_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 15l6-6 6 6"/></svg>';

export const ICON_ARROW = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';

// кольцо отсчёта: серая дорожка и акцентная дуга, длина дуги — 100 (pathLength)
export const ICON_RING = '<svg viewBox="0 0 20 20" aria-hidden="true"><circle class="em-ring-track" cx="10" cy="10" r="7.5"/><circle class="em-ring-arc" cx="10" cy="10" r="7.5" pathLength="100"/></svg>';

export const ICON_CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

export const CLOSE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';

export const UPDATE_ICON = svg('<circle cx="12" cy="12" r="9"/><path d="M12 7.5v8"/><path d="M8.5 12.5L12 16l3.5-3.5"/>');

export const PROVIDER_ICONS = {
  email: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M3.5 7l8.5 6 8.5-6"/></svg>',
  // настоящие логотипы: бумажный самолётик Telegram в круге и четырёхцветная «G» Google
  telegram: '<svg viewBox="0 0 240 240" aria-hidden="true"><circle cx="120" cy="120" r="120" fill="#27a7e7"/><path fill="#fff" d="M100.04 144.41l48.36 35.73c5.52 3.04 9.5 1.47 10.88-5.13l19.68-92.76c2.02-8.08-3.08-11.75-8.36-9.35l-115.59 44.57c-7.89 3.17-7.84 7.57-1.44 9.53l29.66 9.26 68.67-43.33c3.24-1.97 6.22-.91 3.78 1.26"/></svg>',
  google: '<svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>',
} as const;

export const BACK_CHEVRON_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>';


/** Иконки действий мыши в настройках горячих клавиш (по идентификатору действия). */
export const MOUSE_ACTION_ICONS: Record<string, string> = {
    'key:Ctrl+KeyZ': svg('<path d="M4 10h9a5 5 0 0 1 0 10h-3"/><path d="M8 6l-4 4 4 4"/>'),
    'key:Ctrl+KeyY': svg('<path d="M20 10h-9a5 5 0 0 0 0 10h3"/><path d="M16 6l4 4-4 4"/>'),
    'page:previous': svg('<path d="M15 18l-6-6 6-6"/>'),
    'page:next': svg('<path d="M9 18l6-6-6-6"/>'),
    'key:Ctrl+KeyD': svg('<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>'),
    'key:Ctrl+Shift+KeyC': svg('<rect x="3" y="3" width="14" height="14" rx="2"/><path d="m5 14 4-4 3 3 2-2 3 3M14 7h.01M7 21h12a2 2 0 0 0 2-2V7"/>'),
    'key:Ctrl+KeyG': svg('<rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="13" width="8" height="8" rx="1.5"/><path d="M11 11l2 2"/>'),
    'key:Delete': svg('<path d="M4 7h16M10 3h4M6 7l1 14h10l1-14M10 11v6M14 11v6"/>'),
};

/** Иконки — статичные константы (пути), пользовательских данных в разметке нет. */
const SYNC_CLOUD = 'M7 18h10.5a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.6 9.2 4.5 4.5 0 0 0 7 18z';

export const SYNC_ICONS: Record<'synced' | 'syncing' | 'offline' | 'limit', { d: string; cls?: string }[]> = {
  synced: [{ d: SYNC_CLOUD }, { d: 'M9.2 13.2l2 2 3.8-4' }],
  syncing: [{ d: SYNC_CLOUD }, { d: 'M9.5 12.5a2.6 2.6 0 0 1 4.6-1.3M14.5 13.5a2.6 2.6 0 0 1-4.6 1.3M14.3 10.2v1.3h-1.3M9.7 15.8v-1.3h1.3', cls: 'sync-arrows' }],
  offline: [{ d: SYNC_CLOUD }, { d: 'M5 5l14 14' }],
  limit: [{ d: SYNC_CLOUD }, { d: 'M12 10.5v3M12 15.8v.1' }],
};

/** Режимы боковой панели «История», «Справка», «Импорт», «Экспорт» и их строки (SPEC_CHAT §8). */
export const PANEL_ICONS = {
  /** Часы со стрелкой назад — «История изменений». */
  history: svg('<path d="M3.5 12A8.5 8.5 0 1 0 6 6L3.5 8.5"/><path d="M3.5 4v4.5H8"/><path d="M12 7.5V12l3 2"/>'),
  search: svg('<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.3-4.3"/>'),
  clipboard: svg('<path d="M8.5 4.5H7a2 2 0 0 0-2 2V19a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V6.5a2 2 0 0 0-2-2h-1.5"/><rect x="8.5" y="3" width="7" height="3.5" rx="1"/><path d="M8.5 16.5l2.5-2.5 2 2 1.5-1.5 1.5 1.5"/>'),
  /** Файл с угловыми скобками — проект .json. */
  projectFile: svg('<path d="M14 2.5H6.5a2 2 0 0 0-2 2v15a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V8z"/><path d="M14 2.5V8h5.5"/><path d="M10 12.5L8 14.5l2 2M14 12.5l2 2-2 2"/>'),
  /** Пунктирная рамка выделения вокруг объекта — «PNG — выделенное». */
  selection: svg('<path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16M11 4h2M11 20h2M4 11v2M20 11v2"/><rect x="8" y="8" width="8" height="8" rx="1.5"/>'),
};

/** «Свернуть вправо» — кнопка закрытия боковой панели (#side-panel-close): стрелка к черте справа. */
export const PANEL_COLLAPSE_ICON = svg('<path d="M9 6l6 6-6 6"/>');
