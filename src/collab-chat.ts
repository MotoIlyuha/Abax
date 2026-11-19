import { DEFAULT_CURSOR_ID, cursorPreset, isCursorId } from './cursors';
import { CHAT_HISTORY, CHAT_MAX_LEN, createRateLimiter, normalizeChatText, tokenizeChat, type ChatMessage } from './room-chat';
import { clearNotices, markRead, pushNotice, unreadCount } from './notify-center';

// Чат комнаты (SPEC_NIGHT5 §6): панель с лентой и полем ввода. Непрочитанные сообщения — уведомления вида 'chat'
// в центре уведомлений (src/notify-center.ts): их считает кнопка «Чат и уведомления» (src/notify-button.ts).
// История приходит в init, новые сообщения — {t:'chat'} от хаба (и свои тоже: хаб возвращает их отправителю).
// Всё, что написали участники, выводится только через textContent; ссылки — <a> с textContent и rel.

export { formatUnread } from './notify-center';

/** Событие на document: панель чата открылась или закрылась (кнопка ЧУ обновляет aria-expanded). */
export const CHAT_PANEL_EVENT = 'doska:chat-panel';

/** С какой длины показывается счётчик символов. */
export const CHAT_COUNTER_FROM = 400;
/** Сколько символов сообщения видно в превью при закрытой панели. */
export const CHAT_PREVIEW_LEN = 80;

const RATE_HINT = 'Не так быстро — подождите пару секунд';
const OFFLINE_HINT = 'Нет соединения с доской';

let messages: ChatMessage[] = [];
let myId = -1;
let open = false;
let available = false;
let sender: ((text: string) => boolean) | null = null;
let limiter = createRateLimiter();

interface Ui { panel: HTMLElement; list: HTMLElement; empty: HTMLElement; input: HTMLTextAreaElement; count: HTMLElement; hint: HTMLElement }
let ui: Ui | null = null;

/** Кто отправляет сообщение в комнату (collab.ts); false — нет соединения. */
export function setChatSender(fn: ((text: string) => boolean) | null): void {
  sender = fn;
}

/** Аватар автора сообщения для уведомления (collab.ts: смайл или фото из снимка участников). */
let avatarOf: ((userId: number) => string | null) | null = null;
export function setChatAvatarLookup(fn: ((userId: number) => string | null) | null): void {
  avatarOf = fn;
}

function isChatMessage(v: unknown): v is ChatMessage {
  if (!v || typeof v !== 'object') return false;
  const m = v as Record<string, unknown>;
  return typeof m.id === 'string' && typeof m.by === 'number' && typeof m.name === 'string'
    && typeof m.text === 'string' && m.text.length <= CHAT_MAX_LEN && typeof m.ts === 'number'
    && (m.cursorId === undefined || typeof m.cursorId === 'string');
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

function timeOf(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Панель открылась или закрылась: кнопка ЧУ обновляет aria-expanded. */
function announcePanel(): void {
  document.dispatchEvent(new CustomEvent(CHAT_PANEL_EVENT, { detail: { open } }));
}

// ----- Панель -----

function buildUi(): Ui {
  const panel = document.createElement('div');
  panel.id = 'chat-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Чат комнаты');
  panel.hidden = true;
  const head = document.createElement('div');
  head.className = 'chat-head';
  const title = document.createElement('span');
  title.className = 'chat-title';
  title.textContent = 'Чат';
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'chat-close';
  close.title = 'Закрыть';
  close.setAttribute('aria-label', 'Закрыть чат');
  close.textContent = '✕';
  close.addEventListener('click', () => closeChat());
  head.append(title, close);
  const list = document.createElement('div');
  list.className = 'chat-list';
  list.setAttribute('role', 'log');
  const empty = document.createElement('div');
  empty.className = 'chat-empty';
  empty.textContent = 'Сообщений пока нет';
  const input = document.createElement('textarea');
  input.className = 'chat-input';
  input.rows = 2;
  input.maxLength = CHAT_MAX_LEN;
  input.placeholder = 'Сообщение… (Enter — отправить, Shift+Enter — новая строка)';
  input.setAttribute('aria-label', 'Сообщение в чат');
  const foot = document.createElement('div');
  foot.className = 'chat-foot';
  const hint = document.createElement('span');
  hint.className = 'chat-hint';
  const count = document.createElement('span');
  count.className = 'chat-count';
  foot.append(hint, count);
  panel.append(head, list, empty, input, foot);
  input.addEventListener('keydown', ev => {
    if (ev.key === 'Enter' && !ev.shiftKey && !ev.isComposing) {
      ev.preventDefault();
      submit();
    }
  });
  input.addEventListener('input', () => { renderCount(); hint.textContent = ''; });
  panel.addEventListener('keydown', ev => {
    if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); closeChat(); }
  });
  document.body.appendChild(panel);
  return { panel, list, empty, input, count, hint };
}

function renderCount(): void {
  if (!ui) return;
  const len = ui.input.value.length;
  ui.count.textContent = len > CHAT_COUNTER_FROM ? `${len}/${CHAT_MAX_LEN}` : '';
}

