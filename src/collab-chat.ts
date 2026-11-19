import { DEFAULT_CURSOR_ID } from './cursors';
import { CHAT_HISTORY, createRateLimiter, normalizeChatText, type ChatMessage } from './room-chat';
import { clearNotices, markRead, pushNotice, unreadCount } from './notify-center';

// Чат комнаты (SPEC_NIGHT5 §6, SPEC_CHAT §6): слой данных без своей панели. Ленту и поле ввода рисует режим
// «Чат и уведомления» боковой панели (src/notify-panel.ts, src/chat-feed.ts, src/chat-composer.ts) по подписке onChat.
// Непрочитанные сообщения — уведомления вида 'chat' в центре уведомлений (src/notify-center.ts), пока чат не виден.
// История приходит в init, новые сообщения — {t:'chat'} от хаба (и свои тоже: хаб возвращает их отправителю).
// Всё, что написали участники, выводится только через textContent; ссылки — <a> с textContent и rel.

export { formatUnread } from './notify-center';

/** Событие на document: чат стал виден или скрыт (кнопка ЧУ обновляет aria-expanded до интеграции панели). */
export const CHAT_PANEL_EVENT = 'doska:chat-panel';

/** С какой длины показывается счётчик символов. */
export const CHAT_COUNTER_FROM = 400;
/** Сколько символов сообщения видно в превью уведомления. */
export const CHAT_PREVIEW_LEN = 80;

export const RATE_HINT = 'Не так быстро — подождите пару секунд';
export const OFFLINE_HINT = 'Нет соединения с доской';
export const READER_CHAT_TEXT = 'Читатели не пишут в чат';

/** Что изменилось в чате: лента целиком, одно новое сообщение или состояние (доступность, право писать). */
export type ChatEvent =
  | { type: 'reset' }
  | { type: 'message'; message: ChatMessage }
  | { type: 'state' };

/** Итог отправки: ушло, пусто, флуд, нет соединения или писать нельзя. */
export type ChatSendResult = 'ok' | 'empty' | 'rate' | 'offline' | 'readonly';

let messages: ChatMessage[] = [];
let myId = -1;
let visible = false;
let available = false;
let canWrite = true;
let sender: ((text: string) => boolean) | null = null;
let limiter = createRateLimiter();
let openHandler: ((tab: 'chat') => void) | null = null;
const subs = new Set<(ev: ChatEvent) => void>();

function emit(ev: ChatEvent): void {
  for (const fn of [...subs]) {
    // ошибка интерфейса ленты не должна ломать обработчик комнаты
    try { fn(ev); } catch (e) { console.error(e); }
  }
}

/** Подписка ленты на изменения чата; возвращает отписку. */
export function onChat(fn: (ev: ChatEvent) => void): () => void {
  subs.add(fn);
  return () => { subs.delete(fn); };
}

/** Кто отправляет сообщение в комнату (collab.ts); false — нет соединения. */
export function setChatSender(fn: ((text: string) => boolean) | null): void {
  sender = fn;
}

/** Аватар автора сообщения (collab.ts: смайл или фото из снимка участников). */
let avatarOf: ((userId: number) => string | null) | null = null;
export function setChatAvatarLookup(fn: ((userId: number) => string | null) | null): void {
  avatarOf = fn;
}

/** Аватар участника для ленты и уведомления: смайл, фото или null (буквы имени). */
export function chatAvatarOf(userId: number): string | null {
  return avatarOf?.(userId) ?? null;
}

/** Лёгкая проверка вложения: известный вид; подробно его проверяет отрисовка (следующий шаг). */
function isAttachmentShape(v: unknown): boolean {
  if (v === undefined) return true;
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const k = (v as Record<string, unknown>).kind;
  return k === 'image' || k === 'board' || k === 'gone' || k === 'hidden';
}

function isChatMessage(v: unknown): v is ChatMessage {
  if (!v || typeof v !== 'object') return false;
  const m = v as Record<string, unknown>;
  return typeof m.id === 'string' && typeof m.by === 'number' && typeof m.name === 'string'
    && typeof m.text === 'string' && normalizeChatText(m.text, m.att !== undefined) !== null && typeof m.ts === 'number'
    && Number.isFinite(m.ts) && (m.cursorId === undefined || typeof m.cursorId === 'string') && isAttachmentShape(m.att)
    && (m.text.trim() !== '' || m.att !== undefined);
}

