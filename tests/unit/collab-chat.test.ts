import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CHAT_PREVIEW_LEN, chatMessages, chatOpen, chatPreviewText, chatReceive, chatReset, chatUnread, closeChat, formatUnread,
  openChat, setChatAvailable, setChatSender,
} from '../../src/collab-chat';
import { clearPills } from '../../src/activity-pills';

const msg = (id: string, by: number, text: string, extra: Record<string, unknown> = {}) => ({ id, by, name: `У${by}`, text, ts: Date.UTC(2026, 10, 17, 12, 5), ...extra });
const panel = () => document.getElementById('chat-panel')!;
const input = () => panel().querySelector('.chat-input') as HTMLTextAreaElement;
const badge = () => document.querySelector('#btn-chat .chat-badge') as HTMLElement;
const key = (k: string, shift = false) => input().dispatchEvent(new KeyboardEvent('keydown', { key: k, shiftKey: shift, bubbles: true, cancelable: true }));

describe('чат комнаты', () => {
  beforeEach(() => {
    document.body.textContent = '';
    document.body.className = 'no-motion';
    const btn = document.createElement('button');
    btn.id = 'btn-chat';
    btn.hidden = true;
    document.body.appendChild(btn);
    setChatAvailable(true);
  });
  afterEach(() => {
    setChatAvailable(false);
    setChatSender(null);
    clearPills();
  });

  it('кнопка видна только при совместной работе', () => {
    const btn = document.getElementById('btn-chat') as HTMLButtonElement;
    expect(btn.hidden).toBe(false);
    setChatAvailable(false);
    expect(btn.hidden).toBe(true);
  });

  it('история из init — в ленте, непрочитанных нет', () => {
    chatReset([msg('1', 2, 'привет'), { bad: true }, msg('2', 1, 'и тебе')], 1);
    expect(chatMessages()).toHaveLength(2);
    expect(chatUnread()).toBe(0);
    openChat();
    const rows = panel().querySelectorAll('.chat-msg');
    expect(rows).toHaveLength(2);
    expect(rows[1].classList.contains('mine')).toBe(true);
    expect(rows[0].querySelector('.chat-name')!.textContent).toBe('У2');
    expect(rows[0].querySelector('.chat-time')!.textContent).toMatch(/^\d\d:\d\d$/);
    expect(panel().querySelector('.chat-empty')!.hasAttribute('hidden')).toBe(true);
  });

  it('ссылки — с target и rel, разметка — текстом', () => {
    chatReset([msg('1', 2, '<img src=x onerror="alert(1)"> https://abax.app/a')], 1);
    openChat();
    const text = panel().querySelector('.chat-text')!;
    expect(text.querySelector('img')).toBeNull();
    const a = text.querySelector('a')!;
    expect(a.getAttribute('href')).toBe('https://abax.app/a');
    expect(a.target).toBe('_blank');
    expect(a.rel).toBe('noopener noreferrer');
    expect(text.textContent).toBe('<img src=x onerror="alert(1)"> https://abax.app/a');
  });

  it('имя участника с разметкой — текст', () => {
    chatReset([msg('1', 2, 'x', { name: '<b onclick="x">Лемур</b>' })], 1);
    openChat();
    expect(panel().querySelector('.chat-name b')).toBeNull();
    expect(panel().querySelector('.chat-name')!.textContent).toBe('<b onclick="x">Лемур</b>');
  });

  it('закрытая панель: чужое сообщение — бейдж и превью, своё — нет', () => {
    chatReset([], 1);
    chatReceive(msg('a', 1, 'моё'));
    expect(chatUnread()).toBe(0);
    chatReceive(msg('b', 2, 'привет всем'));
    expect(chatUnread()).toBe(1);
    expect(badge().textContent).toBe('1');
    expect(badge().hidden).toBe(false);
    const pill = document.querySelector('.activity-pill.clickable') as HTMLElement;
    expect(pill.querySelector('.ap-text')!.textContent).toBe('У2: привет всем');
    // повтор того же id не считается
    chatReceive(msg('b', 2, 'привет всем'));
    expect(chatUnread()).toBe(1);
    pill.click();
    expect(chatOpen()).toBe(true);
    expect(chatUnread()).toBe(0);
    expect(badge().hidden).toBe(true);
  });

  it('бейдж 99+', () => {
    chatReset([], 1);
    for (let i = 0; i < 120; i++) chatReceive(msg(`m${i}`, 2, 'x'));
    expect(chatUnread()).toBe(120);
    expect(badge().textContent).toBe('99+');
    expect(chatMessages()).toHaveLength(100);
    expect(formatUnread(0)).toBe('');
    expect(formatUnread(99)).toBe('99');
    expect(formatUnread(100)).toBe('99+');
  });

  it('открытая панель: сообщение сразу в ленте, без бейджа', () => {
    chatReset([], 1);
    openChat();
    chatReceive(msg('b', 2, 'привет'));
    expect(chatUnread()).toBe(0);
    expect(panel().querySelectorAll('.chat-msg')).toHaveLength(1);
    expect(document.querySelector('.activity-pill')).toBeNull();
  });

  it('Enter отправляет, Shift+Enter — нет; пустое не уходит', () => {
    const sent: string[] = [];
    setChatSender(t => { sent.push(t); return true; });
    chatReset([], 1);
    openChat();
    input().value = '   ';
    key('Enter');
    expect(sent).toEqual([]);
    input().value = 'строка';
    key('Enter', true);
    expect(sent).toEqual([]);
    key('Enter');
    expect(sent).toEqual(['строка']);
    expect(input().value).toBe('');
  });

  it('флуд: шестое сообщение за 3 с — подсказка', () => {
    const sent: string[] = [];
    setChatSender(t => { sent.push(t); return true; });
    chatReset([], 1);
    openChat();
    for (let i = 0; i < 6; i++) { input().value = `m${i}`; key('Enter'); }
    expect(sent).toHaveLength(5);
    expect(panel().querySelector('.chat-hint')!.textContent).toMatch(/Не так быстро/);
    expect(input().value).toBe('m5');
  });

  it('нет соединения — подсказка, текст остаётся', () => {
    setChatSender(() => false);
    chatReset([], 1);
    openChat();
    input().value = 'привет';
    key('Enter');
    expect(panel().querySelector('.chat-hint')!.textContent).toBe('Нет соединения с доской');
    expect(input().value).toBe('привет');
  });

  it('счётчик символов после 400, maxlength 500', () => {
    chatReset([], 1);
    openChat();
    expect(input().maxLength).toBe(500);
    input().value = 'я'.repeat(401);
    input().dispatchEvent(new Event('input'));
    expect(panel().querySelector('.chat-count')!.textContent).toBe('401/500');
  });

  it('Esc закрывает панель', () => {
    chatReset([], 1);
    openChat();
    key('Escape');
    expect(chatOpen()).toBe(false);
    expect(panel().hidden).toBe(true);
    closeChat();
  });

  it('выключение чата сбрасывает ленту', () => {
    chatReset([msg('1', 2, 'x')], 1);
    chatReceive(msg('2', 2, 'y'));
    setChatAvailable(false);
    expect(chatMessages()).toHaveLength(0);
    expect(chatUnread()).toBe(0);
    openChat(); // недоступен — не открывается
    expect(chatOpen()).toBe(false);
  });

  it('превью обрезается до 80 символов', () => {
    const long = 'а'.repeat(CHAT_PREVIEW_LEN + 10);
    expect(chatPreviewText({ name: 'Лемур', text: long })).toBe(`Лемур: ${'а'.repeat(CHAT_PREVIEW_LEN)}…`);
    expect(chatPreviewText({ name: '', text: 'раз\nдва' })).toBe('Участник: раз два');
  });
});
