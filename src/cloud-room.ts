import { ApiError, currentSession, getApi } from './api-client';
import { myCursorId, profileName } from './profile';
import { cloudStorage, openFresh, setCloudRoomProject } from './cloud-sync';
import { cloudRoomTransport } from './collab-transport';
import { collabActive, collabReady, connectCloudHost, connectCollab, lastCollabClose, stopCollab } from './collab';
import { roomFullInfo, showRoomFullModal } from './room-full';
import { NOTICE_INVITE_GONE, NOTICE_INVITE_OFFLINE, openInviteView } from './link-view-ui';
import { loadInvite } from './link-view-cloud';
import { showCollabNotice } from './collab';
import { onDraft, onChange, state } from './state';
import { getSyncedRev, isDirty } from './sync-state';
import { signedIn } from './profile-sync';

// Облачные комнаты на стороне клиента: гость по приглашению входит в комнату на сервере (а если не получилось —
// видит проект для чтения), автор автоматически подключается к комнате своего проекта, пока у проекта есть приглашение.

export type JoinOutcome = 'room' | 'view' | 'none';

/**
 * Вход по ссылке-приглашению. 'room' — гость в комнате; 'view' — комната недоступна (например, бесплатный автор не в сети),
 * проект открыт только для чтения, причина показана; 'none' — приглашение не открылось или это ссылка самого автора.
 */
export async function joinCloudInvite(token: string, name: string): Promise<JoinOutcome> {
  const api = getApi();
  if (!api) return 'none';
  const res = await loadInvite(api, token);
  if (!res.ok) {
    const [title, text] = res.reason === 'not-found' ? NOTICE_INVITE_GONE : NOTICE_INVITE_OFFLINE;
    showCollabNotice(title, text);
    return 'none';
  }
  const inv = res.value;
  if (inv.isOwner) return 'none';
  // сессия (если уже есть) нужна комнате только чтобы проверить тариф для Pro-курсора
  const session = currentSession();
  await connectCollab(cloudRoomTransport(api.base, inv.roomCode, { name, invite: token, cursorId: myCursorId(), ...(session ? { session } : {}) }), false);
  if (await collabReady()) return 'room';
  const closed = lastCollabClose();
  stopCollab();
  const canView = inv.project.pages.length > 0;
  // мест нет (SPEC_NIGHT5 §7): окно «Комната заполнена»; под ним — проект только для чтения, если есть что показать
  const full = closed ? roomFullInfo(closed) : null;
  if (full) {
    if (canView) openInviteView(inv, token);
    showRoomFullModal({
      ...full,
      // заново — тем же путём, что и первый вход: перезагрузка по той же ссылке-приглашению
      onRetry: retryJoin,
      onReadOnly: canView ? () => { /* просмотр уже открыт под окном */ } : null,
    });
    return canView ? 'view' : 'none';
  }
  if (!canView) return 'none';
  // комнаты нет (причину гость уже видит в уведомлении): проект остаётся доступен для чтения
  openInviteView(inv, token);
  return 'view';
}

/** «Попробовать снова» у заполненной комнаты: подменяется в тестах. */
let retryJoin: () => void = () => location.reload();
export function setRoomRetryForTests(fn: (() => void) | null): void {
  retryJoin = fn ?? (() => location.reload());
}

// ----- Автор -----

/** Проект, с чьей облачной комнатой автор сейчас соединён. */
let ownerRoom: string | null = null;
let connecting = false;

export function ownerRoomProject(): string | null {
  return ownerRoom;
}

/** Выйти из облачной комнаты автора (смена проекта, приглашение отозвано, включили другую совместную работу). */
export function leaveOwnerRoom(): void {
  if (ownerRoom === null) return;
  ownerRoom = null;
  setCloudRoomProject(null);
  stopCollab();
}

/**
 * Подключить автора к облачной комнате открытого проекта, если это его проект в облаке и у него есть действующее
 * приглашение. Несохранённые правки сначала уходят на сервер: комната начинает с серверного состояния.
 * true — подключён.
 */
