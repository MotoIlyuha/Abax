import type { BoardSettings, Element, FadeStroke, Flash, GridMode, LaserPt, NoteEl, Page, Project, ProjectMeta, Pt, SolidKind, TextEl, ToolId } from './types';
import { hasBaseSides, SIDES_MAX, SIDES_MIN, solidSides } from './solid';
import { DEFAULT_NEW_PAGE_KEY } from './hotkeys';
import { translateElement } from './geom';

export interface LiveStroke {
  tool: 'pen' | 'highlighter';
  color: string;
  width: number;
  pts: Pt[];
}

export interface LiveShape {
  shape: 'rect' | 'ellipse' | 'triangle' | 'line' | 'arrow';
  /** Якорь — точка старта (не меняется модификаторами). */
  ax0: number; ay0: number;
  /** Текущие углы с учётом модификаторов. */
  x0: number; y0: number; x1: number; y1: number;
  color: string;
  width: number;
}

/** Тело в процессе протягивания: прямоугольник, в который оно вписывается. */
export interface LiveSolid {
  solid: SolidKind;
  ax0: number; ay0: number;
  x0: number; y0: number; x1: number; y1: number;
  color: string;
  width: number;
}

/** Стикер в процессе ввода текста — рисуется на холсте, элемент создаётся при подтверждении. */
export interface LiveNote {
  x: number; y: number; w: number; h: number;
  color: string;
}

export interface StyleValue { color: string; width: number }
export type PresetKind = 'pen' | 'highlighter' | 'other';
export interface PresetSet { list: StyleValue[]; active: number }

/** Перо и маркер держат собственные пресеты, все прочие инструменты делят общий. */
export function presetKind(tool: ToolId): PresetKind {
  return tool === 'pen' || tool === 'highlighter' ? tool : 'other';
}

export interface AppState {
  view: 'home' | 'board';
  project: Project;
  projects: ProjectMeta[];
  pageId: string;
  /** Активная страница проекта (мутации — только через replaceElements и т.п.). */
  board: Page;
  camera: { x: number; y: number; zoom: number };
  tool: ToolId;
  style: StyleValue;
  /** Пресеты «цвет + толщина»: у пера и маркера — по три, у остальных инструментов — один. */
  presets: Record<PresetKind, PresetSet>;
  /** Цвет новых стикеров. */
  noteColor: string;
  settings: BoardSettings;
  selection: Set<string>;
  liveStroke: LiveStroke | null;
  liveShape: LiveShape | null;
  liveSolid: LiveSolid | null;
  livePoly: { pts: Pt[]; cursor: Pt | null } | null;
  liveNote: LiveNote | null;
  /** Текст или стикер в процессе ввода (для окна демонстрации: в основном окне его показывает редактор). */
  liveText: TextEl | NoteEl | null;
  /** id элемента, скрытого на время редактирования текста. */
  hideElId: string | null;
  /** Идёт активное перетаскивание/правка выделенного — рисуем его поверх. */
  liveEdit: boolean;
  /** Рамка выделения в экранных координатах. */
  marquee: { x0: number; y0: number; x1: number; y1: number } | null;
  /** Позиция курсора в экранных координатах (для ластика). */
  hover: { x: number; y: number } | null;
  /** След лазерной указки (экранные координаты + метка времени). */
  laserPts: LaserPt[];
  /** Росчерки исчезающего маркера (координаты сцены). */
  fadeStrokes: FadeStroke[];
  /** Активные подсветки контуров объектов. */
  flashes: Flash[];
  /** Есть несохранённые изменения содержимого доски. */
  dirty: boolean;
}

let seq = 1;
export function uid(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `id-${Date.now().toString(36)}-${seq++}`;
}

const blankPage = (name: string): Page => ({ id: uid(), name, grid: 'square', elements: [] });
const blankProject = (name: string): Project => {
  const now = Date.now();
  return { id: uid(), name, createdAt: now, updatedAt: now, pages: [blankPage('Страница 1')] };
};

