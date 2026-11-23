import { afterEach, expect, it } from 'vitest';
import { anon, call, closeApps, makeApp, proj, putProject } from './helpers';

afterEach(closeApps);

it('изолирует кабинет, проверяет владельца доски и сохраняет историю после архивации', async () => {
  const app = await makeApp();
  const owner = await anon(app), other = await anon(app);
  const path = '/api/tutor/students';
  expect((await call(app, 'GET', path)).status).toBe(401);
  await putProject(app, other.token, proj('foreign'));
  expect((await call(app, 'POST', path, { name: 'Лена', project_id: 'foreign' }, owner)).status).toBe(404);
  const s = await call(app, 'POST', path, { name: 'Лена', price: 3000 }, owner);
  expect(s.status).toBe(200);
  const card = path + '/' + s.body.id;
  expect((await call(app, 'GET', path, undefined, other)).body).toEqual([]);
  expect((await call(app, 'PATCH', card, { name: '2' }, other)).status).toBe(404);
  const pay = { amount: 9000, operationId: 'abc' };
  for (let n = 0; n < 2; n++) expect((await call(app, 'POST', card + '/balance', pay, owner)).body.balance).toBe(9000);
  expect((await call(app, 'POST', card + '/balance', { ...pay, amount: 1 }, owner)).status).toBe(409);
  expect((await call(app, 'DELETE', card, {}, owner)).body.archived).toBe(true);
  expect((await call(app, 'GET', card + '/payments', undefined, owner)).body).toHaveLength(1);
});
