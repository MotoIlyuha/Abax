import { state, onChange } from './state';
import { PRESENCE_EVENT, VIEW_SEND_MS, collabActive, collabUsers, myCollabId, type CollabGotoDetail, type CollabUser } from './collab';
import { showPill } from './activity-pills';

// «Следить за участником»: мой экран повторяет страницу и камеру выбранного участника. Режим только у меня —
// участник ничего не замечает, хабы о нём не знают. Выход — любое своё перемещение по холсту (панорама, колесо,
// щипок, масштаб с клавиатуры) или переход на другую страницу. Участник на скрытой от меня странице — ждём на месте.

/** Длительность подтягивания камеры за участником, пока он двигается (вид приходит не чаще VIEW_SEND_MS). */
export const FOLLOW_ANIM_MS = VIEW_SEND_MS;

/** Следующий шаг слежения по свежей записи участника. */
export type FollowStep =
  | { kind: 'gone' }
  | { kind: 'wait' }
  | { kind: 'same' }
  | { kind: 'go'; key: string; detail: CollabGotoDetail };

/**
 * Решение слежения (чистая функция): участник ушёл — gone; на скрытой странице, черновике или странице, которой у меня
 * нет, — wait; его страница и вид не изменились с прошлого шага (lastKey) — same; иначе — go к его странице и центру
 * экрана с его масштабом. Первый шаг и смена страницы — обычный перелёт, дальше — короткое подтягивание.
 */
export function followStep(u: CollabUser | undefined, pageIds: readonly string[], lastKey: string): FollowStep {
  if (!u) return { kind: 'gone' };
  if (u.hiddenPage || !u.pageId || !pageIds.includes(u.pageId)) return { kind: 'wait' };
  const view = u.view && u.view.pageId === u.pageId ? u.view : null;
  const key = view ? `${u.pageId}|${view.vx}|${view.vy}|${view.vz}` : `${u.pageId}|`;
  if (key === lastKey) return { kind: 'same' };
  const samePage = lastKey.startsWith(`${u.pageId}|`);
  const detail: CollabGotoDetail = {
    pageId: u.pageId, reason: 'follow',
    ...(view ? { x: view.vx, y: view.vy, zoom: view.vz } : {}),
    ...(samePage && view ? { ms: FOLLOW_ANIM_MS } : {}),
  };
  return { kind: 'go', key, detail };
}

let followUid: number | null = null;
let followName = '';
let lastKey = '';
/** Страница, на которой я был при прошлой проверке, и страница, куда меня ведёт слежение. */
let seenPage = '';
let targetPage = '';
let waiting = false;
const listeners = new Set<() => void>();

function notify(): void { for (const fn of listeners) fn(); }

/** За кем слежу (номер участника в комнате); null — не слежу. */
export function followingUid(): number | null { return followUid; }
/** Участник, за которым слежу, сейчас на недоступной мне странице: экран стоит на месте. */
export function followWaiting(): boolean { return followUid !== null && waiting; }
/** Режим слежения включился, выключился или участник ушёл на скрытую страницу и вернулся. */
export function onFollowChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Начать следить за участником uid (сразу переходим к нему). */
export function startFollow(uid: number): void {
  if (!collabActive() || uid === myCollabId()) return;
  const u = collabUsers().find(x => x.userId === uid);
  if (!u) return;
  followUid = uid;
  followName = String(u.name ?? '') || 'Участник';
  lastKey = '';
  seenPage = state.pageId;
  targetPage = '';
  waiting = false;
  notify();
  syncFollow();
}

/** Перестать следить (pill — пояснение пилюлей). */
export function stopFollow(pill?: string): void {
  if (followUid === null) return;
  followUid = null;
  lastKey = '';
  targetPage = '';
  waiting = false;
  if (pill) showPill({ kind: 'info', text: pill });
  notify();
}

/** Я сам сдвинул камеру (панорама, колесо, щипок, масштаб): слежение выключается. */
export function stopFollowByUser(): void { stopFollow(); }

/** Свежий снимок участников: идём за участником, если его страница или вид изменились. */
export function syncFollow(): void {
  if (followUid === null) return;
  if (!collabActive() || state.view !== 'board') { stopFollow(); return; }
  const uid = followUid;
  const step = followStep(collabUsers().find(x => x.userId === uid), state.project.pages.map(p => p.id), lastKey);
  if (step.kind === 'gone') { stopFollow(`${followName} покинул доску — слежение остановлено`); return; }
  const wait = step.kind === 'wait';
  if (wait !== waiting) { waiting = wait; notify(); }
  if (step.kind !== 'go') return;
  lastKey = step.key;
  targetPage = step.detail.pageId;
  document.dispatchEvent(new CustomEvent<CollabGotoDetail>('doska:collab-goto', { detail: step.detail }));
}

/** Своя смена страницы (не туда, куда ведёт слежение) или выход с доски — слежение выключается. */
function checkOwnMove(): void {
  if (followUid === null) { seenPage = state.pageId; return; }
  if (!collabActive() || state.view !== 'board') { stopFollow(); return; }
  if (state.pageId === seenPage) return;
  seenPage = state.pageId;
  const u = collabUsers().find(x => x.userId === followUid);
  if (state.pageId !== targetPage && state.pageId !== u?.pageId) stopFollow();
}

let inited = false;
export function initFollow(): void {
  if (inited) return;
  inited = true;
  document.addEventListener(PRESENCE_EVENT, syncFollow);
  onChange(checkOwnMove);
}
