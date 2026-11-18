// Облачные комнаты на клиенте: гость входит по приглашению, ученик отвечает, автор подключается к своей комнате.
// Настоящий сервер (в памяти) и настоящие WebSocket.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SESSION_KEY, createApiClient, setApiForTests, type ApiClient } from '../../src/api-client';
import { WAKE_MIN_MS, catchUpOnWake, connectOwnerRoom, joinCloudInvite, leaveOwnerRoom, ownerRoomProject, resetWakeForTests, setRoomRetryForTests, watchOwnerRoom } from '../../src/cloud-room';
import { setAccount, signedIn, syncAccount } from '../../src/profile-sync';
import { cloudStorage, initCloudSync } from '../../src/cloud-sync';
import { collabActive, collabReady, connectCollab, sendTaskSubmit, stopCollab, type CollabClosedDetail } from '../../src/collab';
import { openProject, state, blankProject } from '../../src/state';
import { storage } from '../../src/storage';
import { getSyncedRev } from '../../src/sync-state';
import { resetUploadedAssets } from '../../src/asset-store';
import type { Element, Project, TaskEl } from '../../src/types';
import { addInvite, anon, call, closeApps, editStored, makeApp, proj, putProject, rectEl, setPlan, taskEl, type TestApp } from '../server/helpers';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

async function until<T>(fn: () => T | undefined | null | false, ms = 4000): Promise<T> {
  const t0 = Date.now();
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error('условие не выполнилось за отведённое время');
    await new Promise(r => setTimeout(r, 5));
  }
}

let app: TestApp;
let owner: Awaited<ReturnType<typeof anon>>;
const closedEvents: CollabClosedDetail[] = [];
const onClosed = (e: Event) => closedEvents.push((e as CustomEvent<CollabClosedDetail>).detail);

async function setup(plan = 'pro') {
  app = await makeApp({ roomSaveMs: 20, roomIdleMs: 60 });
  owner = await anon(app);
  setPlan(app, owner.id, plan);
  const p = proj('a', {
    pages: [
      { id: 'a-p1', name: 'Первая', grid: 'square', elements: [taskEl(), rectEl('r1'), { id: 'img', type: 'image', x: 0, y: 0, w: 5, h: 5, src: PNG }] },
      { id: 'a-p2', name: 'Вторая', grid: 'square', elements: [rectEl('r2')] },
    ],
  });
  await putProject(app, owner.token, p);
  addInvite(app, 'inv', 'a', owner.id, { defaultRole: 'view' });
  setApiForTests(createApiClient({ base: app.base }));
}

beforeEach(() => {
  localStorage.clear();
  resetUploadedAssets();
  closedEvents.length = 0;
  document.body.innerHTML = '<div id="canvas-wrap"><canvas id="board"></canvas></div>';
  openProject(blankProject('Свой'));
  state.projects = [];
  document.addEventListener('doska:collab-closed', onClosed);
});
afterEach(async () => {
  document.removeEventListener('doska:collab-closed', onClosed);
  stopCollab();
  state.linkMode = null;
  setApiForTests(undefined);
  await closeApps();
});

