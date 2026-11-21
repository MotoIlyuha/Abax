import { describe, expect, it } from 'vitest';
import {
  CHAT_ATT_BUDGET, CHAT_BOARD_IDS_MAX, CHAT_BOARD_JSON_MAX, CHAT_IMAGE_MAX, CHAT_MAX_LEN, CHAT_PAGE_NAME_MAX, CHAT_PREVIEW_MAX,
  chatAttachmentSize, chatMessageFor, cleanChatAttachment, createRateLimiter, normalizeChatText, tokenizeChat, trimChatAttachments,
  type ChatAttachment, type ChatMessage,
} from '../../src/room-chat';

describe('текст сообщения', () => {
  it('trim и границы 1..500', () => {
    expect(normalizeChatText('  привет  ')).toBe('привет');
    expect(normalizeChatText('   ')).toBeNull();
    expect(normalizeChatText('')).toBeNull();
    expect(normalizeChatText('я'.repeat(CHAT_MAX_LEN))).toHaveLength(CHAT_MAX_LEN);
    expect(normalizeChatText('я'.repeat(CHAT_MAX_LEN + 1))).toBeNull();
    expect(normalizeChatText(42)).toBeNull();
    expect(normalizeChatText(null)).toBeNull();
  });
  it('с вложением пустой текст допустим, остальные правила те же', () => {
    expect(normalizeChatText('   ', true)).toBe('');
    expect(normalizeChatText(undefined, true)).toBe('');
    expect(normalizeChatText(undefined)).toBeNull();
    expect(normalizeChatText(' подпись ', true)).toBe('подпись');
    expect(normalizeChatText('я'.repeat(CHAT_MAX_LEN + 1), true)).toBeNull();
    expect(normalizeChatText(null, true)).toBeNull();
    expect(normalizeChatText(5, true)).toBeNull();
  });
});

const jpeg = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';
const png = 'data:image/png;base64,iVBORw0KGgo=';
const shape = (id: string, extra: Record<string, unknown> = {}) => ({ id, type: 'shape', kind: 'rect', x: 0, y: 0, w: 1, h: 1, ...extra });
const board = (extra: Record<string, unknown> = {}) => ({
  kind: 'board', pageId: 'pg', pageName: 'Страница', ids: ['a'], count: 1, preview: png, w: 100, h: 50, elements: [shape('a')], ...extra,
});
const ok = { copy: true };

