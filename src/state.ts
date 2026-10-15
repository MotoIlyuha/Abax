import type { Board, BoardMeta, Camera, Element, GridMode, Pt, ToolId } from './types';

export interface LiveStroke {
  tool: 'pen' | 'highlighter';
  color: string;
  width: number;
  pts: Pt[];
}

export interface LiveShape {
  shape: 'rect' | 'ellipse' | 'line' | 'arrow';
  x0: number; y0: number; x1: number; y1: number;
  color: string;
  width: number;
}

export interface AppState {
  board: Board;
  boards: BoardMeta[];
  camera: Camera;
  tool: ToolId;
  style: { color: string; width: number };
  grid: GridMode;
  selection: Set<string>;
  liveStroke: LiveStroke | null;
  liveShape: LiveShape | null;
  /** Рамка выделения в экранных координатах. */
  marquee: { x0: number; y0: number; x1: number; y1: number } | null;
  /** Позиция курсора в экранных координатах (для ластика). */
  hover: { x: number; y: number } | null;
  /** Есть несохранённые изменения содержимого доски. */
  dirty: boolean;
}

let seq = 1;
export function uid(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `id-${Date.now().toString(36)}-${seq++}`;
}

export const state: AppState = {
  board: { id: 'boot', name: 'Доска', createdAt: 0, updatedAt: 0, elements: [] },
  boards: [],
  camera: { x: 0, y: 0, zoom: 1 },
  tool: 'pen',
  style: { color: '#1f2329', width: 4 },
  grid: 'square',
  selection: new Set(),
  liveStroke: null,
  liveShape: null,
  marquee: null,
  hover: null,
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
    state.board.updatedAt = Date.now();
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

export function setSelection(ids: string[]): void {
  state.selection = new Set(ids);
  update();
}

export function setTool(tool: ToolId): void {
  if (state.tool === tool) return;
  state.tool = tool;
  state.liveStroke = null;
  state.liveShape = null;
  update();
}

export function setStyleColor(color: string): void { state.style.color = color; update(); }
export function setStyleWidth(width: number): void { state.style.width = width; update(); }
export function setGrid(grid: GridMode): void { state.grid = grid; update(); }

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

// ----- Доски -----

export function createBoard(name: string): Board {
  const now = Date.now();
  return { id: uid(), name, createdAt: now, updatedAt: now, elements: [] };
}

export function boardMeta(b: Board): BoardMeta {
  return { id: b.id, name: b.name, createdAt: b.createdAt, updatedAt: b.updatedAt };
}

export function loadBoard(board: Board, boards: BoardMeta[]): void {
  state.board = board;
  state.boards = boards;
  state.selection = new Set();
  state.liveStroke = null;
  state.liveShape = null;
  state.marquee = null;
  undoStack = [];
  redoStack = [];
  state.dirty = false;
  update();
}
