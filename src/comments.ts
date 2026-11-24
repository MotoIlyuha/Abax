import type { CommentMessage, CommentThread, Element, Page, TaskEl } from './types';
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

function sameReactions(a: Record<string, string[]> | undefined, b: Record<string, string[]> | undefined): boolean {
  if (a === b) return true;
  const ka = Object.keys(a ?? {});
  const kb = Object.keys(b ?? {});
  if (ka.length !== kb.length) return false;
  return ka.every(k => {
    const x = a![k];
    const y = b?.[k];
    return !!y && x.length === y.length && x.every((u, i) => u === y[i]);
  });
}

/** Для каждого id по всем элементам: что есть сейчас. */
function byId(els: readonly Element[]): Map<string, Element> {
  return new Map(els.map(e => [e.id, e]));
}

/** Поле reactions у el заменено на значение из from (нет значения — поля нет). */
function withReactions(el: Element, from: Element): Element {
  const { reactions: _old, ...rest } = el;
  return (from.reactions ? { ...rest, reactions: from.reactions } : rest) as Element;
}

/**
 * Снимок истории с текущими реакциями: Ctrl+Z откатывает рисунок, но не чужие реакции, которых в истории нет.
 * Совпадение по id; элементы без пары (восстановленные удалённые) остаются как в снимке; нетронутые — те же объекты,
 * а если менять нечего — тот же массив.
 */
export function preserveElementReactions(snapshotElements: readonly Element[], currentElements: readonly Element[]): Element[] {
  const current = byId(currentElements);
  let changed = false;
  const out = snapshotElements.map(el => {
    const now = current.get(el.id);
    if (!now || sameReactions(el.reactions, now.reactions)) return el;
    changed = true;
    return withReactions(el, now);
  });
  return changed ? out : snapshotElements as Element[];
}

function sameAttempts(a: TaskEl['attempts'], b: TaskEl['attempts']): boolean {
  if (a === b) return true;
  const x = a ?? [];
  const y = b ?? [];
  return x.length === y.length && x.every((t, i) => t.value === y[i].value && t.timestamp === y[i].timestamp && t.isCorrect === y[i].isCorrect);
}

/**
 * Снимок истории с тем, что в элементах меняется мимо истории: реакции и ввод ученика в задании
 * (черновик и попытки). Остальное берётся из снимка.
 */
export function preserveLiveFields(snapshotElements: readonly Element[], currentElements: readonly Element[]): Element[] {
  const withReacts = preserveElementReactions(snapshotElements, currentElements);
  const current = byId(currentElements);
  let changed = false;
  const out = withReacts.map(el => {
    if (el.type !== 'task') return el;
    const now = current.get(el.id);
    if (!now || now.type !== 'task') return el;
    if (sameAttempts(el.attempts, now.attempts) && el.studentDraft === now.studentDraft) return el;
    changed = true;
    const { attempts: _a, studentDraft: _d, ...rest } = el;
    return {
      ...rest,
      ...(now.attempts ? { attempts: now.attempts } : {}),
      ...(now.studentDraft !== undefined ? { studentDraft: now.studentDraft } : {}),
    } as Element;
  });
  return changed ? out : withReacts;
}

export interface CreateThreadParams {
  x: number;
  y: number;
  targetElementId?: string;
  offset?: CommentThread['offset'];
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
 * Новая ветка с первым сообщением на доске или у существующего объекта.
 * При неверных данных или отсутствии объекта страница остаётся без изменений.
 */
export function createCommentThread(page: Page, params: CreateThreadParams): Page {
  const text = cleanCommentText(params.text);
  if (!text || !Number.isFinite(params.x) || !Number.isFinite(params.y) || !isUserId(params.authorId)) return page;
  if (params.targetElementId !== undefined && !page.elements.some(e => e.id === params.targetElementId)) return page;
  const thread: CommentThread = {
    id: params.id ?? newId(),
    x: params.x,
    y: params.y,
    ...(params.targetElementId === undefined ? {} : { targetElementId: params.targetElementId }),
    ...(params.targetElementId && validCommentOffset(params.offset) ? { offset: params.offset } : {}),
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

function validCommentOffset(offset: CommentThread['offset']): boolean {
  return !!offset && Number.isFinite(offset.x) && Number.isFinite(offset.y);
}

export function moveCommentThread(page: Page, id: string, x: number, y: number, offset?: CommentThread['offset']): Page {
  const thread = page.comments?.find(t => t.id === id);
  if (!thread || !Number.isFinite(x) || !Number.isFinite(y)) return page;
  const next = { ...thread, x, y };
  if (thread.targetElementId && validCommentOffset(offset)) next.offset = offset;
  if (thread.x === x && thread.y === y && thread.offset?.x === next.offset?.x && thread.offset?.y === next.offset?.y) return page;
  return withComments(page, page.comments!.map(t => t === thread ? next : t));
}

export function deleteCommentThread(page: Page, id: string): Page {
  const comments = page.comments?.filter(t => t.id !== id);
  if (!comments || comments.length === page.comments!.length) return page;
  return withComments(page, comments);
}

export function commentPoint(thread: CommentThread, target?: Element): { x: number; y: number } {
  if (!target) return thread;
  const { x0, x1, y0 } = elementAABB(target);
  return thread.offset ? { x: x0 + thread.offset.x, y: y0 + thread.offset.y } : { x: x1, y: y0 };
}

export function hasUnresolvedComments(page: Page, ids: ReadonlySet<string>): boolean {
  return page.comments?.some(t => !!t.targetElementId && ids.has(t.targetElementId) && !t.resolved) ?? false;
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
