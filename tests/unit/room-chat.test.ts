import { describe, expect, it } from 'vitest';
import { CHAT_MAX_LEN, createRateLimiter, normalizeChatText, tokenizeChat } from '../../src/room-chat';

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
  it('только https, хвостовая пунктуация — текст', () => {
    expect(tokenizeChat('смотри https://abax.app/x?y=1, ок')).toEqual([
      { kind: 'text', value: 'смотри ' },
      { kind: 'link', value: 'https://abax.app/x?y=1' },
      { kind: 'text', value: ', ок' },
    ]);
  });
  it('http, javascript: и голый https:// — не ссылки', () => {
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
