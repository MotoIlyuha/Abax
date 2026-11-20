// Вложения чата комнаты (SPEC_CHAT §7) для хаба Electron — зеркало правил из src/room-chat.ts.
// Паритет с TypeScript-версией проверяет tests/server/room-chat-att.test.ts.

/** Максимум символов data URL картинки. */
const CHAT_IMAGE_MAX = 400000;
/** Максимум символов data URL превью объектов доски. */
const CHAT_PREVIEW_MAX = 200000;
/** Ширина и высота картинки и превью — целые 1…CHAT_SIDE_MAX. */
const CHAT_SIDE_MAX = 4096;
/** Сколько объектов доски (идентификаторов и копий) в одном вложении. */
const CHAT_BOARD_IDS_MAX = 200;
/** Предел JSON копий элементов: больше — копии срезаются, вложение остаётся только для просмотра. */
const CHAT_BOARD_JSON_MAX = 300000;
/** Сколько символов вложений хранит буфер комнаты: сверх — у самых старых вложение становится gone. */
const CHAT_ATT_BUDGET = 6000000;
/** Длина идентификатора страницы и объекта во вложении (как MAX_ID хаба). */
const CHAT_ATT_ID_MAX = 128;
/** Название страницы во вложении обрезается до стольких символов. */
const CHAT_PAGE_NAME_MAX = 120;

const CHAT_DATA_URL = /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/;

const isRec = v => typeof v === 'object' && v !== null && !Array.isArray(v);
const isSide = v => Number.isInteger(v) && v >= 1 && v <= CHAT_SIDE_MAX;
const isAttId = v => typeof v === 'string' && v.length > 0 && v.length <= CHAT_ATT_ID_MAX;
const isDataUrl = (v, max) => typeof v === 'string' && v.length <= max && CHAT_DATA_URL.test(v);

/**
 * Копии элементов без поля by; undefined — копий нет или их JSON больше предела (только просмотр),
 * null — форма неверна или среди них задание.
 */
function cleanBoardElements(raw) {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw) || raw.length > CHAT_BOARD_IDS_MAX) return null;
  const out = [];
  for (const el of raw) {
    if (!isRec(el) || typeof el.type !== 'string' || el.type === 'task') return null;
    const { by: _by, ...rest } = el;
    out.push(rest);
  }
  return JSON.stringify(out).length > CHAT_BOARD_JSON_MAX ? undefined : out;
}

/** Вложение после проверки: вложение, undefined — его нет, null — сообщение отклоняется. */
function cleanChatAttachment(raw, opts) {
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
  if (!Number.isInteger(count) || count < 1 || count > CHAT_BOARD_IDS_MAX) return null;
  if (!isDataUrl(preview, CHAT_PREVIEW_MAX) || !isSide(w) || !isSide(h)) return null;
  const elements = cleanBoardElements(raw.elements);
  if (elements === null) return null;
  return {
    kind: 'board', pageId, pageName: Array.from(pageName).slice(0, CHAT_PAGE_NAME_MAX).join(''), ids: [...ids],
    count, preview, w, h, ...(elements ? { elements } : {}),
  };
}

const attSizes = new WeakMap();
/** Сколько символов вложение занимает в буфере комнаты (gone и hidden — ничего). */
function chatAttachmentSize(att) {
  if (!att || (att.kind !== 'image' && att.kind !== 'board')) return 0;
  let size = attSizes.get(att);
  if (size === undefined) {
    size = JSON.stringify(att).length;
    attSizes.set(att, size);
  }
  return size;
}

/** Бюджет буфера: пока вложения больше CHAT_ATT_BUDGET, у самых старых вложение → { kind: 'gone', was }. */
function trimChatAttachments(list) {
  let total = 0;
  for (const m of list) total += chatAttachmentSize(m.att);
  if (total <= CHAT_ATT_BUDGET) return list;
  return list.map(m => {
    const size = chatAttachmentSize(m.att);
    if (total <= CHAT_ATT_BUDGET || size === 0) return m;
    total -= size;
    return { ...m, att: { kind: 'gone', was: m.att.kind } };
  });
}

/** Сообщение для получателя: объекты со скрытой для него страницы — { kind: 'hidden' }. */
function chatMessageFor(m, canSeePage) {
  if (!m.att || m.att.kind !== 'board' || canSeePage(m.att.pageId)) return m;
  return { ...m, att: { kind: 'hidden' } };
}

module.exports = {
  CHAT_IMAGE_MAX, CHAT_PREVIEW_MAX, CHAT_SIDE_MAX, CHAT_BOARD_IDS_MAX, CHAT_BOARD_JSON_MAX, CHAT_ATT_BUDGET, CHAT_ATT_ID_MAX,
  CHAT_PAGE_NAME_MAX, cleanChatAttachment, chatAttachmentSize, trimChatAttachments, chatMessageFor,
};
