// REST проектов: сохранение с лимитами тарифов, роли при просмотре, патчи, клонирование, удаление.
// Главное свойство: правильный ответ задания не уходит никому, кроме владельца.
import { afterEach, describe, expect, it } from 'vitest';
import { MAX_REVISIONS_PER_PROJECT } from '../../server/db';
import { addInvite, anon, call, closeApps, editStored, makeApp, proj, putProject, rectEl, setPlan, taskEl } from './helpers';

afterEach(closeApps);

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

/** В тексте ответа не должно быть ни ответа, ни закрытого решения. */
function expectNoSecrets(body: unknown): void {
  const text = JSON.stringify(body);
  expect(text).not.toContain('"answer":"42"');
  expect(text).not.toContain('СЕКРЕТНОЕ-РЕШЕНИЕ');
  expect(text).not.toMatch(/"answer":"(?!")/);
}

async function setup(over: Parameters<typeof makeApp>[0] = {}) {
  const app = await makeApp(over);
  const owner = await anon(app);
  return { app, owner };
}

describe('сохранение и чтение владельцем', () => {
  it('PUT создаёт проект (ревизия 1), повторный — ревизия 2; владелец видит всё, включая ответы', async () => {
    const { app, owner } = await setup();
    const p = proj('a');
    const r1 = await putProject(app, owner.token, p);
    expect(r1.status).toBe(200);
    expect(r1.body).toMatchObject({ id: 'a', rev: 1, ownerPlan: 'free' });
    expect(typeof r1.body.updatedAt).toBe('number');
    const r2 = await putProject(app, owner.token, { ...p, name: 'Новое имя' }, 1);
    expect(r2.body.rev).toBe(2);
    const got = await call(app, 'GET', '/api/projects/a', undefined, { token: owner.token });
    expect(got.body).toMatchObject({ role: 'host', rev: 2, canClone: true, ownerPlan: 'free' });
    expect(got.body.project.name).toBe('Новое имя');
    expect(got.body.project.pages[0].elements[0]).toMatchObject({ answer: '42', solutionMd: 'СЕКРЕТНОЕ-РЕШЕНИЕ' });
    expect(app.db.prepare('SELECT title, rev FROM projects WHERE id = ?').get('a')).toEqual({ title: 'Новое имя', rev: 2 });
  });

  it('список проектов: только свои, свежие первыми, с числом страниц и тарифом', async () => {
    const { app, owner } = await setup();
    const other = await anon(app);
    await putProject(app, owner.token, proj('a'));
    app.clock.t += 1000;
    await putProject(app, owner.token, proj('b', { pinned: true, icon: '📐' }));
    await putProject(app, other.token, proj('z'));
    const r = await call(app, 'GET', '/api/projects', undefined, { token: owner.token });
    expect(r.body.projects.map((p: any) => p.id)).toEqual(['b', 'a']);
    expect(r.body.projects[0]).toMatchObject({ title: 'Проект b', name: 'Проект b', rev: 1, pageCount: 2, ownerPlan: 'free', pinned: true, icon: '📐' });
    expect((await call(app, 'GET', '/api/projects')).status).toBe(401);
  });

  it('негодный ввод: не проект — 400, чужой id в адресе — 400, без сессии — 401, чужой проект — 409', async () => {
    const { app, owner } = await setup();
    expect((await call(app, 'PUT', '/api/projects/a', { project: { id: 'a' } }, { token: owner.token })).status).toBe(400);
    expect((await call(app, 'PUT', '/api/projects/a', { nope: 1 }, { token: owner.token })).status).toBe(400);
    expect((await putProject(app, owner.token, { ...proj('b') }).then(r => r.status))).toBe(200);
    expect((await call(app, 'PUT', '/api/projects/a', { project: proj('b') }, { token: owner.token })).body.error).toBe('id-mismatch');
    expect((await call(app, 'PUT', '/api/projects/a', { project: proj('a') })).status).toBe(401);
    const intruder = await anon(app);
    const r = await putProject(app, intruder.token, proj('b'));
    expect(r.status).toBe(409);
    expect(r.body.error).toBe('id-taken');
    expect(app.db.prepare('SELECT owner_id FROM projects WHERE id = ?').get('b')).toEqual({ owner_id: owner.id });
  });

  it('неизвестный и отсутствующий проект — 404', async () => {
    const { app, owner } = await setup();
    expect((await call(app, 'GET', '/api/projects/нет', undefined, { token: owner.token })).status).toBe(404);
    expect((await call(app, 'GET', '/api/projects/нет')).status).toBe(404);
  });

  it('сервер сам проставляет ownerPlan и убирает права, недоступные на тарифе', async () => {
    const { app, owner } = await setup();
    const r = await putProject(app, owner.token, proj('a', { ownerPlan: 'tutor', permissions: { forbidClone: true, allowCopy: false, pageRights: { 'a-p2': 'view', x: 'мусор' } } }));
    expect(r.body.ownerPlan).toBe('free');
    expect(r.body.permissions).toEqual({ forbidClone: false, allowCopy: true, pageRights: { 'a-p2': 'view' } });
    expect(app.db.prepare('SELECT forbid_clone, allow_copy, page_rights_json FROM projects WHERE id = ?').get('a'))
      .toEqual({ forbid_clone: 0, allow_copy: 1, page_rights_json: '{"a-p2":"view"}' });
    setPlan(app, owner.id, 'pro');
    const pro = await putProject(app, owner.token, proj('a', { permissions: { forbidClone: true, allowCopy: false } }));
    expect(pro.body.ownerPlan).toBe('pro');
    expect(pro.body.permissions).toMatchObject({ forbidClone: true, allowCopy: false });
    expect(app.db.prepare('SELECT forbid_clone, allow_copy FROM projects WHERE id = ?').get('a')).toEqual({ forbid_clone: 1, allow_copy: 0 });
  });
});

