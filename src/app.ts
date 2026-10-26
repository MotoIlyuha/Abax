import type { Camera, Element, GridMode, ImageEl, NoteEl, Page, PageTransition, Project, ProjectMeta, ShapeEl, TextEl, ToolId, ToolbarPos, WheelMode } from './types';
import {
  state, update, onChange, undo, redo, canUndo, canRedo, setTool, setGrid, setStyleColor,
  setStyleWidth, setStyleOpacity, setNoteColor, selectPreset, presetKind, addElement, replaceElements, pushHistory, uid,
  applyStyleToSelection, setSettings, setView, switchPage, addPage, deletePage, renamePage,
  openProject, blankProject, blankPage, projectMeta, groupSelected, ungroupSelected, movePage, moveItem,
  bringForward, sendBackward, deleteSelected, setSolidSides, duplicateSelected, removeImageFrames, selectInserted,
  clampOpacity, opacityField, OPACITY_MIN, parseZoomPercent, zoomAtPoint,
} from './state';
import type { PresetKind, StyleValue } from './state';
import { doskaApi, storage } from './storage';
import { isNativeApp, sharePng } from './native';
import { renderScene, contentBBox, imageEpoch, imagesLoaded, presentCanvas, renderNow } from './renderer';
import { makeSortable, reordering } from './reorder';
import { capturePageTransition } from './page-transition';
import { hasBaseSides, SIDES_MAX, SIDES_MIN, solidSides } from './solid';
import {
  type AABB, aabbUnion, elementAABB, fitShapeText, imageFrame, lineWidth, shapeHoldsText, shapeTextBox,
  NOTE_W, NOTE_H, NOTE_PAD, NOTE_FONT, NOTE_TEXT_COLOR, SHAPE_TEXT_LH, TEXT_SIZE,
} from './geom';
import * as pdfjsLib from 'pdfjs-dist';
// ?worker&inline: воркер инлайнится в бандл и работает из file:// (Electron)
import PdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?worker&inline';
import { collabActive, isHost, myColor, noteSelection, readOnly, startHostConnection, stopCollab } from './collab';
import { closePresent, openPresent, presentOpen } from './present';
import { type ToolbarGroup, onToolbarChange, restoreToolbar, svg, toolDef, toolTip, toolUsesColor, toolbarConfig } from './toolbar';
import { openSettingsDialog, settingsDialogOpen } from './settings-dialog';
import { renderToolbarEditor } from './toolbar-editor';
import { renderHotkeysSettings } from './hotkeys-settings';
import { DEFAULT_NEW_PAGE_KEY, comboLabel, macKeys, newPageKeyProblem } from './hotkeys';
import { renderAbout } from './about';
import { copySelection, COPY_STEP_PX, pasteFromMemory, pasteFromSystem } from './clipboard';

pdfjsLib.GlobalWorkerOptions.workerPort = new PdfWorker();

const ICONS = {
  home: svg('<path d="M3 11l9-8 9 8"/><path d="M5 10v10h5v-6h4v6h5V10"/>'),
  pages: svg('<rect x="8" y="3" width="12" height="15" rx="2"/><path d="M4.5 7v11.5A2.5 2.5 0 0 0 7 21h9"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  chevronUp: svg('<path d="M6 15l6-6 6 6"/>'),
  chevronDown: svg('<path d="M6 9l6 6 6-6"/>'),
  keyboard: svg('<rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M6 14h.01M18 14h.01M9 14h6"/>'),
  image: svg('<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10" r="1.5"/><path d="M21 15l-5-5L5 19"/>'),
  undo: svg('<path d="M4 10h9a5 5 0 0 1 0 10h-3"/><path d="M8 6l-4 4 4 4"/>'),
  redo: svg('<path d="M20 10h-9a5 5 0 0 0 0 10h3"/><path d="M16 6l4 4-4 4"/>'),
  fit: svg('<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/>'),
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
};

const GRID_ICONS: Record<GridMode, string> = {
  none: svg('<circle cx="12" cy="12" r="8"/><path d="M6.5 17.5l11-11"/>'),
  dots: svg('<circle cx="6" cy="6" r="1.2"/><circle cx="12" cy="6" r="1.2"/><circle cx="18" cy="6" r="1.2"/><circle cx="6" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="18" cy="12" r="1.2"/><circle cx="6" cy="18" r="1.2"/><circle cx="12" cy="18" r="1.2"/><circle cx="18" cy="18" r="1.2"/>'),
  square: svg('<rect x="4" y="4" width="7" height="7"/><rect x="13" y="4" width="7" height="7"/><rect x="4" y="13" width="7" height="7"/><rect x="13" y="13" width="7" height="7"/>'),
  coord: svg('<path d="M5 19V5M5 19h14"/><path d="M5 5l-2 3M5 5l2 3M19 19l-3-2M19 19l-3 2"/><circle cx="12" cy="12" r="1"/>'),
};

/** Последний выбранный инструмент группы (по id группы) — его иконку показывает кнопка группы. */
const lastGroupTool: Record<string, ToolId> = {};

/** Группа, кнопка которой сейчас на панели инструментов. */
function toolbarGroup(id: string): ToolbarGroup | undefined {
  return toolbarConfig().items.find((it): it is ToolbarGroup => it.type === 'group' && it.id === id && it.tools.length > 0);
}

/** Палитра как в Miro: строки — семейства оттенков, столбцы — светлый / яркий / тёмный / нейтральный. */
const PALETTE = [
  '#fff6b6', '#ffdc4a', '#af7e04', '#ffffff',
  '#f8d3af', '#fe9f4d', '#9b4a08', '#e7e7e7',
  '#ffc6c6', '#ff6464', '#bd0a0a', '#b0b0b0',
  '#adf0c7', '#2dc75c', '#067429', '#595959',
  '#c6dcff', '#659df2', '#305bab', '#1f2329',
  '#dedaff', '#8f7fee', '#6631d7', '#316f45',
  '#d3f0a2', '#5b4100', '#e4f9c1', '#fddaff',
];
const NOTE_PASTELS = ['#ffe066', '#ffd6a5', '#ffd5d5', '#d3f9d8', '#a9def9', '#e4c1f9', '#fde4cf', '#d8f3dc'];
const CUSTOM_MAX = 8;

let canvas: HTMLCanvasElement;
let saveTimer = 0;
let lastPagesKey = '';
let lastHomeKey = '';
let lastSelectionKey = '';

// ----- Персистентность стиля и настроек -----

const CUSTOM_COLORS_KEY = 'doska.customColors';
const STYLE_KEY = 'doska.style';
const SETTINGS_KEY = 'doska.settings';

function loadCustomColors(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(CUSTOM_COLORS_KEY) || '[]');
    return Array.isArray(v) ? v.filter(c => typeof c === 'string').slice(0, CUSTOM_MAX) : [];
  } catch {
    return [];
  }
}

function saveCustomColors(list: string[]): void {
  localStorage.setItem(CUSTOM_COLORS_KEY, JSON.stringify(list.slice(0, CUSTOM_MAX)));
}

function addCustomColor(c: string): void {
  if (PALETTE.includes(c)) return;
  saveCustomColors([c, ...loadCustomColors().filter(x => x !== c)]);
}

function persistStyle(): void {
  localStorage.setItem(STYLE_KEY, JSON.stringify({ ...state.style, noteColor: state.noteColor, presets: state.presets }));
}

function restoreStyle(): void {
  try {
    const v = JSON.parse(localStorage.getItem(STYLE_KEY) || 'null');
    const styleOf = (x: unknown): StyleValue | null => {
      const o = x as { color?: unknown; width?: unknown; opacity?: unknown } | null;
      return o && typeof o.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(o.color) && typeof o.width === 'number'
        ? { color: o.color, width: Math.min(14, Math.max(0.5, o.width)), ...opacityField(clampOpacity(o.opacity)) }
        : null;
    };
    for (const kind of Object.keys(state.presets) as PresetKind[]) {
      const saved = v?.presets?.[kind];
      const set = state.presets[kind];
      if (!saved || !Array.isArray(saved.list)) continue;
      set.list.forEach((_, i) => { set.list[i] = styleOf(saved.list[i]) ?? set.list[i]; });
      if (Number.isInteger(saved.active) && saved.active >= 0 && saved.active < set.list.length) set.active = saved.active;
    }
    // старый формат: один стиль на всё — становится пресетом «остальных» инструментов
    const legacy = !v?.presets ? styleOf(v) : null;
    if (legacy) state.presets.other.list[0] = legacy;
    const set = state.presets[presetKind(state.tool)];
    state.style = { ...set.list[set.active] };
    if (v && typeof v.noteColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(v.noteColor)) {
      state.noteColor = v.noteColor;
    }
  } catch { /* нет сохранённого стиля — дефолт */ }
}

function restoreSettings(): void {
  try {
    const v = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null');
    const pos = ['left', 'right', 'top', 'bottom'] as const;
    if (v && pos.includes(v.toolbarPos)) {
      state.settings = {
        toolbarPos: v.toolbarPos as ToolbarPos,
        coordLabels: typeof v.coordLabels === 'boolean' ? v.coordLabels : true,
        snapToGrid: typeof v.snapToGrid === 'boolean' ? v.snapToGrid : false,
        wheelMode: v.wheelMode === 'zoom' ? 'zoom' : 'scroll',
        pageTransition: PAGE_TRANSITIONS.some(t => t.mode === v.pageTransition) ? v.pageTransition : 'slide',
        pageKeyMod: v.pageKeyMod === 'ctrl' ? 'ctrl' : 'alt',
        newPageKey: DEFAULT_NEW_PAGE_KEY,
        uiAnimations: typeof v.uiAnimations === 'boolean' ? v.uiAnimations : true,
        hideUndoRedo: typeof v.hideUndoRedo === 'boolean' ? v.hideUndoRedo : false,
        keepImageAspect: typeof v.keepImageAspect === 'boolean' ? v.keepImageAspect : true,
        alignGuides: typeof v.alignGuides === 'boolean' ? v.alignGuides : true,
        closePagesOnPick: typeof v.closePagesOnPick === 'boolean' ? v.closePagesOnPick : false,
        thumbViewport: typeof v.thumbViewport === 'boolean' ? v.thumbViewport : true,
      };
      // null — пользователь снял сочетание; занятое или битое значение — снова по умолчанию
      const k = v.newPageKey;
      if (k === null) state.settings.newPageKey = null;
      else if (typeof k === 'string' && !newPageKeyProblem(k, state.settings.pageKeyMod)) state.settings.newPageKey = k;
    }
  } catch { /* дефолт */ }
}

/** Варианты анимации перехода на другую страницу (в настройках доски). */
const PAGE_TRANSITIONS: { mode: PageTransition; name: string; hint: string }[] = [
  { mode: 'none', name: 'Нет', hint: 'Страница сменяется мгновенно' },
  { mode: 'slide', name: 'Слайд', hint: 'Страницы сдвигаются в сторону, как слайды' },
  { mode: 'fade', name: 'Затухание', hint: 'Прежняя страница плавно растворяется' },
  { mode: 'zoom', name: 'Приближение', hint: 'Новая страница выплывает из глубины' },
];

function persistSettings(): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
}

/** Анимации появления панелей живут в CSS; выключенные — класс на body их гасит. */
function applyUiAnimations(): void {
  document.body.classList.toggle('no-ui-anim', !state.settings.uiAnimations);
}

/** Кнопки отмены/повтора в шапке прячутся вместе с разделителями вокруг них (см. style.css). */
function applyUndoRedoVisibility(): void {
  document.body.classList.toggle('hide-undo-redo', state.settings.hideUndoRedo);
}

/** Выбор цвета: применяется к выделению (если есть) и становится текущим. */
function chooseColor(c: string): void {
  if (state.selection.size > 0) applyStyleToSelection({ color: c });
  setStyleColor(c);
  persistStyle();
  // панель не пересобираем: живой HSV-пикер должен остаться на месте;
  // обновляем только активность свотчей
  const sp = panelOf('style');
  if (sp) {
    updateSwatchActive(sp.el, c);
    sp.el.style.setProperty('--ink', c); // дорожка прозрачности — к новому цвету
  }
  refresh();
}

/** Цвет, который текущая сессия пикера держит первым в «Моих цветах». */
let pickerHead: string | null = null;

/** Цвет из пикера: правит один и тот же свотч, а не плодит новый на каждое движение. */
function choosePickedColor(c: string): void {
  const rest = loadCustomColors().filter(x => x !== c && x !== pickerHead);
  pickerHead = PALETTE.includes(c) ? null : c;
  saveCustomColors(pickerHead ? [c, ...rest] : rest);
  renderCustomSwatches();
  chooseColor(c);
}

/** Подсвечивает текущий цвет в панели без её пересборки. */
function updateSwatchActive(panel: HTMLElement, current: string): void {
  for (const btn of panel.querySelectorAll<HTMLButtonElement>('.ctx-swatch[data-c]')) {
    btn.classList.toggle('active', btn.dataset.c === current);
  }
}

/**
 * Выбор толщины: применяется к выделению (если есть) и становится текущей.
 * first — первое изменение за жест ползунка: в историю пишется один шаг на всё протягивание.
 */
function chooseWidth(w: number, first = true): void {
  const clamped = Math.min(14, Math.max(0.5, Math.round(w * 2) / 2));
  if (state.selection.size > 0) applyStyleToSelection({ width: clamped }, first);
  setStyleWidth(clamped);
  persistStyle();
  refresh();
}

/** Выбор непрозрачности: к выделению (у картинок — к рамке) и как текущая. */
function chooseOpacity(v: number, first: boolean): void {
  if (state.selection.size > 0) applyStyleToSelection({ opacity: v }, first);
  setStyleOpacity(v);
  persistStyle();
  refresh();
}

/** Скругление углов выделенных прямоугольников и картинок. */
function chooseRadius(v: number, first: boolean): void {
  applyStyleToSelection({ radius: v }, first);
}

// ----- Редактор текста/стикеров (in-place) -----

interface Editing {
  el: TextEl | NoteEl | ShapeEl | null;
  at: { x: number; y: number } | null;
  /** shape — надпись внутри прямоугольника, эллипса или треугольника. */
  target: 'text' | 'note' | 'shape';
  ta: HTMLTextAreaElement;
}
let editing: Editing | null = null;

/** append — набранный символ, с которого начали ввод надписи выделенной фигуры. */
export function beginTextEdit(opts: { el?: TextEl | NoteEl | ShapeEl; at?: { x: number; y: number }; target?: 'text' | 'note'; append?: string }): void {
  closeEditor(true);
  const el = opts.el ?? null;
  const target: Editing['target'] = el ? (el.type === 'note' ? 'note' : el.type === 'shape' ? 'shape' : 'text') : (opts.target ?? 'text');
  const ta = document.createElement('textarea');
  ta.rows = 1;
  ta.spellcheck = false;
  ta.className = target === 'text' ? 'inplace-edit' : `inplace-edit ${target}`;
  if (el?.type === 'shape') {
    ta.value = (el.text ?? '') + (opts.append ?? '');
    state.hideTextId = el.id; // контур остаётся на холсте, надпись живёт в редакторе
  } else if (el) {
    ta.value = el.text;
    state.hideElId = el.id; // прячем канвасную версию, текст живёт в редакторе
  }
  if (target === 'note' && !el && opts.at) {
    state.liveNote = { x: opts.at.x - NOTE_W / 2, y: opts.at.y - NOTE_H / 2, w: NOTE_W, h: NOTE_H, color: state.noteColor };
    // сразу возвращаем выделение, чтобы случайные клики не плодили стикеры
    if (state.tool === 'note') setTool('select');
  }
  document.getElementById('overlay')!.appendChild(ta);
  editing = { el, at: opts.at ?? null, target, ta };
  positionEditor();
  syncLiveText();
  update();
  ta.focus();
  ta.setSelectionRange(ta.value.length, ta.value.length);
  ta.addEventListener('keydown', e => {
    e.stopPropagation();
    // Esc у надписи фигуры — «готово», как в Miro (фигура остаётся выделенной); у текста и стикера — отмена
    if (e.key === 'Escape') { e.preventDefault(); closeEditor(target === 'shape'); }
    else if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); closeEditor(true); }
    // Shift+Enter — перевод строки (стандартное поведение textarea)
  });
  ta.addEventListener('input', () => {
    syncLiveText();
    update(); // подписчик заодно подгоняет размер редактора
  });
  ta.addEventListener('blur', () => closeEditor(true));
}

/** Фигура, надпись которой правится: актуальная версия с доски (её могли передвинуть или перекрасить). */
function editedShape(e: Editing): ShapeEl {
  const cur = state.board.elements.find(x => x.id === e.el!.id);
  return cur?.type === 'shape' ? cur : e.el as ShapeEl;
}

/** Вводимый текст — в state.liveText: окно демонстрации рисует его вместо редактора. */
function syncLiveText(): void {
  const e = editing;
  if (!e) { state.liveText = null; return; }
  const text = e.ta.value;
  if (e.target === 'shape') {
    // без id: надпись фигуры с этим id не рисуется (её показывает редактор)
    state.liveText = { ...editedShape(e), id: '', text };
  } else if (e.el) {
    state.liveText = { ...e.el, text };
  } else if (e.target === 'text') {
    state.liveText = { id: '', type: 'text', x: e.at!.x, y: e.at!.y, text, size: TEXT_SIZE, color: state.style.color, ...opacityField(state.style.opacity) };
  } else {
    const n = state.liveNote;
    state.liveText = n ? { id: '', type: 'note', x: n.x, y: n.y, w: n.w, h: n.h, text, color: n.color } : null;
  }
}

