// Правила чата комнаты (SPEC_NIGHT5 §3, §6): общие для хаба (src/room-host.ts; зеркало — electron/room.cjs)
// и клиента. Чистый модуль без DOM.

/** Максимум символов в сообщении: длиннее — отказ, не обрезка. */
export const CHAT_MAX_LEN = 500;
/** Сколько последних сообщений хранит комната и отдаёт новым участникам в init. */
export const CHAT_HISTORY = 100;
/** Не больше CHAT_RATE_COUNT сообщений за CHAT_RATE_MS от одного участника; лишние молча отбрасываются. */
export const CHAT_RATE_COUNT = 5;
export const CHAT_RATE_MS = 3000;

export interface ChatMessage {
  id: string;
  /** Участник комнаты (userId хаба). */
  by: number;
  name: string;
  cursorId?: string;
  /** Может быть пустым, только если есть вложение. */
  text: string;
  ts: number;
  /** Вложение (SPEC_CHAT §7): картинка или объекты доски; хранится только в памяти хаба. */
  att?: ChatAttachment;
}

/**
 * Текст сообщения после trim; null — пустое (без вложения), слишком длинное или не строка.
 * С вложением (allowEmpty) пустой или отсутствующий текст допустим и становится ''.
 */
export function normalizeChatText(raw: unknown, allowEmpty = false): string | null {
  if (allowEmpty && raw === undefined) return '';
  if (typeof raw !== 'string') return null;
  const text = raw.trim();
  if ((text.length === 0 && !allowEmpty) || text.length > CHAT_MAX_LEN) return null;
  return text;
}

// ----- Вложения (SPEC_CHAT §7). Зеркало для хаба Electron — electron/room-chat-att.cjs (паритет —
// tests/server/room-chat-att.test.ts). -----

/** Картинка: data URL (jpeg/png/webp в base64) и её размеры в пикселях. */
export interface ChatImageAtt { kind: 'image'; src: string; w: number; h: number }
/** Объекты доски: откуда, сколько, превью выделения и (если можно копировать) копии элементов. */
export interface ChatBoardAtt {
  kind: 'board'; pageId: string; pageName: string; ids: string[]; count: number;
  preview: string; w: number; h: number;
  /** Копии элементов для «Вставить копию»; нет — только просмотр (слишком велико или копирование запрещено). */
  elements?: unknown[];
}
/** Вложение вытеснено из памяти хаба (бюджет) или страница скрыта для получателя. */
export interface ChatGoneAtt { kind: 'gone'; was: 'image' | 'board' }
export interface ChatHiddenAtt { kind: 'hidden' }
export type ChatAttachment = ChatImageAtt | ChatBoardAtt | ChatGoneAtt | ChatHiddenAtt;

/** Максимум символов data URL картинки. */
export const CHAT_IMAGE_MAX = 400_000;
/** Максимум символов data URL превью объектов доски. */
export const CHAT_PREVIEW_MAX = 200_000;
/** Ширина и высота картинки и превью — целые 1…CHAT_SIDE_MAX. */
export const CHAT_SIDE_MAX = 4096;
/** Сколько объектов доски (идентификаторов и копий) в одном вложении. */
export const CHAT_BOARD_IDS_MAX = 200;
/** Предел JSON копий элементов: больше — копии срезаются, вложение остаётся только для просмотра. */
export const CHAT_BOARD_JSON_MAX = 300_000;
/** Сколько символов вложений хранит буфер комнаты: сверх — у самых старых вложение становится gone. */
export const CHAT_ATT_BUDGET = 6_000_000;
/** Длина идентификатора страницы и объекта во вложении (как MAX_ID хаба). */
export const CHAT_ATT_ID_MAX = 128;
/** Название страницы во вложении обрезается до стольких символов. */
export const CHAT_PAGE_NAME_MAX = 120;

const CHAT_DATA_URL = /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/;

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const isSide = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 1 && (v as number) <= CHAT_SIDE_MAX;
const isAttId = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= CHAT_ATT_ID_MAX;
const isDataUrl = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max && CHAT_DATA_URL.test(v);

/** Data URL картинки чата в допустимой форме (jpeg/png/webp, base64, не длиннее CHAT_IMAGE_MAX): только такое — в img.src. */
export function isChatImageUrl(v: unknown): v is string {
  return isDataUrl(v, CHAT_IMAGE_MAX);
}

/**
 * Копии элементов без поля by (автора ставит только хаб); undefined — копий нет или их JSON больше предела
 * (вложение остаётся для просмотра), null — форма неверна или среди них задание (ответы не утекают).
 */
function cleanBoardElements(raw: unknown): unknown[] | undefined | null {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw) || raw.length > CHAT_BOARD_IDS_MAX) return null;
  const out: unknown[] = [];
  for (const el of raw) {
    if (!isRec(el) || typeof el.type !== 'string' || el.type === 'task') return null;
    const { by: _by, ...rest } = el;
    out.push(rest);
  }
  return JSON.stringify(out).length > CHAT_BOARD_JSON_MAX ? undefined : out;
}