/** Начало текста сообщения для уведомления: пробелы схлопнуты, длинное обрезано. */
export function chatPreviewBody(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > CHAT_PREVIEW_LEN ? `${flat.slice(0, CHAT_PREVIEW_LEN)}…` : flat;
}

/** Превью сообщения одной строкой: имя и начало текста. */
export function chatPreviewText(m: Pick<ChatMessage, 'name' | 'text'>): string {
  return `${m.name || 'Участник'}: ${chatPreviewBody(m.text)}`;
}

/** Текст уведомления о сообщении: без текста — что во вложении. */
function noticeBody(m: ChatMessage): string {
  const body = chatPreviewBody(m.text);
  if (body || !m.att) return body;
  return m.att.kind === 'image' ? 'Изображение' : m.att.kind === 'board' ? 'Объекты доски' : 'Вложение';
}

/** Обработчик «открыть чат»: интегратор открывает панель в режиме ЧУ на вкладке «Чат». */
export function setChatOpenHandler(fn: ((tab: 'chat') => void) | null): void {
  openHandler = fn;
}

/** Показать чат: без обработчика (панель не подключена) или без совместной работы — ничего. */
export function openChat(): void {
  if (!available) return;
  openHandler?.('chat');
}

/**
 * Совместимость с кнопкой ЧУ до интеграции каркаса панели: чат скрывает только вид,
 * здесь — лишь отметка «не виден».
 */
export function closeChat(): void {
  setChatVisible(false);
}

/** Вид сообщает, видна ли лента чата (панель открыта на вкладке «Все» или «Чат»). */
export function setChatVisible(on: boolean): void {
  if (visible === on) return;
  visible = on;
  if (on) markRead('chat');
  document.dispatchEvent(new CustomEvent(CHAT_PANEL_EVENT, { detail: { open: on } }));
}

/** Лента чата видна. */
export function chatOpen(): boolean {
  return visible;
}

/** Непрочитанные сообщения чата (уведомления вида 'chat' в центре уведомлений). */
export function chatUnread(): number {
  return unreadCount('chat');
}

/** Чат доступен: идёт совместная работа. */
export function chatAvailable(): boolean {
  return available;
}

/** Можно ли писать (читатель только читает, SPEC_NIGHT6 §2.3). */
export function chatCanWrite(): boolean {
  return canWrite;
}

/** Мой идентификатор в комнате: свои сообщения — справа. */
export function chatMyId(): number {
  return myId;
}

export function chatMessages(): readonly ChatMessage[] {
  return messages;
}

// ----- Отправка -----

/** Отправить сообщение: проверка текста, ограничитель частоты, соединение. */
export function sendChatMessage(raw: string): ChatSendResult {
  if (!available || !canWrite) return 'readonly';
  const text = normalizeChatText(raw);
  if (text === null) return 'empty';
  if (!sender) return 'offline';
  if (!limiter(Date.now())) return 'rate';
  return sender(text) ? 'ok' : 'offline';
}

// ----- Сообщения от комнаты -----

/** История из init: заменяет ленту, непрочитанных нет. */
export function chatReset(history: unknown, me: number): void {
  myId = me;
  messages = Array.isArray(history) ? history.filter(isChatMessage).slice(-CHAT_HISTORY) : [];
  markRead('chat');
  emit({ type: 'reset' });
}

/** Новое сообщение {t:'chat'}. */
export function chatReceive(raw: unknown): void {
  if (!isChatMessage(raw)) return;
  if (messages.some(m => m.id === raw.id)) return;
  messages.push(raw);
  if (messages.length > CHAT_HISTORY) messages.splice(0, messages.length - CHAT_HISTORY);
  emit({ type: 'message', message: raw });
  if (visible || raw.by === myId) return;
  const name = raw.name || 'Участник';
  pushNotice({
    kind: 'chat',
    title: name,
    body: noticeBody(raw),
    chatId: raw.id,
    ts: raw.ts,
    user: { userId: raw.by, name, cursorId: raw.cursorId ?? DEFAULT_CURSOR_ID, avatar: chatAvatarOf(raw.by) },
    onClick: () => openChat(),
  });
}

export function setChatCanWrite(on: boolean): void {
  if (canWrite === on) return;
  canWrite = on;
  emit({ type: 'state' });
}

/** Чат доступен, пока идёт совместная работа; выключение сбрасывает ленту и непрочитанные. */
export function setChatAvailable(on: boolean): void {
  const was = available;
  available = on;
  if (!on) {
    messages = [];
    clearNotices('chat');
    limiter = createRateLimiter();
  }
  if (was !== on || !on) emit({ type: 'state' });
}
