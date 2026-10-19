import type { Element, GridMode, ImageEl, NoteEl, Page, Project, TextEl, ToolId, ToolbarPos, WheelMode } from './types';
import {
  state, update, onChange, undo, redo, canUndo, canRedo, setTool, setGrid, setStyleColor,
  setStyleWidth, setNoteColor, addElement, replaceElements, pushHistory, uid,
  applyStyleToSelection, setSettings, setView, switchPage, addPage, deletePage, renamePage, setSelection,
  openProject, blankProject, projectMeta, groupSelected, ungroupSelected,
  bringForward, sendBackward, deleteSelected, setSolidSides,
} from './state';
import { storage } from './storage';
import { renderScene, contentBBox } from './renderer';
import { hasBaseSides, SIDES_MAX, SIDES_MIN, solidSides } from './solid';
import { elementAABB, NOTE_W, NOTE_H, NOTE_PAD, NOTE_FONT, NOTE_TEXT_COLOR, TEXT_SIZE } from './geom';
import * as pdfjsLib from 'pdfjs-dist';
// ?worker&inline: воркер инлайнится в бандл и работает из file:// (Electron)
import PdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?worker&inline';
import { collabActive, isHost, readOnly, startHostConnection, stopCollab } from './collab';

pdfjsLib.GlobalWorkerOptions.workerPort = new PdfWorker();

