// Каталог инструментов и пользовательская настройка панели инструментов:
// порядок кнопок, именованные группы, скрытые инструменты и горячие клавиши.
// Операции над настройкой чистые: возвращают новую настройку, старую не трогают.

import type { ToolId } from './types';

export const svg = (paths: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

/** Невидимые линии на иконках тел — пунктиром, как на холсте. */
const hid = (d: string) => `<path d="${d}" stroke-dasharray="2.2 2" stroke-width="1.4"/>`;

export interface ToolDef { id: ToolId; title: string; icon: string }

/** Контуры иконки ластика (24×24): из них же курсор объектного ластика на холсте. */
export const ERASER_PATHS = ['M20 20H8.5L3.6 15.1a2 2 0 0 1 0-2.8l8.6-8.6a2 2 0 0 1 2.8 0l6 6a2 2 0 0 1 0 2.8L13.5 19', 'M7 10.5l6.5 6.5'];
/** Середина стирающего края иконки — горячая точка курсора ластика. */
export const ERASER_TIP = { x: 6, y: 18 };

/** Все инструменты в порядке по умолчанию. */
export const TOOL_DEFS: ToolDef[] = [
  { id: 'select', title: 'Выделение и перемещение', icon: svg('<path d="M5 3l15 8-6.4 1.7L11 20z"/>') },
  { id: 'pan', title: 'Панорама', icon: svg('<path d="M12 3v18M3 12h18"/><path d="M9.5 5.5L12 3l2.5 2.5M9.5 18.5L12 21l2.5-2.5M5.5 9.5L3 12l2.5 2.5M18.5 9.5L21 12l-2.5 2.5"/>') },
  { id: 'pen', title: 'Перо', icon: svg('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>') },
  { id: 'highlighter', title: 'Маркер', icon: svg('<path d="M9 11l-6 6v3h3l6-6"/><path d="M17.5 2.5l4 4L11 17l-4-4z"/>') },
  { id: 'eraser', title: 'Ластик', icon: svg(ERASER_PATHS.map(d => `<path d="${d}"/>`).join('')) },
  // стирает часть линии: маленький ластик над разрывом волнистой линии
  { id: 'partEraser', title: 'Ластик для пера и маркера', icon: svg('<path d="M10 12.5l5.6-5.6a1.6 1.6 0 0 1 2.3 0l1.6 1.6a1.6 1.6 0 0 1 0 2.3L14.5 15.8H11.6l-1.6-1.6a1.2 1.2 0 0 1 0-1.7z"/><path d="M2.5 19.5c1.5-1.5 2.8-1.5 4.2 0"/><path d="M16.8 19.5c1.5 1.5 3 1.5 4.7 0"/>') },
  { id: 'text', title: 'Текст', icon: svg('<path d="M5 7V5h14v2"/><path d="M12 5v14"/><path d="M9 19h6"/>') },
  { id: 'note', title: 'Стикер', icon: svg('<rect x="4" y="5" width="16" height="14" rx="2"/><path d="M8 9.5h8"/><path d="M8 13h5"/>') },
  // фигуры
  { id: 'rect', title: 'Прямоугольник', icon: svg('<rect x="4" y="6" width="16" height="12" rx="1.5"/>') },
  { id: 'ellipse', title: 'Эллипс', icon: svg('<ellipse cx="12" cy="12" rx="8.5" ry="6.5"/>') },
  { id: 'triangle', title: 'Треугольник', icon: svg('<path d="M12 4.5L20.5 19H3.5z"/>') },
  { id: 'line', title: 'Линия', icon: svg('<path d="M5 19L19 5"/>') },
  { id: 'arrow', title: 'Стрелка', icon: svg('<path d="M5 19L18 6"/><path d="M12 6h6v6"/>') },
  { id: 'poly', title: 'Ломаная / многоугольник', icon: svg('<path d="M4 18l5-10 6 7 5-9"/>') },
  // стереометрия: каркасные тела с пунктиром невидимых рёбер
  { id: 'cube', title: 'Куб', icon: svg('<path d="M4 9h11v11H4z"/><path d="M4 9l5-5h11l-5 5M20 4v11l-5 5"/>' + hid('M9 4v11h11M4 20l5-5')) },
  { id: 'box', title: 'Параллелепипед', icon: svg('<path d="M2.5 11h14v9h-14z"/><path d="M2.5 11l5-5h14l-5 5M21.5 6v9l-5 5"/>' + hid('M7.5 6v9h14M2.5 20l5-5')) },
  { id: 'prism', title: 'Призма', icon: svg('<path d="M6 4h13l-10.5 4z"/><path d="M6 4v13l2.5 4L19 17V4M8.5 8v13"/>' + hid('M6 17h13')) },
  { id: 'pyramid', title: 'Пирамида', icon: svg('<path d="M3 20h12l5-5M3 20l8.5-17L15 20M11.5 3L20 15"/>' + hid('M20 15H8l-5 5M8 15l3.5-12')) },
  { id: 'truncPyramid', title: 'Усечённая пирамида', icon: svg('<path d="M6 8h7l3-3H9z"/><path d="M2 20h13l6-5M2 20L6 8M15 20L13 8M21 15L16 5"/>' + hid('M21 15H8l-6 5M8 15L9 5')) },
  { id: 'cylinder', title: 'Цилиндр', icon: svg('<ellipse cx="12" cy="5" rx="7" ry="2.5"/><path d="M5 5v14M19 5v14M5 19a7 2.5 0 0 0 14 0"/>' + hid('M5 19a7 2.5 0 0 1 14 0')) },
  { id: 'cone', title: 'Конус', icon: svg('<path d="M4 19L12 3l8 16M4 19a8 2.8 0 0 0 16 0"/>' + hid('M4 19a8 2.8 0 0 1 16 0')) },
  { id: 'truncCone', title: 'Усечённый конус', icon: svg('<ellipse cx="12" cy="6" rx="4" ry="1.5"/><path d="M8 6L4 19M16 6l4 13M4 19a8 2.8 0 0 0 16 0"/>' + hid('M4 19a8 2.8 0 0 1 16 0')) },
  { id: 'sphere', title: 'Шар', icon: svg('<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12a8.5 3 0 0 0 17 0"/>' + hid('M3.5 12a8.5 3 0 0 1 17 0')) },
  // указка: показать, не оставляя следов на доске
  { id: 'laser', title: 'Лазерная указка', icon: svg('<circle cx="15" cy="9" r="2.6"/><path d="M15 2.5v1.8M21.5 9h-1.8M19.6 4.4l-1.3 1.3"/><path d="M3 21c4.5-1.2 8-4.2 10.2-8.6"/>') },
  { id: 'fadePen', title: 'Исчезающий маркер', icon: svg('<path d="M18 2.5l3.5 3.5-8.5 8.5-3.5-3.5z"/><path d="M9.5 11l-4 4v2.5H8l4-4"/><path d="M3 21h4"/><path d="M10 21h3" opacity=".55"/><path d="M16 21h2" opacity=".25"/>') },
  { id: 'flash', title: 'Подсветка объектов', icon: svg('<rect x="7.5" y="7.5" width="9" height="9" rx="2"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>') },
];

const DEF_BY_ID = new Map(TOOL_DEFS.map(t => [t.id, t]));

/** Инструменты без цвета: у стикеров своя палитра, указка и подсветка — фиксированного цвета. */
const COLORLESS_TOOLS = new Set<ToolId>(['select', 'pan', 'eraser', 'partEraser', 'note', 'laser', 'flash']);

/** Нужен ли инструменту выбор цвета и толщины на панели инструментов. */
export function toolUsesColor(id: ToolId): boolean {
  return !COLORLESS_TOOLS.has(id);
}

export function toolDef(id: ToolId): ToolDef {
  return DEF_BY_ID.get(id)!;
}

function isTool(v: unknown): v is ToolId {
  return typeof v === 'string' && DEF_BY_ID.has(v as ToolId);
}

// ----- Горячие клавиши -----

/** Клавиши по KeyboardEvent.code: работают при любой раскладке. */
const DEFAULT_KEYS: Partial<Record<ToolId, string>> = {
  select: 'KeyV', pan: 'KeyH', pen: 'KeyP', highlighter: 'KeyM', eraser: 'KeyE', partEraser: 'KeyX', text: 'KeyT', note: 'KeyN',
  rect: 'KeyR', ellipse: 'KeyO', triangle: 'KeyY', line: 'KeyL', arrow: 'KeyA', poly: 'KeyK', laser: 'KeyI',
};

/** Клавиши без модификаторов, которые занимает само приложение. */
const RESERVED_KEYS: Record<string, string> = { KeyB: 'список страниц', Digit0: 'показать всё содержимое' };

/** «KeyR» → «R», «Digit3» → «3». */
export function keyLabel(code: string): string {
  return code.replace(/^(Key|Digit)/, '');
}

/** Почему клавишу нельзя назначить инструменту; null — можно. */
export function keyProblem(code: string): string | null {
  if (code in RESERVED_KEYS) return `Клавиша ${keyLabel(code)} занята: ${RESERVED_KEYS[code]}`;
  if (!/^(Key[A-Z]|Digit[1-9])$/.test(code)) return 'Подойдёт буква или цифра от 1 до 9';
  return null;
}

// ----- Настройка панели -----

export interface ToolbarGroup { type: 'group'; id: string; name: string; tools: ToolId[] }
export type ToolbarItem = { type: 'tool'; id: ToolId } | ToolbarGroup;
export type ToolbarList = 'items' | 'hidden';

export interface ToolbarConfig {
  /** Кнопки панели по порядку: инструменты и группы. */
  items: ToolbarItem[];
  /** Убранное с панели. Скрытые инструменты по-прежнему включаются горячей клавишей. */
  hidden: ToolbarItem[];
  /** Горячая клавиша инструмента (KeyboardEvent.code); нет записи — без клавиши. */
  keys: Partial<Record<ToolId, string>>;
}

/** Инструмент или группа целиком — то, что перетаскивают в настройке. */
export type EntryRef = { tool: ToolId } | { group: string };

export const GROUP_NAME_MAX = 40;
/** id группы попадает в id кнопки и data-ctx тулбара: только безопасные символы. */
const GROUP_ID_RE = /^[a-z][\w-]{0,39}$/i;
const CTX_KINDS = new Set(['style', 'note']);

export function defaultToolbar(): ToolbarConfig {
  const tool = (id: ToolId): ToolbarItem => ({ type: 'tool', id });
  return {
    items: [
      tool('select'), tool('pan'), tool('pen'), tool('highlighter'), tool('eraser'), tool('partEraser'), tool('text'), tool('note'),
      { type: 'group', id: 'shapes', name: 'Фигуры', tools: ['rect', 'ellipse', 'triangle', 'line', 'arrow', 'poly'] },
      { type: 'group', id: 'solids', name: 'Стереометрия', tools: ['cube', 'box', 'prism', 'pyramid', 'truncPyramid', 'cylinder', 'cone', 'truncCone', 'sphere'] },
      { type: 'group', id: 'pointer', name: 'Указка', tools: ['laser', 'fadePen', 'flash'] },
    ],
    hidden: [],
    keys: { ...DEFAULT_KEYS },
  };
}

function allGroups(cfg: ToolbarConfig): ToolbarGroup[] {
  return [...cfg.items, ...cfg.hidden].filter((it): it is ToolbarGroup => it.type === 'group');
}

function newGroupId(cfg: ToolbarConfig): string {
  const taken = new Set(allGroups(cfg).map(g => g.id));
  for (let n = 1; ; n++) {
    const id = `grp-${n}`;
    if (!taken.has(id)) return id;
  }
}

/** «Группа 1», «Группа 2», … — первое свободное название. */
export function nextGroupName(cfg: ToolbarConfig): string {
  const taken = new Set(allGroups(cfg).map(g => g.name));
  for (let n = 1; ; n++) {
    const name = `Группа ${n}`;
    if (!taken.has(name)) return name;
  }
}

/**
 * Приводит сохранённое (или битое) значение к корректной настройке: каждый инструмент — ровно
 * один раз, у групп уникальные безопасные id, клавиши не повторяются. Инструменты, которых
 * в сохранённой настройке нет (появились в новой версии), встают в свою группу по умолчанию.
 */
export function sanitizeToolbar(raw: unknown): ToolbarConfig {
  const def = defaultToolbar();
  if (!raw || typeof raw !== 'object') return def;
  const r = raw as Record<string, unknown>;
  const seen = new Set<ToolId>();
  const groupIds = new Set<string>();
  const cfg: ToolbarConfig = { items: [], hidden: [], keys: {} };
  const readList = (v: unknown, out: ToolbarItem[]) => {
    if (!Array.isArray(v)) return;
    for (const it of v as Record<string, unknown>[]) {
      if (!it || typeof it !== 'object') continue;
      if (it.type === 'tool' && isTool(it.id) && !seen.has(it.id)) {
        seen.add(it.id);
        out.push({ type: 'tool', id: it.id });
      } else if (it.type === 'group') {
        const tools: ToolId[] = [];
        for (const t of Array.isArray(it.tools) ? it.tools : []) {
          if (isTool(t) && !seen.has(t)) { seen.add(t); tools.push(t); }
        }
        const okId = typeof it.id === 'string' && GROUP_ID_RE.test(it.id) && !CTX_KINDS.has(it.id) && !groupIds.has(it.id);
        // out — это cfg.items или cfg.hidden: уже прочитанные группы newGroupId видит
        const id = okId ? it.id as string : newGroupId(cfg);
        groupIds.add(id);
        const name = typeof it.name === 'string' && it.name.trim() ? it.name.trim().slice(0, GROUP_NAME_MAX) : 'Группа';
        out.push({ type: 'group', id, name, tools });
      }
    }
  };
  readList(r.items, cfg.items);
  readList(r.hidden, cfg.hidden);
  for (const [i, it] of def.items.entries()) {
    if (it.type === 'tool') {
      if (seen.has(it.id)) continue;
      // новый инструмент — за соседом по умолчанию (новый ластик — за обычным), иначе в конец
      const prev = def.items[i - 1];
      const at = prev?.type === 'tool' ? cfg.items.findIndex(x => x.type === 'tool' && x.id === prev.id) : -1;
      if (at >= 0) cfg.items.splice(at + 1, 0, it);
      else cfg.items.push(it);
      continue;
    }
    const home = allGroups(cfg).find(g => g.id === it.id);
    for (const t of it.tools) {
      if (seen.has(t)) continue;
      if (home) home.tools.push(t);
      else cfg.items.push({ type: 'tool', id: t });
    }
  }
  // сохранённые клавиши — первыми: клавиша по умолчанию нового инструмента не отнимет уже назначенную
  const rawKeys = r.keys && typeof r.keys === 'object' ? r.keys as Record<string, unknown> : {};
  const used = new Set<string>();
  for (const { id } of TOOL_DEFS) {
    if (!Object.hasOwn(rawKeys, id)) continue;
    const k = rawKeys[id];
    if (typeof k === 'string' && !keyProblem(k) && !used.has(k)) { cfg.keys[id] = k; used.add(k); }
  }
  for (const { id } of TOOL_DEFS) {
    const k = DEFAULT_KEYS[id];
    if (!Object.hasOwn(rawKeys, id) && k && !used.has(k)) { cfg.keys[id] = k; used.add(k); }
  }
  return cfg;
}

/** Для хранения: снятая клавиша — явный null, чтобы при загрузке не вернулась клавиша по умолчанию. */
function serializeToolbar(cfg: ToolbarConfig): unknown {
  return { ...cfg, keys: Object.fromEntries(TOOL_DEFS.map(t => [t.id, cfg.keys[t.id] ?? null])) };
}

// ----- Операции над настройкой -----

function sameRef(a: EntryRef, b: EntryRef): boolean {
  return 'tool' in a ? 'tool' in b && a.tool === b.tool : 'group' in b && a.group === b.group;
}

function refOf(it: ToolbarItem): EntryRef {
  return it.type === 'tool' ? { tool: it.id } : { group: it.id };
}

/** Вынимает инструмент (из списка или группы) или группу; возвращает вынутое как элемент панели. */
function detach(cfg: ToolbarConfig, ref: EntryRef): ToolbarItem | null {
  for (const list of [cfg.items, cfg.hidden]) {
    for (let i = 0; i < list.length; i++) {
      const it = list[i];
      if (sameRef(refOf(it), ref)) return list.splice(i, 1)[0];
      if ('tool' in ref && it.type === 'group') {
        const j = it.tools.indexOf(ref.tool);
        if (j >= 0) {
          it.tools.splice(j, 1);
          return { type: 'tool', id: ref.tool };
        }
      }
    }
  }
  return null;
}

/** Куда положить перетаскиваемое: в список или в группу, перед before (null — в конец). */
export interface EntryDrop { list: ToolbarList; group?: string; before: EntryRef | null }

export function moveEntry(cfg: ToolbarConfig, ref: EntryRef, drop: EntryDrop): ToolbarConfig {
  if (drop.before && sameRef(drop.before, ref)) return cfg;
  // группы не вкладываются друг в друга
  if (drop.group && 'group' in ref) return cfg;
  const next = structuredClone(cfg);
  const item = detach(next, ref);
  if (!item) return cfg;
  if (drop.group) {
    const g = allGroups(next).find(x => x.id === drop.group);
    if (!g || item.type !== 'tool') return cfg;
    const i = drop.before && 'tool' in drop.before ? g.tools.indexOf(drop.before.tool) : -1;
    g.tools.splice(i < 0 ? g.tools.length : i, 0, item.id);
  } else {
    const list = next[drop.list];
    const before = drop.before;
    const i = before ? list.findIndex(it => sameRef(refOf(it), before)) : -1;
    list.splice(i < 0 ? list.length : i, 0, item);
  }
  return next;
}

/** Инструмент, брошенный на другой (верхнего уровня), вместе с ним становится новой группой. */
export function combineTools(cfg: ToolbarConfig, target: ToolId, dragged: ToolId, name: string): { cfg: ToolbarConfig; group: string | null } {
  if (target === dragged) return { cfg, group: null };
  const next = structuredClone(cfg);
  if (!detach(next, { tool: dragged })) return { cfg, group: null };
  for (const list of [next.items, next.hidden]) {
    const i = list.findIndex(it => it.type === 'tool' && it.id === target);
    if (i < 0) continue;
    const id = newGroupId(next);
    list[i] = { type: 'group', id, name: name.trim().slice(0, GROUP_NAME_MAX) || 'Группа', tools: [target, dragged] };
    return { cfg: next, group: id };
  }
  return { cfg, group: null };
}

/** Пустая группа в конце панели — в неё перетаскивают инструменты. */
export function addGroup(cfg: ToolbarConfig, name: string): { cfg: ToolbarConfig; group: string } {
  const next = structuredClone(cfg);
  const id = newGroupId(next);
  next.items.push({ type: 'group', id, name: name.trim().slice(0, GROUP_NAME_MAX) || 'Группа', tools: [] });
  return { cfg: next, group: id };
}

export function renameGroup(cfg: ToolbarConfig, id: string, name: string): ToolbarConfig {
  const v = name.trim().slice(0, GROUP_NAME_MAX);
  const g = allGroups(cfg).find(x => x.id === id);
  if (!v || !g || g.name === v) return cfg;
  const next = structuredClone(cfg);
  allGroups(next).find(x => x.id === id)!.name = v;
  return next;
}

/** Группа распадается: её инструменты встают на её место. */
export function ungroup(cfg: ToolbarConfig, id: string): ToolbarConfig {
  const next = structuredClone(cfg);
  for (const list of [next.items, next.hidden]) {
    const i = list.findIndex(it => it.type === 'group' && it.id === id);
    if (i < 0) continue;
    const g = list[i] as ToolbarGroup;
    list.splice(i, 1, ...g.tools.map((t): ToolbarItem => ({ type: 'tool', id: t })));
    return next;
  }
  return cfg;
}

/** Убрать с панели (или вернуть на неё): в конец другого списка; инструмент при этом покидает свою группу. */
export function setEntryHidden(cfg: ToolbarConfig, ref: EntryRef, hidden: boolean): ToolbarConfig {
  const to = hidden ? cfg.hidden : cfg.items;
  if (to.some(it => sameRef(refOf(it), ref))) return cfg;
  return moveEntry(cfg, ref, { list: hidden ? 'hidden' : 'items', before: null });
}

/** Назначает клавишу (null — снять); у инструмента, которому она принадлежала, клавиша снимается. */
export function setToolKey(cfg: ToolbarConfig, tool: ToolId, code: string | null): { cfg: ToolbarConfig; displaced: ToolId | null } {
  if (code && keyProblem(code)) return { cfg, displaced: null };
  const keys = { ...cfg.keys };
  let displaced: ToolId | null = null;
  for (const [id, k] of Object.entries(keys) as [ToolId, string][]) {
    if (k === code && id !== tool) { delete keys[id]; displaced = id; }
  }
  if (code) keys[tool] = code;
  else delete keys[tool];
  return { cfg: { ...cfg, keys }, displaced };
}

// ----- Текущая настройка -----

const TOOLBAR_KEY = 'doska.toolbar';
let current: ToolbarConfig = defaultToolbar();
const listeners = new Set<() => void>();

export function toolbarConfig(): ToolbarConfig {
  return current;
}

export function restoreToolbar(): void {
  try {
    current = sanitizeToolbar(JSON.parse(localStorage.getItem(TOOLBAR_KEY) || 'null'));
  } catch {
    current = defaultToolbar();
  }
}

export function setToolbarConfig(cfg: ToolbarConfig): void {
  if (cfg === current) return;
  current = cfg;
  localStorage.setItem(TOOLBAR_KEY, JSON.stringify(serializeToolbar(cfg)));
  for (const fn of listeners) fn();
}

export function onToolbarChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** Инструмент по нажатой клавише (в том числе скрытый с панели). */
export function toolByKey(code: string): ToolId | null {
  for (const [id, k] of Object.entries(current.keys) as [ToolId, string][]) {
    if (k === code) return id;
  }
  return null;
}

/** Подсказка кнопки: «Перо (P)» или просто «Куб». */
export function toolTip(id: ToolId): string {
  const k = current.keys[id];
  return k ? `${toolDef(id).title} (${keyLabel(k)})` : toolDef(id).title;
}
