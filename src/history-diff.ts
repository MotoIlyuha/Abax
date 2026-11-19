// Подпись шага истории (режим «История изменений», SPEC_CHAT §8): что изменилось между двумя снимками
// элементов страницы. Без DOM. Элементы иммутабельны: та же ссылка — элемент не менялся, поэтому
// сравниваются по id и ссылке, а поля — только у изменённых.

import type { Element } from './types';

/** Форма слова для числа: 1 → 0 («объект»), 2–4 → 1 («объекта»), 5–20 → 2 («объектов»). */
export function pluralIndex(n: number): 0 | 1 | 2 {
  const a = Math.abs(Math.trunc(n));
  const d = a % 10, h = a % 100;
  if (d === 1 && h !== 11) return 0;
  if (d >= 2 && d <= 4 && (h < 12 || h > 14)) return 1;
  return 2;
}

/** «1 объект», «3 объекта», «5 объектов». */
export function plural(n: number, forms: readonly [string, string, string]): string {
  return forms[pluralIndex(n)];
}

type Gender = 'm' | 'f' | 'n';
/** Существительное: формы для 1 / 2–4 / 5+ и род (по нему согласуется глагол). */
interface Noun { forms: readonly [string, string, string]; g: Gender }

const noun = (one: string, few: string, many: string, g: Gender): Noun => ({ forms: [one, few, many], g });

const OBJECT = noun('объект', 'объекта', 'объектов', 'm');

const SHAPE_NOUNS: Record<string, Noun> = {
  rect: noun('прямоугольник', 'прямоугольника', 'прямоугольников', 'm'),
  ellipse: noun('эллипс', 'эллипса', 'эллипсов', 'm'),
  triangle: noun('треугольник', 'треугольника', 'треугольников', 'm'),
  line: noun('линия', 'линии', 'линий', 'f'),
  arrow: noun('стрелка', 'стрелки', 'стрелок', 'f'),
};

const SOLID_NOUNS: Record<string, Noun> = {
  cube: noun('куб', 'куба', 'кубов', 'm'),
  box: noun('параллелепипед', 'параллелепипеда', 'параллелепипедов', 'm'),
  prism: noun('призма', 'призмы', 'призм', 'f'),
  pyramid: noun('пирамида', 'пирамиды', 'пирамид', 'f'),
  truncPyramid: noun('усечённая пирамида', 'усечённые пирамиды', 'усечённых пирамид', 'f'),
  cylinder: noun('цилиндр', 'цилиндра', 'цилиндров', 'm'),
  cone: noun('конус', 'конуса', 'конусов', 'm'),
  truncCone: noun('усечённый конус', 'усечённых конуса', 'усечённых конусов', 'm'),
  sphere: noun('шар', 'шара', 'шаров', 'm'),
};

const DRAWING = noun('рисунок', 'рисунка', 'рисунков', 'm');
const HIGHLIGHT = noun('штрих маркера', 'штриха маркера', 'штрихов маркера', 'm');
const POLYLINE = noun('ломаная', 'ломаные', 'ломаных', 'f');
const POLYGON = noun('многоугольник', 'многоугольника', 'многоугольников', 'm');
const TEXT = noun('текст', 'текста', 'текстов', 'm');
const NOTE = noun('стикер', 'стикера', 'стикеров', 'm');
const IMAGE = noun('изображение', 'изображения', 'изображений', 'n');
const PAGE_LINK = noun('страница на холсте', 'страницы на холсте', 'страниц на холсте', 'f');
const SOLID = noun('тело', 'тела', 'тел', 'n');
const TASK = noun('задание', 'задания', 'заданий', 'n');

/** Как называется элемент в подписи истории (по типу и виду). */
function nounOf(el: Element): Noun {
  switch (el.type) {
    case 'stroke': return el.tool === 'highlighter' ? HIGHLIGHT : DRAWING;
    case 'shape': return SHAPE_NOUNS[el.shape] ?? OBJECT;
    case 'poly': return el.closed ? POLYGON : POLYLINE;
    case 'text': return TEXT;
    case 'note': return NOTE;
    case 'image': return el.page ? PAGE_LINK : IMAGE;
    case 'solid': return SOLID_NOUNS[el.solid] ?? SOLID;
    case 'task': return TASK;
    default: return OBJECT;
  }
}

