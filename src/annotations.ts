import type { Camera, CommentThread, Element } from './types';
import { elementAABB } from './geom';
import { detachedThreads, discussionResolved, elementThreads } from './discussion';

// Раскладка реакций и комментариев на доске (SPEC_COMMENTS §1, §3, §4) в экранных пикселях. Только расчёт, без DOM:
// одна и та же для слоя плашек (src/annot-layer.ts), окна демонстрации (src/renderer.ts) и тестов.
//  • Строка объекта — под правым нижним углом рамки: [реакции…][+n][😊+][💬 n]. Правый край — по рамке выделения
//    (она на 4 px шире объекта), верх — на ROW_GAP ниже рамки: ручка угла не перекрывается, строка не прыгает
//    при выделении.
//  • Реакций видно 1–3 — сколько влезает в ширину объекта на экране вместе с кнопками и «+n» (минимум одна).
//  • Пины — только у веток без объекта (или с удалённым объектом).

/** Рамка выделения шире объекта на столько с каждой стороны. */
export const FRAME_PAD = 4;
/** Промежуток между рамкой и строкой. */
export const ROW_GAP = 8;
export const ROW_H = 26;
export const ITEM_GAP = 4;
/** Ширина «+n», кнопки реакции и кнопки «Комментировать» (оценка: раскладка не измеряет текст). */
export const MORE_W = 34;
export const REACT_BTN_W = 28;
export const MAX_SHOWN = 3;
export const PIN_R = 11;

/** Ширина пилюли: отступы, эмодзи и число — без измерения текста, чтобы раскладка не зависела от DOM. */
export function pillWidth(count: number): number {
  return 8 + 18 + 4 + 7 * String(count).length + 9;
}

/** Ширина кнопки/счётчика «Комментировать» с числом n (0 — только значок). */
export function commentWidth(n: number): number {
  return n > 0 ? 22 + 4 + 7 * String(n).length + 8 : REACT_BTN_W;
}

/**
 * Сколько реакций показать: от MAX_SHOWN до 1 — первое число, при котором пилюли, «+n» (если не все видны) и
 * кнопки справа (toolsW) влезают в ширину avail.
 */
export function shownReactions(counts: readonly number[], avail: number, toolsW: number): number {
  const total = counts.length;
  if (total === 0) return 0;
  for (let k = Math.min(MAX_SHOWN, total); k >= 1; k--) {
    let w = toolsW;
    for (let i = 0; i < k; i++) w += pillWidth(counts[i]) + ITEM_GAP;
    if (k < total) w += MORE_W + ITEM_GAP;
    if (w <= avail) return k;
  }
  return 1;
}

export interface AnnotRow {
  elId: string;
  /** Правый край и верх строки (экран). */
  right: number;
  top: number;
  /** Реакции объекта по порядку: эмодзи и кто поставил. */
  reactions: [string, string[]][];
  /** Сколько реакций видно; остальные — «+n». */
  shown: number;
  /** Сообщений в обсуждении объекта. */
  comments: number;
  /** Все ветки обсуждения решены. */
  resolved: boolean;
  /** Выделенный объект: в строке кнопки «Поставить реакцию» и «Комментировать». */
  tools: boolean;
}

export interface AnnotLayoutOpts {
  /** Объект, у которого кнопки (выделен один, можно реагировать); null — ни у кого. */
  toolsFor: string | null;
  /** Настройки меню аватара «Показывать реакции» / «Показывать комментарии». */
  showReactions: boolean;
  showComments: boolean;
}

/** Строки объектов: с реакциями, комментариями или кнопками; целиком за экраном — пропускаются. */
export function layoutAnnotRows(
  els: readonly Element[], comments: readonly CommentThread[] | undefined, cam: Camera, viewW: number, viewH: number, o: AnnotLayoutOpts,
): AnnotRow[] {
  const counts = new Map<string, { n: number; resolved: boolean }>();
  if (o.showComments) {
    for (const t of comments ?? []) {
      if (!t.targetElementId) continue;
      const c = counts.get(t.targetElementId);
      if (c) c.n += t.messages.length;
      else counts.set(t.targetElementId, { n: t.messages.length, resolved: false });
    }
    for (const [id, c] of counts) c.resolved = discussionResolved(elementThreads(comments, id));
  }
  const out: AnnotRow[] = [];
  for (const el of els) {
    const tools = el.id === o.toolsFor;
    const reactions = o.showReactions && el.reactions ? Object.entries(el.reactions).filter(([, u]) => u.length > 0) : [];
    const c = counts.get(el.id);
    const n = c?.n ?? 0;
    if (!tools && reactions.length === 0 && n === 0) continue;
    const a = elementAABB(el);
    const right = (a.x1 - cam.x) * cam.zoom + FRAME_PAD;
    const left = (a.x0 - cam.x) * cam.zoom - FRAME_PAD;
    const top = (a.y1 - cam.y) * cam.zoom + FRAME_PAD + ROW_GAP;
    const toolsW = tools ? REACT_BTN_W + ITEM_GAP + commentWidth(n) : n > 0 ? commentWidth(n) : 0;
    const shown = shownReactions(reactions.map(([, u]) => u.length), right - left, toolsW + (toolsW ? ITEM_GAP : 0));
    // грубая ширина строки — чтобы не пропустить строку, которая выступает влево за объект
    let w = toolsW;
    for (let i = 0; i < shown; i++) w += pillWidth(reactions[i][1].length) + ITEM_GAP;
    if (shown < reactions.length) w += MORE_W;
    if (top > viewH || top + ROW_H < 0 || right < 0 || right - w > viewW) continue;
    out.push({ elId: el.id, right, top, reactions, shown, comments: n, resolved: c?.resolved ?? false, tools });
  }
  return out;
}

export interface PinBox { x: number; y: number; r: number; threadId: string; count: number; resolved: boolean }

/** Пины веток без объекта в их точках; те, что за экраном, пропускаются. */
export function layoutPins(threads: readonly CommentThread[] | undefined, elements: readonly Element[], cam: Camera, viewW: number, viewH: number): PinBox[] {
  const out: PinBox[] = [];
  for (const t of detachedThreads(threads, elements)) {
    const x = (t.x - cam.x) * cam.zoom;
    const y = (t.y - cam.y) * cam.zoom;
    if (x < -PIN_R || y < -PIN_R || x > viewW + PIN_R || y > viewH + PIN_R) continue;
    out.push({ x, y, r: PIN_R, threadId: t.id, count: t.messages.length, resolved: !!t.resolved });
  }
  return out;
}

/** Пин под точкой экрана (верхний — последний нарисованный). */
export function hitPin(pins: readonly PinBox[], x: number, y: number): PinBox | null {
  for (let i = pins.length - 1; i >= 0; i--) {
    const p = pins[i];
    if (Math.hypot(x - p.x, y - p.y) <= p.r + 2) return p;
  }
  return null;
}