const svg = (paths: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

const ICONS = {
  home: svg('<path d="M3 11l9-8 9 8"/><path d="M5 10v10h5v-6h4v6h5V10"/>'),
  sidebar: svg('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M9 5v14"/>'),
  image: svg('<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10" r="1.5"/><path d="M21 15l-5-5L5 19"/>'),
  undo: svg('<path d="M4 10h9a5 5 0 0 1 0 10h-3"/><path d="M8 6l-4 4 4 4"/>'),
  redo: svg('<path d="M20 10h-9a5 5 0 0 0 0 10h3"/><path d="M16 6l4 4-4 4"/>'),
  fit: svg('<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/>'),
  export: svg('<path d="M12 3v12"/><path d="M8 11l4 4 4-4"/><path d="M4 19h16"/>'),
  pdf: svg('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M9 13h6M9 17h4"/>'),
  del: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  settings: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.1-1.55 1.7 1.7 0 0 0-1.88.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.55-1.1 1.7 1.7 0 0 0-.34-1.88l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34h.01a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55h.01a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v.01a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.55 1z"/>'),
  up: svg('<path d="M12 19V5"/><path d="M5 12l7-7 7 7"/>'),
  down: svg('<path d="M12 5v14"/><path d="M19 12l-7 7-7-7"/>'),
  group: svg('<rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="13" width="8" height="8" rx="1.5"/><path d="M11 11l2 2"/>'),
  ungroup: svg('<rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="13" width="8" height="8" rx="1.5"/><path d="M13 6h4M15 4v4M7 13v4M5 15h4"/>'),
  trash: svg('<path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 13h10l1-13"/>'),
};

const GRID_ICONS: Record<GridMode, string> = {
  none: svg('<circle cx="12" cy="12" r="8"/><path d="M6.5 17.5l11-11"/>'),
  dots: svg('<circle cx="6" cy="6" r="1.2"/><circle cx="12" cy="6" r="1.2"/><circle cx="18" cy="6" r="1.2"/><circle cx="6" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="18" cy="12" r="1.2"/><circle cx="6" cy="18" r="1.2"/><circle cx="12" cy="18" r="1.2"/><circle cx="18" cy="18" r="1.2"/>'),
  square: svg('<rect x="4" y="4" width="7" height="7"/><rect x="13" y="4" width="7" height="7"/><rect x="4" y="13" width="7" height="7"/><rect x="13" y="13" width="7" height="7"/>'),
  coord: svg('<path d="M5 19V5M5 19h14"/><path d="M5 5l-2 3M5 5l2 3M19 19l-3-2M19 19l-3 2"/><circle cx="12" cy="12" r="1"/>'),
};

const TOOLS: { id: ToolId; code: string; title: string; icon: string }[] = [
  { id: 'select', code: 'V', title: 'Выделение и перемещение', icon: svg('<path d="M5 3l15 8-6.4 1.7L11 20z"/>') },
  { id: 'pen', code: 'P', title: 'Перо', icon: svg('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>') },
  { id: 'highlighter', code: 'M', title: 'Маркер', icon: svg('<path d="M9 11l-6 6v3h3l6-6"/><path d="M17.5 2.5l4 4L11 17l-4-4z"/>') },
  { id: 'eraser', code: 'E', title: 'Ластик', icon: svg('<path d="M20 20H8.5L3.6 15.1a2 2 0 0 1 0-2.8l8.6-8.6a2 2 0 0 1 2.8 0l6 6a2 2 0 0 1 0 2.8L13.5 19"/><path d="M7 10.5l6.5 6.5"/>') },
  { id: 'text', code: 'T', title: 'Текст', icon: svg('<path d="M5 7V5h14v2"/><path d="M12 5v14"/><path d="M9 19h6"/>') },
  { id: 'note', code: 'N', title: 'Стикер', icon: svg('<rect x="4" y="5" width="16" height="14" rx="2"/><path d="M8 9.5h8"/><path d="M8 13h5"/>') },
  { id: 'rect', code: 'R', title: 'Фигуры', icon: '' }, // место группы «Фигуры»
  { id: 'cube', code: '', title: 'Стереометрия', icon: '' }, // место группы «Стереометрия»
  { id: 'pan', code: 'H', title: 'Панорама', icon: svg('<path d="M12 3v18M3 12h18"/><path d="M9.5 5.5L12 3l2.5 2.5M9.5 18.5L12 21l2.5-2.5M5.5 9.5L3 12l2.5 2.5M18.5 9.5L21 12l-2.5 2.5"/>') },
  { id: 'laser', code: 'I', title: 'Лазерная указка', icon: svg('<circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4"/>') },
];

/** Инструменты группы «Фигуры» — в тулбаре одна кнопка, выбор во всплывающей панели. */
const SHAPE_TOOLS: { id: ToolId; code: string; title: string; icon: string }[] = [
  { id: 'rect', code: 'R', title: 'Прямоугольник', icon: svg('<rect x="4" y="6" width="16" height="12" rx="1.5"/>') },
  { id: 'ellipse', code: 'O', title: 'Эллипс', icon: svg('<ellipse cx="12" cy="12" rx="8.5" ry="6.5"/>') },
  { id: 'triangle', code: 'Y', title: 'Треугольник', icon: svg('<path d="M12 4.5L20.5 19H3.5z"/>') },
  { id: 'line', code: 'L', title: 'Линия', icon: svg('<path d="M5 19L19 5"/>') },
  { id: 'arrow', code: 'A', title: 'Стрелка', icon: svg('<path d="M5 19L18 6"/><path d="M12 6h6v6"/>') },
  { id: 'poly', code: 'K', title: 'Ломаная / многоугольник', icon: svg('<path d="M4 18l5-10 6 7 5-9"/>') },
];
/** Невидимые линии на иконках тел — пунктиром, как на холсте. */
const hid = (d: string) => `<path d="${d}" stroke-dasharray="2.2 2" stroke-width="1.4"/>`;

/** Инструменты группы «Стереометрия»: каркасные тела с пунктиром невидимых рёбер. */
const SOLID_TOOLS: { id: ToolId; code: string; title: string; icon: string }[] = [
  { id: 'cube', code: '', title: 'Куб', icon: svg('<path d="M4 9h11v11H4z"/><path d="M4 9l5-5h11l-5 5M20 4v11l-5 5"/>' + hid('M9 4v11h11M4 20l5-5')) },
  { id: 'box', code: '', title: 'Параллелепипед', icon: svg('<path d="M2.5 11h14v9h-14z"/><path d="M2.5 11l5-5h14l-5 5M21.5 6v9l-5 5"/>' + hid('M7.5 6v9h14M2.5 20l5-5')) },
  { id: 'prism', code: '', title: 'Призма', icon: svg('<path d="M6 4h13l-10.5 4z"/><path d="M6 4v13l2.5 4L19 17V4M8.5 8v13"/>' + hid('M6 17h13')) },
  { id: 'pyramid', code: '', title: 'Пирамида', icon: svg('<path d="M3 20h12l5-5M3 20l8.5-17L15 20M11.5 3L20 15"/>' + hid('M20 15H8l-5 5M8 15l3.5-12')) },
  { id: 'truncPyramid', code: '', title: 'Усечённая пирамида', icon: svg('<path d="M6 8h7l3-3H9z"/><path d="M2 20h13l6-5M2 20L6 8M15 20L13 8M21 15L16 5"/>' + hid('M21 15H8l-6 5M8 15L9 5')) },
  { id: 'cylinder', code: '', title: 'Цилиндр', icon: svg('<ellipse cx="12" cy="5" rx="7" ry="2.5"/><path d="M5 5v14M19 5v14M5 19a7 2.5 0 0 0 14 0"/>' + hid('M5 19a7 2.5 0 0 1 14 0')) },
  { id: 'cone', code: '', title: 'Конус', icon: svg('<path d="M4 19L12 3l8 16M4 19a8 2.8 0 0 0 16 0"/>' + hid('M4 19a8 2.8 0 0 1 16 0')) },
  { id: 'truncCone', code: '', title: 'Усечённый конус', icon: svg('<ellipse cx="12" cy="6" rx="4" ry="1.5"/><path d="M8 6L4 19M16 6l4 13M4 19a8 2.8 0 0 0 16 0"/>' + hid('M4 19a8 2.8 0 0 1 16 0')) },
  { id: 'sphere', code: '', title: 'Шар', icon: svg('<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12a8.5 3 0 0 0 17 0"/>' + hid('M3.5 12a8.5 3 0 0 1 17 0')) },
];

/** Группы инструментов с одной кнопкой в тулбаре и выбором во всплывающей панели. */
type ToolGroupKind = 'shapes' | 'solids';
const TOOL_GROUPS: Record<ToolGroupKind, { title: string; tools: typeof SHAPE_TOOLS }> = {
  shapes: { title: 'Фигуры', tools: SHAPE_TOOLS },
  solids: { title: 'Стереометрия', tools: SOLID_TOOLS },
};
/** Последний выбранный инструмент группы — его иконку показывает кнопка группы. */
const lastGroupTool: Record<ToolGroupKind, ToolId> = { shapes: 'rect', solids: 'cube' };


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
  localStorage.setItem(STYLE_KEY, JSON.stringify({ ...state.style, noteColor: state.noteColor }));
}

function restoreStyle(): void {
  try {
    const v = JSON.parse(localStorage.getItem(STYLE_KEY) || 'null');
    if (v && typeof v.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(v.color) && typeof v.width === 'number') {
      state.style = { color: v.color, width: Math.min(14, Math.max(0.5, v.width)) };
    }
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
      };
    }
  } catch { /* дефолт */ }
}

function persistSettings(): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
}

