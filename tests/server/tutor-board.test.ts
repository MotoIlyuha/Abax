import { afterEach, expect, it } from 'vitest';
import { anon, call, closeApps, makeApp, proj, putProject, taskEl } from './helpers';

afterEach(closeApps);
it('готовит повторение, запускает урок на той же странице и сохраняет права доски', async () => {
  const a = await makeApp({ enforceLimits: false }), u = await anon(a), stranger = await anon(a);
  const p = proj('board');
  p.pages[0].elements = [taskEl({ markedHard: true, attempts: [{ value: '2', timestamp: 1, isCorrect: false }] })];
  await putProject(a,u.token,p);
  const students = '/api/tutor/students', lessons = '/api/tutor/lessons';
  const s = (await call(a, 'POST', students, { name: 'Лена', project_id: p.id, page_title_template: '{student} #{n} {date} {topic}' }, u)).body;
  const l = (await call(a, 'POST', lessons, { student_id: s.id, topic: 'Дроби', start_at: a.clock.t + 3600000 }, u)).body;
  const card = students + '/' + s.id;
  expect((await call(a, 'GET', card + '/progress', undefined, stranger)).status).toBe(404);
  expect((await call(a, 'GET', card + '/progress', undefined, u)).body.difficult).toHaveLength(1);
  const review = await call(a, 'POST', card + '/review', { sourcePage: p.pages[0].id, elementId: 't1' }, u);
  expect(review.status).toBe(200);
  for (let i=0; i<2; i++) expect((await call(a,'POST',lessons + '/' + l.id + '/start',{},u)).body.pageId).toBe(review.body.pageId);
  const updated = (await call(a, 'GET', '/api/projects/board', undefined, u)).body.project;
  expect(updated.pages).toHaveLength(3);
  expect(updated.pages[2].name).toBe('Лена #1 01.11.2026 Дроби');
  expect(updated.pages[2].elements[0].attempts ?? []).toHaveLength(0);
  const link = await call(a,'POST',card + '/invite',{},u);
  expect(link.body.url).toContain('collab');
  expect((await call(a,'POST',card + '/invite',{},u)).body.url).toBe(link.body.url);
});
it('автоматически создаёт доску и открывает первую страницу при выключенном шаблоне', async () => {
  const a = await makeApp(), u = await anon(a);
  const s = (await call(a,'POST','/api/tutor/students',{ name:'Вера', auto_create_page:false },u)).body;
  const l = (await call(a,'POST','/api/tutor/lessons',{ student_id:s.id,start_at:a.clock.t },u)).body;
  const start = await call(a,'POST','/api/tutor/lessons/' + l.id + '/start',{},u);
  expect(start.status).toBe(200);
  const board = (await call(a,'GET','/api/projects/' + start.body.projectId,undefined,u)).body.project;
  expect(board.pages.map((p: {id:string}) => p.id)).toEqual([start.body.pageId]);
});
