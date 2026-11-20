// Облачная синхронизация проектов поверх локального хранилища: настоящий сервер (в памяти), хранилище устройства — в памяти теста.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, createApiClient, type ApiClient } from '../../src/api-client';
import { AssetStore, resetUploadedAssets } from '../../src/asset-store';
import { CONFLICT_COPY_SUFFIX, LIMIT_SYNC_TEXT, createCloudStorage, mergeRemoteMetas, openFresh, type CloudStorage, type ConflictResolution } from '../../src/cloud-sync';
import { blankProject, openProject, projectMeta, state } from '../../src/state';
import type { BoardsStorage } from '../../src/storage';
import { STARTER_PROJECT_NAME, clearStarter, getSyncBase, getSyncedRev, isDirty, markStarter, pendingDeletes, starterId } from '../../src/sync-state';
import { contentSignature } from '../../src/sync-conflict';
import { getConflictDraft, hasConflictDraft } from '../../src/conflict-draft';
import type { Project, ProjectMeta } from '../../src/types';
import { anon, call, closeApps, editStored, makeApp, proj, rectEl, taskEl, type TestApp } from '../server/helpers';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

/** Хранилище устройства в памяти. */
function memStorage(): BoardsStorage & { data: Map<string, Project> } {
  const data = new Map<string, Project>();
  return {
    data,
    async list() { return [...data.values()].map(projectMeta).sort((a, b) => b.updatedAt - a.updatedAt); },
    async load(id) { const p = data.get(id); return p ? structuredClone(p) : null; },
    async save(p) { data.set(p.id, structuredClone(p)); },
    async remove(id) { data.delete(id); },
  };
}

const withImage = (id: string): Project => ({
  ...proj(id), pages: [{ id: `${id}-p`, name: 'С', grid: 'square', elements: [{ id: 'img', type: 'image', x: 0, y: 0, w: 5, h: 5, src: PNG }] }],
}) as Project;

let app: TestApp;
let api: ApiClient;
let cloud: CloudStorage[] = [];
let notes: string[] = [];

beforeEach(async () => {
  localStorage.clear();
  resetUploadedAssets();
  app = await makeApp();
  api = createApiClient({ base: app.base });
  cloud = [];
  notes = [];
});
afterEach(async () => {
  for (const c of cloud) c.dispose();
  vi.unstubAllGlobals();
  await closeApps();
});

function make(base = memStorage(), over: Partial<Parameters<typeof createCloudStorage>[1]> = {}) {
  const c = createCloudStorage(base, { api: () => api, debounceMs: 5, retryMs: [20], notify: t => notes.push(t), store: new AssetStore({ idb: null }), ...over });
  cloud.push(c);
  return { c, base };
}
const serverRow = (id: string) => app.db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as { rev: number; data_json: string; is_deleted: number } | undefined;
const until = async (fn: () => unknown, ms = 3000) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) throw new Error('не дождались'); await new Promise(r => setTimeout(r, 5)); } };
/** «Другое устройство» той же учётной записи: общий вход, но свои записи о синхронизации. */
const otherDevice = () => { for (const k of Object.keys(localStorage)) if (k.startsWith('doska.sync')) localStorage.removeItem(k); resetUploadedAssets(); };