/** Выбор цвета: применяется к выделению (если есть) и становится текущим. */
function chooseColor(c: string): void {
  if (state.selection.size > 0) applyStyleToSelection({ color: c });
  setStyleColor(c);
  persistStyle();
  // панель не пересобираем: живой HSV-пикер должен остаться на месте;
  // обновляем только активность свотчей
  if (ctxKind === 'style') updateSwatchActive(c);
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

/** Подсвечивает текущий цвет в открытой панели без её пересборки. */
function updateSwatchActive(current: string): void {
  for (const btn of ctxPanelEl().querySelectorAll<HTMLButtonElement>('.ctx-swatch[data-c]')) {
    btn.classList.toggle('active', btn.dataset.c === current);
  }
}

/** Выбор толщины: применяется к выделению (если есть) и становится текущей. */
function chooseWidth(w: number): void {
  const clamped = Math.min(14, Math.max(0.5, Math.round(w * 2) / 2));
  if (state.selection.size > 0) applyStyleToSelection({ width: clamped });
  setStyleWidth(clamped);
  persistStyle();
  refresh();
}

// ----- Редактор текста/стикеров (in-place) -----

interface Editing {
  el: TextEl | NoteEl | null;
  at: { x: number; y: number } | null;
  target: 'text' | 'note';
  ta: HTMLTextAreaElement;
}
let editing: Editing | null = null;

export function beginTextEdit(opts: { el?: TextEl | NoteEl; at?: { x: number; y: number }; target?: 'text' | 'note' }): void {
  closeEditor(true);
  const el = opts.el ?? null;
  const target: 'text' | 'note' = el ? (el.type === 'note' ? 'note' : 'text') : (opts.target ?? 'text');
  const ta = document.createElement('textarea');
  ta.rows = 1;
  ta.spellcheck = false;
  ta.className = target === 'note' ? 'inplace-edit note' : 'inplace-edit';
  if (el) {
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
  update();
  ta.focus();
  ta.setSelectionRange(ta.value.length, ta.value.length);
  ta.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); closeEditor(false); }
    else if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); closeEditor(true); }
    // Shift+Enter — перевод строки (стандартное поведение textarea)
  });
  ta.addEventListener('input', () => positionEditor());
  ta.addEventListener('blur', () => closeEditor(true));
}

function positionEditor(): void {
  const e = editing;
  if (!e) return;
  const cam = state.camera;
  const z = cam.zoom;
  const ta = e.ta;
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
    ta.style.width = '10px';
    ta.style.width = `${Math.max(60, ta.scrollWidth + 12)}px`;
  }
  ta.style.height = 'auto';
  ta.style.height = `${ta.scrollHeight + 2}px`;
}

export function closeEditor(commit: boolean): void {
  const e = editing;
  if (!e) return;
  editing = null;
  const text = e.ta.value.replace(/[ \t]+$/gm, '').replace(/\s+$/, '');
  e.ta.remove();
  state.hideElId = null;
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
    addElement({ id: uid(), type: 'text', x: e.at!.x, y: e.at!.y, text, size: TEXT_SIZE, color: state.style.color });
  } else if (liveNote) {
    addElement({ id: uid(), type: 'note', x: liveNote.x, y: liveNote.y, w: liveNote.w, h: liveNote.h, text, color: liveNote.color });
  }
}

// ----- Контекстная панель (цвет и толщина / стикеры) -----

type CtxKind = 'style' | 'note' | ToolGroupKind;
/** Откуда вызвана панель: с тулбара — встаёт сбоку по центру кнопки, из плавающего меню — под ним. */
type CtxSource = 'toolbar' | 'quick';
let ctxKind: CtxKind | null = null;
let ctxSource: CtxSource = 'toolbar';
/** Высота панели при открытии: центрируемся по ней, чтобы раскрытие пикера росло вниз, а не прыгало. */
let ctxBaseHeight = 0;
/** Панель перетащена за ручку: стоит, где оставили, и не закрывается кликом мимо. */
let ctxDetached = false;

const GRIP_ICON = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>';
const PIN_ICON = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M15.2 2.6a1 1 0 0 1 1.4 0l4.8 4.8a1 1 0 0 1 0 1.4l-.9.9a2 2 0 0 1-2.2.4l-2.6 2.6.3 3.5a1 1 0 0 1-.3.8l-1 1a1 1 0 0 1-1.4 0l-3.2-3.2-4.6 4.6a1 1 0 0 1-1.4-1.4l4.6-4.6-3.2-3.2a1 1 0 0 1 0-1.4l1-1a1 1 0 0 1 .8-.3l3.5.3 2.6-2.6a2 2 0 0 1 .4-2.2z"/></svg>';

function ctxPanelEl(): HTMLElement {
  return document.getElementById('ctx-panel')!;
}

export function closeCtxPanel(): void {
  ctxKind = null;
  setCtxDetached(false);
  ctxPanelEl().hidden = true;
  syncCtxButtons();
}

function openCtxPanel(kind: CtxKind, source: CtxSource): void {
  const p = ctxPanelEl();
  ctxKind = kind;
  ctxSource = source;
  ctxBaseHeight = 0;
  setCtxDetached(false);
  p.hidden = false;
  p.textContent = '';
  p.style.maxHeight = '';
  if (kind === 'style') buildStylePanel(p);
  else if (kind === 'note') buildNotePanel(p);
  else buildToolGroupPanel(p, kind);
  p.appendChild(buildCtxBar());
  positionCtxPanel();
  syncCtxButtons();
}

function setCtxDetached(v: boolean): void {
  ctxDetached = v;
  ctxPanelEl().classList.toggle('detached', v);
}

