// Присутствие участников на страницах (SPEC_NIGHT5 §8): инициалы, аватары у вкладок, куда переходить, когда
// страницу скрыли. Чистые функции без DOM.

/** 1–2 заглавные буквы имени: первые буквы двух первых слов; нет букв и цифр — «?». */
export function getParticipantInitials(name: string | null | undefined): string {
  const words = String(name ?? '')
    .split(/\s+/)
    .map(w => w.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter(w => w.length > 0);
  if (words.length === 0) return '?';
  const first = Array.from(words[0])[0];
  const second = words.length > 1 ? Array.from(words[1])[0] : '';
  return (first + second).toLocaleUpperCase('ru');
}

export interface PresenceUser {
  userId: number;
  pageId?: string | null;
  hiddenPage?: boolean;
  away?: boolean;
}

/** Участники на странице (кроме меня): до max для показа и сколько не поместилось. */
export function pageAvatars<U extends PresenceUser>(users: readonly U[], pageId: string, myId: number, max = 3): { shown: U[]; more: number } {
  const here = users.filter(u => u.userId !== myId && !u.hiddenPage && u.pageId === pageId);
  return { shown: here.slice(0, max), more: Math.max(0, here.length - max) };
}

/**
 * Куда перейти, когда текущую страницу скрыли: ближайшая доступная по прежнему порядку — следующая, иначе предыдущая.
 * order — порядок страниц до изменения (с пропавшей), visible — id страниц, доступных теперь. null — доступных нет.
 */
export function nearestAvailablePage(order: readonly string[], currentId: string, visible: readonly string[]): string | null {
  if (visible.length === 0) return null;
  const vis = new Set(visible);
  if (vis.has(currentId)) return currentId;
  const i = order.indexOf(currentId);
  if (i >= 0) {
    for (let j = i + 1; j < order.length; j++) if (vis.has(order[j])) return order[j];
    for (let j = i - 1; j >= 0; j--) if (vis.has(order[j])) return order[j];
  }
  return visible[0];
}
