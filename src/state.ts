import { clearStickyTool, stickyTool } from './sticky-tool';
import { clearRunField } from './text-runs';
import { clearStarter, starterId } from './sync-state';
import type {
  BoardSettings, Camera, Element, PlanTier, FadeStroke, Flash, GridMode, Guide, LaserPt, RemoteLaser, NoteEl, Page, Project, ProjectMeta, Pt, ShapeEl, SolidKind,
  TextAlign, TextEl, TextVAlign, ToolId,
} from './types';
import { hasBaseSides, SIDES_MAX, SIDES_MIN, solidSides } from './solid';
import { DEFAULT_NEW_PAGE_KEY } from './hotkeys';
import { imageFrame, shapeHoldsText, translateElement } from './geom';
import { attachNewElement, freezeAttachments, rebindAttachment } from './attachment';
import { canCreatePage, effectivePermissions, planOf } from './limits';
import { limitsEnforced } from './plan';
import { hasUnresolvedComments, preserveLiveFields, syncCommentsWithMovedElements } from './comments';
import { describeChange } from './history-diff';

export interface LiveStroke {
  tool: 'pen' | 'highlighter';
  color: string;
  width: number;
  opacity?: number;
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
  opacity?: number;
}

/** Тело в процессе протягивания: прямоугольник, в который оно вписывается. */
export interface LiveSolid {
  solid: SolidKind;
  ax0: number; ay0: number;
  x0: number; y0: number; x1: number; y1: number;
  color: string;
  width: number;
  opacity?: number;
}

/** Стикер в процессе ввода текста — рисуется на холсте, элемент создаётся при подтверждении. */
export interface LiveNote {
  x: number; y: number; w: number; h: number;
  color: string;
}

/** opacity — непрозрачность 0..1; нет поля — 1 (так же у элементов). */
export interface StyleValue { color: string; width: number; opacity?: number }

/** Самая прозрачная ступень ползунка: совсем невидимый элемент не найти на доске. */
export const OPACITY_MIN = 0.1;

/** Непрозрачность в допустимых пределах; 1 и всё, что не число, — непрозрачный. */
export function clampOpacity(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(OPACITY_MIN, v)) : 1;
}

/** Поле opacity у элемента или стиля: непрозрачность 1 не храним. */
export function opacityField(v: number | undefined): { opacity?: number } {
  return v !== undefined && v < 1 ? { opacity: v } : {};
}

function setOpacityOf(s: StyleValue, v: number): void {
  if (v >= 1) delete s.opacity;
  else s.opacity = v;
}
export type PresetKind = 'pen' | 'highlighter' | 'laser' | 'other';
export interface PresetSet { list: StyleValue[]; active: number }

