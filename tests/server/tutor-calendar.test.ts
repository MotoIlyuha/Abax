import { afterEach, expect, it } from 'vitest';
import { anon, call, closeApps, makeApp } from './helpers';

afterEach(closeApps);
it('генерирует неделю с учётом смещения, сохраняет исключения и проводит оплату один раз', async () => {
  const a = await makeApp(),
    owner = await anon(a);
  const students = '/api/tutor/students',
    lessons = '/api/tutor/lessons';
  const slot = {
    id: 'fri',
    weekday: 5,
    minute: 18 * 60,
    duration: 90,
    offset: 180,
    from: '2026-11-01',
    until: '2026-11-30',
  };
  const s = (await call(a, 'POST', students, { name: 'Маша', schedule: [slot] }, owner)).body;
  const list = () => call(a, 'GET', lessons, undefined, owner);
  const initial = (await list()).body;
  expect(initial).toHaveLength(4);
  expect(initial[0].start_at).toBe(Date.UTC(2026, 10, 6, 15));
  expect(initial[0].duration_min).toBe(90);
  await call(a, 'PATCH', students + '/' + s.id, { schedule: [slot] }, owner);
  expect((await list()).body).toEqual(initial);
  const first = lessons + '/' + initial[0].id;
  await call(a, 'POST', students + '/' + s.id + '/balance', { amount: 4000 }, owner);
  for (const status of ['unpaid', 'unpaid', 'paid'])
    expect((await call(a, 'PATCH', first, { status }, owner)).body.status).toBe('paid');
  expect((await call(a, 'GET', students + '/' + s.id, undefined, owner)).body.balance).toBe(2000);
  await call(a, 'DELETE', first, {}, owner);
  expect((await call(a, 'GET', first, undefined, owner)).status).toBe(404);
  expect((await call(a, 'GET', students + '/' + s.id, undefined, owner)).body.balance).toBe(4000);
  const start_at = initial[1].start_at + 3600000;
  const move = await call(
    a,
    'POST',
    lessons + '/' + initial[1].id + '/reschedule',
    { start_at, scope: 'following' },
    owner,
  );
  expect(move.status).toBe(200);
  expect(move.body).toHaveLength(3);
  const revised = (await call(a, 'GET', students + '/' + s.id, undefined, owner)).body.schedule;
  expect(revised).toHaveLength(2);
  expect(revised[1].minute).toBe(19 * 60);
  await call(a, 'PATCH', students + '/' + s.id, { schedule: revised }, owner);
  const rows = (await list()).body;
  expect(rows.filter((l: { status: string }) => l.status === 'scheduled')).toHaveLength(3);
  expect(
    (await call(a, 'GET', lessons + '?from=' + start_at + '&to=' + (start_at + 1), undefined, owner)).body,
  ).toHaveLength(1);
});