export const state: AppState = {
  view: 'board',
  project: blankProject('Проект 1'),
  projects: [],
  pageId: '',
  board: blankPage('Страница 1'),
  camera: { x: 0, y: 0, zoom: 1 },
  tool: 'pen',
  style: { color: '#1f2329', width: 4 },
  presets: {
    pen: { list: [{ color: '#1f2329', width: 4 }, { color: '#bd0a0a', width: 4 }, { color: '#305bab', width: 4 }], active: 0 },
    highlighter: { list: [{ color: '#ffdc4a', width: 4 }, { color: '#2dc75c', width: 4 }, { color: '#ff6464', width: 4 }], active: 0 },
    other: { list: [{ color: '#1f2329', width: 4 }], active: 0 },
  },
  noteColor: '#ffe066',
  settings: {
    toolbarPos: 'left', coordLabels: true, snapToGrid: false, wheelMode: 'scroll', pageTransition: 'slide',
    pageKeyMod: 'alt', newPageKey: DEFAULT_NEW_PAGE_KEY, uiAnimations: true, hideUndoRedo: false,
  },
  selection: new Set(),
  liveStroke: null,
  liveShape: null,
  liveSolid: null,
  livePoly: null,
  liveNote: null,
  liveText: null,
  hideElId: null,
  liveEdit: false,
  marquee: null,
  hover: null,
  laserPts: [],
  fadeStrokes: [],
  flashes: [],
  dirty: false,
};

const listeners = new Set<() => void>();
export function onChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

function notify(): void {
  for (const fn of listeners) fn();
}

/** Уведомляет подписчиков; markDirty — изменилось содержимое доски (нужно автосохранение). */
export function update(markDirty = false): void {
  if (markDirty) {
    state.dirty = true;
    state.project.updatedAt = Date.now();
  }
  notify();
}

// ----- История: массивы элементов иммутабельны, снапшот = ссылка на массив -----

let undoStack: Element[][] = [];
let redoStack: Element[][] = [];
const HISTORY_LIMIT = 200;

export function pushHistory(prev: Element[]): void {
  undoStack.push(prev);
  if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
  redoStack = [];
}

export function canUndo(): boolean { return undoStack.length > 0; }
export function canRedo(): boolean { return redoStack.length > 0; }

export function undo(): void {
  const prev = undoStack.pop();
  if (!prev) return;
  redoStack.push(state.board.elements);
  state.board.elements = prev;
  state.selection = new Set();
  update(true);
}

export function redo(): void {
  const next = redoStack.pop();
  if (!next) return;
  undoStack.push(state.board.elements);
  state.board.elements = next;
  state.selection = new Set();
  update(true);
}

// ----- Мутации сцены (элементы заменяются, никогда не правятся на месте) -----

export function replaceElements(next: Element[]): void {
  state.board.elements = next;
  update(true);
}

export function addElement(el: Element): void {
  pushHistory(state.board.elements);
  replaceElements([...state.board.elements, el]);
}

export function deleteSelected(): void {
  if (state.selection.size === 0) return;
  pushHistory(state.board.elements);
  replaceElements(state.board.elements.filter(e => !state.selection.has(e.id)));
  state.selection = new Set();
  update();
}

/** Выделенные элементы в порядке слоёв. */
export function selectedElements(): Element[] {
  return state.board.elements.filter(e => state.selection.has(e.id));
}

/**
 * Добавляет поверх доски копии элементов со сдвигом (dx, dy) и выделяет их (запись в историю).
 * Копии получают новые id; группы внутри набора сохраняются, но под новыми groupId —
 * иначе копия слилась бы в одну группу с оригиналом.
 */
export function insertCopies(els: Element[], dx: number, dy: number): Element[] {
  if (els.length === 0) return [];
  const gids = new Map<string, string>();
  const copies = els.map(el => {
    const copy = { ...translateElement(structuredClone(el), dx, dy), id: uid() };
    if (copy.groupId) {
      if (!gids.has(copy.groupId)) gids.set(copy.groupId, uid());
      copy.groupId = gids.get(copy.groupId)!;
    }
    return copy;
  });
  pushHistory(state.board.elements);
  replaceElements([...state.board.elements, ...copies]);
  setSelection(copies.map(c => c.id));
  return copies;
}