function positionEditor(): void {
  const e = editing;
  if (!e) return;
  const cam = state.camera;
  const z = cam.zoom;
  const ta = e.ta;
  if (e.target === 'shape') {
    positionShapeEditor(ta, editedShape(e));
    return;
  }
  if (e.target === 'note') {
    const n = (e.el as NoteEl | null) ?? state.liveNote;
    if (!n) return;
    ta.style.left = `${(n.x + NOTE_PAD - cam.x) * z}px`;
    ta.style.top = `${(n.y + NOTE_PAD - cam.y) * z}px`;
    ta.style.width = `${(n.w - NOTE_PAD * 2) * z}px`;
    ta.style.fontSize = `${NOTE_FONT * z}px`;
    ta.style.lineHeight = '1.35';
    ta.style.color = NOTE_TEXT_COLOR;
    ta.style.maxHeight = `${(n.h - NOTE_PAD * 2) * z}px`;
  } else {
    const x = e.el ? e.el.x : e.at!.x;
    const y = e.el ? e.el.y : e.at!.y;
    const size = e.el && e.el.type === 'text' ? (e.el as TextEl).size : TEXT_SIZE;
    ta.style.left = `${(x - cam.x) * z}px`;
    ta.style.top = `${(y - cam.y) * z}px`;
    ta.style.fontSize = `${size * z}px`;
    ta.style.lineHeight = '1.25';
    ta.style.width = 'auto';
    ta.style.color = e.el && e.el.type === 'text' ? (e.el as TextEl).color : state.style.color;
    ta.style.opacity = String((e.el ? (e.el as TextEl).opacity : state.style.opacity) ?? 1);
    ta.style.width = '10px';
    ta.style.width = `${Math.max(60, ta.scrollWidth + 12)}px`;
  }
  ta.style.height = 'auto';
  ta.style.height = `${ta.scrollHeight + 2}px`;
}

/** Редактор надписи — по центру области текста фигуры, тем же кеглем и с тем же поворотом. */
function positionShapeEditor(ta: HTMLTextAreaElement, s: ShapeEl): void {
  const cam = state.camera;
  const z = cam.zoom;
  const box = shapeTextBox(s);
  const fit = fitShapeText(ta.value, box.w, box.h);
  ta.style.width = `${box.w * z}px`;
  ta.style.fontSize = `${fit.size * z}px`;
  ta.style.lineHeight = String(SHAPE_TEXT_LH);
  ta.style.color = s.color;
  ta.style.opacity = String(s.opacity ?? 1);
  ta.style.height = 'auto';
  const h = ta.scrollHeight;
  ta.style.height = `${h}px`;
  const left = (box.x - cam.x) * z;
  const top = (box.y + box.h / 2 - cam.y) * z - h / 2;
  ta.style.left = `${left}px`;
  ta.style.top = `${top}px`;
  const rot = s.rot ?? 0;
  ta.style.transformOrigin = `${(s.x + s.w / 2 - cam.x) * z - left}px ${(s.y + s.h / 2 - cam.y) * z - top}px`;
  ta.style.transform = rot ? `rotate(${rot}rad)` : '';
}

export function closeEditor(commit: boolean): void {
  const e = editing;
  if (!e) return;
  editing = null;
  const text = e.ta.value.replace(/[ \t]+$/gm, '').replace(/\s+$/, '');
  e.ta.remove();
  state.hideElId = null;
  state.hideTextId = null;
  state.liveText = null;
  if (e.target === 'shape') {
    commitShapeText(editedShape(e), commit ? text : null);
    return;
  }
  const liveNote = state.liveNote;
  state.liveNote = null;
  if (!commit || text === '') {
    if (commit && e.el) {
      // очистили текст существующего элемента — удаляем его
      pushHistory(state.board.elements);
      replaceElements(state.board.elements.filter(x => x.id !== e.el!.id));
    } else {
      update();
    }
    return;
  }
  if (e.el) {
    pushHistory(state.board.elements);
    const el = e.el;
    replaceElements(state.board.elements.map(x => (x.id === el.id ? ({ ...el, text } as Element) : x)));
  } else if (e.target === 'text') {
    addElement({ id: uid(), type: 'text', x: e.at!.x, y: e.at!.y, text, size: TEXT_SIZE, color: state.style.color, ...opacityField(state.style.opacity) });
  } else if (liveNote) {
    addElement({ id: uid(), type: 'note', x: liveNote.x, y: liveNote.y, w: liveNote.w, h: liveNote.h, text, color: liveNote.color });
  }
}

/** Надпись фигуры (null — отмена): пустая убирается, фигура остаётся; без изменений — без записи в историю. */
function commitShapeText(s: ShapeEl, text: string | null): void {
  const cur = state.board.elements.find(x => x.id === s.id);
  if (text === null || cur?.type !== 'shape' || (cur.text ?? '') === text) { update(); return; }
  const next: ShapeEl = { ...cur, text };
  if (!text) delete next.text;
  pushHistory(state.board.elements);
  replaceElements(state.board.elements.map(x => (x.id === cur.id ? next : x)));
}

/**
 * Фигура, в которую пойдёт набранный текст (как в Miro: у выделенной фигуры сразу стоит курсор):
 * единственная выделенная — прямоугольник, эллипс или треугольник; редактор ещё не открыт.
 */
export function selectedTextShape(): ShapeEl | null {
  if (editing || state.view !== 'board' || state.tool !== 'select' || state.selection.size !== 1) return null;
  if (!canEditBoard() || settingsDialogOpen()) return null;
  const el = state.board.elements.find(e => state.selection.has(e.id));
  return shapeHoldsText(el) ? el : null;
}

/** Фокус в поле ввода: набранное уходит туда, а не на доску. */
function isTypingField(t: EventTarget | null): boolean {
  return t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
}

let shapeCaret: HTMLElement | null = null;

/**
 * Мигающий курсор в выделенной фигуре — за последним символом надписи (в пустой — по центру).
 * Это только метка: настоящий редактор открывается с первым набранным символом (см. controller.ts).
 */
function syncShapeCaret(): void {
  const el = selectedTextShape();
  if (!el || state.liveEdit || isTypingField(document.activeElement)) {
    shapeCaret?.remove();
    shapeCaret = null;
    return;
  }
  if (!shapeCaret) {
    shapeCaret = document.createElement('div');
    shapeCaret.className = 'shape-caret';
    document.getElementById('overlay')!.appendChild(shapeCaret);
  }
  const box = shapeTextBox(el);
  const fit = fitShapeText(el.text ?? '', box.w, box.h);
  const lh = fit.size * SHAPE_TEXT_LH;
  const n = fit.lines.length;
  // верхний конец курсора в системе фигуры, затем — поворот вокруг её центра
  const lx = box.x + box.w / 2 + lineWidth(fit.lines[n - 1] ?? '', fit.size) / 2 + 1;
  const ly = box.y + (box.h - n * lh) / 2 + (n - 1) * lh;
  const cx = el.x + el.w / 2, cy = el.y + el.h / 2;
  const rot = el.rot ?? 0;
  const cos = Math.cos(rot), sin = Math.sin(rot);
  const cam = state.camera;
  shapeCaret.style.left = `${(cx + (lx - cx) * cos - (ly - cy) * sin - cam.x) * cam.zoom}px`;
  shapeCaret.style.top = `${(cy + (lx - cx) * sin + (ly - cy) * cos - cam.y) * cam.zoom}px`;
  shapeCaret.style.height = `${lh * cam.zoom}px`;
  shapeCaret.style.background = el.color;
  shapeCaret.style.transform = rot ? `rotate(${rot}rad)` : '';
}

// ----- Контекстная панель (цвет и толщина / стикеры) -----

/** 'style', 'note' или id группы инструментов (у групп свои id, с этими двумя не совпадают). */
type CtxKind = string;
/** Откуда вызвана панель: с тулбара — встаёт сбоку по центру кнопки, из плавающего меню — под ним. */
type CtxSource = 'toolbar' | 'quick';
interface CtxPanel {
  el: HTMLElement;
  kind: CtxKind;
  source: CtxSource;
  /** Высота панели при открытии: центрируемся по ней, чтобы раскрытие пикера росло вниз, а не прыгало. */
  baseHeight: number;
  /** Панель перетащена за ручку: стоит, где оставили, и не закрывается кликом мимо. */
  detached: boolean;
}
/**
 * Открытые панели: не больше одной каждого вида. Пристыкованная к кнопке-вызову — максимум одна,
 * откреплённых может быть сколько угодно.
 */
const ctxPanels: CtxPanel[] = [];
/** Счётчик z-index: панель, которую трогали последней, — поверх остальных. */
let ctxZ = 0;

const GRIP_ICON = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>';
const PIN_ICON = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M15.2 2.6a1 1 0 0 1 1.4 0l4.8 4.8a1 1 0 0 1 0 1.4l-.9.9a2 2 0 0 1-2.2.4l-2.6 2.6.3 3.5a1 1 0 0 1-.3.8l-1 1a1 1 0 0 1-1.4 0l-3.2-3.2-4.6 4.6a1 1 0 0 1-1.4-1.4l4.6-4.6-3.2-3.2a1 1 0 0 1 0-1.4l1-1a1 1 0 0 1 .8-.3l3.5.3 2.6-2.6a2 2 0 0 1 .4-2.2z"/></svg>';
const CLOSE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';

function ctxLayerEl(): HTMLElement {
  return document.getElementById('ctx-layer')!;
}

function dockedPanel(): CtxPanel | undefined {
  return ctxPanels.find(cp => !cp.detached);
}

function panelOf(kind: CtxKind): CtxPanel | undefined {
  return ctxPanels.find(cp => cp.kind === kind);
}

function closePanel(cp: CtxPanel): void {
  const i = ctxPanels.indexOf(cp);
  if (i < 0) return;
  ctxPanels.splice(i, 1);
  cp.el.remove();
  syncCtxButtons();
}

/** Закрывает пристыкованную панель; откреплённые остаются на доске. */
export function closeCtxPanel(): void {
  const d = dockedPanel();
  if (d) closePanel(d);
}

function openCtxPanel(kind: CtxKind, source: CtxSource): void {
  // пристыкованное место одно, а вид панели не дублируется
  closeCtxPanel();
  const same = panelOf(kind);
  if (same) closePanel(same);
  const el = document.createElement('div');
  el.className = 'ctx-panel';
  el.style.zIndex = String(++ctxZ);
  // откуда выплывает при появлении: от панели инструментов или из-под меню выделения
  el.dataset.from = source === 'quick' ? 'quick' : state.settings.toolbarPos;
  const cp: CtxPanel = { el, kind, source, baseHeight: 0, detached: false };
  ctxPanels.push(cp);
  el.addEventListener('pointerdown', () => { el.style.zIndex = String(++ctxZ); }, { capture: true });
  ctxLayerEl().appendChild(el);
  if (kind === 'style') buildStylePanel(cp);
  else if (kind === 'note') buildNotePanel(cp);
  else buildToolGroupPanel(cp, kind);
  el.appendChild(buildCtxBar(cp));
  positionCtxPanel(cp);
  syncCtxButtons();
}

/** Клик по кнопке-вызову: открытую ею (или откреплённую) панель закрывает, иначе открывает. */
function toggleCtxPanel(kind: CtxKind, source: CtxSource): void {
  const cur = panelOf(kind);
  if (cur && (cur.detached || cur.source === source)) closePanel(cur);
  else openCtxPanel(kind, source);
}

function setCtxDetached(cp: CtxPanel, v: boolean): void {
  cp.detached = v;
  cp.el.classList.toggle('detached', v);
  syncCtxButtons();
}

/** Возвращает откреплённую панель к её кнопке-вызову, вытесняя пристыкованную там сейчас. */
function dockCtxPanel(cp: CtxPanel): void {
  closeCtxPanel();
  setCtxDetached(cp, false);
  cp.baseHeight = 0;
  positionCtxPanel(cp);
}

/** Правый верхний угол: ручка перетаскивания, у откреплённой — ещё pin к кнопке-вызову и крестик. */
function buildCtxBar(cp: CtxPanel): HTMLElement {
  const bar = document.createElement('div');
  bar.className = 'ctx-bar';
  const pin = document.createElement('button');
  pin.className = 'ctx-pin';
  pin.title = cp.source === 'quick' ? 'Вернуть под меню выделения' : 'Вернуть к панели инструментов';
  pin.innerHTML = PIN_ICON;
  pin.addEventListener('click', () => dockCtxPanel(cp));
  const close = document.createElement('button');
  close.className = 'ctx-close';
  close.title = 'Закрыть';
  close.innerHTML = CLOSE_ICON;
  close.addEventListener('click', () => closePanel(cp));
  const grip = document.createElement('div');
  grip.className = 'ctx-grip';
  grip.title = 'Перетащить';
  grip.innerHTML = GRIP_ICON;
  grip.addEventListener('pointerdown', e => {
    e.preventDefault();
    const p = cp.el;
    const startX = e.clientX;
    const startY = e.clientY;
    const left0 = p.offsetLeft;
    const top0 = p.offsetTop;
    let moved = false;
    try { grip.setPointerCapture(e.pointerId); } catch { /* синтетический pointer */ }
    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      // мелкое дрожание при клике — ещё не перенос
      if (!moved && Math.hypot(dx, dy) < 3) return;
      moved = true;
      if (!cp.detached) setCtxDetached(cp, true);
      placeDetached(cp, left0 + dx, top0 + dy);
    };
    const onUp = () => {
      grip.removeEventListener('pointermove', onMove);
      grip.removeEventListener('pointerup', onUp);
      grip.removeEventListener('pointercancel', onUp);
    };
    grip.addEventListener('pointermove', onMove);
    grip.addEventListener('pointerup', onUp);
    grip.addEventListener('pointercancel', onUp);
  });
  bar.append(pin, close, grip);
  return bar;
}

/** Ставит открепленную панель в точку, не выпуская её за пределы холста. */
function placeDetached(cp: CtxPanel, left: number, top: number): void {
  const p = cp.el;
  const wrap = document.getElementById('canvas-wrap')!;
  const margin = 8;
  p.style.maxHeight = `${wrap.clientHeight - margin * 2}px`;
  p.style.left = `${Math.max(margin, Math.min(left, wrap.clientWidth - p.offsetWidth - margin))}px`;
  p.style.top = `${Math.max(margin, Math.min(top, wrap.clientHeight - p.offsetHeight - margin))}px`;
}

function toggleStylePanel(source: CtxSource): void {
  toggleCtxPanel('style', source);
}

/** Панель «открыта этой кнопкой»: пристыкована к ней или откреплена (тогда кнопка её закроет). */
function ctxOpenFrom(kind: CtxKind, source: CtxSource): boolean {
  const cp = panelOf(kind);
  return !!cp && (cp.detached || cp.source === source);
}

/** Кнопка-вызов подсвечена, пока её панель открыта. */
function syncCtxButtons(): void {
  for (const b of document.querySelectorAll('#toolbar .style-btn')) {
    b.classList.toggle('active', b.hasAttribute('data-ctx') && ctxOpenFrom('style', 'toolbar'));
  }
  quickMenuEl().querySelector('[data-ctx="style"]')?.classList.toggle('active', ctxOpenFrom('style', 'quick'));
}

/** Элемент, вызвавший панель (кнопка тулбара или плавающего меню). */
function ctxAnchor(cp: CtxPanel): HTMLElement | null {
  const host = cp.source === 'quick' ? quickMenuEl() : document.getElementById('toolbar')!;
  if (host.hidden) return null;
  const own = host.querySelector<HTMLElement>(`[data-ctx="${cp.kind}"]`);
  // стикер, убранный в группу, показывает цвета у кнопки этой группы
  if (!own && cp.kind === 'note' && cp.source === 'toolbar') return host.querySelector<HTMLElement>('[data-tools~="note"]');
  return own;
}

/** Пристыкованную панель держим у её кнопки (без кнопки — закрываем), откреплённые — в пределах холста. */
function positionCtxPanels(includeDetached = false): void {
  for (const cp of [...ctxPanels]) {
    if (!cp.detached || includeDetached) positionCtxPanel(cp);
  }
}