describe('гость по приглашению', () => {
  it('входит в комнату при отсутствующем авторе: проект, картинка с сервера, ответ задания скрыт', async () => {
    await setup();
    expect(await joinCloudInvite('inv', 'Маша')).toBe('room');
    expect(collabActive()).toBe(true);
    expect(state.collabRole).toBe('guest');
    expect(state.project.id).toBe('a');
    const els = state.project.pages[0].elements;
    expect(els.find(e => e.id === 'img')).toMatchObject({ src: PNG }); // asset:// заменён содержимым до применения
    expect(els.find(e => e.type === 'task')).toMatchObject({ answer: '' });
    expect(JSON.stringify(state.project)).not.toContain('СЕКРЕТНОЕ-РЕШЕНИЕ');
    expect(app.rooms.connections('a')).toBe(1);
  });

  it('ученик отвечает «42»: сервер проверяет, на доске «верно», а ответа у ученика так и нет; попытка в базе', async () => {
    await setup();
    await joinCloudInvite('inv', 'Ученик');
    sendTaskSubmit('a-p1', 't1', '42');
    const task = () => state.project.pages[0].elements.find(e => e.id === 't1') as TaskEl;
    await until(() => task().attempts?.[0]?.isCorrect === true);
    expect(task().answer).toBe('');
    await until(() => (JSON.parse((app.db.prepare('SELECT data_json FROM projects WHERE id = ?').get('a') as { data_json: string }).data_json).pages[0].elements[0].attempts ?? []).length === 1);
  });

  it('бесплатный автор не в сети: комната не открылась — проект для чтения и пояснение', async () => {
    await setup('free');
    expect(await joinCloudInvite('inv', 'Гость')).toBe('view');
    expect(state.collabRole).toBeNull();
    expect(state.linkMode).toBe('view-project');
    expect(state.project.id).toBe('a');
    expect(closedEvents.map(e => e.code)).toEqual([4503]);
    expect(JSON.stringify(state.project)).not.toContain('"answer":"42"');
  });

  it('недействительная, отозванная ссылка и сервер без связи — «none» с пояснением', async () => {
    await setup();
    expect(await joinCloudInvite('нет-такой', 'Гость')).toBe('none');
    expect(document.getElementById('collab-notice')?.textContent).toContain('Приглашение недействительно');
    await call(app, 'DELETE', '/api/invites/inv', undefined, { token: owner.token });
    document.getElementById('collab-notice')?.remove();
    expect(await joinCloudInvite('inv', 'Гость')).toBe('none');
    expect(document.getElementById('collab-notice')?.textContent).toContain('Приглашение недействительно');
    setApiForTests(createApiClient({ base: 'http://127.0.0.1:1' }));
    document.getElementById('collab-notice')?.remove();
    expect(await joinCloudInvite('inv', 'Гость')).toBe('none');
    expect(document.getElementById('collab-notice')?.textContent).toContain('Нет связи с сервером');
    expect(state.collabRole).toBeNull();
  });

  it('гость по приглашению входит с анонимной сессией устройства — автор его элементов (SPEC_NIGHT6 Решение 16)', async () => {
    await setup();
    const before = (app.db.prepare('SELECT COUNT(*) n FROM users').get() as { n: number }).n;
    expect(await joinCloudInvite('inv', 'Гость')).toBe('room');
    expect((app.db.prepare('SELECT COUNT(*) n FROM users').get() as { n: number }).n).toBe(before + 1);
    expect(localStorage.getItem(SESSION_KEY)).not.toBeNull();
    stopCollab();
    // повторный вход — та же сессия, новой записи нет
    expect(await joinCloudInvite('inv', 'Гость')).toBe('room');
    expect((app.db.prepare('SELECT COUNT(*) n FROM users').get() as { n: number }).n).toBe(before + 1);
  });

  it('автор, открывший ссылку на свою доску, в комнату как гость не попадает', async () => {
    await setup();
    localStorage.setItem(SESSION_KEY, owner.token);
    expect(await joinCloudInvite('inv', 'Автор')).toBe('none');
    expect(state.collabRole).toBeNull();
  });
});