/** Дублирует выделенное со сдвигом; выделение переходит на копии. */
export function duplicateSelected(dx: number, dy: number): void {
  insertCopies(selectedElements(), dx, dy);
}

/** Выделяет все элементы страницы и включает инструмент «Выделение», чтобы их сразу можно было двигать. */
export function selectAll(): void {
  if (state.board.elements.length === 0) return;
  setTool('select');
  setSelection(state.board.elements.map(e => e.id));
}

export function setSelection(ids: string[]): void {
  state.selection = new Set(ids);
  syncStyleFromSelection();
  update();
}

/** Тулбар отражает стиль выделенного: единый цвет/толщина подхватываются как текущие. */
function syncStyleFromSelection(): void {
  const sel = state.board.elements.filter(e => state.selection.has(e.id));
  const inked = sel.filter(e => e.type === 'stroke' || e.type === 'shape' || e.type === 'poly' || e.type === 'solid' || e.type === 'text');
  if (inked.length === 0) return;
  const colors = new Set(inked.map(e => e.color));
  if (colors.size === 1) state.style.color = inked[0].color;
  const sized = sel.filter(e => e.type === 'stroke' || e.type === 'shape' || e.type === 'poly' || e.type === 'solid');
  if (sized.length > 0) {
    const widths = new Set(sized.map(e => e.width));
    if (widths.size === 1) state.style.width = sized[0].width;
  }
}

export function setTool(tool: ToolId): void {
  if (state.tool === tool) return;
  const kindChanged = presetKind(state.tool) !== presetKind(tool);
  state.tool = tool;
  if (kindChanged) state.style = { ...activePreset() };
  state.liveStroke = null;
  state.liveShape = null;
  state.liveSolid = null;
  state.livePoly = null;
  state.liveEdit = false;
  update();
}

/** Применяет цвет/толщину/начертание к выделенным элементам (запись в историю). */
export function applyStyleToSelection(patch: { color?: string; width?: number; bold?: boolean; italic?: boolean }): void {
  if (state.selection.size === 0) return;
  const applicable = state.board.elements.some(e =>
    state.selection.has(e.id) && e.type !== 'note' && e.type !== 'image');
  if (!applicable) return;
  pushHistory(state.board.elements);
  replaceElements(state.board.elements.map(el => {
    if (!state.selection.has(el.id)) return el;
    if (el.type === 'note' || el.type === 'image') return el;
    if (el.type === 'text') {
      return {
        ...el,
        ...(patch.color !== undefined ? { color: patch.color } : {}),
        ...(patch.bold !== undefined ? { bold: patch.bold } : {}),
        ...(patch.italic !== undefined ? { italic: patch.italic } : {}),
      };
    }
    return {
      ...el,
      ...(patch.color !== undefined ? { color: patch.color } : {}),
      ...(patch.width !== undefined ? { width: patch.width } : {}),
    };
  }));
}

/** Число сторон основания у выделенных призм и пирамид (запись в историю). */
export function setSolidSides(n: number): void {
  const sides = Math.min(SIDES_MAX, Math.max(SIDES_MIN, Math.round(n)));
  const hit = state.board.elements.some(e =>
    state.selection.has(e.id) && e.type === 'solid' && hasBaseSides(e.solid) && solidSides(e) !== sides);
  if (!hit) return;
  pushHistory(state.board.elements);
  replaceElements(state.board.elements.map(el =>
    state.selection.has(el.id) && el.type === 'solid' && hasBaseSides(el.solid) ? { ...el, n: sides } : el));
}

function activePreset(): StyleValue {
  const set = state.presets[presetKind(state.tool)];
  return set.list[set.active];
}

/** Выбор пресета текущего инструмента: его цвет и толщина становятся текущими. */
export function selectPreset(i: number): void {
  const set = state.presets[presetKind(state.tool)];
  if (i < 0 || i >= set.list.length) return;
  set.active = i;
  state.style = { ...set.list[i] };
  update();
}