function positionCtxPanel(cp: CtxPanel): void {
  const p = cp.el;
  // откреплённая панель живёт сама по себе: только держим её в пределах холста
  if (cp.detached) { placeDetached(cp, p.offsetLeft, p.offsetTop); return; }
  const ar = ctxAnchor(cp)?.getBoundingClientRect();
  if (!ar || ar.width === 0) { closePanel(cp); return; }
  const wr = document.getElementById('canvas-wrap')!.getBoundingClientRect();
  const gap = 10;
  const margin = 8;
  // естественная высота без max-height: прокручиваемая часть целиком
  const scroller = p.querySelector<HTMLElement>('.ctx-scroll');
  const natural = scroller ? p.offsetHeight - scroller.clientHeight + scroller.scrollHeight : p.offsetHeight;
  if (!cp.baseHeight) cp.baseHeight = natural;
  const w = p.offsetWidth;
  const ax = ar.left + ar.width / 2 - wr.left;
  const ay = ar.top + ar.height / 2 - wr.top;
  let left = ax - w / 2;
  let top: number;
  let maxH: number;
  if (cp.source === 'quick') {
    // как в Miro: сразу под плавающим меню, по центру кнопки; не влезает — над меню
    const qr = quickMenuEl().getBoundingClientRect();
    const below = wr.bottom - qr.bottom - gap - margin;
    const above = qr.top - wr.top - gap - margin;
    if (below >= Math.min(natural, 260) || below >= above) {
      maxH = below;
      top = qr.bottom - wr.top + gap;
    } else {
      maxH = above;
      top = qr.top - wr.top - gap - Math.min(natural, above);
    }
  } else {
    // центр панели — на уровне кнопки инструмента
    const tr = document.getElementById('toolbar')!.getBoundingClientRect();
    const pos = state.settings.toolbarPos;
    if (pos === 'left' || pos === 'right') {
      maxH = wr.height - margin * 2;
      left = pos === 'left' ? tr.right - wr.left + gap : tr.left - wr.left - w - gap;
      top = ay - Math.min(cp.baseHeight, maxH) / 2;
    } else if (pos === 'top') {
      maxH = wr.bottom - tr.bottom - gap - margin;
      top = tr.bottom - wr.top + gap;
    } else {
      maxH = tr.top - wr.top - gap - margin;
      top = tr.top - wr.top - gap - Math.min(natural, maxH);
    }
  }
  maxH = Math.max(120, maxH);
  p.style.maxHeight = `${maxH}px`;
  const h = Math.min(natural, maxH);
  left = Math.max(margin, Math.min(left, wr.width - w - margin));
  top = Math.max(margin, Math.min(top, wr.height - h - margin));
  p.style.left = `${left}px`;
  p.style.top = `${top}px`;
}

function buildToolGroupPanel(cp: CtxPanel, groupId: string): void {
  const p = cp.el;
  const group = toolbarGroup(groupId);
  // панели групп оформлены одинаково (data-kind='shapes'), различаются набором кнопок
  p.dataset.kind = 'shapes';
  const title = document.createElement('div');
  title.className = 'ctx-title';
  title.textContent = group?.name ?? '';
  p.appendChild(title);
  const grid = document.createElement('div');
  grid.className = 'ctx-shapes';
  for (const id of group?.tools ?? []) {
    const b = document.createElement('button');
    b.className = 'tool' + (state.tool === id ? ' active' : '');
    b.title = toolTip(id);
    b.innerHTML = toolDef(id).icon;
    b.dataset.shape = id;
    b.addEventListener('click', () => {
      // откреплённая панель работает как палитра — остаётся открытой, подсветку обновит refresh()
      if (!cp.detached) closePanel(cp);
      setTool(id);
    });
    grid.appendChild(b);
  }
  p.appendChild(grid);
}

/** Панель инструментов перенастроили: панели групп пересобираем, у исчезнувших групп — закрываем. */
function syncGroupPanels(): void {
  for (const cp of [...ctxPanels]) {
    if (cp.kind === 'style' || cp.kind === 'note') continue;
    if (!toolbarGroup(cp.kind)) { closePanel(cp); continue; }
    cp.el.textContent = '';
    buildToolGroupPanel(cp, cp.kind);
    cp.el.appendChild(buildCtxBar(cp));
  }
}

function sectionHead(text: string): HTMLElement {
  const d = document.createElement('div');
  d.className = 'ctx-section';
  d.textContent = text;
  return d;
}

function isLightColor(hex: string): boolean {
  const n = parseInt(hex.slice(1), 16);
  return 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255) > 165;
}

/** Круглый свотч в стиле Miro; у активного — галочка контрастного цвета. */
function makeSwatch(c: string, active: boolean, onPick: (c: string) => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = 'ctx-swatch' + (active ? ' active' : '');
  b.dataset.c = c;
  b.title = c;
  b.style.background = c;
  b.style.setProperty('--check', isLightColor(c) ? '#1f2329' : '#ffffff');
  b.addEventListener('click', () => onPick(c));
  return b;
}

function renderCustomSwatches(): void {
  const grid = panelOf('style')?.el.querySelector<HTMLElement>('.ctx-swatches.custom');
  if (!grid) return;
  grid.textContent = '';
  const list = loadCustomColors();
  for (const c of list) grid.appendChild(makeSwatch(c, c === state.style.color, chooseColor));
  grid.hidden = list.length === 0;
}

/** Выделенные элементы, к которым относится панель из меню выделения. */
function selectedForStyle(): Element[] {
  return state.board.elements.filter(e => state.selection.has(e.id));
}

/** Толщина нужна с тулбара и для выделенных линий/фигур и рамок картинок (у текста и стикеров её нет). */
function styleNeedsWidth(source: CtxSource): boolean {
  if (source === 'toolbar') return true;
  return selectedForStyle().some(e =>
    e.type === 'stroke' || e.type === 'shape' || e.type === 'poly' || e.type === 'solid' || e.type === 'image');
}

/** Прозрачность — у всего, кроме стикеров. */
function styleNeedsOpacity(source: CtxSource): boolean {
  return source === 'toolbar' || selectedForStyle().some(e => e.type !== 'note');
}

/** Скругляются прямоугольники и картинки, выделенные на доске. */
function roundable(e: Element): e is ShapeEl | ImageEl {
  return e.type === 'image' || (e.type === 'shape' && e.shape === 'rect');
}

const RADIUS_MAX = 50;

/** Уголок с тем же скруглением, что выбрано на ползунке. */
function cornerIcon(v: number): string {
  const r = (Math.min(v, RADIUS_MAX) / RADIUS_MAX) * 13;
  const arc = r > 0.2 ? `A${r.toFixed(2)} ${r.toFixed(2)} 0 0 1 ${(5 + r).toFixed(2)} 5` : '';
  return svg(`<path d="M5 19V${(5 + r).toFixed(2)}${arc}H19"/>`);
}

function hasFramedImage(): boolean {
  return selectedForStyle().some(e => e.type === 'image' && !!imageFrame(e));
}

/** Рамку добавили цветом или толщиной, убрали кнопкой или отменой — кнопка «Убрать рамку» следом. */
function syncFrameOff(): void {
  const off = panelOf('style')?.el.querySelector<HTMLElement>('.ctx-frame-off');
  if (off) off.hidden = !hasFramedImage();
}

const WIDTH_ICON = svg('<path d="M4 6h16" stroke-width="1.2"/><path d="M4 12h16" stroke-width="2.4"/><path d="M4 18.5h16" stroke-width="4"/>');

/** Толщина подписью: до десятых, с запятой. */
function formatWidth(v: number): string {
  return String(Math.round(v * 10) / 10).replace('.', ',');
}

const OPACITY_ICON = svg('<circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 0 0 16z" fill="currentColor"/>');

/** Единая панель в духе Miro: толщина, прозрачность и скругление сверху, ниже свои и все цвета. */
function buildStylePanel(cp: CtxPanel): void {
  const p = cp.el;
  p.dataset.kind = 'style';
  p.style.setProperty('--ink', state.style.color);
  // текущий цвет не из палитры (старая палитра, чужой элемент) — сразу в «Мои цвета»
  addCustomColor(state.style.color);
  if (styleNeedsWidth(cp.source)) {
    // как у прозрачности и скругления: иконка — «капля» — значение
    const row = document.createElement('div');
    row.className = 'ctx-range ctx-width';
    row.title = 'Толщина';
    const icon = document.createElement('span');
    icon.className = 'ctx-range-icon';
    icon.innerHTML = WIDTH_ICON;
    const sliderHost = document.createElement('div');
    sliderHost.className = 'ctx-drop-slider';
    const val = document.createElement('span');
    val.className = 'ctx-range-val';
    const show = (v: number) => { val.textContent = formatWidth(v); };
    show(state.style.width);
    buildDropSlider(sliderHost, state.style.width, (v, first) => {
      show(v);
      chooseWidth(v, first);
    });
    row.append(icon, sliderHost, val);
    p.appendChild(row);
  }
  if (styleNeedsOpacity(cp.source)) {
    p.appendChild(buildRange({
      kind: 'opacity', title: 'Прозрачность', min: OPACITY_MIN, max: 1, step: 0.01, value: state.style.opacity ?? 1,
      format: v => `${Math.round(v * 100)}%`, icon: () => OPACITY_ICON, onChange: chooseOpacity,
    }));
  }
  const sel = cp.source === 'quick' ? selectedForStyle() : [];
  const round = sel.filter(roundable);
  if (round.length > 0) {
    p.appendChild(buildRange({
      kind: 'radius', title: 'Скругление углов', min: 0, max: RADIUS_MAX, step: 1, value: round[0].radius ?? 0,
      format: v => String(v), icon: cornerIcon, onChange: chooseRadius,
    }));
  }
  if (sel.some(e => e.type === 'image')) {
    // кнопка видна, пока у выделенных картинок есть рамка (см. syncFrameOff)
    const off = document.createElement('button');
    off.className = 'ctx-frame-off';
    off.textContent = 'Убрать рамку';
    off.hidden = !hasFramedImage();
    off.addEventListener('click', () => removeImageFrames());
    p.appendChild(off);
  }
  const scroll = document.createElement('div');
  scroll.className = 'ctx-scroll';
  const add = document.createElement('button');
  add.className = 'ctx-add-color';
  add.textContent = '+ Добавить цвет';
  // пикер стоит над свотчами: новый свотч не сдвигает его под курсором
  const pickerHost = document.createElement('div');
  pickerHost.className = 'ctx-picker';
  pickerHost.hidden = true;
  add.addEventListener('click', () => {
    pickerHost.hidden = !pickerHost.hidden;
    if (!pickerHost.hidden) {
      pickerHead = null;
      buildCustomColorPicker(pickerHost, state.style.color, choosePickedColor);
    }
    add.textContent = pickerHost.hidden ? '+ Добавить цвет' : 'Готово';
    positionCtxPanel(cp);
  });
  const custom = document.createElement('div');
  custom.className = 'ctx-swatches custom';
  const all = document.createElement('div');
  all.className = 'ctx-swatches';
  for (const c of PALETTE) all.appendChild(makeSwatch(c, c === state.style.color, chooseColor));
  scroll.append(sectionHead('Мои цвета'), add, pickerHost, custom, sectionHead('Все цвета'), all);
  p.appendChild(scroll);
  renderCustomSwatches();
}

// ----- Кастомный HSV-пикер -----

function hsvToHex(h: number, s: number, v: number): string {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    const val = v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
    return Math.round(val * 255).toString(16).padStart(2, '0');
  };
  return `#${f(5)}${f(3)}${f(1)}`;
}

