// Облачные комнаты: гость по приглашению работает без автора, ответы проверяет сервер и не отдаёт их гостям,
// всё сохраняется в базу, автор потом видит результат.
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { addInvite, anon, call, closeApps, makeApp, proj, putProject, rectEl, setPlan, taskEl, type TestApp } from './helpers';

afterEach(closeApps);

type Msg = Record<string, any>;
interface Peer {
  ws: WebSocket;
  inbox: Msg[];
  closed: Promise<{ code: number; reason: string }>;
  last(t: string): Msg | undefined;
  send(m: unknown): void;
  /** Весь полученный текст — для проверки утечек. */
  text(): string;
}

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

async function until<T>(fn: () => T | undefined | null | false, ms = 3000): Promise<T> {
  const t0 = Date.now();
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error('условие не выполнилось за отведённое время');
    await new Promise(r => setTimeout(r, 5));
  }
}
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const peers: Peer[] = [];
afterEach(() => { for (const p of peers.splice(0)) p.ws.terminate(); });

/** Подключение к комнате: hello уходит сразу после открытия канала. */
function join(app: TestApp, projectId: string, hello: Msg | null, opts: { path?: string } = {}): Peer {
  const ws = new WebSocket(`${app.base.replace('http', 'ws')}${opts.path ?? `/ws/room/${encodeURIComponent(projectId)}`}`);
  const inbox: Msg[] = [];
  const raw: string[] = [];
  const closed = new Promise<{ code: number; reason: string }>(r => ws.on('close', (code, reason) => r({ code, reason: reason.toString() })));
  ws.on('message', d => { const t = d.toString(); raw.push(t); try { inbox.push(JSON.parse(t)); } catch { /* не JSON */ } });
  ws.on('open', () => { if (hello !== null) ws.send(JSON.stringify({ t: 'hello', proto: 1, ...hello })); });
  ws.on('error', () => {});
  const p: Peer = { ws, inbox, closed, last: t => [...inbox].reverse().find(m => m.t === t), send: m => ws.send(JSON.stringify(m)), text: () => raw.join('\n') };
  peers.push(p);
  return p;
}

const storedProject = (app: TestApp, id: string) => JSON.parse((app.db.prepare('SELECT data_json FROM projects WHERE id = ?').get(id) as { data_json: string }).data_json);
const row = (app: TestApp, id: string) => app.db.prepare('SELECT rev FROM projects WHERE id = ?').get(id) as { rev: number };

async function setup(plan = 'pro', over: Parameters<typeof makeApp>[0] = {}) {
  const app = await makeApp({ roomSaveMs: 20, roomIdleMs: 80, ...over });
  const owner = await anon(app);
  setPlan(app, owner.id, plan);
  const p = proj('a', {
    pages: [
      { id: 'a-p1', name: 'Первая', grid: 'square', elements: [taskEl(), rectEl('r1')] },
      { id: 'a-p2', name: 'Вторая', grid: 'square', elements: [rectEl('r2')] },
      { id: 'a-p3', name: 'Скрытая', grid: 'square', elements: [rectEl('secret')] },
    ],
  });
  await putProject(app, owner.token, p);
  addInvite(app, 'inv-edit', 'a', owner.id, { defaultRole: 'edit', pageRights: { 'a-p3': 'hidden' } });
  return { app, owner };
}

