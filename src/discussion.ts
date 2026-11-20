import type { CommentMessage, CommentThread, Element } from './types';

// Обсуждение объекта (SPEC_COMMENTS §3): все ветки комментариев, привязанные к нему, — одна лента сообщений.
// И разница реакций и комментариев между двумя состояниями — для уведомлений о чужих действиях (§6).
// Только данные: чистые функции без DOM и состояния.

/** Ветки, привязанные к объекту elId (в порядке страницы). */
export function elementThreads(comments: readonly CommentThread[] | undefined, elId: string): CommentThread[] {
  return (comments ?? []).filter(t => t.targetElementId === elId);
}

/** Время последнего сообщения ветки (пустая ветка — 0). */
export function threadLastAt(t: CommentThread): number {
  let last = 0;
  for (const m of t.messages) if (m.createdAt > last) last = m.createdAt;
  return last;
}

export interface DiscussionMessage extends CommentMessage { threadId: string; resolved: boolean }

/** Сообщения веток одной лентой по времени (при равном — в порядке веток). */
export function discussionMessages(threads: readonly CommentThread[]): DiscussionMessage[] {
  const out: DiscussionMessage[] = [];
  for (const t of threads) for (const m of t.messages) out.push({ ...m, threadId: t.id, resolved: !!t.resolved });
  return out.map((m, i) => ({ m, i })).sort((a, b) => a.m.createdAt - b.m.createdAt || a.i - b.i).map(x => x.m);
}

/** Сколько сообщений в обсуждении объекта (счётчик кнопки «Комментировать»). */
export function elementCommentCount(comments: readonly CommentThread[] | undefined, elId: string): number {
  let n = 0;
  for (const t of comments ?? []) if (t.targetElementId === elId) n += t.messages.length;
  return n;
}

/** Есть ли у объекта сообщения и все ли его ветки решены (тогда счётчик бледнее). */
export function discussionResolved(threads: readonly CommentThread[]): boolean {
  return threads.length > 0 && threads.every(t => t.resolved);
}

/** Ветка, в которую уходит новое сообщение: открытая с самым свежим сообщением; нет открытых — null (новая ветка). */
export function replyThread(threads: readonly CommentThread[]): CommentThread | null {
  let best: CommentThread | null = null;
  for (const t of threads) {
    if (t.resolved) continue;
    if (!best || threadLastAt(t) >= threadLastAt(best)) best = t;
  }
  return best;
}

/**
 * Ветки-пины на холсте: без объекта или с объектом, которого на странице уже нет. Ветки при объекте
 * показываются счётчиком у объекта, а не пином.
 */
export function detachedThreads(comments: readonly CommentThread[] | undefined, elements: readonly Element[]): CommentThread[] {
  const list = comments ?? [];
  if (!list.length) return [];
  const ids = new Set(elements.map(e => e.id));
  return list.filter(t => !t.targetElementId || !ids.has(t.targetElementId));
}

// ----- Разница для уведомлений -----

export interface AddedReaction { emoji: string; userId: string }

/** Реакции, которых не было у prev и появились у next (у кого и какая). Порядок — как в next. */
export function addedReactions(prev: Element | undefined, next: Element | undefined): AddedReaction[] {
  const out: AddedReaction[] = [];
  const now = next?.reactions;
  if (!now) return out;
  const was = prev?.reactions ?? {};
  for (const [emoji, users] of Object.entries(now)) {
    const before = Object.prototype.hasOwnProperty.call(was, emoji) ? was[emoji] : [];
    for (const u of users) if (!before.includes(u)) out.push({ emoji, userId: u });
  }
  return out;
}

export interface AddedComment { thread: CommentThread; message: CommentMessage; isNewThread: boolean }

/** Сообщения, которых не было в prev (новые ветки и ответы), в порядке next. */
export function addedComments(prev: readonly CommentThread[] | undefined, next: readonly CommentThread[] | undefined): AddedComment[] {
  const known = new Set<string>();
  const threads = new Set<string>();
  for (const t of prev ?? []) {
    threads.add(t.id);
    for (const m of t.messages) known.add(m.id);
  }
  const out: AddedComment[] = [];
  for (const t of next ?? []) {
    for (const m of t.messages) if (!known.has(m.id)) out.push({ thread: t, message: m, isNewThread: !threads.has(t.id) });
  }
  return out;
}

// ----- Подпись объекта -----

const TYPE_LABEL: Record<Element['type'], string> = {
  stroke: 'Рисунок', shape: 'Фигура', text: 'Текст', note: 'Стикер', image: 'Изображение', poly: 'Многоугольник',
  solid: 'Объёмная фигура', task: 'Задание',
} as Record<Element['type'], string>;

/** Короткий текст объекта (текст, стикер, надпись фигуры, условие задания), без переносов; пусто — нет текста. */
function elementText(el: Element): string {
  const raw = el.type === 'text' || el.type === 'note' ? el.text
    : el.type === 'shape' ? el.text ?? ''
      : el.type === 'task' ? el.statementMd
        : '';
  return String(raw ?? '').replace(/\s+/g, ' ').trim();
}

/** Подпись объекта для уведомлений и карточек: «Текст «Привет, мир»», «Фигура», «Изображение «Карта»». */
export function elementLabel(el: Element | undefined, max = 28): string {
  if (!el) return 'Объект';
  const base = (el.type === 'image' && el.page ? 'Страница' : TYPE_LABEL[el.type]) ?? 'Объект';
  const text = elementText(el);
  if (!text) return base;
  const chars = Array.from(text);
  const short = chars.length > max ? `${chars.slice(0, max - 1).join('')}…` : text;
  return `${base} «${short}»`;
}
