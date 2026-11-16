import type { Project, ProjectMeta } from './types';
import { ApiError, getApi, type ApiClient } from './api-client';
import { AssetStore, forgetUploadedAssets, uploadMissingAssets } from './asset-store';
import { assetStore, hydrateFromCloud } from './cloud-assets';
import { showToast } from './about';
import { state, uid } from './state';
import { setStorage, storage, type BoardsStorage } from './storage';
import {
  addPendingDelete, clearDirty, clearSyncedRev, getSyncedRev, isDirty, pendingDeletes, removePendingDelete, setDirty, setSyncedRev,
} from './sync-state';

// Облачная синхронизация проектов: обёртка над хранилищем устройства. Локальное хранилище остаётся главным и работает
// как раньше (без сети и без адреса сервера — ровно так); облако получает копию: проект уходит на сервер через PUT
// с задержкой после сохранения, картинки — отдельно, по хэшу, в проекте остаются ссылки asset://….

export const LIMIT_SYNC_TEXT = 'Лимит бесплатного тарифа: проект остаётся только на этом устройстве';

export type PushStatus = 'ok' | 'skipped' | 'network' | 'limit' | 'error';

export interface CloudStorageOptions {
  /** Клиент сервера; null — облако выключено. По умолчанию — общий (getApi). */
  api?: () => ApiClient | null;
  store?: AssetStore;
  /** Через сколько после сохранения проект уходит на сервер. */
  debounceMs?: number;
  /** Паузы перед повторами после сбоя сети; последняя повторяется. */
  retryMs?: number[];
  /** Сообщение пользователю (по умолчанию — тост). */
  notify?: (text: string) => void;
  /** Проекты, которые есть только на сервере (на главный экран). */
  onRemoteProjects?: (metas: ProjectMeta[]) => void;
}

export interface CloudStorage extends BoardsStorage {
  /** Открытие своего проекта: если на сервере версия новее и своих несохранённых правок нет — берётся она. */
  openFresh(id: string): Promise<Project | null>;
  /** Немедленно отправить всё накопленное и дождаться ответов. */
  flush(): Promise<void>;
  /** Начальная синхронизация: удаления, список с сервера, отправка проектов, которых там нет. */
  syncAll(): Promise<void>;
  /** Пока автор подключён к облачной комнате проекта, его сохраняет комната: PUT этого проекта не отправляется. */
  setCloudRoom(projectId: string | null): void;
  /** Проекты, найденные только на сервере. */
  remoteOnly(): ProjectMeta[];
  dispose(): void;
}

interface RemoteMeta { id: string; name?: string; title?: string; createdAt: number; updatedAt: number; pageCount: number; pinned?: boolean; icon?: string }
interface PutResult { id: string; rev: number }
interface OwnView { role: string; rev: number; project: Project }

const metaOfRemote = (r: RemoteMeta): ProjectMeta => ({
  id: r.id, name: r.name ?? r.title ?? 'Без названия', createdAt: r.createdAt, updatedAt: r.updatedAt, pageCount: r.pageCount,
  ...(r.pinned ? { pinned: true } : {}), ...(r.icon ? { icon: r.icon } : {}),
});