describe('комната без автора (pro)', () => {
  it('гость заходит по приглашению при отсутствующем авторе: проект без ответов, права из приглашения', async () => {
    const { app } = await setup();
    const g = join(app, 'a', { invite: 'inv-edit', name: 'Маша' });
    const init = await until(() => g.last('init'));
    expect(init).toMatchObject({ patches: true, name: 'Маша', allowCopy: true });
    expect(init.project.pages.map((p: any) => p.id)).toEqual(['a-p1', 'a-p2']); // скрытой страницы нет
    expect(init.project.pages[0].elements[0]).toMatchObject({ answer: '' });
    expect(init.project.pages[0].elements[0]).not.toHaveProperty('solutionMd');
    expect(init.rights.default).toBe('edit');
    expect(app.rooms.count()).toBe(1);
    expect(g.text()).not.toContain('"answer":"42"');
    expect(g.text()).not.toContain('СЕКРЕТНОЕ-РЕШЕНИЕ');
    // содержимое и название скрытой страницы не уходят; в таблице прав остаётся только её непрозрачный id
    for (const leak of ['Скрытая', 'secret']) expect(g.text()).not.toContain(leak);
  });

  it('ученик отвечает: проверяет сервер, гость получает результат без ответа, попытка сразу в базе', async () => {
    const { app } = await setup();
    const g = join(app, 'a', { invite: 'inv-edit' });
    await until(() => g.last('init'));
    g.send({ t: 'caps', patches: true });
    const before = row(app, 'a').rev;
    g.send({ t: 'task-submit', pageId: 'a-p1', elId: 't1', value: '41' });
    g.send({ t: 'task-submit', pageId: 'a-p1', elId: 't1', value: ' 42 ' });
    const patch = await until(() => g.inbox.filter(m => m.t === 'patch' && m.ops[0]?.el?.attempts?.length === 2).at(-1));
    expect(patch.ops[0].el.attempts.map((a: any) => a.isCorrect)).toEqual([false, true]);
    expect(patch.ops[0].el.answer).toBe('');
    // сервер держит настоящий ответ в памяти
    expect(app.rooms.projectOf('a')!.pages[0].elements[0]).toMatchObject({ answer: '42' });
    // запись — без ожидания паузы
    await until(() => row(app, 'a').rev > before);
    const stored = storedProject(app, 'a').pages[0].elements[0];
    expect(stored.attempts.map((a: any) => [a.value, a.isCorrect])).toEqual([['41', false], ['42', true]]);
    expect(stored.answer).toBe('42');
    expect(g.text()).not.toContain('"answer":"42"');
    expect(app.db.prepare("SELECT patch_json FROM project_revisions WHERE project_id = 'a' ORDER BY rev DESC LIMIT 1").get()).toMatchObject({ patch_json: expect.stringContaining('task-submit') });
  });

  it('правки гостя (патч, реакция, комментарий) сохраняются в базу с задержкой; черновик ввода в журнал не пишется', async () => {
    const { app } = await setup();
    const g = join(app, 'a', { invite: 'inv-edit', name: 'Гость' });
    await until(() => g.last('init'));
    g.send({ t: 'caps', patches: true });
    g.send({ t: 'patch', pageId: 'a-p2', rev: 1, ops: [{ op: 'put', el: rectEl('новый') }] });
    g.send({ t: 'react', pageId: 'a-p2', elId: 'r2', emoji: '👍', userId: 'u1' });
    g.send({ t: 'comment', pageId: 'a-p2', op: 'create', x: 5, y: 5, text: 'Вопрос' });
    await until(() => storedProject(app, 'a').pages[1].comments?.length === 1);
    const p2 = storedProject(app, 'a').pages[1];
    expect(p2.elements.map((e: any) => e.id)).toEqual(['r2', 'новый']);
    expect(p2.elements[0].reactions).toEqual({ '👍': ['u1'] });
    expect(p2.comments[0].messages[0]).toMatchObject({ text: 'Вопрос', authorName: 'Гость' });

    const journal = () => (app.db.prepare('SELECT COUNT(*) n FROM project_revisions WHERE project_id = ?').get('a') as { n: number }).n;
    const jBefore = journal();
    const rBefore = row(app, 'a').rev;
    g.send({ t: 'task-draft', pageId: 'a-p1', elId: 't1', draft: 'печатаю' });
    await until(() => row(app, 'a').rev > rBefore);
    expect(storedProject(app, 'a').pages[0].elements[0].studentDraft).toBe('печатаю');
    expect(journal()).toBe(jBefore);
  });

  it('частые правки записываются группами, а не по одной', async () => {
    const { app } = await setup('pro', { roomSaveMs: 60 });
    const g = join(app, 'a', { invite: 'inv-edit' });
    await until(() => g.last('init'));
    const before = row(app, 'a').rev;
    for (let i = 0; i < 12; i++) g.send({ t: 'patch', pageId: 'a-p2', rev: i, ops: [{ op: 'put', el: { ...rectEl('r2'), x: i } }] });
    await until(() => storedProject(app, 'a').pages[1].elements[0].x === 11);
    expect(row(app, 'a').rev - before).toBeLessThanOrEqual(3);
  });

  it('автор подключается к своей комнате позже: он host, видит настоящие ответы, попытки учеников и правки гостя', async () => {
    const { app, owner } = await setup();
    const g = join(app, 'a', { invite: 'inv-edit', name: 'Ученик' });
    await until(() => g.last('init'));
    g.send({ t: 'caps', patches: true });
    g.send({ t: 'patch', pageId: 'a-p2', rev: 1, ops: [{ op: 'put', el: rectEl('от-ученика') }] });
    g.send({ t: 'task-submit', pageId: 'a-p1', elId: 't1', value: '42' });
    await until(() => g.inbox.some(m => m.t === 'patch' && m.ops[0]?.el?.attempts));
    const h = join(app, 'a', { session: owner.token, name: 'Учитель' });
    const init = await until(() => h.last('init'));
    expect(init.userId).toBe(0);
    expect(init.name).toBe('Учитель');
    const task = init.project.pages[0].elements[0];
    expect(task).toMatchObject({ answer: '42', solutionMd: 'СЕКРЕТНОЕ-РЕШЕНИЕ' });
    expect(task.attempts).toHaveLength(1);
    expect(init.project.pages.map((p: any) => p.id)).toContain('a-p3'); // автору видны все страницы
    expect(init.project.pages[1].elements.map((e: any) => e.id)).toContain('от-ученика');
    expect(init.users.map((u: any) => [u.name, u.host])).toEqual(expect.arrayContaining([['Учитель', true], ['Ученик', false]]));
    // ученик видит автора в списке
    await until(() => g.last('users')?.users.some((u: any) => u.host));
  });

  it('комната выгружается после ухода всех и поднимается из базы: автор видит холст и попытку ученика', async () => {
    const { app, owner } = await setup();
    const g = join(app, 'a', { invite: 'inv-edit' });
    await until(() => g.last('init'));
    g.send({ t: 'caps', patches: true });
    g.send({ t: 'patch', pageId: 'a-p2', rev: 1, ops: [{ op: 'put', el: rectEl('нарисовал') }] });
    g.send({ t: 'task-submit', pageId: 'a-p1', elId: 't1', value: '42' });
    await until(() => g.inbox.some(m => m.t === 'patch' && m.ops[0]?.el?.attempts));
    g.ws.close();
    await g.closed;
    await until(() => app.rooms.count() === 0); // roomIdleMs
    const h = join(app, 'a', { session: owner.token });
    const init = await until(() => h.last('init'));
    expect(init.project.pages[0].elements[0].attempts[0]).toMatchObject({ value: '42', isCorrect: true });
    expect(init.project.pages[1].elements.map((e: any) => e.id)).toContain('нарисовал');
    // и через REST то же самое
    const rest = await call(app, 'GET', '/api/projects/a', undefined, { token: owner.token });
    expect(rest.body.project.pages[0].elements[0].attempts).toHaveLength(1);
  });

  it('повторное подключение до выгрузки возвращается в ту же комнату', async () => {
    const { app } = await setup();
    const g1 = join(app, 'a', { invite: 'inv-edit' });
    await until(() => g1.last('init'));
    g1.send({ t: 'patch', pageId: 'a-p2', rev: 1, ops: [{ op: 'put', el: rectEl('в-памяти') }] });
    await until(() => app.rooms.projectOf('a')!.pages[1].elements.length === 2);
    g1.ws.close();
    await g1.closed;
    const g2 = join(app, 'a', { invite: 'inv-edit' });
    const init = await until(() => g2.last('init'));
    expect(init.project.pages[1].elements.map((e: any) => e.id)).toEqual(['r2', 'в-памяти']);
  });
});

