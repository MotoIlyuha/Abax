import type { Element, GridMode, ImageEl, NoteEl, Page, Project, TextEl, ToolId, ToolbarPos, WheelMode } from './types';
import {
  state, update, onChange, undo, redo, canUndo, canRedo, setTool, setGrid, setStyleColor,
  setStyleWidth, setNoteColor, selectPreset, presetKind, addElement, replaceElements, pushHistory, uid,
  applyStyleToSelection, setSettings, setView, switchPage, addPage, deletePage, renamePage, setSelection,
  openProject, blankProject, projectMeta, groupSelected, ungroupSelected,
  bringForward, sendBackward, deleteSelected, setSolidSides,
} from './state';
import type { PresetKind, StyleValue } from './state';
import { storage } from './storage';
import { renderScene, contentBBox } from './renderer';
import { hasBaseSides, SIDES_MAX, SIDES_MIN, solidSides } from './solid';
import { elementAABB, NOTE_W, NOTE_H, NOTE_PAD, NOTE_FONT, NOTE_TEXT_COLOR, TEXT_SIZE } from './geom';
import * as pdfjsLib from 'pdfjs-dist';
// ?worker&inline: воркер инлайнится в бандл и работает из file:// (Electron)
import PdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?worker&inline';
import { collabActive, isHost, noteSelection, readOnly, startHostConnection, stopCollab } from './collab';
import { closePresent, openPresent, presentOpen } from './present';
import { type ToolbarGroup, onToolbarChange, restoreToolbar, svg, toolDef, toolTip, toolbarConfig } from './toolbar';
import { openSettingsDialog, settingsDialogOpen } from './settings-dialog';
import { renderToolbarEditor } from './toolbar-editor';

pdfjsLib.GlobalWorkerOptions.workerPort = new PdfWorker();

const ICONS = {
  home: svg('<path d="M3 11l9-8 9 8"/><path d="M5 10v10h5v-6h4v6h5V10"/>'),
  sidebar: svg('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M9 5v14"/>'),
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
  ungroup: svg('<rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="13" width="8" height="8" rx="1.5"/><path d="M13 6h4M15 4v4M7 13v4M5 15h4"/>'),
  trash: svg('<path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 13h10l1-13"/>'),
  toolbar: svg('<rect x="3" y="3" width="7" height="18" rx="2"/><path d="M14 7h7M14 12h7M14 17h7"/>'),
  chevron: svg('<path d="M9 6l6 6-6 6"/>'),
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
      const o = x as { color?: unknown; width?: unknown } | null;
      return o && typeof o.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(o.color) && typeof o.width === 'number'
        ? { color: o.color, width: Math.min(14, Math.max(0.5, o.width)) }
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
  const sp = panelOf('style');
  if (sp) updateSwatchActive(sp.el, c);
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
  syncLiveText();
  update();
  ta.focus();
  ta.setSelectionRange(ta.value.length, ta.value.length);
  ta.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); closeEditor(false); }
    else if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); closeEditor(true); }
    // Shift+Enter — перевод строки (стандартное поведение textarea)
  });
  ta.addEventListener('input', () => {
    syncLiveText();
    update(); // подписчик заодно подгоняет размер редактора
  });
  ta.addEventListener('blur', () => closeEditor(true));
}