function messageNode(m: ChatMessage): HTMLElement {
  const row = document.createElement('div');
  row.className = 'chat-msg' + (m.by === myId ? ' mine' : '');
  const meta = document.createElement('div');
  meta.className = 'chat-meta';
  const name = document.createElement('span');
  name.className = 'chat-name';
  const preset = cursorPreset(m.cursorId && isCursorId(m.cursorId) ? m.cursorId : DEFAULT_CURSOR_ID);
  name.style.background = preset.badgeBg;
  name.style.color = preset.badgeText;
  name.textContent = m.name || 'Участник';
  const time = document.createElement('time');
  time.className = 'chat-time';
  time.textContent = timeOf(m.ts);
  time.dateTime = new Date(m.ts).toISOString();
  meta.append(name, time);
  const text = document.createElement('div');
  text.className = 'chat-text';
  for (const tok of tokenizeChat(m.text)) {
    if (tok.kind === 'link') {
      const a = document.createElement('a');
      a.href = tok.value;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = tok.value;
      text.appendChild(a);
    } else {
      text.appendChild(document.createTextNode(tok.value));
    }
  }
  row.append(meta, text);
  return row;
}

function renderList(): void {
  if (!ui) return;
  ui.list.textContent = '';
  for (const m of messages) ui.list.appendChild(messageNode(m));
  ui.empty.hidden = messages.length > 0;
  ui.list.scrollTop = ui.list.scrollHeight;
}

function submit(): void {
  if (!ui || !canWrite) return;
  const text = normalizeChatText(ui.input.value);
  if (text === null) return;
  if (!sender) { ui.hint.textContent = OFFLINE_HINT; return; }
  if (!limiter(Date.now())) { ui.hint.textContent = RATE_HINT; return; }
  if (!sender(text)) { ui.hint.textContent = OFFLINE_HINT; return; }
  ui.input.value = '';
  ui.hint.textContent = '';
  renderCount();
}

export function openChat(): void {
  if (!available) return;
  if (!ui || !ui.panel.isConnected) ui = buildUi(); // панель могли убрать из документа вместе с интерфейсом
  open = true;
  markRead('chat');
  ui.panel.hidden = false;
  renderList();
  announcePanel();
  renderWrite();
  if (canWrite) ui.input.focus();
  else ui.panel.querySelector<HTMLButtonElement>('.chat-close')?.focus();
}

export function closeChat(): void {
  const was = open;
  open = false;
  if (ui) ui.panel.hidden = true;
  if (was) announcePanel();
}

export function toggleChat(): void {
  if (open) closeChat();
  else openChat();
}

export function chatOpen(): boolean {
  return open;
}

/** Непрочитанные сообщения чата (уведомления вида 'chat' в центре уведомлений). */
export function chatUnread(): number {
  return unreadCount('chat');
}

/** Чат доступен: идёт совместная работа. */
export function chatAvailable(): boolean {
  return available;
}

export function chatMessages(): readonly ChatMessage[] {
  return messages;
}

// ----- Сообщения от комнаты -----

/** История из init: заменяет ленту, непрочитанных нет. */
export function chatReset(history: unknown, me: number): void {
  myId = me;
  messages = Array.isArray(history) ? history.filter(isChatMessage).slice(-CHAT_HISTORY) : [];
  markRead('chat');
  if (open) renderList();
}

/** Новое сообщение {t:'chat'}. */
export function chatReceive(raw: unknown): void {
  if (!isChatMessage(raw)) return;
  if (messages.some(m => m.id === raw.id)) return;
  messages.push(raw);
  if (messages.length > CHAT_HISTORY) messages.splice(0, messages.length - CHAT_HISTORY);
  if (open && ui) {
    ui.list.appendChild(messageNode(raw));
    while (ui.list.childElementCount > messages.length) ui.list.firstElementChild?.remove();
    ui.empty.hidden = true;
    ui.list.scrollTop = ui.list.scrollHeight;
    return;
  }
  if (raw.by === myId) return;
  const name = raw.name || 'Участник';
  pushNotice({
    kind: 'chat',
    title: name,
    body: chatPreviewBody(raw.text),
    chatId: raw.id,
    ts: raw.ts,
    user: { userId: raw.by, name, cursorId: raw.cursorId ?? DEFAULT_CURSOR_ID, avatar: avatarOf?.(raw.by) ?? null },
    onClick: () => openChat(),
  });
}

/** Чат доступен, пока идёт совместная работа; выключение сбрасывает ленту и закрывает панель. */
/** Можно ли писать в чат (читатель только читает, SPEC_NIGHT6 §2.3). */
let canWrite = true;
export const READER_CHAT_TEXT = 'Читатели не пишут в чат';
export function setChatCanWrite(on: boolean): void {
  canWrite = on;
  renderWrite();
}
function renderWrite(): void {
  if (!ui) return;
  ui.input.hidden = !canWrite;
  ui.panel.classList.toggle('chat-readonly', !canWrite);
  ui.hint.textContent = canWrite ? (ui.hint.textContent === READER_CHAT_TEXT ? '' : ui.hint.textContent) : READER_CHAT_TEXT;
}

export function setChatAvailable(on: boolean): void {
  available = on;
  if (!on) {
    closeChat();
    messages = [];
    clearNotices('chat');
    limiter = createRateLimiter();
    if (ui) { ui.input.value = ''; ui.hint.textContent = ''; renderCount(); renderList(); }
  }
}