describe('права по приглашению', () => {
  it('роль «только просмотр»: патчи отклоняются, ответ ученика, реакции и комментарии разрешены', async () => {
    const { app, owner } = await setup();
    addInvite(app, 'inv-view', 'a', owner.id, { defaultRole: 'view' });
    app.db.prepare("UPDATE invites SET revoked = 1 WHERE token = 'inv-edit'").run();
    const g = join(app, 'a', { invite: 'inv-view' });
    const init = await until(() => g.last('init'));
    expect(init.rights.default).toBe('view');
    expect(init.rights.pages['a-p1']).toBe('view');
    g.send({ t: 'caps', patches: true });
    g.send({ t: 'patch', pageId: 'a-p2', rev: 1, ops: [{ op: 'put', el: rectEl('нельзя') }] });
    g.send({ t: 'task-submit', pageId: 'a-p1', elId: 't1', value: '42' });
    g.send({ t: 'react', pageId: 'a-p2', elId: 'r2', emoji: '❤️' });
    await until(() => storedProject(app, 'a').pages[1].elements[0].reactions);
    expect(storedProject(app, 'a').pages[1].elements.map((e: any) => e.id)).toEqual(['r2']);
    expect(storedProject(app, 'a').pages[0].elements[0].attempts).toHaveLength(1);
  });

  it('права на страницы: редактировать можно только разрешённую', async () => {
    const { app, owner } = await setup();
    app.db.prepare("UPDATE invites SET default_role = 'view', page_rights_json = ? WHERE token = 'inv-edit'").run(JSON.stringify({ 'a-p2': 'edit' }));
    const g = join(app, 'a', { invite: 'inv-edit' });
    await until(() => g.last('init'));
    g.send({ t: 'patch', pageId: 'a-p1', rev: 1, ops: [{ op: 'put', el: rectEl('на-первой') }] });
    g.send({ t: 'patch', pageId: 'a-p2', rev: 1, ops: [{ op: 'put', el: rectEl('на-второй') }] });
    await until(() => storedProject(app, 'a').pages[1].elements.length === 2);
    expect(storedProject(app, 'a').pages[0].elements.map((e: any) => e.id)).toEqual(['t1', 'r1']);
    expect(owner.id).toBeTruthy();
  });

  it('гость не подменяет ответ задания и условие: правка принимает только ввод ученика', async () => {
    const { app } = await setup();
    const g = join(app, 'a', { invite: 'inv-edit' });
    await until(() => g.last('init'));
    g.send({ t: 'patch', pageId: 'a-p1', rev: 1, ops: [{ op: 'put', el: taskEl({ answer: 'ВЗЛОМ', statementMd: 'Подмена', studentDraft: 'ввод' }) }] });
    await until(() => storedProject(app, 'a').pages[0].elements[0].studentDraft === 'ввод');
    expect(storedProject(app, 'a').pages[0].elements[0]).toMatchObject({ answer: '42', statementMd: 'Сколько будет 6×7?' });
  });

  it('гость не меняет проект целиком и тариф: чужое id, имя и права игнорируются', async () => {
    const { app } = await setup();
    const g = join(app, 'a', { invite: 'inv-edit' });
    const init = await until(() => g.last('init'));
    g.send({ t: 'project', project: { ...init.project, id: 'чужой', name: 'Взлом', ownerPlan: 'free', permissions: { forbidClone: false } } });
    await sleep(120);
    const stored = storedProject(app, 'a');
    expect(stored.id).toBe('a');
    expect(stored.name).toBe('Проект a');
    expect(stored.ownerPlan).toBe('pro');
  });
});