describe('лимиты тарифа на сервере', () => {
  it('free: четвёртый проект — 403 plan-limit-projects; удалённый в счёт не идёт; pro и tutor — без лимита', async () => {
    const { app, owner } = await setup();
    for (const id of ['a', 'b', 'c']) expect((await putProject(app, owner.token, proj(id))).status).toBe(200);
    const fourth = await putProject(app, owner.token, proj('d'));
    expect(fourth.status).toBe(403);
    expect(fourth.body.error).toBe('plan-limit-projects');
    expect(app.db.prepare("SELECT COUNT(*) n FROM projects WHERE id = 'd'").get()).toEqual({ n: 0 });
    // сохранение уже существующего лимита не касается
    expect((await putProject(app, owner.token, proj('a'), 1)).status).toBe(200);
    expect((await call(app, 'DELETE', '/api/projects/c', undefined, { token: owner.token })).status).toBe(200);
    expect((await putProject(app, owner.token, proj('d'))).status).toBe(200);
    expect((await putProject(app, owner.token, proj('e'))).status).toBe(403);
    setPlan(app, owner.id, 'pro');
    for (const id of ['e', 'f', 'g']) expect((await putProject(app, owner.token, proj(id))).status).toBe(200);
    setPlan(app, owner.id, 'tutor');
    expect((await putProject(app, owner.token, proj('h'))).status).toBe(200);
  });

  it('free: в проекте не больше трёх страниц — при создании и при росте; pro — сколько угодно', async () => {
    const { app, owner } = await setup();
    const pages = (id: string, n: number) => Array.from({ length: n }, (_, i) => ({ id: `${id}-${i}`, name: `С${i}`, grid: 'square', elements: [] }));
    const big = await putProject(app, owner.token, proj('a', { pages: pages('a', 4) }));
    expect(big.status).toBe(403);
    expect(big.body.error).toBe('plan-limit-pages');
    expect((await putProject(app, owner.token, proj('a', { pages: pages('a', 3) }))).status).toBe(200);
    const grow = await putProject(app, owner.token, proj('a', { pages: pages('a', 4) }), 1);
    expect(grow.status).toBe(403);
    expect(grow.body.error).toBe('plan-limit-pages');
    setPlan(app, owner.id, 'pro');
    expect((await putProject(app, owner.token, proj('a', { pages: pages('a', 6) }), 1)).status).toBe(200);
  });

  it('понижение тарифа: страницы сверх лимита остаются, но расти проект не может', async () => {
    const { app, owner } = await setup();
    setPlan(app, owner.id, 'pro');
    const pages = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `С${i}`, grid: 'square', elements: [] }));
    expect((await putProject(app, owner.token, proj('a', { pages: pages(5) }))).status).toBe(200);
    setPlan(app, owner.id, 'free');
    expect((await putProject(app, owner.token, proj('a', { pages: pages(5) }), 1)).status).toBe(200);
    expect((await putProject(app, owner.token, proj('a', { pages: pages(4) }), 2)).status).toBe(200);
    expect((await putProject(app, owner.token, proj('a', { pages: pages(5) }), 3)).status).toBe(403);
  });

  it('просроченный pro — снова free', async () => {
    const { app, owner } = await setup();
    setPlan(app, owner.id, 'pro', app.clock.t + 1000);
    for (const id of ['a', 'b', 'c', 'd']) expect((await putProject(app, owner.token, proj(id))).status).toBe(200);
    app.clock.t += 5000;
    expect((await putProject(app, owner.token, proj('e'))).status).toBe(403);
  });

  it('без ABAX_ENFORCE_LIMITS ограничений по числу нет, а права по тарифу всё равно режутся', async () => {
    const { app, owner } = await setup({ enforceLimits: false });
    for (const id of ['a', 'b', 'c', 'd', 'e']) expect((await putProject(app, owner.token, proj(id, { permissions: { forbidClone: true } }))).status).toBe(200);
    expect(app.db.prepare('SELECT SUM(forbid_clone) s FROM projects').get()).toEqual({ s: 0 });
  });
});

