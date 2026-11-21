// Ссылки совместной работы: создание, обновление, отзыв, открытие по токену (/api/invites, /j/:token).
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseBoardUrl } from '../../src/board-url';
import { anon, call, closeApps, makeApp, proj, putProject, rectEl, setPlan, taskEl } from './helpers';

afterEach(closeApps);

async function setup(plan?: string) {
  const app = await makeApp();
  const owner = await anon(app);
  if (plan) setPlan(app, owner.id, plan);
  const p = proj('a', {
    pages: [
      { id: 'a-p1', name: 'Первая', grid: 'square', elements: [taskEl({ attempts: [{ value: '1', timestamp: 1, isCorrect: false }] }), rectEl('r1')] },
      { id: 'a-p2', name: 'Вторая', grid: 'square', elements: [rectEl('r2')] },
      { id: 'a-p3', name: 'Скрытая', grid: 'square', elements: [{ id: 'sec', type: 'text', x: 0, y: 0, text: 'СКРЫТЫЙ-ТЕКСТ', size: 20, color: '#000000' }] },
    ],
  });
  await putProject(app, owner.token, p);
  return { app, owner };
}

describe('создание приглашения', () => {
  it('новый токен: 201, ссылка нужного вида, комната cloud:<проект>, запись в базе', async () => {
    const { app, owner } = await setup('pro');
    const r = await call(app, 'POST', '/api/invites', { projectId: 'a' }, { token: owner.token });
    expect(r.status).toBe(201);
    expect(r.body.token).toMatch(/^[A-Za-z0-9_-]{24}$/);
    expect(r.body).toMatchObject({ projectId: 'a', defaultRole: 'edit', allowCopy: true, pageRights: {}, roomCode: 'cloud:a', created: true });
    expect(r.body.url).toBe(`https://abax.example/?route=collab&token=${r.body.token}`);
    expect(parseBoardUrl(r.body.url)).toEqual({ mode: 'collab', token: r.body.token });
    expect(app.db.prepare('SELECT project_id, created_by, default_role, allow_copy, revoked FROM invites WHERE token = ?').get(r.body.token))
      .toEqual({ project_id: 'a', created_by: owner.id, default_role: 'edit', allow_copy: 1, revoked: 0 });
  });

  it('повторный POST обновляет права того же токена; GET /api/invites возвращает действующее приглашение', async () => {
    const { app, owner } = await setup('pro');
    expect((await call(app, 'GET', '/api/invites?projectId=a', undefined, { token: owner.token })).body).toEqual({ invite: null });
    const first = await call(app, 'POST', '/api/invites', { projectId: 'a' }, { token: owner.token });
    const upd = await call(app, 'POST', '/api/invites', { projectId: 'a', defaultRole: 'view', allowCopy: false, pageRights: { 'a-p2': 'edit', 'a-p3': 'hidden', x: 'мусор' } }, { token: owner.token });
    expect(upd.status).toBe(200);
    expect(upd.body).toMatchObject({ token: first.body.token, defaultRole: 'view', allowCopy: false, pageRights: { 'a-p2': 'edit', 'a-p3': 'hidden' }, created: false });
    expect(app.db.prepare('SELECT COUNT(*) n FROM invites').get()).toEqual({ n: 1 });
    const cur = await call(app, 'GET', '/api/invites?projectId=a', undefined, { token: owner.token });
    expect(cur.body.invite).toMatchObject({ token: first.body.token, defaultRole: 'view', allowCopy: false });
    // роль по умолчанию сохраняется, если её не передали
    const keep = await call(app, 'POST', '/api/invites', { projectId: 'a', pageRights: {} }, { token: owner.token });
    expect(keep.body.defaultRole).toBe('view');
  });

  it('на free запрет копирования недоступен - права проходят поправку на тариф владельца', async () => {
    const { app, owner } = await setup();
    const r = await call(app, 'POST', '/api/invites', { projectId: 'a', allowCopy: false }, { token: owner.token });
    expect(r.body.allowCopy).toBe(true);
    expect(app.db.prepare('SELECT allow_copy FROM invites').get()).toEqual({ allow_copy: 1 });
  });

  it('после отзыва следующий POST выдаёт новый токен', async () => {
    const { app, owner } = await setup('pro');
    const first = await call(app, 'POST', '/api/invites', { projectId: 'a' }, { token: owner.token });
    await call(app, 'DELETE', `/api/invites/${first.body.token}`, undefined, { token: owner.token });
    const second = await call(app, 'POST', '/api/invites', { projectId: 'a' }, { token: owner.token });
    expect(second.status).toBe(201);
    expect(second.body.token).not.toBe(first.body.token);
  });

  it('только владелец своего живого проекта; плохие параметры - 400', async () => {
    const { app, owner } = await setup('pro');
    const other = await anon(app);
    expect((await call(app, 'POST', '/api/invites', { projectId: 'a' })).status).toBe(401);
    expect((await call(app, 'POST', '/api/invites', { projectId: 'a' }, { token: other.token })).status).toBe(404);
    expect((await call(app, 'POST', '/api/invites', { projectId: 'нет' }, { token: owner.token })).status).toBe(404);
    expect((await call(app, 'POST', '/api/invites', {}, { token: owner.token })).status).toBe(400);
    expect((await call(app, 'POST', '/api/invites', { projectId: 'a', defaultRole: 'admin' }, { token: owner.token })).body.error).toBe('bad-role');
    expect((await call(app, 'POST', '/api/invites', { projectId: 'a', pageRights: [] }, { token: owner.token })).status).toBe(400);
    expect((await call(app, 'GET', '/api/invites?projectId=a', undefined, { token: other.token })).status).toBe(404);
    await call(app, 'DELETE', '/api/projects/a', undefined, { token: owner.token });
    expect((await call(app, 'POST', '/api/invites', { projectId: 'a' }, { token: owner.token })).status).toBe(404);
  });
});

