import type { CommentMessage, CommentThread, Element, Page } from './types';
import { elementAABB } from './geom';

// Реакции на элементы и ветки комментариев на странице. Только данные: чистые функции без побочных эффектов,
// интерфейс подключается отдельно. В историю отмены эти правки не попадают: Ctrl+Z не должен стирать чужую реакцию.

/** Самая длинная реакция (эмодзи с модификаторами), в символах UTF-16. */
export const MAX_REACTION_LEN = 16;
export const MAX_COMMENT_TEXT = 2000;
export const MAX_AUTHOR_NAME = 40;

let seq = 1;
function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `cm-${Date.now().toString(36)}-${seq++}`;
}

const isUserId = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

/** Текст комментария без пробелов по краям; null — пустой. Длинный обрезается. */
export function cleanCommentText(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const t = raw.trim();
  return t ? t.slice(0, MAX_COMMENT_TEXT) : null;
}

export function cleanAuthorName(raw: unknown): string {
  return typeof raw === 'string' ? Array.from(raw.replace(/\s+/g, ' ').trim()).slice(0, MAX_AUTHOR_NAME).join('') : '';
}

/** Поставить реакцию emoji от userId; если она уже стоит — снять. Пустые списки и поле reactions не остаются. */
export function toggleElementReaction(el: Element, emoji: string, userId: string): Element {
  if (typeof emoji !== 'string' || emoji === '' || emoji.length > MAX_REACTION_LEN || !isUserId(userId)) return el;
  const reactions: Record<string, string[]> = { ...el.reactions };
  const users = reactions[emoji] ?? [];
  const next = users.includes(userId) ? users.filter(u => u !== userId) : [...users, userId];
  if (next.length > 0) reactions[emoji] = next;
  else delete reactions[emoji];
  const { reactions: _old, ...rest } = el;
  return (Object.keys(reactions).length > 0 ? { ...rest, reactions } : rest) as Element;
}

export interface CreateThreadParams {
  x: number;
  y: number;
  targetElementId?: string;
  authorId: string;
  authorName: string;
  text: string;
  /** Для тестов и восстановления: свои id и время. */
  id?: string;
  messageId?: string;
  now?: number;
}

function withComments(page: Page, comments: CommentThread[]): Page {
  return { ...page, comments };
}

/**
 * Новая ветка с первым сообщением. Пустой текст или неверные координаты — страница без изменений.
 * Если элемента targetElementId на странице нет, ветка создаётся без привязки.
 */
export function createCommentThread(page: Page, params: CreateThreadParams): Page {
  const text = cleanCommentText(params.text);
  if (!text || !Number.isFinite(params.x) || !Number.isFinite(params.y) || !isUserId(params.authorId)) return page;
  const target = params.targetElementId && page.elements.some(e => e.id === params.targetElementId) ? params.targetElementId : undefined;
  const thread: CommentThread = {
    id: params.id ?? newId(),
    x: params.x,
    y: params.y,
    ...(target ? { targetElementId: target } : {}),
    messages: [{
      id: params.messageId ?? newId(), authorId: params.authorId, authorName: cleanAuthorName(params.authorName), text,
      createdAt: params.now ?? Date.now(),
    }],
  };
  return withComments(page, [...(page.comments ?? []), thread]);
}

/** Ответ в ветке. Нет такой ветки или текст пуст — страница без изменений. */
export function addCommentReply(
  page: Page, threadId: string, msg: Omit<CommentMessage, 'id' | 'createdAt'>, opts: { id?: string; now?: number } = {},
): Page {
  const text = cleanCommentText(msg.text);
  if (!text || !isUserId(msg.authorId) || !page.comments?.some(t => t.id === threadId)) return page;
  const message: CommentMessage = {
    id: opts.id ?? newId(), authorId: msg.authorId, authorName: cleanAuthorName(msg.authorName), text, createdAt: opts.now ?? Date.now(),
  };
  return withComments(page, page.comments.map(t => (t.id === threadId ? { ...t, messages: [...t.messages, message] } : t)));
}

/** Закрыть ветку (resolved = true) или вернуть в обсуждение. Поле resolved у открытой ветки не хранится. */
export function resolveCommentThread(page: Page, threadId: string, resolved = true): Page {
  const thread = page.comments?.find(t => t.id === threadId);
  if (!thread || (thread.resolved === true) === resolved) return page;
  return withComments(page, page.comments!.map(t => {
    if (t.id !== threadId) return t;
    const { resolved: _old, ...rest } = t;
    return resolved ? { ...rest, resolved: true } : rest;
  }));
}

const EPS = 1e-9;

/**
 * Двигает привязанные ветки вместе с их элементами: сдвиг левого верхнего угла рамки элемента между
 * prevElements и nextElements переносится на ветку. Удалённый элемент ветку не удаляет — она остаётся на месте.
 */
export function syncCommentsWithMovedElements(page: Page, prevElements: readonly Element[], nextElements: readonly Element[]): Page {
  const threads = page.comments;
  if (!threads || !threads.some(t => t.targetElementId)) return page;
  const prev = new Map(prevElements.map(e => [e.id, e]));
  const next = new Map(nextElements.map(e => [e.id, e]));
  let changed = false;
  const out = threads.map(t => {
    if (!t.targetElementId) return t;
    const a = prev.get(t.targetElementId), b = next.get(t.targetElementId);
    if (!a || !b || a === b) return t;
    const pa = elementAABB(a), pb = elementAABB(b);
    const dx = pb.x0 - pa.x0, dy = pb.y0 - pa.y0;
    if (!Number.isFinite(dx) || !Number.isFinite(dy) || (Math.abs(dx) < EPS && Math.abs(dy) < EPS)) return t;
    changed = true;
    return { ...t, x: t.x + dx, y: t.y + dy };
  });
  return changed ? withComments(page, out) : page;
}
