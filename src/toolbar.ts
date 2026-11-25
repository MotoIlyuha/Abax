// Каталог инструментов и пользовательская настройка панели инструментов:
// порядок кнопок, именованные группы, скрытые инструменты и горячие клавиши.
// Операции над настройкой чистые: возвращают новую настройку, старую не трогают.

import type { ToolId } from './types';
import { cursorSvg } from './cursors';
import { myCursorId } from './profile';
import { TOOL_ICONS } from './icons';

export interface ToolDef {
  id: ToolId; title: string; icon: string;
  /** Как пользоваться — дописывается к подсказке кнопки на панели. */
  hint?: string;
}

/** Все инструменты в порядке по умолчанию. */
export const TOOL_DEFS: ToolDef[] = [
  // вместо стандартной стрелки — персональный курсор пользователя (SPEC_NIGHT4 §4); разметка — из каталога
  { id: 'select', title: 'Выделение и перемещение', get icon() { return cursorSvg(myCursorId(), { size: 20, className: 'cursor-icon' }); } },
  { id: 'pan', title: 'Панорама', icon: TOOL_ICONS.pan },
  { id: 'pen', title: 'Перо', icon: TOOL_ICONS.pen },
  { id: 'highlighter', title: 'Маркер', icon: TOOL_ICONS.highlighter },
  { id: 'eraser', title: 'Ластик', icon: TOOL_ICONS.eraser },
  // стирает часть линии: маленький ластик над разрывом волнистой линии
  { id: 'partEraser', title: 'Ластик для пера и маркера', icon: TOOL_ICONS.partEraser },
  { id: 'text', title: 'Текст', icon: TOOL_ICONS.text },
  { id: 'stikyNote', title: 'Липкие стикеры', icon: TOOL_ICONS.stikyNote },
  // раздвинуть: всё, что ниже линии, уезжает вниз
  {
    id: 'spread', title: 'Раздвинуть',
    hint: 'нажмите на лист там, где не хватает места, и потяните вниз - всё, что ниже, сдвинется',
    icon: TOOL_ICONS.spread,
  },
  // фигуры
  { id: 'rect', title: 'Прямоугольник', icon: TOOL_ICONS.rect },
  { id: 'ellipse', title: 'Эллипс', icon: TOOL_ICONS.ellipse },
  { id: 'triangle', title: 'Треугольник', icon: TOOL_ICONS.triangle },
  { id: 'line', title: 'Линия', icon: TOOL_ICONS.line },
  { id: 'arrow', title: 'Стрелка', icon: TOOL_ICONS.arrow },
  { id: 'poly', title: 'Ломаная / многоугольник', icon: TOOL_ICONS.poly },
  // стереометрия: каркасные тела с пунктиром невидимых рёбер
  { id: 'cube', title: 'Куб', icon: TOOL_ICONS.cube },
  { id: 'box', title: 'Параллелепипед', icon: TOOL_ICONS.box },
  { id: 'prism', title: 'Призма', icon: TOOL_ICONS.prism },
  { id: 'pyramid', title: 'Пирамида', icon: TOOL_ICONS.pyramid },
  { id: 'truncPyramid', title: 'Усечённая пирамида', icon: TOOL_ICONS.truncPyramid },
  { id: 'cylinder', title: 'Цилиндр', icon: TOOL_ICONS.cylinder },
  { id: 'cone', title: 'Конус', icon: TOOL_ICONS.cone },
  { id: 'truncCone', title: 'Усечённый конус', icon: TOOL_ICONS.truncCone },
  { id: 'sphere', title: 'Шар', icon: TOOL_ICONS.sphere },
  // указка: показать, не оставляя следов на доске
  { id: 'laser', title: 'Лазерная указка', icon: TOOL_ICONS.laser },
  { id: 'fadePen', title: 'Исчезающий маркер', icon: TOOL_ICONS.fadePen },
  { id: 'comment', title: 'Комментировать', icon: TOOL_ICONS.comment },
  { id: 'flash', title: 'Подсветка объектов', icon: TOOL_ICONS.flash },
];

const DEF_BY_ID = new Map(TOOL_DEFS.map(t => [t.id, t]));