describe('картинки в проекте', () => {
  const withImage = (id: string, src: string) => proj(id, { pages: [{ id: `${id}-p`, name: 'С', grid: 'square', elements: [{ id: 'img', type: 'image', x: 0, y: 0, w: 5, h: 5, src }] }] });

  it('data URL внутри JSON выносится в хранилище, в базе остаётся asset://', async () => {
    const { app, owner } = await setup();
    const r = await putProject(app, owner.token, withImage('a', PNG));
    expect(r.status).toBe(200);
    const got = (await call(app, 'GET', '/api/projects/a', undefined, { token: owner.token })).body.project;
    const src = got.pages[0].elements[0].src as string;
    expect(src).toMatch(/^asset:\/\/[0-9a-f]{64}$/);
    expect((await call(app, 'GET', `/api/assets/${src.slice(8)}?format=dataUrl`)).body).toBe(PNG);
    expect(app.db.prepare('SELECT data_json FROM projects').get()).not.toHaveProperty('data_json', expect.stringContaining('base64'));
  });

  it('ссылка на неизвестную картинку — 409 missing-assets со списком; после загрузки проходит', async () => {
    const { app, owner } = await setup();
    const hash = 'ab'.repeat(32);
    const r = await putProject(app, owner.token, withImage('a', `asset://${hash}`));
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ error: 'missing-assets', hashes: [hash] });
    const up = await call(app, 'POST', '/api/assets', { dataUrl: PNG }, { token: owner.token });
    expect((await putProject(app, owner.token, withImage('a', `asset://${up.body.hash}`))).status).toBe(200);
    expect(app.db.prepare("SELECT COUNT(*) n FROM projects WHERE id = 'a'").get()).toEqual({ n: 1 });
  });

  it('адреса из интернета и чужие схемы в src картинки стираются', async () => {
    const { app, owner } = await setup();
    await putProject(app, owner.token, withImage('a', 'https://tracker.example/pixel.png'));
    await putProject(app, owner.token, withImage('b', 'javascript:alert(1)'));
    for (const id of ['a', 'b']) {
      const got = (await call(app, 'GET', `/api/projects/${id}`, undefined, { token: owner.token })).body.project;
      expect(got.pages[0].elements[0].src).toBe('');
    }
  });
});

describe('устаревшая ревизия: сохранение автора не стирает чужой ввод', () => {
  async function seeded() {
    const s = await setup();
    await putProject(s.app, s.owner.token, proj('a')); // rev 1
    editStored(s.app, 'a', p => { // «пока автор не смотрел»: ученик ответил, поставили реакцию и написали комментарий (rev 2)
      const t = p.pages[0].elements[0];
      t.attempts = [{ value: '41', timestamp: 100, isCorrect: false }, { value: '42', timestamp: 200, isCorrect: true }];
      t.studentDraft = 'печатает';
      p.pages[0].elements[1].reactions = { '👍': ['u1'] };
      p.pages[0].comments = [{ id: 'c1', x: 0, y: 0, messages: [{ id: 'm1', authorId: 'u1', authorName: 'Ученик', text: 'Что тут?', createdAt: 5 }] }];
    });
    return s;
  }

  it('expectedRev меньше текущей: правки автора применяются, попытки, черновик, реакции и комментарии остаются', async () => {
    const { app, owner } = await seeded();
    const mine = proj('a', { name: 'Переименовал' });
    mine.pages[0].elements[1] = { ...rectEl('r1'), color: '#ff0000' };
    mine.pages[0].elements[0].attempts = [{ value: '40', timestamp: 50, isCorrect: false }]; // своя старая попытка автора
    const r = await putProject(app, owner.token, mine, 1);
    expect(r.body.rev).toBe(3);
    const got = (await call(app, 'GET', '/api/projects/a', undefined, { token: owner.token })).body.project;
    expect(got.name).toBe('Переименовал');
    const [task, rect] = got.pages[0].elements;
    expect(rect.color).toBe('#ff0000');
    expect(rect.reactions).toEqual({ '👍': ['u1'] });
    expect(task.attempts.map((a: any) => a.value)).toEqual(['40', '41', '42']);
    expect(task.studentDraft).toBe('печатает');
    expect(got.pages[0].comments).toHaveLength(1);
  });

  it('expectedRev равен текущей: клиент всё видел, его версия — истина', async () => {
    const { app, owner } = await seeded();
    const mine = proj('a');
    const r = await putProject(app, owner.token, mine, 2);
    expect(r.body.rev).toBe(3);
    const got = (await call(app, 'GET', '/api/projects/a', undefined, { token: owner.token })).body.project;
    expect(got.pages[0].elements[0].attempts).toBeUndefined();
    expect(got.pages[0].comments).toBeUndefined();
  });

  it('expectedRev не передан — считается устаревшим (ввод не теряется)', async () => {
    const { app, owner } = await seeded();
    await putProject(app, owner.token, proj('a'));
    const got = (await call(app, 'GET', '/api/projects/a', undefined, { token: owner.token })).body.project;
    expect(got.pages[0].elements[0].attempts).toHaveLength(2);
  });
});

