// Просмотр по ссылке, приглашение и клонирование через настоящий сервер (в памяти): чужой проект с пустого localStorage.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SESSION_KEY, createApiClient, setApiForTests } from '../../src/api-client';
import { cloneViewedProject, enterInvite, enterLinkView, exitLinkView } from '../../src/link-view-ui';
import { openProject, state, blankProject } from '../../src/state';
import { storage } from '../../src/storage';
import { getSyncedRev } from '../../src/sync-state';
import { anon, call, closeApps, makeApp, proj, putProject, rectEl, setPlan, taskEl } from '../server/helpers';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const image = { id: 'img', type: 'image', x: 0, y: 0, w: 50, h: 50, src: PNG };

const toast = () => document.getElementById('toast')?.textContent ?? '';
const notice = () => document.getElementById('collab-notice')?.textContent ?? '';

async function server(plan = 'pro') {
  const app = await makeApp();
  const owner = await anon(app);
  setPlan(app, owner.id, plan);
  const p = proj('a', {
    pages: [
      { id: 'a-p1', name: 'Первая', grid: 'square', elements: [taskEl(), rectEl('r1'), image] },
      { id: 'a-p2', name: 'Вторая', grid: 'square', elements: [rectEl('r2')] },
      { id: 'a-p3', name: 'Скрытая', grid: 'square', elements: [rectEl('secret')] },
    ],
    permissions: { pageRights: { 'a-p3': 'hidden' } },
  });
  expect((await putProject(app, owner.token, p)).status).toBe(200);
  setApiForTests(createApiClient({ base: app.base }));
  return { app, owner };
}

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '<div id="canvas-wrap"><canvas id="board"></canvas></div>';
  openProject(blankProject('Свой'));
  state.projects = [];
});
afterEach(async () => {
  exitLinkView();
  state.linkMode = null;
  setApiForTests(undefined);
  await closeApps();
});

describe('просмотр чужого проекта по ссылке', () => {
  it('с пустого localStorage: проект и картинка приходят с сервера, ответ задания пуст, скрытой страницы нет', async () => {
    await server();
    await enterLinkView({ mode: 'view-project', projectId: 'a' });
    expect(state.linkMode).toBe('view-project');
    expect(state.project.id).toBe('a');
    expect(state.project.pages.map(p => p.id)).toEqual(['a-p1', 'a-p2']);
    const els = state.project.pages[0].elements;
    expect(els.find(e => e.id === 'img')).toMatchObject({ src: PNG });
    expect(els.find(e => e.type === 'task')).toMatchObject({ answer: '' });
    expect(JSON.stringify(state.project)).not.toContain('СЕКРЕТНОЕ-РЕШЕНИЕ');
    expect(document.querySelector('#link-banner .lb-clone')).not.toBeNull();
    expect(await storage.list()).toEqual([]); // ничего не сохранено на устройстве зрителя
  });

  it('ссылка на страницу: только она и без кнопки клонирования', async () => {
    await server();
    await enterLinkView({ mode: 'view-page', projectId: 'a', pageId: 'a-p2' });
    expect(state.linkMode).toBe('view-page');
    expect(state.project.pages.map(p => p.id)).toEqual(['a-p2']);
    expect(document.querySelector('#link-banner .lb-clone')).toBeNull();
  });

  it('страницы нет или она скрыта - первая видимая и сообщение', async () => {
    await server();
    for (const pageId of ['нет', 'a-p3']) {
      await enterLinkView({ mode: 'view-page', projectId: 'a', pageId });
      expect(state.project.pages.map(p => p.id)).toEqual(['a-p1']);
      expect(toast()).toBe('Страница не найдена');
    }
  });

  it('запрет клонирования у автора: кнопки нет', async () => {
    const { app, owner } = await server();
    const p = (await call(app, 'GET', '/api/projects/a', undefined, { token: owner.token })).body.project;
    await putProject(app, owner.token, { ...p, permissions: { forbidClone: true } });
    await enterLinkView({ mode: 'view-project', projectId: 'a' });
    expect(document.querySelector('#link-banner .lb-clone')).toBeNull();
  });

  it('сервера нет на 404 - берётся копия на этом устройстве; нет нигде - «Проект недоступен»', async () => {
    await server();
    const local = { ...blankProject('Только у меня'), id: 'mine' };
    await storage.save(local);
    await enterLinkView({ mode: 'view-project', projectId: 'mine' });
    expect(state.project.name).toBe('Только у меня');
    await enterLinkView({ mode: 'view-project', projectId: 'нигде' });
    expect(document.querySelector('#link-banner .lb-title')?.textContent).toBe('Проект недоступен на этом устройстве');
  });

  it('сервер недоступен - тоже копия на устройстве, без ошибок', async () => {
    setApiForTests(createApiClient({ base: 'http://127.0.0.1:1' }));
    await storage.save({ ...blankProject('Локальный'), id: 'loc' });
    await enterLinkView({ mode: 'view-project', projectId: 'loc' });
    expect(state.project.name).toBe('Локальный');
    expect(state.linkMode).toBe('view-project');
  });

  it('облако выключено - всё как раньше, через localStorage', async () => {
    setApiForTests(null);
    await storage.save({ ...blankProject('Локальный'), id: 'loc2' });
    await enterLinkView({ mode: 'view-project', projectId: 'loc2' });
    expect(state.project.name).toBe('Локальный');
  });
});

