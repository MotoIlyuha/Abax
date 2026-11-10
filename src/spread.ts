// Инструмент «Раздвинуть»: нажали на лист там, где не хватает места, и тянут вниз —
// всё, что целиком ниже линии нажатия, сдвигается вниз, освобождая место.

import { foundationFor, withAttached } from './attachment';
import { elementAABB, translateElement } from './geom';
import type { Element } from './types';

/**
 * Что сдвигается, если раздвинуть лист по линии y: элементы, чья рамка целиком ниже линии.
 * Группа сдвигается только целиком (если линия режет группу — она остаётся на месте),
 * прикреплённое к стикеру или картинке едет вместе со своей основой: надписи
 * на странице PDF, которую линия разрезала, не отрываются от неё.
 */
export function spreadTargets(elements: Element[], y: number): Set<string> {
  const ids = new Set(elements.filter(el => elementAABB(el).y0 >= y).map(el => el.id));
  let changed = true;
  while (changed) {
    changed = false;
    const groupStays = new Set<string>();
    for (const el of elements) if (el.groupId && !ids.has(el.id)) groupStays.add(el.groupId);
    for (const el of elements) {
      if (!ids.has(el.id)) continue;
      const stays = (!!el.groupId && groupStays.has(el.groupId)) || (() => {
        const base = foundationFor(el, elements);
        return !!base && !ids.has(base.id);
      })();
      if (stays) { ids.delete(el.id); changed = true; }
    }
  }
  return withAttached(ids, elements);
}

/** Элементы после раздвигания: ids — из spreadTargets, сдвинуты на dy вниз. */
export function spreadElements(elements: Element[], ids: Set<string>, dy: number): Element[] {
  if (dy === 0 || ids.size === 0) return elements;
  return elements.map(el => (ids.has(el.id) ? translateElement(el, 0, dy) : el));
}