/** Перо, маркер и указка держат собственные пресеты, все прочие инструменты делят общий. */
export function presetKind(tool: ToolId): PresetKind {
  return tool === 'pen' || tool === 'highlighter' || tool === 'laser' ? tool : 'other';
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
  attachmentPreview: { item: string; base: string }[] | null;
  /** Временный порядок слоёв только для отрисовки, без изменения проекта. */
  layerPreview: Element[] | null;
  liveStroke: LiveStroke | null;
  liveShape: LiveShape | null;
  liveSolid: LiveSolid | null;
  livePoly: { pts: Pt[]; cursor: Pt | null } | null;
  liveNote: LiveNote | null;
  /** Текст, стикер или надпись фигуры в процессе ввода (для окна демонстрации: в основном окне его показывает редактор). */
  liveText: TextEl | NoteEl | ShapeEl | null;
  /** id элемента, скрытого на время редактирования текста. */
  hideElId: string | null;
  /** Объекты, временно скрытые на исходной странице при переносе. */
  dragHidden: { pageId: string; ids: Set<string> } | null;
  /** id фигуры, надпись которой правится на месте: контур рисуется, надпись — нет. */
  hideTextId: string | null;
  /** Идёт активное перетаскивание/правка выделенного — рисуем его поверх. */
  liveEdit: boolean;
  /** Рамка выделения в экранных координатах. */
  marquee: { x0: number; y0: number; x1: number; y1: number } | null;
  /** Направляющие выравнивания, пока объект тянут (координаты сцены). */
  guides: Guide[];
  /** Инструмент «Раздвинуть»: линия разреза y и на сколько раздвинули dy (координаты сцены). */
  spread: { y: number; dy: number } | null;
  /** Позиция курсора в экранных координатах (для ластика). */
  hover: { x: number; y: number } | null;
  commentHoverId: string | null;
  /** След лазерной указки (экранные координаты + метка времени). */
  laserPts: LaserPt[];
  /** Кнопка зажата — указка оставляет след и тянет его к курсору. */
  laserDown: boolean;
  /** Указки других участников совместной работы по номеру участника. */
  remoteLasers: Map<number, RemoteLaser>;
  /** Росчерки исчезающего маркера (координаты сцены). */
  fadeStrokes: FadeStroke[];
  /** Активные подсветки контуров объектов. */
  flashes: Flash[];
  /** Есть несохранённые изменения содержимого доски. */
  dirty: boolean;
  /**
   * Черновики: страницы только в памяти. Их нет ни в проекте, ни на диске, ни у гостей совместной работы,
   * ни в окне демонстрации; закрыли вкладку или приложение — пропали.
   */
  drafts: Page[];
  /**
   * Пока открыт черновик, окно демонстрации не меняется: оно держит последнюю настоящую страницу
   * и камеру, какой её видели до входа в черновик.
   */
  hold: { pageId: string; camera: Camera } | null;
  /** Счётчик правок черновиков: сами они проект не меняют, а список страниц должен перерисовать превью. */
  draftRev: number;
  /** Роль в совместной работе (выставляет collab.ts); null — работаем без неё. */
  collabRole: 'host' | 'guest' | null;
  /** Доска открыта по ссылке просмотра: всего проекта или одной страницы. */
  linkMode: 'view-project' | 'view-page' | null;
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
  tool: 'select',
  style: { color: '#1f2329', width: 4 },
  presets: {
    pen: { list: [{ color: '#1f2329', width: 4 }, { color: '#bd0a0a', width: 4 }, { color: '#305bab', width: 4 }], active: 0 },
    highlighter: { list: [{ color: '#ffdc4a', width: 4 }, { color: '#2dc75c', width: 4 }, { color: '#ff6464', width: 4 }], active: 0 },
    laser: { list: [{ color: '#ff2d2d', width: 4 }], active: 0 },
    other: { list: [{ color: '#1f2329', width: 4 }], active: 0 },
  },
  noteColor: '#ffe066',
  settings: {
    toolbarPos: 'left', toolbarDetachable: false, toolbarFloat: null, snapToGrid: false, wheelMode: 'zoom', pageTransition: 'slide',
    pageKeyMod: 'alt', mouseMode: 'pages', mouseBindings: { '1': null, '3': null, '4': null }, newPageKey: DEFAULT_NEW_PAGE_KEY, animationMode: 'enhanced', hideUndoRedo: false,
    keepImageAspect: true, smoothPan: true, alignGuides: true, closePagesOnPick: false, thumbViewport: true, pageLinks: false, recursionEnabled: false,
  },
  selection: new Set(),
  attachmentPreview: null,
  layerPreview: null,
  liveStroke: null,
  liveShape: null,
  liveSolid: null,
  livePoly: null,
  liveNote: null,
  liveText: null,
  hideElId: null,
  dragHidden: null,
  hideTextId: null,
  liveEdit: false,
  marquee: null,
  guides: [],
  spread: null,
  hover: null,
  commentHoverId: null,
  laserPts: [],
  laserDown: false,
  remoteLasers: new Map(),
  fadeStrokes: [],
  flashes: [],
  dirty: false,
  drafts: [],
  hold: null,
  draftRev: 0,
  collabRole: null,
  linkMode: null,
};

// ----- Черновики -----

export function isDraftId(pageId: string): boolean {
  return state.drafts.some(d => d.id === pageId);
}

/** Сейчас открыт черновик. */
export function onDraft(): boolean {
  return isDraftId(state.pageId);
}

/** Настоящая страница проекта, на которой доска «стоит»: при открытом черновике — та, с которой в него ушли. */
export function realPageId(): string {
  return state.hold ? state.hold.pageId : state.pageId;
}

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
    // правка черновика проект не меняет: сохранять нечего
    if (onDraft()) state.draftRev++;
    else touchProject();
  }
  notify();
}

/** Содержимое проекта изменилось: нужно сохранение. */
export function touchProject(): void {
  state.dirty = true;
  state.project.updatedAt = Date.now();
}

// ----- Масштаб -----

export const ZOOM_MIN = 0.05;
export const ZOOM_MAX = 32;

/** Масштаб zoom (в пределах ZOOM_MIN…ZOOM_MAX); точка экрана (sx, sy) остаётся на месте. */
export function zoomAtPoint(zoom: number, sx: number, sy: number): void {
  const cam = state.camera;
  const z = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom));
  const sceneX = sx / cam.zoom + cam.x;
  const sceneY = sy / cam.zoom + cam.y;
  state.camera = { zoom: z, x: sceneX - sx / z, y: sceneY - sy / z };
  update();
}

/** Масштаб, введённый в шапке: «150», «150%», «87,5 %» → 1.5 / 0.875; иначе — что не так. */
export function parseZoomPercent(text: string): { zoom: number } | { error: string } {
  const m = /^\s*(\d+(?:[.,]\d+)?)\s*%?\s*$/.exec(text);
  if (!m) return { error: 'Введите число, например 150' };
  const pct = Number(m[1].replace(',', '.'));
  if (pct < ZOOM_MIN * 100 || pct > ZOOM_MAX * 100) return { error: `Масштаб - от ${ZOOM_MIN * 100} до ${ZOOM_MAX * 100}%` };
  return { zoom: pct / 100 };
}

// ----- История: массивы элементов иммутабельны, снапшот = ссылка на массив -----

