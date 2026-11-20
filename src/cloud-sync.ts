import type { Project, ProjectMeta } from './types';
import { ApiError, getApi, type ApiClient } from './api-client';
import { AssetStore, forgetUploadedAssets, uploadMissingAssets } from './asset-store';
import { assetStore, hydrateFromCloud } from './cloud-assets';
import { showToast } from './about';
import { projectMeta, state, uid } from './state';
import { setStorage, storage, type BoardsStorage } from './storage';
import {
  addPendingDelete, clearDirty, clearStarter, clearSyncBase, clearSyncedRev, getSyncBase, getSyncedRev, isDirty, isPristineStarterProject,
  pendingDeletes, removePendingDelete, setDirty, setSyncBase, setSyncedRev, starterId, syncStatusOf, type SyncStatus,
} from './sync-state';
import { contentSignature } from './sync-conflict';
import { clearConflictDraft, getConflictDraft, hasConflictDraft, setConflictDraft } from './conflict-draft';

// Облачная синхронизация проектов: обёртка над хранилищем устройства. Локальное хранилище остаётся главным и работает
// как раньше (без сети и без адреса сервера — ровно так); облако получает копию: проект уходит на сервер через PUT
// с задержкой после сохранения, картинки — отдельно, по хэшу, в проекте остаются ссылки asset://….

export const LIMIT_SYNC_TEXT = 'Лимит бесплатного тарифа: проект остаётся только на этом устройстве';

export type PushStatus = 'ok' | 'skipped' | 'network' | 'limit' | 'error' | 'conflict';

/** Суффикс имени копии при настоящем офлайн-конфликте (SPEC_NIGHT5 §2.4). */
export const CONFLICT_COPY_SUFFIX = ' (копия с устройства)';
export const CONFLICT_TEXT = 'Проект обновился с другого устройства. Ваши офлайн-правки сохранены в копию';
export const CONFLICT_DRAFT_TEXT = 'Проект обновился с другого устройства. Ваши офлайн-правки сохранены черновиком';

/**
 * Итог офлайн-конфликта: основной проект — серверная версия, локальные правки — в копии или (копию создать нельзя:
 * лимит проектов тарифа) — в черновике при проекте (src/conflict-draft.ts).
 */
export interface ConflictResolution {
  id: string;
  /** Серверная версия основного проекта (с картинками), уже сохранённая на устройстве. */
  project: Project;
  /** Копия с локальными правками; нет — правки в черновике. */
  copy?: ProjectMeta;
  /** Правки сохранены черновиком при проекте. */
  draft?: boolean;
}

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
  /** Начальная синхронизация получила список проектов сервера (все, кроме удаляемых) — замена стартовой заглушки. */
  onSynced?: (metas: ProjectMeta[]) => void;
  /** Настоящий офлайн-конфликт разрешён: основной проект взят с сервера, локальные правки — в копии. */
  onConflict?: (r: ConflictResolution) => void;
  /**
   * Можно ли сохранить офлайн-правки отдельным проектом-копией (по умолчанию — да). Нет (лимит проектов тарифа) —
   * правки уходят в черновик при проекте: иначе конфликт создавал бы проекты в обход лимита.
   */
  canCopyOnConflict?: () => boolean;
}

export interface CloudStorage extends BoardsStorage {
  /** Открытие своего проекта: если на сервере версия новее и своих несохранённых правок нет — берётся она. */
  openFresh(id: string): Promise<Project | null>;
  /** Немедленно отправить всё накопленное и дождаться ответов. */
  flush(): Promise<void>;
  /** То же, что flush, но и без ожидания паузы перед повтором после сбоя сети (клик по индикатору «офлайн»). */
  flushNow(): Promise<void>;
  /** Статус синхронизации проекта для индикатора в шапке (SPEC_NIGHT5 §2.2). */
  status(project: Project): SyncStatus;
  /** Подписка на изменения статусов; возвращает отписку. */
  onStatus(fn: () => void): () => void;
  /** Удалить проект только с устройства: без запроса на сервер и без отложенного удаления (замена заглушки). */
  removeLocal(id: string): Promise<void>;
  /** Начальная синхронизация: удаления, список с сервера, отправка проектов, которых там нет. */
  syncAll(): Promise<void>;
  /** Пока автор подключён к облачной комнате проекта, его сохраняет комната: PUT этого проекта не отправляется. */
  setCloudRoom(projectId: string | null): void;
  /** Проекты, найденные только на сервере. */
  remoteOnly(): ProjectMeta[];
  /** Черновик офлайн-конфликта проекта с картинками; null — черновика нет. */
  conflictDraft(id: string): Promise<Project | null>;
  /** Удалить черновик офлайн-конфликта. */
  discardConflictDraft(id: string): void;
  dispose(): void;
}