describe('просмотр: роли и маскировка', () => {
  async function shared() {
    const s = await setup();
    setPlan(s.app, s.owner.id, 'pro');
    const p = proj('a', {
      permissions: { forbidClone: false, allowCopy: true, pageRights: { 'a-p3': 'hidden' } },
      pages: [
        { id: 'a-p1', name: 'Первая', grid: 'square', elements: [taskEl({ attempts: [{ value: '7', timestamp: 1, isCorrect: false }], studentDraft: 'черновик', markedHard: true }), rectEl('r1')],
          comments: [{ id: 'c1', x: 0, y: 0, messages: [{ id: 'm', authorId: 'u', authorName: 'Имя-ученика', text: 'Вопрос', createdAt: 1 }] }] },
        { id: 'a-p2', name: 'Вторая', grid: 'square', elements: [taskEl({ id: 't2', solutionVisibleToStudent: true, solutionMd: 'ОТКРЫТОЕ-РЕШЕНИЕ' })] },
        { id: 'a-p3', name: 'Скрытая', grid: 'square', elements: [{ ...rectEl('secret'), type: 'text', x: 0, y: 0, text: 'СКРЫТЫЙ-ТЕКСТ', size: 20, color: '#000000' }] },
      ],
    });
    await putProject(s.app, s.owner.token, p);
    return { ...s, p };
  }

  it('зритель без входа: без ответов и закрытых решений, без ввода учеников и комментариев, скрытых страниц нет', async () => {
    const { app } = await shared();
    const r = await call(app, 'GET', '/api/projects/a');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ role: 'viewer', canClone: true, allowCopy: true, ownerPlan: 'pro' });
    const pages = r.body.project.pages;
    expect(pages.map((p: any) => p.id)).toEqual(['a-p1', 'a-p2']);
    const task = pages[0].elements[0];
    expect(task).toMatchObject({ answer: '' });
    for (const k of ['solutionMd', 'attempts', 'studentDraft', 'markedHard']) expect(task).not.toHaveProperty(k);
    expect(pages[0]).not.toHaveProperty('comments');
    expect(pages[1].elements[0]).toMatchObject({ answer: '', solutionMd: 'ОТКРЫТОЕ-РЕШЕНИЕ' });
    expectNoSecrets({ ...r.body, project: { ...r.body.project, pages: [pages[0]] } });
    const text = JSON.stringify(r.body);
    for (const leak of ['СКРЫТЫЙ-ТЕКСТ', 'a-p3', 'Имя-ученика', 'черновик']) expect(text).not.toContain(leak);
  });

  it('любой вошедший не-владелец видит то же, что и зритель', async () => {
    const { app } = await shared();
    const stranger = await anon(app);
    const r = await call(app, 'GET', '/api/projects/a', undefined, { token: stranger.token });
    expect(r.body.role).toBe('viewer');
    expect(r.body.project.pages[0].elements[0].answer).toBe('');
  });

  it('?pageId=: только эта страница, клонировать нельзя, скрытая и неизвестная — 404', async () => {
    const { app } = await shared();
    const r = await call(app, 'GET', '/api/projects/a?pageId=a-p2');
    expect(r.body.project.pages.map((p: any) => p.id)).toEqual(['a-p2']);
    expect(r.body).toMatchObject({ role: 'viewer', canClone: false });
    expect(r.body.project.permissions.forbidClone).toBe(true);
    expect(JSON.stringify(r.body)).not.toContain('a-p1');
    for (const pageId of ['a-p3', 'нет']) {
      const bad = await call(app, 'GET', `/api/projects/a?pageId=${pageId}`);
      expect(bad.status).toBe(404);
      expect(bad.body.error).toBe('page-not-found');
    }
  });

  it('запрет клонирования владельца: canClone=false и в проекте зрителя forbidClone', async () => {
    const { app, owner, p } = await shared();
    await putProject(app, owner.token, { ...p, permissions: { forbidClone: true, allowCopy: false, pageRights: { 'a-p3': 'hidden' } } }, 1);
    const r = await call(app, 'GET', '/api/projects/a');
    expect(r.body).toMatchObject({ canClone: false, allowCopy: false });
    expect(r.body.project.permissions).toMatchObject({ forbidClone: true, allowCopy: false });
  });

  it('гость по приглашению: страницы по правам приглашения, ответы скрыты, ввод учеников и комментарии виден', async () => {
    const { app, owner } = await shared();
    addInvite(app, 'tok-ok', 'a', owner.id, { defaultRole: 'view', pageRights: { 'a-p1': 'edit', 'a-p2': 'hidden', 'a-p3': 'view' } });
    const r = await call(app, 'GET', '/api/projects/a?invite=tok-ok');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ role: 'guest', defaultRole: 'view', pageRights: { 'a-p1': 'edit', 'a-p3': 'view' } });
    expect(r.body.project.pages.map((p: any) => p.id)).toEqual(['a-p1', 'a-p3']); // «скрытая» проектом a-p3 открыта приглашением явно
    const task = r.body.project.pages[0].elements[0];
    expect(task.answer).toBe('');
    expect(task).not.toHaveProperty('solutionMd');
    expect(task.attempts).toHaveLength(1);
    expect(r.body.project.pages[0].comments).toHaveLength(1);
    expect(JSON.stringify(r.body)).not.toContain('"answer":"42"');
    expect(JSON.stringify(r.body)).not.toContain('СЕКРЕТНОЕ-РЕШЕНИЕ');
  });

  it('приглашение без своих прав на страницы наследует скрытые страницы проекта', async () => {
    const { app, owner } = await shared();
    addInvite(app, 'tok-def', 'a', owner.id);
    const r = await call(app, 'GET', '/api/projects/a?invite=tok-def');
    expect(r.body.project.pages.map((p: any) => p.id)).toEqual(['a-p1', 'a-p2']);
    expect(r.body.pageRights).toEqual({ 'a-p1': 'edit', 'a-p2': 'edit' });
    expect(JSON.stringify(r.body)).not.toContain('СКРЫТЫЙ-ТЕКСТ');
  });

  it('отозванное, просроченное, чужое и неизвестное приглашения — 404', async () => {
    const { app, owner } = await shared();
    await putProject(app, owner.token, proj('b'));
    addInvite(app, 'tok-rev', 'a', owner.id, { revoked: 1 });
    addInvite(app, 'tok-exp', 'a', owner.id, { expiresAt: app.clock.t - 1 });
    addInvite(app, 'tok-b', 'b', owner.id);
    for (const t of ['tok-rev', 'tok-exp', 'tok-b', 'нет-такого']) {
      const r = await call(app, 'GET', `/api/projects/a?invite=${t}`);
      expect(r.status, t).toBe(404);
      expect(r.body.error).toBe('invite-not-found');
    }
  });

  it('владелец с ?invite= всё равно host и видит всё', async () => {
    const { app, owner } = await shared();
    addInvite(app, 'tok', 'a', owner.id, { pageRights: { 'a-p2': 'hidden' } });
    const r = await call(app, 'GET', '/api/projects/a?invite=tok', undefined, { token: owner.token });
    expect(r.body.role).toBe('host');
    expect(r.body.project.pages).toHaveLength(3);
    expect(r.body.project.pages[0].elements[0].answer).toBe('42');
  });

  it('удалённый проект недоступен никому', async () => {
    const { app, owner } = await shared();
    await call(app, 'DELETE', '/api/projects/a', undefined, { token: owner.token });
    expect((await call(app, 'GET', '/api/projects/a')).status).toBe(404);
    expect((await call(app, 'GET', '/api/projects/a', undefined, { token: owner.token })).status).toBe(404);
  });
});