function hexToHsv(hex: string): { h: number; s: number; v: number } {
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

/** Собственный пикер: SV-квадрат + радужная полоса + hex. */
function buildCustomColorPicker(host: HTMLElement, initial: string, onChange: (hex: string) => void): void {
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

// ----- Кастомный слайдер толщины «капля» -----

const WIDTH_MIN = 0.5;
const WIDTH_MAX = 14;

/** Слайдер формы капли: слева узко, справа широко; ручка растёт с толщиной. first — начало протягивания. */
function buildDropSlider(host: HTMLElement, initial: number, onChange: (v: number, first: boolean) => void): void {
  host.textContent = '';
  let value = Math.min(WIDTH_MAX, Math.max(WIDTH_MIN, initial));
  let first = true;
  const track = document.createElement('div');
  track.className = 'qs-track';
  track.innerHTML = `<svg viewBox="0 0 120 24" preserveAspectRatio="none"><path d="M3 12a2.4 2.4 0 0 1 2.4-2.4C40 7.5 70 3.5 103 3.5a8.5 8.5 0 0 1 0 17C70 20.5 40 16.5 5.4 14.4A2.4 2.4 0 0 1 3 12Z"/></svg>`;
  const thumb = document.createElement('div');
  thumb.className = 'qs-thumb';
  host.append(track, thumb);
  const apply = (emit: boolean) => {
    const frac = (value - WIDTH_MIN) / (WIDTH_MAX - WIDTH_MIN);
    const d = 10 + frac * 14;
    thumb.style.width = `${d}px`;
    thumb.style.height = `${d}px`;
    // центр ручки ходит по треку (отступ 12px = макс. радиус), поэтому ручка не вылезает за края
    thumb.style.left = `calc(12px + (100% - 24px) * ${frac.toFixed(4)} - ${d / 2}px)`;
    if (emit) {
      onChange(Math.round(value * 2) / 2, first);
      first = false;
    }
  };
  const pointToValue = (e: PointerEvent) => {
    const r = track.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    value = WIDTH_MIN + frac * (WIDTH_MAX - WIDTH_MIN);
    apply(true);
  };
  track.addEventListener('pointerdown', e => {
    track.setPointerCapture(e.pointerId);
    first = true;
    pointToValue(e);
  });
  track.addEventListener('pointermove', e => {
    if (e.buttons > 0) pointToValue(e);
  });
  apply(false);
}

// ----- Ползунки прозрачности и скругления -----

interface RangeOpts {
  kind: string;
  title: string;
  min: number;
  max: number;
  step: number;
  value: number;
  format: (v: number) => string;
  /** Иконка слева: перерисовывается вместе со значением. */
  icon: (v: number) => string;
  /** first — первое изменение за жест (протягивание или нажатие клавиши): шаг истории. */
  onChange: (v: number, first: boolean) => void;
}

/** Строка «иконка — дорожка — значение»; тянется мышью и пальцем, стрелки меняют по шагу. */
function buildRange(o: RangeOpts): HTMLElement {
  const row = document.createElement('div');
  row.className = `ctx-range ctx-${o.kind}`;
  row.title = o.title;
  const icon = document.createElement('span');
  icon.className = 'ctx-range-icon';
  const track = document.createElement('div');
  track.className = 'ctx-range-track';
  track.tabIndex = 0;
  track.setAttribute('role', 'slider');
  track.setAttribute('aria-label', o.title);
  track.setAttribute('aria-valuemin', String(o.min));
  track.setAttribute('aria-valuemax', String(o.max));
  const thumb = document.createElement('div');
  thumb.className = 'ctx-range-thumb';
  track.appendChild(thumb);
  const val = document.createElement('span');
  val.className = 'ctx-range-val';
  row.append(icon, track, val);
  const snap = (v: number) => Number(Math.min(o.max, Math.max(o.min, Math.round(v / o.step) * o.step)).toFixed(4));
  let value = snap(o.value);
  let fresh = true;
  const paint = () => {
    const frac = (value - o.min) / (o.max - o.min);
    thumb.style.left = `${(frac * 100).toFixed(2)}%`;
    track.setAttribute('aria-valuenow', String(value));
    track.setAttribute('aria-valuetext', o.format(value));
    val.textContent = o.format(value);
    icon.innerHTML = o.icon(value);
  };
  const emit = (v: number) => {
    const next = snap(v);
    if (next === value) return;
    value = next;
    paint();
    o.onChange(value, fresh);
    fresh = false;
  };
  const pointTo = (e: PointerEvent) => {
    const r = track.getBoundingClientRect();
    emit(o.min + Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * (o.max - o.min));
  };
  track.addEventListener('pointerdown', e => {
    try { track.setPointerCapture(e.pointerId); } catch { /* синтетический pointer */ }
    fresh = true;
    pointTo(e);
  });
  track.addEventListener('pointermove', e => {
    if (e.buttons > 0) pointTo(e);
  });
  track.addEventListener('keydown', e => {
    const page = (o.max - o.min) / 10;
    const to: Record<string, number> = {
      ArrowRight: value + o.step, ArrowUp: value + o.step, ArrowLeft: value - o.step, ArrowDown: value - o.step,
      PageUp: value + page, PageDown: value - page, Home: o.min, End: o.max,
    };
    if (!(e.key in to)) return;
    e.preventDefault();
    e.stopPropagation();
    fresh = true;
    emit(to[e.key]);
  });
  paint();
  return row;
}

/** Индикатор «цвет + толщина» как в Miro: кружок, внутри точка текущего цвета, её размер — толщина. */
function styleIndicator(withWidth: boolean, style: StyleValue = state.style): HTMLElement {
  const ring = document.createElement('i');
  ring.className = 'style-ind';
  ring.appendChild(document.createElement('b'));
  paintStyleIndicator(ring, withWidth, style);
  return ring;
}

function paintStyleIndicator(ring: HTMLElement, withWidth: boolean, style: StyleValue = state.style): void {
  const dot = ring.firstElementChild as HTMLElement;
  // у элементов толщина бывает больше максимума слайдера — точка не должна вылезать из кольца
  const frac = Math.max(0, Math.min(1, (style.width - WIDTH_MIN) / (WIDTH_MAX - WIDTH_MIN)));
  const d = withWidth ? Math.round(7 + frac * 9) : 14;
  dot.style.width = `${d}px`;
  dot.style.height = `${d}px`;
  dot.style.background = style.color;
  dot.style.opacity = String(style.opacity ?? 1);
}

function buildNotePanel(cp: CtxPanel): void {
  const p = cp.el;
  p.dataset.kind = 'note';
  p.appendChild(sectionHead('Цвет стикера'));
  const grid = document.createElement('div');
  grid.className = 'ctx-swatches';
  for (const c of NOTE_PASTELS) {
    grid.appendChild(makeSwatch(c, c === state.noteColor, () => {
      setNoteColor(c);
      persistStyle();
      updateSwatchActive(p, c);
    }));
  }
  p.appendChild(grid);
}

// ----- Плавающее меню быстрых настроек выделения -----

function quickMenuEl(): HTMLElement {
  return document.getElementById('quick-menu')!;
}

/** Есть ли смысл в «выше/ниже»: выделенное пересекается (по bbox) с невыделенным над ним / под ним. */
function layerMoves(): { up: boolean; down: boolean } {
  type Box = { x0: number; y0: number; x1: number; y1: number };
  const hit = (a: Box, b: Box) => a.x0 <= b.x1 && b.x0 <= a.x1 && a.y0 <= b.y1 && b.y0 <= a.y1;
  const boxes = state.board.elements.map(elementAABB);
  // общая рамка выделения — дешёвый отсев невыделенных, которые точно ни с чем не пересекаются
  const all: Box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  state.board.elements.forEach((el, i) => {
    if (!state.selection.has(el.id)) return;
    const a = boxes[i];
    all.x0 = Math.min(all.x0, a.x0); all.y0 = Math.min(all.y0, a.y0);
    all.x1 = Math.max(all.x1, a.x1); all.y1 = Math.max(all.y1, a.y1);
  });
  const selBelow: Box[] = [];   // выделенные, пройденные ранее (ниже текущего)
  const otherBelow: Box[] = []; // невыделенные, пройденные ранее
  let up = false, down = false;
  for (let i = 0; i < boxes.length; i++) {
    const a = boxes[i];
    if (state.selection.has(state.board.elements[i].id)) {
      if (!down && otherBelow.some(b => hit(a, b))) down = true;
      selBelow.push(a);
    } else {
      if (!hit(a, all)) continue;
      if (!up && selBelow.some(b => hit(a, b))) up = true;
      otherBelow.push(a);
    }
    if (up && down) break;
  }
  return { up, down };
}

function updateQuickMenu(): void {
  const qm = quickMenuEl();
  const selEls = state.board.elements.filter(e => state.selection.has(e.id));
  if (state.view !== 'board' || selEls.length === 0 || editing) {
    qm.hidden = true;
    return;
  }
  qm.hidden = false;
  qm.textContent = '';
  // цвет и толщина — одна кнопка и одна панель; толщина — только для «линейных» элементов и рамок картинок
  const hasInk = selEls.some(e => e.type === 'stroke' || e.type === 'shape' || e.type === 'poly' || e.type === 'solid' || e.type === 'image');
  const sBtn = document.createElement('button');
  sBtn.className = 'qm-btn qm-style' + (ctxOpenFrom('style', 'quick') ? ' active' : '');
  sBtn.dataset.ctx = 'style';
  sBtn.title = selEls.every(e => e.type === 'image') ? 'Рамка и скругление' : hasInk ? 'Цвет и толщина' : 'Цвет';
  sBtn.appendChild(styleIndicator(hasInk));
  sBtn.addEventListener('mousedown', e => e.preventDefault());
  sBtn.addEventListener('click', () => toggleStylePanel('quick'));
  qm.appendChild(sBtn);
  // жирность/курсив — для текста
  const textEls = selEls.filter(e => e.type === 'text');
  if (textEls.length > 0) {
    const allBold = textEls.every(e => e.bold);
    const allItalic = textEls.every(e => e.italic);
    const bBtn = document.createElement('button');
    bBtn.className = 'qm-btn qm-text-b' + (allBold ? ' active' : '');
    bBtn.title = 'Полужирный';
    bBtn.textContent = 'B';
    bBtn.addEventListener('mousedown', e => e.preventDefault());
    bBtn.addEventListener('click', () => { applyStyleToSelection({ bold: !allBold }); });
    const iBtn = document.createElement('button');
    iBtn.className = 'qm-btn qm-text-i' + (allItalic ? ' active' : '');
    iBtn.title = 'Курсив';
    iBtn.textContent = 'I';
    iBtn.addEventListener('mousedown', e => e.preventDefault());
    iBtn.addEventListener('click', () => { applyStyleToSelection({ italic: !allItalic }); });
    qm.append(bBtn, iBtn);
  }
  // число сторон основания призмы/пирамиды
  const sides = new Set<number>();
  for (const e of selEls) if (e.type === 'solid' && hasBaseSides(e.solid)) sides.add(solidSides(e));
  if (sides.size > 0) {
    const cur = sides.size === 1 ? [...sides][0] : null;
    const box = document.createElement('div');
    box.className = 'qm-sides';
    box.title = 'Число сторон основания';
    const minus = document.createElement('button');
    minus.className = 'qm-btn qm-step';
    minus.textContent = '−';
    minus.disabled = cur !== null && cur <= SIDES_MIN;
    minus.addEventListener('click', () => setSolidSides((cur ?? SIDES_MIN + 1) - 1));
    const val = document.createElement('span');
    val.className = 'qm-sides-val';
    val.textContent = cur === null ? 'n' : `n = ${cur}`;
    const plus = document.createElement('button');
    plus.className = 'qm-btn qm-step';
    plus.textContent = '+';
    plus.disabled = cur !== null && cur >= SIDES_MAX;
    plus.addEventListener('click', () => setSolidSides((cur ?? SIDES_MAX - 1) + 1));
    box.append(minus, val, plus);
    qm.appendChild(box);
  }
  // слои
  const layers = layerMoves();
  if (layers.up) {
    const up = document.createElement('button');
    up.className = 'qm-btn';
    up.title = 'Выше (слой)';
    up.innerHTML = ICONS.up;
    up.addEventListener('click', () => { bringForward(); });
    qm.appendChild(up);
  }
  if (layers.down) {
    const down = document.createElement('button');
    down.className = 'qm-btn';
    down.title = 'Ниже (слой)';
    down.innerHTML = ICONS.down;
    down.addEventListener('click', () => { sendBackward(); });
    qm.appendChild(down);
  }
  // группы
  const sel = state.board.elements.filter(e => state.selection.has(e.id));
  const allGrouped = sel.length > 0 && sel.every(e => e.groupId === sel[0].groupId && e.groupId);
  if (state.selection.size >= 2 && !allGrouped) {
    const g = document.createElement('button');
    g.className = 'qm-btn';
    g.title = macKeys('Сгруппировать (Ctrl+G)');
    g.innerHTML = ICONS.group;
    g.addEventListener('click', () => { groupSelected(); });
    qm.appendChild(g);
  }
  if (allGrouped) {
    const ug = document.createElement('button');
    ug.className = 'qm-btn';
    ug.title = macKeys('Разгруппировать (Ctrl+Shift+G)');
    ug.innerHTML = ICONS.ungroup;
    ug.addEventListener('click', () => { ungroupSelected(); });
    qm.appendChild(ug);
  }
  // дублирование
  const dup = document.createElement('button');
  dup.className = 'qm-btn';
  dup.title = macKeys('Дублировать (Ctrl+D)');
  dup.innerHTML = ICONS.duplicate;
  dup.addEventListener('click', () => { duplicateSelection(); });
  qm.appendChild(dup);
  // удаление
  const del = document.createElement('button');
  del.className = 'qm-btn';
  del.title = 'Удалить (Del)';
  del.innerHTML = ICONS.trash;
  del.addEventListener('click', () => {
    deleteSelected();
  });
  qm.appendChild(del);
  positionQuickMenu();
}

function positionQuickMenu(): void {
  const qm = quickMenuEl();
  const wrap = document.getElementById('canvas-wrap')!;
  const wr = wrap.getBoundingClientRect();
  const cam = state.camera;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const el of state.board.elements) {
    if (!state.selection.has(el.id)) continue;
    const a = elementAABB(el);
    x0 = Math.min(x0, a.x0); y0 = Math.min(y0, a.y0);
    x1 = Math.max(x1, a.x1); y1 = Math.max(y1, a.y1);
  }
  if (x0 === Infinity) { qm.hidden = true; return; }
  // над bbox может торчать ручка поворота (~44px) — оставляем ей место
  const hasRotateHandle = state.selection.size === 1 && state.board.elements.some(e =>
    state.selection.has(e.id) && ((e.type === 'shape' && e.shape !== 'line' && e.shape !== 'arrow') || e.type === 'image'));
  const topGap = 10 + (hasRotateHandle ? 44 : 0);
  const sx = (x0 - cam.x) * cam.zoom;
  const sy = (y0 - cam.y) * cam.zoom;
  const sw = (x1 - x0) * cam.zoom;
  const qr = qm.getBoundingClientRect();
  let left = sx + sw / 2 - qr.width / 2;
  let top = sy - qr.height - topGap;
  if (top < 8) top = sy + 12;
  left = Math.max(8, Math.min(left, wr.width - qr.width - 8));
  qm.style.left = `${left}px`;
  qm.style.top = `${top}px`;
}

// ----- Фон страницы (выпадающий список с иконками) -----

const GRID_LABELS: Record<GridMode, string> = {
  none: 'Без фона',
  dots: 'Точки',
  square: 'Клетка',
  coord: 'Координатная плоскость',
};

function gridButton(): HTMLElement {
  return document.getElementById('grid-mode')!;
}

function gridMenu(): HTMLElement {
  return document.getElementById('grid-menu')!;
}

/** Кнопка показывает иконку и название текущего фона; перерисовывается только при смене. */
function renderGridButton(): void {
  const btn = gridButton();
  const g = state.board.grid;
  if (btn.dataset.value === g) return;
  btn.dataset.value = g;
  btn.innerHTML = GRID_ICONS[g];
  const label = document.createElement('span');
  label.textContent = GRID_LABELS[g];
  btn.append(label);
  btn.insertAdjacentHTML('beforeend', ICONS.chevronDown);
}

function closeGridMenu(): void {
  gridMenu().hidden = true;
  gridButton().setAttribute('aria-expanded', 'false');
}

function pickGrid(g: GridMode): void {
  closeGridMenu();
  gridButton().focus();
  if (g === state.board.grid) return;
  setGrid(g);
  void saveNow();
}

function openGridMenu(): void {
  const menu = gridMenu();
  menu.textContent = '';
  for (const g of Object.keys(GRID_LABELS) as GridMode[]) {
    const item = document.createElement('button');
    item.className = 'grid-option';
    item.dataset.grid = g;
    item.setAttribute('role', 'option');
    item.setAttribute('aria-selected', String(g === state.board.grid));
    item.innerHTML = GRID_ICONS[g];
    const label = document.createElement('span');
    label.textContent = GRID_LABELS[g];
    item.append(label);
    item.addEventListener('click', () => pickGrid(g));
    menu.appendChild(item);
  }
  menu.hidden = false;
  const btn = gridButton();
  btn.setAttribute('aria-expanded', 'true');
  const br = btn.getBoundingClientRect();
  menu.style.left = `${br.left}px`;
  menu.style.top = `${br.bottom + 6}px`;
  menu.style.minWidth = `${br.width}px`;
  menu.querySelector<HTMLElement>('[aria-selected="true"]')?.focus();
}

function wireGridPicker(): void {
  const btn = gridButton();
  const menu = gridMenu();
  btn.addEventListener('click', () => {
    if (menu.hidden) openGridMenu();
    else closeGridMenu();
  });
  btn.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      openGridMenu();
    }
  });
  // стрелки ходят по пунктам и не долетают до хоткеев холста; Tab закрывает меню
  menu.addEventListener('keydown', e => {
    const items = [...menu.querySelectorAll<HTMLElement>('.grid-option')];
    const i = items.indexOf(document.activeElement as HTMLElement);
    let next = -1;
    if (e.key === 'ArrowDown') next = (i + 1) % items.length;
    else if (e.key === 'ArrowUp') next = (i - 1 + items.length) % items.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = items.length - 1;
    else if (e.key === 'Tab') { closeGridMenu(); return; }
    else return;
    e.preventDefault();
    e.stopPropagation();
    items[next].focus();
  });
  document.addEventListener('pointerdown', e => {
    const t = e.target as Node;
    if (!menu.hidden && !menu.contains(t) && !btn.contains(t)) closeGridMenu();
  }, { capture: true });
  window.addEventListener('resize', closeGridMenu);
}

// ----- Настройки доски (поповер) -----

function settingsPopover(): HTMLElement {
  return document.getElementById('settings-popover')!;
}

function closeSettings(): void {
  settingsPopover().hidden = true;
}

function openSettings(): void {
  const pop = settingsPopover();
  pop.hidden = false;
  pop.textContent = '';
  const title = document.createElement('div');
  title.className = 'ctx-title';
  title.textContent = 'Настройки доски';
  pop.appendChild(title);
  fillBoardSettings(pop, openSettings);
  const all = document.createElement('button');
  all.className = 'settings-all';
  all.title = macKeys('Все настройки (Ctrl+,)');
  all.innerHTML = ICONS.settings;
  const allText = document.createElement('span');
  allText.textContent = 'Все настройки';
  all.append(allText);
  all.insertAdjacentHTML('beforeend', ICONS.chevron);
  all.addEventListener('click', () => openAllSettings());
  pop.appendChild(all);
  const btn = document.getElementById('btn-settings')!;
  const br = btn.getBoundingClientRect();
  pop.style.left = `${Math.max(8, br.right - 260)}px`;
  pop.style.top = `${br.bottom + 8}px`;
}

/** Окно «Все настройки»; section — раздел, с которого открыть (по умолчанию — последний открытый). */
export function openAllSettings(section?: string): void {
  closeSettings();
  openSettingsDialog([
    {
      id: 'general',
      title: 'Доска',
      icon: ICONS.settings,
      render: (host, rerender) => {
        const box = document.createElement('div');
        box.className = 'sd-general';
        fillBoardSettings(box, rerender);
        host.appendChild(box);
      },
    },
    { id: 'toolbar', title: 'Панель инструментов', icon: ICONS.toolbar, render: host => renderToolbarEditor(host) },
    {
      id: 'hotkeys',
      title: 'Горячие клавиши',
      icon: ICONS.keyboard,
      render: host => renderHotkeysSettings(host, {
        save: patch => {
          setSettings(patch);
          persistSettings();
          renderPages(); // подсказки кнопки и плитки «новая страница» показывают сочетание
        },
        editToolKeys: () => openAllSettings('toolbar'),
      }),
    },
    { id: 'about', title: 'О проекте', icon: ICONS.info, render: host => renderAbout(host) },
  ], section);
}

