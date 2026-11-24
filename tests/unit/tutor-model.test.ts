import { expect, it } from 'vitest';
import { calendarDay, studentForm, tutorColors } from '../../src/tutor-model';

it('проверяет палитру, даты, длительность и сохраняет служебные поля при редактировании', () => {
  const s = studentForm({ name: ' Лена ', balance: 100, id: 'other' }, 's', 1);
  expect(s).toMatchObject({ id: 's', name: 'Лена', balance: 0, price: 2000, duration_min: 60 });
  for (const color of tutorColors) expect(studentForm({ color }, 's', 2, s).color).toBe(color);
  for (const patch of [{ name: '' }, { color: 'red' }, { duration_min: 61 }, { price: -1 }, { schedule: [null] }]) {
    expect(() => studentForm(patch, 's', 3, s)).toThrow();
  }
  expect(() => calendarDay('2025-02-29')).toThrow();
  expect(calendarDay('2024-02-29')).toBe(Date.UTC(2024, 1, 29));
});

it('все 12 цветов различимы на поверхности карточки в обеих темах', () => {
  const lightness = (hex: string) =>
    hex
      .slice(1)
      .match(/../g)!
      .reduce((sum, pair, i) => {
        const s = parseInt(pair, 16) / 255,
          linear = s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
        return sum + linear * [0.2126, 0.7152, 0.0722][i];
      }, 0);
  expect(new Set(tutorColors).size).toBe(12);
  for (const c of tutorColors) {
    expect((lightness('#fffefa') + 0.05) / (lightness(c) + 0.05)).toBeGreaterThan(3);
    expect((lightness(c) + 0.05) / (lightness('#21302a') + 0.05)).toBeGreaterThan(3);
  }
});