describe('POST /api/projects/:id/patch', () => {
  const putOp = (el: any) => ({ op: 'put', el });
  const patch = (pageId: string, ops: any[]) => ({ t: 'patch', pageId, rev: 0, ops });

  async function shared() {
    const s = await setup();
    setPlan(s.app, s.owner.id, 'pro');
    await putProject(s.app, s.owner.token, proj('a'));
    addInvite(s.app, 'edit-all', 'a', s.owner.id, { defaultRole: 'edit' });
    addInvite(s.app, 'view-all', 'a', s.owner.id, { defaultRole: 'view' });
    addInvite(s.app, 'edit-p2', 'a', s.owner.id, { defaultRole: 'view', pageRights: { 'a-p2': 'edit', 'a-p1': 'hidden' } });
    return s;
  }
  const stored = (app: any) => JSON.parse((app.db.prepare('SELECT data_json FROM projects WHERE id = ?').get('a') as any).data_json);

  it('владелец: put/del/order применяются, ревизия растёт, запись в журнале', async () => {
    const { app, owner } = await shared();
    const r = await call(app, 'POST', '/api/projects/a/patch', patch('a-p2', [putOp(rectEl('r9')), { op: 'del', id: 'r2' }]), { token: owner.token });
    expect(r.body).toEqual({ ok: true, rev: 2 });
    expect(stored(app).pages[1].elements.map((e: any) => e.id)).toEqual(['r9']);
    const rev = app.db.prepare('SELECT rev, page_id, author_id, patch_json FROM project_revisions WHERE project_id = ? ORDER BY rev DESC LIMIT 1').get('a') as any;
    expect(rev).toMatchObject({ rev: 2, page_id: 'a-p2', author_id: owner.id });
    expect(JSON.parse(rev.patch_json).ops).toHaveLength(2);
  });

  it('гость с edit на странице правит её без сессии; на других страницах и с view — 403', async () => {
    const { app } = await shared();
    const ok = await call(app, 'POST', '/api/projects/a/patch?invite=edit-p2', patch('a-p2', [putOp(rectEl('g1'))]));
    expect(ok.status).toBe(200);
    expect(stored(app).pages[1].elements.map((e: any) => e.id)).toEqual(['r2', 'g1']);
    expect(app.db.prepare('SELECT author_id FROM project_revisions WHERE rev = 2').get()).toEqual({ author_id: null });
    for (const [invite, pageId] of [['edit-p2', 'a-p1'], ['view-all', 'a-p2'], ['view-all', 'a-p1']]) {
      const r = await call(app, 'POST', `/api/projects/a/patch?invite=${invite}`, patch(pageId, [putOp(rectEl('x'))]));
      expect(r.status, `${invite}/${pageId}`).toBe(403);
      expect(r.body.error).toBe('no-edit-right');
    }
    expect(stored(app).pages[0].elements.map((e: any) => e.id)).toEqual(['t1', 'r1']);
  });

  it('без прав: без сессии и приглашения — 401, чужой вошедший — 403, плохое приглашение — 403; плохой патч — 400; нет страницы — 404', async () => {
    const { app } = await shared();
    const stranger = await anon(app);
    const body = patch('a-p2', [putOp(rectEl('x'))]);
    expect((await call(app, 'POST', '/api/projects/a/patch', body)).status).toBe(401);
    expect((await call(app, 'POST', '/api/projects/a/patch', body, { token: stranger.token })).status).toBe(403);
    expect((await call(app, 'POST', '/api/projects/a/patch?invite=нет', body)).status).toBe(403);
    expect((await call(app, 'POST', '/api/projects/a/patch?invite=edit-all', { t: 'patch', pageId: 5 })).status).toBe(400);
    expect((await call(app, 'POST', '/api/projects/a/patch?invite=edit-all', patch('нет', []))).status).toBe(404);
    expect((await call(app, 'POST', '/api/projects/нет/patch?invite=edit-all', body)).status).toBe(404);
  });

  it('гость не может подменить ответ задания, но его ввод принимается и проверяется по настоящему ответу', async () => {
    const { app } = await shared();
    const hacked = taskEl({ answer: 'ВЗЛОМ', statementMd: 'Другое условие', solutionMd: 'мой', attempts: [{ value: '42', timestamp: 9, isCorrect: false }, { value: '0', timestamp: 10, isCorrect: true }], studentDraft: 'ввод' });
    const r = await call(app, 'POST', '/api/projects/a/patch?invite=edit-all', patch('a-p1', [putOp(hacked)]));
    expect(r.status).toBe(200);
    const task = stored(app).pages[0].elements[0];
    expect(task).toMatchObject({ answer: '42', statementMd: 'Сколько будет 6×7?', solutionMd: 'СЕКРЕТНОЕ-РЕШЕНИЕ', studentDraft: 'ввод' });
    expect(task.attempts).toEqual([{ value: '42', timestamp: 9, isCorrect: true }, { value: '0', timestamp: 10, isCorrect: false }]);
  });

  it('патч владельца не стирает ответы учеников в задании', async () => {
    const { app, owner } = await shared();
    editStored(app, 'a', p => { p.pages[0].elements[0].attempts = [{ value: '42', timestamp: 3, isCorrect: true }]; });
    const moved = taskEl({ x: 500 });
    await call(app, 'POST', '/api/projects/a/patch', patch('a-p1', [putOp(moved)]), { token: owner.token });
    const task = stored(app).pages[0].elements[0];
    expect(task.x).toBe(500);
    expect(task.attempts).toHaveLength(1);
  });

  it('картинка в патче выносится в хранилище; чужой адрес в src стирается; негодный элемент пропускается', async () => {
    const { app, owner } = await shared();
    const img = (id: string, src: string) => ({ id, type: 'image', x: 0, y: 0, w: 5, h: 5, src });
    await call(app, 'POST', '/api/projects/a/patch', patch('a-p2', [putOp(img('i1', PNG)), putOp(img('i2', 'https://x.example/a.png')), putOp({ id: 'bad', type: 'неизвестно' })]), { token: owner.token });
    const els = stored(app).pages[1].elements;
    expect(els.find((e: any) => e.id === 'i1').src).toMatch(/^asset:\/\/[0-9a-f]{64}$/);
    expect(els.find((e: any) => e.id === 'i2').src).toBe('');
    expect(els.find((e: any) => e.id === 'bad')).toBeUndefined();
  });

  it('журнал ревизий хранит не больше последних 200', async () => {
    const { app, owner } = await shared();
    for (let i = 0; i < MAX_REVISIONS_PER_PROJECT + 5; i++) {
      await call(app, 'POST', '/api/projects/a/patch', patch('a-p2', [putOp({ ...rectEl('r2'), x: i })]), { token: owner.token });
    }
    const n = app.db.prepare('SELECT COUNT(*) n, MIN(rev) lo, MAX(rev) hi FROM project_revisions WHERE project_id = ?').get('a') as any;
    expect(n.n).toBe(MAX_REVISIONS_PER_PROJECT);
    expect(n.hi).toBe(MAX_REVISIONS_PER_PROJECT + 6);
    expect(n.lo).toBe(n.hi - MAX_REVISIONS_PER_PROJECT + 1);
  });
});