describe('вход и отказы', () => {
  it('неверное, отозванное, чужое и просроченное приглашения - закрытие 4403', async () => {
    const { app, owner } = await setup();
    await putProject(app, owner.token, proj('b'));
    addInvite(app, 'inv-rev', 'a', owner.id, { revoked: 1 });
    addInvite(app, 'inv-b', 'b', owner.id);
    addInvite(app, 'inv-old', 'a', owner.id, { expiresAt: app.clock.t - 1 });
    for (const invite of ['нет-такого', 'inv-rev', 'inv-b', 'inv-old', undefined]) {
      const g = join(app, 'a', { invite });
      expect((await g.closed).code, String(invite)).toBe(4403);
      expect(g.last('init')).toBeUndefined();
    }
    expect(app.rooms.count()).toBe(0);
  });

  it('вошедший не-владелец без приглашения не получает прав автора', async () => {
    const { app } = await setup();
    const stranger = await anon(app);
    const g = join(app, 'a', { session: stranger.token });
    expect((await g.closed).code).toBe(4403);
    const fake = join(app, 'a', { session: 'x.y.z' });
    expect((await fake.closed).code).toBe(4403);
  });

  it('неизвестный и удалённый проект - 4404; версия протокола, первое сообщение - свои коды', async () => {
    const { app, owner } = await setup();
    expect((await join(app, 'нет', { invite: 'inv-edit' }).closed).code).toBe(4404);
    expect((await join(app, 'a', { invite: 'inv-edit', proto: 99 }).closed).code).toBe(4426);
    const bad = new WebSocket(`${app.base.replace('http', 'ws')}/ws/room/a`);
    peers.push({ ws: bad } as Peer);
    bad.on('open', () => bad.send('не json'));
    expect(await new Promise<number>(r => bad.on('close', c => r(c)))).toBe(4400);
    const notHello = join(app, 'a', null);
    notHello.ws.on('open', () => notHello.send({ t: 'cursor', x: 1, y: 1 }));
    expect((await notHello.closed).code).toBe(4400);
    await call(app, 'DELETE', '/api/projects/a', undefined, { token: owner.token });
    expect((await join(app, 'a', { invite: 'inv-edit' }).closed).code).toBe(4404);
  });

  it('обычный путь без комнаты и чужой путь WebSocket закрываются', async () => {
    const { app } = await setup();
    const ws = new WebSocket(`${app.base.replace('http', 'ws')}/ws/другое`);
    const r = await new Promise<string>(res => { ws.on('error', e => res(String(e.message))); ws.on('close', () => res('closed')); });
    expect(r).toBeTruthy();
  });

  it('автор с двух своих устройств: оба в комнате и получают правки друг друга (SPEC_NIGHT5 §2.3)', async () => {
    const { app, owner } = await setup();
    const laptop = join(app, 'a', { session: owner.token });
    await until(() => laptop.last('init'));
    const tablet = join(app, 'a', { session: owner.token });
    const init2 = await until(() => tablet.last('init'));
    expect(init2.userId).not.toBe(laptop.last('init')!.userId);
    laptop.send({ t: 'caps', patches: true });
    tablet.send({ t: 'caps', patches: true });
    laptop.send({ t: 'patch', pageId: 'a-p2', rev: 1, ops: [{ op: 'put', el: rectEl('с-ноутбука') }] });
    await until(() => tablet.inbox.some(m => (m.t === 'patch' && m.ops.some((o: any) => o.el?.id === 'с-ноутбука'))
      || (m.t === 'project' && JSON.stringify(m.project).includes('с-ноутбука'))));
    tablet.send({ t: 'patch', pageId: 'a-p3', rev: 1, ops: [{ op: 'put', el: rectEl('с-планшета') }] });
    await until(() => laptop.inbox.some(m => (m.t === 'patch' && m.ops.some((o: any) => o.el?.id === 'с-планшета'))
      || (m.t === 'project' && JSON.stringify(m.project).includes('с-планшета'))));
    expect(laptop.ws.readyState).toBe(1);
    expect(tablet.ws.readyState).toBe(1);
    // оба — авторы: скрытая для гостей страница им видна
    expect(init2.project.pages.map((p: any) => p.id)).toContain('a-p3');
    await until(() => JSON.stringify(storedProject(app, 'a')).includes('с-планшета'));
  });

  it('отзыв приглашения отключает его гостей (4403), удаление проекта закрывает комнату (4410)', async () => {
    const { app, owner } = await setup();
    const g1 = join(app, 'a', { invite: 'inv-edit' });
    const h = join(app, 'a', { session: owner.token });
    await until(() => g1.last('init') && h.last('init'));
    expect((await call(app, 'DELETE', '/api/invites/inv-edit', undefined, { token: owner.token })).status).toBe(200);
    expect((await g1.closed).code).toBe(4403);
    expect(h.ws.readyState).toBe(1); // автор остаётся
    await call(app, 'DELETE', '/api/projects/a', undefined, { token: owner.token });
    expect((await h.closed).code).toBe(4410);
    expect(app.rooms.count()).toBe(0);
  });
});

