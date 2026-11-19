import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DND_KEY, NOTICE_LIMIT, clearNotices, doNotDisturb, formatUnread, markNoticeRead, markRead, noticeById, noticeText,
  noticeTimeLabel, notices, onNotices, pushNotice, setDoNotDisturb, unreadCount, type NoticeEvent,
} from '../../src/notify-center';

describe('центр уведомлений', () => {
  afterEach(() => {
    clearNotices();
    setDoNotDisturb(false);
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('новое уведомление: значения по умолчанию, свой id и время', () => {
    const a = pushNotice({ title: 'Капибара', body: 'присоединился к доске' });
    const b = pushNotice({ kind: 'chat', level: 'warn', title: 'Лемур', ts: 123 });
    expect(a).toMatchObject({ kind: 'system', level: 'info', read: false, title: 'Капибара' });
    expect(typeof a.ts).toBe('number');
    expect(b).toMatchObject({ kind: 'chat', level: 'warn', ts: 123 });
    expect(a.id).not.toBe(b.id);
    expect(notices()).toEqual([a, b]);
    expect(noticeById(b.id)).toBe(b);
  });

  it('непрочитанные: всего и по виду; тихие не считаются', () => {
    pushNotice({ title: 'событие' });
    pushNotice({ kind: 'chat', title: 'Лемур', body: 'привет' });
    const quiet = pushNotice({ title: 'Вы позвали всех на эту страницу', quiet: true });
    expect(quiet.read).toBe(true);
    expect(unreadCount()).toBe(2);
    expect(unreadCount('chat')).toBe(1);
    expect(unreadCount('system')).toBe(1);
  });

  it('прочитать: всё, один вид, одно уведомление — с событием только при изменении', () => {
    const events: NoticeEvent[] = [];
    const off = onNotices(ev => events.push(ev));
    const s1 = pushNotice({ title: 'а' });
    const s2 = pushNotice({ title: 'б' });
    const c1 = pushNotice({ kind: 'chat', title: 'в' });
    markRead('chat');
    expect(unreadCount()).toBe(2);
    expect(events.at(-1)).toEqual({ type: 'read', ids: [c1.id] });
    expect(markNoticeRead(s1.id)).toBe(true);
    expect(markNoticeRead(s1.id)).toBe(false);
    expect(markNoticeRead('нет-такого')).toBe(false);
    const before = events.length;
    markRead('chat'); // нечего читать — без события
    expect(events.length).toBe(before);
    markRead();
    expect(events.at(-1)).toEqual({ type: 'read', ids: [s2.id] });
    expect(unreadCount()).toBe(0);
    off();
    pushNotice({ title: 'после отписки' });
    expect(events.filter(e => e.type === 'push')).toHaveLength(3);
  });

  it('очистить: всё или один вид', () => {
    pushNotice({ title: 'а' });
    const c = pushNotice({ kind: 'chat', title: 'б' });
    const events: NoticeEvent[] = [];
    const off = onNotices(ev => events.push(ev));
    clearNotices('chat');
    expect(events).toEqual([{ type: 'clear', ids: [c.id] }]);
    expect(notices().map(n => n.title)).toEqual(['а']);
    clearNotices();
    expect(notices()).toHaveLength(0);
    clearNotices(); // пусто — без события
    expect(events).toHaveLength(2);
    off();
  });

  it('лимит: старые вытесняются, подписчик узнаёт, какие', () => {
    let dropped = 0;
    const off = onNotices(ev => { if (ev.type === 'push') dropped += ev.dropped.length; });
    for (let i = 0; i < NOTICE_LIMIT + 5; i++) pushNotice({ title: `№${i}` });
    expect(notices()).toHaveLength(NOTICE_LIMIT);
    expect(notices()[0].title).toBe('№5');
    expect(dropped).toBe(5);
    expect(unreadCount()).toBe(NOTICE_LIMIT);
    off();
  });

  it('ошибка подписчика не мешает остальным и тому, кто сообщил', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const got: string[] = [];
    const off1 = onNotices(() => { throw new Error('сломался'); });
    const off2 = onNotices(ev => { if (ev.type === 'push') got.push(ev.notice.title); });
    expect(() => pushNotice({ title: 'дошло' })).not.toThrow();
    expect(got).toEqual(['дошло']);
    off1();
    off2();
  });

  it('«не беспокоить» хранится в localStorage', () => {
    const events: NoticeEvent[] = [];
    const off = onNotices(ev => events.push(ev));
    expect(doNotDisturb()).toBe(false);
    setDoNotDisturb(true);
    expect(doNotDisturb()).toBe(true);
    expect(localStorage.getItem(DND_KEY)).toBe('1');
    setDoNotDisturb(true); // без изменений — без события
    setDoNotDisturb(false);
    expect(localStorage.getItem(DND_KEY)).toBeNull();
    expect(events).toEqual([{ type: 'dnd', on: true }, { type: 'dnd', on: false }]);
    // сохранённое прежде включение читается
    localStorage.setItem(DND_KEY, '1');
    expect(doNotDisturb()).toBe(true);
    off();
  });

  it('«не беспокоить» без доступа к localStorage — в памяти', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('запрещено'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('запрещено'); });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('запрещено'); });
    expect(doNotDisturb()).toBe(false);
    setDoNotDisturb(true);
    expect(doNotDisturb()).toBe(true);
    setDoNotDisturb(false);
    expect(doNotDisturb()).toBe(false);
  });
});

describe('подписи уведомлений', () => {
  it('счётчик: пусто, число, 99+', () => {
    expect(formatUnread(0)).toBe('');
    expect(formatUnread(-3)).toBe('');
    expect(formatUnread(1)).toBe('1');
    expect(formatUnread(99)).toBe('99');
    expect(formatUnread(100)).toBe('99+');
  });

  it('одной строкой: чат, событие участника, системное', () => {
    expect(noticeText({ kind: 'chat', title: 'Лемур', body: 'привет' })).toBe('Лемур: привет');
    expect(noticeText({ kind: 'system', title: 'Капибара', body: 'присоединился к доске', user: { name: 'Капибара' } })).toBe('Капибара присоединился к доске');
    expect(noticeText({ kind: 'system', title: 'Связь с доской восстановлена' })).toBe('Связь с доской восстановлена');
    expect(noticeText({ kind: 'system', title: 'Нет связи', body: 'Проверьте интернет' })).toBe('Нет связи. Проверьте интернет');
    expect(noticeText({ kind: 'system', title: 'Готово!', body: 'Можно продолжать' })).toBe('Готово! Можно продолжать');
  });

  it('время: «сейчас», минуты, часы сегодня, дата раньше', () => {
    const now = new Date(2026, 10, 19, 14, 30).getTime();
    expect(noticeTimeLabel(now - 20_000, now)).toBe('сейчас');
    expect(noticeTimeLabel(now + 5_000, now)).toBe('сейчас'); // часы хаба чуть впереди
    expect(noticeTimeLabel(now - 2 * 60_000, now)).toBe('2 мин');
    expect(noticeTimeLabel(new Date(2026, 10, 19, 9, 5).getTime(), now)).toBe('09:05');
    expect(noticeTimeLabel(new Date(2026, 10, 18, 23, 50).getTime(), now)).toBe('18 ноя');
  });
});
