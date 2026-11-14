import type { Element, GridMode, Page } from './types';
import { sanitizeElement } from './file';

// Дельта-синхронизация: вместо всего проекта по сети идёт набор операций над элементами страницы.

export type ElementOp =
  /** Добавить элемент или заменить существующий с тем же id (на его месте). */
  | { op: 'put'; el: Element }
  | { op: 'del'; id: string }
  /** Полный порядок слоёв страницы; неизвестные id пропускаются, не названные — остаются сверху в прежнем порядке. */
  | { op: 'order'; ids: string[] };

export interface BoardPatch {
  t: 'patch';
  pageId: string;
  /** Номер ревизии страницы: его ведёт отправитель или хост, применение патча на него не опирается. */
  rev: number;
  ops: ElementOp[];
  /** Новая сетка страницы. */
  grid?: GridMode;
  /** Новый цвет фона; null — убрать. */
  backgroundColor?: string | null;
}

/** Больше операций в одном патче не принимаем: дальше дешевле отправить страницу целиком. */
export const MAX_PATCH_OPS = 10000;
const MAX_ID = 128;
const GRIDS: readonly string[] = ['none', 'dots', 'square', 'coord'];

/** Структурное равенство данных элемента (ключи со значением undefined — всё равно что отсутствующие). */
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => same(v, b[i]));
  const ka = Object.keys(a).filter(k => (a as Record<string, unknown>)[k] !== undefined);
  const kb = Object.keys(b).filter(k => (b as Record<string, unknown>)[k] !== undefined);
  if (ka.length !== kb.length) return false;
  return ka.every(k => same((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

/** Закреплённые сверху и снизу — по краям, остальные в своём порядке (как replaceElements в state.ts). */
function pinOrder(els: Element[]): Element[] {
  if (!els.some(e => e.layerPin)) return els;
  return [
    ...els.filter(e => e.layerPin === 'bottom'),
    ...els.filter(e => !e.layerPin),
    ...els.filter(e => e.layerPin === 'top'),
  ];
}

/**
 * Минимальный набор операций, превращающий prev в next: del для пропавших, put для новых и изменившихся
 * (по ссылке, затем по значению), order — только если после del и put порядок слоёв ещё не тот.
 */
export function diffElements(prev: readonly Element[], next: readonly Element[]): ElementOp[] {
  const prevById = new Map(prev.map(e => [e.id, e]));
  const nextById = new Map<string, Element>();
  for (const e of next) if (!nextById.has(e.id)) nextById.set(e.id, e);

  const ops: ElementOp[] = [];
  for (const e of prev) if (!nextById.has(e.id)) ops.push({ op: 'del', id: e.id });
  for (const e of nextById.values()) {
    const old = prevById.get(e.id);
    if (!old || !same(old, e)) ops.push({ op: 'put', el: e });
  }

  // порядок, который получится у получателя без order: оставшиеся на своих местах, новые — сверху
  const kept = prev.filter(e => nextById.has(e.id));
  const keptIds = new Set(kept.map(e => e.id));
  const result = pinOrder([...kept, ...[...nextById.values()].filter(e => !keptIds.has(e.id))]);
  const want = [...nextById.keys()];
  if (result.length !== want.length || result.some((e, i) => e.id !== want[i])) ops.push({ op: 'order', ids: want });
  return ops;
}

/**
 * Применяет патч к странице: новая страница, прежняя не меняется. Операции идут по порядку;
 * входящие элементы проходят sanitizeElement (негодные пропускаются). Повторное применение того же
 * патча даёт тот же результат.
 */
export function applyBoardPatch(board: Page, patch: BoardPatch): Page {
  let els = board.elements.slice();
  for (const op of patch.ops) {
    if (op.op === 'put') {
      const clean = sanitizeElement(op.el);
      if (!clean) continue;
      const i = els.findIndex(e => e.id === clean.id);
      if (i < 0) els.push(clean);
      else if (!same(els[i], clean)) els[i] = clean; // тот же по значению — остаётся прежний объект (и его кэш)
    } else if (op.op === 'del') {
      els = els.filter(e => e.id !== op.id);
    } else if (op.op === 'order' && Array.isArray(op.ids)) {
      const byId = new Map(els.map(e => [e.id, e]));
      const ordered: Element[] = [];
      for (const id of op.ids) {
        const e = byId.get(id);
        if (e) { ordered.push(e); byId.delete(id); }
      }
      els = [...ordered, ...els.filter(e => byId.has(e.id))];
    }
  }
  els = pinOrder(els);
  const unchanged = els.length === board.elements.length && els.every((e, i) => e === board.elements[i]);
  const out: Page = { ...board, elements: unchanged ? board.elements : els };
  if (patch.grid !== undefined && GRIDS.includes(patch.grid)) out.grid = patch.grid;
  if (patch.backgroundColor === null) delete out.backgroundColor;
  else if (typeof patch.backgroundColor === 'string') out.backgroundColor = patch.backgroundColor;
  return out;
}

/** Патч из непроверенных данных (сеть): форма операций и размеры; содержимое элементов проверит applyBoardPatch. */
export function isBoardPatch(raw: unknown): raw is BoardPatch {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return false;
  const p = raw as Record<string, unknown>;
  if (p.t !== 'patch' || typeof p.pageId !== 'string' || p.pageId === '' || p.pageId.length > MAX_ID) return false;
  if (typeof p.rev !== 'number' || !Number.isFinite(p.rev)) return false;
  if (!Array.isArray(p.ops) || p.ops.length > MAX_PATCH_OPS) return false;
  if (p.grid !== undefined && !GRIDS.includes(p.grid as string)) return false;
  if (p.backgroundColor !== undefined && p.backgroundColor !== null && typeof p.backgroundColor !== 'string') return false;
  return p.ops.every(o => {
    if (typeof o !== 'object' || o === null) return false;
    const op = o as Record<string, unknown>;
    if (op.op === 'put') return typeof op.el === 'object' && op.el !== null;
    if (op.op === 'del') return typeof op.id === 'string' && op.id.length <= MAX_ID;
    if (op.op === 'order') return Array.isArray(op.ids) && op.ids.length <= MAX_PATCH_OPS && op.ids.every(i => typeof i === 'string');
    return false;
  });
}