/** Инструменты без цвета: у липких стикеров своя палитра, подсветка — фиксированного цвета (у лазерной указки цвет выбирается). */
const COLORLESS_TOOLS = new Set<ToolId>(['select', 'pan', 'eraser', 'partEraser', 'stikyNote', 'task', 'comment', 'spread', 'flash']);

/** Нужен ли инструменту выбор цвета и толщины на панели инструментов. */
export function toolUsesColor(id: ToolId): boolean {
  return !COLORLESS_TOOLS.has(id);
}

export function toolDef(id: ToolId): ToolDef {
  return DEF_BY_ID.get(id)!;
}

function readTool(v: unknown): ToolId | null {
  if (v === 'note') return 'stikyNote';
  return typeof v === 'string' && DEF_BY_ID.has(v as ToolId) ? v as ToolId : null;
}

// ----- Горячие клавиши -----

/** Клавиши по KeyboardEvent.code: работают при любой раскладке. */
const DEFAULT_KEYS: Partial<Record<ToolId, string>> = {
  select: 'KeyV', pan: 'KeyH', pen: 'KeyP', highlighter: 'KeyM', eraser: 'KeyE', partEraser: 'KeyX', text: 'KeyT', stikyNote: 'KeyN', spread: 'KeyS',
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
const CTX_KINDS = new Set(['style', 'stikyNote', 'font', 'align']);

export function defaultToolbar(): ToolbarConfig {
  const tool = (id: ToolId): ToolbarItem => ({ type: 'tool', id });
  return {
    items: [
      tool('select'),
      { type: 'group', id: 'draw', name: 'Рисование', tools: ['pen', 'highlighter', 'eraser', 'partEraser'] },
      tool('text'), tool('stikyNote'), tool('spread'), tool('comment'),
      { type: 'group', id: 'shapes', name: 'Фигуры', tools: ['rect', 'ellipse', 'triangle', 'line', 'arrow', 'poly'] },
      { type: 'group', id: 'solids', name: 'Стереометрия', tools: ['cube', 'box', 'prism', 'pyramid', 'truncPyramid', 'cylinder', 'cone', 'truncCone', 'sphere'] },
      { type: 'group', id: 'pointer', name: 'Указка', tools: ['laser', 'fadePen', 'flash'] },
    ],
    // «Панорама» убрана с панели по умолчанию; включается горячей клавишей H
    hidden: [tool('pan')],
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
      if (it.type === 'tool') {
        const id = readTool(it.id);
        if (id && !seen.has(id)) { seen.add(id); out.push({ type: 'tool', id }); }
      } else if (it.type === 'group') {
        const tools: ToolId[] = [];
        for (const rawTool of Array.isArray(it.tools) ? it.tools : []) {
          const t = readTool(rawTool);
          if (t && !seen.has(t)) { seen.add(t); tools.push(t); }
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
  // инструменты, которых нет в сохранённой настройке и которые по умолчанию скрыты, остаются скрытыми
  for (const it of def.hidden) {
    if (it.type === 'tool' && !seen.has(it.id)) { seen.add(it.id); cfg.hidden.push(it); }
  }
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
    for (const [j, t] of it.tools.entries()) {
      if (seen.has(t)) continue;
      if (home) { home.tools.push(t); continue; }
      // группы в сохранённой настройке нет (её разобрали или она появилась позже): инструмент — за соседом по группе
      const prev = it.tools[j - 1];
      const at = prev ? cfg.items.findIndex(x => x.type === 'tool' && x.id === prev) : -1;
      if (at >= 0) cfg.items.splice(at + 1, 0, { type: 'tool', id: t });
      else cfg.items.push({ type: 'tool', id: t });
    }
  }
  // сохранённые клавиши — первыми: клавиша по умолчанию нового инструмента не отнимет уже назначенную
  const rawKeys = r.keys && typeof r.keys === 'object' ? { ...r.keys } as Record<string, unknown> : {};
  if (!Object.hasOwn(rawKeys, 'stikyNote') && Object.hasOwn(rawKeys, 'note')) rawKeys.stikyNote = rawKeys.note;
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

/** Подсказка кнопки: «Перо (P)» или просто «Куб»; с пояснением — «Раздвинуть: нажмите… (S)». */
export function toolTip(id: ToolId): string {
  const { title, hint } = toolDef(id);
  const text = hint ? `${title}: ${hint}` : title;
  const k = current.keys[id];
  return k ? `${text} (${keyLabel(k)})` : text;
}