export function createCloudStorage(base: BoardsStorage, opts: CloudStorageOptions = {}): CloudStorage {
  const getClient = opts.api ?? getApi;
  const store = opts.store ?? assetStore;
  const debounceMs = opts.debounceMs ?? 2000;
  const retryMs = opts.retryMs ?? [5000, 15000, 60000];
  const notify = opts.notify ?? showToast;

  /** Последняя сохранённая версия каждого проекта, ещё не отправленная. */
  const pending = new Map<string, Project>();
  const versions = new Map<string, number>();
  const timers = new Map<string, number>();
  const inflight = new Map<string, Promise<PushStatus>>();
  /** Проекты, которые облако не принимает (лимит тарифа, слишком велик): до перезапуска остаются на устройстве. */
  const localOnly = new Set<string>();
  let activeRoom: string | null = null;
  let remote: ProjectMeta[] = [];
  let retryAttempt = 0;
  let retryTimer = 0;
  let limitNotified = false;
  let disposed = false;

  // ----- Отправка -----

  function schedule(id: string, ms = debounceMs): void {
    window.clearTimeout(timers.get(id));
    timers.set(id, window.setTimeout(() => { timers.delete(id); void pushNow(id); }, ms));
  }

  function scheduleRetry(): void {
    if (retryTimer || disposed) return;
    const ms = retryMs[Math.min(retryAttempt, retryMs.length - 1)];
    retryAttempt++;
    retryTimer = window.setTimeout(() => {
      retryTimer = 0;
      for (const id of pending.keys()) void pushNow(id);
    }, ms);
  }

  /** Отправки одного проекта идут по очереди: следующая уже видит ревизию, полученную предыдущей. */
  function pushNow(id: string): Promise<PushStatus> {
    const prev = inflight.get(id) ?? Promise.resolve<PushStatus>('ok');
    const p = prev.then(() => doPush(id), () => doPush(id));
    inflight.set(id, p);
    const done = () => { if (inflight.get(id) === p) inflight.delete(id); };
    p.then(done, done);
    return p;
  }

  async function putProject(api: ApiClient, project: Project): Promise<PutResult> {
    const { strippedProject, assets } = await store.extractProjectAssets(project);
    await uploadMissingAssets(assets, api);
    const send = () => api.request<PutResult>('PUT', `/api/projects/${encodeURIComponent(project.id)}`, {
      project: strippedProject, ...(getSyncedRev(project.id) !== null ? { expectedRev: getSyncedRev(project.id) } : {}),
    });
    try {
      return await send();
    } catch (e) {
      // сервер не знает картинок, которые мы считали отправленными (его базу сбросили): догружаем и пробуем ещё раз
      if (e instanceof ApiError && e.status === 409 && e.code === 'missing-assets') {
        const hashes = (e.data as { hashes?: unknown } | null)?.hashes;
        if (Array.isArray(hashes)) forgetUploadedAssets(hashes.filter((h): h is string => typeof h === 'string'));
        await uploadMissingAssets(assets, api);
        return send();
      }
      throw e;
    }
  }

  async function doPush(id: string): Promise<PushStatus> {
    const api = getClient();
    if (!api || disposed || localOnly.has(id) || activeRoom === id) return 'skipped';
    const project = pending.get(id) ?? await base.load(id).catch(() => null);
    if (!project) { pending.delete(id); clearDirty(id); return 'skipped'; }
    const version = versions.get(id) ?? 0;
    try {
      const res = await putProject(api, project);
      setSyncedRev(id, res.rev);
      retryAttempt = 0;
      if ((versions.get(id) ?? 0) === version) { pending.delete(id); clearDirty(id); } else schedule(id);
      return 'ok';
    } catch (e) {
      return handlePushError(id, e);
    }
  }

  function handlePushError(id: string, e: unknown): PushStatus {
    if (e instanceof ApiError) {
      if (e.status === 403 && (e.code === 'plan-limit-projects' || e.code === 'plan-limit-pages')) {
        localOnly.add(id);
        pending.delete(id);
        if (!limitNotified) { limitNotified = true; notify(LIMIT_SYNC_TEXT); }
        return 'limit';
      }
      if (e.status === 409 && e.code === 'id-taken') {
        // такой id уже занят чужим проектом (например, один файл импортировали в две учётные записи): проект получает новый id
        void rekey(id);
        return 'ok';
      }
      if (e.status === 0 || e.status >= 500 || e.status === 401 || e.status === 429) { scheduleRetry(); return 'network'; }
      // 400, 413 и прочее: повтор ничего не изменит
      localOnly.add(id);
      pending.delete(id);
      return 'error';
    }
    scheduleRetry();
    return 'network';
  }

  /** Новый id локальному проекту: хранилище, открытая доска и список перенастраиваются, отправка идёт заново. */
  async function rekey(oldId: string): Promise<void> {
    const project = pending.get(oldId) ?? await base.load(oldId).catch(() => null);
    if (!project) return;
    const next: Project = { ...project, id: uid() };
    await base.save(next);
    await base.remove(oldId);
    pending.delete(oldId);
    versions.delete(oldId);
    window.clearTimeout(timers.get(oldId));
    timers.delete(oldId);
    clearSyncedRev(oldId);
    clearDirty(oldId);
    if (state.project.id === oldId) {
      state.project = { ...state.project, id: next.id };
      try { localStorage.setItem('doska.last', JSON.stringify({ pid: next.id, pageId: state.pageId })); } catch { /* не запомним */ }
    }
    state.projects = state.projects.map(m => (m.id === oldId ? { ...m, id: next.id } : m));
    pending.set(next.id, state.project.id === next.id ? state.project : next);
    versions.set(next.id, 1);
    setDirty(next.id);
    schedule(next.id, 0);
  }

  // ----- Чтение -----

  /** Свой проект с сервера (с картинками); null — его там нет, он чужой или сервер недоступен. */
  async function fetchOwn(api: ApiClient, id: string): Promise<{ project: Project; rev: number } | null> {
    try {
      const r = await api.request<OwnView>('GET', `/api/projects/${encodeURIComponent(id)}`);
      if (r.role !== 'host') return null;
      return { project: await hydrateFromCloud(r.project, api, store), rev: r.rev };
    } catch { return null; }
  }

  async function openFresh(id: string): Promise<Project | null> {
    const local = await base.load(id);
    const api = getClient();
    if (!api || pendingDeletes().includes(id)) return local;
    const synced = getSyncedRev(id);
    if (local && synced === null) return local; // в облаке не бывал — сверять не с чем
    let view: OwnView;
    try {
      view = await api.request<OwnView>('GET', `/api/projects/${encodeURIComponent(id)}`);
    } catch (e) {
      // 404: на сервере проекта нет (удалили с другого устройства или сбросили базу) — локальный остаётся и уйдёт как новый
      if (local && e instanceof ApiError && e.status === 404) clearSyncedRev(id);
      return local;
    }
    if (view.role !== 'host') return local;
    if (local && synced !== null && view.rev <= synced) return local;
    if (local && isDirty(id)) return local; // правки есть с обеих сторон: сохранение автора сольётся на сервере (mergeStale)
    const project = await hydrateFromCloud(view.project, api, store);
    await base.save(project);
    setSyncedRev(id, view.rev);
    clearDirty(id);
    return project;
  }

  // ----- Начальная синхронизация -----

  async function sendDeletes(api: ApiClient): Promise<void> {
    for (const id of pendingDeletes()) {
      try {
        await api.request('DELETE', `/api/projects/${encodeURIComponent(id)}`);
      } catch (e) {
        if (!(e instanceof ApiError && e.status === 404)) return; // сеть — в другой раз
      }
      removePendingDelete(id);
    }
  }

  async function syncAll(): Promise<void> {
    const api = getClient();
    if (!api || disposed) return;
    await sendDeletes(api);
    let list: RemoteMeta[];
    try {
      list = (await api.request<{ projects: RemoteMeta[] }>('GET', '/api/projects')).projects;
    } catch { scheduleRetryAll(); return; }
    const gone = new Set(pendingDeletes());
    const localMetas = await base.list();
    const localIds = new Set(localMetas.map(m => m.id));
    remote = list.filter(r => !gone.has(r.id) && !localIds.has(r.id)).map(metaOfRemote);
    opts.onRemoteProjects?.(remote);
    const onServer = new Set(list.map(r => r.id));
    for (const m of localMetas) {
      if (localOnly.has(m.id) || activeRoom === m.id || pending.has(m.id)) continue;
      if (onServer.has(m.id) && getSyncedRev(m.id) !== null && !isDirty(m.id)) continue; // уже в облаке и без новых правок
      const status = await pushNow(m.id);
      if (status === 'network') return; // сети нет — остальное в следующий раз
    }
  }

  function scheduleRetryAll(): void {
    if (retryTimer || disposed) return;
    const ms = retryMs[Math.min(retryAttempt, retryMs.length - 1)];
    retryAttempt++;
    retryTimer = window.setTimeout(() => { retryTimer = 0; void syncAll().catch(() => {}); }, ms);
  }

  // ----- BoardsStorage -----

  return {
    list: () => base.list(),

    async load(id) {
      const local = await base.load(id);
      if (local) return local;
      const api = getClient();
      if (!api || pendingDeletes().includes(id)) return null;
      return (await fetchOwn(api, id))?.project ?? null;
    },

    async save(project) {
      await base.save(project);
      if (!getClient() || disposed) return;
      pending.set(project.id, project);
      versions.set(project.id, (versions.get(project.id) ?? 0) + 1);
      setDirty(project.id);
      schedule(project.id);
    },

    async remove(id) {
      await base.remove(id);
      window.clearTimeout(timers.get(id));
      timers.delete(id);
      pending.delete(id);
      versions.delete(id);
      clearSyncedRev(id);
      clearDirty(id);
      remote = remote.filter(m => m.id !== id);
      const api = getClient();
      if (!api) return;
      try {
        await api.request('DELETE', `/api/projects/${encodeURIComponent(id)}`);
      } catch (e) {
        if (!(e instanceof ApiError && e.status === 404)) addPendingDelete(id);
      }
    },

    openFresh,

    async flush() {
      for (const t of timers.values()) window.clearTimeout(t);
      timers.clear();
      await Promise.all([...pending.keys()].map(id => pushNow(id)));
      await Promise.all([...inflight.values()]);
    },

    syncAll,

    setCloudRoom(projectId) {
      activeRoom = projectId;
      if (projectId === null) for (const id of pending.keys()) schedule(id);
    },

    remoteOnly: () => remote,

    dispose() {
      disposed = true;
      for (const t of timers.values()) window.clearTimeout(t);
      timers.clear();
      window.clearTimeout(retryTimer);
      retryTimer = 0;
    },
  };
}

