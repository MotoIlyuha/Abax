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