describe('комната заполнена (Ночь №5, TASK-07)', () => {
  /** Первый гость — отдельным сокетом (модуль совместной работы у теста один). */
  function rawGuest(name: string): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`${app.base.replace(/^http/, 'ws')}/ws/room/a`);
      ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', proto: 1, invite: 'inv', name }));
      ws.onmessage = ev => { if (JSON.parse(String(ev.data)).t === 'init') resolve(ws); };
      ws.onerror = reject;
    });
  }

  it('лимит автора: окно «1 из 1», под ним проект для чтения; «Попробовать снова» — повторный вход', async () => {
    await setup('pro');
    editStored(app, 'a', p => { p.permissions = { maxGuests: 1 }; });
    const first = await rawGuest('Первый');
    let retried = 0;
    setRoomRetryForTests(() => { retried++; });
    try {
      expect(await joinCloudInvite('inv', 'Второй')).toBe('view');
      expect(closedEvents.map(e => e.code)).toEqual([4430]);
      expect(state.linkMode).toBe('view-project');
      const m = document.getElementById('room-full-modal')!;
      expect(m.querySelector('h2')!.textContent).toBe('В комнате сейчас максимум участников (1 из 1)');
      expect(m.textContent).toContain('Автор доски ограничил число участников');
      expect(m.querySelector('.room-full-readonly')).not.toBeNull();
      m.querySelector<HTMLButtonElement>('.room-full-retry')!.click();
      expect(retried).toBe(1);
    } finally {
      setRoomRetryForTests(null);
      first.close();
    }
  });

  it('лимит бесплатного тарифа: пояснение про тариф', async () => {
    await setup('free');
    // автор в сети (бесплатная комната без автора не открывается), один гость уже есть
    const host = await new Promise<WebSocket>((resolve, reject) => {
      const ws = new WebSocket(`${app.base.replace(/^http/, 'ws')}/ws/room/a`);
      ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', proto: 1, session: owner.token, name: 'Автор' }));
      ws.onmessage = ev => { if (JSON.parse(String(ev.data)).t === 'init') resolve(ws); };
      ws.onerror = reject;
    });
    const first = await rawGuest('Первый');
    try {
      expect(await joinCloudInvite('inv', 'Второй')).toBe('view');
      expect(closedEvents.map(e => e.code)).toEqual([4402]);
      const m = document.getElementById('room-full-modal')!;
      expect(m.querySelector('h2')!.textContent).toBe('В комнате сейчас максимум участников (1 из 1)');
      expect(m.textContent).toContain('лимит бесплатного тарифа автора');
    } finally { first.close(); host.close(); }
  });
});

describe('порядок сообщений при загрузке картинок', () => {
  it('сообщение после init с asset:// не обгоняет его', async () => {
    await setup();
    const hash = (await call(app, 'POST', '/api/assets', { dataUrl: PNG }, { token: owner.token })).body.hash as string;
    const api = createApiClient({ base: app.base });
    setApiForTests(api);
    const t = { send: () => true, close: () => {}, onopen: null, onmessage: null, onclose: null } as unknown as Parameters<typeof connectCollab>[0];
    const init = { t: 'init', proto: 1, userId: 5, rights: { default: 'edit', pages: {} }, users: [], patches: true, project: {
      id: 'z', name: 'Z', createdAt: 1, updatedAt: 1,
      pages: [{ id: 'z-p', name: 'С', grid: 'square', elements: [{ id: 'i', type: 'image', x: 0, y: 0, w: 1, h: 1, src: `asset://${hash}` }] }],
    } };
    const patch = { t: 'patch', pageId: 'z-p', rev: 1, by: 9, ops: [{ op: 'put', el: rectEl('после') }] };
    const done = connectCollab(t, false);
    t.onopen!();
    await done;
    t.onmessage!(JSON.stringify(init));
    t.onmessage!(JSON.stringify(patch)); // приходит, пока картинки init ещё докачиваются
    expect(await collabReady()).toBe(true);
    await until(() => state.project.pages[0]?.elements.some(e => e.id === 'после'));
    expect(state.project.pages[0].elements.map(e => e.id)).toEqual(['i', 'после']);
    expect(state.project.pages[0].elements[0]).toMatchObject({ src: PNG });
  });
});