describe('отправка на сервер', () => {
  it('сохранение уходит на сервер одним запросом после паузы; картинка выносится, в базе только asset://', async () => {
    const puts: string[] = [];
    api = createApiClient({ base: app.base, fetch: (async (u: string, i: RequestInit) => { if (i.method === 'PUT') puts.push(u); return fetch(u, i); }) as typeof fetch });
    const { c } = make();
    const p = withImage('a');
    await c.save(p);
    await c.save({ ...p, name: 'Второе имя' });
    await c.save({ ...p, name: 'Третье имя' });
    expect(isDirty('a')).toBe(true);
    expect(serverRow('a')).toBeUndefined(); // пока пауза не прошла
    await c.flush();
    expect(puts).toHaveLength(1);
    const row = serverRow('a')!;
    expect(row.rev).toBe(1);
    expect(JSON.parse(row.data_json).name).toBe('Третье имя');
    expect(row.data_json).not.toContain('base64');
    expect(row.data_json).toMatch(/asset:\/\/[0-9a-f]{64}/);
    expect(app.db.prepare('SELECT COUNT(*) n FROM assets').get()).toEqual({ n: 1 });
    expect(getSyncedRev('a')).toBe(1);
    expect(isDirty('a')).toBe(false);
  });

  it('локально проект остаётся с полной картинкой, а не со ссылкой', async () => {
    const { c, base } = make();
    await c.save(withImage('a'));
    await c.flush();
    expect(JSON.stringify(base.data.get('a'))).toContain('data:image/png;base64');
    expect(JSON.stringify(base.data.get('a'))).not.toContain('asset://');
  });

  it('следующие сохранения идут с ожидаемой ревизией и повышают её', async () => {
    const { c } = make();
    await c.save(proj('a'));
    await c.flush();
    await c.save({ ...proj('a'), name: 'Новое' });
    await c.flush();
    expect(serverRow('a')!.rev).toBe(2);
    expect(getSyncedRev('a')).toBe(2);
    expect(app.db.prepare('SELECT COUNT(*) n FROM project_revisions WHERE project_id = ?').get('a')).toEqual({ n: 2 });
  });

  it('сохранение, пришедшее во время отправки, не теряется', async () => {
    const { c } = make(memStorage(), { debounceMs: 1 });
    await c.save(proj('a'));
    const first = c.flush();
    await c.save({ ...proj('a'), name: 'Пока отправлялось' });
    await first;
    await c.flush();
    expect(JSON.parse(serverRow('a')!.data_json).name).toBe('Пока отправлялось');
    expect(isDirty('a')).toBe(false);
  });

  it('без облака хранилище работает как раньше: ни запросов, ни пометок, ни отклонённых промисов', async () => {
    const spy = vi.fn();
    vi.stubGlobal('fetch', spy);
    const { c, base } = make(memStorage(), { api: () => null });
    await c.save(proj('a'));
    await c.flush();
    await c.syncAll();
    expect((await c.openFresh('a'))!.id).toBe('a');
    await c.remove('a');
    expect(base.data.size).toBe(0);
    expect(spy).not.toHaveBeenCalled();
    expect(Object.keys(localStorage).filter(k => k.startsWith('doska.sync'))).toEqual([]);
  });

  it('сервер недоступен: правки остаются отмеченными, после восстановления уходят сами', async () => {
    let up = false;
    api = createApiClient({ base: app.base, fetch: (async (u: string, i: RequestInit) => { if (!up) throw new TypeError('offline'); return fetch(u, i); }) as typeof fetch });
    const { c } = make();
    await c.save(proj('a'));
    await c.flush();
    expect(isDirty('a')).toBe(true);
    expect(getSyncedRev('a')).toBeNull();
    expect(serverRow('a')).toBeUndefined();
    up = true;
    await until(() => serverRow('a')); // повтор по таймеру
    await until(() => getSyncedRev('a') === 1 && !isDirty('a'));
    expect(serverRow('a')!.rev).toBe(1);
  });

  it('сервер забыл картинки (базу сбросили): 409 missing-assets — догрузка и повтор', async () => {
    const { c } = make();
    await c.save(withImage('a'));
    await c.flush();
    app.db.exec('DELETE FROM assets');
    await c.save({ ...withImage('a'), name: 'После сброса' });
    await c.flush();
    expect(getSyncedRev('a')).toBe(2);
    expect(app.db.prepare('SELECT COUNT(*) n FROM assets').get()).toEqual({ n: 1 });
  });

  it('пока автор в облачной комнате проекта, PUT не отправляется; после выхода — уходит', async () => {
    const { c } = make();
    c.setCloudRoom('a');
    await c.save(proj('a'));
    await c.flush();
    expect(serverRow('a')).toBeUndefined();
    expect(isDirty('a')).toBe(true);
    c.setCloudRoom(null);
    await until(() => serverRow('a'));
  });
});

