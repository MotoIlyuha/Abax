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
