import { expect, it } from 'vitest';
import { period } from '../../src/tutor-calendar-ui';
it('показывает понедельник и следующий месяц при переходе через границу года', () => {
  const d = new Date(2027, 0, 1, 13);
  expect(period(d, 'week')).toEqual({ start: new Date(2026, 11, 28), end: new Date(2027, 0, 4) });
  expect(period(d, 'agenda').end).toEqual(new Date(2027, 1, 1));
  expect(period(d, 'day').end).toEqual(new Date(2027, 0, 2));
});
