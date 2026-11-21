import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { diffUsers, pillToNotice, showPill, showUserEvents, userEventNotice, userEventText } from '../../src/activity-pills';
import { clearNotices, noticeText, notices, unreadCount } from '../../src/notify-center';
import { clearNotifyStack, initNotifyStack, stackCount } from '../../src/notify-stack';

// Пилюли комнаты теперь — уведомления центра в стопке (tests/unit/notify-stack.test.ts): здесь — обёртка
// совместимости showPill и события состава комнаты.
describe('обёртка пилюль', () => {
  beforeEach(() => {
    document.body.className = 'no-motion no-ui-anim';
    document.body.textContent = '';
    initNotifyStack();
  });
  afterEach(() => {
    clearNotifyStack();
    clearNotices();
    document.body.className = '';
  });

  it('showPill - уведомление центра (kind → level, text → title, cursorId → user)', () => {
    showPill({ kind: 'warn', text: 'Соединение прервано', icon: 'offline' });
    showPill({ text: 'Вы позвали всех', quiet: true });
    expect(notices().map(n => [n.level, n.title, n.icon, n.read])).toEqual([['warn', 'Соединение прервано', 'offline', false], ['info', 'Вы позвали всех', undefined, true]]);
    expect(unreadCount()).toBe(1);
    expect(pillToNotice({ text: 'x', cursorId: 'mint' }).user).toEqual({ name: '', cursorId: 'mint' });
  });

  it('showPill возвращает функцию, убирающую уведомление из стопки (не читая его)', () => {
    const hide = showPill({ text: 'раз' });
    expect(stackCount()).toBe(1);
    hide();
    expect(stackCount()).toBe(0);
    expect(unreadCount()).toBe(1);
  });

  it('события состава - уведомления одной фразой', () => {
    showUserEvents([{ kind: 'join', user: { userId: 2, name: 'Капибара', cursorId: 'mint' } }]);
    expect(notices().map(noticeText)).toEqual(['Капибара присоединился к доске']);
  });

  it('события состава - структурные: имя, что случилось, значок, участник с аватаром', () => {
    const user = { userId: 2, name: 'Капибара', cursorId: 'mint', avatar: 'photo:3' };
    const photo = 'data:image/png;base64,AAAA';
    expect(userEventNotice({ kind: 'join', user }, () => photo)).toEqual({
      title: 'Капибара', body: 'присоединился к доске', icon: 'join', level: 'ok',
      user: { userId: 2, name: 'Капибара', cursorId: 'mint', avatar: photo },
    });
    expect(userEventNotice({ kind: 'leave', user: { userId: 3, name: '' } })).toMatchObject({ title: 'Участник', body: 'покинул доску', icon: 'leave', user: { cursorId: 'default', avatar: null } });
    expect(userEventNotice({ kind: 'rename', user, from: 'Лемур' })).toMatchObject({ title: 'Лемур', body: 'теперь Капибара', icon: 'rename' });
    expect(userEventNotice({ kind: 'cursor', user })).toMatchObject({ body: 'сменил курсор', icon: 'cursor' });
    expect(userEventNotice({ kind: 'avatar', user })).toMatchObject({ body: 'сменил аватар', icon: 'avatar' });
  });
});

describe('изменения состава комнаты', () => {
  const a = { userId: 1, name: 'Я' };
  const b = { userId: 2, name: 'Капибара', cursorId: 'default' };
  const c = { userId: 3, name: 'Лемур' };

  it('вход, выход, смена имени и курсора; себя не считаем', () => {
    expect(diffUsers([a, b], [a, b, c], 1)).toEqual([{ kind: 'join', user: c }]);
    expect(diffUsers([a, b, c], [a, c], 1)).toEqual([{ kind: 'leave', user: b }]);
    const renamed = { ...c, name: 'Бодрый Енот' };
    expect(diffUsers([a, c], [a, renamed], 1)).toEqual([{ kind: 'rename', user: renamed, from: 'Лемур' }]);
    const recursored = { ...b, cursorId: 'coral' };
    expect(diffUsers([a, b], [a, recursored], 1)).toEqual([{ kind: 'cursor', user: recursored }]);
    expect(diffUsers([a], [{ ...a, name: 'Новое' }], 1)).toEqual([]);
    expect(diffUsers([], [a], 1)).toEqual([]);
  });

  it('нет курсора и default - одно и то же; ничего не изменилось - пусто', () => {
    expect(diffUsers([c], [{ ...c, cursorId: 'default' }], 1)).toEqual([]);
    expect(diffUsers([a, b], [a, b], 1)).toEqual([]);
  });

  it('тексты', () => {
    expect(userEventText({ kind: 'join', user: b })).toBe('Капибара присоединился к доске');
    expect(userEventText({ kind: 'leave', user: b })).toBe('Капибара покинул доску');
    expect(userEventText({ kind: 'rename', user: { userId: 3, name: 'Бодрый Енот' }, from: 'Лемур' })).toBe('Лемур теперь Бодрый Енот');
    expect(userEventText({ kind: 'cursor', user: b })).toBe('Капибара сменил курсор');
  });
});
