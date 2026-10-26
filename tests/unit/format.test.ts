import { describe, expect, it } from 'vitest';
import { capitalize, dayLabel, pagesLabel, plural } from '../../src/format';

describe('подписи домашней страницы', () => {
  it('dayLabel: сегодня, вчера, дата; другой год — с годом', () => {
    const now = new Date(2026, 9, 26, 10, 0).getTime();
    expect(dayLabel(new Date(2026, 9, 26, 0, 5).getTime(), now)).toBe('сегодня');
    expect(dayLabel(new Date(2026, 9, 26, 23, 59).getTime(), now)).toBe('сегодня');
    expect(dayLabel(new Date(2026, 9, 25, 23, 59).getTime(), now)).toBe('вчера');
    expect(dayLabel(new Date(2026, 9, 25, 0, 1).getTime(), now)).toBe('вчера');
    expect(dayLabel(new Date(2026, 9, 12).getTime(), now)).toBe(new Date(2026, 9, 12).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }));
    const old = dayLabel(new Date(2025, 11, 31).getTime(), now);
    expect(old).toContain('2025');
    expect(old).toContain('31');
  });

  it('plural: одна, две–четыре, пять и больше; 11–14 — как пять', () => {
    const forms: [string, string, string] = ['страница', 'страницы', 'страниц'];
    const cases: [number, string][] = [
      [0, 'страниц'], [1, 'страница'], [2, 'страницы'], [4, 'страницы'], [5, 'страниц'],
      [11, 'страниц'], [12, 'страниц'], [14, 'страниц'], [21, 'страница'], [22, 'страницы'],
      [101, 'страница'], [111, 'страниц'], [112, 'страниц'], [124, 'страницы'],
    ];
    for (const [n, word] of cases) expect(plural(n, forms), String(n)).toBe(word);
  });

  it('pagesLabel и capitalize', () => {
    expect(pagesLabel(1)).toBe('1 страница');
    expect(pagesLabel(3)).toBe('3 страницы');
    expect(pagesLabel(12)).toBe('12 страниц');
    expect(capitalize('сегодня')).toBe('Сегодня');
    expect(capitalize('')).toBe('');
  });
});
