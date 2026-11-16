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
