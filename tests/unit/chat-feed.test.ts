import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  GROUP_GAP_MS, continuesGroup, createChatFeed, dayLabel, emojiCount, fullTime, isEmojiOnly, nameColor, type ChatFeed, type FeedItem,
} from '../../src/chat-feed';
import { attachmentLabel, objectsLabel, renderAttachment } from '../../src/chat-attach-view';
import type { ChatMessage } from '../../src/room-chat';
import type { Notice } from '../../src/notify-center';

const T0 = new Date(2026, 10, 19, 12, 0).getTime();
const MIN = 60_000;
const msg = (id: string, by: number, text: string, ts = T0, extra: Partial<ChatMessage> = {}): FeedItem =>
  ({ kind: 'msg', id, ts, m: { id, by, name: `У${by}`, text, ts, ...extra } });
const ev = (id: string, title: string, ts = T0, extra: Partial<Notice> = {}): FeedItem =>
  ({ kind: 'event', id, ts, n: { id, kind: 'system', level: 'info', title, ts, read: true, ...extra } });

describe('лента: чистые правила', () => {
  it('эмодзи-сообщение - 1–3 эмодзи без другого текста', () => {
    expect(isEmojiOnly('👍')).toBe(true);
    expect(isEmojiOnly(' 🙏🔥 ')).toBe(true);
    expect(isEmojiOnly('👨‍👩‍👧')).toBe(true); // склейка ZWJ — одно
    expect(emojiCount('👍🏽❤️🇷🇺')).toBe(3);
    expect(isEmojiOnly('😀😀😀😀')).toBe(false);
    expect(isEmojiOnly('ок 👍')).toBe(false);
    expect(isEmojiOnly('123')).toBe(false);
    expect(isEmojiOnly('')).toBe(false);
  });

  it('группа: тот же автор, не дальше 3 минут, тот же день', () => {
    const a = msg('a', 2, 'x', T0);
    expect(continuesGroup(a, msg('b', 2, 'y', T0 + GROUP_GAP_MS))).toBe(true);
    expect(continuesGroup(a, msg('b', 2, 'y', T0 + GROUP_GAP_MS + 1))).toBe(false);
    expect(continuesGroup(a, msg('b', 3, 'y', T0 + MIN))).toBe(false);
    expect(continuesGroup(ev('e', 'событие'), msg('b', 2, 'y'))).toBe(false);
    expect(continuesGroup(undefined, a)).toBe(false);
    const late = new Date(2026, 10, 19, 23, 59).getTime();
    expect(continuesGroup(msg('a', 2, 'x', late), msg('b', 2, 'y', late + 2 * MIN))).toBe(false);
  });

  it('разделители дней и полное время', () => {
    const now = new Date(2026, 10, 19, 15, 0).getTime();
    expect(dayLabel(new Date(2026, 10, 19, 0, 1).getTime(), now)).toBe('Сегодня');
    expect(dayLabel(new Date(2026, 10, 18, 23, 59).getTime(), now)).toBe('Вчера');
    expect(dayLabel(new Date(2026, 10, 17, 10, 0).getTime(), now)).toBe('17 ноября');
    expect(dayLabel(new Date(2025, 0, 3, 10, 0).getTime(), now)).toBe('3 января 2025');
    expect(fullTime(new Date(2026, 10, 19, 9, 5).getTime())).toBe('19 ноября 2026, 09:05');
  });

  it('цвет имени - плашка курсора; светлая плашка (янтарь) - цвет выделения', () => {
    expect(nameColor('mint')).toBe('#087f5b');
    expect(nameColor('amber')).toBe('#cc6a00');
    expect(nameColor('нет такого')).toBe('#2160dd');
    expect(nameColor(undefined)).toBe('#2160dd');
  });

  it('вложения: подписи и название страницы только текстом', () => {
    expect(renderAttachment({})).toBeNull();
    expect(attachmentLabel({ att: { kind: 'image', src: 'data:image/png;base64,AA==', w: 1, h: 1 } })).toBe('Изображение');
    expect(attachmentLabel({ att: { kind: 'board', pageId: 'p', pageName: '<b>Задачи</b>', ids: ['a'], count: 3, preview: 'data:image/png;base64,AA==', w: 1, h: 1 } }))
      .toBe('3 объекта · «<b>Задачи</b>»');
    expect(attachmentLabel({ att: { kind: 'gone', was: 'board' } })).toBe('Вложение больше недоступно');
    expect(attachmentLabel({ att: { kind: 'hidden' } })).toBe('Объекты со страницы, которая вам недоступна');
    expect([1, 2, 5, 11, 21, 22, 25, 112].map(objectsLabel)).toEqual(['1 объект', '2 объекта', '5 объектов', '11 объектов', '21 объект', '22 объекта', '25 объектов', '112 объектов']);
    const box = renderAttachment({ att: { kind: 'board', pageId: 'p', pageName: '<img src=x onerror=alert(1)>', ids: ['a'], count: 1, preview: 'data:image/png;base64,AA==', w: 1, h: 1 } })!;
    expect(box.querySelectorAll('img')).toHaveLength(1);
    expect(box.querySelector('img')!.className).toBe('cf-att-img');
    expect(box.querySelector('.cf-att-label')!.textContent).toBe('1 объект · «<img src=x onerror=alert(1)>»');
  });
});