let undoStack: Element[][] = [];
let redoStack: Element[][] = [];
/** Время каждой записи (когда сделана правка) — параллельно стекам: undoTimes[i] — правка после undoStack[i]. */
let undoTimes: number[] = [];
let redoTimes: number[] = [];
/** Начальное состояние истории: с чего она началась и когда. */
let historyBase: { label: string; ts: number } = { label: 'Начало сеанса', ts: Date.now() };
const HISTORY_LIMIT = 200;

/** Сброс истории: открыт проект («Начало сеанса») или другая страница («Открыта страница»). */
function resetHistory(label: string): void {
  undoStack = [];
  redoStack = [];
  undoTimes = [];
  redoTimes = [];
  historyBase = { label, ts: Date.now() };
}

export function pushHistory(prev: Element[]): void {
  // первая правка в автоматически созданной стартовой доске — это уже проект пользователя (SPEC_NIGHT5 §2.1)
  if (undoStack.length === 0 && starterId() === state.project.id) clearStarter(state.project.id);
  undoStack.push(prev);
  undoTimes.push(Date.now());
  if (undoStack.length > HISTORY_LIMIT) {
    undoStack.shift();
    // самая старая правка вытеснена: начало истории — состояние после неё
    historyBase = { label: 'Самое раннее сохранённое состояние', ts: undoTimes.shift()! };
  }
  redoStack = [];
  redoTimes = [];
}

export function canUndo(): boolean { return undoStack.length > 0; }
export function canRedo(): boolean { return redoStack.length > 0; }

/** Привязанные комментарии едут за своими элементами; страница меняется на месте, как и её элементы. */
function followComments(prev: Element[]): void {
  if (!state.board.comments?.length) return;
  state.board.comments = syncCommentsWithMovedElements(state.board, prev, state.board.elements).comments;
}

function restoreHistory(back: boolean): boolean {
  const from = back ? undoStack : redoStack;
  const to = back ? redoStack : undoStack;
  const fromTimes = back ? undoTimes : redoTimes;
  const toTimes = back ? redoTimes : undoTimes;
  const snapshot = from.at(-1);
  if (!snapshot) return false;
  const before = state.board.elements;
  const next = guardedSnapshot(snapshot, before);
  if (state.board.comments?.some(t => t.targetElementId && !t.resolved)) {
    const nextIds = new Set(next.map(el => el.id));
    const removed = before.filter(el => !nextIds.has(el.id));
    if (!confirmElementDeletion(new Set(removed.map(el => el.id)))) return false;
  }
  from.pop();
  to.push(before);
  toTimes.push(fromTimes.pop() ?? Date.now());
  state.board.elements = preserveLiveFields(next, before);
  followComments(before);
  state.selection = new Set();
  update(true);
  return true;
}

export function undo(): void { restoreHistory(true); }
export function redo(): void { restoreHistory(false); }

/** Запись ленты «История изменений»: подпись, время и положение относительно текущего состояния. */
export interface HistoryRecord {
  label: string;
  ts: number;
  state: 'done' | 'current' | 'undone';
}

/** Подписи соседних снимков: снимки иммутабельны, подпись пары считается один раз. */
const changeLabels = new WeakMap<readonly Element[], { prev: readonly Element[]; label: string }>();

function changeLabel(prev: readonly Element[], next: readonly Element[]): string {
  const hit = changeLabels.get(next);
  if (hit && hit.prev === prev) return hit.label;
  const label = describeChange(prev, next);
  changeLabels.set(next, { prev, label });
  return label;
}

/**
 * Лента истории страницы по порядку: начальное состояние, сделанное, текущее и отменённое.
 * Индекс записи — аргумент jumpToHistory.
 */
export function historyTimeline(): HistoryRecord[] {
  const snaps: readonly Element[][] = [...undoStack, state.board.elements, ...redoStack.slice().reverse()];
  const times = [...undoTimes, ...redoTimes.slice().reverse()];
  const current = undoStack.length;
  return snaps.map((snap, i) => ({
    label: i === 0 ? historyBase.label : changeLabel(snaps[i - 1], snap),
    ts: i === 0 ? historyBase.ts : times[i - 1],
    state: i < current ? 'done' : i === current ? 'current' : 'undone',
  }));
}

/** Переход к записи ленты: повторные undo()/redo() — тот же путь, что у кнопок (синхронизация с комнатой — как обычно). */
export function jumpToHistory(index: number): void {
  if (!Number.isInteger(index)) return;
  const target = Math.max(0, Math.min(index, undoStack.length + redoStack.length));
  while (undoStack.length > target) if (!restoreHistory(true)) return;
  while (undoStack.length < target && redoStack.length > 0) if (!restoreHistory(false)) return;
}

// ----- Мутации сцены (элементы заменяются, никогда не правятся на месте) -----

export function replaceElements(next: Element[]): void {
  const before = state.board.elements;
  // Закреплённые объекты сохраняют относительный порядок внутри своих областей.
  state.board.elements = [
    ...next.filter(e => e.layerPin === 'bottom'),
    ...next.filter(e => !e.layerPin),
    ...next.filter(e => e.layerPin === 'top'),
  ];
  followComments(before);
  update(true);
}

