// Аккаунт на сервере и синхронизация профиля (SPEC_NIGHT4 §8).
// Вошёл и у аккаунта своё имя — имя и курсор аккаунта переходят на устройство (сервер главнее);
// иначе имя и курсор устройства уходят на сервер. Дальше каждое изменение профиля — PATCH /api/me.
// Без облака ничего не делает; ошибки сети тихие.

import { ApiError, getApi, type ApiClient, type MeResponse } from './api-client';
import { applyServerPlan } from './plan';
import { getProfile, notifyProfileChanged, onProfileChange, setProfile } from './profile';
import { isCursorId } from './cursors';

let current: MeResponse | null = null;
const listeners = new Set<(me: MeResponse | null) => void>();
/** Профиль сейчас переписывается из аккаунта — эту запись обратно на сервер не отправляем. */
let applying = false;

/** Последний ответ сервера о пользователе (null — облака нет или ещё не спрашивали). */
export function account(): MeResponse | null {
  return current;
}

/** Вошёл ли пользователь (есть хоть один способ входа). */
export function signedIn(): boolean {
  return !!current && !current.user.isAnonymous;
}

export function onAccountChange(fn: (me: MeResponse | null) => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** Запомнить ответ сервера: тариф, аккаунт; профиль — по правилу §8.1. */
export function setAccount(me: MeResponse | null, api: ApiClient | null = getApi()): void {
  current = me;
  if (me) {
    applyServerPlan({ plan: me.plan, limitsEnforced: me.limitsEnforced });
    if (!me.user.isAnonymous && me.user.nameCustom) {
      // сервер главнее: имя и курсор аккаунта — на устройство
      applying = true;
      try {
        setProfile({ name: me.user.displayName, ...(isCursorId(me.user.cursorId) ? { cursorId: me.user.cursorId } : {}) });
      } finally { applying = false; }
    } else if (getProfile().onboarded) {
      void pushProfile(api);
    }
  }
  // тариф мог поменяться — действующий курсор тоже
  notifyProfileChanged();
  for (const fn of [...listeners]) {
    try { fn(me); } catch (e) { console.error(e); }
  }
}

/** Спросить сервер о пользователе и применить ответ. false — облака нет или сервер недоступен. */
export async function syncAccount(api: ApiClient | null = getApi()): Promise<boolean> {
  if (!api) return false;
  try {
    setAccount(await api.me(), api);
    return true;
  } catch { return false; }
}

/** Отправить имя и курсор устройства на сервер; Pro-курсор без тарифа остаётся только на устройстве. */
export async function pushProfile(api: ApiClient | null = getApi()): Promise<void> {
  if (!api) return;
  const p = getProfile();
  const body: { displayName?: string; cursorId?: string } = { cursorId: p.cursorId };
  if (p.name) body.displayName = p.name;
  const same = current && (!body.displayName || (current.user.nameCustom && current.user.displayName === body.displayName))
    && current.user.cursorId === body.cursorId;
  if (same) return;
  try {
    current = await api.request<MeResponse>('PATCH', '/api/me', body);
  } catch (e) {
    if (e instanceof ApiError && e.code === 'plan-cursor' && body.displayName) {
      try { current = await api.request<MeResponse>('PATCH', '/api/me', { displayName: body.displayName }); } catch { /* тихо */ }
    }
  }
}

let timer: ReturnType<typeof setTimeout> | null = null;
let stopWatch: (() => void) | null = null;

/** Следить за профилем: изменения уходят на сервер (с небольшой паузой). Без облака — ничего. */
export function startProfileSync(delayMs = 400): void {
  if (stopWatch || !getApi()) return;
  stopWatch = onProfileChange(() => {
    if (applying || !getProfile().onboarded) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; void pushProfile(); }, delayMs);
  });
}

/** Для тестов. */
export function resetProfileSyncForTests(): void {
  current = null;
  listeners.clear();
  stopWatch?.();
  stopWatch = null;
  if (timer) clearTimeout(timer);
  timer = null;
}
