import { expect, it } from 'vitest';
import { lessonLanes, changeStatus, moveLesson, newLesson, reminder } from '../../src/tutor-lessons';
import { studentForm } from '../../src/tutor-model';

it('считает долг только по проведённым неоплаченным урокам и сохраняет исходный перенос', () => {
  const s = studentForm({ name: 'Иван', price: 1500 }, 's', 1);
  const l = newLesson(s, 'one', 100, 1);
  const [old, next] = moveLesson(l, 101, 'two', 2);
  expect(old.rescheduled_to_id).toBe(next.id);
  const done = changeStatus(next, 'unpaid', 1200, 0, 3);
  expect(done.amount).toBe(0);
  expect(reminder(s, done.lesson, [old, done.lesson])).toContain('1500 ₽. Спасибо!');
  expect(changeStatus(next, 'unpaid', 1500, 0, 3).amount).toBe(-1500);
});

it('разводит цепочку перекрывающихся уроков по двум колонкам', () => {
  const s = studentForm({ name: 'Анна' }, 's', 1);
  const rows = [0, 30, 60, 140].map((min, i) => newLesson(s, String(i), 36000000 + min * 60000, 1));
  expect([...lessonLanes(rows).values()]).toEqual([
    { column: 0, count: 2 },
    { column: 1, count: 2 },
    { column: 0, count: 2 },
    { column: 0, count: 1 },
  ]);
});