export function addElement(el: Element): void {
  pushHistory(state.board.elements);
  replaceElements([...state.board.elements, attachNewElement(el, state.board.elements)]);
}

export function confirmElementDeletion(ids: ReadonlySet<string>): boolean {
  return !hasUnresolvedComments(state.board, ids)
    || window.confirm('Удалить выбранные объекты? У них есть нерешённые комментарии. Обсуждения останутся доступны на вкладке «Комментарии».');
}

export function deleteSelected(): boolean {
  if (state.selection.size === 0 || !confirmElementDeletion(state.selection)) return false;
  pushHistory(state.board.elements);
  replaceElements(state.board.elements.filter(e => !state.selection.has(e.id)));
  state.selection = new Set();
  update();
  return true;
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
  const ids = new Map(els.map(el => [el.id, uid()]));
  const copies = els.map(el => {
    const copy = { ...translateElement(structuredClone(el), dx, dy), id: ids.get(el.id)! };
    if (copy.groupId) {
      if (!gids.has(copy.groupId)) gids.set(copy.groupId, uid());
      copy.groupId = gids.get(copy.groupId)!;
    }
    // копия задания — новое задание: без попыток, ввода ученика и пометки «сложное»
    if (copy.type === 'task') {
      const { attempts: _a, studentDraft: _d, markedHard: _h, ...fresh } = copy;
      return rebindAttachment({ ...fresh, taskId: uid() } as Element, ids);
    }
    return rebindAttachment(copy, ids);
  });
  pushHistory(state.board.elements);
  replaceElements([...state.board.elements, ...copies]);
  setSelection(copies.map(c => c.id));
  return copies;
}

/** Дублирует выделенное со сдвигом; выделение переходит на копии. false — копирование запрещено или нечего дублировать. */
export function duplicateSelected(dx: number, dy: number): boolean {
  if (!canCopyCurrentBoard()) return false;
  return insertCopies(selectedElements(), dx, dy).length > 0;
}

// ----- Защита от копирования и клонирования -----

/** Читает доску чужой: гость совместной работы или ссылка просмотра. */
function viewingForeign(): boolean {
  return state.collabRole === 'guest' || state.linkMode !== null;
}

/**
 * Можно ли копировать, вырезать и дублировать элементы. Автор может всегда; читатель — пока автор
 * не запретил (allowCopy: false или forbidClone: true). Права берутся с поправкой на тариф владельца.
 */
/**
 * Копирование в комнате решает хаб (возможности участника, SPEC_NIGHT6 D1): true/false — его решение,
 * null — решения нет (вне комнаты или хаб старой версии), действуют права доски. Регистрирует collab.ts.
 */
let copyGuard: (() => boolean | null) | null = null;
export function setCopyGuard(fn: (() => boolean | null) | null): void { copyGuard = fn; }

export function canCopyCurrentBoard(): boolean {
  const room = copyGuard ? copyGuard() : null;
  if (room !== null) return room;
  if (!viewingForeign()) return true;
  const perms = effectivePermissions(state.project);
  return perms.allowCopy !== false && perms.forbidClone !== true;
}

/** Можно ли унести проект целиком (клонировать, сохранить файлом). Одна страница по ссылке — никогда. */
export function canCloneCurrentProject(): boolean {
  if (state.linkMode === 'view-page') return false;
  if (!viewingForeign()) return true;
  return effectivePermissions(state.project).forbidClone !== true;
}

/** Выделяет все элементы страницы и включает инструмент «Выделение», чтобы их сразу можно было двигать. */
export function selectAll(): void {
  if (state.board.elements.length === 0) return;
  setTool('select');
  setSelection(state.board.elements.map(e => e.id));
}

/**
 * Можно ли менять элемент (защита чужих элементов, SPEC_NIGHT6 §4.6): правило регистрирует collab.ts, по умолчанию —
 * да. Это лишь удобство интерфейса: решает хаб.
 */
let touchGuard: ((el: Element) => boolean) | null = null;
/** Мой ли элемент, которого уже нет на доске (для Undo): только по автору, без догадок «новый — значит мой». */
let ownsGuard: ((el: Element) => boolean) | null = null;
export function setTouchGuard(fn: ((el: Element) => boolean) | null, owns: ((el: Element) => boolean) | null = fn): void {
  touchGuard = fn;
  ownsGuard = owns;
}
export function canTouchElement(el: Element): boolean { return !touchGuard || touchGuard(el); }

/**
 * Откат снимка без чужих правок (D6): чужие элементы берутся из текущей доски (before) — не откатываются и не
 * воскресают, их взаимный порядок — как в before; свои — из снимка (prev). canTouch решается по текущей версии элемента.
 */
