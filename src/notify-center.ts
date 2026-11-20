// Центр уведомлений «Чата и уведомлений» (ЧУ, SPEC_CHAT §2): чистая логика без DOM.
// Хранит последние уведомления — сообщения чата от других участников и системные события комнаты, —
// считает непрочитанные и сообщает подписчикам (кнопка ЧУ, стопка, позже — панель) о каждом изменении.
// Тихие уведомления (отклик на моё действие) приходят уже прочитанными: в стопке видны, но не копятся.
// «Не беспокоить» хранится в localStorage['doska.dnd'] (доступ — только в try/catch).

/** chat — сообщение чата, comment — комментарий или реакция на объект (SPEC_COMMENTS §6), system — событие доски. */
export type NoticeKind = 'chat' | 'comment' | 'system';
export type NoticeLevel = 'info' | 'ok' | 'warn';
/** Иконка системного события — ключ каталога иконок (SVG — константы кода, src/icons.ts). */
export type NoticeIcon = 'bell' | 'join' | 'leave' | 'rename' | 'cursor' | 'avatar' | 'role' | 'rights' | 'summon'
  | 'follow' | 'link' | 'offline' | 'online' | 'hidden' | 'draft' | 'remove' | 'image' | 'board';
export interface NoticeAction { label: string; run: () => void }
export interface NoticeUser { userId?: number; name: string; cursorId?: string; avatar?: string | null }
export interface NoticeInput {
  /** По умолчанию 'system'. */
  kind?: NoticeKind;
  /** По умолчанию 'info'. */
  level?: NoticeLevel;
  /** Имя участника или короткий заголовок. */
  title: string;
  /** Текст сообщения или пояснение. */
  body?: string;
  icon?: NoticeIcon;
  /** Для аватара (событие участника, сообщение чата). */
  user?: NoticeUser;
  action?: NoticeAction;
  /** Ещё действия после action (уведомление о комментарии: «Перейти» и «Посмотреть»). */
  actions?: NoticeAction[];
  /** Эмодзи вместо значка события (реакция, «Привлечь внимание»): только textContent. */
  emoji?: string;
  onClick?: () => void;
  /** Отклик на моё действие: в стопке показывается, но сразу прочитано. */
  quiet?: boolean;
  /** Сообщение чата, к которому ведёт уведомление. */
  chatId?: string;
  /** Объект (и ветка комментариев), к которому относится уведомление о комментарии или реакции. */
  ref?: { pageId: string; elId?: string; threadId?: string };
  ts?: number;
}
export interface Notice extends NoticeInput { id: string; kind: NoticeKind; level: NoticeLevel; ts: number; read: boolean }

/** Сколько уведомлений помнит центр: старые вытесняются. */
export const NOTICE_LIMIT = 200;
/** Ключ «Не беспокоить» в localStorage. */
export const DND_KEY = 'doska.dnd';

/** Что изменилось: подписчик получает каждое изменение отдельно. */
export type NoticeEvent =
  | { type: 'push'; notice: Notice; dropped: readonly Notice[] }
  | { type: 'read'; ids: readonly string[] }
  | { type: 'clear'; ids: readonly string[] }
  | { type: 'dnd'; on: boolean };

let list: Notice[] = [];
let seq = 0;
/** «Не беспокоить», если localStorage недоступен. */
let dndMemory = false;
const subs = new Set<(ev: NoticeEvent) => void>();

function emit(ev: NoticeEvent): void {
  for (const fn of [...subs]) {
    // ошибка в интерфейсе уведомлений не должна ломать того, кто сообщил о событии (обработчик комнаты)
    try { fn(ev); } catch (e) { console.error(e); }
  }
}

/** Новое уведомление; возвращает его запись (id, время, прочитано ли). */
export function pushNotice(input: NoticeInput): Notice {
  const n: Notice = {
    ...input,
    id: `n${++seq}`,
    kind: input.kind === 'chat' || input.kind === 'comment' ? input.kind : 'system',
    level: input.level === 'ok' || input.level === 'warn' ? input.level : 'info',
    title: String(input.title ?? ''),
    ts: typeof input.ts === 'number' && Number.isFinite(input.ts) ? input.ts : Date.now(),
    read: input.quiet === true,
  };
  list.push(n);
  const dropped = list.length > NOTICE_LIMIT ? list.splice(0, list.length - NOTICE_LIMIT) : [];
  emit({ type: 'push', notice: n, dropped });
  return n;
}