export function setStyleColor(color: string): void { state.style.color = color; activePreset().color = color; update(); }
export function setStyleWidth(width: number): void { state.style.width = width; activePreset().width = width; update(); }
export function setNoteColor(color: string): void { state.noteColor = color; update(); }

export function setGrid(grid: GridMode): void {
  state.board.grid = grid;
  update(true);
}

export function setSettings(patch: Partial<BoardSettings>): void {
  state.settings = { ...state.settings, ...patch };
  update();
}

// ----- Живой штрих -----

export function beginStroke(tool: 'pen' | 'highlighter', pt: Pt): void {
  state.liveStroke = { tool, color: state.style.color, width: state.style.width, pts: [pt] };
  update();
}

/** Добавляет точку с лёгким сглаживанием; слишком близкие точки сливает. */
export function extendStroke(pt: Pt): void {
  const ls = state.liveStroke;
  if (!ls) return;
  const last = ls.pts[ls.pts.length - 1];
  if (ls.pts.length > 1 && Math.hypot(pt.x - last.x, pt.y - last.y) * state.camera.zoom < 0.4) {
    last.p = (last.p + pt.p) / 2;
    return;
  }
  // сглаживание к сырой точке на 60%: убирает дрожание пера, сохраняя отклик
  ls.pts.push({ x: last.x + (pt.x - last.x) * 0.6, y: last.y + (pt.y - last.y) * 0.6, p: pt.p });
  update();
}

export function endStroke(): void {
  const ls = state.liveStroke;
  state.liveStroke = null;
  if (!ls || ls.pts.length === 0) { update(); return; }
  const base = ls.tool === 'highlighter' ? ls.width * 3.2 : ls.width;
  addElement({ id: uid(), type: 'stroke', tool: ls.tool, color: ls.color, width: base, pts: ls.pts });
}

/** Завершает построение ломаной: closed=true замыкает контур. */
export function commitPoly(closed: boolean): void {
  const lp = state.livePoly;
  state.livePoly = null;
  if (!lp) { update(); return; }
  const pts = lp.pts.slice();
  // убираем дубли в конце (двойной клик добавляет ту же точку дважды)
  while (pts.length > 1 && Math.hypot(pts[pts.length - 1].x - pts[pts.length - 2].x, pts[pts.length - 1].y - pts[pts.length - 2].y) < 1) pts.pop();
  const min = closed ? 3 : 2;
  if (pts.length < min) { update(); return; }
  addElement({ id: uid(), type: 'poly', closed, color: state.style.color, width: state.style.width * 1.1, pts });
}

// ----- Проекты и страницы -----

export { blankProject, blankPage };

export function projectMeta(p: Project): ProjectMeta {
  return {
    id: p.id, name: p.name, createdAt: p.createdAt, updatedAt: p.updatedAt, pageCount: p.pages.length,
    ...(p.pinned ? { pinned: true } : {}),
  };
}

/** Копия списка, где элемент с позиции from стоит на позиции to (индексы вне списка — без изменений). */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const out = list.slice();
  if (from === to || from < 0 || to < 0 || from >= out.length || to >= out.length) return out;
  const [it] = out.splice(from, 1);
  out.splice(to, 0, it);
  return out;
}

/** Открывает проект на заданной (или первой) странице. */
export function openProject(project: Project, pageId?: string, view: 'home' | 'board' = 'board'): void {
  state.project = project;
  state.pageId = pageId && project.pages.some(p => p.id === pageId) ? pageId : project.pages[0].id;
  state.board = project.pages.find(p => p.id === state.pageId) ?? project.pages[0];
  state.selection = new Set();
  state.liveStroke = null;
  state.liveShape = null;
  state.liveSolid = null;
  state.livePoly = null;
  state.liveNote = null;
  state.liveEdit = false;
  state.marquee = null;
  undoStack = [];
  redoStack = [];
  state.dirty = false;
  state.view = view;
  update();
}

export function setView(view: 'home' | 'board'): void {
  state.view = view;
  update();
}