/** Глагол в прошедшем времени: м. р. / ж. р. / ср. р. («Добавлен / Добавлена / Добавлено»). */
type Verb = readonly [string, string, string];
const ADDED: Verb = ['Добавлен', 'Добавлена', 'Добавлено'];
const REMOVED: Verb = ['Удалён', 'Удалена', 'Удалено'];
const MOVED: Verb = ['Перемещён', 'Перемещена', 'Перемещено'];
const CHANGED: Verb = ['Изменён', 'Изменена', 'Изменено'];
const ROTATED: Verb = ['Повёрнут', 'Повёрнута', 'Повёрнуто'];
const GROUPED: Verb = ['Сгруппирован', 'Сгруппирована', 'Сгруппировано'];
const UNGROUPED: Verb = ['Разгруппирован', 'Разгруппирована', 'Разгруппировано'];
const ERASED: Verb = ['Частично стёрт', 'Частично стёрта', 'Частично стёрто'];
const CROPPED: Verb = ['Обрезан', 'Обрезана', 'Обрезано'];

const GENDER_INDEX: Record<Gender, 0 | 1 | 2> = { m: 0, f: 1, n: 2 };

/** Одно существительное на всех: у одинаковых — их тип, у разных — «объект». */
function commonNoun(els: readonly Element[]): Noun {
  const first = nounOf(els[0]);
  return els.every(e => nounOf(e) === first) ? first : OBJECT;
}

/**
 * «Добавлен рисунок», «Добавлена линия», «Добавлено 3 объекта», «Добавлен 21 объект».
 * С числом, оканчивающимся на 1 (кроме 11), глагол согласуется с родом, иначе — средний род.
 */
function phrase(verb: Verb, els: readonly Element[]): string {
  const n = els.length;
  const w = commonNoun(els);
  if (n === 1) return `${verb[GENDER_INDEX[w.g]]} ${w.forms[0]}`;
  const form = pluralIndex(n);
  const v = form === 0 ? verb[GENDER_INDEX[w.g]] : verb[2];
  return `${v} ${n} ${w.forms[form]}`;
}

/** «Изменён стиль» у одного, «Изменён стиль: 3 объекта» у нескольких. */
function aspect(what: string, els: readonly Element[]): string {
  if (els.length === 1) return what;
  const w = commonNoun(els);
  return `${what}: ${els.length} ${plural(els.length, w.forms)}`;
}

// ----- Что изменилось у одного элемента -----

/** Поля, которые меняет перемещение (у штрихов и ломаных — точки, сдвинутые целиком; baseId — привязка к основе). */
const MOVE_KEYS = new Set(['x', 'y', 'pts', 'baseId']);
/** Поля размера и формы. */
const GEOMETRY_KEYS = new Set(['x', 'y', 'w', 'h', 'd', 'pts', 'baseId']);
/** Оформление: цвет, толщина, прозрачность, начертание, выравнивание, кегль, скругление. */
const STYLE_KEYS = new Set([
  'color', 'width', 'opacity', 'fill', 'fillOpacity', 'bold', 'italic', 'align', 'valign', 'radius', 'size', 'textSize', 'runs',
]);
/** Правка текста может заодно поменять разметку фрагментов и размер блока. */
const TEXT_EXTRA_KEYS = new Set(['text', 'runs', 'w', 'h']);

type ChangeKind = 'move' | 'geometry' | 'style' | 'text' | 'rotate' | 'crop' | 'group' | 'order' | 'other';

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Точки сдвинуты все на одно и то же смещение (форма не изменилась). */
function translatedOnly(a: unknown, b: unknown): boolean {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || a.length === 0) return false;
  const p0 = a[0] as { x: number; y: number; p?: number }, q0 = b[0] as { x: number; y: number; p?: number };
  const dx = q0.x - p0.x, dy = q0.y - p0.y;
  const eps = 1e-6;
  for (let i = 0; i < a.length; i++) {
    const p = a[i] as { x: number; y: number; p?: number }, q = b[i] as { x: number; y: number; p?: number };
    if (Math.abs(q.x - p.x - dx) > eps || Math.abs(q.y - p.y - dy) > eps || p.p !== q.p) return false;
  }
  return true;
}

const subset = (keys: readonly string[], allowed: ReadonlySet<string>): boolean => keys.every(k => allowed.has(k));