describe('POST /api/projects/:id/clone', () => {
  async function shared(permissions: any = { pageRights: { 'a-p3': 'hidden' } }) {
    const s = await setup();
    setPlan(s.app, s.owner.id, 'pro');
    await putProject(s.app, s.owner.token, proj('a', {
      permissions,
      pages: [
        { id: 'a-p1', name: 'Первая', grid: 'square', elements: [taskEl({ attempts: [{ value: '1', timestamp: 1, isCorrect: false }], studentDraft: 'ч', markedHard: true }), rectEl('r1')],
          comments: [{ id: 'c1', x: 0, y: 0, messages: [{ id: 'm', authorId: 'u', authorName: 'Имя', text: 'Т', createdAt: 1 }] }] },
        { id: 'a-p3', name: 'Скрытая', grid: 'square', elements: [rectEl('hidden-el')] },
      ],
    }));
    return s;
  }

  it('чужой проект: новая копия у клонирующего — без ответов, ввода, комментариев, прав и скрытых страниц', async () => {
    const { app } = await shared();
    const cloner = await anon(app);
    const r = await call(app, 'POST', '/api/projects/a/clone', undefined, { token: cloner.token });
    expect(r.status).toBe(201);
    const c = r.body.project;
    expect(r.body).toMatchObject({ id: c.id, rev: 1, ownerPlan: 'free' });
    expect(c.id).not.toBe('a');
    expect(c).toMatchObject({ name: 'Проект a (копия)', ownerPlan: 'free' });
    expect(c).not.toHaveProperty('permissions');
    expect(c.pages.map((p: any) => p.id)).toEqual(['a-p1']);
    expect(c.pages[0]).not.toHaveProperty('comments');
    const task = c.pages[0].elements[0];
    expect(task.answer).toBe('');
    for (const k of ['solutionMd', 'attempts', 'studentDraft', 'markedHard']) expect(task).not.toHaveProperty(k);
    expect(JSON.stringify(r.body)).not.toContain('42');
    expect(JSON.stringify(r.body)).not.toContain('hidden-el');
    // сохранено у клонирующего и у него же читается
    expect(app.db.prepare('SELECT owner_id FROM projects WHERE id = ?').get(c.id)).toEqual({ owner_id: cloner.id });
    expect(JSON.stringify(app.db.prepare('SELECT data_json FROM projects WHERE id = ?').get(c.id))).not.toContain('СЕКРЕТНОЕ');
    const got = await call(app, 'GET', `/api/projects/${c.id}`, undefined, { token: cloner.token });
    expect(got.body.role).toBe('host');
    // оригинал не тронут
    expect(JSON.parse((app.db.prepare('SELECT data_json FROM projects WHERE id = ?').get('a') as any).data_json).pages[0].elements[0].answer).toBe('42');
  });

  it('запрет клонирования — 403 clone-forbidden; владельцу можно', async () => {
    const { app, owner } = await shared({ forbidClone: true });
    const cloner = await anon(app);
    const r = await call(app, 'POST', '/api/projects/a/clone', undefined, { token: cloner.token });
    expect(r.status).toBe(403);
    expect(r.body.error).toBe('clone-forbidden');
    expect(app.db.prepare('SELECT COUNT(*) n FROM projects WHERE owner_id = ?').get(cloner.id)).toEqual({ n: 0 });
    expect((await call(app, 'POST', '/api/projects/a/clone', undefined, { token: owner.token })).status).toBe(201);
  });

  it('лимит проектов клонирующего на free — 403 plan-limit-projects; pro клонирует без лимита', async () => {
    const { app } = await shared();
    const cloner = await anon(app);
    for (const id of ['x', 'y', 'z']) await putProject(app, cloner.token, proj(id));
    const r = await call(app, 'POST', '/api/projects/a/clone', undefined, { token: cloner.token });
    expect(r.status).toBe(403);
    expect(r.body.error).toBe('plan-limit-projects');
    setPlan(app, cloner.id, 'pro');
    expect((await call(app, 'POST', '/api/projects/a/clone', undefined, { token: cloner.token })).status).toBe(201);
  });

  it('нужна сессия; удалённый и неизвестный проект — 404; с приглашением скрываются и его скрытые страницы', async () => {
    const { app, owner } = await shared({});
    expect((await call(app, 'POST', '/api/projects/a/clone')).status).toBe(401);
    const cloner = await anon(app);
    expect((await call(app, 'POST', '/api/projects/нет/clone', undefined, { token: cloner.token })).status).toBe(404);
    addInvite(app, 'tok', 'a', owner.id, { pageRights: { 'a-p3': 'hidden' } });
    const r = await call(app, 'POST', '/api/projects/a/clone?invite=tok', undefined, { token: cloner.token });
    expect(r.body.project.pages.map((p: any) => p.id)).toEqual(['a-p1']);
    await call(app, 'DELETE', '/api/projects/a', undefined, { token: owner.token });
    expect((await call(app, 'POST', '/api/projects/a/clone', undefined, { token: cloner.token })).status).toBe(404);
  });
});