// ----- Общее облачное хранилище приложения -----

let shared: CloudStorage | null = null;

/** Подключает облако к приложению: хранилище проектов становится облачным. Без адреса сервера — ничего не меняется. */
export function initCloudSync(hooks: Pick<CloudStorageOptions, 'onRemoteProjects'> = {}): CloudStorage | null {
  if (shared) return shared;
  if (!getApi()) return null;
  const cloud = createCloudStorage(storage, hooks);
  shared = cloud;
  setStorage(cloud);
  // уход в фон: отправляем сразу, не дожидаясь задержки
  document.addEventListener('visibilitychange', () => { if (document.hidden) void cloud.flush().catch(() => {}); });
  return cloud;
}

/** Фоновая синхронизация после запуска: проекты устройства уходят в облако, серверные появляются в списке. */
export function startBackgroundSync(): void {
  void shared?.syncAll().catch(() => {});
}

/** Открыть свой проект с учётом облака (без облака — просто загрузка). */
export function openFresh(id: string): Promise<Project | null> {
  return shared ? shared.openFresh(id) : storage.load(id);
}

export function cloudStorage(): CloudStorage | null {
  return shared;
}

/** Автор подключён к облачной комнате этого проекта (null — отключён). */
export function setCloudRoomProject(id: string | null): void {
  shared?.setCloudRoom(id);
}

/** Объединённый список: проекты устройства и найденные только на сервере. */
export function mergeRemoteMetas(local: ProjectMeta[], remoteOnly: ProjectMeta[]): ProjectMeta[] {
  const ids = new Set(local.map(m => m.id));
  return [...local, ...remoteOnly.filter(m => !ids.has(m.id))].sort((a, b) => b.updatedAt - a.updatedAt);
}