export function switchPage(pageId: string): void {
  const page = state.project.pages.find(p => p.id === pageId);
  if (!page || pageId === state.pageId) return;
  state.pageId = pageId;
  state.board = page;
  state.selection = new Set();
  state.liveStroke = null;
  state.liveShape = null;
  state.liveSolid = null;
  state.livePoly = null;
  state.liveNote = null;
  state.liveEdit = false;
  state.marquee = null;
  undoStack = [];
  redoStack = [];
  update();
}

export function addPage(): Page {
  const page = blankPage(`Страница ${state.project.pages.length + 1}`);
  state.project = { ...state.project, pages: [...state.project.pages, page] };
  state.pageId = page.id;
  state.board = page;
  state.selection = new Set();
  undoStack = [];
  redoStack = [];
  update(true);
  return page;
}

export function deletePage(pageId: string): void {
  let pages = state.project.pages.filter(p => p.id !== pageId);
  if (pages.length === 0) pages = [blankPage('Страница 1')];
  state.project = { ...state.project, pages };
  if (state.pageId === pageId) {
    state.pageId = pages[0].id;
    state.board = pages[0];
    undoStack = [];
    redoStack = [];
  }
  update(true);
}

export function renamePage(pageId: string, name: string): void {
  state.project = {
    ...state.project,
    pages: state.project.pages.map(p => (p.id === pageId ? { ...p, name } : p)),
  };
  // активная страница — тот же объект, что в проекте: иначе правки уйдут в осиротевшую копию
  if (pageId === state.pageId) state.board = state.project.pages.find(p => p.id === pageId)!;
  update(true);
}

/** Переставляет страницу открытого проекта; активная страница остаётся активной. */
export function movePage(from: number, to: number): void {
  const pages = moveItem(state.project.pages, from, to);
  if (pages.every((p, i) => p === state.project.pages[i])) return;
  state.project = { ...state.project, pages };
  update(true);
}

// ----- Слои и группы -----

/** Поднимает выделенные элементы на один слой выше. */
export function bringForward(): void {
  const arr = state.board.elements.slice();
  for (let i = arr.length - 2; i >= 0; i--) {
    if (state.selection.has(arr[i].id) && !state.selection.has(arr[i + 1].id)) {
      [arr[i], arr[i + 1]] = [arr[i + 1], arr[i]];
    }
  }
  pushHistory(state.board.elements);
  replaceElements(arr);
}

/** Опускает выделенные элементы на один слой ниже. */
export function sendBackward(): void {
  const arr = state.board.elements.slice();
  for (let i = 1; i < arr.length; i++) {
    if (state.selection.has(arr[i].id) && !state.selection.has(arr[i - 1].id)) {
      [arr[i], arr[i - 1]] = [arr[i - 1], arr[i]];
    }
  }
  pushHistory(state.board.elements);
  replaceElements(arr);
}

/** Объединяет выделенные элементы в группу. */
export function groupSelected(): void {
  if (state.selection.size < 2) return;
  const gid = uid();
  pushHistory(state.board.elements);
  replaceElements(state.board.elements.map(el => (state.selection.has(el.id) ? { ...el, groupId: gid } : el)));
}

/** Разъединяет группу(ы) выделенных элементов. */
export function ungroupSelected(): void {
  const hasGroup = state.board.elements.some(e => state.selection.has(e.id) && e.groupId);
  if (!hasGroup) return;
  pushHistory(state.board.elements);
  replaceElements(state.board.elements.map(el => {
    if (!state.selection.has(el.id) || !el.groupId) return el;
    const copy = { ...el };
    delete copy.groupId;
    return copy;
  }));
}

/** Расширяет набор id до полных групп (для клика и рамки). */
export function expandSelectionWithGroups(ids: Set<string>): string[] {
  const gids = new Set(
    state.board.elements.filter(e => e.groupId && ids.has(e.id)).map(e => e.groupId!),
  );
  if (gids.size === 0) return [...ids];
  return state.board.elements.filter(e => ids.has(e.id) || (e.groupId && gids.has(e.groupId))).map(e => e.id);
}