describe('лимиты и ошибки', () => {
  it('четвёртый проект бесплатного тарифа остаётся на устройстве, тост один раз', async () => {
    const { c, base } = make();
    for (const id of ['a', 'b', 'c', 'd', 'e']) await c.save(proj(id));
    await c.flush();
    expect(app.db.prepare('SELECT COUNT(*) n FROM projects').get()).toEqual({ n: 3 });
    expect([...base.data.keys()].sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(notes).toEqual([LIMIT_SYNC_TEXT]);
    // какие именно три дошли первыми — зависит от порядка запросов; остальные остаются только на устройстве
    const rejected = ['a', 'b', 'c', 'd', 'e'].filter(id => !serverRow(id));
    expect(rejected).toHaveLength(2);
    // повторное сохранение такого проекта не пытается снова
    await c.save({ ...proj(rejected[0]), name: 'ещё' });
    await c.flush();
    expect(notes).toHaveLength(1);
    expect(serverRow(rejected[0])).toBeUndefined();
  });

  it('чужой проект с тем же id: локальный получает новый id и уходит на сервер', async () => {
    const stranger = await anon(app);
    await call(app, 'PUT', '/api/projects/dup', { project: proj('dup', { name: 'Чужой' }) }, { token: stranger.token });
    const { c, base } = make();
    openProject(proj('dup', { name: 'Мой' }) as Project);
    state.projects = [projectMeta(proj('dup', { name: 'Мой' }) as Project)];
    await c.save(state.project);
    await c.flush();
    await until(() => base.data.size === 1 && !base.data.has('dup'));
    await c.flush();
    const [newId] = [...base.data.keys()];
    expect(newId).not.toBe('dup');
    expect(state.project.id).toBe(newId);
    expect(state.projects.map(m => m.id)).toEqual([newId]);
    expect(JSON.parse(serverRow(newId)!.data_json).name).toBe('Мой');
    expect(JSON.parse(serverRow('dup')!.data_json).name).toBe('Чужой');
  });
});

describe('получение с сервера', () => {
  it('другое устройство: проекта нет на устройстве — он приходит с картинкой и запоминается', async () => {
    const a = make();
    await a.c.save(withImage('a'));
    await a.c.flush();
    otherDevice();
    const b = make();
    const loaded = (await b.c.openFresh('a'))!;
    expect(loaded.id).toBe('a');
    expect(JSON.stringify(loaded)).toContain('data:image/png;base64');
    expect(JSON.stringify(loaded)).not.toContain('asset://');
    expect(b.base.data.has('a')).toBe(true);
    expect(getSyncedRev('a')).toBe(1);
    expect(isDirty('a')).toBe(false);
    // load тоже находит чужую для устройства, но свою для учётной записи, доску (без сохранения)
    const c2 = make();
    expect((await c2.c.load('a'))!.name).toBe('Проект a');
    expect(c2.base.data.size).toBe(0);
  });

  it('сервер новее и своих правок нет — берётся серверная версия (в том числе ответы учеников)', async () => {
    const { c, base } = make();
    await c.save({ ...proj('a'), pages: [{ id: 'a-p1', name: 'П', grid: 'square', elements: [taskEl()] }] } as Project);
    await c.flush();
    editStored(app, 'a', p => { p.pages[0].elements[0].attempts = [{ value: '42', timestamp: 7, isCorrect: true }]; });
    const opened = (await c.openFresh('a'))!;
    expect((opened.pages[0].elements[0] as { attempts?: unknown[] }).attempts).toHaveLength(1);
    expect(getSyncedRev('a')).toBe(2);
    expect((base.data.get('a')!.pages[0].elements[0] as { attempts?: unknown[] }).attempts).toHaveLength(1);
  });

  it('правки есть с обеих сторон: открывается локальная, а сохранение автора сливается на сервере', async () => {
    const { c, base } = make();
    await c.save({ ...proj('a'), pages: [{ id: 'a-p1', name: 'П', grid: 'square', elements: [taskEl(), rectEl('r1')] }] } as Project);
    await c.flush();
    editStored(app, 'a', p => { p.pages[0].elements[0].attempts = [{ value: '42', timestamp: 7, isCorrect: true }]; });
    const mine = { ...base.data.get('a')!, name: 'Правка с телефона' };
    await c.save(mine); // версия 1 → устарела
    const opened = (await c.openFresh('a'))!;
    expect(opened.name).toBe('Правка с телефона');
    await c.flush();
    const stored = JSON.parse(serverRow('a')!.data_json);
    expect(stored.name).toBe('Правка с телефона');
    expect(stored.pages[0].elements[0].attempts).toHaveLength(1);
    expect(serverRow('a')!.rev).toBe(3);
  });

  it('сервер при слиянии добавил чужой ввод: следующие сохранения его не стирают, а при открытии подтягивается серверная версия', async () => {
    const { c, base } = make();
    await c.save({ ...proj('a'), pages: [{ id: 'a-p1', name: 'П', grid: 'square', elements: [taskEl(), rectEl('r1')] }] } as Project);
    await c.flush();
    editStored(app, 'a', p => { p.pages[0].elements[0].attempts = [{ value: '42', timestamp: 7, isCorrect: true }]; });
    await c.save({ ...base.data.get('a')!, name: 'Первая правка' });
    await c.flush();
    expect(serverRow('a')!.rev).toBe(3);
    expect(getSyncedRev('a')).toBe(2); // ответ ученика в нашей копии так и не появился — помним версию до слияния
    await c.save({ ...base.data.get('a')!, name: 'Вторая правка' });
    await c.flush();
    const stored = JSON.parse(serverRow('a')!.data_json);
    expect(stored.name).toBe('Вторая правка');
    expect(stored.pages[0].elements[0].attempts).toHaveLength(1);
    // правок нет — при открытии берётся серверная версия, уже с ответом ученика
    const opened = (await c.openFresh('a'))!;
    expect((opened.pages[0].elements[0] as { attempts?: unknown[] }).attempts).toHaveLength(1);
    expect(getSyncedRev('a')).toBe(serverRow('a')!.rev);
  });

  it('проект удалён на сервере: локальный остаётся и уходит как новый', async () => {
    const { c } = make();
    await c.save(proj('a'));
    await c.flush();
    app.db.exec('DELETE FROM projects');
    const opened = await c.openFresh('a');
    expect(opened!.id).toBe('a');
    expect(getSyncedRev('a')).toBeNull();
    await c.save(opened!);
    await c.flush();
    expect(serverRow('a')!.rev).toBe(1);
  });

  it('сервер недоступен при открытии — открывается локальный', async () => {
    const { c } = make();
    await c.save(proj('a'));
    await c.flush();
    api = createApiClient({ base: 'http://127.0.0.1:1' });
    expect((await c.openFresh('a'))!.id).toBe('a');
  });

  it('чужой проект (роль не владелец) не подхватывается', async () => {
    const stranger = await anon(app);
    await call(app, 'PUT', '/api/projects/theirs', { project: proj('theirs') }, { token: stranger.token });
    const { c } = make();
    expect(await c.openFresh('theirs')).toBeNull();
    expect(await c.load('theirs')).toBeNull();
  });
});

describe('начальная синхронизация', () => {
  it('проекты устройства попадают на сервер, серверные находятся и сообщаются списку', async () => {
    const a = make();
    await a.c.save(proj('srv'));
    await a.c.flush();
    otherDevice();
    const found: ProjectMeta[][] = [];
    const b = make(memStorage(), { onRemoteProjects: m => found.push(m) });
    await b.base.save(proj('mine1') as Project);
    await b.base.save(proj('mine2') as Project);
    await b.c.syncAll();
    expect(serverRow('mine1')!.rev).toBe(1);
    expect(serverRow('mine2')!.rev).toBe(1);
    expect(found).toHaveLength(1);
    expect(found[0].map(m => m.id)).toEqual(['srv']);
    expect(b.c.remoteOnly()[0]).toMatchObject({ id: 'srv', name: 'Проект srv', pageCount: 2 });
    expect(getSyncedRev('mine1')).toBe(1);
  });

  it('уже синхронизированное и без правок не отправляется заново', async () => {
    const { c } = make();
    await c.save(proj('a'));
    await c.flush();
    const before = serverRow('a')!.rev;
    await c.syncAll();
    expect(serverRow('a')!.rev).toBe(before);
  });

  it('несохранённые в облаке правки прошлого запуска уходят при старте', async () => {
    const first = make();
    await first.c.save(proj('a'));
    await first.c.flush();
    // «закрыли вкладку» до отправки второй правки
    await first.c.save({ ...proj('a'), name: 'Недоотправлено' });
    first.c.dispose();
    const second = make(first.base);
    await second.c.syncAll();
    expect(JSON.parse(serverRow('a')!.data_json).name).toBe('Недоотправлено');
  });

  it('лимит: лишние проекты остаются на устройстве, остальные уходят', async () => {
    const { c, base } = make();
    for (const id of ['a', 'b', 'c', 'd']) await base.save(proj(id) as Project);
    await c.syncAll();
    expect(app.db.prepare('SELECT COUNT(*) n FROM projects').get()).toEqual({ n: 3 });
    expect(notes).toEqual([LIMIT_SYNC_TEXT]);
  });

  it('нет сети — тихо, повтор позже', async () => {
    let up = false;
    api = createApiClient({ base: app.base, fetch: (async (u: string, i: RequestInit) => { if (!up) throw new TypeError('offline'); return fetch(u, i); }) as typeof fetch });
    const { c, base } = make();
    await base.save(proj('a') as Project);
    await expect(c.syncAll()).resolves.toBeUndefined();
    up = true;
    await until(() => serverRow('a'));
  });
});

describe('удаление', () => {
  it('удаление проекта на устройстве удаляет его и на сервере', async () => {
    const { c, base } = make();
    await c.save(proj('a'));
    await c.flush();
    await c.remove('a');
    expect(base.data.has('a')).toBe(false);
    expect(serverRow('a')!.is_deleted).toBe(1);
    expect(getSyncedRev('a')).toBeNull();
  });

  it('без сети удаление запоминается и выполняется при следующей синхронизации; такой проект не «воскресает»', async () => {
    const { c } = make();
    await c.save(proj('a'));
    await c.flush();
    const good = api;
    api = createApiClient({ base: 'http://127.0.0.1:1' });
    await c.remove('a');
    expect(pendingDeletes()).toEqual(['a']);
    expect(serverRow('a')!.is_deleted).toBe(0);
    api = good;
    const found: ProjectMeta[][] = [];
    const again = make(memStorage(), { onRemoteProjects: m => found.push(m) });
    await again.c.syncAll();
    expect(serverRow('a')!.is_deleted).toBe(1);
    expect(pendingDeletes()).toEqual([]);
    expect(found[0]).toEqual([]);
  });

  it('удаление проекта, которого на сервере нет, — без ошибок', async () => {
    const { c, base } = make();
    await base.save(proj('local') as Project);
    await c.remove('local');
    expect(pendingDeletes()).toEqual([]);
  });
});

describe('мелочи', () => {
  it('mergeRemoteMetas добавляет только неизвестные и сортирует по свежести', () => {
    const m = (id: string, updatedAt: number): ProjectMeta => ({ id, name: id, createdAt: 1, updatedAt, pageCount: 1 });
    expect(mergeRemoteMetas([m('a', 5), m('b', 1)], [m('a', 99), m('c', 9)]).map(x => x.id)).toEqual(['c', 'a', 'b']);
  });

  it('openFresh без подключённого облака — обычная загрузка', async () => {
    openProject(blankProject('x'));
    expect(await openFresh('нет-такого')).toBeNull();
  });

  it('ошибка без сети — ApiError со статусом 0, а не необработанное исключение', async () => {
    const down = createApiClient({ base: 'http://127.0.0.1:1' });
    await expect(down.request('GET', '/api/projects')).rejects.toBeInstanceOf(ApiError);
  });
});

describe('стартовая заглушка (SPEC_NIGHT5 §2.1)', () => {
  const starter = () => { const p = blankProject(STARTER_PROJECT_NAME); markStarter(p.id); return p; };

  it('нетронутая заглушка в облако не уходит ни при сохранении, ни при начальной синхронизации', async () => {
    const { c } = make();
    const p = starter();
    await c.save(p);
    await c.flush();
    await c.syncAll();
    expect(serverRow(p.id)).toBeUndefined();
    expect(isDirty(p.id)).toBe(false);
    expect(c.status(p)).toBe('hidden');
  });

  it('после правки метка снимается и проект уходит', async () => {
    const { c } = make();
    const p = starter();
    await c.save(p);
    await c.save({ ...p, name: 'Алгебра' });
    expect(starterId()).toBeNull();
    await c.flush();
    expect(serverRow(p.id)).toBeDefined();
  });

  it('первая правка на холсте (pushHistory) снимает метку открытого проекта', async () => {
    const p = starter();
    openProject(p);
    const { pushHistory } = await import('../../src/state');
    pushHistory([]);
    expect(starterId()).toBeNull();
  });

  it('onSynced получает проекты сервера; removeLocal удаляет только с устройства', async () => {
    const seen: ProjectMeta[][] = [];
    const { c, base } = make(memStorage(), { onSynced: m => seen.push(m) });
    await c.save(proj('cloud1'));
    await c.flush();
    const p = starter();
    await base.save(p);
    await c.syncAll();
    expect(seen.at(-1)!.map(m => m.id)).toEqual(['cloud1']);
    await c.removeLocal(p.id);
    expect(base.data.has(p.id)).toBe(false);
    expect(pendingDeletes()).toEqual([]);
    clearStarter();
  });
});

describe('статус синхронизации (SPEC_NIGHT5 §2.2)', () => {
  it('сохранение → синхронизация → в облаке; подписка срабатывает', async () => {
    const { c } = make(memStorage(), { debounceMs: 30 });
    let calls = 0;
    const off = c.onStatus(() => { calls++; });
    const p = proj('a');
    expect(c.status(p)).toBe('synced');
    await c.save(p);
    expect(c.status(p)).toBe('syncing');
    await c.flush();
    expect(c.status(p)).toBe('synced');
    expect(calls).toBeGreaterThan(0);
    off();
  });

  it('нет сети — офлайн; flushNow отправляет сразу, без паузы повтора', async () => {
    let up = false;
    api = createApiClient({ base: app.base, fetch: (async (u: string, i: RequestInit) => { if (!up) throw new TypeError('offline'); return fetch(u, i); }) as typeof fetch });
    const { c } = make(memStorage(), { retryMs: [60_000] });
    const p = proj('a');
    await c.save(p);
    await c.flush();
    expect(c.status(p)).toBe('offline');
    up = true;
    await c.flushNow();
    expect(serverRow('a')).toBeDefined();
    expect(c.status(p)).toBe('synced');
  });

  it('лимит тарифа — только на устройстве', async () => {
    const { c } = make();
    for (const id of ['a', 'b', 'c', 'd']) await c.save(proj(id));
    await c.flush();
    const rejected = ['a', 'b', 'c', 'd'].find(id => !serverRow(id))!;
    expect(c.status(proj(rejected))).toBe('limit');
  });

  it('проект в облачной комнате автора — в облаке', async () => {
    const { c } = make();
    const p = proj('a');
    await c.save(p);
    c.setCloudRoom('a');
    expect(c.status(p)).toBe('synced');
  });

  it('без облака — скрыт', () => {
    const { c } = make(memStorage(), { api: () => null });
    expect(c.status(proj('a'))).toBe('hidden');
  });
});

describe('офлайн-конфликт (SPEC_NIGHT5 §2.4)', () => {
  it('отправка несёт подпись версии с сервера; после ответа подпись обновляется', async () => {
    const bodies: Record<string, unknown>[] = [];
    api = createApiClient({ base: app.base, fetch: (async (u: string, i: RequestInit) => { if (i.method === 'PUT') bodies.push(JSON.parse(String(i.body))); return fetch(u, i); }) as typeof fetch });
    const { c } = make();
    await c.save(proj('a'));
    await c.flush();
    expect(bodies[0].baseSig).toBeUndefined();
    const sig1 = getSyncBase('a');
    expect(sig1).toMatch(/^v1:/);
    await c.save({ ...proj('a'), name: 'Два' });
    await c.flush();
    expect(bodies[1]).toMatchObject({ expectedRev: 1, baseSig: sig1 });
    expect(getSyncBase('a')).not.toBe(sig1);
  });

  it('открытие свежей версии с сервера запоминает её подпись', async () => {
    const { c } = make();
    await c.save(proj('a'));
    await c.flush();
    editStored(app, 'a', p => { p.name = 'С другого устройства'; });
    // правок на устройстве нет — при открытии берётся серверная версия
    const opened = (await c.openFresh('a'))!;
    expect(opened.name).toBe('С другого устройства');
    expect(getSyncBase('a')).toBe(contentSignature(opened));
  });

  it('правки автора с обеих сторон: копия с локальными правками, основной — с сервера, уведомление один раз', async () => {
    const conflicts: ConflictResolution[] = [];
    const { c, base } = make(memStorage(), { onConflict: r => conflicts.push(r) });
    await c.save(proj('a'));
    await c.flush();
    // другое устройство автора поменяло содержимое (не живые поля)
    editStored(app, 'a', p => { p.name = 'Правка с планшета'; });
    const mine = { ...base.data.get('a')!, pages: [{ id: 'a-p1', name: 'П', grid: 'square', elements: [rectEl('офлайн')] }] } as Project;
    await c.save(mine);
    await c.flush();
    await until(() => conflicts.length === 1);
    const r = conflicts[0];
    expect(r.id).toBe('a');
    expect(r.project.name).toBe('Правка с планшета');
    expect(base.data.get('a')!.name).toBe('Правка с планшета');
    expect(getSyncedRev('a')).toBe(serverRow('a')!.rev);
    expect(isDirty('a')).toBe(false);
    const copy = base.data.get(r.copy!.id)!;
    expect(copy.name).toBe(`Проект a${CONFLICT_COPY_SUFFIX}`);
    expect(copy.pages[0].elements.map(e => e.id)).toEqual(['офлайн']);
    // копия уходит в облако обычным путём, сервер с основным не трогается повторно
    await c.flush();
    await until(() => serverRow(r.copy!.id));
    expect(JSON.parse(serverRow('a')!.data_json).name).toBe('Правка с планшета');
    expect(conflicts).toHaveLength(1);
  });

  it('копию создать нельзя (лимит проектов) — правки в черновике при проекте, нового проекта нет', async () => {
    const conflicts: ConflictResolution[] = [];
    const { c, base } = make(memStorage(), { onConflict: r => conflicts.push(r), canCopyOnConflict: () => false });
    await c.save(proj('a'));
    await c.flush();
    editStored(app, 'a', p => { p.name = 'Правка с планшета'; });
    const mine = { ...base.data.get('a')!, pages: [{ id: 'a-p1', name: 'П', grid: 'square', elements: [rectEl('офлайн'), { id: 'img', type: 'image', x: 0, y: 0, w: 5, h: 5, src: PNG }] }] } as Project;
    await c.save(mine);
    await c.flush();
    await until(() => conflicts.length === 1);
    const r = conflicts[0];
    expect(r).toMatchObject({ id: 'a', draft: true });
    expect(r.copy).toBeUndefined();
    // на устройстве и на сервере — по одному проекту: основной взят с сервера
    expect([...base.data.keys()]).toEqual(['a']);
    expect(base.data.get('a')!.name).toBe('Правка с планшета');
    expect((app.db.prepare('SELECT COUNT(*) n FROM projects').get() as { n: number }).n).toBe(1);
    // черновик — с тем же id, картинка вынесена ссылкой и возвращается при чтении
    const stored = getConflictDraft('a')!;
    expect(stored.project.pages[0].elements.map(e => e.id)).toEqual(['офлайн', 'img']);
    expect((stored.project.pages[0].elements[1] as { src: string }).src).toMatch(/^asset:\/\//);
    const draft = (await c.conflictDraft('a'))!;
    expect((draft.pages[0].elements[1] as { src: string }).src).toBe(PNG);
    expect(c.status(base.data.get('a')!)).toBe('draft');
    // «Оставить мою версию»: черновик сохраняется поверх, отправка проходит без нового конфликта
    await c.save({ ...draft, updatedAt: Date.now() });
    c.discardConflictDraft('a');
    await c.flush();
    expect(conflicts).toHaveLength(1);
    expect(hasConflictDraft('a')).toBe(false);
    expect(JSON.parse(serverRow('a')!.data_json).pages[0].elements.map((e: { id: string }) => e.id)).toEqual(['офлайн', 'img']);
    expect(c.status(base.data.get('a')!)).toBe('synced');
  });

  it('новый конфликт заменяет черновик, удаление проекта удаляет и черновик', async () => {
    const conflicts: ConflictResolution[] = [];
    const { c, base } = make(memStorage(), { onConflict: r => conflicts.push(r), canCopyOnConflict: () => false });
    await c.save(proj('a'));
    await c.flush();
    for (const n of [1, 2]) {
      editStored(app, 'a', p => { p.name = `Планшет ${n}`; });
      await c.save({ ...base.data.get('a')!, pages: [{ id: 'a-p1', name: 'П', grid: 'square', elements: [rectEl(`офлайн${n}`)] }] } as Project);
      await c.flush();
      await until(() => conflicts.length === n);
    }
    expect([...base.data.keys()]).toEqual(['a']);
    expect(getConflictDraft('a')!.project.pages[0].elements.map(e => e.id)).toEqual(['офлайн2']);
    await c.remove('a');
    expect(hasConflictDraft('a')).toBe(false);
  });

  it('на сервере менялись только живые поля — не конфликт, прежнее слияние', async () => {
    const conflicts: ConflictResolution[] = [];
    const { c, base } = make(memStorage(), { onConflict: r => conflicts.push(r) });
    await c.save({ ...proj('a'), pages: [{ id: 'a-p1', name: 'П', grid: 'square', elements: [taskEl(), rectEl('r1')] }] } as Project);
    await c.flush();
    editStored(app, 'a', p => { p.pages[0].elements[0].attempts = [{ value: '42', timestamp: 7, isCorrect: true }]; });
    await c.save({ ...base.data.get('a')!, name: 'Моя правка' });
    await c.flush();
    expect(conflicts).toHaveLength(0);
    const stored = JSON.parse(serverRow('a')!.data_json);
    expect(stored.name).toBe('Моя правка');
    expect(stored.pages[0].elements[0].attempts).toHaveLength(1);
  });
});