describe('автор в своей облачной комнате', () => {
  let api: ApiClient;
  async function ownerSetup() {
    await setup();
    api = createApiClient({ base: app.base });
    setApiForTests(api);
    localStorage.setItem(SESSION_KEY, owner.token);
    return initCloudSync()!;
  }

  it('подключается как автор, видит настоящие ответы и попытки, пока сохранение проекта берёт на себя комната', async () => {
    const cloud = await ownerSetup();
    expect(cloud).toBe(cloudStorage());
    // локальная копия автора в облаке уже есть
    const mine = (await call(app, 'GET', '/api/projects/a', undefined, { token: owner.token })).body.project as Project;
    await storage.save(mine);
    await cloud.flush();
    openProject((await storage.load('a'))!);
    expect(getSyncedRev('a')).not.toBeNull();
    // ученик (другой клиент) отвечает, пока автора нет
    expect(await connectOwnerRoom()).toBe(true);
    expect(ownerRoomProject()).toBe('a');
    expect(state.collabRole).toBe('host');
    expect(state.project.pages[0].elements.find(e => e.type === 'task')).toMatchObject({ answer: '42', solutionMd: 'СЕКРЕТНОЕ-РЕШЕНИЕ' });
    // правка автора уходит патчем в комнату и в базу — без отдельного PUT
    const rev = (app.db.prepare('SELECT rev FROM projects WHERE id = ?').get('a') as { rev: number }).rev;
    state.project.pages[0].elements = [...state.project.pages[0].elements, rectEl('нарисовал-автор') as never];
    state.board = state.project.pages[0];
    await storage.save(state.project);
    await until(() => app.rooms.projectOf('a')?.pages[0].elements.some(e => e.id === 'нарисовал-автор'));
    await cloud.flush();
    await until(() => (app.db.prepare('SELECT rev FROM projects WHERE id = ?').get('a') as { rev: number }).rev > rev);
    leaveOwnerRoom();
    expect(state.collabRole).toBeNull();
    expect(ownerRoomProject()).toBeNull();
  });

  it('без приглашения или без облачной копии автор в комнату не подключается', async () => {
    const cloud = await ownerSetup();
    app.db.exec('DELETE FROM invites');
    const mine = (await call(app, 'GET', '/api/projects/a', undefined, { token: owner.token })).body.project as Project;
    await storage.save(mine);
    await cloud.flush();
    openProject((await storage.load('a'))!);
    expect(await connectOwnerRoom()).toBe(false);
    expect(state.collabRole).toBeNull();
    openProject(blankProject('Новый'));
    expect(await connectOwnerRoom()).toBe(false);
  });

  it('вошедший в аккаунт автор подключается к комнате своего проекта и без приглашения (SPEC_NIGHT5 §2.3)', async () => {
    const cloud = await ownerSetup();
    app.db.exec('DELETE FROM invites');
    app.db.prepare('UPDATE users SET email = ? WHERE id = ?').run('owner@example.com', owner.id);
    try {
      expect(await syncAccount(api)).toBe(true);
      expect(signedIn()).toBe(true);
      const mine = (await call(app, 'GET', '/api/projects/a', undefined, { token: owner.token })).body.project as Project;
      await storage.save(mine);
      await cloud.flush();
      openProject((await storage.load('a'))!);
      expect(await connectOwnerRoom()).toBe(true);
      expect(state.collabRole).toBe('host');
      expect(app.rooms.connections('a')).toBe(1);
    } finally {
      leaveOwnerRoom();
      setAccount(null);
    }
  });

  it('возврат на вкладку без комнаты: свежая версия с другого устройства приходит событием, не чаще раза в 5 с', async () => {
    const cloud = await ownerSetup();
    app.db.exec('DELETE FROM invites');
    resetWakeForTests();
    const mine = (await call(app, 'GET', '/api/projects/a', undefined, { token: owner.token })).body.project as Project;
    await storage.save(mine);
    await cloud.flush();
    openProject((await storage.load('a'))!);
    const fresh: Project[] = [];
    const on = (e: Event) => fresh.push((e as CustomEvent<{ project: Project }>).detail.project);
    document.addEventListener('doska:cloud-fresh', on);
    try {
      expect(await catchUpOnWake(1_000_000)).toBe(true);
      expect(fresh).toHaveLength(0); // на сервере ничего нового
      editStored(app, 'a', p => { p.name = 'С планшета'; });
      expect(await catchUpOnWake(1_000_000 + WAKE_MIN_MS - 1)).toBe(false); // слишком часто
      expect(await catchUpOnWake(1_000_000 + WAKE_MIN_MS)).toBe(true);
      expect(fresh.map(p => p.name)).toEqual(['С планшета']);
    } finally {
      document.removeEventListener('doska:cloud-fresh', on);
    }
  });

  it('ученик в комнате и автор вместе: автор видит ответ ученика сразу', async () => {
    const cloud = await ownerSetup();
    const mine = (await call(app, 'GET', '/api/projects/a', undefined, { token: owner.token })).body.project as Project;
    await storage.save(mine);
    await cloud.flush();
    openProject((await storage.load('a'))!);
    expect(await connectOwnerRoom()).toBe(true);
    // ученик — отдельное подключение через тот же транспорт
    const ws = new WebSocket(`${app.base.replace('http', 'ws')}/ws/room/a`);
    ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', proto: 1, invite: 'inv', name: 'Ученик' }));
    await new Promise(r => { ws.onmessage = e => { if (JSON.parse(String(e.data)).t === 'init') r(null); }; });
    ws.send(JSON.stringify({ t: 'task-submit', pageId: 'a-p1', elId: 't1', value: '42' }));
    const task = () => state.project.pages[0].elements.find(e => e.id === 't1') as TaskEl;
    await until(() => task().attempts?.[0]?.isCorrect === true);
    expect(task().answer).toBe('42'); // автору ответ виден
    ws.close();
  });
});

