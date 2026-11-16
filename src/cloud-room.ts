import { ApiError, getApi } from './api-client';
import { cloudStorage, setCloudRoomProject } from './cloud-sync';
import { cloudRoomTransport } from './collab-transport';
import { collabActive, collabReady, connectCloudHost, connectCollab, stopCollab } from './collab';
import { NOTICE_INVITE_GONE, NOTICE_INVITE_OFFLINE, openInviteView } from './link-view-ui';
import { loadInvite } from './link-view-cloud';
import { showCollabNotice } from './collab';
import { onDraft, onChange, state } from './state';
import { getSyncedRev } from './sync-state';

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
  await connectCollab(cloudRoomTransport(api.base, inv.roomCode, { name, invite: token }), false);
  if (await collabReady()) return 'room';
  // комнаты нет (причину гость уже видит в уведомлении): проект остаётся доступен для чтения
  stopCollab();
  openInviteView(inv, token);
  return 'view';
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
    await cloud.flush();
    if (state.project.id !== id || getSyncedRev(id) === null) return false; // проект не в облаке или сменился
    let hasInvite = false;
    try {
      hasInvite = !!(await api.request<{ invite: unknown }>('GET', `/api/invites?projectId=${encodeURIComponent(id)}`)).invite;
    } catch (e) {
      if (!(e instanceof ApiError)) throw e;
      return false;
    }
    if (!hasInvite || state.project.id !== id) return false;
    const session = await api.ensureSession();
    // пока автор в комнате, проект сохраняет сама комната
    setCloudRoomProject(id);
    ownerRoom = id;
    const ok = await connectCloudHost(cloudRoomTransport(api.base, `cloud:${id}`, { name: '', session }));
    if (!ok) { ownerRoom = null; setCloudRoomProject(null); stopCollab(); return false; }
    return true;
  } catch {
    if (ownerRoom === id) { ownerRoom = null; setCloudRoomProject(null); }
    return false;
  } finally { connecting = false; }
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
}