/** Основные настройки доски — в поповере и в разделе «Доска» окна всех настроек. */
function fillBoardSettings(pop: HTMLElement, rerender: () => void): void {
  const lbl1 = document.createElement('div');
  lbl1.className = 'ctx-label';
  lbl1.textContent = 'Панель инструментов';
  pop.appendChild(lbl1);
  const row = document.createElement('div');
  row.className = 'ctx-toolbar-pos';
  for (const pos of (['left', 'top', 'right', 'bottom'] as ToolbarPos[])) {
    const b = document.createElement('button');
    const names: Record<ToolbarPos, string> = { left: 'Слева', top: 'Сверху', right: 'Справа', bottom: 'Снизу' };
    b.textContent = names[pos];
    b.className = state.settings.toolbarPos === pos ? 'active' : '';
    b.addEventListener('click', () => {
      setSettings({ toolbarPos: pos });
      persistSettings();
      applyToolbarPos();
      rerender();
    });
    row.appendChild(b);
  }
  pop.appendChild(row);
  const lbl2 = document.createElement('label');
  lbl2.className = 'ctx-check';
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.checked = state.settings.coordLabels;
  cb.addEventListener('change', () => {
    setSettings({ coordLabels: cb.checked });
    persistSettings();
  });
  const span = document.createElement('span');
  span.textContent = 'Деления координатной плоскости';
  lbl2.append(cb, span);
  pop.appendChild(lbl2);
  const lbl3 = document.createElement('label');
  lbl3.className = 'ctx-check';
  const cb3 = document.createElement('input');
  cb3.type = 'checkbox';
  cb3.checked = state.settings.snapToGrid;
  cb3.addEventListener('change', () => {
    setSettings({ snapToGrid: cb3.checked });
    persistSettings();
  });
  const span3 = document.createElement('span');
  span3.textContent = 'Привязка к сетке';
  lbl3.append(cb3, span3);
  pop.appendChild(lbl3);
  const lbl8 = document.createElement('label');
  lbl8.className = 'ctx-check';
  lbl8.title = macKeys('Изображения и страницы PDF не искажаются при изменении размера — Ctrl или Shift зажимать не нужно');
  const cb8 = document.createElement('input');
  cb8.type = 'checkbox';
  cb8.checked = state.settings.keepImageAspect;
  cb8.addEventListener('change', () => {
    setSettings({ keepImageAspect: cb8.checked });
    persistSettings();
  });
  const span8 = document.createElement('span');
  span8.textContent = 'Пропорциональный размер изображений';
  lbl8.append(cb8, span8);
  pop.appendChild(lbl8);
  pop.appendChild(settingCheck('alignGuides', 'Направляющие выравнивания',
    'При переносе и изменении размера — пунктир от соседних объектов, к их краям и центрам объект примагничивается'));
  const lbl4 = document.createElement('div');
  lbl4.className = 'ctx-label';
  lbl4.textContent = 'Колёсико мыши';
  pop.appendChild(lbl4);
  const wheelRow = document.createElement('div');
  wheelRow.className = 'ctx-toolbar-pos';
  const wheelModes: { mode: WheelMode; name: string; hint: string }[] = [
    { mode: 'scroll', name: 'Прокрутка', hint: 'Колёсико прокручивает, Shift — по горизонтали, Ctrl — масштаб' },
    { mode: 'zoom', name: 'Масштаб', hint: 'Колёсико масштабирует, Shift — прокрутка по горизонтали, Ctrl+Shift — по вертикали. Тачпад всегда прокручивает' },
  ];
  for (const { mode, name, hint } of wheelModes) {
    const b = document.createElement('button');
    b.textContent = name;
    b.title = hint;
    b.className = state.settings.wheelMode === mode ? 'active' : '';
    b.addEventListener('click', () => {
      setSettings({ wheelMode: mode });
      persistSettings();
      rerender();
    });
    wheelRow.appendChild(b);
  }
  pop.appendChild(wheelRow);
  const lbl5 = document.createElement('div');
  lbl5.className = 'ctx-label';
  lbl5.textContent = 'Анимация перехода на другую страницу';
  pop.appendChild(lbl5);
  const transRow = document.createElement('div');
  transRow.className = 'ctx-toolbar-pos ctx-options';
  for (const { mode, name, hint } of PAGE_TRANSITIONS) {
    const b = document.createElement('button');
    b.textContent = name;
    b.title = hint;
    b.className = state.settings.pageTransition === mode ? 'active' : '';
    b.addEventListener('click', () => {
      setSettings({ pageTransition: mode });
      persistSettings();
      rerender();
    });
    transRow.appendChild(b);
  }
  pop.appendChild(transRow);
  const lblPages = document.createElement('div');
  lblPages.className = 'ctx-label';
  lblPages.textContent = 'Список страниц';
  pop.appendChild(lblPages);
  pop.appendChild(settingCheck('closePagesOnPick', 'Закрывать после выбора страницы'));
  pop.appendChild(settingCheck('thumbViewport', 'Показывать на превью видимую область',
    'Пунктирная рамка цветом вашего курсора показывает, какую часть страницы вы сейчас видите', () => syncThumbViewport()));
  const lbl6 = document.createElement('label');
  lbl6.className = 'ctx-check';
  lbl6.title = 'Меню и панели плавно выплывают при открытии';
  const cb6 = document.createElement('input');
  cb6.type = 'checkbox';
  cb6.checked = state.settings.uiAnimations;
  cb6.addEventListener('change', () => {
    setSettings({ uiAnimations: cb6.checked });
    persistSettings();
    applyUiAnimations();
  });
  const span6 = document.createElement('span');
  span6.textContent = 'Анимация меню и панелей';
  lbl6.append(cb6, span6);
  pop.appendChild(lbl6);
  const lbl7 = document.createElement('label');
  lbl7.className = 'ctx-check';
  lbl7.title = macKeys('Отмена и повтор по-прежнему работают на Ctrl+Z и Ctrl+Y');
  const cb7 = document.createElement('input');
  cb7.type = 'checkbox';
  cb7.checked = state.settings.hideUndoRedo;
  cb7.addEventListener('change', () => {
    setSettings({ hideUndoRedo: cb7.checked });
    persistSettings();
    applyUndoRedoVisibility();
  });
  const span7 = document.createElement('span');
  span7.textContent = 'Скрыть кнопки отмены и повтора';
  lbl7.append(cb7, span7);
  pop.appendChild(lbl7);
}

type BoolSetting = 'alignGuides' | 'closePagesOnPick' | 'thumbViewport';

/** Флажок настройки доски: меняет и сразу сохраняет. */
function settingCheck(key: BoolSetting, text: string, hint?: string, after?: () => void): HTMLElement {
  const lbl = document.createElement('label');
  lbl.className = 'ctx-check';
  if (hint) lbl.title = hint;
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.checked = state.settings[key];
  cb.addEventListener('change', () => {
    setSettings({ [key]: cb.checked });
    persistSettings();
    after?.();
  });
  const span = document.createElement('span');
  span.textContent = text;
  lbl.append(cb, span);
  return lbl;
}

function applyToolbarPos(): void {
  const tb = document.getElementById('toolbar')!;
  tb.dataset.pos = state.settings.toolbarPos;
  // панель внизу заняла бы место кнопки страниц: кнопка уходит наверх, список — колонкой под ней
  const dock = document.getElementById('pages-dock')!;
  const top = pagesAtTop();
  dock.dataset.side = top ? 'top' : 'bottom';
  dock.dataset.tipSide = top ? 'bottom' : 'top';
  positionCtxPanels();
}

/** Кнопка страниц — слева вверху, список вертикальный (когда панель инструментов внизу). */
function pagesAtTop(): boolean {
  return state.settings.toolbarPos === 'bottom';
}

// ----- Экспорт PNG -----

export async function exportPng(): Promise<void> {
  const els = state.selection.size
    ? state.board.elements.filter(e => state.selection.has(e.id))
    : state.board.elements;
  if (els.length === 0) {
    alert('Страница пуста — нечего экспортировать');
    return;
  }
  const bb = contentBBox(els);
  const pad = 32;
  const bw = bb.w + pad * 2;
  const bh = bb.h + pad * 2;
  const scale = Math.min(2, 8000 / Math.max(bw, bh));
  const cv = document.createElement('canvas');
  cv.width = Math.ceil(bw * scale);
  cv.height = Math.ceil(bh * scale);
  const c = cv.getContext('2d');
  if (!c) return;
  renderScene(c, els, { x: bb.x0 - pad, y: bb.y0 - pad, zoom: 1 }, bw, bh, scale, 'none');
  const dataUrl = cv.toDataURL('image/png');
  const name = `${state.project.name.trim() || 'abax'} — ${state.board.name.trim() || 'стр'}.png`;
  const api = (window as { doskaAPI?: { exportPng(d: string, n: string): Promise<boolean> } }).doskaAPI;
  if (api) {
    await api.exportPng(dataUrl, name);
  } else if (isNativeApp()) {
    await sharePng(dataUrl, name);
  } else {
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = name.replace(/—/g, '-');
    a.click();
  }
}

// ----- Импорт PDF -----

function pickPdfViaInput(): Promise<string | null> {
  const { promise, resolve } = Promise.withResolvers<string | null>();
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = 'application/pdf';
  inp.onchange = () => {
    const f = inp.files?.[0];
    if (!f) { resolve(null); return; }
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => resolve(null);
    fr.readAsDataURL(f);
  };
  inp.click();
  return promise;
}

const PDF_PAGE_W = 900; // юниты сцены
const PDF_PAGE_GAP = 48;
const PDF_MAX_PAGES = 30;

/** Импортирует PDF: каждая страница — картинка-фон на доске. */
export async function importPdf(): Promise<void> {
  const dataUrl = (window as { doskaAPI?: { pickPdf(): Promise<string | null> } }).doskaAPI
    ? await (window as unknown as { doskaAPI: { pickPdf(): Promise<string | null> } }).doskaAPI.pickPdf()
    : await pickPdfViaInput();
  if (dataUrl) await importPdfFromDataUrl(dataUrl);
}

/** Рендерит страницы PDF в картинки и добавляет их на доску. */
export async function importPdfFromDataUrl(dataUrl: string): Promise<void> {
  try {
    const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
    const bin = atob(base64);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    const pdf = await pdfjsLib.getDocument({ data: u8 }).promise;
    const x = state.camera.x + 40;
    let y = state.camera.y + 40;
    const imgs: ImageEl[] = [];
    const pages = Math.min(pdf.numPages, PDF_MAX_PAGES);
    for (let p = 1; p <= pages; p++) {
      const page = await pdf.getPage(p);
      const vp0 = page.getViewport({ scale: 1 });
      const scale = PDF_PAGE_W / vp0.width;
      const vp = page.getViewport({ scale: scale * 2 }); // 2x для чёткости
      const cv = document.createElement('canvas');
      cv.width = Math.ceil(vp.width);
      cv.height = Math.ceil(vp.height);
      const c2 = cv.getContext('2d')!;
      c2.fillStyle = '#ffffff';
      c2.fillRect(0, 0, cv.width, cv.height);
      await page.render({ canvasContext: c2, viewport: vp }).promise;
      const h = vp0.height * scale;
      imgs.push({ id: uid(), type: 'image', src: cv.toDataURL('image/jpeg', 0.9), x, y, w: PDF_PAGE_W, h });
      y += h + PDF_PAGE_GAP;
    }
    pushHistory(state.board.elements);
    replaceElements([...state.board.elements, ...imgs]);
    selectInserted(...imgs.map(i => i.id));
    fitContent();
  } catch (err) {
    alert('Не удалось открыть PDF: ' + (err instanceof Error ? err.message : String(err)));
  }
}

// ----- Вставка изображений -----

function pickImageViaInput(): Promise<string | null> {
  const { promise, resolve } = Promise.withResolvers<string | null>();
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = 'image/*';
  inp.onchange = () => {
    const f = inp.files?.[0];
    if (!f) { resolve(null); return; }
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => resolve(null);
    fr.readAsDataURL(f);
  };
  inp.click();
  return promise;
}

/** Вставляет картинку по dataURL: центрирует на точке (или в центре экрана), вписывает в экран. */
export function insertImageFromDataUrl(dataUrl: string, at?: { x: number; y: number }): void {
  const probe = new Image();
  probe.onload = () => {
    const nw = probe.naturalWidth || 400;
    const nh = probe.naturalHeight || 300;
    const r = canvas.getBoundingClientRect();
    const scale = Math.min(1, 800 / nw, (r.height * 0.6) / nh);
    const w = Math.max(24, nw * scale);
    const h = Math.max(24, nh * scale);
    const cam = state.camera;
    const cx = at ? at.x : cam.x + r.width / (2 * cam.zoom);
    const cy = at ? at.y : cam.y + r.height / (2 * cam.zoom);
    const el: ImageEl = { id: uid(), type: 'image', src: dataUrl, x: cx - w / 2, y: cy - h / 2, w, h };
    pushHistory(state.board.elements);
    replaceElements([...state.board.elements, el]);
    // картинку обычно сразу двигают и масштабируют — включаем выделение
    selectInserted(el.id);
  };
  probe.onerror = () => alert('Не удалось прочитать изображение');
  probe.src = dataUrl;
}

export async function insertImage(): Promise<void> {
  const api = (window as { doskaAPI?: { pickImage(): Promise<string | null> } }).doskaAPI;
  const dataUrl = api ? await api.pickImage() : await pickImageViaInput();
  if (dataUrl) insertImageFromDataUrl(dataUrl);
}

function fileToDataUrl(f: File): Promise<string | null> {
  const { promise, resolve } = Promise.withResolvers<string | null>();
  const fr = new FileReader();
  fr.onload = () => resolve(String(fr.result));
  fr.onerror = () => resolve(null);
  fr.readAsDataURL(f);
  return promise;
}

/** Событие буфера обмена относится к доске, а не к полю ввода или окну настроек. */
function boardClipboardEvent(e: ClipboardEvent): boolean {
  return state.view === 'board' && !settingsDialogOpen() && !isTypingField(e.target);
}

/** Можно менять содержимое активной страницы (в совместной работе — нужно право edit). */
export function canEditBoard(): boolean {
  return !(collabActive() && readOnly());
}

/** Видимая область холста в координатах сцены. */
export function viewRect(): AABB {
  const r = canvas.getBoundingClientRect();
  const cam = state.camera;
  return { x0: cam.x, y0: cam.y, x1: cam.x + r.width / cam.zoom, y1: cam.y + r.height / cam.zoom };
}

/** Ctrl+D: копия выделенного со сдвигом, выделение переходит на неё. */
export function duplicateSelection(): void {
  if (!canEditBoard()) return;
  const step = COPY_STEP_PX / state.camera.zoom;
  duplicateSelected(step, step);
}

function wireImageInput(): void {
  document.getElementById('btn-image')!.addEventListener('click', () => { void insertImage(); });
  // Ctrl+C / Ctrl+X / Ctrl+V: элементы доски и картинки из буфера обмена
  const copyOrCut = (e: ClipboardEvent, cut: boolean) => {
    if (!boardClipboardEvent(e)) return;
    // выделенный текст интерфейса копируется как обычно
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) return;
    if (cut && !canEditBoard()) return;
    if (copySelection(e.clipboardData, cut)) e.preventDefault();
  };
  document.addEventListener('copy', e => copyOrCut(e, false));
  document.addEventListener('cut', e => copyOrCut(e, true));
  document.addEventListener('paste', e => {
    if (!boardClipboardEvent(e) || !canEditBoard()) return;
    // скопированное на доске важнее картинки: системный буфер хранит последнее копирование
    if (pasteFromSystem(e.clipboardData, viewRect())) { e.preventDefault(); return; }
    for (const it of e.clipboardData?.items ?? []) {
      if (it.kind === 'file' && it.type.startsWith('image/')) {
        const f = it.getAsFile();
        if (f) {
          e.preventDefault();
          void fileToDataUrl(f).then(d => { if (d) insertImageFromDataUrl(d); });
          return;
        }
      }
    }
    if (pasteFromMemory(viewRect())) e.preventDefault();
  });
  // перетаскивание файла на доску
  const wrap = document.getElementById('canvas-wrap')!;
  wrap.addEventListener('dragover', e => e.preventDefault());
  wrap.addEventListener('drop', e => {
    e.preventDefault();
    const f = e.dataTransfer?.files?.[0];
    if (f && f.type.startsWith('image/')) {
      void fileToDataUrl(f).then(d => { if (d) insertImageFromDataUrl(d); });
    }
  });
}

// ----- Камера -----

export function fitContent(): void {
  const r = canvas.getBoundingClientRect();
  const els = state.board.elements;
  if (els.length === 0) {
    state.camera = { x: -r.width / 2, y: -r.height / 2, zoom: 1 };
    update();
    return;
  }
  const bb = contentBBox(els);
  const zoom = Math.max(0.05, Math.min(1.5, Math.min(r.width / (bb.w + 160), r.height / (bb.h + 160))));
  state.camera = {
    zoom,
    x: bb.x0 + bb.w / 2 - r.width / (2 * zoom),
    y: bb.y0 + bb.h / 2 - r.height / (2 * zoom),
  };
  update();
}

// ----- Сохранение -----

export async function saveNow(): Promise<void> {
  clearTimeout(saveTimer);
  if (!state.dirty) return;
  state.dirty = false;
  await storage.save(state.project);
  const meta = projectMeta(state.project);
  state.projects = [meta, ...state.projects.filter(m => m.id !== meta.id)];
  localStorage.setItem('doska.last', JSON.stringify({ pid: state.project.id, pageId: state.pageId }));
  renderPages();
}

function scheduleSave(): void {
  if (!state.dirty) return;
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => { void saveNow(); }, 600);
}

// уход в фон (свернули окно, на планшете — кнопка «Домой» или «Назад»): сохраняем сразу,
// не дожидаясь таймера — система может выгрузить приложение раньше
document.addEventListener('visibilitychange', () => {
  if (document.hidden) void saveNow();
});

// ----- Страницы и проекты -----

/** Холсты, на которых играет переход между страницами: основной и окно демонстрации. */
function transitionCanvases(): HTMLCanvasElement[] {
  const pc = presentCanvas();
  return pc ? [canvas, pc] : [canvas];
}

function pageIndex(pageId: string): number {
  return state.project.pages.findIndex(p => p.id === pageId);
}

/** Смена активной страницы (переключение, новая, удаление) — с анимацией перехода из настроек. */
function changePage(change: () => void): void {
  const fromId = state.pageId;
  const from = pageIndex(fromId);
  const play = state.view === 'board' ? capturePageTransition(state.settings.pageTransition, transitionCanvases()) : null;
  change();
  refresh();
  fitContent();
  // кадр новой страницы — сразу и начисто, не дожидаясь покоя камеры
  renderNow();
  if (play && state.pageId !== fromId) play(pageIndex(state.pageId) >= from ? 1 : -1);
}

async function switchPageHandler(pageId: string): Promise<void> {
  if (pageId === state.pageId || state.view !== 'board') return;
  await saveNow();
  changePage(() => switchPage(pageId));
}

/** Переход на страницу по номеру (Ctrl или Alt + 1…9); такой страницы нет — ничего. */
export function switchToPage(n: number): void {
  const page = state.project.pages[n - 1];
  if (page) void switchPageHandler(page.id);
}

/** Новая страница по горячей клавише (гость совместной работы страниц не добавляет). */
export function addPageFromKey(): void {
  if (state.view !== 'board' || !canEditPages()) return;
  void newPageHandler();
}

/** Подсказка «Новая страница (Ctrl+N)» — с сочетанием из настроек, если оно есть. */
function newPageTip(): string {
  const k = state.settings.newPageKey;
  return k ? `Новая страница (${comboLabel(k)})` : 'Новая страница';
}

async function newPageHandler(): Promise<void> {
  await saveNow();
  changePage(() => addPage());
}