export function preserveForeign(prev: readonly Element[], before: readonly Element[], canTouch: (el: Element) => boolean): Element[] {
  const beforeById = new Map(before.map(e => [e.id, e]));
  const own = (el: Element) => canTouch(beforeById.get(el.id) ?? el);
  const out: Element[] = [];
  for (const el of prev) {
    if (own(el)) out.push(el);
    else { const b = beforeById.get(el.id); if (b) out.push(b); }
  }
  // чужие, которых не было в снимке, остаются — сразу за своим соседом снизу в before
  const present = new Set(out.map(e => e.id));
  for (let i = 0; i < before.length; i++) {
    const b = before[i];
    if (present.has(b.id) || canTouch(b)) continue;
    let at = 0;
    for (let j = i - 1; j >= 0; j--) {
      const p = out.findIndex(e => e.id === before[j].id);
      if (p >= 0) { at = p + 1; break; }
    }
    out.splice(at, 0, b);
    present.add(b.id);
  }
  // взаимный порядок чужих — как в before
  const want = before.filter(e => !canTouch(e));
  const slots = out.map((e, i) => (beforeById.has(e.id) && !canTouch(beforeById.get(e.id)!) ? i : -1)).filter(i => i >= 0);
  if (slots.length === want.length) slots.forEach((slot, k) => { out[slot] = want[k]; });
  return out;
}

/** Снимок Undo/Redo с учётом защиты чужих элементов. */
const guardedSnapshot = (snap: Element[], before: Element[]): Element[] => {
  if (!touchGuard) return snap;
  const now = new Set(before.map(e => e.id));
  return preserveForeign(snap, before, el => (now.has(el.id) ? canTouchElement(el) : !ownsGuard || ownsGuard(el)));
};

export function setSelection(ids: string[]): void {
  // чужие элементы при защите не выделяются: их нельзя сдвинуть, изменить или удалить (SPEC_NIGHT6 §4.6)
  if (touchGuard) {
    const blocked = new Set(state.board.elements.filter(el => !touchGuard!(el)).map(el => el.id));
    if (blocked.size > 0) ids = ids.filter(id => !blocked.has(id));
  }
  state.selection = new Set(ids);
  syncStyleFromSelection();
  update();
}

/** Элементы с цветом: всё, кроме стикеров и картинок без рамки. */
function inkOf(e: Element): { color: string; width?: number; opacity?: number } | null {
  if (e.type === 'note' || e.type === 'task') return null;
  if (e.type === 'image') return imageFrame(e) ? { color: e.color!, width: e.width, opacity: e.opacity } : null;
  return e;
}

/** Тулбар отражает стиль выделенного: единые цвет, толщина и непрозрачность подхватываются как текущие. */
function syncStyleFromSelection(): void {
  const inked = state.board.elements.filter(e => state.selection.has(e.id)).map(inkOf).filter(x => x !== null);
  if (inked.length === 0) return;
  const colors = new Set(inked.map(e => e.color));
  if (colors.size === 1) state.style.color = inked[0].color;
  // у текста толщины нет
  const sized = inked.filter(e => e.width !== undefined);
  if (sized.length > 0) {
    const widths = new Set(sized.map(e => e.width));
    if (widths.size === 1) state.style.width = sized[0].width!;
  }
  const opacities = new Set(inked.map(e => e.opacity ?? 1));
  if (opacities.size === 1) setOpacityOf(state.style, inked[0].opacity ?? 1);
}

/**
 * Выбор инструмента на панели или клавишей: выделение снимается. Само «Задание» — кнопка, а не режим,
 * поэтому выделение не трогает. Программные переключения (после вставки и т. п.) идут через setTool.
 */
export function pickTool(tool: ToolId): void {
  if (tool !== state.tool && tool !== 'task' && state.selection.size > 0) setSelection([]);
  setTool(tool);
}

export function setTool(tool: ToolId): void {
  if (state.tool === tool) return;
  clearStickyTool(); // режим массового добавления снимается выбором другого инструмента
  const kindChanged = presetKind(state.tool) !== presetKind(tool);
  state.tool = tool;
  state.commentHoverId = null;
  if (tool === 'pen' || tool === 'highlighter') state.selection = new Set();
  if (kindChanged) state.style = { ...activePreset() };
  state.liveStroke = null;
  state.liveShape = null;
  state.liveSolid = null;
  state.livePoly = null;
  state.liveEdit = false;
  state.spread = null;
  update();
}

export interface StylePatch {
  color?: string;
  fill?: string | null;
  fillOpacity?: number;
  width?: number;
  opacity?: number;
  /** Скругление углов: у прямоугольников и картинок. */
  radius?: number;
  /** Начертание — у текста и надписей фигур. */
  bold?: boolean;
  italic?: boolean;
  /** Кегль текста и надписей фигур; 0 — у надписи фигуры снова подбирается под её размер. */
  size?: number;
  /** Выравнивание надписи внутри фигуры. */
  align?: TextAlign;
  valign?: TextVAlign;
}