describe('лента: разметка', () => {
  let items: FeedItem[] = [];
  let feed: ChatFeed;
  beforeEach(() => {
    document.body.className = 'no-motion no-ui-anim';
    items = [];
    feed = createChatFeed({ items: () => items, me: () => 1, label: 'Лента' });
    document.body.append(feed.el);
  });
  afterEach(() => {
    feed.el.remove();
    document.body.className = '';
  });

  const groups = () => [...feed.el.querySelectorAll<HTMLElement>('.cf-group')];

  it('группировка по автору и 3 минутам: аватар и имя - у первого сообщения группы, свои - без аватара', () => {
    items = [
      msg('1', 2, 'раз', T0, { cursorId: 'mint' }),
      msg('2', 2, 'два', T0 + MIN),
      msg('3', 2, 'через 4 минуты', T0 + 5 * MIN),
      msg('4', 1, 'моё', T0 + 6 * MIN),
      msg('5', 1, 'и ещё', T0 + 6 * MIN),
    ];
    feed.render();
    const g = groups();
    expect(g).toHaveLength(3);
    expect(g[0].querySelectorAll('.cf-msg')).toHaveLength(2);
    expect(g[0].querySelector('.cf-avatar')).not.toBeNull();
    expect(g[0].querySelector('.cf-name')!.textContent).toBe('У2');
    expect(g[0].querySelector<HTMLElement>('.cf-name')!.style.color).toBe('rgb(8, 127, 91)');
    expect(g[0].querySelector('.cf-time')!.textContent).toBe('12:00');
    expect(g[1].querySelectorAll('.cf-msg')).toHaveLength(1);
    expect(g[2].classList.contains('cf-mine')).toBe(true);
    expect(g[2].querySelector('.cf-avatar')).toBeNull();
    expect(g[2].querySelector('.cf-name')).toBeNull();
    expect(g[2].querySelectorAll('.cf-msg')).toHaveLength(2);
    // полное время — в подсказке
    expect(g[0].querySelector<HTMLElement>('.cf-msg')!.title).toBe('19 ноября 2026, 12:00');
  });

  it('событие разрывает группу; системная строка: текст, время, warn', () => {
    items = [msg('1', 2, 'раз'), ev('e', 'Связь потеряна', T0 + 10, { level: 'warn', icon: 'offline' }), msg('2', 2, 'два', T0 + 20)];
    feed.render();
    expect(groups()).toHaveLength(2);
    const row = feed.el.querySelector<HTMLElement>('.cf-event')!;
    expect(row.classList.contains('cf-warn')).toBe(true);
    expect(row.querySelector('.cf-ev-text')!.textContent).toBe('Связь потеряна');
    expect(row.querySelector('.cf-ev-time')!.textContent).toBe('12:00');
    expect(row.querySelector('.cf-ev-icon svg')).not.toBeNull();
  });

  it('событие участника - мини-аватар; имя с разметкой - текст', () => {
    items = [ev('e', '<b>Лемур</b>', T0, { body: 'присоединился к доске', user: { name: '<b>Лемур</b>', cursorId: 'mint' } })];
    feed.render();
    const row = feed.el.querySelector<HTMLElement>('.cf-event')!;
    expect(row.querySelector('.cf-ev-avatar')).not.toBeNull();
    expect(row.querySelector('b')).toBeNull();
    expect(row.querySelector('.cf-ev-text')!.textContent).toBe('<b>Лемур</b> присоединился к доске');
  });

  it('эмодзи-сообщение - крупно, без пузыря', () => {
    items = [msg('1', 2, '🙏🔥'), msg('2', 2, 'ок 👍', T0 + 1)];
    feed.render();
    const rows = feed.el.querySelectorAll('.cf-msg');
    expect(rows[0].classList.contains('cf-emoji-msg')).toBe(true);
    expect(rows[0].querySelector('.cf-bubble')).toBeNull();
    expect(rows[0].querySelector('.cf-emoji')!.textContent).toBe('🙏🔥');
    expect(rows[1].querySelector('.cf-bubble')).not.toBeNull();
  });

  it('ссылки - только https, с target и rel; разметка в тексте - текстом', () => {
    items = [msg('1', 2, '<img src=x onerror="alert(1)"> https://abax.app/a javascript:alert(1) http://x.ru')];
    feed.render();
    const bubble = feed.el.querySelector('.cf-bubble')!;
    expect(bubble.querySelector('img')).toBeNull();
    const links = bubble.querySelectorAll('a');
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute('href')).toBe('https://abax.app/a');
    expect(links[0].target).toBe('_blank');
    expect(links[0].rel).toBe('noopener noreferrer');
    expect(links[0].textContent).toBe('https://abax.app/a');
    expect(bubble.textContent).toBe('<img src=x onerror="alert(1)"> https://abax.app/a javascript:alert(1) http://x.ru');
  });

  it('имя участника с разметкой - текст', () => {
    items = [msg('1', 2, 'x', T0, { name: '<b onclick="x">Лемур</b>' })];
    feed.render();
    expect(feed.el.querySelector('.cf-name b')).toBeNull();
    expect(feed.el.querySelector('.cf-name')!.textContent).toBe('<b onclick="x">Лемур</b>');
  });

  it('разделители дней', () => {
    const now = Date.now();
    const d = new Date(now);
    const today = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 30).getTime();
    items = [msg('1', 2, 'давно', today - 3 * 86400_000), msg('2', 2, 'вчера', today - 86400_000), msg('3', 2, 'сегодня', today)];
    feed.render();
    const days = [...feed.el.querySelectorAll('.cf-day')].map(x => x.textContent);
    expect(days.slice(1)).toEqual(['Вчера', 'Сегодня']);
    expect(days[0]).toMatch(/^\d+ [а-я]+( \d{4})?$/);
    expect(groups()).toHaveLength(3);
  });

  it('линия «Новые» - над первым непрочитанным и разрывает группу', () => {
    items = [msg('1', 2, 'раз'), msg('2', 2, 'два', T0 + 10), msg('3', 2, 'три', T0 + 20)];
    feed.render('2');
    const list = feed.el.querySelector('.cf-list')!;
    const line = list.querySelector('.cf-new')!;
    expect(line.textContent).toBe('Новые');
    expect(line.nextElementSibling!.querySelector('.cf-msg')!.getAttribute('data-id')).toBe('2');
    expect(groups()).toHaveLength(2);
    feed.render(null);
    expect(list.querySelector('.cf-new')).toBeNull();
  });

  it('новое сообщение дописывается без перерисовки; продолжает группу', () => {
    items = [msg('1', 2, 'раз')];
    feed.render();
    const first = feed.el.querySelector('.cf-group');
    items = [...items, msg('2', 2, 'два', T0 + MIN)];
    feed.refresh();
    expect(feed.el.querySelector('.cf-group')).toBe(first);
    expect(first!.querySelectorAll('.cf-msg')).toHaveLength(2);
    items = [...items, msg('3', 3, 'другой', T0 + 2 * MIN)];
    feed.refresh();
    expect(groups()).toHaveLength(2);
  });

  it('«Обычные»: новое сообщение появляется CSS-анимацией', () => {
    document.body.className = 'no-motion';
    items = [msg('1', 2, 'раз')];
    feed.render();
    items = [...items, msg('2', 3, 'два', T0 + 1)];
    feed.refresh();
    expect(groups()[1].classList.contains('cf-in')).toBe(true);
  });

  it('пользователь не внизу - кнопка «↓ Новые сообщения»; щелчок - вниз', () => {
    items = [msg('1', 2, 'раз')];
    feed.render();
    const scroller = feed.el.querySelector<HTMLElement>('.cf-scroll')!;
    Object.defineProperty(scroller, 'scrollHeight', { configurable: true, value: 1000 });
    Object.defineProperty(scroller, 'clientHeight', { configurable: true, value: 300 });
    scroller.scrollTop = 100;
    items = [...items, msg('2', 2, 'два', T0 + 1)];
    feed.refresh();
    expect(feed.jumpShown).toBe(true);
    const jump = feed.el.querySelector<HTMLButtonElement>('.cf-jump')!;
    expect(jump.textContent).toBe('↓ Новые сообщения');
    jump.click();
    expect(feed.jumpShown).toBe(false);
    expect(scroller.scrollTop).toBe(1000);
    // своё сообщение — всегда вниз, без кнопки
    scroller.scrollTop = 100;
    items = [...items, msg('3', 1, 'моё', T0 + 2)];
    feed.refresh();
    expect(feed.jumpShown).toBe(false);
  });

  it('пустая лента - пустое состояние', () => {
    const empty = document.createElement('div');
    empty.textContent = 'пусто';
    feed.setEmpty(empty);
    feed.render();
    expect(feed.el.querySelector<HTMLElement>('.cf-empty')!.hidden).toBe(false);
    expect(feed.el.querySelector<HTMLElement>('.cf-scroll')!.hidden).toBe(true);
    items = [msg('1', 2, 'раз')];
    feed.refresh();
    expect(feed.el.querySelector<HTMLElement>('.cf-empty')!.hidden).toBe(true);
  });

  it('reveal - подсветка сообщения; неизвестное - false', () => {
    items = [msg('1', 2, 'раз'), msg('2', 2, 'два', T0 + 1)];
    feed.render();
    expect(feed.reveal('2')).toBe(true);
    expect(feed.el.querySelector('[data-id="2"]')!.classList.contains('cf-flash')).toBe(true);
    expect(feed.reveal('нет')).toBe(false);
  });

  it('сообщение с вложением - плашка, текст под ней', () => {
    items = [msg('1', 2, 'смотрите', T0, { att: { kind: 'gone', was: 'image' } })];
    feed.render();
    const row = feed.el.querySelector('.cf-msg')!;
    expect(row.querySelector('.cf-att-gone')!.textContent).toBe('Вложение больше недоступно');
    expect(row.querySelector('.cf-bubble')!.textContent).toBe('смотрите');
  });
});