describe('клонирование через сервер', () => {
  it('копия создаётся на сервере, сохраняется на устройстве с картинкой, без ответов и скрытых страниц', async () => {
    const { app } = await server();
    await enterLinkView({ mode: 'view-project', projectId: 'a' });
    await cloneViewedProject();
    expect(state.linkMode).toBeNull();
    expect(state.project.id).not.toBe('a');
    expect(state.project.name).toBe('Проект a (копия)');
    expect(toast()).toBe('Проект сохранён на этом устройстве');
    const saved = (await storage.load(state.project.id))!;
    expect(saved.pages.map(p => p.id)).toEqual(['a-p1', 'a-p2']);
    expect(saved.pages[0].elements.find(e => e.id === 'img')).toMatchObject({ src: PNG });
    expect(saved.pages[0].elements.find(e => e.type === 'task')).toMatchObject({ answer: '' });
    expect(JSON.stringify(saved)).not.toContain('"answer":"42"');
    expect(getSyncedRev(saved.id)).toBe(1);
    // на сервере копия принадлежит зрителю
    const me = (await call(app, 'GET', '/api/me', undefined, { token: localStorage.getItem(SESSION_KEY)! })).body.user.id;
    expect(app.db.prepare('SELECT owner_id FROM projects WHERE id = ?').get(saved.id)).toEqual({ owner_id: me });
  });

  it('лимит проектов на сервере: тост и просмотр остаётся', async () => {
    const { app } = await server();
    await enterLinkView({ mode: 'view-project', projectId: 'a' });
    const sessionUser = (await call(app, 'GET', '/api/me', undefined, { token: await createApiClient({ base: app.base }).ensureSession() })).body.user.id;
    for (const id of ['x', 'y', 'z']) app.db.prepare("INSERT INTO projects (id, owner_id, title, data_json, created_at, updated_at) VALUES (?, ?, 't', '{}', 1, 1)").run(id, sessionUser);
    await cloneViewedProject();
    expect(toast()).toBe('На бесплатном тарифе доступно до 3 проектов');
    expect(state.linkMode).toBe('view-project');
  });

  it('сервер пропал после открытия - копия делается локально', async () => {
    const { app } = await server();
    await enterLinkView({ mode: 'view-project', projectId: 'a' });
    await closeApps();
    setApiForTests(createApiClient({ base: app.base }));
    await cloneViewedProject();
    expect(state.linkMode).toBeNull();
    expect(state.project.name).toBe('Проект a (копия)');
    expect(getSyncedRev(state.project.id)).toBeNull();
    expect(JSON.stringify(state.project)).not.toContain('"answer":"42"');
  });
});