describe('живые права ссылки (SPEC_NIGHT5 §3.2)', () => {
  it('смена роли и копирования у ссылки сразу доходит до подключённого гостя', async () => {
    const { app, owner } = await setup();
    const res = await call(app, 'POST', '/api/invites', { projectId: 'a', defaultRole: 'edit' }, { token: owner.token });
    const token = res.body.token as string;
    const g = join(app, 'a', { invite: token });
    const init = await until(() => g.last('init'));
    expect(init.rights.default).toBe('edit');
    const before = g.inbox.length;
    const upd = await call(app, 'POST', '/api/invites', { projectId: 'a', defaultRole: 'view', allowCopy: false }, { token: owner.token });
    expect(upd.body).toMatchObject({ created: false, token });
    const rights = await until(() => g.inbox.slice(before).reverse().find(m => m.t === 'rights'));
    expect(rights.rights.default).toBe('view');
    expect(Object.values(rights.rights.pages).every(r => r === 'view')).toBe(true);
    expect(rights.allowCopy).toBe(false);
    // правка гостя теперь не принимается
    g.send({ t: 'patch', pageId: 'a-p1', rev: 1, ops: [{ op: 'put', el: rectEl('после-смены') }] });
    await sleep(80);
    expect(JSON.stringify(app.rooms.projectOf('a'))).not.toContain('после-смены');
  });
});