/** Элемент с применённым стилем; тот же объект — если к нему ничего не относится. */
function styledElement(el: Element, p: StylePatch): Element {
  if (el.type === 'note' || el.type === 'task') return el;
  const set: Record<string, unknown> = {};
  if (el.type === 'image') {
    // цвет, толщина и прозрачность у картинки — это её рамка: недостающее берём из текущего стиля
    if (p.color !== undefined || p.width !== undefined || p.opacity !== undefined) {
      set.color = p.color ?? el.color ?? state.style.color;
      set.width = p.width ?? el.width ?? state.style.width;
    }
  } else {
    if (p.color !== undefined) set.color = p.color;
    // у текста толщины нет
    if (p.width !== undefined && el.type !== 'text') set.width = p.width;
    const caption = shapeHoldsText(el);
    if (el.type === 'text' || caption) {
      if (p.bold !== undefined) set.bold = p.bold;
      if (p.italic !== undefined) set.italic = p.italic;
    }
    if (el.type === 'text' && p.size) set.size = p.size;
    // общий цвет/начертание блока перекрывают отдельные фрагменты
    if (el.type === 'text' && el.runs) {
      let runs = el.runs;
      if (p.color !== undefined) runs = clearRunField(runs, 'color', el.text.length) ?? [];
      if (p.bold !== undefined) runs = clearRunField(runs, 'bold', el.text.length) ?? [];
      if (p.italic !== undefined) runs = clearRunField(runs, 'italic', el.text.length) ?? [];
      if (runs !== el.runs) set.runs = runs.length > 0 ? runs : undefined;
    }
    if (caption) {
      if (p.size !== undefined) set.textSize = p.size;
      if (p.align !== undefined) set.align = p.align;
      if (p.valign !== undefined) set.valign = p.valign;
    }
  }
  if (p.fill !== undefined && el.type === 'shape' && el.shape !== 'line' && el.shape !== 'arrow') set.fill = p.fill;
  if (el.type === 'shape' && el.shape !== 'line' && el.shape !== 'arrow') {
    if (p.fillOpacity !== undefined) set.fillOpacity = p.fillOpacity;
    else if (p.opacity !== undefined && el.fillOpacity === undefined) set.fillOpacity = el.opacity ?? 1;
  }
  if (p.opacity !== undefined) set.opacity = p.opacity;
  if (p.radius !== undefined && (el.type === 'image' || (el.type === 'shape' && el.shape === 'rect'))) set.radius = p.radius;
  if (Object.keys(set).length === 0) return el;
  const out: Record<string, unknown> = { ...el, ...set };
  // значения по умолчанию не храним
  if (typeof out.opacity === 'number' && out.opacity >= 1) delete out.opacity;
  if (out.radius === 0) delete out.radius;
  if ('runs' in out && out.runs === undefined) delete out.runs;
  if (out.fill === null) delete out.fill;
  if (el.type === 'shape') {
    if (out.textSize === 0) delete out.textSize;
    if (out.align === 'center') delete out.align;
    if (out.valign === 'middle') delete out.valign;
    if (out.bold === false) delete out.bold;
    if (out.italic === false) delete out.italic;
  }
  return out as unknown as Element;
}

/**
 * Применяет цвет/толщину/прозрачность/скругление/начертание к выделенным элементам.
 * history = false — продолжение того же жеста (ползунок тянут): шаг истории уже записан.
 */
export function applyStyleToSelection(patch: StylePatch, history = true): void {
  if (state.selection.size === 0) return;
  const prev = state.board.elements;
  const next = prev.map(el => (state.selection.has(el.id) ? styledElement(el, patch) : el));
  if (next.every((el, i) => el === prev[i])) return;
  if (history) pushHistory(prev);
  replaceElements(next);
}

/** Перекрашивает конкретный объект, не меняя выделение. */
export function colorElement(id: string, color: string, fill: boolean): void {
  const prev = state.board.elements;
  const next = prev.map(el => {
    if (el.id !== id) return el;
    if (el.type === 'note') return { ...el, color };
    if (el.type === 'task') return el;
    const useFill = fill && el.type === 'shape' && el.shape !== 'line' && el.shape !== 'arrow';
    return styledElement(el, useFill ? { fill: color } : { color });
  });
  if (next.every((el, i) => el === prev[i])) return;
  pushHistory(prev);
  replaceElements(next);
}

