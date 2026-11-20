// Что показывать на доске (SPEC_COMMENTS §7): «Показывать реакции» и «Показывать комментарии» из меню своего аватара —
// личная настройка устройства (localStorage['doska.annotView'], по умолчанию всё видно). И недавние реакции
// для ленты у кнопки «Поставить реакцию» (§2, localStorage['doska.recentReactions']). Без DOM.

export const ANNOT_VIEW_KEY = 'doska.annotView';
export const RECENT_REACTIONS_KEY = 'doska.recentReactions';
/** Сколько недавних реакций выезжает из кнопки. */
export const RECENT_MAX = 5;
export const DEFAULT_RECENT: readonly string[] = ['👍', '❤️', '🔥', '😂', '👏'];
/** Самая длинная реакция в символах UTF-16 (как MAX_REACTION_LEN в src/comments.ts). */
const MAX_LEN = 16;

export interface AnnotView { reactions: boolean; comments: boolean }

let memory: AnnotView = { reactions: true, comments: true };
let recentMemory: string[] = [...DEFAULT_RECENT];
const subs = new Set<() => void>();

export function annotView(): AnnotView {
  try {
    const raw = localStorage.getItem(ANNOT_VIEW_KEY);
    if (raw) {
      const v = JSON.parse(raw) as Partial<AnnotView> | null;
      return { reactions: v?.reactions !== false, comments: v?.comments !== false };
    }
  } catch { /* хранилище недоступно или испорчено — значение из памяти */ }
  return { ...memory };
}

export function showReactions(): boolean { return annotView().reactions; }
export function showComments(): boolean { return annotView().comments; }

export function setAnnotView(patch: Partial<AnnotView>): void {
  const next = { ...annotView(), ...patch };
  memory = next;
  try {
    if (next.reactions && next.comments) localStorage.removeItem(ANNOT_VIEW_KEY);
    else localStorage.setItem(ANNOT_VIEW_KEY, JSON.stringify(next));
  } catch { /* только в памяти */ }
  for (const fn of [...subs]) fn();
}

/** Подписка на смену настройки; возвращает отписку. */
export function onAnnotView(fn: () => void): () => void {
  subs.add(fn);
  return () => { subs.delete(fn); };
}

const isReaction = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= MAX_LEN && !v.startsWith('data:');

/** Недавние реакции (свежие первыми), всегда RECENT_MAX штук: недостающие — из набора по умолчанию. */
export function recentReactions(): string[] {
  let list = recentMemory;
  try {
    const raw = localStorage.getItem(RECENT_REACTIONS_KEY);
    if (raw) {
      const v = JSON.parse(raw) as unknown;
      if (Array.isArray(v)) list = v.filter(isReaction);
    }
  } catch { /* как в памяти */ }
  const out: string[] = [];
  for (const e of [...list, ...DEFAULT_RECENT]) if (!out.includes(e) && out.length < RECENT_MAX) out.push(e);
  return out;
}

/** Реакция поставлена — она первая в недавних. */
export function noteRecentReaction(emoji: string): void {
  if (!isReaction(emoji)) return;
  const next = [emoji, ...recentReactions().filter(e => e !== emoji)].slice(0, RECENT_MAX);
  recentMemory = next;
  try { localStorage.setItem(RECENT_REACTIONS_KEY, JSON.stringify(next)); } catch { /* только в памяти */ }
}