export async function connectOwnerRoom(): Promise<boolean> {
  const api = getApi();
  const cloud = cloudStorage();
  if (!api || !cloud || connecting || state.linkMode || onDraft()) return false;
  if (collabActive() || state.collabRole !== null) return false; // уже идёт совместная работа (в том числе P2P)
  const id = state.project.id;
  connecting = true;
  try {
    // правки последних долей секунды ещё ждут автосохранения: комната начнёт с серверного состояния, и без них
    // доска автора разошлась бы с доской гостей — сохраняем их сразу, затем отправляем всё накопленное
    if (state.dirty && state.collabRole === null) {
      state.dirty = false;
      await cloud.save(state.project);
    }
    await cloud.flush();
    if (state.project.id !== id || getSyncedRev(id) === null) return false; // проект не в облаке или сменился
    // вошедший в аккаунт владелец подключается и без приглашения: его другие устройства видят правки вживую (SPEC_NIGHT5 §2.3)
    let hasInvite = signedIn();
    if (!hasInvite) {
      try {
        hasInvite = !!(await api.request<{ invite: unknown }>('GET', `/api/invites?projectId=${encodeURIComponent(id)}`)).invite;
      } catch (e) {
        if (!(e instanceof ApiError)) throw e;
        return false;
      }
    }
    if (!hasInvite || state.project.id !== id) return false;
    const session = await api.ensureSession();
    // пока автор в комнате, проект сохраняет сама комната
    setCloudRoomProject(id);
    ownerRoom = id;
    const ok = await connectCloudHost(cloudRoomTransport(api.base, `cloud:${id}`, { name: profileName(), session, cursorId: myCursorId() }));
    if (!ok) { ownerRoom = null; setCloudRoomProject(null); stopCollab(); return false; }
    return true;
  } catch {
    if (ownerRoom === id) { ownerRoom = null; setCloudRoomProject(null); }
    return false;
  } finally {
    connecting = false;
    // пока шло подключение, открыли другой проект: его смену watchOwnerRoom пропустил (connecting) — пробуем для него
    if (state.project.id !== id && ownerRoom === null) queueMicrotask(() => { void connectOwnerRoom(); });
  }
}

/** Следит за сменой проекта и соединением: автор сам подключается к комнате и выходит из неё. Без облака ничего не делает. */
export function watchOwnerRoom(): void {
  if (!getApi()) return;
  let lastId = '';
  onChange(() => {
    if (state.project.id === lastId) return;
    lastId = state.project.id;
    if (ownerRoom !== null && ownerRoom !== lastId) leaveOwnerRoom();
    void connectOwnerRoom();
  });
  // связь с комнатой оборвалась (сервер перезапущен, приглашение отозвано, проект удалён)
  document.addEventListener('doska:collab-closed', () => {
    if (ownerRoom === null) return;
    ownerRoom = null;
    setCloudRoomProject(null);
    stopCollab();
  });
  // её заменила другая совместная работа (P2P) — проект снова сохраняется как обычно
  document.addEventListener('doska:collab-replaced', () => {
    if (ownerRoom === null) return;
    ownerRoom = null;
    setCloudRoomProject(null);
  });
  // вошли в аккаунт — открытый проект становится общим для своих устройств
  document.addEventListener('doska:account-changed', () => { if (ownerRoom === null) void connectOwnerRoom(); });
  // проект впервые попал в облако (например, на стартовой доске начали рисовать): id не менялся, поэтому смена проекта
  // этого не заметит — вошедший владелец подключается к комнате, как только у проекта появилась облачная ревизия
  const triedSynced = new Set<string>();
  cloudStorage()?.onStatus(() => {
    const id = state.project.id;
    if (ownerRoom !== null || connecting || triedSynced.has(id) || !signedIn() || getSyncedRev(id) === null) return;
    triedSynced.add(id);
    void connectOwnerRoom();
  });
  // вернулись на вкладку или в окно (планшет мог усыпить соединение) — догнать другие устройства
  const wake = () => { if (!document.hidden) void catchUpOnWake(); };
  document.addEventListener('visibilitychange', wake);
  window.addEventListener('focus', wake);
}

/** Не чаще раза в WAKE_MIN_MS. */
export const WAKE_MIN_MS = 5000;
let lastWake = -Infinity;

/**
 * Возврат на вкладку (SPEC_NIGHT5 §2.3): связь с комнатой автора жива — ничего; комнаты нет — попытка подключиться
 * (комната сама пришлёт свежее состояние), иначе — свежая версия с сервера, если своих несохранённых правок нет
 * (событие doska:cloud-fresh, доску обновляет приложение). true — запрос выполнялся.
 */
export async function catchUpOnWake(now = Date.now()): Promise<boolean> {
  if (now - lastWake < WAKE_MIN_MS) return false;
  lastWake = now;
  if (!getApi() || !cloudStorage() || state.linkMode || state.collabRole === 'guest') return false;
  if (ownerRoom !== null && collabActive()) return false;
  if (await connectOwnerRoom()) return true;
  const id = state.project.id;
  const before = getSyncedRev(id);
  if (before === null || isDirty(id) || state.dirty || collabActive()) return true;
  const fresh = await openFresh(id).catch(() => null);
  if (!fresh || state.project.id !== id || state.dirty || getSyncedRev(id) === before) return true;
  document.dispatchEvent(new CustomEvent('doska:cloud-fresh', { detail: { project: fresh } }));
  return true;
}

/** Для тестов: сбросить паузу между пробуждениями. */
export function resetWakeForTests(): void {
  lastWake = -Infinity;
}