/** Убирает рамку у выделенных картинок (запись в историю). */
export function removeImageFrames(): void {
  const framed = (e: Element) => state.selection.has(e.id) && e.type === 'image' && e.color !== undefined;
  if (!state.board.elements.some(framed)) return;
  pushHistory(state.board.elements);
  replaceElements(state.board.elements.map(el => {
    if (!framed(el) || el.type !== 'image') return el;
    const copy = { ...el };
    delete copy.color;
    delete copy.width;
    delete copy.opacity;
    return copy;
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
export function setStyleOpacity(v: number): void { setOpacityOf(state.style, v); setOpacityOf(activePreset(), v); update(); }
export function setNoteColor(color: string): void { state.noteColor = color; update(); }

export function setGrid(grid: GridMode): void {
  state.board.grid = grid;
  update(true);
}

/** Подписи делений координатной плоскости — часть фона страницы, видны всем участникам. */
export function setCoordLabels(show: boolean): void {
  if (show) delete state.board.coordLabels;
  else state.board.coordLabels = false;
  update(true);
}

export function setSettings(patch: Partial<BoardSettings>): void {
  state.settings = { ...state.settings, ...patch };
  update();
}

// ----- Живой штрих -----

export function beginStroke(tool: 'pen' | 'highlighter', pt: Pt): void {
  state.liveStroke = { tool, color: state.style.color, width: state.style.width, ...opacityField(state.style.opacity), pts: [pt] };
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
  addElement({ id: uid(), type: 'stroke', tool: ls.tool, color: ls.color, width: base, ...opacityField(ls.opacity), pts: ls.pts });
}

/** Завершает построение ломаной (closed=true замыкает контур); готовая ломаная сразу выделена. */
export function commitPoly(closed: boolean): void {
  const lp = state.livePoly;
  state.livePoly = null;
  if (!lp) { update(); return; }
  const pts = lp.pts.slice();
  // убираем дубли в конце (двойной клик добавляет ту же точку дважды)
  while (pts.length > 1 && Math.hypot(pts[pts.length - 1].x - pts[pts.length - 2].x, pts[pts.length - 1].y - pts[pts.length - 2].y) < 1) pts.pop();
  const min = closed ? 3 : 2;
  if (pts.length < min) { update(); return; }
  const el: Element = { id: uid(), type: 'poly', closed, color: state.style.color, width: state.style.width * 1.1, ...opacityField(state.style.opacity), pts };
  addElement(el);
  if (stickyTool() === state.tool) { update(); return; } // массовое добавление: инструмент остаётся
  selectInserted(el.id);
}

/** Вставленный элемент сразу выделен — и включено выделение, чтобы его можно было двигать и править. */
export function selectInserted(...ids: string[]): void {
  setTool('select');
  setSelection(ids);
}

// ----- Проекты и страницы -----

export { blankProject, blankPage };

export function projectMeta(p: Project): ProjectMeta {
  return {
    id: p.id, name: p.name, createdAt: p.createdAt, updatedAt: p.updatedAt, pageCount: p.pages.length,
    ...(p.pinned ? { pinned: true } : {}),
    ...(p.icon ? { icon: p.icon } : {}),
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
  const sameProject = project.id === state.project.id;
  // черновики принадлежат открытому проекту: в другом их нет
  if (!sameProject) { state.drafts = []; state.hold = null; }
  // Старые проекты не хранили привязку штрихов и стикеров — фиксируем её по текущему положению.
  for (const page of project.pages) page.elements = freezeAttachments(page.elements);
  state.project = project;
  const draft = sameProject && pageId ? state.drafts.find(d => d.id === pageId) : undefined;
  if (draft) {
    state.pageId = draft.id;
    state.board = draft;
  } else {
    state.pageId = pageId && project.pages.some(p => p.id === pageId) ? pageId : project.pages[0].id;
    state.board = project.pages.find(p => p.id === state.pageId) ?? project.pages[0];
    state.hold = null;
  }
  state.selection = new Set();
  state.liveStroke = null;
  state.liveShape = null;
  state.liveSolid = null;
  state.livePoly = null;
  state.liveNote = null;
  state.liveEdit = false;
  state.marquee = null;
  state.spread = null;
  resetHistory('Начало сеанса');
  state.dirty = false;
  state.view = view;
  update();
}

export function setView(view: 'home' | 'board'): void {
  state.view = view;
  update();
}

/** Окно демонстрации остаётся на прежней настоящей странице, пока автор уходит в черновик, и отпускается при возврате. */
function holdOrRelease(toDraft: boolean): void {
  if (!toDraft) state.hold = null;
  else if (!state.hold) state.hold = { pageId: state.pageId, camera: { ...state.camera } };
}

export function switchPage(pageId: string): void {
  const page = state.project.pages.find(p => p.id === pageId) ?? state.drafts.find(d => d.id === pageId);
  if (!page || pageId === state.pageId) return;
  holdOrRelease(isDraftId(pageId));
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
  state.spread = null;
  resetHistory('Открыта страница');
  update();
}

export const PAGE_LIMIT_TEXT = 'На бесплатном тарифе доступно до 3 страниц в проекте';

/** Тариф проекта: его ownerPlan; у старых проектов без него — free (тариф пользователя на них не переносится). */
export function projectPlan(project: { ownerPlan?: unknown }): PlanTier {
  return planOf(project);
}

/** Можно ли добавить в проект страницу: лимит действует, только когда лимиты включены. Черновики в него не входят. */
export function canAddPageTo(project: Project): boolean {
  return !limitsEnforced() || canCreatePage(projectPlan(project), project.pages.length);
}

/** Новая страница в открытом проекте; null — лимит тарифа (страница не создаётся). */
export function addPage(): Page | null {
  if (!canAddPageTo(state.project)) return null;
  const page = blankPage(`Страница ${state.project.pages.length + 1}`);
  state.project = { ...state.project, pages: [...state.project.pages, page] };
  state.pageId = page.id;
  state.board = page;
  state.selection = new Set();
  resetHistory('Создана страница');
  update(true);
  return page;
}

/** Новый пустой черновик: открывается сразу, в проект не попадает. */
export function addDraft(): Page {
  draftSeq++;
  const page = blankPage(draftSeq === 1 ? 'Черновик' : `Черновик ${draftSeq}`);
  holdOrRelease(true);
  state.drafts = [...state.drafts, page];
  state.pageId = page.id;
  state.board = page;
  state.selection = new Set();
  state.liveEdit = false;
  state.spread = null;
  resetHistory('Создан черновик');
  update();
  return page;
}
let draftSeq = 0;

/** Удаляет черновик; если он был открыт — возвращает на страницу, с которой в него ушли. */
export function deleteDraft(pageId: string): void {
  if (!isDraftId(pageId)) return;
  state.drafts = state.drafts.filter(d => d.id !== pageId);
  if (state.drafts.length === 0) draftSeq = 0;
  if (state.pageId === pageId) {
    const back = state.project.pages.find(p => p.id === state.hold?.pageId) ?? state.project.pages[0];
    state.pageId = back.id;
    state.board = back;
    state.hold = null;
    state.selection = new Set();
    state.liveEdit = false;
    state.spread = null;
    resetHistory('Открыта страница');
  }
  update();
}

export function deletePage(pageId: string): void {
  let pages = state.project.pages.filter(p => p.id !== pageId);
  if (pages.length === 0) pages = [blankPage('Страница 1')];
  state.project = { ...state.project, pages };
  if (state.hold?.pageId === pageId) state.hold = { ...state.hold, pageId: pages[0].id };
  if (state.pageId === pageId) {
    state.pageId = pages[0].id;
    state.board = pages[0];
    resetHistory('Открыта страница');
  }
  update(true);
}

export function renamePage(pageId: string, name: string): void {
  if (isDraftId(pageId)) {
    state.drafts = state.drafts.map(d => (d.id === pageId ? { ...d, name } : d));
    if (pageId === state.pageId) state.board = state.drafts.find(d => d.id === pageId)!;
    update();
    return;
  }
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

/** Рассчитывает положение выделения, не изменяя проект. */
export function selectionLayerOrder(old: Element[], position: number): Element[] {
  const selected = old.filter(e => state.selection.has(e.id));
  if (!selected.length) return old;
  const rest = old.filter(e => !state.selection.has(e.id));
  const movable = selected.map(e => {
    if (!e.layerPin) return e;
    const { layerPin: _pin, ...item } = e;
    return item as Element;
  });
  const low = rest.filter(e => e.layerPin === 'bottom').length;
  const high = rest.length - rest.filter(e => e.layerPin === 'top').length;
  const at = Math.max(low, Math.min(high, position));
  return [...rest.slice(0, at), ...movable, ...rest.slice(at)];
}

/** Перемещает выделение как группу, снимая закрепление при ручном перемещении. */
export function moveSelectionLayer(position: number): void {
  const old = state.board.elements;
  const next = selectionLayerOrder(old, position);
  if (next.every((e, i) => e === old[i])) return;
  pushHistory(old);
  replaceElements(next);
}

export function pinSelectionLayer(pin: 'top' | 'bottom' | null): void {
  const old = state.board.elements;
  if (!old.some(e => state.selection.has(e.id) && (e.layerPin ?? null) !== pin)) return;
  pushHistory(old);
  replaceElements(old.map(e => {
    if (!state.selection.has(e.id)) return e;
    const { layerPin: _pin, ...item } = e;
    return pin ? { ...item, layerPin: pin } as Element : item as Element;
  }));
}

function stepSelectionLayer(up: boolean): void {
  const old = state.board.elements;
  if (!old.some(e => state.selection.has(e.id))) return;
  const arr = old.map(e => {
    if (!state.selection.has(e.id) || !e.layerPin) return e;
    const { layerPin: _pin, ...item } = e;
    return item as Element;
  });
  if (up) {
    for (let i = arr.length - 2; i >= 0; i--) {
      if (state.selection.has(arr[i].id) && !state.selection.has(arr[i + 1].id) && arr[i + 1].layerPin !== 'top') {
        [arr[i], arr[i + 1]] = [arr[i + 1], arr[i]];
      }
    }
  } else {
    for (let i = 1; i < arr.length; i++) {
      if (state.selection.has(arr[i].id) && !state.selection.has(arr[i - 1].id) && arr[i - 1].layerPin !== 'bottom') {
        [arr[i], arr[i - 1]] = [arr[i - 1], arr[i]];
      }
    }
  }
  if (arr.every((e, i) => e === old[i])) return;
  pushHistory(old);
  replaceElements(arr);
}

export function bringForward(): void { stepSelectionLayer(true); }
export function sendBackward(): void { stepSelectionLayer(false); }

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

export const FADE_STROKE_DELAY_MS = 2000;

/** Общее время отрыва для всех видимых штрихов одного автора. */
export function setFadeStrokeEnd(by: number | undefined, endT: number | null): void {
  const now = endT ?? performance.now();
  for (const stroke of state.fadeStrokes) {
    if (stroke.by !== by) continue;
    if (stroke.endT === null || (endT === null && now - stroke.endT < FADE_STROKE_DELAY_MS)) {
      stroke.endT = endT;
    }
  }
}
