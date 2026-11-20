// Что известно об облачной копии каждого проекта на этом устройстве: ревизия, с которой синхронизирован
// локальный проект. Нет записи — проект в облаке не бывал (или это новый проект).

const KEY = (id: string) => `doska.syncRev.${id}`;

export function getSyncedRev(id: string): number | null {
  try {
    const v = Number(localStorage.getItem(KEY(id)));
    return Number.isInteger(v) && v > 0 ? v : null;
  } catch { return null; }
}

export function setSyncedRev(id: string, rev: number): void {
  try { localStorage.setItem(KEY(id), String(rev)); } catch { /* хранилище недоступно */ }
}

export function clearSyncedRev(id: string): void {
  try { localStorage.removeItem(KEY(id)); } catch { /* хранилище недоступно */ }
}

// ----- Несохранённые в облаке правки -----

const DIRTY_KEY = (id: string) => `doska.syncDirty.${id}`;

/** У проекта есть правки, которых облако ещё не получило (флаг переживает перезапуск). */
export function isDirty(id: string): boolean {
  try { return localStorage.getItem(DIRTY_KEY(id)) === '1'; } catch { return false; }
}

export function setDirty(id: string): void {
  try { localStorage.setItem(DIRTY_KEY(id), '1'); } catch { /* хранилище недоступно */ }
}

export function clearDirty(id: string): void {
  try { localStorage.removeItem(DIRTY_KEY(id)); } catch { /* хранилище недоступно */ }
}

// ----- Удаления, о которых облако ещё не знает -----

const DELETES_KEY = 'doska.syncDeletes';

export function pendingDeletes(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(DELETES_KEY) || '[]') as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch { return []; }
}

function savePendingDeletes(ids: string[]): void {
  try {
    if (ids.length === 0) localStorage.removeItem(DELETES_KEY);
    else localStorage.setItem(DELETES_KEY, JSON.stringify(ids));
  } catch { /* хранилище недоступно */ }
}

export function addPendingDelete(id: string): void {
  const ids = pendingDeletes();
  if (!ids.includes(id)) savePendingDeletes([...ids, id]);
}

export function removePendingDelete(id: string): void {
  savePendingDeletes(pendingDeletes().filter(x => x !== id));
}

// ----- Стартовая заглушка (SPEC_NIGHT5 §2.1) -----

/** Имена проекта и страницы, которые получает доска, созданная на первом запуске. */
export const STARTER_PROJECT_NAME = 'Проект 1';
export const STARTER_PAGE_NAME = 'Страница 1';

const STARTER_KEY = 'doska.starter';

/** Id проекта, созданного автоматически на первом запуске и ещё не тронутого пользователем. */
export function starterId(): string | null {
  try { return localStorage.getItem(STARTER_KEY) || null; } catch { return null; }
}

export function markStarter(id: string): void {
  try { localStorage.setItem(STARTER_KEY, id); } catch { /* хранилище недоступно */ }
}

/** Снять метку (первая правка, переименование, смена настроек); id — только если метка именно у этого проекта. */
export function clearStarter(id?: string): void {
  try {
    if (id === undefined || localStorage.getItem(STARTER_KEY) === id) localStorage.removeItem(STARTER_KEY);
  } catch { /* хранилище недоступно */ }
}

interface StarterLike {
  id: string;
  name: string;
  pages: readonly { name: string; grid?: string; backgroundColor?: unknown; coordLabels?: unknown; elements: readonly unknown[]; comments?: readonly unknown[] }[];
  permissions?: unknown;
  icon?: unknown;
  pinned?: unknown;
}

/**
 * Нетронутая стартовая заглушка: автоматически созданный проект, где пользователь ничего не делал. Такой проект
 * не уходит в облако и при входе в аккаунт тихо заменяется облачным.
 */
export function isPristineStarterProject(project: StarterLike | null | undefined, starter: string | null): boolean {
  if (!project || starter === null || project.id !== starter) return false;
  if (project.name !== STARTER_PROJECT_NAME || project.pages.length !== 1) return false;
  if (project.permissions !== undefined || project.icon !== undefined || project.pinned) return false;
  const pg = project.pages[0];
  if (pg.name !== STARTER_PAGE_NAME || pg.elements.length !== 0 || (pg.comments?.length ?? 0) > 0) return false;
  if ((pg.grid ?? 'square') !== 'square' || pg.backgroundColor !== undefined || pg.coordLabels !== undefined) return false;
  return true;
}

// ----- Статус синхронизации для индикатора в шапке (SPEC_NIGHT5 §2.2) -----

export type SyncStatus = 'hidden' | 'synced' | 'syncing' | 'offline' | 'limit' | 'draft';

export interface SyncStatusInput {
  /** Облако включено (есть адрес сервера и облачное хранилище). */
  cloud: boolean;
  /** Индикатор неуместен: гость, просмотр по ссылке, проект-заглушка. */
  suppressed?: boolean;
  /** Облако не принимает проект по лимиту тарифа (plan-limit-projects / plan-limit-pages). */
  limit?: boolean;
  /** Отправка идёт или ждёт своей очереди (задержка после сохранения, догрузка картинок). */
  busy?: boolean;
  /** Последняя попытка не дошла до сервера (сеть, 5xx) и повтор ещё впереди. */
  networkError?: boolean;
  /** Проект сохраняет облачная комната автора: её соединение. */
  room?: 'open' | 'reconnecting' | null;
  /** При проекте лежит черновик офлайн-конфликта (src/conflict-draft.ts): решение за пользователем. */
  draft?: boolean;
}

export function syncStatusOf(i: SyncStatusInput): SyncStatus {
  if (!i.cloud || i.suppressed) return 'hidden';
  if (i.draft) return 'draft';
  if (i.room === 'open') return 'synced';
  if (i.room === 'reconnecting') return 'offline';
  if (i.limit) return 'limit';
  if (i.networkError) return 'offline';
  if (i.busy) return 'syncing';
  return 'synced';
}

export const SYNC_STATUS_TEXT: Record<Exclude<SyncStatus, 'hidden'>, string> = {
  synced: 'Сохранено в облаке',
  syncing: 'Синхронизация…',
  offline: 'Сохранено на устройстве (офлайн)',
  limit: 'Только на устройстве (превышен лимит тарифа)',
  draft: 'Есть офлайн-правки с этого устройства',
};

// ----- Подпись версии, совпавшей с сервером (SPEC_NIGHT5 §2.4) -----

const BASE_KEY = (id: string) => `doska.syncBase.${id}`;

export function getSyncBase(id: string): string | null {
  try { return localStorage.getItem(BASE_KEY(id)) || null; } catch { return null; }
}

export function setSyncBase(id: string, sig: string): void {
  try { localStorage.setItem(BASE_KEY(id), sig); } catch { /* хранилище недоступно */ }
}

export function clearSyncBase(id: string): void {
  try { localStorage.removeItem(BASE_KEY(id)); } catch { /* хранилище недоступно */ }
}