/** Вид правки одного элемента по набору изменившихся полей. */
function changeKind(a: Element, b: Element): ChangeKind {
  if (a.type !== b.type) return 'other';
  const ra = a as unknown as Record<string, unknown>, rb = b as unknown as Record<string, unknown>;
  const keys = [...new Set([...Object.keys(ra), ...Object.keys(rb)])].filter(k => !sameValue(ra[k], rb[k]));
  if (keys.length === 0) return 'other';
  if (subset(keys, new Set(['layerPin']))) return 'order';
  if (subset(keys, new Set(['groupId']))) return 'group';
  if (subset(keys, MOVE_KEYS) && (!keys.includes('pts') || translatedOnly(ra.pts, rb.pts))) return 'move';
  if (keys.includes('text') && subset(keys, TEXT_EXTRA_KEYS)) return 'text';
  if (subset(keys, STYLE_KEYS)) return 'style';
  if (subset(keys, new Set(['rot']))) return 'rotate';
  if (keys.includes('crop') && subset(keys, new Set(['crop', ...GEOMETRY_KEYS]))) return 'crop';
  if (subset(keys, GEOMETRY_KEYS)) return 'geometry';
  return 'other';
}

/** Подпись для изменённых (одних и тех же id) элементов. */
function describeChanged(pairs: readonly (readonly [Element, Element])[]): string {
  const kinds = new Set(pairs.map(([a, b]) => changeKind(a, b)));
  const els = pairs.map(([, b]) => b);
  if (kinds.size === 1) {
    const [kind] = kinds;
    switch (kind) {
      case 'move': return phrase(MOVED, els);
      case 'style': return aspect('Изменён стиль', els);
      case 'text': return aspect('Изменён текст', els);
      case 'geometry': return aspect('Изменён размер', els);
      case 'rotate': return phrase(ROTATED, els);
      case 'crop': return phrase(CROPPED, els);
      case 'order': return 'Изменён порядок';
      case 'group': return phrase(els.every(e => e.groupId) ? GROUPED : UNGROUPED, els);
      default: return phrase(CHANGED, els);
    }
  }
  // размер основы поменяли, а привязанные к ней штрихи сдвинулись или растянулись вместе с ней
  if ([...kinds].every(k => k === 'move' || k === 'geometry')) return aspect('Изменён размер', els);
  return phrase(CHANGED, els);
}

/**
 * Что изменилось между снимками prev → next: «Добавлен рисунок», «Удалено 3 объекта», «Перемещено 2 объекта»,
 * «Изменён текст», «Изменён стиль», «Изменён порядок»… Без изменений — «Без изменений».
 */
export function describeChange(prev: readonly Element[], next: readonly Element[]): string {
  if (prev === next) return 'Без изменений';
  const before = new Map<string, Element>();
  for (const el of prev) before.set(el.id, el);
  const nextIds = new Set<string>();
  const added: Element[] = [];
  const changed: (readonly [Element, Element])[] = [];
  for (const el of next) {
    nextIds.add(el.id);
    const old = before.get(el.id);
    if (!old) added.push(el);
    else if (old !== el) changed.push([old, el]);
  }
  const removed = prev.filter(el => !nextIds.has(el.id));

  if (added.length === 0 && removed.length === 0 && changed.length === 0) {
    const order = (list: readonly Element[]) => list.map(e => e.id).join('\u0000');
    return order(prev) === order(next) ? 'Без изменений' : 'Изменён порядок';
  }
  if (changed.length === 0 && removed.length === 0) return phrase(ADDED, added);
  if (changed.length === 0 && added.length === 0) return phrase(REMOVED, removed);
  if (added.length === 0 && removed.length === 0) return describeChanged(changed);
  // ластик для пера и маркера: штрих заменён своими кусками
  if (changed.length === 0 && removed.every(e => e.type === 'stroke') && added.every(e => e.type === 'stroke')) {
    return phrase(ERASED, removed);
  }
  // смешанное: части по порядку, со второй — со строчной
  const parts: string[] = [];
  if (added.length) parts.push(phrase(ADDED, added));
  if (removed.length) parts.push(phrase(REMOVED, removed));
  if (changed.length) parts.push(describeChanged(changed));
  return parts.map((p, i) => (i === 0 ? p : p[0].toLowerCase() + p.slice(1))).join(', ');
}