describe('приглашение /j/:token', () => {
  async function invited(spec: Record<string, unknown> = {}) {
    const s = await server();
    const inv = await call(s.app, 'POST', '/api/invites', { projectId: 'a', ...spec }, { token: s.owner.token });
    return { ...s, token: inv.body.token as string };
  }

  it('гость с другого устройства: проект отфильтрован и замаскирован, картинка на месте', async () => {
    const { token } = await invited({ pageRights: { 'a-p2': 'hidden' } });
    expect(await enterInvite(token)).toBe(true);
    expect(state.project.pages.map(p => p.id)).toEqual(['a-p1']);
    expect(state.project.pages[0].elements.find(e => e.id === 'img')).toMatchObject({ src: PNG });
    expect(JSON.stringify(state.project)).not.toContain('"answer":"42"');
    expect(state.linkMode).toBe('view-project');
  });

  it('неизвестная и отозванная ссылка - сообщение, доска не открывается', async () => {
    const { app, owner, token } = await invited();
    expect(await enterInvite('нет-такой')).toBe(false);
    expect(notice()).toContain('Приглашение недействительно');
    await call(app, 'DELETE', `/api/invites/${token}`, undefined, { token: owner.token });
    document.getElementById('collab-notice')?.remove();
    expect(await enterInvite(token)).toBe(false);
    expect(notice()).toContain('Приглашение недействительно');
    expect(state.linkMode).toBeNull();
  });

  it('нет связи с сервером - своё сообщение; облако выключено - прежняя заглушка', async () => {
    setApiForTests(createApiClient({ base: 'http://127.0.0.1:1' }));
    expect(await enterInvite('любая')).toBe(false);
    expect(notice()).toContain('Нет связи с сервером');
    document.getElementById('collab-notice')?.remove();
    setApiForTests(null);
    expect(await enterInvite('любая')).toBe(false);
    expect(notice()).toContain('Ссылка не поддерживается');
  });

  it('автор, открывший свою ссылку, остаётся на своей доске без сообщений', async () => {
    const { owner, token } = await invited();
    localStorage.setItem(SESSION_KEY, owner.token);
    expect(await enterInvite(token)).toBe(false);
    expect(notice()).toBe('');
    expect(state.linkMode).toBeNull();
  });

  it('клонирование из приглашения не открывает страницы, скрытые приглашением', async () => {
    const { token } = await invited({ pageRights: { 'a-p2': 'hidden' } });
    await enterInvite(token);
    await cloneViewedProject();
    expect(state.project.pages.map(p => p.id)).toEqual(['a-p1']);
  });
});

describe('тексты отказа входа по ссылке (Ночь №6, SPEC_NIGHT6 §5.4)', () => {
  it('по коду сервера - понятная причина; неизвестный - «приглашение недействительно»; сеть - «нет связи»', async () => {
    const { inviteFailureNotice, NOTICE_INVITE_GONE, NOTICE_INVITE_OFFLINE } = await import('../../src/link-view-ui');
    expect(inviteFailureNotice('not-found', 'link-paused')[1]).toContain('Автор закрыл доступ к доске по ссылке');
    expect(inviteFailureNotice('not-found', 'alias-released')[0]).toBe('Адрес больше не используется');
    expect(inviteFailureNotice('not-found', 'alias-inactive')[0]).toBe('Адрес временно неактивен');
    expect(inviteFailureNotice('not-found', 'board-deleted')[0]).toBe('Доска удалена');
    expect(inviteFailureNotice('not-found', 'invite-not-found')).toEqual(NOTICE_INVITE_GONE);
    expect(inviteFailureNotice('network')).toEqual(NOTICE_INVITE_OFFLINE);
  });
});