describe('комната автора: найдено в E2E Ночи №5 (порядок важен: watchOwnerRoom регистрирует постоянные подписки)', () => {
  it('правки, ещё не сохранённые автосохранением, попадают в комнату автора (доска автора не расходится с гостями)', async () => {
    leaveOwnerRoom();
    await setup();
    const api = createApiClient({ base: app.base });
    setApiForTests(api);
    localStorage.setItem(SESSION_KEY, owner.token);
    const cloud = initCloudSync()!;
    try {
      const mine = (await call(app, 'GET', '/api/projects/a', undefined, { token: owner.token })).body.project as Project;
      await storage.save(mine);
      await cloud.flush();
      openProject((await storage.load('a'))!);
      // правка на холсте: автосохранение ещё не сработало
      state.project = { ...state.project, pages: state.project.pages.map((pg, i) => (i === 0 ? { ...pg, elements: [...pg.elements, rectEl('fresh') as Element] } : pg)) };
      state.dirty = true;
      expect(await connectOwnerRoom()).toBe(true);
      expect(state.dirty).toBe(false);
      expect(app.rooms.projectOf('a')!.pages[0].elements.some(e => e.id === 'fresh')).toBe(true);
    } finally {
      leaveOwnerRoom();
    }
  });

  it('вошедший автор начал рисовать на новой доске — после первой отправки он сам подключается к комнате', async () => {
    leaveOwnerRoom(); // комната автора из прошлых тестов файла
    await setup();
    const api = createApiClient({ base: app.base });
    setApiForTests(api);
    localStorage.setItem(SESSION_KEY, owner.token);
    app.db.prepare('UPDATE users SET email = ? WHERE id = ?').run('first-sync@example.com', owner.id);
    const cloud = initCloudSync()!;
    try {
      expect(await syncAccount(api)).toBe(true);
      // новая доска: в облаке её ещё нет, подключаться не к чему
      openProject(blankProject('Новая'));
      const id = state.project.id;
      watchOwnerRoom();
      await until(() => !collabActive() && getSyncedRev(id) === null);
      expect(state.collabRole).toBeNull();
      // правка: проект уходит в облако, id не меняется — подключение должно случиться само
      await storage.save({ ...state.project, pages: [{ ...state.project.pages[0], elements: [rectEl('first') as Element] }] });
      await cloud.flush();
      await until(() => state.collabRole === 'host' && app.rooms.connections(id) === 1);
      expect(ownerRoomProject()).toBe(id);
    } finally {
      leaveOwnerRoom();
      setAccount(null);
    }
  });

});