/** Вводимый текст — в state.liveText: окно демонстрации рисует его вместо редактора. */
function syncLiveText(): void {
  const e = editing;
  if (!e) { state.liveText = null; return; }
  const text = e.ta.value;
  if (e.el) {
    state.liveText = { ...e.el, text };
  } else if (e.target === 'text') {
    state.liveText = { id: '', type: 'text', x: e.at!.x, y: e.at!.y, text, size: TEXT_SIZE, color: state.style.color };
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
  state.liveText = null;
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

/** Толщина нужна с тулбара и для выделенных линий/фигур (у текста и стикеров её нет). */
function styleNeedsWidth(source: CtxSource): boolean {
  if (source === 'toolbar') return true;
  return state.board.elements.some(e =>
    state.selection.has(e.id) && (e.type === 'stroke' || e.type === 'shape' || e.type === 'poly' || e.type === 'solid'));
}

/** Единая панель в духе Miro: слайдер толщины сверху, ниже свои и все цвета. */
function buildStylePanel(cp: CtxPanel): void {
  const p = cp.el;
  p.dataset.kind = 'style';
  // текущий цвет не из палитры (старая палитра, чужой элемент) — сразу в «Мои цвета»
  addCustomColor(state.style.color);
  if (styleNeedsWidth(cp.source)) {
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
  // цвет и толщина — одна кнопка и одна панель; толщина — только для «линейных» элементов
  const hasInk = selEls.some(e => e.type === 'stroke' || e.type === 'shape' || e.type === 'poly' || e.type === 'solid');
  const sBtn = document.createElement('button');
  sBtn.className = 'qm-btn qm-style' + (ctxOpenFrom('style', 'quick') ? ' active' : '');
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
  fillBoardSettings(pop, openSettings);
  const all = document.createElement('button');
  all.className = 'settings-all';
  all.title = 'Все настройки (Ctrl+,)';
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
}

function applyToolbarPos(): void {
  const tb = document.getElementById('toolbar')!;
  tb.dataset.pos = state.settings.toolbarPos;
  positionCtxPanels();
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
        // клик по названию ждёт: это может быть начало двойного клика (переименование)
        let openTimer = 0;
        row.addEventListener('click', e => {
          clearTimeout(openTimer);
          const delay = (e.target as HTMLElement).closest('.home-page-name') ? 300 : 0;
          openTimer = window.setTimeout(() => { void openProjectHandler(state.project, pg.id); }, delay);
        });
        pn.addEventListener('dblclick', e => {
          e.stopPropagation();
          clearTimeout(openTimer);
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
    tb.appendChild(makeVsep());
  }

  // пресеты «цвет + толщина»: у пера и маркера три, у прочих инструментов один (лишние скрыты)
  const styleGroup = document.createElement('div');
  styleGroup.className = 'tool-group';
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
  const key = `${kind}:${set.active}`;
  if (key === shownPresetKey) return;
  shownPresetKey = key;
  // панель стиля с тулбара переезжает к новому пресету и показывает его цвет и толщину
  const sp = panelOf('style');
  if (sp && sp.source === 'toolbar') {
    if (sp.detached) rebuildStylePanel(sp);
    else openCtxPanel('style', 'toolbar');
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
  document.getElementById('btn-home')!.innerHTML = ICONS.home;
  document.getElementById('btn-sidebar')!.innerHTML = ICONS.sidebar;
  document.getElementById('btn-undo')!.innerHTML = ICONS.undo;
  document.getElementById('btn-redo')!.innerHTML = ICONS.redo;
  document.getElementById('btn-fit')!.innerHTML = ICONS.fit;
  document.getElementById('btn-export')!.innerHTML = ICONS.export;
  document.getElementById('btn-present')!.innerHTML = ICONS.present;
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
  document.getElementById('btn-present')!.addEventListener('click', togglePresent);
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
      if (!settingsPopover().hidden) { closeSettings(); return; }
      if (dockedPanel()) { closeCtxPanel(); return; }
    }
  }, { capture: true });
}

/** Окно демонстрации: открыть или закрыть. */
export function togglePresent(): void {
  if (presentOpen()) { closePresent(); return; }
  if (!openPresent()) alert('Не удалось открыть окно демонстрации: разрешите всплывающие окна для этой страницы');
}

export function toggleSidebar(): void {
  document.getElementById('sidebar')!.classList.toggle('hidden');
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
  restoreToolbar();
  buildToolbar();
  applyToolbarPos();
  wireTopbar();
  wireImageInput();
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
