import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CHAT_PANEL_EVENT, CHAT_PREVIEW_LEN, chatAvailable, chatCanWrite, chatMessages, chatMyId, chatOpen, chatPreviewBody, chatPreviewText,
  chatReceive, chatReset, chatUnread, formatUnread, onChat, openChat, sendChatMessage, setChatAvailable, setChatAvatarLookup,
  setChatCanWrite, setChatOpenHandler, setChatSender, setChatVisible, type ChatEvent,
} from '../../src/collab-chat';
import { clearNotices, notices, noticeText, unreadCount } from '../../src/notify-center';

const msg = (id: string, by: number, text: string, extra: Record<string, unknown> = {}) => ({ id, by, name: `У${by}`, text, ts: Date.UTC(2026, 10, 17, 12, 5), ...extra });
const chatNotices = () => notices().filter(n => n.kind === 'chat');

describe('чат комнаты: слой данных', () => {
  beforeEach(() => {
    document.body.textContent = '';
    setChatAvailable(true);
  });
  afterEach(() => {
    setChatVisible(false);
    setChatAvailable(false);
    setChatCanWrite(true);
    setChatSender(null);
    setChatAvatarLookup(null);
    setChatOpenHandler(null);
    clearNotices();
  });

  it('старой панели #chat-panel больше нет', () => {
    chatReset([msg('1', 2, 'привет')], 1);
    openChat();
    expect(document.getElementById('chat-panel')).toBeNull();
  });

  it('чат доступен только при совместной работе', () => {
    expect(chatAvailable()).toBe(true);
    setChatAvailable(false);
    expect(chatAvailable()).toBe(false);
  });

  it('история из init: проверка формы, непрочитанных нет, мой id запомнен', () => {
    chatReset([
      msg('1', 2, 'привет'), { bad: true }, msg('2', 1, 'и тебе'),
      msg('3', 2, '<script>'.repeat(100)), // длиннее 500 символов
      msg('4', 2, '', { att: { kind: 'gone', was: 'image' } }), // только вложение — можно
      msg('5', 2, ''), // пусто без вложения — нельзя
      msg('6', 2, 'x', { att: { kind: 'evil' } }),
      msg('7', 2, 'x', { att: 'строка' }),
      msg('8', 2, 'x', { cursorId: 5 }),
    ], 1);
    expect(chatMessages().map(m => m.id)).toEqual(['1', '2', '4']);
    expect(chatUnread()).toBe(0);
    expect(chatMyId()).toBe(1);
  });

  it('onChat: сброс, новое сообщение, состояние; отписка', () => {
    const got: ChatEvent['type'][] = [];
    const off = onChat(ev => got.push(ev.type));
    chatReset([], 1);
    chatReceive(msg('a', 2, 'привет'));
    chatReceive(msg('a', 2, 'привет')); // повтор — без события
    chatReceive({ id: 'b' }); // неверная форма — без события
    setChatCanWrite(false);
    setChatAvailable(false);
    off();
    chatReceive(msg('c', 2, 'после отписки'));
    expect(got).toEqual(['reset', 'message', 'state', 'state']);
  });

  it('чат не виден: чужое сообщение - уведомление чата, своё - нет', () => {
    setChatAvatarLookup(uid => (uid === 2 ? '🦊' : null));
    chatReset([], 1);
    chatReceive(msg('a', 1, 'моё'));
    expect(chatUnread()).toBe(0);
    chatReceive(msg('b', 2, 'привет   всем', { cursorId: 'mint' }));
    expect(chatUnread()).toBe(1);
    expect(unreadCount()).toBe(1);
    const n = chatNotices()[0];
    expect(n).toMatchObject({ kind: 'chat', title: 'У2', body: 'привет всем', chatId: 'b', read: false, user: { userId: 2, name: 'У2', cursorId: 'mint', avatar: '🦊' } });
    expect(noticeText(n)).toBe('У2: привет всем');
    chatReceive(msg('b', 2, 'привет всем'));
    expect(chatUnread()).toBe(1);
  });

  it('сообщение только с вложением - в уведомлении подпись вложения', () => {
    chatReset([], 1);
    chatReceive(msg('i', 2, '', { att: { kind: 'image', src: 'data:image/png;base64,AA==', w: 1, h: 1 } }));
    expect(chatNotices()[0].body).toBe('Изображение');
  });

  it('чат виден (вид показывает «Все» или «Чат»): сообщение сразу прочитано, без уведомления', () => {
    chatReset([], 1);
    chatReceive(msg('a', 2, 'до показа'));
    expect(chatUnread()).toBe(1);
    setChatVisible(true);
    expect(chatOpen()).toBe(true);
    expect(chatUnread()).toBe(0);
    chatReceive(msg('b', 2, 'при показе'));
    expect(chatNotices().filter(n => !n.read)).toHaveLength(0);
    expect(chatMessages()).toHaveLength(2);
  });

  it('видимость сообщается событием на document (кнопка ЧУ до интеграции панели)', () => {
    const got: boolean[] = [];
    const on = (e: Event) => got.push((e as CustomEvent<{ open: boolean }>).detail.open);
    document.addEventListener(CHAT_PANEL_EVENT, on);
    setChatVisible(true);
    setChatVisible(true); // без изменений — без события
    setChatVisible(false);
    document.removeEventListener(CHAT_PANEL_EVENT, on);
    expect(got).toEqual([true, false]);
  });

  it('openChat вызывает обработчик интегратора с вкладкой «chat»; без обработчика или без чата - ничего', () => {
    const fn = vi.fn();
    openChat(); // обработчика нет
    setChatOpenHandler(fn);
    openChat();
    expect(fn).toHaveBeenCalledWith('chat');
    setChatAvailable(false);
    openChat();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('щелчок по уведомлению о сообщении - openChat', () => {
    const fn = vi.fn();
    setChatOpenHandler(fn);
    chatReset([], 1);
    chatReceive(msg('b', 2, 'привет'));
    chatNotices()[0].onClick!();
    expect(fn).toHaveBeenCalledWith('chat');
  });

  it('много непрочитанных: счётчик 99+, лента - последние 100', () => {
    chatReset([], 1);
    for (let i = 0; i < 120; i++) chatReceive(msg(`m${i}`, 2, 'x'));
    expect(chatUnread()).toBe(120);
    expect(formatUnread(chatUnread())).toBe('99+');
    expect(chatMessages()).toHaveLength(100);
    expect(formatUnread(0)).toBe('');
    expect(formatUnread(99)).toBe('99');
  });

  it('отправка: пусто, флуд (6-е за 3 с), нет соединения, читатель', () => {
    const sent: string[] = [];
    setChatSender(t => { sent.push(t); return true; });
    expect(sendChatMessage('   ')).toBe('empty');
    expect(sendChatMessage('я'.repeat(501))).toBe('empty');
    for (let i = 0; i < 5; i++) expect(sendChatMessage(` m${i} `)).toBe('ok');
    expect(sendChatMessage('m5')).toBe('rate');
    expect(sent).toEqual(['m0', 'm1', 'm2', 'm3', 'm4']);
    setChatAvailable(false);
    setChatAvailable(true); // ограничитель сброшен вместе с чатом
    setChatSender(() => false);
    expect(sendChatMessage('привет')).toBe('offline');
    setChatSender(null);
    expect(sendChatMessage('привет')).toBe('offline');
    setChatSender(() => true);
    setChatCanWrite(false);
    expect(chatCanWrite()).toBe(false);
    expect(sendChatMessage('привет')).toBe('readonly');
  });

  it('выключение чата сбрасывает ленту и непрочитанные', () => {
    chatReset([msg('1', 2, 'x')], 1);
    chatReceive(msg('2', 2, 'y'));
    expect(chatNotices()).toHaveLength(1);
    setChatAvailable(false);
    expect(chatMessages()).toHaveLength(0);
    expect(chatUnread()).toBe(0);
    expect(chatNotices()).toHaveLength(0);
  });

  it('превью обрезается до 80 символов', () => {
    const long = 'а'.repeat(CHAT_PREVIEW_LEN + 10);
    expect(chatPreviewText({ name: 'Лемур', text: long })).toBe(`Лемур: ${'а'.repeat(CHAT_PREVIEW_LEN)}…`);
    expect(chatPreviewText({ name: '', text: 'раз\nдва' })).toBe('Участник: раз два');
    expect(chatPreviewBody(`  ${long}  `)).toBe(`${'а'.repeat(CHAT_PREVIEW_LEN)}…`);
  });
});