describe('вложения чата (SPEC_CHAT §7)', () => {
  it('нет вложения - undefined; не объект и чужие виды - отказ сообщения', () => {
    expect(cleanChatAttachment(undefined, ok)).toBeUndefined();
    expect(cleanChatAttachment(null, ok)).toBeUndefined();
    for (const bad of [5, 'x', [], {}, { kind: 'gone', was: 'image' }, { kind: 'hidden' }, { kind: 'video', src: jpeg, w: 1, h: 1 }]) {
      expect(cleanChatAttachment(bad, ok)).toBeNull();
    }
  });

  it('картинка: только data URL jpeg/png/webp в base64 до предела, стороны - целые 1…4096', () => {
    expect(cleanChatAttachment({ kind: 'image', src: jpeg, w: 10, h: 20, extra: 1 }, { copy: false })).toEqual({ kind: 'image', src: jpeg, w: 10, h: 20 });
    expect(cleanChatAttachment({ kind: 'image', src: 'data:image/webp;base64,UklGR', w: 4096, h: 1 }, ok)).not.toBeNull();
    for (const src of ['data:image/svg+xml;base64,PHN2Zz4=', 'data:image/gif;base64,R0lGOD', 'data:image/png;base64,<b>', 'https://a.ru/x.png',
      `data:image/png;base64,${'A'.repeat(CHAT_IMAGE_MAX)}`, 5]) {
      expect(cleanChatAttachment({ kind: 'image', src, w: 1, h: 1 }, ok)).toBeNull();
    }
    for (const [w, h] of [[0, 1], [1, 4097], [1.5, 1], ['1', 1], [Number.NaN, 1]]) expect(cleanChatAttachment({ kind: 'image', src: jpeg, w, h }, ok)).toBeNull();
  });

  it('объекты доски: без права copy - отказ целиком; задание - отказ; by вырезается', () => {
    expect(cleanChatAttachment(board(), { copy: false })).toBeNull();
    expect(cleanChatAttachment(board({ elements: undefined }), { copy: false })).toBeNull();
    expect(cleanChatAttachment(board({ elements: [shape('a'), { id: 't', type: 'task', answer: '4' }] }), ok)).toBeNull();
    expect(cleanChatAttachment(board({ elements: [shape('a', { by: 'u:7' })], junk: 1 }), ok)).toEqual({
      kind: 'board', pageId: 'pg', pageName: 'Страница', ids: ['a'], count: 1, preview: png, w: 100, h: 50, elements: [shape('a')],
    });
  });

  it('объекты доски: строгие поля, длинное название обрезается, большие копии - только просмотр', () => {
    expect(cleanChatAttachment(board({ pageName: '😀'.repeat(CHAT_PAGE_NAME_MAX + 5) }), ok)).toMatchObject({ pageName: '😀'.repeat(CHAT_PAGE_NAME_MAX) });
    const big = cleanChatAttachment(board({ elements: [shape('a', { text: 'я'.repeat(CHAT_BOARD_JSON_MAX) })] }), ok);
    expect(big).toMatchObject({ kind: 'board', pageId: 'pg' });
    expect(big && 'elements' in big).toBe(false);
    for (const extra of [
      { pageId: '' }, { pageId: 'p'.repeat(129) }, { pageName: null }, { ids: ['a', 1] }, { ids: Array(CHAT_BOARD_IDS_MAX + 1).fill('a') },
      { count: 0 }, { count: CHAT_BOARD_IDS_MAX + 1 }, { count: 1.5 }, { preview: jpeg.replace('jpeg', 'svg+xml') },
      { preview: `data:image/png;base64,${'A'.repeat(CHAT_PREVIEW_MAX)}` }, { w: 0 }, { h: 4097 },
      { elements: null }, { elements: {} }, { elements: [null] }, { elements: [{ id: 'x' }] }, { elements: Array(CHAT_BOARD_IDS_MAX + 1).fill(shape('a')) },
    ]) expect(cleanChatAttachment(board(extra), ok), JSON.stringify(extra).slice(0, 60)).toBeNull();
  });

  const m = (id: string, att?: ChatAttachment): ChatMessage => ({ id, by: 1, name: 'А', text: '', ts: 1, ...(att ? { att } : {}) });

  it('бюджет буфера: у самых старых вложений - gone, без лишних копий списка', () => {
    const src = `data:image/jpeg;base64,${'A'.repeat(CHAT_IMAGE_MAX - 1000)}`;
    const img = (): ChatAttachment => ({ kind: 'image', src, w: 1, h: 1 });
    const fits = Array.from({ length: 15 }, (_, i) => m(`m${i}`, img()));
    expect(fits.reduce((n, x) => n + chatAttachmentSize(x.att), 0)).toBeLessThanOrEqual(CHAT_ATT_BUDGET);
    expect(trimChatAttachments(fits)).toBe(fits);
    const over = [m('text'), ...fits, m('new', img())];
    const out = trimChatAttachments(over);
    expect(out[0]).toBe(over[0]);
    expect(out[1]).toEqual({ ...over[1], att: { kind: 'gone', was: 'image' } });
    expect(out.slice(2)).toEqual(over.slice(2));
    expect(chatAttachmentSize({ kind: 'gone', was: 'image' })).toBe(0);
    expect(chatAttachmentSize({ kind: 'hidden' })).toBe(0);
  });

  it('снимок на получателя: объекты со скрытой страницы - hidden, остальное как есть', () => {
    const b = m('b', cleanChatAttachment(board(), ok)!);
    expect(chatMessageFor(b, id => id !== 'pg')).toEqual({ ...b, att: { kind: 'hidden' } });
    expect(chatMessageFor(b, () => true)).toBe(b);
    const i = m('i', { kind: 'image', src: jpeg, w: 1, h: 1 });
    expect(chatMessageFor(i, () => false)).toBe(i);
    const t = m('t');
    expect(chatMessageFor(t, () => false)).toBe(t);
  });
});

describe('ограничитель частоты', () => {
  it('не больше 5 за 3 секунды', () => {
    const ok = createRateLimiter();
    for (let i = 0; i < 5; i++) expect(ok(1000 + i)).toBe(true);
    expect(ok(1100)).toBe(false);
    expect(ok(3999)).toBe(false);
    expect(ok(4000)).toBe(true); // первое сообщение вышло из окна
  });
});

describe('ссылки в чате', () => {
  it('только https, хвостовая пунктуация - текст', () => {
    expect(tokenizeChat('смотри https://abax.app/x?y=1, ок')).toEqual([
      { kind: 'text', value: 'смотри ' },
      { kind: 'link', value: 'https://abax.app/x?y=1' },
      { kind: 'text', value: ', ок' },
    ]);
  });
  it('http, javascript: и голый https:// - не ссылки', () => {
    expect(tokenizeChat('http://a.b javascript:alert(1)')).toEqual([{ kind: 'text', value: 'http://a.b javascript:alert(1)' }]);
    expect(tokenizeChat('https:// пусто')).toEqual([{ kind: 'text', value: 'https:// пусто' }]);
  });
  it('разметка остаётся текстом, несколько ссылок', () => {
    expect(tokenizeChat('<b>https://a.ru</b> и https://b.ru.')).toEqual([
      { kind: 'text', value: '<b>' },
      { kind: 'link', value: 'https://a.ru' },
      { kind: 'text', value: '</b> и ' },
      { kind: 'link', value: 'https://b.ru' },
      { kind: 'text', value: '.' },
    ]);
  });
});