/** Правый верхний угол: ручка перетаскивания и pin, возвращающий панель к её кнопке-вызову. */
function buildCtxBar(): HTMLElement {
  const bar = document.createElement('div');
  bar.className = 'ctx-bar';
  const pin = document.createElement('button');
  pin.className = 'ctx-pin';
  pin.title = ctxSource === 'quick' ? 'Вернуть под меню выделения' : 'Вернуть к панели инструментов';
  pin.innerHTML = PIN_ICON;
  pin.addEventListener('click', () => {
    setCtxDetached(false);
    ctxBaseHeight = 0;
    positionCtxPanel();
  });
  const grip = document.createElement('div');
  grip.className = 'ctx-grip';
  grip.title = 'Перетащить';
  grip.innerHTML = GRIP_ICON;
  grip.addEventListener('pointerdown', e => {
    e.preventDefault();
    const p = ctxPanelEl();
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
      if (!ctxDetached) setCtxDetached(true);
      placeDetached(left0 + dx, top0 + dy);
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
  bar.append(pin, grip);
  return bar;
}

/** Ставит открепленную панель в точку, не выпуская её за пределы холста. */
function placeDetached(left: number, top: number): void {
  const p = ctxPanelEl();
  const wrap = document.getElementById('canvas-wrap')!;
  const margin = 8;
  p.style.maxHeight = `${wrap.clientHeight - margin * 2}px`;
  p.style.left = `${Math.max(margin, Math.min(left, wrap.clientWidth - p.offsetWidth - margin))}px`;
  p.style.top = `${Math.max(margin, Math.min(top, wrap.clientHeight - p.offsetHeight - margin))}px`;
}

function toggleStylePanel(source: CtxSource): void {
  if (ctxKind === 'style' && ctxSource === source) closeCtxPanel();
  else openCtxPanel('style', source);
}

/** Кнопка-вызов подсвечена, пока её панель открыта. */
function syncCtxButtons(): void {
  document.getElementById('btn-style')?.classList.toggle('active', ctxKind === 'style' && ctxSource === 'toolbar');
  quickMenuEl().querySelector('[data-ctx="style"]')?.classList.toggle('active', ctxKind === 'style' && ctxSource === 'quick');
}

/** Элемент, вызвавший панель (кнопка тулбара или плавающего меню). */
function ctxAnchor(): HTMLElement | null {
  const host = ctxSource === 'quick' ? quickMenuEl() : document.getElementById('toolbar')!;
  if (host.hidden) return null;
  return host.querySelector<HTMLElement>(`[data-ctx="${ctxKind}"]`);
}

function positionCtxPanel(): void {
  if (!ctxKind) return;
  const p = ctxPanelEl();
  // откреплённая панель живёт сама по себе: только держим её в пределах холста
  if (ctxDetached) { placeDetached(p.offsetLeft, p.offsetTop); return; }
  const ar = ctxAnchor()?.getBoundingClientRect();
  if (!ar || ar.width === 0) { closeCtxPanel(); return; }
  const wr = document.getElementById('canvas-wrap')!.getBoundingClientRect();
  const gap = 10;
  const margin = 8;
  // естественная высота без max-height: прокручиваемая часть целиком
  const scroller = p.querySelector<HTMLElement>('.ctx-scroll');
  const natural = scroller ? p.offsetHeight - scroller.clientHeight + scroller.scrollHeight : p.offsetHeight;
  if (!ctxBaseHeight) ctxBaseHeight = natural;
  const w = p.offsetWidth;
  const ax = ar.left + ar.width / 2 - wr.left;
  const ay = ar.top + ar.height / 2 - wr.top;
  let left = ax - w / 2;
  let top: number;
  let maxH: number;
  if (ctxSource === 'quick') {
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
      top = ay - Math.min(ctxBaseHeight, maxH) / 2;
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

function buildToolGroupPanel(p: HTMLElement, kind: ToolGroupKind): void {
  const group = TOOL_GROUPS[kind];
  // панели групп оформлены одинаково (data-kind='shapes'), различаются набором кнопок
  p.dataset.kind = 'shapes';
  const title = document.createElement('div');
  title.className = 'ctx-title';
  title.textContent = group.title;
  p.appendChild(title);
  const grid = document.createElement('div');
  grid.className = 'ctx-shapes';
  for (const t of group.tools) {
    const b = document.createElement('button');
    b.className = 'tool' + (state.tool === t.id ? ' active' : '');
    b.title = t.code ? `${t.title} (${t.code})` : t.title;
    b.innerHTML = t.icon;
    b.dataset.shape = t.id;
    b.addEventListener('click', () => {
      setTool(t.id);
      // откреплённая панель работает как палитра фигур — остаётся открытой
      if (!ctxDetached) { closeCtxPanel(); return; }
      for (const x of grid.querySelectorAll<HTMLElement>('[data-shape]')) {
        x.classList.toggle('active', x.dataset.shape === t.id);
      }
    });
    grid.appendChild(b);
  }
  p.appendChild(grid);
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
  const grid = ctxPanelEl().querySelector<HTMLElement>('.ctx-swatches.custom');
  if (!grid) return;
  grid.textContent = '';
  const list = loadCustomColors();
  for (const c of list) grid.appendChild(makeSwatch(c, c === state.style.color, chooseColor));
  grid.hidden = list.length === 0;
}

/** Толщина нужна с тулбара и для выделенных линий/фигур (у текста и стикеров её нет). */
function styleNeedsWidth(): boolean {
  if (ctxSource === 'toolbar') return true;
  return state.board.elements.some(e =>
    state.selection.has(e.id) && (e.type === 'stroke' || e.type === 'shape' || e.type === 'poly' || e.type === 'solid'));
}

/** Единая панель в духе Miro: слайдер толщины сверху, ниже свои и все цвета. */
function buildStylePanel(p: HTMLElement): void {
  p.dataset.kind = 'style';
  // текущий цвет не из палитры (старая палитра, чужой элемент) — сразу в «Мои цвета»
  addCustomColor(state.style.color);
  if (styleNeedsWidth()) {
    const sliderHost = document.createElement('div');
    sliderHost.className = 'ctx-drop-slider';
    sliderHost.title = 'Толщина';
    buildDropSlider(sliderHost, state.style.width, v => chooseWidth(v));
    p.appendChild(sliderHost);
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
    positionCtxPanel();
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

/** Слайдер формы капли: слева узко, справа широко; ручка растёт с толщиной. */
function buildDropSlider(host: HTMLElement, initial: number, onChange: (v: number) => void): void {
  host.textContent = '';
  let value = Math.min(WIDTH_MAX, Math.max(WIDTH_MIN, initial));
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
    if (emit) onChange(Math.round(value * 2) / 2);
  };
  const pointToValue = (e: PointerEvent) => {
    const r = track.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    value = WIDTH_MIN + frac * (WIDTH_MAX - WIDTH_MIN);
    apply(true);
  };
  track.addEventListener('pointerdown', e => {
    track.setPointerCapture(e.pointerId);
    pointToValue(e);
  });
  track.addEventListener('pointermove', e => {
    if (e.buttons > 0) pointToValue(e);
  });
  apply(false);
}

/** Индикатор «цвет + толщина» как в Miro: кружок, внутри точка текущего цвета, её размер — толщина. */
function styleIndicator(withWidth: boolean): HTMLElement {
  const ring = document.createElement('i');
  ring.className = 'style-ind';
  ring.appendChild(document.createElement('b'));
  paintStyleIndicator(ring, withWidth);
  return ring;
}

function paintStyleIndicator(ring: HTMLElement, withWidth: boolean): void {
  const dot = ring.firstElementChild as HTMLElement;
  // у элементов толщина бывает больше максимума слайдера — точка не должна вылезать из кольца
  const frac = Math.max(0, Math.min(1, (state.style.width - WIDTH_MIN) / (WIDTH_MAX - WIDTH_MIN)));
  const d = withWidth ? Math.round(7 + frac * 9) : 14;
  dot.style.width = `${d}px`;
  dot.style.height = `${d}px`;
  dot.style.background = state.style.color;
}

function buildNotePanel(p: HTMLElement): void {
  p.dataset.kind = 'note';
  p.appendChild(sectionHead('Цвет стикера'));
  const grid = document.createElement('div');
  grid.className = 'ctx-swatches';
  for (const c of NOTE_PASTELS) {
    grid.appendChild(makeSwatch(c, c === state.noteColor, () => {
      setNoteColor(c);
      persistStyle();
      updateSwatchActive(c);
    }));
  }
  p.appendChild(grid);
}

// ----- Плавающее меню быстрых настроек выделения -----

function quickMenuEl(): HTMLElement {
  return document.getElementById('quick-menu')!;
}

function canChangeLayer(): boolean {
  const arr = state.board.elements;
  for (let i = 0; i < arr.length; i++) {
    const sel = state.selection.has(arr[i].id);
    if (i > 0 && sel && !state.selection.has(arr[i - 1].id)) return true;
    if (i < arr.length - 1 && sel && !state.selection.has(arr[i + 1].id)) return true;
  }
  return false;
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
  // цвет и толщина — одна кнопка и одна панель; толщина — только для «линейных» элементов
  const hasInk = selEls.some(e => e.type === 'stroke' || e.type === 'shape' || e.type === 'poly' || e.type === 'solid');
  const sBtn = document.createElement('button');
  sBtn.className = 'qm-btn qm-style' + (ctxKind === 'style' && ctxSource === 'quick' ? ' active' : '');
  sBtn.dataset.ctx = 'style';
  sBtn.title = hasInk ? 'Цвет и толщина' : 'Цвет';
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
  if (state.board.elements.length > 1 && canChangeLayer()) {
    const up = document.createElement('button');
    up.className = 'qm-btn';
    up.title = 'Выше (слой)';
    up.innerHTML = ICONS.up;
    up.addEventListener('click', () => { bringForward(); });
    const down = document.createElement('button');
    down.className = 'qm-btn';
    down.title = 'Ниже (слой)';
    down.innerHTML = ICONS.down;
    down.addEventListener('click', () => { sendBackward(); });
    qm.append(up, down);
  }
  // группы
  const sel = state.board.elements.filter(e => state.selection.has(e.id));
  const allGrouped = sel.length > 0 && sel.every(e => e.groupId === sel[0].groupId && e.groupId);
  if (state.selection.size >= 2 && !allGrouped) {
    const g = document.createElement('button');
    g.className = 'qm-btn';
    g.title = 'Сгруппировать (Ctrl+G)';
    g.innerHTML = ICONS.group;
    g.addEventListener('click', () => { groupSelected(); });
    qm.appendChild(g);
  }
  if (allGrouped) {
    const ug = document.createElement('button');
    ug.className = 'qm-btn';
    ug.title = 'Разгруппировать (Ctrl+Shift+G)';
    ug.innerHTML = ICONS.ungroup;
    ug.addEventListener('click', () => { ungroupSelected(); });
    qm.appendChild(ug);
  }
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
      openSettings();
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
      openSettings();
    });
    wheelRow.appendChild(b);
  }
  pop.appendChild(wheelRow);
  const btn = document.getElementById('btn-settings')!;
  const br = btn.getBoundingClientRect();
  pop.style.left = `${Math.max(8, br.right - 260)}px`;
  pop.style.top = `${br.bottom + 8}px`;
}

function applyToolbarPos(): void {
  const tb = document.getElementById('toolbar')!;
  tb.dataset.pos = state.settings.toolbarPos;
  positionCtxPanel();
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
  const name = `${state.project.name.trim() || 'doska'} — ${state.board.name.trim() || 'стр'}.png`;
  const api = (window as { doskaAPI?: { exportPng(d: string, n: string): Promise<boolean> } }).doskaAPI;
  if (api) {
    await api.exportPng(dataUrl, name);
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
    setSelection([el.id]);
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

function wireImageInput(): void {
  document.getElementById('btn-image')!.addEventListener('click', () => { void insertImage(); });
  // Ctrl+V из буфера обмена
  document.addEventListener('paste', e => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const it of items) {
      if (it.kind === 'file' && it.type.startsWith('image/')) {
        const f = it.getAsFile();
        if (f) {
          e.preventDefault();
          void fileToDataUrl(f).then(d => { if (d) insertImageFromDataUrl(d); });
          return;
        }
      }
    }
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

// ----- Страницы и проекты -----

async function switchPageHandler(pageId: string): Promise<void> {
  if (pageId === state.pageId || state.view !== 'board') return;
  await saveNow();
  switchPage(pageId);
  refresh();
  fitContent();
}

async function newPageHandler(): Promise<void> {
  await saveNow();
  addPage();
  refresh();
  fitContent();
}

async function deletePageHandler(pageId: string): Promise<void> {
  const page = state.project.pages.find(p => p.id === pageId);
  if (!page || !confirm(`Удалить страницу «${page.name}»?`)) return;
  await saveNow();
  deletePage(pageId);
  refresh();
  fitContent();
}

async function renamePageHandler(pageId: string, name: string): Promise<void> {
  renamePage(pageId, name);
  await saveNow();
}

/** Мини-превью страницы: вписывает содержимое в карточку. */
function renderPageThumb(page: Page, cv: HTMLCanvasElement): void {
  const W = 148;
  const H = 92;
  cv.width = W * 2;
  cv.height = H * 2;
  cv.style.width = `${W}px`;
  cv.style.height = `${H}px`;
  const c = cv.getContext('2d');
  if (!c) return;
  if (page.elements.length === 0) {
    renderScene(c, [], { x: -W / 2, y: -H / 2, zoom: 1 }, W, H, 2, 'none');
    return;
  }
  const bb = contentBBox(page.elements);
  const zoom = Math.max(0.02, Math.min(1, Math.min(W / (bb.w + 40), H / (bb.h + 40))));
  const cam = {
    zoom,
    x: bb.x0 + bb.w / 2 - W / (2 * zoom),
    y: bb.y0 + bb.h / 2 - H / (2 * zoom),
  };
  renderScene(c, page.elements, cam, W, H, 2, page.grid === 'coord' ? 'none' : page.grid);
}

function pagesKey(): string {
  return [
    state.project.id,
    state.pageId,
    state.projects.length,
    state.project.updatedAt,
    state.project.pages.map(p => `${p.id}:${p.name}:${p.grid}:${p.elements.length}`).join('|'),
  ].join('#');
}

function renderPages(): void {
  try {
  const list = document.getElementById('pages-list')!;
  list.textContent = '';
  document.getElementById('sidebar-project')!.textContent = state.project.name;
  for (const page of state.project.pages) {
    const item = document.createElement('div');
    item.className = `page-item${page.id === state.pageId ? ' active' : ''}`;
    const thumb = document.createElement('canvas');
    renderPageThumb(page, thumb);
    const row = document.createElement('div');
    row.className = 'page-row';
    const gicon = document.createElement('span');
    gicon.className = 'page-grid-icon';
    gicon.innerHTML = GRID_ICONS[page.grid];
    gicon.title = 'Фон страницы';
    const name = document.createElement('span');
    name.className = 'page-name';
    name.textContent = page.name;
    name.title = 'Двойной клик — переименовать';
    const del = document.createElement('button');
    del.className = 'page-del';
    del.title = 'Удалить страницу';
    del.innerHTML = ICONS.del;
    row.append(gicon, name, del);
    item.append(thumb, row);
    item.addEventListener('click', e => {
      if ((e.target as HTMLElement).closest('.page-del')) return;
      void switchPageHandler(page.id);
    });
    name.addEventListener('dblclick', () => startPageRename(item, page.id, page.name));
    del.addEventListener('click', e => {
      e.stopPropagation();
      void deletePageHandler(page.id);
    });
    list.appendChild(item);
  }
  } catch (err) { console.error('[doska] renderPages failed:', err); }
}

function startPageRename(item: HTMLElement, pageId: string, oldName: string): void {
  const nameEl = item.querySelector('.page-name')!;
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
    if (v && v !== oldName) void renamePageHandler(pageId, v);
    else renderPages();
  };
  input.addEventListener('blur', commit);
  input.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Enter') commit();
    if (e.key === 'Escape') { done = true; renderPages(); }
  });
}

// ----- Домашняя страница: проекты -----

async function openProjectHandler(project: Project, pageId?: string): Promise<void> {
  await saveNow();
  openProject(project, pageId);
  localStorage.setItem('doska.last', JSON.stringify({ pid: project.id, pageId: state.pageId }));
  refresh();
  fitContent();
}

async function newProjectHandler(): Promise<void> {
  await saveNow();
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
  state.projects = state.projects.filter(m => m.id !== id);
  if (state.project.id === id) {
    if (state.projects.length > 0) {
      const p = await storage.load(state.projects[0].id);
      if (p) { openProject(p); fitContent(); }
    } else {
      const p = blankProject('Проект 1');
      await storage.save(p);
      state.projects = [projectMeta(p)];
      openProject(p);
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
    const p = await storage.load(id);
    if (p) {
      p.name = name;
      await storage.save(p);
    }
  }
  renderHome();
  renderPages();
}

async function homeAddPage(projectId: string): Promise<void> {
  const p = state.project.id === projectId
    ? state.project
    : await storage.load(projectId);
  if (!p) return;
  if (state.project.id === projectId) {
    await saveNow();
    addPage();
    await saveNow();
  } else {
    p.pages = [...p.pages, { id: uid(), name: `Страница ${p.pages.length + 1}`, grid: 'square', elements: [] }];
    p.updatedAt = Date.now();
    await storage.save(p);
    state.projects = state.projects.map(m => (m.id === projectId ? { ...m, pageCount: p.pages.length, updatedAt: p.updatedAt } : m));
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
  const p = await storage.load(projectId);
  if (!p || p.pages.length <= 1) return;
  p.pages = p.pages.filter(pg => pg.id !== pageId);
  p.updatedAt = Date.now();
  await storage.save(p);
  state.projects = state.projects.map(m => (m.id === projectId ? { ...m, pageCount: p.pages.length, updatedAt: p.updatedAt } : m));
  renderHome();
}

async function homeRenamePage(projectId: string, pageId: string, name: string): Promise<void> {
  if (state.project.id === projectId) {
    renamePage(pageId, name);
    await saveNow();
    renderHome();
    return;
  }
  const p = await storage.load(projectId);
  if (!p) return;
  p.pages = p.pages.map(pg => (pg.id === pageId ? { ...pg, name } : pg));
  p.updatedAt = Date.now();
  await storage.save(p);
  renderHome();
}

function homeKey(): string {
  return state.projects.map(m => `${m.id}:${m.name}:${m.updatedAt}:${m.pageCount}`).join('#') + `@${state.project.id}`;
}

function renderHome(): void {
  const home = document.getElementById('home')!;
  home.textContent = '';
  const head = document.createElement('div');
  head.className = 'home-head';
  const h = document.createElement('h1');
  h.textContent = 'Проекты';
  head.appendChild(h);
  home.appendChild(head);
  const grid = document.createElement('div');
  grid.className = 'home-grid';
  for (const meta of state.projects) {
    const card = document.createElement('div');
    card.className = 'project-card';
    const title = document.createElement('div');
    title.className = 'project-title';
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
    title.append(name, openBtn, delBtn);
    const info = document.createElement('div');
    info.className = 'project-info';
    info.textContent = `Страниц: ${meta.pageCount} · ${new Date(meta.updatedAt).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`;
    const pages = document.createElement('div');
    pages.className = 'project-pages';
    if (state.project.id === meta.id) {
      for (const pg of state.project.pages) {
        const row = document.createElement('div');
        row.className = 'home-page-row';
        const gi = document.createElement('span');
        gi.className = 'page-grid-icon';
        gi.innerHTML = GRID_ICONS[pg.grid];
        const pn = document.createElement('span');
        pn.className = 'home-page-name';
        pn.textContent = pg.name;
        pn.title = 'Двойной клик — переименовать';
        const pd = document.createElement('button');
        pd.className = 'page-del';
        pd.title = 'Удалить страницу';
        pd.innerHTML = ICONS.del;
        row.append(gi, pn, pd);
        row.addEventListener('click', () => { void openProjectHandler(state.project, pg.id); });
        pn.addEventListener('dblclick', e => {
          e.stopPropagation();
          startHomePageRename(row, meta.id, pg.id, pg.name);
        });
        pd.addEventListener('click', e => {
          e.stopPropagation();
          void homeDeletePage(meta.id, pg.id);
        });
        pages.appendChild(row);
      }
    } else {
      const hint = document.createElement('div');
      hint.className = 'home-pages-hint';
      hint.textContent = 'Откройте проект, чтобы управлять страницами';
      pages.appendChild(hint);
    }
    const addPage = document.createElement('button');
    addPage.className = 'home-add-page';
    addPage.textContent = '+ Страница';
    card.append(title, info, pages, addPage);
    openBtn.addEventListener('click', () => {
      void (async () => {
        const p = state.project.id === meta.id ? state.project : await storage.load(meta.id);
        if (p) await openProjectHandler(p);
      })();
    });
    name.addEventListener('dblclick', () => startProjectRename(card, meta.id, meta.name));
    delBtn.addEventListener('click', () => { void deleteProjectHandler(meta.id); });
    addPage.addEventListener('click', () => { void homeAddPage(meta.id); });
    grid.appendChild(card);
  }
  const newCard = document.createElement('button');
  newCard.className = 'new-project';
  newCard.textContent = '+ Новый проект';
  newCard.addEventListener('click', () => { void newProjectHandler(); });
  grid.appendChild(newCard);
  home.appendChild(grid);
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

function startHomePageRename(row: HTMLElement, projectId: string, pageId: string, oldName: string): void {
  const nameEl = row.querySelector('.home-page-name')!;
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
  for (const t of TOOLS) {
    const b = document.createElement('button');
    b.className = 'tool';
    const groupKind: ToolGroupKind | null = t.id === 'rect' ? 'shapes' : t.id === 'cube' ? 'solids' : null;
    if (groupKind) {
      // группа инструментов: клик открывает панель выбора по центру этой кнопки
      b.id = `btn-${groupKind}`;
      b.dataset.ctx = groupKind;
      b.classList.add('tool-shapes');
      b.title = TOOL_GROUPS[groupKind].title;
      b.addEventListener('click', () => {
        if (ctxKind === groupKind) closeCtxPanel();
        else openCtxPanel(groupKind, 'toolbar');
      });
    } else {
      b.dataset.tool = t.id;
      b.title = `${t.title} (${t.code})`;
      b.innerHTML = t.icon;
      // панель стикеров открывается с этим инструментом и встаёт по центру его кнопки
      if (t.id === 'note') b.dataset.ctx = 'note';
      b.addEventListener('click', () => setTool(t.id));
    }
    tools.appendChild(b);
  }
  tb.appendChild(tools);
  tb.appendChild(makeVsep());

  const styleGroup = document.createElement('div');
  styleGroup.className = 'tool-group';
  const sBtn = document.createElement('button');
  sBtn.className = 'tool style-btn';
  sBtn.id = 'btn-style';
  sBtn.dataset.ctx = 'style';
  sBtn.title = 'Цвет и толщина';
  sBtn.appendChild(styleIndicator(true));
  sBtn.addEventListener('click', () => toggleStylePanel('toolbar'));
  styleGroup.appendChild(sBtn);
  tb.appendChild(styleGroup);
}

function makeVsep(): HTMLElement {
  const s = document.createElement('div');
  s.className = 'vsep';
  return s;
}

function wireTopbar(): void {
  document.getElementById('btn-home')!.innerHTML = ICONS.home;
  document.getElementById('btn-sidebar')!.innerHTML = ICONS.sidebar;
  document.getElementById('btn-undo')!.innerHTML = ICONS.undo;
  document.getElementById('btn-redo')!.innerHTML = ICONS.redo;
  document.getElementById('btn-fit')!.innerHTML = ICONS.fit;
  document.getElementById('btn-export')!.innerHTML = ICONS.export;
  document.getElementById('btn-import')!.innerHTML = ICONS.pdf;
  document.getElementById('btn-settings')!.innerHTML = ICONS.settings;
  document.getElementById('btn-share')!.innerHTML = svg('<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/>');
  document.getElementById('btn-share')!.addEventListener('click', () => { void openShareDialog(); });
  // guest-режим: скрываем недоступные функции
  if (collabActive() && !isHost()) {
    for (const id of ['btn-home', 'btn-import', 'btn-image', 'btn-share']) {
      document.getElementById(id)!.style.display = 'none';
    }
  }

  document.getElementById('btn-home')!.addEventListener('click', () => {
    void (async () => {
      await saveNow();
      setView(state.view === 'home' ? 'board' : 'home');
    })();
  });
  document.getElementById('btn-sidebar')!.addEventListener('click', toggleSidebar);
  document.getElementById('btn-undo')!.addEventListener('click', () => undo());
  document.getElementById('btn-redo')!.addEventListener('click', () => redo());
  document.getElementById('btn-fit')!.addEventListener('click', fitContent);
  document.getElementById('btn-export')!.addEventListener('click', () => { void exportPng(); });
  document.getElementById('btn-import')!.addEventListener('click', () => { void importPdf(); });
  document.getElementById('btn-settings')!.addEventListener('click', () => {
    if (settingsPopover().hidden) openSettings();
    else closeSettings();
  });
  document.getElementById('btn-new-page')!.addEventListener('click', () => { void newPageHandler(); });

  const nameInput = document.getElementById('page-name') as HTMLInputElement;
  nameInput.addEventListener('change', () => {
    const v = nameInput.value.trim();
    if (v && v !== state.board.name) {
      renamePage(state.pageId, v);
      void saveNow();
    }
  });

  const gridSelect = document.getElementById('grid-mode') as HTMLSelectElement;
  gridSelect.addEventListener('change', () => {
    setGrid(gridSelect.value as GridMode);
    void saveNow();
  });

  // закрытие панелей по клику мимо / Esc
  canvas.addEventListener('pointerdown', () => {
    if (!ctxDetached) closeCtxPanel();
    closeSettings();
  }, { capture: true });
  document.getElementById('canvas-wrap')!.addEventListener('pointerdown', e => {
    const t = e.target as HTMLElement;
    const p = ctxPanelEl();
    // кнопки-вызовы сами переключают панель по click; откреплённая панель кликом мимо не закрывается
    if (!p.hidden && !ctxDetached && !p.contains(t) && !t.closest('[data-ctx]')) closeCtxPanel();
  }, { capture: true });
  window.addEventListener('resize', () => positionCtxPanel());
  window.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if (!settingsPopover().hidden) { closeSettings(); return; }
      if (ctxKind) { closeCtxPanel(); return; }
    }
  }, { capture: true });
}

export function toggleSidebar(): void {
  document.getElementById('sidebar')!.classList.toggle('hidden');
}

// ----- Совместная работа: диалог автора -----

interface ShareUser { userId: number; name: string; color: string; host?: boolean; away?: boolean; rights?: { default?: string; pages?: Record<string, string> } }
interface ShareStatus { active: boolean; url?: string; code?: string; port?: number; maxEditors?: number; users?: ShareUser[] }
interface ShareApi {
  shareStart(): Promise<{ ok: boolean; port?: number; code?: string }>;
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
        if (!r.ok || !r.port || !r.code) {
          alert((r as { error?: string }).error || 'Не удалось запустить сервер совместной работы');
          await render();
          return;
        }
        await saveNow();
        await startHostConnection(r.port, r.code, 'Автор');
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
  for (const kind of Object.keys(TOOL_GROUPS) as ToolGroupKind[]) {
    const group = TOOL_GROUPS[kind];
    const active = group.tools.find(t => t.id === state.tool);
    if (active) lastGroupTool[kind] = active.id;
    const btn = tb.querySelector<HTMLButtonElement>(`#btn-${kind}`);
    if (!btn) continue;
    btn.classList.toggle('active', !!active);
    if (btn.dataset.shape !== lastGroupTool[kind]) {
      const cur = group.tools.find(t => t.id === lastGroupTool[kind])!;
      btn.dataset.shape = cur.id;
      btn.innerHTML = cur.icon;
      btn.title = `${group.title}: ${cur.title}`;
    }
  }
  const styleInd = tb.querySelector<HTMLElement>('#btn-style .style-ind');
  if (styleInd) paintStyleIndicator(styleInd, true);
  // панель стикеров открывается автоматически с инструментом
  if (state.tool === 'note' && !ctxKind && state.view === 'board') openCtxPanel('note', 'toolbar');
  if (state.tool !== 'note' && ctxKind === 'note') closeCtxPanel();

  (document.getElementById('btn-undo') as HTMLButtonElement).disabled = !canUndo();
  (document.getElementById('btn-redo') as HTMLButtonElement).disabled = !canRedo();
  document.getElementById('zoom-label')!.textContent = `${Math.round(state.camera.zoom * 100)}%`;
  const gridSelect = document.getElementById('grid-mode') as HTMLSelectElement;
  if (gridSelect.value !== state.board.grid) gridSelect.value = state.board.grid;
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
}

export function initApp(c: HTMLCanvasElement): void {
  canvas = c;
  restoreStyle();
  restoreSettings();
  buildToolbar();
  applyToolbarPos();
  wireTopbar();
  wireImageInput();
  try { refresh(); } catch (err) { console.error('[doska] refresh failed:', err); }
  onChange(() => {
    refresh();
    scheduleSave();
    if (editing) positionEditor();
    if (ctxKind) positionCtxPanel();
  });
}
