import { describe, expect, it } from 'vitest';
import { getParticipantInitials, nearestAvailablePage, pageAvatars } from '../../src/presence';

describe('инициалы участника', () => {
  it('одно и два слова', () => {
    expect(getParticipantInitials('Капибара')).toBe('К');
    expect(getParticipantInitials('бодрый енот')).toBe('БЕ');
    expect(getParticipantInitials('  Анна   Мария  Петровна ')).toBe('АМ');
  });

  it('эмодзи и знаки отбрасываются; пусто — «?»', () => {
    expect(getParticipantInitials('🦫 Бобёр')).toBe('Б');
    expect(getParticipantInitials('🦫')).toBe('?');
    expect(getParticipantInitials('')).toBe('?');
    expect(getParticipantInitials(null)).toBe('?');
    expect(getParticipantInitials('«Гость» 42')).toBe('Г4');
  });
});

describe('аватары у страницы', () => {
  const users = [
    { userId: 1, pageId: 'a' }, { userId: 2, pageId: 'a' }, { userId: 3, pageId: 'a' },
    { userId: 4, pageId: 'a' }, { userId: 5, pageId: 'a' }, { userId: 6, pageId: 'b' },
    { userId: 7, pageId: 'a', hiddenPage: true }, { userId: 8, pageId: null, hiddenPage: true },
  ];
  it('без меня, без скрытых, до трёх и «+N»', () => {
    const r = pageAvatars(users, 'a', 1);
    expect(r.shown.map(u => u.userId)).toEqual([2, 3, 4]);
    expect(r.more).toBe(1);
    expect(pageAvatars(users, 'b', 1)).toEqual({ shown: [users[5]], more: 0 });
    expect(pageAvatars(users, 'c', 1)).toEqual({ shown: [], more: 0 });
  });
});

describe('ближайшая доступная страница', () => {
  const order = ['p1', 'p2', 'p3', 'p4'];
  it('текущая доступна — остаёмся', () => {
    expect(nearestAvailablePage(order, 'p2', ['p1', 'p2'])).toBe('p2');
  });
  it('следующая, иначе предыдущая', () => {
    expect(nearestAvailablePage(order, 'p2', ['p1', 'p4'])).toBe('p4');
    expect(nearestAvailablePage(order, 'p4', ['p1', 'p2'])).toBe('p2');
  });
  it('нет доступных — null; неизвестная текущая — первая доступная', () => {
    expect(nearestAvailablePage(order, 'p2', [])).toBeNull();
    expect(nearestAvailablePage(order, 'zz', ['p3'])).toBe('p3');
  });
});