describe('бесплатный тариф', () => {
  it('без автора гость не входит (4503, «автор не в сети»), комната в памяти не остаётся', async () => {
    const { app } = await setup('free');
    const g = join(app, 'a', { invite: 'inv-edit' });
    const closed = await g.closed;
    expect(closed.code).toBe(4503);
    expect(g.last('denied')).toMatchObject({ reason: 'host-offline' });
    expect(g.last('init')).toBeUndefined();
    expect(app.rooms.count()).toBe(0);
  });

  it('с автором - один гость; второй получает отказ (4402); автор ушёл - гость отключён (4503), всё сохранено', async () => {
    const { app, owner } = await setup('free');
    const h = join(app, 'a', { session: owner.token });
    await until(() => h.last('init'));
    h.send({ t: 'caps', patches: true });
    const g1 = join(app, 'a', { invite: 'inv-edit' });
    await until(() => g1.last('init'));
    g1.send({ t: 'task-submit', pageId: 'a-p1', elId: 't1', value: '42' });
    const g2 = join(app, 'a', { invite: 'inv-edit' });
    expect((await g2.closed).code).toBe(4402);
    expect(g2.last('denied')).toMatchObject({ reason: 'free-limit-reached' });
    await until(() => h.inbox.some(m => m.t === 'patch' && m.ops[0]?.el?.attempts));
    h.ws.close();
    expect((await g1.closed).code).toBe(4503);
    await until(() => storedProject(app, 'a').pages[0].elements[0].attempts?.length === 1);
    // автор вернулся: комната снова работает
    const h2 = join(app, 'a', { session: owner.token });
    expect((await until(() => h2.last('init'))).project.pages[0].elements[0].attempts).toHaveLength(1);
  });

  it('free: устройства автора не занимают гостевой слот; гость остаётся, пока подключено хотя бы одно устройство автора', async () => {
    const { app, owner } = await setup('free');
    const laptop = join(app, 'a', { session: owner.token });
    await until(() => laptop.last('init'));
    const tablet = join(app, 'a', { session: owner.token });
    await until(() => tablet.last('init'));
    const g = join(app, 'a', { invite: 'inv-edit' });
    await until(() => g.last('init'));
    laptop.ws.close();
    await sleep(80);
    expect(g.ws.readyState).toBe(1);
    tablet.ws.close();
    expect((await g.closed).code).toBe(4503);
  });

  it('пока лимиты на сервере выключены, free ведёт себя как pro: комната без автора и без лимита гостей', async () => {
    const { app } = await setup('free', { enforceLimits: false });
    const g1 = join(app, 'a', { invite: 'inv-edit' });
    const g2 = join(app, 'a', { invite: 'inv-edit' });
    await until(() => g1.last('init') && g2.last('init'));
    expect(app.rooms.connections('a')).toBe(2);
  });

  it('понижение тарифа с истёкшим сроком: комната уже free', async () => {
    const { app, owner } = await setup('pro');
    setPlan(app, owner.id, 'pro', app.clock.t - 1);
    const g = join(app, 'a', { invite: 'inv-edit' });
    expect((await g.closed).code).toBe(4503);
  });
});