describe('DELETE /api/projects/:id', () => {
  it('мягкое удаление: проект скрыт, строка остаётся; чужой и повторный — 404; PUT владельца его восстанавливает', async () => {
    const { app, owner } = await setup();
    const other = await anon(app);
    await putProject(app, owner.token, proj('a'));
    expect((await call(app, 'DELETE', '/api/projects/a', undefined, { token: other.token })).status).toBe(404);
    expect((await call(app, 'DELETE', '/api/projects/a')).status).toBe(401);
    expect((await call(app, 'DELETE', '/api/projects/a', undefined, { token: owner.token })).status).toBe(200);
    expect(app.db.prepare('SELECT is_deleted FROM projects WHERE id = ?').get('a')).toEqual({ is_deleted: 1 });
    expect((await call(app, 'DELETE', '/api/projects/a', undefined, { token: owner.token })).status).toBe(404);
    expect((await call(app, 'GET', '/api/projects', undefined, { token: owner.token })).body.projects).toEqual([]);
    expect((await putProject(app, other.token, proj('a'))).status).toBe(409);
    const back = await putProject(app, owner.token, proj('a'));
    expect(back.status).toBe(200);
    expect(back.body.rev).toBe(2);
    expect(app.db.prepare('SELECT is_deleted FROM projects WHERE id = ?').get('a')).toEqual({ is_deleted: 0 });
  });

  it('восстановление считается созданием: при заполненном лимите — 403', async () => {
    const { app, owner } = await setup();
    await putProject(app, owner.token, proj('a'));
    await call(app, 'DELETE', '/api/projects/a', undefined, { token: owner.token });
    for (const id of ['b', 'c', 'd']) await putProject(app, owner.token, proj(id));
    expect((await putProject(app, owner.token, proj('a'))).status).toBe(403);
  });
});