/** Все действия уведомления по порядку: action, затем actions. */
export function noticeActions(n: Pick<NoticeInput, 'action' | 'actions'>): NoticeAction[] {
  return [...(n.action ? [n.action] : []), ...(n.actions ?? [])];
}

/** Все уведомления по времени (старые первыми). */
export function notices(): readonly Notice[] {
  return list;
}

export function noticeById(id: string): Notice | undefined {
  return list.find(n => n.id === id);
}

/** Непрочитанные (тихие не считаются: они приходят прочитанными); kind — только чат или только системные. */
export function unreadCount(kind?: NoticeKind): number {
  let n = 0;
  for (const x of list) if (!x.read && (!kind || x.kind === kind)) n++;
  return n;
}

/** Пометить прочитанными все уведомления (или одного вида). */
export function markRead(kind?: NoticeKind): void {
  const ids: string[] = [];
  for (const n of list) {
    if (n.read || (kind && n.kind !== kind)) continue;
    n.read = true;
    ids.push(n.id);
  }
  if (ids.length) emit({ type: 'read', ids });
}

/** Пометить прочитанным одно уведомление; false — его нет или оно уже прочитано. */
export function markNoticeRead(id: string): boolean {
  const n = noticeById(id);
  if (!n || n.read) return false;
  n.read = true;
  emit({ type: 'read', ids: [id] });
  return true;
}

/** Забыть уведомления (все или одного вида). */
export function clearNotices(kind?: NoticeKind): void {
  const ids = list.filter(n => !kind || n.kind === kind).map(n => n.id);
  if (!ids.length) return;
  list = kind ? list.filter(n => n.kind !== kind) : [];
  emit({ type: 'clear', ids });
}

/** Подписка на изменения; возвращает отписку. */
export function onNotices(fn: (ev: NoticeEvent) => void): () => void {
  subs.add(fn);
  return () => { subs.delete(fn); };
}

// ----- «Не беспокоить» -----

export function doNotDisturb(): boolean {
  try {
    const v = localStorage.getItem(DND_KEY);
    if (v !== null) return v === '1';
  } catch { /* хранилище недоступно — помним в памяти */ }
  return dndMemory;
}

export function setDoNotDisturb(on: boolean): void {
  if (doNotDisturb() === on) return;
  dndMemory = on;
  try {
    if (on) localStorage.setItem(DND_KEY, '1');
    else localStorage.removeItem(DND_KEY);
  } catch { /* хранилище недоступно — только в памяти */ }
  emit({ type: 'dnd', on });
}

// ----- Подписи (чистые функции для кнопки, стопки и панели) -----

/** Текст счётчика: пусто, 1…99 или 99+. */
export function formatUnread(n: number): string {
  if (!(n > 0)) return '';
  return n > 99 ? '99+' : String(Math.floor(n));
}

/** Уведомление одной строкой: для чтения с экрана и подписи карточки. */
export function noticeText(n: Pick<Notice, 'kind' | 'title' | 'body' | 'user'>): string {
  const title = n.title.trim();
  const body = (n.body ?? '').trim();
  if (!body) return title;
  if (!title) return body;
  if (n.kind === 'chat') return `${title}: ${body}`;
  // комментарий или реакция: «Капибара · Фигура «Задача»: Почему так?»
  if (n.kind === 'comment') return `${title} · ${body}`;
  // событие участника — одно предложение: «Капибара присоединился к доске»
  if (n.user) return `${title} ${body}`;
  return /[.!?…]$/.test(title) ? `${title} ${body}` : `${title}. ${body}`;
}

const MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const pad2 = (v: number): string => String(v).padStart(2, '0');

/** Время уведомления: «сейчас», «2 мин», «14:02» (сегодня), иначе «18 ноя». */
export function noticeTimeLabel(ts: number, now = Date.now()): string {
  const diff = now - ts;
  if (diff < 60_000) return 'сейчас';
  if (diff < 60 * 60_000) return `${Math.floor(diff / 60_000)} мин`;
  const d = new Date(ts);
  const today = new Date(now);
  if (d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth() && d.getDate() === today.getDate()) {
    return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  }
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}