describe('картинки, REST и закрытие сервера', () => {
  it('картинка из патча уходит в хранилище: гости и база получают ссылку asset://, а не base64', async () => {
    const { app, owner } = await setup();
    const g = join(app, 'a', { invite: 'inv-edit' });
    const h = join(app, 'a', { session: owner.token });
    await until(() => g.last('init') && h.last('init'));
    h.send({ t: 'caps', patches: true });
    g.send({ t: 'patch', pageId: 'a-p2', rev: 1, ops: [{ op: 'put', el: { id: 'img', type: 'image', x: 0, y: 0, w: 5, h: 5, src: PNG } }] });
    const patch = await until(() => h.inbox.find(m => m.t === 'patch' && m.ops[0]?.el?.id === 'img'));
    expect(patch.ops[0].el.src).toMatch(/^asset:\/\/[0-9a-f]{64}$/);
    expect(h.text()).not.toContain('base64');
    await until(() => JSON.stringify(storedProject(app, 'a')).includes('asset://'));
    expect(JSON.stringify(storedProject(app, 'a'))).not.toContain('base64');
    expect((await call(app, 'GET', `/api/assets/${patch.ops[0].el.src.slice(8)}?format=dataUrl`)).body).toBe(PNG);
  });

  it('правка автора через REST доходит до комнаты, а ответы учеников при этом не теряются', async () => {
    const { app, owner } = await setup();
    const g = join(app, 'a', { invite: 'inv-edit' });
    await until(() => g.last('init'));
    g.send({ t: 'caps', patches: true });
    g.send({ t: 'task-submit', pageId: 'a-p1', elId: 't1', value: '42' });
    await until(() => row(app, 'a').rev > 1);
    const mine = proj('a', { name: 'Переименовано автором' });
    mine.pages = mine.pages.map((p: any) => p);
    const r = await putProject(app, owner.token, mine, 1); // версия автора устарела
    expect(r.status).toBe(200);
    const pushed = await until(() => g.inbox.filter(m => m.t === 'project').at(-1));
    expect(pushed.project.name).toBe('Переименовано автором');
    expect(pushed.project.pages[0].elements[0].attempts).toHaveLength(1);
    expect(pushed.project.pages[0].elements[0].answer).toBe(''); // гостю по-прежнему без ответа
    expect(app.rooms.projectOf('a')!.name).toBe('Переименовано автором');
    expect(app.rooms.projectOf('a')!.pages[0].elements[0]).toMatchObject({ answer: '42' });
  });

  it('закрытие сервера записывает несохранённое состояние комнат', async () => {
    const { app } = await setup('pro', { roomSaveMs: 60_000 });
    const g = join(app, 'a', { invite: 'inv-edit' });
    await until(() => g.last('init'));
    g.send({ t: 'patch', pageId: 'a-p2', rev: 1, ops: [{ op: 'put', el: rectEl('до-закрытия') }] });
    await until(() => app.rooms.projectOf('a')!.pages[1].elements.length === 2);
    expect(storedProject(app, 'a').pages[1].elements).toHaveLength(1); // пока не записано
    const data = app.db;
    app.rooms.flush('a');
    expect(JSON.parse((data.prepare('SELECT data_json FROM projects WHERE id = ?').get('a') as { data_json: string }).data_json).pages[1].elements).toHaveLength(2);
  });
});

describe('персональные курсоры в облачной комнате (Ночь №4)', () => {
  const cursorOf = (p: Peer, name: string) => p.last('users')?.users.find((u: Msg) => u.name === name)?.cursorId;

  it('Pro-курсор - только при тарифе pro/tutor по сессии; без сессии и на free - классический', async () => {
    const { app, owner } = await setup();
    const host = join(app, 'a', { session: owner.token, name: 'Автор', cursorId: 'neon' });
    await until(() => host.last('init'));
    await until(() => cursorOf(host, 'Автор') === 'neon');
    // гость без сессии
    const g1 = join(app, 'a', { invite: 'inv-edit', name: 'Маша', cursorId: 'gold' });
    await until(() => g1.last('init'));
    await until(() => cursorOf(host, 'Маша') === 'default');
    // гость с сессией на free и с сессией на pro
    const free = await anon(app);
    const g2 = join(app, 'a', { invite: 'inv-edit', session: free.token, name: 'Петя', cursorId: 'flame' });
    await until(() => g2.last('init'));
    await until(() => cursorOf(host, 'Петя') === 'default');
    const paid = await anon(app);
    setPlan(app, paid.id, 'tutor');
    const g3 = join(app, 'a', { invite: 'inv-edit', session: paid.token, name: 'Оля', cursorId: 'flame' });
    await until(() => g3.last('init'));
    await until(() => cursorOf(host, 'Оля') === 'flame');
    // бесплатный курсор — всем; смена на лету тоже проверяет тариф
    g1.send({ t: 'profile', cursorId: 'mint' });
    await until(() => cursorOf(host, 'Маша') === 'mint');
    g1.send({ t: 'profile', cursorId: 'aurora' }); // Pro без права — классический, как при входе
    await until(() => cursorOf(host, 'Маша') === 'default');
  });
});