describe('открытие по токену', () => {
  async function invited(spec: Record<string, unknown> = {}) {
    const s = await setup('pro');
    const inv = await call(s.app, 'POST', '/api/invites', { projectId: 'a', ...spec }, { token: s.owner.token });
    return { ...s, token: inv.body.token as string };
  }

  it('гость без входа получает проект без ответов и скрытых страниц и права приглашения', async () => {
    const { app, token } = await invited({ defaultRole: 'view', pageRights: { 'a-p1': 'edit', 'a-p3': 'hidden' } });
    const r = await call(app, 'GET', `/api/invites/${token}`);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      token, projectId: 'a', ownerPlan: 'pro', role: 'view', isOwner: false, allowCopy: true, roomCode: 'cloud:a',
      pageRights: { 'a-p1': 'edit', 'a-p2': 'view' },
    });
    expect(r.body.project.pages.map((p: any) => p.id)).toEqual(['a-p1', 'a-p2']);
    expect(r.body.project.pages[0].elements[0]).toMatchObject({ answer: '' });
    expect(r.body.project.pages[0].elements[0]).not.toHaveProperty('solutionMd');
    const text = JSON.stringify(r.body);
    expect(text).not.toContain('"answer":"42"');
    expect(text).not.toContain('СЕКРЕТНОЕ-РЕШЕНИЕ');
    expect(text).not.toContain('СКРЫТЫЙ-ТЕКСТ');
    expect(text).not.toContain('a-p3');
  });

  it('allowCopy приглашения учитывается вместе с проектом', async () => {
    const { app, token } = await invited({ allowCopy: false });
    const r = await call(app, 'GET', `/api/invites/${token}`);
    expect(r.body.allowCopy).toBe(false);
    expect(r.body.project.permissions.allowCopy).toBe(false);
  });

  it('владелец, открывший свою ссылку, получает проект целиком', async () => {
    const { app, owner, token } = await invited({ pageRights: { 'a-p3': 'hidden' } });
    const r = await call(app, 'GET', `/api/invites/${token}`, undefined, { token: owner.token });
    expect(r.body.isOwner).toBe(true);
    expect(r.body.project.pages).toHaveLength(3);
    expect(r.body.project.pages[0].elements[0].answer).toBe('42');
  });

  it('GET /j/:token с Accept: application/json - тот же ответ', async () => {
    const { app, token } = await invited();
    const viaApi = await call(app, 'GET', `/api/invites/${token}`);
    const viaJ = await call(app, 'GET', `/j/${token}`, undefined, { headers: { Accept: 'application/json' } });
    expect(viaJ.status).toBe(200);
    expect(viaJ.body).toEqual(viaApi.body);
    expect((await call(app, 'GET', '/j/нет', undefined, { headers: { Accept: 'application/json' } })).status).toBe(404);
  });

  it('отозванное, просроченное, неизвестное и приглашение удалённого проекта - 404 invite-not-found', async () => {
    const { app, owner, token } = await invited();
    const exp = await call(app, 'POST', '/api/projects/a/clone', undefined, { token: owner.token });
    await putProject(app, owner.token, proj('b'));
    app.db.prepare("INSERT INTO invites (token, project_id, created_by, expires_at, created_at) VALUES ('old', 'b', ?, ?, 1)").run(owner.id, app.clock.t - 1);
    expect(exp.status).toBe(201);
    for (const t of ['old', 'неизвестный']) {
      const r = await call(app, 'GET', `/api/invites/${t}`);
      expect(r.status, t).toBe(404);
      expect(r.body.error).toBe('invite-not-found');
    }
    expect((await call(app, 'DELETE', `/api/invites/${token}`, undefined, { token: owner.token })).status).toBe(200);
    expect((await call(app, 'GET', `/api/invites/${token}`)).status).toBe(404);
    const again = await call(app, 'POST', '/api/invites', { projectId: 'a' }, { token: owner.token });
    await call(app, 'DELETE', '/api/projects/a', undefined, { token: owner.token });
    expect((await call(app, 'GET', `/api/invites/${again.body.token}`)).status).toBe(404);
  });

  it('права приглашения действуют и на патчи: после отзыва гость больше ничего не правит', async () => {
    const { app, owner, token } = await invited({ pageRights: { 'a-p2': 'edit' }, defaultRole: 'view' });
    const patch = { t: 'patch', pageId: 'a-p2', rev: 0, ops: [{ op: 'put', el: rectEl('g') }] };
    expect((await call(app, 'POST', `/api/projects/a/patch?invite=${token}`, patch)).status).toBe(200);
    await call(app, 'DELETE', `/api/invites/${token}`, undefined, { token: owner.token });
    expect((await call(app, 'POST', `/api/projects/a/patch?invite=${token}`, patch)).status).toBe(403);
  });
});