async function deletePageHandler(pageId: string): Promise<void> {
  const page = state.project.pages.find(p => p.id === pageId);
  if (!page || !confirm(`Удалить страницу «${page.name}»?`)) return;
  await saveNow();
  changePage(() => deletePage(pageId));
}

async function renamePageHandler(pageId: string, name: string): Promise<void> {
  renamePage(pageId, name);
  await saveNow();
}

async function movePageHandler(from: number, to: number): Promise<void> {
  movePage(from, to);
  await saveNow();
}

const THUMB_W = 164;
const THUMB_H = 100;

/** Камера превью, вписывающая рамку frame; null — пустая страница: начало координат в центре. */
function thumbCamera(frame: AABB | null): Camera {
  const W = THUMB_W;
  const H = THUMB_H;
  if (!frame) return { x: -W / 2, y: -H / 2, zoom: 1 };
  const w = frame.x1 - frame.x0, h = frame.y1 - frame.y0;
  const zoom = Math.max(0.02, Math.min(1, Math.min(W / (w + 40), H / (h + 40))));
  return { zoom, x: frame.x0 + w / 2 - W / (2 * zoom), y: frame.y0 + h / 2 - H / (2 * zoom) };
}

/** Что вписать в превью: содержимое и, если задана, видимую область (у текущей страницы — как на мини-карте). */
function thumbFrame(content: AABB | null, view: AABB | null): AABB | null {
  return content && view ? aabbUnion(content, view) : content ?? view;
}

/** Мини-превью страницы: вписывает содержимое (и область view) в карточку; возвращает камеру превью и рамку содержимого. */
function renderPageThumb(page: Page, cv: HTMLCanvasElement, view: AABB | null = null): { cam: Camera; content: AABB | null } {
  cv.width = THUMB_W * 2;
  cv.height = THUMB_H * 2;
  const content = page.elements.length > 0 ? contentBBox(page.elements) : null;
  const cam = thumbCamera(thumbFrame(content, view));
  const c = cv.getContext('2d');
  if (c) renderScene(c, page.elements, cam, THUMB_W, THUMB_H, 2, page.grid === 'coord' ? 'none' : page.grid);
  return { cam, content };
}

function pagesKey(): string {
  return [
    state.project.id,
    state.project.name,
    state.pageId,
    state.projects.length,
    state.project.updatedAt,
    state.project.pages.map(p => `${p.id}:${p.name}:${p.grid}:${p.elements.length}`).join('|'),
  ].join('#');
}

// ----- Плавающая кнопка страниц и список под ней -----

/** Список страниц показан: кнопка приподнята над ним. */
let pagesOpen = false;

interface PageCard {
  el: HTMLElement;
  thumb: HTMLCanvasElement;
  /** Рамка видимой области (только у текущей страницы). */
  view: HTMLElement;
  /** Камера превью: где на нём сцена (при каждой перерисовке превью — своя). */
  cam: Camera | null;
  /** Рамка содержимого на момент перерисовки превью. */
  content: AABB | null;
  num: HTMLElement;
  grid: HTMLElement;
  name: HTMLElement;
  gridMode: GridMode | null;
  /** С чего снято превью: массивы элементов иммутабельны — сравниваем по ссылке. */
  shot: { elements: Element[]; grid: GridMode; epoch: number } | null;
}
const pageCards = new Map<string, PageCard>();
let addPageTile: HTMLButtonElement | null = null;
let revealedPageId = '';

/** Гость совместной работы страниц не добавляет и не удаляет. */
function canEditPages(): boolean {
  return !(collabActive() && !isHost());
}

function makePageCard(pageId: string): PageCard {
  const el = document.createElement('div');
  el.className = 'page-item';
  const thumbBox = document.createElement('div');
  thumbBox.className = 'page-thumb';
  const thumb = document.createElement('canvas');
  // размер — сразу: превью рисуются при первом открытии списка
  thumb.style.width = `${THUMB_W}px`;
  thumb.style.height = `${THUMB_H}px`;
  const num = document.createElement('span');
  num.className = 'page-num';
  const view = document.createElement('div');
  view.className = 'page-view';
  view.hidden = true;
  thumbBox.append(thumb, view, num);
  const row = document.createElement('div');
  row.className = 'page-row';
  const grid = document.createElement('span');
  grid.className = 'page-grid-icon';
  grid.title = 'Фон страницы';
  const name = document.createElement('span');
  name.className = 'page-name';
  name.title = 'Двойной клик — переименовать';
  row.append(grid, name);
  const del = document.createElement('button');
  del.className = 'page-del';
  del.title = 'Удалить страницу';
  del.innerHTML = ICONS.del;
  el.append(thumbBox, row, del);
  const card: PageCard = { el, thumb, view, cam: null, content: null, num, grid, name, gridMode: null, shot: null };
  el.addEventListener('click', e => {
    if ((e.target as HTMLElement).closest('.page-del, input')) return;
    void switchPageHandler(pageId);
    if (state.settings.closePagesOnPick) setPagesOpen(false);
  });
  name.addEventListener('dblclick', () => startPageRename(card, pageId));
  del.addEventListener('click', e => {
    e.stopPropagation();
    void deletePageHandler(pageId);
  });
  pageCards.set(pageId, card);
  return card;
}

/** Последний элемент списка — плитка с пунктиром: новая страница. */
function makeAddPageTile(): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = 'page-add';
  b.title = 'Новая страница';
  b.innerHTML = ICONS.plus;
  b.addEventListener('click', () => { void newPageHandler(); });
  return b;
}

/** Видимая область, которую вписывает превью страницы: только у текущей и при включённой настройке. */
function thumbView(pageId: string): AABB | null {
  return pageId === state.pageId && state.settings.thumbViewport && state.view === 'board' ? viewRect() : null;
}

/** Превью уже вписано иначе, чем нужно сейчас: заметно другой масштаб или сдвиг. */
function thumbOffFrame(card: PageCard, view: AABB | null): boolean {
  const cam = card.cam;
  if (!cam) return true;
  const want = thumbCamera(thumbFrame(card.content, view));
  return Math.abs(want.zoom / cam.zoom - 1) > 0.1
    || Math.abs((want.x - cam.x) * want.zoom) > 4 || Math.abs((want.y - cam.y) * want.zoom) > 4;
}

/** Превью перерисовывается, только если изменились содержимое, фон или (у текущей страницы) видимая область вышла за него. */
function syncPageThumb(card: PageCard, page: Page): void {
  const epoch = imageEpoch();
  const shot = card.shot;
  const view = thumbView(page.id);
  if (shot && shot.elements === page.elements && shot.grid === page.grid && shot.epoch === epoch && !thumbOffFrame(card, view)) return;
  card.shot = { elements: page.elements, grid: page.grid, epoch };
  ({ cam: card.cam, content: card.content } = renderPageThumb(page, card.thumb, view));
}

let reframeTimer = 0;

/**
 * Рамка видимой сейчас области — на превью текущей страницы, цветом курсора
 * (в совместной работе — своим цветом участника). Двигается вместе с камерой; когда камера
 * успокоится, превью перевписывается, чтобы рамка была видна целиком.
 */
function syncThumbViewport(): void {
  if (!pagesOpen) return;
  const card = pageCards.get(state.pageId);
  for (const c of pageCards.values()) if (c !== card) c.view.hidden = true;
  if (!card?.cam) return;
  const view = thumbView(state.pageId);
  card.view.hidden = !view;
  if (thumbOffFrame(card, view)) {
    clearTimeout(reframeTimer);
    reframeTimer = window.setTimeout(() => {
      if (!pagesOpen || card !== pageCards.get(state.pageId)) return;
      syncPageThumb(card, state.board);
      syncThumbViewport();
    }, 150);
  }
  if (!view) return;
  const t = card.cam;
  const v = card.view;
  v.style.left = `${(view.x0 - t.x) * t.zoom}px`;
  v.style.top = `${(view.y0 - t.y) * t.zoom}px`;
  v.style.width = `${(view.x1 - view.x0) * t.zoom}px`;
  v.style.height = `${(view.y1 - view.y0) * t.zoom}px`;
  v.style.setProperty('--view', collabActive() ? myColor() : '#3273f5');
}

/** Список страниц сверяется с проектом: карточки переиспользуются, а не пересоздаются. */
function renderPages(): void {
  // карточку тащат: список сверится с проектом, когда её отпустят
  if (reordering()) return;
  try {
    document.getElementById('project-name')!.textContent = state.project.name;
    const list = document.getElementById('pages-list')!;
    const pages = state.project.pages;
    const seen = new Set<string>();
    pages.forEach((page, i) => {
      seen.add(page.id);
      const card = pageCards.get(page.id) ?? makePageCard(page.id);
      card.el.classList.toggle('active', page.id === state.pageId);
      card.el.style.setProperty('--i', String(i));
      card.num.textContent = String(i + 1);
      if (card.name.textContent !== page.name) card.name.textContent = page.name;
      if (card.gridMode !== page.grid) {
        card.gridMode = page.grid;
        card.grid.innerHTML = GRID_ICONS[page.grid];
      }
      // превью рисуются только у открытого списка
      if (pagesOpen) syncPageThumb(card, page);
      // переставляем, только если не на месте: перенос узла сбросил бы фокус переименования
      if (list.children[i] !== card.el) list.insertBefore(card.el, list.children[i] ?? null);
    });
    for (const [id, card] of pageCards) {
      if (seen.has(id)) continue;
      card.el.remove();
      pageCards.delete(id);
    }
    if (canEditPages()) {
      addPageTile ??= makeAddPageTile();
      addPageTile.style.setProperty('--i', String(pages.length));
      // подсказка уже могла переехать в data-tip (см. tooltip.ts) — обновляем, только если сочетание сменилось
      const tip = newPageTip();
      if ((addPageTile.getAttribute('title') ?? addPageTile.dataset.tip) !== tip) addPageTile.title = tip;
      if (list.lastElementChild !== addPageTile) list.appendChild(addPageTile);
    } else {
      addPageTile?.remove();
    }
    syncPagesButton();
    const tray = document.getElementById('pages-tray')!;
    document.getElementById('pages-dock')!.style.setProperty('--tray-h', `${tray.offsetHeight}px`);
    if (pagesOpen && revealedPageId !== state.pageId) {
      revealedPageId = state.pageId;
      revealActivePage(true);
    }
  } catch (err) { console.error('[doska] renderPages failed:', err); }
}

/** Кнопка: «Страница +», пока страница одна (добавляет вторую), иначе «Страницы» с числом. */
function syncPagesButton(): void {
  const btn = document.getElementById('btn-pages')!;
  const n = state.project.pages.length;
  const add = n === 1 && !pagesOpen && canEditPages();
  const key = `${add}:${n}:${pagesOpen}:${state.settings.newPageKey}`;
  if (btn.dataset.key === key) return;
  btn.dataset.key = key;
  btn.classList.toggle('add', add);
  btn.setAttribute('aria-expanded', String(pagesOpen));
  btn.innerHTML = add
    ? `${ICONS.pages}<span class="pages-label">Страница</span> <span class="pages-plus">${ICONS.plus}</span>`
    : `${ICONS.pages}<span class="pages-label">Страницы</span> <span class="pages-count">${n}</span>`
      + `<span class="pages-chev">${ICONS.chevronUp}</span>`;
  btn.title = add ? newPageTip() : pagesOpen ? 'Скрыть страницы (B)' : 'Показать страницы (B)';
}

/** Прокручивает список так, чтобы активная страница была видна. */
function revealActivePage(smooth: boolean): void {
  const list = document.getElementById('pages-list')!;
  const el = pageCards.get(state.pageId)?.el;
  if (!el) return;
  const pad = 12;
  const vertical = pagesAtTop();
  const start = (vertical ? el.offsetTop : el.offsetLeft) - pad;
  const end = (vertical ? el.offsetTop + el.offsetHeight : el.offsetLeft + el.offsetWidth) + pad;
  const scroll = vertical ? list.scrollTop : list.scrollLeft;
  const size = vertical ? list.clientHeight : list.clientWidth;
  let to = scroll;
  if (start < to) to = start;
  else if (end > to + size) to = end - size;
  if (to !== scroll) list.scrollTo({ [vertical ? 'top' : 'left']: to, behavior: smooth ? 'smooth' : 'auto' });
}

function setPagesOpen(open: boolean): void {
  if (pagesOpen === open) return;
  pagesOpen = open;
  renderPages();
  syncThumbViewport();
  document.getElementById('pages-dock')!.classList.toggle('open', open);
  if (open) {
    revealedPageId = state.pageId;
    revealActivePage(false);
  }
}

/** Показать или скрыть список страниц (кнопка «Страницы», клавиша B). */
export function togglePages(): void {
  setPagesOpen(!pagesOpen);
}

function wirePagesDock(): void {
  document.getElementById('btn-pages')!.addEventListener('click', () => {
    if (!pagesOpen && state.project.pages.length === 1 && canEditPages()) {
      // «Страница +»: добавляет вторую страницу и показывает обе
      void newPageHandler().then(() => setPagesOpen(true));
      return;
    }
    togglePages();
  });
  const list = document.getElementById('pages-list')!;
  makeSortable(list, {
    items: () => [...list.querySelectorAll<HTMLElement>(':scope > .page-item')],
    enabled: canEditPages,
    scroller: list,
    onEnd: (from, to) => {
      if (from !== to) void movePageHandler(from, to);
      else renderPages();
    },
  });
  list.addEventListener('wheel', e => {
    // обычное колёсико листает горизонтальный список; вертикальный листается сам
    if (pagesAtTop() || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
    e.preventDefault();
    list.scrollLeft += e.deltaY;
  }, { passive: false });
}

function startPageRename(card: PageCard, pageId: string): void {
  if (card.el.querySelector('input')) return;
  const oldName = state.project.pages.find(p => p.id === pageId)?.name;
  if (oldName === undefined) return;
  const input = document.createElement('input');
  input.value = oldName;
  input.spellcheck = false;
  card.name.hidden = true;
  card.name.after(input);
  input.focus();
  input.select();
  let done = false;
  const finish = (commit: boolean) => {
    if (done) return;
    done = true;
    input.remove();
    card.name.hidden = false;
    const v = input.value.trim();
    if (commit && v && v !== oldName) void renamePageHandler(pageId, v);
  };
  input.addEventListener('blur', () => finish(true));
  input.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Enter') finish(true);
    if (e.key === 'Escape') finish(false);
  });
}

// ----- Домашняя страница: проекты -----

/**
 * Неоткрытые проекты, загруженные ради превью страниц; at — updatedAt из метаданных на момент загрузки
 * (разошлось — перезагружаем). project = null — файл не прочитался.
 */
const homeProjects = new Map<string, { at: number; project: Project | null }>();
const homeLoading = new Set<string>();
/** Превью страниц на домашней: холсты переживают перестройку списка, перерисовываются по изменению. */
const homeThumbs = new Map<string, { cv: HTMLCanvasElement; shot: { elements: Element[]; grid: GridMode } | null }>();
/** Список перестроить не дали (тащили страницу) — перестроим, когда отпустят. */
let homeRenderPending = false;

/** Проект для карточки на домашней: открытый — из состояния, остальные — из кэша (null — ещё грузится). */
function homeProject(meta: ProjectMeta): Project | null {
  if (state.project.id === meta.id) return state.project;
  const cached = homeProjects.get(meta.id);
  return cached && cached.at === meta.updatedAt ? cached.project : null;
}

function homeProjectFailed(meta: ProjectMeta): boolean {
  const cached = homeProjects.get(meta.id);
  return !!cached && cached.at === meta.updatedAt && !cached.project;
}

/** Догружает проекты, превью которых ещё нет, и перестраивает список. */
function loadHomeProjects(): void {
  const missing = state.projects.filter(m =>
    m.id !== state.project.id && !homeLoading.has(m.id) && homeProjects.get(m.id)?.at !== m.updatedAt);
  if (missing.length === 0) return;
  for (const m of missing) homeLoading.add(m.id);
  void Promise.all(missing.map(async m => {
    const project = await storage.load(m.id).catch(() => null);
    homeProjects.set(m.id, { at: m.updatedAt, project });
    homeLoading.delete(m.id);
  })).then(() => { if (state.view === 'home') renderHome(); });
}

/** Уходим из открытого проекта: его текущий вид — превью на домашней без повторной загрузки. */
function rememberOpenProject(): void {
  homeProjects.set(state.project.id, { at: state.project.updatedAt, project: state.project });
}

/** Правка неоткрытого проекта: загрузить, изменить, сохранить; метаданные и превью — следом. */
async function editClosedProject(id: string, edit: (p: Project) => Project, touch = true): Promise<Project | null> {
  const loaded = await storage.load(id);
  if (!loaded) return null;
  const p = edit(loaded);
  if (touch) p.updatedAt = Date.now();
  await storage.save(p);
  homeProjects.set(id, { at: p.updatedAt, project: p });
  state.projects = state.projects.map(m => (m.id === id ? projectMeta(p) : m));
  return p;
}

async function openProjectHandler(project: Project, pageId?: string): Promise<void> {
  await saveNow();
  if (project.id !== state.project.id) rememberOpenProject();
  openProject(project, pageId);
  localStorage.setItem('doska.last', JSON.stringify({ pid: project.id, pageId: state.pageId }));
  refresh();
  fitContent();
}

