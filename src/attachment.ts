import { hitTest } from './geom';
import type { Element, NoteEl, StrokeEl } from './types';

/** Элементы, которые могут быть прикреплены к основе. */
type Attachable = StrokeEl | NoteEl;

function isAttachable(item: Element): item is Attachable {
  return item.type === 'stroke' || item.type === 'note';
}

/**
 * Геометрически подходящая основа в текущем положении: верхняя из лежащих ниже
 * по слоям, накрывающая не меньше двух третей объекта.
 */
export function geometricFoundationFor(item: Element, elements: Element[], excluded = new Set<string>()): Element | undefined {
  if (!isAttachable(item)) return undefined;
  const itemIndex = elements.findIndex(e => e.id === item.id);
  // Only objects below the item in the layer stack can be foundations.
  const candidates = elements.slice(0, itemIndex < 0 ? elements.length : itemIndex).filter(e => !excluded.has(e.id) && e.id !== item.id &&
    (item.type === 'note' ? e.type === 'image' || e.type === 'task' : e.type === 'image' || e.type === 'note' || e.type === 'task' || (e.type === 'shape' && e.shape !== 'line' && e.shape !== 'arrow')));
  for (const base of candidates.reverse()) {
    let inside = 0, total = 0;
    if (item.type === 'note') {
      const n = 30;
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        total++; if (hitTest(base, item.x + item.w * (x + .5) / n, item.y + item.h * (y + .5) / n, 0)) inside++;
      }
    } else {
      const pts = item.pts;
      if (pts.length === 1) { total = 1; inside = hitTest(base, pts[0].x, pts[0].y, 0) ? 1 : 0; }
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i], length = Math.hypot(b.x - a.x, b.y - a.y);
        const n = Math.max(1, Math.ceil(length / 2));
        for (let j = 0; j < n; j++) {
          const t = (j + .5) / n, weight = length / n;
          total += weight; if (hitTest(base, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, 0)) inside += weight;
        }
      }
    }
    if (total > 0 && inside / total >= 2 / 3) return base;
  }
}

/**
 * Основа элемента: сохранённая при создании/переносе (baseId). Поэтому картинка,
 * подведённая под чужое перо, не становится его основой. У старых проектов поля
 * ещё нет — тогда привязка определяется по геометрии (до миграции, см. freezeAttachments).
 */
export function foundationFor(item: Element, elements: Element[], excluded = new Set<string>()): Element | undefined {
  if (!isAttachable(item)) return undefined;
  if ('baseId' in item) {
    const id = item.baseId;
    if (!id || excluded.has(id)) return undefined;
    return elements.find(e => e.id === id);
  }
  return geometricFoundationFor(item, elements, excluded);
}

/** Новый штрих или стикер запоминает основу, на которой он появился (null — вне основы). */
export function attachNewElement(item: Element, elements: Element[]): Element {
  if (!isAttachable(item)) return item;
  const base = geometricFoundationFor(item, [...elements, item]);
  return { ...item, baseId: base?.id ?? null };
}

/**
 * Пересчитывает привязку элементов, которые пользователь передвинул сам:
 * унесённое с картинки перо отцепляется, положенное на картинку — прикрепляется.
 * Основа, ехавшая вместе с элементом, сохраняет связь.
 */
export function reattachMoved(ids: Set<string>, elements: Element[], moving: Set<string>): Element[] {
  let changed = false;
  const out = elements.map(el => {
    if (!ids.has(el.id) || !isAttachable(el)) return el;
    if (el.baseId && moving.has(el.baseId)) return el;
    // Основы, едущие вместе с элементом, новую связь не образуют.
    const base = geometricFoundationFor(el, elements, moving);
    const baseId = base?.id ?? null;
    if ('baseId' in el && el.baseId === baseId) return el;
    changed = true;
    return { ...el, baseId };
  });
  return changed ? out : elements;
}

/** Привязка копии: к копии основы, если её тоже копируют, иначе — вне основы. */
export function rebindAttachment(el: Element, idMap: Map<string, string>): Element {
  if (!isAttachable(el)) return el;
  const baseId = el.baseId && idMap.has(el.baseId) ? idMap.get(el.baseId)! : null;
  return { ...el, baseId };
}

/**
 * Старые проекты не хранили привязку: фиксируем её по текущему положению один раз.
 * Иначе штрих, под который подвели картинку, «прилипал» бы к ней при следующем переносе.
 */
export function freezeAttachments(elements: Element[]): Element[] {
  if (!elements.some(el => isAttachable(el) && !('baseId' in el))) return elements;
  const out = elements.slice();
  for (let i = 0; i < out.length; i++) {
    const el = out[i];
    if (!isAttachable(el) || 'baseId' in el) continue;
    out[i] = { ...el, baseId: geometricFoundationFor(el, out)?.id ?? null };
  }
  return out;
}

export function withAttached(ids: Set<string>, elements: Element[]): Set<string> {
  const result = new Set(ids);
  let changed = true;
  while (changed) {
    changed = false;
    for (const item of elements) {
      if (result.has(item.id)) continue;
      const base = foundationFor(item, elements);
      if (base && result.has(base.id)) { result.add(item.id); changed = true; }
    }
  }
  return result;
}
