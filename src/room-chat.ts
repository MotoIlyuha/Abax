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
  text: string;
  ts: number;
}

/** Текст сообщения после trim; null — пустое, слишком длинное или не строка. */
export function normalizeChatText(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const text = raw.trim();
  if (text.length === 0 || text.length > CHAT_MAX_LEN) return null;
  return text;
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