/** Открывает проект с домашней (на заданной странице или первой). */
async function openFromHome(projectId: string, pageId?: string): Promise<void> {
  const p = state.project.id === projectId ? state.project : await storage.load(projectId);
  if (p) await openProjectHandler(p, pageId);
}

async function newProjectHandler(): Promise<void> {
  await saveNow();
  rememberOpenProject();
  const p = blankProject(`Проект ${state.projects.length + 1}`);
  await storage.save(p);
  state.projects = [projectMeta(p), ...state.projects];
  openProject(p);
  refresh();
  fitContent();
}

async function deleteProjectHandler(id: string): Promise<void> {
  const meta = state.projects.find(m => m.id === id);
  if (!meta || !confirm(`Удалить проект «${meta.name}» со всеми страницами?`)) return;
  await storage.remove(id);
  homeProjects.delete(id);
  state.projects = state.projects.filter(m => m.id !== id);
  if (state.project.id === id) {
    // удаляют из списка проектов — там и остаёмся
    const view = state.view;
    if (state.projects.length > 0) {
      const p = await storage.load(state.projects[0].id);
      if (p) { openProject(p, undefined, view); fitContent(); }
    } else {
      const p = blankProject('Проект 1');
      await storage.save(p);
      state.projects = [projectMeta(p)];
      openProject(p, undefined, view);
      fitContent();
    }
  }
  renderHome();
}

async function renameProjectHandler(id: string, name: string): Promise<void> {
  const meta = state.projects.find(m => m.id === id);
  if (!meta) return;
  meta.name = name;
  state.projects = [...state.projects];
  if (state.project.id === id) {
    state.project = { ...state.project, name };
    await storage.save(state.project);
  } else {
    await editClosedProject(id, p => ({ ...p, name }), false);
  }
  renderHome();
  renderPages();
}

/** Закрепить проект в избранном или открепить (дата изменения не трогается — это не правка содержимого). */
async function togglePinnedHandler(id: string): Promise<void> {
  const meta = state.projects.find(m => m.id === id);
  if (!meta) return;
  const pinned = meta.pinned ? undefined : true;
  if (state.project.id === id) {
    await saveNow();
    state.project = { ...state.project, pinned };
    await storage.save(state.project);
    state.projects = state.projects.map(m => (m.id === id ? projectMeta(state.project) : m));
  } else {
    await editClosedProject(id, p => ({ ...p, pinned }), false);
  }
  renderHome();
}

async function homeAddPage(projectId: string): Promise<void> {
  if (state.project.id === projectId) {
    await saveNow();
    addPage();
    await saveNow();
  } else {
    await editClosedProject(projectId, p => ({ ...p, pages: [...p.pages, blankPage(`Страница ${p.pages.length + 1}`)] }));
  }
  renderHome();
}

async function homeDeletePage(projectId: string, pageId: string): Promise<void> {
  if (state.project.id === projectId) {
    const page = state.project.pages.find(p => p.id === pageId);
    if (!page || !confirm(`Удалить страницу «${page.name}»?`)) return;
    await saveNow();
    deletePage(pageId);
    await saveNow();
    renderHome();
    return;
  }
  const meta = state.projects.find(m => m.id === projectId);
  const page = meta && homeProject(meta)?.pages.find(p => p.id === pageId);
  if (!page || !confirm(`Удалить страницу «${page.name}»?`)) return;
  await editClosedProject(projectId, p => {
    const pages = p.pages.filter(pg => pg.id !== pageId);
    return { ...p, pages: pages.length > 0 ? pages : [blankPage('Страница 1')] };
  });
  renderHome();
}

async function homeRenamePage(projectId: string, pageId: string, name: string): Promise<void> {
  if (state.project.id === projectId) {
    renamePage(pageId, name);
    await saveNow();
  } else {
    await editClosedProject(projectId, p => ({ ...p, pages: p.pages.map(pg => (pg.id === pageId ? { ...pg, name } : pg)) }));
  }
  renderHome();
}

async function homeMovePage(projectId: string, from: number, to: number): Promise<void> {
  if (state.project.id === projectId) {
    movePage(from, to);
    await saveNow();
  } else {
    await editClosedProject(projectId, p => ({ ...p, pages: moveItem(p.pages, from, to) }));
  }
  renderHome();
}

function homeKey(): string {
  return state.projects.map(m => `${m.id}:${m.name}:${m.updatedAt}:${m.pageCount}:${m.pinned ? 1 : 0}`).join('#') + `@${state.project.id}`;
}

/** Холст превью страницы: перерисовывается, только если содержимое или фон поменялись. */
function homeThumb(page: Page): HTMLCanvasElement {
  let entry = homeThumbs.get(page.id);
  if (!entry) {
    entry = { cv: document.createElement('canvas'), shot: null };
    homeThumbs.set(page.id, entry);
  }
  const t = entry;
  if (!t.shot || t.shot.elements !== page.elements || t.shot.grid !== page.grid) {
    const shot = { elements: page.elements, grid: page.grid };
    t.shot = shot;
    renderPageThumb(page, t.cv);
    // картинки неоткрытого проекта ещё грузятся — дорисуем, когда загрузятся
    void imagesLoaded(page.elements)?.then(() => { if (t.shot === shot) renderPageThumb(page, t.cv); });
  }
  return t.cv;
}

function renderHome(): void {
  // страницу тащат: перестроим список, когда её отпустят
  if (reordering()) { homeRenderPending = true; return; }
  homeRenderPending = false;
  const home = document.getElementById('home')!;
  const scroll = home.scrollTop;
  home.textContent = '';
  const head = document.createElement('div');
  head.className = 'home-head';
  const h = document.createElement('h1');
  h.textContent = 'Проекты';
  head.appendChild(h);
  home.appendChild(head);
  const pinned = state.projects.filter(m => m.pinned);
  const rest = state.projects.filter(m => !m.pinned);
  const seen = new Set<string>();
  if (pinned.length > 0) home.appendChild(homeSection('Избранное', pinned, false, seen));
  home.appendChild(homeSection(pinned.length > 0 ? 'Остальные проекты' : '', rest, true, seen));
  for (const id of homeThumbs.keys()) if (!seen.has(id)) homeThumbs.delete(id);
  home.scrollTop = scroll;
  loadHomeProjects();
}

/** Раздел домашней: заголовок (если есть) и сетка карточек проектов. */
function homeSection(title: string, metas: ProjectMeta[], withNew: boolean, seen: Set<string>): HTMLElement {
  const section = document.createElement('section');
  section.className = 'home-section';
  if (title) {
    const h = document.createElement('h2');
    h.className = 'home-section-title';
    h.textContent = title;
    section.appendChild(h);
  }
  const grid = document.createElement('div');
  grid.className = 'home-grid';
  for (const meta of metas) grid.appendChild(projectCard(meta, seen));
  if (withNew) {
    const newCard = document.createElement('button');
    newCard.className = 'new-project';
    newCard.textContent = '+ Новый проект';
    newCard.addEventListener('click', () => { void newProjectHandler(); });
    grid.appendChild(newCard);
  }
  section.appendChild(grid);
  return section;
}

function projectCard(meta: ProjectMeta, seen: Set<string>): HTMLElement {
  const card = document.createElement('div');
  card.className = 'project-card';
  card.classList.toggle('pinned', !!meta.pinned);
  card.classList.toggle('current', state.project.id === meta.id);
  const title = document.createElement('div');
  title.className = 'project-title';
  const pin = document.createElement('button');
  pin.className = 'project-pin';
  pin.title = meta.pinned ? 'Убрать из избранного' : 'Закрепить в избранном';
  pin.setAttribute('aria-pressed', String(!!meta.pinned));
  pin.innerHTML = ICONS.star;
  const name = document.createElement('span');
  name.className = 'project-name';
  name.textContent = meta.name;
  name.title = 'Двойной клик — переименовать';
  const openBtn = document.createElement('button');
  openBtn.className = 'project-open';
  openBtn.textContent = 'Открыть';
  const delBtn = document.createElement('button');
  delBtn.className = 'icon';
  delBtn.title = 'Удалить проект';
  delBtn.innerHTML = ICONS.trash;
  title.append(pin, name, openBtn, delBtn);
  const info = document.createElement('div');
  info.className = 'project-info';
  info.textContent = `Страниц: ${meta.pageCount} · ${new Date(meta.updatedAt).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`;
  const pages = document.createElement('div');
  pages.className = 'home-pages';
  const project = homeProject(meta);
  if (project) {
    project.pages.forEach((pg, i) => pages.appendChild(homePageTile(meta.id, project, pg, i, seen)));
    makeSortable(pages, {
      items: () => [...pages.querySelectorAll<HTMLElement>(':scope > .home-page')],
      scroller: document.getElementById('home')!,
      onEnd: (from, to) => {
        if (from !== to) void homeMovePage(meta.id, from, to);
        else if (homeRenderPending) renderHome();
      },
    });
  } else if (homeProjectFailed(meta)) {
    const hint = document.createElement('div');
    hint.className = 'home-pages-hint';
    hint.textContent = 'Не удалось загрузить страницы';
    pages.appendChild(hint);
  } else {
    // пока проект грузится — пустые плитки по числу страниц, чтобы карточка не прыгала
    for (let i = 0; i < meta.pageCount; i++) {
      const sk = document.createElement('div');
      sk.className = 'home-page skeleton';
      pages.appendChild(sk);
    }
  }
  const addPage = document.createElement('button');
  addPage.className = 'home-add-page';
  addPage.title = 'Новая страница';
  addPage.innerHTML = ICONS.plus;
  pages.appendChild(addPage);
  card.append(title, info, pages);
  pin.addEventListener('click', () => { void togglePinnedHandler(meta.id); });
  openBtn.addEventListener('click', () => { void openFromHome(meta.id); });
  name.addEventListener('dblclick', () => startProjectRename(card, meta.id, meta.name));
  delBtn.addEventListener('click', () => { void deleteProjectHandler(meta.id); });
  addPage.addEventListener('click', () => { void homeAddPage(meta.id); });
  return card;
}

/** Плитка страницы: превью, номер, фон и название; тянется для перестановки. */
function homePageTile(projectId: string, project: Project, pg: Page, i: number, seen: Set<string>): HTMLElement {
  seen.add(pg.id);
  const tile = document.createElement('div');
  tile.className = 'home-page';
  tile.classList.toggle('active', state.project.id === projectId && pg.id === state.pageId);
  const thumbBox = document.createElement('div');
  thumbBox.className = 'page-thumb';
  const num = document.createElement('span');
  num.className = 'page-num';
  num.textContent = String(i + 1);
  thumbBox.append(homeThumb(pg), num);
  const caption = document.createElement('div');
  caption.className = 'home-page-caption';
  const gi = document.createElement('span');
  gi.className = 'page-grid-icon';
  gi.innerHTML = GRID_ICONS[pg.grid];
  const pn = document.createElement('span');
  pn.className = 'home-page-name';
  pn.textContent = pg.name;
  pn.title = 'Двойной клик — переименовать';
  caption.append(gi, pn);
  const pd = document.createElement('button');
  pd.className = 'page-del';
  pd.title = 'Удалить страницу';
  pd.innerHTML = ICONS.del;
  tile.append(thumbBox, caption, pd);
  tile.title = `${pg.name} — открыть; перетащите, чтобы переставить`;
  // клик по названию ждёт: это может быть начало двойного клика (переименование)
  let openTimer = 0;
  tile.addEventListener('click', e => {
    if ((e.target as HTMLElement).closest('.page-del, input')) return;
    clearTimeout(openTimer);
    const delay = (e.target as HTMLElement).closest('.home-page-name') ? 300 : 0;
    openTimer = window.setTimeout(() => { void openFromHome(project.id, pg.id); }, delay);
  });
  pn.addEventListener('dblclick', e => {
    e.stopPropagation();
    clearTimeout(openTimer);
    startHomePageRename(tile, projectId, pg.id, pg.name);
  });
  pd.addEventListener('click', e => {
    e.stopPropagation();
    void homeDeletePage(projectId, pg.id);
  });
  return tile;
}

function startProjectRename(card: HTMLElement, projectId: string, oldName: string): void {
  const nameEl = card.querySelector('.project-name')!;
  const input = document.createElement('input');
  input.value = oldName;
  input.spellcheck = false;
  nameEl.replaceWith(input);
  input.focus();
  input.select();
  let done = false;
  const commit = () => {
    if (done) return;
    done = true;
    const v = input.value.trim();
    if (v && v !== oldName) void renameProjectHandler(projectId, v);
    else renderHome();
  };
  input.addEventListener('blur', commit);
  input.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Enter') commit();
    if (e.key === 'Escape') { done = true; renderHome(); }
  });
}

function startHomePageRename(tile: HTMLElement, projectId: string, pageId: string, oldName: string): void {
  const nameEl = tile.querySelector('.home-page-name')!;
  const input = document.createElement('input');
  input.value = oldName;
  input.spellcheck = false;
  nameEl.replaceWith(input);
  input.focus();
  input.select();
  let done = false;
  const commit = () => {
    if (done) return;
    done = true;
    const v = input.value.trim();
    if (v && v !== oldName) void homeRenamePage(projectId, pageId, v);
    else renderHome();
  };
  input.addEventListener('blur', commit);
  input.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Enter') commit();
    if (e.key === 'Escape') { done = true; renderHome(); }
  });
}

// ----- Тулбар -----

function buildToolbar(): void {
  const tb = document.getElementById('toolbar')!;
  tb.textContent = '';
  const tools = document.createElement('div');
  tools.className = 'tool-group';
  // порядок, группы и скрытые — из настройки панели (окно «Все настройки»)
  for (const item of toolbarConfig().items) {
    const b = document.createElement('button');
    b.className = 'tool';
    if (item.type === 'group') {
      if (item.tools.length === 0) continue;
      // группа инструментов: клик открывает панель выбора по центру этой кнопки
      const groupId = item.id;
      b.id = `btn-${groupId}`;
      b.dataset.ctx = groupId;
      b.dataset.tools = item.tools.join(' ');
      b.classList.add('tool-shapes');
      b.title = item.name;
      b.addEventListener('click', () => toggleCtxPanel(groupId, 'toolbar'));
    } else {
      const id = item.id;
      b.dataset.tool = id;
      b.title = toolTip(id);
      b.innerHTML = toolDef(id).icon;
      // панель стикеров открывается с этим инструментом и встаёт по центру его кнопки
      if (id === 'note') b.dataset.ctx = 'note';
      b.addEventListener('click', () => setTool(id));
    }
    tools.appendChild(b);
  }
  if (tools.childElementCount > 0) {
    tb.appendChild(tools);
    const sep = makeVsep();
    sep.classList.add('style-sep');
    tb.appendChild(sep);
  }

  // пресеты «цвет + толщина»: у пера и маркера три, у прочих инструментов один (лишние скрыты)
  const styleGroup = document.createElement('div');
  styleGroup.className = 'tool-group style-group';
  for (let i = 0; i < PRESET_SLOTS; i++) {
    const sBtn = document.createElement('button');
    sBtn.className = 'tool style-btn';
    sBtn.dataset.preset = String(i);
    sBtn.appendChild(styleIndicator(true));
    sBtn.addEventListener('click', () => {
      // клик по текущему пресету — панель цвета и толщины, по другому — выбор этого пресета
      if (state.presets[presetKind(state.tool)].active === i) toggleStylePanel('toolbar');
      else selectPreset(i);
    });
    styleGroup.appendChild(sBtn);
  }
  tb.appendChild(styleGroup);
}

const PRESET_SLOTS = 3;
/** Пресет, к которому сейчас относится панель стиля с тулбара: смена — панель пересобирается. */
let shownPresetKey = '';

/** Кнопки пресетов: видимость, подсветка текущего, якорь панели стиля (data-ctx) — у текущего. */
function syncPresetButtons(tb: HTMLElement): void {
  // инструментам без цвета (выделение, ластики, стикер…) пресеты не нужны — прячем вместе с разделителем
  const withStyle = toolUsesColor(state.tool);
  for (const e of tb.querySelectorAll<HTMLElement>('.style-group, .style-sep')) e.hidden = !withStyle;
  const kind = presetKind(state.tool);
  const set = state.presets[kind];
  const multi = set.list.length > 1;
  const title = kind === 'pen' ? 'Перо' : kind === 'highlighter' ? 'Маркер' : '';
  for (const b of tb.querySelectorAll<HTMLButtonElement>('.style-btn[data-preset]')) {
    const i = Number(b.dataset.preset);
    const preset = set.list[i];
    b.hidden = !preset;
    if (!preset) { delete b.dataset.ctx; b.removeAttribute('id'); continue; }
    const current = i === set.active;
    b.classList.toggle('current', multi && current);
    if (current) { b.dataset.ctx = 'style'; b.id = 'btn-style'; }
    else { delete b.dataset.ctx; b.removeAttribute('id'); }
    b.title = multi ? `${title}: пресет ${i + 1}${current ? ' — цвет и толщина' : ''}` : 'Цвет и толщина';
    // текущий показывает живой стиль (в т.ч. подхваченный из выделения)
    paintStyleIndicator(b.querySelector<HTMLElement>('.style-ind')!, true, current ? state.style : preset);
  }
  syncCtxButtons();
  const sp = panelOf('style');
  // кнопки пресетов спрятаны — пристыкованной к ним панели стоять не у чего
  if (!withStyle && sp?.source === 'toolbar' && !sp.detached) closePanel(sp);
  const key = `${kind}:${set.active}`;
  if (key === shownPresetKey) return;
  shownPresetKey = key;
  // панель стиля с тулбара переезжает к новому пресету и показывает его цвет и толщину
  if (sp && sp.source === 'toolbar') {
    if (sp.detached) rebuildStylePanel(sp);
    else if (withStyle) openCtxPanel('style', 'toolbar');
  }
}