interface RemoteMeta { id: string; name?: string; title?: string; createdAt: number; updatedAt: number; pageCount: number; pinned?: boolean; icon?: string }
interface PutResult {
  id: string; rev: number;
  /** Сервер добавил к присланному то, чего у клиента нет (ответы, реакции, комментарии). */ merged?: boolean;
  /** Подпись содержимого записанной версии (SPEC_NIGHT5 §2.4). */ sig?: string;
}
interface OwnView { role: string; rev: number; project: Project; sig?: string }

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
  const canCopyOnConflict = opts.canCopyOnConflict ?? (() => true);

  /** Последняя сохранённая версия каждого проекта, ещё не отправленная. */
  const pending = new Map<string, Project>();
  const versions = new Map<string, number>();
  const timers = new Map<string, number>();
  const inflight = new Map<string, Promise<PushStatus>>();
  /** Проекты, которые облако не принимает (лимит тарифа, слишком велик): до перезапуска остаются на устройстве. */
  const localOnly = new Set<string>();
  /** Из них — не принятые по лимиту тарифа (индикатор «только на устройстве»). */
  const limited = new Set<string>();
  /** Последняя попытка отправки не дошла до сервера (сеть, 5xx), повтор впереди. */
  const netFailed = new Set<string>();
  const statusListeners = new Set<() => void>();
  const emit = () => { for (const fn of [...statusListeners]) { try { fn(); } catch (e) { console.error(e); } } };
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
    emit();
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
  function pushNow(id: string, force = false): Promise<PushStatus> {
    const prev = inflight.get(id) ?? Promise.resolve<PushStatus>('ok');
    const p = prev.then(() => doPush(id, force), () => doPush(id, force));
    inflight.set(id, p);
    emit();
    const done = () => { if (inflight.get(id) === p) inflight.delete(id); emit(); };
    p.then(done, done);
    return p;
  }

  async function putProject(api: ApiClient, project: Project): Promise<PutResult> {
    const { strippedProject, assets } = await store.extractProjectAssets(project);
    await uploadMissingAssets(assets, api);
    // baseSig — подпись версии, совпавшей с сервером: по ней сервер отличает настоящий конфликт от правок мимо автора
    const send = () => {
      const expectedRev = getSyncedRev(project.id);
      const baseSig = expectedRev !== null ? getSyncBase(project.id) : null;
      return api.request<PutResult>('PUT', `/api/projects/${encodeURIComponent(project.id)}`, {
        project: strippedProject, ...(expectedRev !== null ? { expectedRev } : {}), ...(baseSig ? { baseSig } : {}),
      });
    };
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

  async function doPush(id: string, force: boolean): Promise<PushStatus> {
    const api = getClient();
    if (!api || disposed || localOnly.has(id) || activeRoom === id) return 'skipped';
    // отправка, стоявшая в очереди за предыдущей, могла остаться без дела: всё уже ушло (force — проект без облачной копии)
    if (!force && !pending.has(id)) return 'skipped';
    const project = pending.get(id) ?? await base.load(id).catch(() => null);
    if (!project) { pending.delete(id); clearDirty(id); return 'skipped'; }
    // нетронутая стартовая заглушка в облако не уходит (SPEC_NIGHT5 §2.1)
    if (isPristineStarterProject(project, starterId())) { pending.delete(id); clearDirty(id); return 'skipped'; }
    const version = versions.get(id) ?? 0;
    try {
      const res = await putProject(api, project);
      // сервер добавил чужой ввод, которого в нашей копии нет: помним предыдущую ревизию — следующее сохранение сольётся снова,
      // а при открытии (если своих правок нет) подтянется серверная версия
      setSyncedRev(id, res.merged && res.rev > 1 ? res.rev - 1 : res.rev);
      if (typeof res.sig === 'string') setSyncBase(id, res.sig);
      netFailed.delete(id);
      retryAttempt = 0;
      if ((versions.get(id) ?? 0) === version) { pending.delete(id); clearDirty(id); } else schedule(id);
      return 'ok';
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && e.code === 'rev-conflict') return resolveConflict(api, id, project);
      return handlePushError(id, e);
    }
  }

  /**
   * Настоящий офлайн-конфликт (SPEC_NIGHT5 §2.4): локальная версия уходит в копию «<Имя> (копия с устройства)»,
   * основной проект берётся с сервера. Сервер недоступен — повтор позже (отправка снова получит 409).
   */
  async function resolveConflict(api: ApiClient, id: string, local: Project): Promise<PushStatus> {
    let view: OwnView;
    let server: Project;
    try {
      view = await api.request<OwnView>('GET', `/api/projects/${encodeURIComponent(id)}`);
      if (view.role !== 'host') throw new Error('not-owner');
      server = await hydrateFromCloud(view.project, api, store);
    } catch {
      scheduleRetry();
      netFailed.add(id);
      emit();
      return 'network';
    }
    // правки, пришедшие после неудачной отправки, тоже сохраняются
    const mine = pending.get(id) ?? local;
    const now = Date.now();
    let copyMeta: ProjectMeta | undefined;
    // копию создать нельзя (лимит проектов) — черновик при проекте; не записался (хранилище переполнено) — всё же копия:
    // правки дороже лимита
    const draft = !canCopyOnConflict() && setConflictDraft((await store.extractProjectAssets(mine)).strippedProject, now);
    if (!draft) {
      const copy: Project = { ...structuredClone(mine), id: uid(), name: `${mine.name}${CONFLICT_COPY_SUFFIX}`, createdAt: now, updatedAt: now };
      await base.save(copy);
      clearSyncBase(copy.id);
      clearSyncedRev(copy.id);
      pending.set(copy.id, copy);
      versions.set(copy.id, 1);
      setDirty(copy.id);
      schedule(copy.id, 0);
      copyMeta = projectMeta(copy);
      state.projects = [copyMeta, ...state.projects.filter(m => m.id !== copyMeta!.id)];
    }
    // основной — серверная версия
    pending.delete(id);
    versions.delete(id);
    window.clearTimeout(timers.get(id));
    timers.delete(id);
    await base.save(server);
    setSyncedRev(id, view.rev);
    setSyncBase(id, typeof view.sig === 'string' ? view.sig : contentSignature(view.project));
    clearDirty(id);
    netFailed.delete(id);
    emit();
    opts.onConflict?.(copyMeta ? { id, project: server, copy: copyMeta } : { id, project: server, draft: true });
    return 'conflict';
  }

  function handlePushError(id: string, e: unknown): PushStatus {
    if (e instanceof ApiError) {
      if (e.status === 403 && (e.code === 'plan-limit-projects' || e.code === 'plan-limit-pages')) {
        localOnly.add(id);
        limited.add(id);
        netFailed.delete(id);
        pending.delete(id);
        emit();
        if (!limitNotified) { limitNotified = true; notify(LIMIT_SYNC_TEXT); }
        return 'limit';
      }
      if (e.status === 409 && e.code === 'id-taken') {
        // такой id уже занят чужим проектом (например, один файл импортировали в две учётные записи): проект получает новый id
        void rekey(id);
        return 'ok';
      }
      if (e.status === 0 || e.status >= 500 || e.status === 401 || e.status === 429) { scheduleRetry(); netFailed.add(id); emit(); return 'network'; }
      // 400, 413 и прочее: повтор ничего не изменит
      localOnly.add(id);
      pending.delete(id);
      emit();
      return 'error';
    }
    scheduleRetry();
    netFailed.add(id);
    emit();
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
    clearSyncBase(oldId);
    clearDirty(oldId);
    clearConflictDraft(oldId);
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
    setSyncBase(id, typeof view.sig === 'string' ? view.sig : contentSignature(view.project));
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
    opts.onSynced?.(list.filter(r => !gone.has(r.id)).map(metaOfRemote));
    const onServer = new Set(list.map(r => r.id));
    const starter = starterId();
    for (const m of localMetas) {
      if (localOnly.has(m.id) || activeRoom === m.id || pending.has(m.id)) continue;
      if (onServer.has(m.id) && getSyncedRev(m.id) !== null && !isDirty(m.id)) continue; // уже в облаке и без новых правок
      if (m.id === starter && isPristineStarterProject(await base.load(m.id).catch(() => null), starter)) continue;
      const status = await pushNow(m.id, true);
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
      // заглушка, в которой что-то поменяли (имя, настройки, страницы), — обычный проект
      const starter = starterId();
      if (starter === project.id) {
        if (isPristineStarterProject(project, starter)) return;
        clearStarter(project.id);
      }
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
      clearSyncBase(id);
      clearDirty(id);
      clearConflictDraft(id);
      limited.delete(id);
      netFailed.delete(id);
      remote = remote.filter(m => m.id !== id);
      emit();
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

    async flushNow() {
      window.clearTimeout(retryTimer);
      retryTimer = 0;
      retryAttempt = 0;
      for (const t of timers.values()) window.clearTimeout(t);
      timers.clear();
      emit();
      await Promise.all([...pending.keys()].map(id => pushNow(id)));
      await Promise.all([...inflight.values()]);
    },

    status(project) {
      const id = project.id;
      return syncStatusOf({
        cloud: !!getClient() && !disposed,
        suppressed: isPristineStarterProject(project, starterId()),
        limit: limited.has(id),
        busy: pending.has(id) || inflight.has(id) || timers.has(id),
        networkError: netFailed.has(id) && (pending.has(id) || inflight.has(id)),
        room: activeRoom === id ? 'open' : null,
        draft: hasConflictDraft(id),
      });
    },

    async conflictDraft(id) {
      const d = getConflictDraft(id);
      return d ? hydrateFromCloud(d.project, getClient(), store) : null;
    },

    discardConflictDraft(id) {
      clearConflictDraft(id);
      emit();
    },

    onStatus(fn) {
      statusListeners.add(fn);
      return () => { statusListeners.delete(fn); };
    },

    async removeLocal(id) {
      await base.remove(id);
      window.clearTimeout(timers.get(id));
      timers.delete(id);
      pending.delete(id);
      versions.delete(id);
      clearSyncedRev(id);
      clearSyncBase(id);
      clearDirty(id);
      emit();
    },

    syncAll,

    setCloudRoom(projectId) {
      activeRoom = projectId;
      if (projectId === null) for (const id of pending.keys()) schedule(id);
      emit();
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
export function initCloudSync(hooks: Pick<CloudStorageOptions, 'onRemoteProjects' | 'onSynced' | 'onConflict' | 'canCopyOnConflict'> = {}): CloudStorage | null {
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