/**
 * Вложение сообщения после проверки хабом: только известные поля в строгой форме.
 * undefined — вложения нет; null — сообщение отклоняется (неверная форма, задание среди объектов,
 * объекты доски без права copy — скриншот выделения тоже копия).
 */
export function cleanChatAttachment(raw: unknown, opts: { copy: boolean }): ChatAttachment | undefined | null {
  if (raw === undefined || raw === null) return undefined;
  if (!isRec(raw)) return null;
  if (raw.kind === 'image') {
    if (!isDataUrl(raw.src, CHAT_IMAGE_MAX) || !isSide(raw.w) || !isSide(raw.h)) return null;
    return { kind: 'image', src: raw.src, w: raw.w, h: raw.h };
  }
  if (raw.kind !== 'board' || !opts.copy) return null;
  const { pageId, pageName, ids, count, preview, w, h } = raw;
  if (!isAttId(pageId) || typeof pageName !== 'string') return null;
  if (!Array.isArray(ids) || ids.length > CHAT_BOARD_IDS_MAX || !ids.every(isAttId)) return null;
  if (!Number.isInteger(count) || (count as number) < 1 || (count as number) > CHAT_BOARD_IDS_MAX) return null;
  if (!isDataUrl(preview, CHAT_PREVIEW_MAX) || !isSide(w) || !isSide(h)) return null;
  const elements = cleanBoardElements(raw.elements);
  if (elements === null) return null;
  return {
    kind: 'board', pageId, pageName: Array.from(pageName).slice(0, CHAT_PAGE_NAME_MAX).join(''), ids: [...ids],
    count: count as number, preview, w, h, ...(elements ? { elements } : {}),
  };
}

const attSizes = new WeakMap<object, number>();
/** Сколько символов вложение занимает в буфере комнаты (gone и hidden — ничего). */
export function chatAttachmentSize(att: ChatAttachment | undefined): number {
  if (!att || (att.kind !== 'image' && att.kind !== 'board')) return 0;
  let size = attSizes.get(att);
  if (size === undefined) {
    size = JSON.stringify(att).length;
    attSizes.set(att, size);
  }
  return size;
}

/** Бюджет буфера: пока вложения больше CHAT_ATT_BUDGET, у самых старых вложение → { kind: 'gone', was }. */
export function trimChatAttachments(list: ChatMessage[]): ChatMessage[] {
  let total = 0;
  for (const m of list) total += chatAttachmentSize(m.att);
  if (total <= CHAT_ATT_BUDGET) return list;
  return list.map(m => {
    const size = chatAttachmentSize(m.att);
    if (total <= CHAT_ATT_BUDGET || size === 0 || !m.att || (m.att.kind !== 'image' && m.att.kind !== 'board')) return m;
    total -= size;
    return { ...m, att: { kind: 'gone', was: m.att.kind } };
  });
}

/**
 * Сообщение для получателя: объекты доски со страницы, скрытой для него, приходят как { kind: 'hidden' } —
 * без превью, копий и названия страницы. Остальное — то же сообщение.
 */
export function chatMessageFor(m: ChatMessage, canSeePage: (pageId: string) => boolean): ChatMessage {
  if (m.att?.kind !== 'board' || canSeePage(m.att.pageId)) return m;
  return { ...m, att: { kind: 'hidden' } };
}

/** Ограничитель частоты: true — сообщение можно принять (и оно учтено). */
export function createRateLimiter(count = CHAT_RATE_COUNT, windowMs = CHAT_RATE_MS): (now: number) => boolean {
  const times: number[] = [];
  return now => {
    while (times.length > 0 && now - times[0] >= windowMs) times.shift();
    if (times.length >= count) return false;
    times.push(now);
    return true;
  };
}

export interface ChatToken { kind: 'text' | 'link'; value: string }

const LINK = /https:\/\/[^\s<>"']+/g;
/** Знаки препинания в конце ссылки обычно относятся к фразе, а не к адресу. */
const TRAILING = /[.,;:!?…)\]}»"']+$/;

/** Текст и ссылки https:// для безопасного вывода (textContent + <a rel="noopener noreferrer">). */
export function tokenizeChat(text: string): ChatToken[] {
  const out: ChatToken[] = [];
  const push = (kind: ChatToken['kind'], value: string) => {
    if (value === '') return;
    const last = out[out.length - 1];
    if (kind === 'text' && last?.kind === 'text') last.value += value;
    else out.push({ kind, value });
  };
  let pos = 0;
  for (const m of text.matchAll(LINK)) {
    const start = m.index ?? 0;
    let url = m[0];
    const tail = TRAILING.exec(url)?.[0] ?? '';
    url = url.slice(0, url.length - tail.length);
    push('text', text.slice(pos, start));
    if (url.length > 'https://'.length) push('link', url);
    else push('text', url);
    push('text', tail);
    pos = start + m[0].length;
  }
  push('text', text.slice(pos));
  return out;
}
