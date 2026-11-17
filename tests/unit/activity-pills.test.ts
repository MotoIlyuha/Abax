import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PILL_MAX, PILL_MS, clearPills, diffUsers, pillCount, showPill, showUserEvents, userEventText } from '../../src/activity-pills';

const root = () => document.getElementById('activity-pills')!;
const texts = () => [...root().querySelectorAll('.ap-text')].map(n => n.textContent);

describe('пилюли комнаты', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.className = 'no-motion';
    document.body.textContent = '';
  });
  afterEach(() => {
    clearPills();
    vi.useRealTimers();
    document.body.className = '';
  });

  it('контейнер создаётся с aria-live', () => {
    showPill({ text: 'Привет' });
    expect(root().getAttribute('aria-live')).toBe('polite');
    expect(texts()).toEqual(['Привет']);
  });

  it('не больше трёх: новая вытесняет самую старую', () => {
    for (let i = 1; i <= 5; i++) showPill({ text: `п${i}` });
    expect(pillCount()).toBe(PILL_MAX);
    expect(texts()).toEqual(['п3', 'п4', 'п5']);
  });

  it('исчезает сама через 3.5 с', () => {
    showPill({ text: 'раз' });
    vi.advanceTimersByTime(PILL_MS - 1);
    expect(pillCount()).toBe(1);
    vi.advanceTimersByTime(1);
    expect(pillCount()).toBe(0);
    expect(root().childElementCount).toBe(0);
  });

  it('с анимацией — сначала класс leaving, потом удаление', () => {
    document.body.className = '';
    showPill({ text: 'раз' });
    vi.advanceTimersByTime(PILL_MS);
    expect(root().querySelector('.activity-pill.leaving')).not.toBeNull();
    vi.advanceTimersByTime(300);
    expect(root().childElementCount).toBe(0);
  });

  it('имя с разметкой остаётся текстом', () => {
    showPill({ text: '<img src=x onerror="alert(1)"> присоединился', cursorId: 'default' });
    expect(root().querySelector('img')).toBeNull();
    expect(texts()[0]).toBe('<img src=x onerror="alert(1)"> присоединился');
    // мини-курсор — SVG каталога
    expect(root().querySelector('.ap-cursor svg')).not.toBeNull();
  });

  it('неизвестный курсор — классический', () => {
    showPill({ text: 'x', cursorId: '"><script>' });
    expect(root().querySelector('script')).toBeNull();
    expect(root().querySelector('.ap-cursor svg')).not.toBeNull();
  });

  it('вид, кнопка действия и клик по пилюле', () => {
    const run = vi.fn();
    const onClick = vi.fn();
    showPill({ kind: 'warn', text: 'а', action: { label: 'Открыть', run } });
    showPill({ kind: 'ok', text: 'б', onClick });
    expect(root().querySelector('.activity-pill.warn')).not.toBeNull();
    (root().querySelector('.ap-action') as HTMLButtonElement).click();
    expect(run).toHaveBeenCalledOnce();
    (root().querySelector('.activity-pill.clickable') as HTMLElement).click();
    expect(onClick).toHaveBeenCalledOnce();
    expect(pillCount()).toBe(0);
  });

  it('clearPills убирает все сразу', () => {
    showPill({ text: 'а' });
    showPill({ text: 'б' });
    clearPills();
    expect(pillCount()).toBe(0);
    expect(root().childElementCount).toBe(0);
  });

  it('события состава становятся пилюлями', () => {
    showUserEvents([{ kind: 'join', user: { userId: 2, name: 'Капибара', cursorId: 'mint' } }]);
    expect(texts()).toEqual(['Капибара присоединился к доске']);
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

  it('нет курсора и default — одно и то же; ничего не изменилось — пусто', () => {
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