function rebuildStylePanel(cp: CtxPanel): void {
  cp.el.textContent = '';
  buildStylePanel(cp);
  cp.el.appendChild(buildCtxBar(cp));
  cp.baseHeight = 0;
  positionCtxPanel(cp);
}

function makeVsep(): HTMLElement {
  const s = document.createElement('div');
  s.className = 'vsep';
  return s;
}

function wireTopbar(): void {
  // подсказки шапки из index.html: на macOS — Cmd вместо Ctrl
  for (const b of document.querySelectorAll<HTMLElement>('#topbar [title]')) b.title = macKeys(b.title);
  document.getElementById('btn-home')!.innerHTML = ICONS.home;
  document.getElementById('btn-undo')!.innerHTML = ICONS.undo;
  document.getElementById('btn-redo')!.innerHTML = ICONS.redo;
  document.getElementById('btn-fit')!.innerHTML = ICONS.fit;
  document.getElementById('btn-export')!.innerHTML = ICONS.export;
  document.getElementById('btn-present')!.innerHTML = ICONS.present;
  document.getElementById('btn-import')!.innerHTML = ICONS.pdf;
  document.getElementById('btn-image')!.innerHTML = ICONS.image;
  document.getElementById('btn-settings')!.innerHTML = ICONS.settings;
  document.getElementById('btn-share')!.innerHTML = svg('<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/>');
  document.getElementById('btn-share')!.addEventListener('click', () => { void openShareDialog(); });
  // guest-режим: скрываем недоступные функции
  if (collabActive() && !isHost()) {
    for (const id of ['btn-home', 'btn-import', 'btn-image', 'btn-share']) {
      document.getElementById(id)!.style.display = 'none';
    }
  }
  // сервер совместной работы живёт в main-процессе Electron: в браузере и на Android раздавать нечем
  if (!doskaApi) document.getElementById('btn-share')!.style.display = 'none';
  // окно демонстрации — второе окно браузера, в приложении для Android его не открыть
  if (isNativeApp()) document.getElementById('btn-present')!.style.display = 'none';

  document.getElementById('btn-home')!.addEventListener('click', () => {
    void (async () => {
      await saveNow();
      setView(state.view === 'home' ? 'board' : 'home');
    })();
  });
  document.getElementById('btn-undo')!.addEventListener('click', () => undo());
  document.getElementById('btn-redo')!.addEventListener('click', () => redo());
  document.getElementById('btn-fit')!.addEventListener('click', fitContent);
  document.getElementById('btn-export')!.addEventListener('click', () => { void exportPng(); });
  document.getElementById('btn-present')!.addEventListener('click', togglePresent);
  document.getElementById('btn-import')!.addEventListener('click', () => { void importPdf(); });
  document.getElementById('btn-settings')!.addEventListener('click', () => {
    if (settingsPopover().hidden) openSettings();
    else closeSettings();
  });

  const nameInput = document.getElementById('page-name') as HTMLInputElement;
  nameInput.addEventListener('change', () => {
    const v = nameInput.value.trim();
    if (v && v !== state.board.name) {
      renamePage(state.pageId, v);
      void saveNow();
    }
  });

  wireGridPicker();

  // закрытие панелей по клику мимо / Esc
  canvas.addEventListener('pointerdown', () => {
    closeCtxPanel();
    closeSettings();
  }, { capture: true });
  document.getElementById('canvas-wrap')!.addEventListener('pointerdown', e => {
    const t = e.target as HTMLElement;
    const d = dockedPanel();
    // кнопки-вызовы сами переключают панель по click; откреплённые панели кликом мимо не закрываются
    if (d && !d.el.contains(t) && !t.closest('[data-ctx]')) closePanel(d);
  }, { capture: true });
  window.addEventListener('resize', () => positionCtxPanels(true));
  window.addEventListener('keydown', e => {
    // Esc у открытого окна настроек закрывает только его
    if (settingsDialogOpen()) return;
    if (e.key === 'Escape') {
      // Esc закрывает только верхнее: выделение на доске (см. controller.ts) остаётся до следующего нажатия
      if (!gridMenu().hidden) { e.stopPropagation(); closeGridMenu(); gridButton().focus(); return; }
      if (!settingsPopover().hidden) { e.stopPropagation(); closeSettings(); return; }
      if (dockedPanel()) { e.stopPropagation(); closeCtxPanel(); return; }
    }
  }, { capture: true });
}

// ----- Масштаб в шапке: клик — ввод точного значения -----

function wireZoomInput(): void {
  const label = document.getElementById('zoom-label')!;
  label.addEventListener('click', () => openZoomInput(label));
}

/** Поле вместо подписи масштаба: Enter применяет (ошибку объясняет подсказка), Esc и уход из поля с ошибкой — отмена. */
function openZoomInput(label: HTMLElement): void {
  const box = document.createElement('span');
  box.className = 'zoom-edit';
  const input = document.createElement('input');
  input.id = 'zoom-input';
  input.inputMode = 'decimal';
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.maxLength = 8;
  input.setAttribute('aria-label', 'Масштаб, %');
  input.value = String(Math.round(state.camera.zoom * 100));
  const unit = document.createElement('span');
  unit.className = 'zoom-unit';
  unit.textContent = '%';
  const hint = document.createElement('div');
  hint.className = 'zoom-hint';
  hint.setAttribute('role', 'alert');
  hint.hidden = true;
  box.append(input, unit, hint);
  label.hidden = true;
  label.after(box);
  input.focus();
  input.select();
  /** Проверка введённого; пустое поле при наборе не ругаем — только при подтверждении. */
  const check = (strict: boolean): number | null => {
    const r = parseZoomPercent(input.value);
    const error = 'error' in r && (strict || input.value.trim() !== '') ? r.error : '';
    input.classList.toggle('invalid', !!error);
    input.setAttribute('aria-invalid', String(!!error));
    hint.textContent = error;
    hint.hidden = !error;
    return 'zoom' in r ? r.zoom : null;
  };
  let done = false;
  const close = (zoom: number | null) => {
    if (done) return;
    done = true;
    box.remove();
    label.hidden = false;
    if (zoom === null) return;
    // относительно центра холста, как кнопки + и −
    const r = canvas.getBoundingClientRect();
    zoomAtPoint(zoom, r.width / 2, r.height / 2);
  };
  input.addEventListener('input', () => check(false));
  input.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      e.preventDefault();
      const zoom = check(true);
      if (zoom !== null) close(zoom);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close(null);
    }
  });
  input.addEventListener('blur', () => close(check(true)));
}

/** Окно демонстрации: открыть или закрыть. */
export function togglePresent(): void {
  if (presentOpen()) { closePresent(); return; }
  if (!openPresent()) alert('Не удалось открыть окно демонстрации: разрешите всплывающие окна для этой страницы');
}

// ----- Совместная работа: диалог автора -----

interface ShareUser { userId: number; name: string; color: string; host?: boolean; away?: boolean; rights?: { default?: string; pages?: Record<string, string> } }
interface ShareStatus { active: boolean; url?: string; code?: string; port?: number; maxEditors?: number; users?: ShareUser[] }
interface ShareApi {
  shareStart(): Promise<{ ok: boolean; port?: number; code?: string; hostKey?: string }>;
  shareStop(): Promise<{ ok: boolean }>;
  shareStatus(): Promise<ShareStatus>;
  shareSetRights(uid: number, patch: { pages?: Record<string, string>; default?: string; all?: string }): Promise<{ ok: boolean; error?: string }>;
  shareOpenTestWindow(): Promise<{ ok: boolean }>;
}

async function collabApi(): Promise<ShareApi> {
  return (window as unknown as { doskaAPI?: ShareApi }).doskaAPI!;
}

let shareInfo: ShareStatus = { active: false };

async function openShareDialog(): Promise<void> {
  const api = await collabApi();
  let dlg = document.getElementById('share-dialog');
  if (dlg) { dlg.remove(); return; }
  dlg = document.createElement('div');
  dlg.id = 'share-dialog';
  document.body.appendChild(dlg);
  const render = async () => {
    const status = await api.shareStatus();
    shareInfo = status; void shareInfo; // доступно другим частям UI
    const users = (status.users || []).filter(u => !u.host);
    dlg!.textContent = '';
    const title = document.createElement('div');
    title.className = 'ctx-title';
    title.textContent = 'Совместная работа';
    dlg!.appendChild(title);
    if (!status.active) {
      const start = document.createElement('button');
      start.className = 'ctx-custom-btn';
      start.textContent = 'Включить совместную работу';
      start.addEventListener('click', async () => {
        const r = await api.shareStart();
        if (!r.ok || !r.port || !r.code || !r.hostKey) {
          alert((r as { error?: string }).error || 'Не удалось запустить сервер совместной работы');
          await render();
          return;
        }
        await saveNow();
        await startHostConnection(r.port, r.code, r.hostKey, 'Автор');
        await render();
      });
      dlg!.appendChild(start);
    } else {
      const link = document.createElement('div');
      link.className = 'share-link';
      link.textContent = status.url || '';
      link.title = 'Клик — скопировать ссылку';
      link.addEventListener('click', () => {
        void navigator.clipboard.writeText(status.url || '');
        link.textContent = 'Ссылка скопирована';
        setTimeout(() => { link.textContent = status.url || ''; }, 1200);
      });
      dlg!.appendChild(link);
      const testBtn = document.createElement('button');
      testBtn.className = 'ctx-custom-btn';
      testBtn.textContent = '+ Тестовое окно гостя';
      testBtn.addEventListener('click', () => { void api.shareOpenTestWindow(); });
      dlg!.appendChild(testBtn);
      const stopBtn = document.createElement('button');
      stopBtn.className = 'ctx-custom-btn danger';
      stopBtn.textContent = 'Выключить';
      stopBtn.addEventListener('click', async () => { await api.shareStop(); stopCollab(); await render(); });
      dlg!.appendChild(stopBtn);
      if (users.length > 0) {
        const h = document.createElement('div');
        h.className = 'ctx-label';
        h.textContent = `Участники (${users.length}) — права по страницам:`;
        dlg!.appendChild(h);
        const table = document.createElement('div');
        table.className = 'share-table';
        for (const u of users) {
          const row = document.createElement('div');
          row.className = 'share-user';
          const head = document.createElement('div');
          head.className = 'share-user-head';
          const dot = document.createElement('i');
          dot.style.background = u.away ? '#9aa0ab' : u.color;
          head.append(dot);
          const nm = document.createElement('span');
          nm.textContent = u.name + (u.away ? ' · Отошёл' : '');
          head.appendChild(nm);
          row.appendChild(head);
          for (const pg of state.project.pages) {
            const sel = document.createElement('select');
            const cur = u.rights?.pages?.[pg.id] || u.rights?.default || 'view';
            for (const [v, lbl] of [['view', 'Просмотр'], ['edit', 'Редактирование'], ['hidden', 'Скрыть']] as const) {
              const opt = document.createElement('option');
              opt.value = v;
              opt.textContent = `${pg.name}: ${lbl}`;
              if (cur === v) opt.selected = true;
              sel.appendChild(opt);
            }
            sel.addEventListener('change', async () => {
              const patch: Record<string, string> = {};
              patch[pg.id] = sel.value;
              const r = await api.shareSetRights(u.userId, { pages: patch });
              if (!r.ok) alert(r.error || 'Не удалось изменить права');
              await render();
            });
            row.appendChild(sel);
          }
          table.appendChild(row);
        }
        dlg!.appendChild(table);
      } else {
        const hint = document.createElement('div');
        hint.className = 'ctx-label';
        hint.textContent = 'Откройте ссылку на другом устройстве или в тестовом окне';
        dlg!.appendChild(hint);
      }
    }
    const close = document.createElement('button');
    close.className = 'ctx-custom-btn';
    close.textContent = 'Закрыть';
    close.addEventListener('click', () => dlg!.remove());
    dlg!.appendChild(close);
  };
  await render();
  // периодическое обновление списка участников, пока диалог открыт
  const timer = window.setInterval(() => {
    if (!document.getElementById('share-dialog')) { clearInterval(timer); return; }
    void render();
  }, 2000);
}

function refresh(): void {
  // совместный режим: скрываем тулбар на страницах без права edit
  if (collabActive() && !isHost()) {
    document.body.classList.toggle('readonly-mode', readOnly());
  }
  const tb = document.getElementById('toolbar')!;
  for (const b of tb.querySelectorAll<HTMLButtonElement>('.tool[data-tool]')) {
    b.classList.toggle('active', b.dataset.tool === state.tool);
  }
  for (const group of toolbarConfig().items) {
    if (group.type !== 'group' || group.tools.length === 0) continue;
    const active = group.tools.includes(state.tool);
    if (active) lastGroupTool[group.id] = state.tool;
    const btn = tb.querySelector<HTMLButtonElement>(`[data-ctx="${group.id}"]`);
    if (!btn) continue;
    btn.classList.toggle('active', active);
    // инструмент могли перенести в другую группу — тогда кнопка показывает первый
    const cur = group.tools.includes(lastGroupTool[group.id]) ? lastGroupTool[group.id] : group.tools[0];
    if (btn.dataset.shape !== cur) {
      btn.dataset.shape = cur;
      btn.innerHTML = toolDef(cur).icon;
      btn.title = `${group.name}: ${toolDef(cur).title}`;
    }
  }
  syncPresetButtons(tb);
  // панель стикеров открывается автоматически с инструментом (если стикер не скрыт с панели)
  const noteOnToolbar = !!tb.querySelector('[data-ctx="note"], [data-tools~="note"]');
  if (state.tool === 'note' && noteOnToolbar && !dockedPanel() && !panelOf('note') && state.view === 'board') openCtxPanel('note', 'toolbar');
  const notePanel = panelOf('note');
  if (state.tool !== 'note' && notePanel && !notePanel.detached) closePanel(notePanel);
  // откреплённые палитры инструментов подсвечивают текущий инструмент
  for (const b of ctxLayerEl().querySelectorAll<HTMLElement>('[data-shape]')) {
    b.classList.toggle('active', b.dataset.shape === state.tool);
  }
  ctxLayerEl().hidden = state.view !== 'board';

  document.getElementById('btn-present')!.classList.toggle('active', presentOpen());
  (document.getElementById('btn-undo') as HTMLButtonElement).disabled = !canUndo();
  (document.getElementById('btn-redo') as HTMLButtonElement).disabled = !canRedo();
  document.getElementById('zoom-label')!.textContent = `${Math.round(state.camera.zoom * 100)}%`;
  renderGridButton();
  const nameInput = document.getElementById('page-name') as HTMLInputElement;
  if (document.activeElement !== nameInput && nameInput.value !== state.board.name) {
    nameInput.value = state.board.name;
  }

  // вид домашней страницы
  const home = document.getElementById('home')!;
  const isHome = state.view === 'home';
  if (home.hidden === isHome) home.hidden = !isHome;
  if (isHome) {
    const hk = homeKey();
    if (hk !== lastHomeKey) {
      lastHomeKey = hk;
      renderHome();
    }
  }

  const key = pagesKey();
  if (key !== lastPagesKey) {
    lastPagesKey = key;
    renderPages();
  }
  updateQuickMenu();
  syncShapeCaret();
  syncFrameOff();
  syncThumbViewport();
}

/** Совместный режим: остальные участники видят рамку вокруг выделенного нами. */
function syncSelectionToCollab(): void {
  if (!collabActive()) return;
  const ids = [...state.selection];
  const key = `${state.pageId}:${ids.join(',')}`;
  if (key === lastSelectionKey) return;
  lastSelectionKey = key;
  noteSelection(ids);
}

export function initApp(c: HTMLCanvasElement): void {
  canvas = c;
  restoreStyle();
  restoreSettings();
  applyUiAnimations();
  applyUndoRedoVisibility();
  restoreToolbar();
  buildToolbar();
  applyToolbarPos();
  wireTopbar();
  wireZoomInput();
  wirePagesDock();
  wireImageInput();
  // курсор в выделенной фигуре прячется, пока набор идёт в поле ввода
  document.addEventListener('focusin', syncShapeCaret);
  document.addEventListener('focusout', () => queueMicrotask(syncShapeCaret));
  try { refresh(); } catch (err) { console.error('[doska] refresh failed:', err); }
  onToolbarChange(() => {
    buildToolbar();
    syncGroupPanels();
    refresh();
    positionCtxPanels(true);
  });
  onChange(() => {
    refresh();
    scheduleSave();
    syncSelectionToCollab();
    if (editing) positionEditor();
    if (ctxPanels.length) positionCtxPanels();
  });
}