describe('отзыв приглашения', () => {
  it('только владелец проекта; подписчики получают событие', async () => {
    const { app, owner } = await setup('pro');
    const inv = await call(app, 'POST', '/api/invites', { projectId: 'a' }, { token: owner.token });
    const other = await anon(app);
    const events: unknown[] = [];
    app.app.onAccessChanged(e => events.push(e));
    expect((await call(app, 'DELETE', `/api/invites/${inv.body.token}`)).status).toBe(401);
    expect((await call(app, 'DELETE', `/api/invites/${inv.body.token}`, undefined, { token: other.token })).status).toBe(404);
    expect(events).toEqual([]);
    expect((await call(app, 'DELETE', `/api/invites/${inv.body.token}`, undefined, { token: owner.token })).body).toEqual({ ok: true });
    expect(events).toEqual([{ projectId: 'a', kind: 'invite-revoked', token: inv.body.token }]);
    expect(app.db.prepare('SELECT revoked FROM invites').get()).toEqual({ revoked: 1 });
  });

  it('удаление проекта тоже сообщается подписчикам', async () => {
    const { app, owner } = await setup('pro');
    const events: unknown[] = [];
    app.app.onAccessChanged(e => events.push(e));
    await call(app, 'DELETE', '/api/projects/a', undefined, { token: owner.token });
    expect(events).toEqual([{ projectId: 'a', kind: 'deleted' }]);
  });
});

describe('раздача клиента тем же сервером', () => {
  it('файлы из staticDir отдаются, выход за каталог и неизвестное - 404', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'abax-static-'));
    try {
      mkdirSync(join(dir, 'assets'));
      writeFileSync(join(dir, 'index.html'), '<!doctype html><title>Abax</title>');
      writeFileSync(join(dir, 'assets', 'app.js'), 'console.log(1)');
      writeFileSync(join(dir, '..', 'abax-secret.txt'), 'секрет');
      const app = await makeApp({ staticDir: dir });
      const root = await fetch(`${app.base}/`);
      expect(root.status).toBe(200);
      expect(root.headers.get('content-type')).toBe('text/html; charset=utf-8');
      expect(await root.text()).toContain('<title>Abax</title>');
      const js = await fetch(`${app.base}/assets/app.js`);
      expect(js.headers.get('content-type')).toBe('text/javascript; charset=utf-8');
      expect(js.headers.get('cache-control')).toContain('max-age');
      for (const path of ['/нет.html', '/..%2fabax-secret.txt', '/%2e%2e/abax-secret.txt', '/assets/%00']) {
        const r = await fetch(`${app.base}${path}`);
        expect(r.status, path).toBe(404);
        expect(await r.text()).not.toContain('секрет');
      }
      expect((await fetch(`${app.base}/api/нет`)).status).toBe(404);
      expect((await fetch(`${app.base}/`, { method: 'POST' })).status).toBe(404);
    } finally { rmSync(join(dir, '..', 'abax-secret.txt'), { force: true }); rmSync(dir, { recursive: true, force: true }); }
  });
});
