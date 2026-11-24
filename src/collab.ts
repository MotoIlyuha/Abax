import type { CommentThread, Element, FadeStroke, GridMode, Page, PageRight, Project, ProjectMeta, Pt } from './types';
import { roleLabel, type AccessRole, type ParticipantCaps } from './access';
import { state, openProject, setSelection, setCopyGuard, setTouchGuard, isDraftId, onDraft, onChange, touchProject, update, setFadeStrokeEnd } from './state';
import { MAX_PATCH_OPS, applyBoardPatch, diffElements, isBoardPatch, type BoardPatch } from './delta';
import { gestureActive } from './gesture';
import { sanitizeComments } from './file';
import { clientId } from './identity';
import { DEFAULT_CURSOR_ID, cursorPreset, cursorSvg, isCursorId } from './cursors';
import { fxForget, fxMove } from './cursor-fx';
import { myAvatar, myCursorId, onProfileChange, profileName } from './profile';
import { PHOTO_KEY, isAvatarEmoji, isAvatarPhoto } from './avatar-value';
import { setStorage, storage, type BoardsStorage } from './storage';
import { getApi } from './api-client';
import { hydrateFromCloud } from './cloud-assets';
import { diffUsers, showUserEvents } from './activity-pills';
import { clearNotifyStack } from './notify-stack';
import { chatReceive, chatReset, setChatAvatarLookup, setChatAvailable, setChatCanWrite, setChatSender } from './collab-chat';
import type { ChatAttachment } from './room-chat';
import { clearNotices, pushNotice } from './notify-center';
import { viewCenter, viewportSize } from './camera-anim';
import { cancelActiveInteraction } from './interaction';
import { nearestAvailablePage } from './presence';
import { cursorShown, onCursorVisibility, resetCursorVisibility } from './cursor-visibility';
import {
  CLOSE_BAD_CODE, CLOSE_BAD_REQUEST, CLOSE_FREE_LIMIT, CLOSE_HOST_OFFLINE, CLOSE_PROTOCOL_MISMATCH, CLOSE_RATE_LIMITED,
  CLOSE_REMOVED, CLOSE_ROOM_CLOSED, CLOSE_ROOM_FULL, CLOSE_ROOM_NOT_FOUND, CLOSE_TOO_SLOW, PROTO,
  wsTransport, type CollabTransport, type RelayEvent,
} from './collab-transport';

export { PROTO };

/** Отказ хаба перед закрытием ({t:'denied'}): мест нет — по лимиту тарифа автора (planLimited) или по лимиту, заданному автором. */
export interface CollabDenied { reason: string; maxGuests?: number; planLimited?: boolean }

/** Событие на document, когда соединение закрылось; detail — код и причина (и отказ хаба, если он был). */
export interface CollabClosedDetail { code: number; reason: string; denied?: CollabDenied; /** Соединение так и не открылось (сервер недоступен или отверг подключение). */ neverOpened?: boolean }

/** Текст баннера, когда автор скрыл от гостя все страницы (SPEC_NIGHT5 §7). */
export const ALL_HIDDEN_TEXT = 'Автор временно скрыл все страницы доски. Доступ откроется автоматически, когда автор включит страницу.';
/** Пилюля, когда автор скрыл страницу, на которой гость находился. */
export const PAGE_HIDDEN_PILL = 'Автор скрыл страницу, на которой вы находились';
/** Страница-заглушка гостя, пока все страницы скрыты: только у него, хабу не уходит. */
export const HIDDEN_PLACEHOLDER_ID = '__all-pages-hidden__';

export interface CollabUser {
  userId: number;
  name: string;
  color: string;
  host: boolean;
  away: boolean;
  cursor: { x: number; y: number } | null;
  pageId: string | null;
  selection: string[];
  rights: { default: string; pages: Record<string, string> };
  /** Персональный курсор (нет — участник со старой версией). */
  cursorId?: string;
  /** Центр экрана участника в мировых координатах и зум (SPEC_NIGHT5 §8). */
  view?: { pageId: string; vx: number; vy: number; vz: number } | null;
  /** Аватар: смайл, «photo:<версия>» (фото — collabAvatar) или null — буквы; нет поля — участник о нём не сообщал. */
  avatar?: string | null;
  /** Участник на странице, скрытой от меня: где он, не сообщается (SPEC_NIGHT5 §3.1). */
  hiddenPage?: boolean;
  /** Id подписи реакций и комментариев участника (SPEC_COMMENTS §4): по нему — цвет и имя у пилюль реакций. */
  noteId?: string;
  /** Роль, откуда доступ и личные права страниц (pageId → право) — приходит только автору (SPEC_NIGHT6 §3.2). */
  access?: { role: AccessRole | 'owner'; source: 'owner' | 'link' | 'alias' | 'email' | 'p2p'; inviteId?: string; personal?: Record<string, PageRight> };
}

/**
 * Событие на document: от комнаты пришли комментарии страницы или правка её элементов (до применения у себя) —
 * src/note-notices.ts ищет в них новые чужие сообщения и реакции (SPEC_COMMENTS §6).
 */
export const NOTES_EVENT = 'doska:collab-notes';
export type CollabNotesDetail =
  | { pageId: string; kind: 'comments'; prev: CommentThread[] | undefined; next: CommentThread[] }
  | { pageId: string; kind: 'elements'; ids: string[]; prev: readonly Element[]; next: readonly Element[] };

/** Событие на document: участник привлёк внимание к объекту реакцией (SPEC_COMMENTS §5). */
export const ATTENTION_EVENT = 'doska:collab-attention';
export interface CollabAttentionDetail { pageId: string; elId: string; emoji: string; by: number }

/** Событие на document: автор позвал всех на страницу (SPEC_NIGHT5 §8); камеру наводит приложение. */
export interface CollabSummonDetail { pageId: string; vx: number; vy: number; vz: number; by: number }

/**
 * Событие на document 'doska:collab-goto': перейти к участнику (клик по краевому курсору или аватару, автопереход
 * за автором). Приложение переключает страницу и плавно наводит камеру на (x, y); zoom — нет: текущий масштаб.
 */
export interface CollabGotoDetail { pageId: string; x?: number; y?: number; zoom?: number; reason: 'pointer' | 'avatar' | 'follow'; /** длительность перелёта камеры, мс */ ms?: number }

/** Событие на document 'doska:collab-presence': участники, их страницы или моя камера изменились (перерисовать присутствие). */
export const PRESENCE_EVENT = 'doska:collab-presence';

/** Роль и возможности из init / rights; смена роли у гостя — пилюля (кроме первого init). */
function noteAccess(m: Record<string, unknown>, initial = false): void {
  const prevRole = myAccessRole;
  const r = m.role;
  if (r === 'owner' || r === 'editor' || r === 'commenter' || r === 'reader') myAccessRole = r;
  const c = m.caps as Record<string, unknown> | undefined;
  if (c && typeof c === 'object') {
    myCaps = { comment: c.comment === true, chat: c.chat === true, pointer: c.pointer === true, copy: c.copy === true, summon: c.summon === true };
  }
  setChatCanWrite(myCaps?.chat !== false);
  if (!initial && role === 'guest' && prevRole && myAccessRole && myAccessRole !== 'owner' && prevRole !== myAccessRole) {
    pushNotice({ title: `Автор изменил вашу роль: ${roleLabel(myAccessRole)}`, icon: 'role' });
    roleChangedPill = true;
  }
}
/** Пилюля смены роли уже показана — общая «Автор изменил права доступа» не нужна. */
let roleChangedPill = false;

let transport: CollabTransport | null = null;
let myUserId = -1;
let users: CollabUser[] = [];
/** Фото аватаров участников по номеру: приходят в init.photos и сообщениями { t: 'avatar' }. */
const photos = new Map<number, string>();
let myRights: { default: string; pages: Record<string, string> } = { default: 'view', pages: {} };
let connected = false;
let role: 'host' | 'guest' = 'guest';
/** Хаб комнаты понимает дельта-патчи (признак приходит в init): тогда содержимое страниц идёт патчами, а не проектом. */
let hubPatches = false;
/** Состав комнаты уже известен (init или первый users): дальше его изменения показываются пилюлями. */
let usersKnown = false;
/** Автор включил «Автопереход участников за мной» (SPEC_NIGHT5 §8). */
let followHost = false;
/** Когда связь с комнатой оборвалась неожиданно: следующее подключение покажет «Связь восстановлена». */
let lostAt: number | null = null;
/** В течение какого времени после обрыва новое подключение считается восстановлением связи. */
const RESTORE_WINDOW_MS = 10 * 60 * 1000;
/** Последний отказ хаба ({t:'denied'}) в этом подключении. */
let lastDenied: CollabDenied | null = null;
/** Автор скрыл от гостя все страницы: на холсте заглушка, ничего не сохраняется и не отправляется. */
let allHidden = false;
/** Роль и возможности, присланные хабом (SPEC_NIGHT6 §3.2); старый хаб их не шлёт — null. */
let myAccessRole: AccessRole | 'owner' | null = null;
let myCaps: ParticipantCaps | null = null;
/** Автор моих элементов (by), выданный хабом (SPEC_NIGHT6 §4.2). */
let myPrincipalId: string | null = null;
/** Новый секрет хаба на случай, если прежний не подошёл. */
let pendingResume: string | null = null;

const resumeKey = (projectId: string) => `doska.resume.${projectId}`;
function storeResume(projectId: string, secret: string): void {
  try { sessionStorage.setItem(resumeKey(projectId), secret); } catch { /* хранилище недоступно — авторство живёт до переподключения */ }
}
/** Секрет возобновления (P2P): при переподключении к той же комнате свои элементы снова свои (SPEC_NIGHT6 §4.3). */
function handleResume(m: Record<string, unknown>): void {
  const projectId = (m.project as { id?: unknown } | null | undefined)?.id;
  if (role === 'host' || typeof projectId !== 'string' || typeof m.resume !== 'string') return;
  let stored: string | null = null;
  try { stored = sessionStorage.getItem(resumeKey(projectId)); } catch { /* недоступно */ }
  if (stored && stored !== m.resume) {
    pendingResume = m.resume;
    send({ t: 'resume', secret: stored });
  } else {
    storeResume(projectId, m.resume);
  }
}


export function collabActive(): boolean { return connected; }
/** Все страницы доски скрыты от гостя автором (SPEC_NIGHT5 §7). */
export function allPagesHidden(): boolean { return allHidden; }
export function myColor(): string { return users.find(u => u.userId === myUserId)?.color || '#e03131'; }
export function myName(): string { return users.find(u => u.userId === myUserId)?.name || ''; }
export function isHost(): boolean { return role === 'host'; }
/** Автор включил автопереход участников за собой. */
export function hostFollowEnabled(): boolean { return followHost; }
/** Моя роль в комнате по данным хаба (owner — автор); null — хаб старой версии. */
export function myCollabRole(): AccessRole | 'owner' | null { return myAccessRole; }
/** Мои возможности по данным хаба; null — хаб старой версии (действуют прежние правила). */
export function myCollabCaps(): ParticipantCaps | null { return myCaps; }
/** Автор моих элементов (поле by), выданный хабом; null — не в комнате или хаб старой версии. */
export function myPrincipal(): string | null { return myPrincipalId; }
/** Элементы, которые я создал и отправил хабу: мои, пока хаб не прислал их автора (by). */
const createdByMe = new Set<string>();
function noteCreated(base: readonly Element[], ops: readonly { op: string; el?: Element }[]): void {
  if (!protectionActive()) return;
  const known = new Set(base.map(e => e.id));
  for (const op of ops) if (op.op === 'put' && op.el && !known.has(op.el.id)) createdByMe.add(op.el.id);
}

/** Набор id отправленных хабу элементов страницы (кэш по ссылке на массив базы). */
const baselineIds = new WeakMap<readonly Element[], Set<string>>();
function sentIds(pageId: string): Set<string> | null {
  const base = baselines.get(pageId);
  if (!base) return null;
  let ids = baselineIds.get(base.elements);
  if (!ids) { ids = new Set(base.elements.map(e => e.id)); baselineIds.set(base.elements, ids); }
  return ids;
}

/** Включена ли для меня защита чужих элементов (гость в комнате нового хаба). */
export function protectionActive(): boolean {
  return connected && role === 'guest' && myPrincipalId !== null && state.project.permissions?.protectElements === true;
}

/**
 * Можно ли мне менять элемент (SPEC_NIGHT6 §4.6): защита выключена, я автор доски, элемент мой (by) или новый —
 * ещё не отправлен хабу (его автора хаб поставит мой). На странице только для просмотра выделять можно всё —
 * для реакций и копирования; править там хаб и так не даст.
 */
export function canTouchElement(el: Element): boolean {
  if (!protectionActive() || readOnly()) return true;
  if (el.by === myPrincipalId || (el.by === undefined && createdByMe.has(el.id))) return true;
  const ids = sentIds(state.pageId);
  return ids === null || !ids.has(el.id);
}

/** Подсказка над чужим элементом при защите; null — элемент можно менять. */
export function foreignElementHint(el: Element): string | null {
  if (canTouchElement(el)) return null;
  return el.by ? 'Элемент другого участника' : 'Элемент преподавателя';
}
/** Мой ли элемент по автору (для элементов, которых уже нет на доске): Undo не воскрешает чужое. */
function ownsElement(el: Element): boolean {
  if (!protectionActive() || readOnly()) return true;
  return el.by === myPrincipalId || (el.by === undefined && createdByMe.has(el.id));
}
setTouchGuard(el => canTouchElement(el), el => ownsElement(el));
// копирование гостя в комнате — по возможностям от хаба (на участника, SPEC_NIGHT6 D1); старый хаб — по правам доски
setCopyGuard(() => (connected && role === 'guest' && myCaps ? myCaps.copy : null));

/** Участники комнаты (как их видит этот клиент: с маскировкой скрытых страниц). */
export function collabUsers(): readonly CollabUser[] { return users; }
/** Мой номер участника в комнате (-1 — не подключён). */
export function myCollabId(): number { return myUserId; }

/** Аватар участника для показа: смайл, фото (data:image) или null — буквы (фото ещё не пришло — тоже буквы). */
export function collabAvatar(u: Pick<CollabUser, 'userId' | 'avatar'>): string | null {
  const a = u.avatar;
  if (typeof a !== 'string') return null;
  if (PHOTO_KEY.test(a)) return photos.get(u.userId) ?? null;
  return isAvatarEmoji(a) ? a : null;
}

/** Фото аватаров из init: прежние (другого подключения) забываются. */
function resetPhotos(raw: unknown): void {
  photos.clear();
  if (!raw || typeof raw !== 'object') return;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const uid = Number(k);
    if (Number.isInteger(uid) && isAvatarPhoto(v)) photos.set(uid, v);
  }
}

/** Звать участников к себе можно: автор или редактор, если доска это разрешает (возможность summon; проверяет хаб). */
export function canSummon(): boolean {
  return connected && (role === 'host' || myCaps?.summon === true);
}

/**
 * «Позвать всех сюда»: гости переходят на страницу и наводят камеру на центр моего экрана.
 * to — номер участника: позвать только его (меню аватара «Позвать к себе»).
 */
export function sendSummon(pageId: string = state.pageId, to?: number): boolean {
  if (!canSummon() || !transport) return false;
  const { w, h } = viewportSize();
  const v = viewCenter(state.camera, w, h);
  return transport.send(JSON.stringify({ t: 'summon', pageId, vx: v.vx, vy: v.vy, vz: v.vz, ...(to !== undefined ? { to } : {}) })) !== false;
}

/** «Исключить» из меню аватара (только автор): хаб закрывает соединение участника (код 4411). */
export function sendRemove(uid: number): boolean {
  if (!connected || role !== 'host' || !transport || uid === myUserId) return false;
  return transport.send(JSON.stringify({ t: 'remove', uid })) !== false;
}

/**
 * «Настройки доступа» из меню аватара (только автор): личные права участника uid на страницы —
 * 'view' («Только просмотр»), 'hidden' («Скрыта») или null («По роли»). Проверяет и применяет хаб.
 */
export function sendPageRights(uid: number, pages: Record<string, Extract<PageRight, 'view' | 'hidden'> | null>): boolean {
  if (!connected || role !== 'host' || !transport || uid === myUserId) return false;
  return transport.send(JSON.stringify({ t: 'set-rights', uid, pages })) !== false;
}

/** Тумблер «Автопереход участников за мной» (только автор; тариф проверяет хаб). */
export function sendFollowHost(enabled: boolean): boolean {
  if (!connected || role !== 'host' || !transport) return false;
  followHost = enabled;
  document.dispatchEvent(new CustomEvent(PRESENCE_EVENT));
  return transport.send(JSON.stringify({ t: 'follow-host', enabled })) !== false;
}

/** Сообщение в чат комнаты (с вложением — SPEC_CHAT §7); false — нет соединения. */
export function sendChat(text: string, att?: ChatAttachment): boolean {
  if (!connected || !transport) return false;
  return transport.send(JSON.stringify(att ? { t: 'chat', text, att } : { t: 'chat', text })) !== false;
}
const cursorThrottle: { last: number; timer: number; pending: { x: number; y: number } | null } = { last: 0, timer: 0, pending: null };
const projectThrottle: { timer: number } = { timer: 0 };

/** Право на активной странице: edit / view / hidden. */
export function pageRight(pageId: string): 'edit' | 'view' | 'hidden' {
  if (role === 'host' || isDraftId(pageId)) return 'edit';
  if (allHidden || pageId === HIDDEN_PLACEHOLDER_ID) return 'view';
  const r: string = myRights.pages[pageId] ?? myRights.default ?? 'view';
  return r === 'edit' || r === 'hidden' ? r : 'view';
}
export function readOnly(pageId?: string): boolean {
  if (!connected || role === 'host') return false;
  return pageRight(pageId ?? state.pageId) !== 'edit';
}

function send(obj: unknown): void {
  transport?.send(JSON.stringify(obj));
}

/** Подключение к комнате по WebSocket (локальная сеть): имя, роль и версия протокола — в параметрах URL. */
export function startCollab(wsUrl: string, asHost: boolean, name: string): Promise<void> {
  const url = new URL(wsUrl);
  url.searchParams.set('name', encodeURIComponent(name || ''));
  url.searchParams.set('cursor', myCursorId());
  url.searchParams.set('proto', String(PROTO));
  if (asHost) url.searchParams.set('host', '1');
  return connectCollab(wsTransport(url.toString()), asHost);
}

/**
 * Подключение через любой транспорт. Промис выполняется, когда канал открыт, — или когда он
 * закрылся, так и не открывшись (тогда collabActive() === false, а причину сообщит doska:collab-closed).
 */
export function connectCollab(t: CollabTransport, asHost: boolean): Promise<void> {
  role = asHost ? 'host' : 'guest';
  state.collabRole = role;
  // прежний канал (например, облачная комната, когда автор включил совместную работу в своей вкладке) закрывается
  const old = transport;
  if (old && old !== t) {
    try { old.close(); } catch { /* уже закрыт */ }
    document.dispatchEvent(new CustomEvent('doska:collab-replaced'));
  }
  transport = t;
  hubPatches = false;
  lastDenied = null;
  lastClosed = null;
  myUserId = -1;
  viewSent = null;
  presenceKey = '';
  hostPages.clear();
  usersKnown = false;
  baselines.clear();
  incoming.length = 0;
  startReady();
  watchBoard();
  // события от прежнего, уже заменённого канала не должны трогать текущее состояние
  const current = () => transport === t;

  const handle = (data: string): void => {
    let m: Record<string, unknown>;
    try { m = JSON.parse(data); } catch { return; }
    if (m.t === 'init') {
      // сервер другой версии: дальнейшие сообщения могут значить не то, что мы думаем
      if (typeof m.proto === 'number' && m.proto !== PROTO) {
        closeWith(CLOSE_PROTOCOL_MISMATCH, 'protocol mismatch');
        return;
      }
      myUserId = m.userId as number;
      myRights = (m.rights as typeof myRights) || myRights;
      noteAccess(m, true);
      myPrincipalId = typeof m.principal === 'string' ? m.principal : null;
      handleResume(m);
      usersKnown = Array.isArray(m.users);
      if (Array.isArray(m.users)) users = m.users as CollabUser[];
      resetPhotos(m.photos);
      followHost = m.followHost === true;
      setChatSender(sendChat);
      setChatAvatarLookup(uid => { const u = users.find(x => x.userId === uid); return u ? collabAvatar(u) : null; });
      setChatAvailable(true);
      chatReset(m.chat, myUserId);
      // отклик на восстановление моего соединения — тихое: видно, но не копится
      if (lostAt !== null && Date.now() - lostAt < RESTORE_WINDOW_MS) pushNotice({ level: 'ok', title: 'Связь с доской восстановлена', icon: 'online', quiet: true });
      lostAt = null;
      // хаб умеет патчи — сообщаем, что мы тоже: до ответа он шлёт полные проекты
      hubPatches = m.patches === true;
      // noteId — чем я подписываю реакции и комментарии: по нему остальные красят мои реакции цветом моей плашки
      if (hubPatches) send({ t: 'caps', patches: true, noteId: clientId() });
      if (m.project) applyRemoteProject(m.project as Project);
      followHostPages(users);
      renderRemoteCursors();
      settleReady(true);
      noteView(true);
      // аватар в hello не передаётся — сообщаем его сразу (хаб не считает первое сообщение сменой аватара)
      sentAvatar = undefined;
      sendProfile(false);
    } else if (m.t === 'users') {
      const next = Array.isArray(m.users) ? m.users as CollabUser[] : users;
      if (usersKnown) showUserEvents(diffUsers(users, next, myUserId), u => collabAvatar(u));
      usersKnown = true;
      users = next;
      releaseRemoteFades(new Set(next.map(user => user.userId)));
      followHostPages(next);
      renderRemoteCursors();
    } else if (m.t === 'avatar') {
      // фото приходит до снимка участников с его новой версией
      if (typeof m.userId === 'number' && isAvatarPhoto(m.photo)) photos.set(m.userId, m.photo);
    } else if (m.t === 'rights') {
      const nextRights = (m.rights as typeof myRights) || myRights;
      roleChangedPill = false;
      noteAccess(m);
      if (role === 'guest' && !roleChangedPill && JSON.stringify(nextRights) !== JSON.stringify(myRights)) pushNotice({ title: 'Автор изменил права доступа', icon: 'rights' });
      myRights = nextRights;
      // перерисовываем UI — тулбар и список страниц зависят от прав
      setSelection([...state.selection]);
    } else if (m.t === 'project') {
      if ((m.by as number) !== myUserId) applyRemoteProject(m.project as Project);
    } else if (m.t === 'patch') {
      if ((m.by as number) !== myUserId && isBoardPatch(m)) receivePatch(m);
    } else if (m.t === 'comments') {
      applyIncomingComments(m.pageId, m.comments);
    } else if (m.t === 'pointer') {
      applyIncomingPointer(m);
    } else if (m.t === 'resume') {
      // хаб принял прежний секрет — мои прежние элементы снова мои; не принял — запоминаем новый
      const pid = state.project.id;
      if (m.ok === true && typeof m.principal === 'string') myPrincipalId = m.principal;
      else if (pendingResume) storeResume(pid, pendingResume);
      pendingResume = null;
      setSelection([...state.selection]);
    } else if (m.t === 'chat') {
      chatReceive(m);
    } else if (m.t === 'follow-host') {
      const was = followHost;
      followHost = m.enabled === true;
      // гость: автопереход включили — сразу к автору (если он не на скрытой странице)
      if (followHost && !was && role === 'guest') { hostPages.clear(); followHostPages(users); }
      document.dispatchEvent(new CustomEvent(PRESENCE_EVENT));
    } else if (m.t === 'summon') {
      receiveSummon(m);
    } else if (m.t === 'attention') {
      // «Привлечь внимание» (SPEC_COMMENTS §5): частицы и уведомление — src/attention.ts
      if (typeof m.pageId === 'string' && typeof m.elId === 'string' && typeof m.emoji === 'string' && typeof m.by === 'number' && m.by !== myUserId) {
        const detail: CollabAttentionDetail = { pageId: m.pageId, elId: m.elId, emoji: m.emoji, by: m.by };
        document.dispatchEvent(new CustomEvent<CollabAttentionDetail>(ATTENTION_EVENT, { detail }));
      }
    } else if (m.t === 'set-rights') {
      // хаб отклонил «Настройки доступа» из меню аватара (например, лимит редакторов)
      // ответ на моё действие — тихое предупреждение
      if (role === 'host' && m.ok === false) pushNotice({ level: 'warn', title: typeof m.error === 'string' && m.error ? m.error : 'Не удалось изменить доступ участника', icon: 'rights', quiet: true });
    } else if (m.t === 'denied') {
      lastDenied = {
        reason: typeof m.reason === 'string' ? m.reason : '',
        ...(typeof m.maxGuests === 'number' && Number.isFinite(m.maxGuests) ? { maxGuests: m.maxGuests } : {}),
        ...(typeof m.planLimited === 'boolean' ? { planLimited: m.planLimited } : {}),
      };
    }
  };

  // сообщения облачной комнаты со ссылками asset://… ждут загрузки картинок; остальные не отстают от них
  let waiting = 0;
  let queue: Promise<void> = Promise.resolve();
  return new Promise(resolve => {
    t.onopen = () => { if (!current()) return; connected = true; resolve(); };
    t.onmessage = data => {
      if (!current()) return;
      if (waiting === 0 && !(data.includes('asset://') && getApi())) { handle(data); return; }
      waiting++;
      queue = queue.then(async () => {
        try {
          const ready = current() ? await hydrateMessage(data) : data;
          if (current()) handle(ready);
        } catch { /* испорченное сообщение пропускаем */ } finally { waiting--; }
      });
    };
    t.onclose = (code, reason) => {
      if (!current()) return;
      const wasInRoom = connected && myUserId >= 0;
      const neverOpened = !connected;
      connected = false;
      dropRemotePointers();
      renderRemoteCursors();
      settleReady(false);
      setChatSender(null);
      notifyClosed(code, reason, neverOpened);
      // гостю причину объясняет карточка уведомления; автору — пилюля: его комната подключится снова
      if (wasInRoom && role === 'host') {
        lostAt = Date.now();
        pushNotice({ level: 'warn', title: 'Соединение прервано, переподключаемся…', icon: 'offline' });
      }
      resolve(); // не открылся вовсе — не держим запуск приложения
    };
  });
}

/** Автор позвал всех на страницу: пилюля и событие для приложения (переход на страницу и камера). */
function receiveSummon(m: Record<string, unknown>): void {
  if (role !== 'guest' || typeof m.pageId !== 'string') return;
  const page = state.project.pages.find(p => p.id === m.pageId);
  if (!page) return;
  const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  const who = users.find(u => u.userId === m.by);
  const name = !who || who.host ? 'Автор' : String(who.name ?? '') || 'Участник';
  const you = typeof m.to === 'number' && m.to === myUserId;
  pushNotice({
    title: name,
    body: `позвал${you ? ' вас' : ' всех'} на страницу «${page.name}»`,
    icon: 'summon',
    ...(who ? { user: { userId: who.userId, name, cursorId: who.cursorId ?? DEFAULT_CURSOR_ID, avatar: collabAvatar(who) } } : {}),
  });
  const detail: CollabSummonDetail = { pageId: page.id, vx: num(m.vx, 0), vy: num(m.vy, 0), vz: num(m.vz, 1), by: num(m.by, -1) };
  document.dispatchEvent(new CustomEvent<CollabSummonDetail>('doska:collab-summon', { detail }));
}

/** Картинки asset://… в проекте или патче заменяются на содержимое (докачивается с сервера). */
async function hydrateMessage(data: string): Promise<string> {
  const api = getApi();
  if (!api) return data;
  const m = JSON.parse(data) as Record<string, unknown>;
  if (m.project && typeof m.project === 'object') {
    m.project = await hydrateFromCloud(m.project as Project, api);
  } else if (m.t === 'patch' && Array.isArray(m.ops)) {
    const ops = m.ops as { op: string; el?: Element }[];
    const puts = ops.filter(o => o.op === 'put' && o.el);
    if (puts.length > 0) {
      const probe: Project = { id: 'p', name: '', createdAt: 0, updatedAt: 0, pages: [{ id: 'p', name: '', grid: 'none', elements: puts.map(o => o.el!) }] };
      const done = await hydrateFromCloud(probe, api);
      puts.forEach((o, i) => { o.el = done.pages[0].elements[i]; });
    }
  } else return data;
  return JSON.stringify(m);
}

// ----- Готовность: первое состояние комнаты получено (init) или канал закрылся, так и не дав его -----

let readySettle: ((ok: boolean) => void) | null = null;
let readyPromise: Promise<boolean> = Promise.resolve(false);

function startReady(): void {
  readyPromise = new Promise<boolean>(resolve => { readySettle = resolve; });
}

function settleReady(ok: boolean): void {
  readySettle?.(ok);
  readySettle = null;
}

/** После connectCollab: true — комната прислала состояние (init), false — закрылась раньше. */
export function collabReady(): Promise<boolean> {
  return readyPromise;
}

/** Как закрылось последнее подключение (null — ещё не закрывалось). */
let lastClosed: CollabClosedDetail | null = null;

function notifyClosed(code: number, reason: string, neverOpened = false): void {
  const detail: CollabClosedDetail = { code, reason, ...(lastDenied ? { denied: lastDenied } : {}), ...(neverOpened ? { neverOpened } : {}) };
  lastClosed = detail;
  document.dispatchEvent(new CustomEvent<CollabClosedDetail>('doska:collab-closed', { detail }));
}

/** Отказ хаба в последнем подключении (null — не было). */
export function lastCollabDenied(): CollabDenied | null {
  return lastDenied;
}

/** Код, причина и отказ хаба при последнем закрытии соединения (null — не закрывалось с начала подключения). */
export function lastCollabClose(): CollabClosedDetail | null {
  return lastClosed;
}

/** Закрыть канал по своей причине (например, несовпадение версий) и сообщить об этом как о закрытии сервером. */
function closeWith(code: number, reason: string): void {
  const t = transport;
  transport = null;
  connected = false;
  t?.close();
  dropRemotePointers();
  renderRemoteCursors();
  settleReady(false);
  notifyClosed(code, reason);
}

function applyRemoteProject(project: Project): void {
  if (!project || !Array.isArray(project.pages)) return;
  const guest = role === 'guest';
  const wasHidden = allHidden;
  const prevPage = state.pageId;
  const prevOrder = state.project.pages.map(p => p.id);
  // автор скрыл все страницы (SPEC_NIGHT5 §7): хаб прислал проект без страниц — гость видит заглушку и баннер
  if (guest && project.pages.length === 0) {
    if (!wasHidden) cancelActiveInteraction();
    allHidden = true;
    const placeholder: Page = { id: HIDDEN_PLACEHOLDER_ID, name: '', grid: 'none', elements: [] };
    openProject({ ...project, pages: [placeholder] }, placeholder.id);
    setSelection([]);
    setAllHiddenBanner(true);
    document.dispatchEvent(new CustomEvent('doska:collab-project'));
    return;
  }
  if (project.pages.length === 0) return; // у автора проект без страниц не бывает
  let keepPageId: string | undefined = prevPage;
  let lost = false;
  if (wasHidden) {
    // страница снова открыта: баннер уходит, открывается первая доступная
    allHidden = false;
    setAllHiddenBanner(false);
    keepPageId = project.pages[0].id;
  } else if (guest && prevPage && !isDraftId(prevPage) && !project.pages.some(p => p.id === prevPage)) {
    // страницу, на которой гость стоит, скрыли: жест отменяется, гость уходит на ближайшую доступную
    lost = true;
    cancelActiveInteraction();
    keepPageId = nearestAvailablePage(prevOrder, prevPage, project.pages.map(p => p.id)) ?? project.pages[0].id;
  }
  const keepCam = { ...state.camera };
  openProject(project, keepPageId);
  state.camera = keepCam;
  setSelection(lost ? [] : [...state.selection]);
  // содержимое теперь общее: следующие правки считаются от него
  markSent(state.project);
  if (lost) pushNotice({ level: 'warn', title: PAGE_HIDDEN_PILL, icon: 'hidden' });
  document.dispatchEvent(new CustomEvent('doska:collab-project'));
}

/** Баннер «все страницы скрыты» поверх холста; холст под ним не принимает ввод. */
function setAllHiddenBanner(on: boolean): void {
  document.body.classList.toggle('all-pages-hidden', on);
  let banner = document.getElementById('all-pages-hidden-banner');
  if (!banner && on) {
    banner = document.createElement('div');
    banner.id = 'all-pages-hidden-banner';
    document.body.appendChild(banner);
  }
  if (!banner) return;
  banner.setAttribute('role', 'status');
  if (on && !banner.textContent) banner.textContent = ALL_HIDDEN_TEXT;
  banner.hidden = !on;
}

// ----- Дельта-патчи -----

interface Baseline { elements: Element[]; grid: GridMode; backgroundColor: string | undefined; coordLabels: boolean }
/** Что хаб уже знает о каждой странице: от этого снимка считается следующий патч. */
const baselines = new Map<string, Baseline>();
/** Что хаб знает о составе проекта (названия, страницы, права, комментарии): иначе нужен полный проект. */
let sentStructure: { key: string; comments: unknown[] } | null = null;
let patchRev = 0;
const incoming: BoardPatch[] = [];
const BOARD_SYNC_MS = 100;
const syncThrottle: { last: number; timer: number } = { last: 0, timer: 0 };
let incomingTimer = 0;
let watching = false;

const structureKey = (p: Project): string =>
  JSON.stringify([p.name, p.icon ?? null, p.ownerPlan ?? null, p.permissions ?? null, p.pages.map(pg => [pg.id, pg.name])]);

function structureChanged(p: Project): boolean {
  if (!sentStructure || sentStructure.key !== structureKey(p)) return true;
  return p.pages.some((pg, i) => sentStructure!.comments[i] !== pg.comments);
}

/** Проект целиком известен хабу: страницы и состав запоминаются как отправленные. */
function markSent(p: Project): void {
  baselines.clear();
  for (const pg of p.pages) baselines.set(pg.id, { elements: pg.elements, grid: pg.grid, backgroundColor: pg.backgroundColor, coordLabels: pg.coordLabels !== false });
  sentStructure = { key: structureKey(p), comments: p.pages.map(pg => pg.comments) };
}

/** Страницы, изменившиеся с прошлой отправки, уходят патчами. false — патч не поместился, нужен полный проект. */
function flushPatches(p: Project): boolean {
  let whole = true;
  for (const pg of p.pages) {
    if (readOnly(pg.id)) continue;
    const base = baselines.get(pg.id);
    if (!base) continue; // страница новая — её увезёт полный проект
    if (pg.elements === base.elements && pg.grid === base.grid && pg.backgroundColor === base.backgroundColor && (pg.coordLabels !== false) === base.coordLabels) continue;
    const ops = diffElements(base.elements, pg.elements);
    if (ops.length > MAX_PATCH_OPS) { whole = false; continue; }
    noteCreated(base.elements, ops);
    const patch: BoardPatch = { t: 'patch', pageId: pg.id, rev: ++patchRev, ops };
    if (pg.grid !== base.grid) patch.grid = pg.grid;
    if (pg.backgroundColor !== base.backgroundColor) patch.backgroundColor = pg.backgroundColor ?? null;
    if ((pg.coordLabels !== false) !== base.coordLabels) patch.coordLabels = pg.coordLabels !== false;
    baselines.set(pg.id, { elements: pg.elements, grid: pg.grid, backgroundColor: pg.backgroundColor, coordLabels: pg.coordLabels !== false });
    if (ops.length > 0 || patch.grid !== undefined || patch.backgroundColor !== undefined || patch.coordLabels !== undefined) send(patch);
  }
  return whole;
}

function scheduleBoardSync(): void {
  if (!connected || !hubPatches || onDraft()) return;
  const wait = BOARD_SYNC_MS - (Date.now() - syncThrottle.last);
  if (wait <= 0) {
    syncThrottle.last = Date.now();
    flushPatches(state.project);
  } else if (!syncThrottle.timer) {
    syncThrottle.timer = window.setTimeout(() => {
      syncThrottle.timer = 0;
      syncThrottle.last = Date.now();
      if (connected && hubPatches) flushPatches(state.project);
    }, wait);
  }
}

function watchBoard(): void {
  if (watching) return;
  watching = true;
  onChange(() => {
    scheduleBoardSync();
    if (incoming.length > 0) drainIncoming();
  });
}

function receivePatch(p: BoardPatch): void {
  incoming.push(p);
  drainIncoming();
}

/** Чужие патчи ждут окончания жеста: он держит прежний массив элементов и затёр бы их. */
function drainIncoming(): void {
  if (incoming.length === 0) return;
  if (gestureActive()) {
    if (!incomingTimer) incomingTimer = window.setTimeout(() => { incomingTimer = 0; drainIncoming(); }, 100);
    return;
  }
  const list = incoming.splice(0, incoming.length);
  for (const p of list) applyIncomingPatch(p);
}

/** Страница меняется на месте, как и её элементы в state.ts; камера, выделение и история отмены остаются. */
function applyIncomingPatch(p: BoardPatch): void {
  const page: Page | undefined = state.project.pages.find(pg => pg.id === p.pageId);
  if (!page) return;
  const next = applyBoardPatch(page, p);
  const same = next.elements === page.elements && next.grid === page.grid && next.backgroundColor === page.backgroundColor && next.coordLabels === page.coordLabels;
  // новые реакции участников — уведомлениям (src/note-notices.ts): сравниваются только присланные элементы
  if (next.elements !== page.elements) {
    const ids = p.ops.flatMap(o => (o.op === 'put' ? [o.el.id] : []));
    if (ids.length) {
      const detail: CollabNotesDetail = { pageId: page.id, kind: 'elements', ids, prev: page.elements, next: next.elements };
      document.dispatchEvent(new CustomEvent<CollabNotesDetail>(NOTES_EVENT, { detail }));
    }
  }
  if (!same) {
    page.elements = next.elements;
    page.grid = next.grid;
    if (next.backgroundColor === undefined) delete page.backgroundColor;
    else page.backgroundColor = next.backgroundColor;
    if (next.coordLabels === false) page.coordLabels = false;
    else delete page.coordLabels;
  }
  baselines.set(page.id, { elements: page.elements, grid: page.grid, backgroundColor: page.backgroundColor, coordLabels: page.coordLabels !== false });
  if (same) return;
  // автор сохраняет и чужие правки; у гостя доска — чужая, сохранять нечего
  if (role === 'host') touchProject();
  if (page === state.board && state.selection.size > 0) {
    const alive = new Set(page.elements.map(e => e.id));
    const kept = [...state.selection].filter(id => alive.has(id));
    if (kept.length !== state.selection.size) { setSelection(kept); return; }
  }
  update();
}

/** Отправка позиции курсора (сцена) с троттлингом 40мс. */
export function noteCursor(x: number, y: number): void {
  if (!connected) return;
  cursorThrottle.pending = { x, y };
  const now = Date.now();
  if (now - cursorThrottle.last < 40) {
    if (!cursorThrottle.timer) {
      cursorThrottle.timer = window.setTimeout(() => {
        cursorThrottle.timer = 0;
        flushCursor();
      }, 40);
    }
    return;
  }
  flushCursor();
}
function flushCursor(): void {
  if (!cursorThrottle.pending) return;
  cursorThrottle.last = Date.now();
  // черновик виден только автору: остальным курсор «не на странице» (пустой id не совпадает ни с одной)
  send({ t: 'cursor', x: cursorThrottle.pending.x, y: cursorThrottle.pending.y, pageId: onDraft() ? '' : state.pageId });
  cursorThrottle.pending = null;
}

// ----- Камера и страница участника (SPEC_NIGHT5 §8) -----

/** Пока камера двигается, {t:'view'} уходит не чаще, чем раз в столько (и последний вид — после остановки). Смена страницы — сразу. */
export const VIEW_SEND_MS = 250;
let viewSent: { pageId: string; vx: number; vy: number; vz: number } | null = null;
let viewTimer = 0;

function currentView(): { pageId: string; vx: number; vy: number; vz: number } | null {
  if (!connected || myUserId < 0 || state.view !== 'board' || onDraft()) return null;
  const { w, h } = viewportSize();
  if (!w || !h) return null;
  return { pageId: state.pageId, ...viewCenter(state.camera, w, h) };
}

function flushView(): void {
  clearTimeout(viewTimer);
  viewTimer = 0;
  const v = currentView();
  if (!v) return;
  if (viewSent && viewSent.pageId === v.pageId && viewSent.vx === v.vx && viewSent.vy === v.vy && viewSent.vz === v.vz) return;
  viewSent = v;
  send({ t: 'view', ...v });
}

/** Моя камера или страница изменились: сообщить комнате (смена страницы — сразу, камера — после остановки). */
function noteView(now = false): void {
  const v = currentView();
  if (!v) return;
  if (viewSent && viewSent.pageId === v.pageId && viewSent.vx === v.vx && viewSent.vy === v.vy && viewSent.vz === v.vz) return;
  if (now || !viewSent || viewSent.pageId !== v.pageId) { flushView(); return; }
  // не откладываем отправку на каждом кадре: за участником могут следить — его вид нужен и во время движения
  if (!viewTimer) viewTimer = window.setTimeout(flushView, VIEW_SEND_MS);
}

/** Камера или страница с прошлой перерисовки присутствия. */
let presenceKey = '';
onChange(() => {
  if (!connected) return;
  const cam = state.camera;
  const key = `${state.view}|${state.pageId}|${cam.x}|${cam.y}|${cam.zoom}`;
  if (key === presenceKey) return;
  presenceKey = key;
  // курсоры участников привязаны к сцене: при движении своей камеры их экранные места меняются
  renderRemoteCursors();
  noteView();
});

/** Где в последний раз был каждый автор (null — на скрытой от меня странице); для автоперехода. */
const hostPages = new Map<number, string | null>();

/**
 * Автопереход за автором (гость): автор сменил страницу (не скрытую от меня) — переходим к нему. Смена только камеры
 * автора гостя не двигает: он сам смотрит, куда хочет, до следующей смены страницы автором.
 */
function followHostPages(next: readonly CollabUser[]): void {
  if (role !== 'guest') { hostPages.clear(); return; }
  for (const u of next) {
    if (!u.host || u.userId === myUserId) continue;
    const page = u.hiddenPage ? null : u.pageId;
    const prev = hostPages.get(u.userId);
    hostPages.set(u.userId, page);
    if (!followHost || page === null || prev === page) continue;
    if (!state.project.pages.some(p => p.id === page)) continue;
    const view = u.view && u.view.pageId === page ? u.view : null;
    if (page === state.pageId && !view) continue;
    const detail: CollabGotoDetail = { pageId: page, reason: 'follow', ...(view ? { x: view.vx, y: view.vy, zoom: view.vz } : {}) };
    document.dispatchEvent(new CustomEvent<CollabGotoDetail>('doska:collab-goto', { detail }));
  }
}

// ----- Указка: лазер, исчезающий маркер и подсветка объектов видны остальным участникам -----

const TRAIL_FLUSH_MS = 40;
/** Не больше, чем хаб принимает в одном сообщении. */
const TRAIL_CHUNK = 64;
const TRAIL_MAX_PTS = 400;
const FADE_MAX_PTS = 4000;
const POINTER_COLOR = /^#[0-9a-fA-F]{6}$/;

interface TrailOut { base: Record<string, unknown>; pts: Pt[]; last: Pt | null; timer: number }
const trailOut = new Map<string, TrailOut>();

function flushTrail(key: string, end: boolean): void {
  const o = trailOut.get(key);
  if (!o) return;
  clearTimeout(o.timer);
  o.timer = 0;
  const pts = o.pts;
  o.pts = [];
  if (pts.length === 0 && end && o.last) pts.push(o.last); // конец росчерка без новых точек
  for (let i = 0; i < pts.length; i += TRAIL_CHUNK) {
    const last = i + TRAIL_CHUNK >= pts.length;
    send({ t: 'pointer', ...o.base, pts: pts.slice(i, i + TRAIL_CHUNK), ...(end && last ? { end: true } : {}) });
  }
  if (end) trailOut.delete(key);
}

/** Точки росчерка уходят пачками раз в 40 мс; end — росчерк закончен. На черновике (его видит только автор) ничего не шлём. */
function queueTrail(key: string, base: Record<string, unknown>, pts: Pt[], end: boolean): void {
  if (!connected || onDraft()) return;
  let o = trailOut.get(key);
  if (!o) {
    if (pts.length === 0) return;
    o = { base: { ...base, pageId: state.pageId }, pts: [], last: null, timer: 0 };
    trailOut.set(key, o);
  }
  o.pts.push(...pts);
  if (pts.length > 0) o.last = pts[pts.length - 1];
  if (end) flushTrail(key, true);
  else if (!o.timer) o.timer = window.setTimeout(() => flushTrail(key, false), TRAIL_FLUSH_MS);
}

/** След лазерной указки (точки сцены); end — кнопку отпустили. */
export function sendLaser(pts: Pt[], color: string, end: boolean): void {
  queueTrail('laser', { k: 'laser', color }, pts, end);
}

/** Росчерк исчезающего маркера: sid — номер росчерка, по нему остальные дописывают точки. */
export function sendFadeStroke(sid: string, stroke: Pick<FadeStroke, 'color' | 'width' | 'opacity'>, pts: Pt[], end: boolean): void {
  queueTrail(`fade:${sid}`, {
    k: 'fade', sid, color: stroke.color, width: stroke.width, ...(stroke.opacity !== undefined ? { opacity: stroke.opacity } : {}),
  }, pts, end);
}

/** Подсветка объектов указкой: остальные видят то же свечение контура. */
export function sendFlash(ids: string[]): void {
  if (!connected || onDraft() || ids.length === 0) return;
  send({ t: 'pointer', k: 'flash', pageId: state.pageId, ids });
}

/** Текущий штрих каждого удалённого участника. */
const remoteFades = new Map<number, { pageId: string; sid: string; stroke: FadeStroke }>();

function releaseRemoteFades(remainingUsers?: Set<number>): void {
  const now = performance.now();
  for (const by of remoteFades.keys()) {
    if (remainingUsers?.has(by)) continue;
    setFadeStrokeEnd(by, now);
    remoteFades.delete(by);
    update();
  }
}

function dropRemotePointers(): void {
  for (const [key, o] of trailOut) { clearTimeout(o.timer); trailOut.delete(key); }
  state.remoteLasers.clear();
  releaseRemoteFades();
}

const finiteNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Указка другого участника. Хаб уже проверил форму, но клиент не полагается на это: проект и сообщения могут прийти откуда угодно. */
function applyIncomingPointer(m: Record<string, unknown>): void {
  const by = m.by;
  if (!finiteNum(by) || by === myUserId || typeof m.pageId !== 'string') return;
  if (m.pageId !== state.pageId) {
    // Отрыв может прийти уже после того, как наблюдатель сменил страницу.
    const active = remoteFades.get(by);
    if (m.k === 'fade' && m.end === true && active?.pageId === m.pageId && active.sid === m.sid) {
      setFadeStrokeEnd(by, performance.now());
      remoteFades.delete(by);
      update();
    }
    return;
  }
  const now = performance.now();
  if (m.k === 'flash') {
    if (!Array.isArray(m.ids)) return;
    const ids = m.ids.filter((id): id is string => typeof id === 'string').slice(0, 2000);
    if (ids.length > 0) { state.flashes.push({ ids, t: now }); update(); }
    return;
  }
  if (m.k !== 'laser' && m.k !== 'fade') return;
  if (!Array.isArray(m.pts)) return;
  const fallback = users.find(u => u.userId === by)?.color ?? '#e03131';
  const color = typeof m.color === 'string' && POINTER_COLOR.test(m.color) ? m.color : fallback;
  const pts: Pt[] = [];
  for (const p of m.pts.slice(0, TRAIL_CHUNK)) {
    const q = p as { x?: unknown; y?: unknown; p?: unknown } | null;
    if (q && finiteNum(q.x) && finiteNum(q.y)) pts.push({ x: q.x, y: q.y, p: finiteNum(q.p) ? q.p : 0.5 });
  }
  if (pts.length === 0) return;
  const end = m.end === true;
  if (m.k === 'laser') {
    const r = state.remoteLasers.get(by) ?? { down: false, pts: [] };
    const begin = !r.down;
    // пачка пришла разом, а точки были набраны за последние 40 мс — раскладываем их по времени
    pts.forEach((p, i) => r.pts.push({
      x: p.x, y: p.y, t: now - (pts.length - 1 - i) * (TRAIL_FLUSH_MS / pts.length),
      ...(begin && i === 0 ? { start: color } : {}),
    }));
    if (r.pts.length > TRAIL_MAX_PTS) r.pts.splice(0, r.pts.length - TRAIL_MAX_PTS);
    r.down = !end;
    state.remoteLasers.set(by, r);
    update();
    return;
  }
  if (typeof m.sid !== 'string' || !finiteNum(m.width) || m.width <= 0 || m.width > 200) return;
  let f = remoteFades.get(by);
  if (!f || f.sid !== m.sid) {
    setFadeStrokeEnd(by, null);
    const opacity = finiteNum(m.opacity) && m.opacity < 1 ? Math.max(0, m.opacity) : undefined;
    const stroke: FadeStroke = { color, width: m.width, ...(opacity !== undefined ? { opacity } : {}), pts: [], endT: null, by };
    f = { pageId: m.pageId, sid: m.sid, stroke };
    remoteFades.set(by, f);
    state.fadeStrokes.push(stroke);
  }
  if (f.stroke.pts.length < FADE_MAX_PTS) f.stroke.pts.push(...pts);
  if (end) { setFadeStrokeEnd(by, now); remoteFades.delete(by); }
  update();
}

// ----- Реакции и комментарии -----

/** Реакции и комментарии принимает хаб с патчами; false — не в комнате, вызывающий применит их у себя. */
export function noteOnline(): boolean {
  return connected && hubPatches;
}

/** Поставить или снять свою реакцию через хаб: так её может поставить и читатель. */
export function sendReaction(pageId: string, elId: string, emoji: string): boolean {
  if (!noteOnline()) return false;
  send({ t: 'react', pageId, elId, emoji, userId: clientId() });
  return true;
}

/** «Привлечь внимание» к объекту реакцией (хаб проверит право и частоту); false — не в комнате. */
export function sendAttention(pageId: string, elId: string, emoji: string): boolean {
  if (!noteOnline()) return false;
  send({ t: 'attention', pageId, elId, emoji });
  return true;
}

export type CommentRequest =
  | { op: 'create'; x: number; y: number; targetElementId?: string; text: string; offset?: { x: number; y: number } }
  | { op: 'move'; threadId: string; x: number; y: number; offset?: { x: number; y: number } }
  | { op: 'delete'; threadId: string }
  | { op: 'reply'; threadId: string; text: string }
  | { op: 'resolve'; threadId: string; resolved: boolean };

export function sendComment(pageId: string, req: CommentRequest): boolean {
  if (!noteOnline()) return false;
  send({ t: 'comment', pageId, userId: clientId(), ...req });
  return true;
}

/** Комментарии страницы от хаба заменяют прежние; проект целиком при этом не открывается заново. */
function applyIncomingComments(pageId: unknown, raw: unknown): void {
  if (typeof pageId !== 'string') return;
  const page = state.project.pages.find(pg => pg.id === pageId);
  if (!page) return;
  const list = sanitizeComments(raw);
  const prev = page.comments;
  const detail: CollabNotesDetail = { pageId: page.id, kind: 'comments', prev, next: list };
  document.dispatchEvent(new CustomEvent<CollabNotesDetail>(NOTES_EVENT, { detail }));
  if (list.length > 0) page.comments = list;
  else delete page.comments;
  if (sentStructure) {
    const i = state.project.pages.indexOf(page);
    if (i >= 0) sentStructure.comments[i] = page.comments;
  }
  // автор сохраняет и чужие комментарии
  if (role === 'host') touchProject();
  update();
}

// ----- Ввод ученика в задание -----

const DRAFT_SEND_MS = 300;
const draftSends = new Map<string, { last: number; timer: number; draft: string }>();

/** Комната принимает ввод в задания (хаб с патчами): иначе ввод применяется только у себя. */
export function taskInputOnline(): boolean {
  return connected && hubPatches;
}

/** Черновик ответа уходит хабу не чаще раза в 300 мс (последнее значение не теряется). false — не в комнате. */
export function sendTaskDraft(pageId: string, elId: string, draft: string): boolean {
  if (!taskInputOnline()) return false;
  const key = `${pageId}\u0000${elId}`;
  const d = draftSends.get(key) ?? { last: 0, timer: 0, draft: '' };
  draftSends.set(key, d);
  d.draft = draft;
  const flush = () => { d.timer = 0; d.last = Date.now(); send({ t: 'task-draft', pageId, elId, draft: d.draft }); };
  const wait = DRAFT_SEND_MS - (Date.now() - d.last);
  if (wait <= 0) { clearTimeout(d.timer); flush(); } else if (!d.timer) d.timer = window.setTimeout(flush, wait);
  return true;
}

/** Ответ на проверку: проверяет хаб по настоящему ответу, результат приходит правкой задания. false — не в комнате. */
export function sendTaskSubmit(pageId: string, elId: string, value: string): boolean {
  if (!taskInputOnline()) return false;
  const d = draftSends.get(`${pageId}\u0000${elId}`);
  if (d) { clearTimeout(d.timer); d.timer = 0; } // отправленный ответ не должен вернуться черновиком
  send({ t: 'task-submit', pageId, elId, value });
  return true;
}

export function noteSelection(ids: string[]): void {
  if (!connected) return;
  send({ t: 'selection', ids: onDraft() ? [] : ids, pageId: onDraft() ? '' : state.pageId });
}

/** Отправка проекта (дебаунс 250мс) — вызывается из storage.save сетевого режима. */
export function sendProject(project: Project): void {
  if (!connected || allHidden) return;
  if (hubPatches) {
    // содержимое страниц уходит патчами; полный проект — только когда изменился состав проекта
    if (flushPatches(project) && !structureChanged(project)) return;
  }
  clearTimeout(projectThrottle.timer);
  projectThrottle.timer = window.setTimeout(() => {
    send({ t: 'project', project });
    markSent(project);
  }, 250);
}

/** Отправить проект хабу сразу (без задержки): следующее сообщение (например, summon) хаб увидит уже после него. */
export function sendProjectNow(project: Project): void {
  if (!connected) return;
  clearTimeout(projectThrottle.timer);
  projectThrottle.timer = 0;
  send({ t: 'project', project });
  markSent(project);
}

/** Сетевое хранилище: save = отправка, load = из init-проекта. */
let netProject: Project | null = null;
document.addEventListener('doska:collab-project', () => { /* проект уже применён */ });
export function setNetProject(p: Project): void { netProject = p; }
export const netStorage = {
  async list(): Promise<ProjectMeta[]> {
    return netProject ? [{ id: netProject.id, name: netProject.name, createdAt: netProject.createdAt, updatedAt: netProject.updatedAt, pageCount: netProject.pages.length }] : [];
  },
  async load(id: string): Promise<Project | null> {
    return netProject && netProject.id === id ? netProject : null;
  },
  async save(project: Project): Promise<void> {
    // все страницы скрыты: на руках только заглушка — хранить и отправлять нечего
    if (allHidden || project.pages.some(p => p.id === HIDDEN_PLACEHOLDER_ID)) return;
    netProject = project;
    sendProject(project);
  },
  async remove(): Promise<void> { /* в совместном режиме удаление недоступно */ },
};

/** Карточка с сообщением о совместной работе (справа под шапкой, как «Вышла новая версия»). */
export function showCollabNotice(title: string, text: string): void {
  document.getElementById('collab-notice')?.remove();
  const card = document.createElement('div');
  card.id = 'collab-notice';
  card.setAttribute('role', 'alert');
  const h = document.createElement('div');
  h.className = 'cn-title';
  h.textContent = title;
  const p = document.createElement('p');
  p.className = 'cn-text';
  p.textContent = text;
  card.append(h, p);
  document.body.appendChild(card);
}

export function hideCollabNotice(): void {
  document.getElementById('collab-notice')?.remove();
}

const CLOSED_NOTICES: Record<number, { title: string; text: string }> = {
  [CLOSE_PROTOCOL_MISMATCH]: {
    title: 'Версии доски не совпадают',
    text: 'У автора установлена другая версия Abax. Попросите автора обновить приложение и прислать ссылку заново.',
  },
  [CLOSE_ROOM_NOT_FOUND]: {
    title: 'Доска не найдена',
    text: 'Ссылка устарела или автор уже закрыл доступ. Попросите автора прислать новую ссылку.',
  },
  [CLOSE_BAD_CODE]: {
    title: 'Неверная ссылка',
    text: 'Проверьте ссылку или попросите автора прислать её заново.',
  },
  [CLOSE_REMOVED]: {
    title: 'Вас отключили от доски',
    text: 'Автор убрал вас из совместной работы.',
  },
  [CLOSE_ROOM_CLOSED]: {
    title: 'Совместная работа завершена',
    text: 'Автор закрыл доступ к доске.',
  },
  [CLOSE_FREE_LIMIT]: {
    title: 'Бесплатная комната занята',
    text: 'На бесплатном тарифе к доске может подключиться только один гость. Попросите автора освободить место или перейти на Pro.',
  },
  [CLOSE_ROOM_FULL]: {
    title: 'Нет свободных мест',
    text: 'К доске подключено максимальное число участников. Попробуйте позже.',
  },
  [CLOSE_HOST_OFFLINE]: {
    title: 'Автор сейчас не в сети',
    text: 'Откройте ссылку ещё раз через минуту.',
  },
  [CLOSE_RATE_LIMITED]: {
    title: 'Слишком много подключений',
    text: 'Подождите минуту и откройте ссылку снова.',
  },
  [CLOSE_TOO_SLOW]: {
    title: 'Соединение слишком медленное',
    text: 'Доска не успевала загружаться. Проверьте интернет и откройте ссылку снова.',
  },
};
const CLOSED_GENERIC = {
  title: 'Соединение с автором прервано',
  text: 'Обновите страницу, чтобы подключиться снова.',
};

const CLOSED_NO_CONNECT = {
  title: 'Не удалось подключиться к серверу',
  text: 'Сервер недоступен или не пускает с этого адреса сайта. Проверьте интернет и ссылку; если не помогает - сообщите автору: возможно, адрес сайта не разрешён на ретрансляторе (RELAY_ALLOWED_ORIGINS).',
};

/**
 * Текст для гостя, когда соединение закрылось: по известной причине — её объяснение, иначе общий.
 * neverOpened — соединение не открылось вовсе (браузер не сообщает причину: сервер недоступен или отказал в рукопожатии).
 */
export function closedNotice(code: number, neverOpened = false): { title: string; text: string } {
  if (code === CLOSE_BAD_REQUEST) return CLOSED_GENERIC;
  const known = CLOSED_NOTICES[code];
  if (known) return known;
  return neverOpened ? CLOSED_NO_CONNECT : CLOSED_GENERIC;
}

/** Уведомления ретранслятора: пока автора нет, гость видит, что доска не зависла, а ждёт автора. */
export function relayNotice(ev: RelayEvent): void {
  if (ev === 'host-away') {
    showCollabNotice('Автор переподключается…', 'Связь автора с сервером прервалась. Доска обновится, когда он вернётся.');
  } else {
    hideCollabNotice();
  }
}

// ----- DOM-курсоры удалённых пользователей -----
let cursorsRoot: HTMLElement | null = null;
/** Узлы курсоров по участнику: не пересоздаются на каждое сообщение (иначе не работают переходы и шлейф). */
const cursorNodes = new Map<number, { el: HTMLElement; arrow: HTMLElement; label: HTMLElement; cursorId: string | null; wx: number; wy: number }>();

/** Цвета участника: по его курсору, а у старой версии без курсора — цвет, который выдал хаб. */
function userColors(u: CollabUser): { selection: string; badgeBg: string; badgeText: string } {
  if (u.cursorId && isCursorId(u.cursorId)) {
    const p = cursorPreset(u.cursorId);
    return { selection: p.selectionColor, badgeBg: p.badgeBg, badgeText: p.badgeText };
  }
  const c = /^#[0-9a-fA-F]{6}$/.test(u.color) ? u.color : '#e03131';
  return { selection: c, badgeBg: c, badgeText: '#ffffff' };
}

function removeCursorNode(uid: number): void {
  const n = cursorNodes.get(uid);
  if (!n) return;
  n.el.remove();
  cursorNodes.delete(uid);
  fxForget(`u${uid}`);
}

// скрыли или снова показали чужие курсоры (меню аватаров) — перерисовать курсоры, краевые курсоры и аватары
onCursorVisibility(() => renderRemoteCursors());

export function renderRemoteCursors(): void {
  const wrap = document.getElementById('canvas-wrap');
  if (!wrap) return;
  if (!cursorsRoot || !cursorsRoot.isConnected) {
    cursorsRoot = document.getElementById('remote-cursors') ?? document.createElement('div');
    cursorsRoot.id = 'remote-cursors';
    cursorsRoot.textContent = '';
    cursorNodes.clear();
    wrap.appendChild(cursorsRoot);
  }
  const cam = state.camera;
  const seen = new Set<number>();
  for (const u of users) {
    if (u.userId === myUserId || !u.cursor || u.pageId !== state.pageId || !cursorShown(u.userId)) continue;
    seen.add(u.userId);
    const sx = (u.cursor.x - cam.x) * cam.zoom;
    const sy = (u.cursor.y - cam.y) * cam.zoom;
    let n = cursorNodes.get(u.userId);
    if (!n) {
      const el = document.createElement('div');
      // стрелка — разметка из каталога курсоров (только константы), имя — textContent
      const arrow = document.createElement('i');
      arrow.className = 'rc-arrow';
      const label = document.createElement('span');
      el.append(arrow, label);
      cursorsRoot.appendChild(el);
      n = { el, arrow, label, cursorId: null, wx: u.cursor.x, wy: u.cursor.y };
      cursorNodes.set(u.userId, n);
    }
    const id = u.cursorId && isCursorId(u.cursorId) ? u.cursorId : DEFAULT_CURSOR_ID;
    if (n.cursorId !== id) {
      n.arrow.innerHTML = cursorSvg(id, { size: 20 });
      n.cursorId = id;
    }
    const colors = userColors(u);
    n.el.className = 'remote-cursor' + (u.away ? ' away' : '') + (cursorPreset(id).effect === 'glow' ? ' glow' : '');
    n.el.style.left = `${sx}px`;
    n.el.style.top = `${sy}px`;
    // имя и цвет приходят от других участников — только textContent и свойства style, без разметки
    n.arrow.style.color = u.cursorId && isCursorId(u.cursorId) ? cursorPreset(id).effectColor : colors.badgeBg;
    n.label.style.background = u.away ? '#9aa0ab' : colors.badgeBg;
    n.label.style.color = u.away ? '#ffffff' : colors.badgeText;
    n.label.textContent = String(u.name ?? '') + (u.away ? ' · Отошёл' : '');
    // шлейф — только когда участник сам двигал мышь (панорама камеры не в счёт)
    const moved = n.wx !== u.cursor.x || n.wy !== u.cursor.y;
    n.wx = u.cursor.x;
    n.wy = u.cursor.y;
    if (u.away) fxForget(`u${u.userId}`);
    else if (moved) fxMove(`u${u.userId}`, sx, sy, id);
  }
  for (const uid of [...cursorNodes.keys()]) if (!seen.has(uid)) removeCursorNode(uid);
  // краевые курсоры, аватары у страниц и в шапке (src/collab-presence.ts)
  document.dispatchEvent(new CustomEvent(PRESENCE_EVENT));
}

/** Чужие выделения для отрисовки рамок (только активная страница). */
export function foreignSelections(): { color: string; ids: string[] }[] {
  if (!connected) return [];
  return users
    .filter(u => u.userId !== myUserId && u.pageId === state.pageId && u.selection.length > 0)
    .map(u => ({ color: u.away ? '#9aa0ab' : userColors(u).selection, ids: u.selection }));
}

/** Аватар, уже отправленный в эту комнату (фото тяжёлое — повторно не шлём); undefined — ещё не отправляли. */
let sentAvatar: string | null | undefined;

/** Свой профиль поменялся (имя, курсор или аватар) — сообщить комнате (хаб разошлёт всем); withName — и имя. */
function sendProfile(withName = true): void {
  if (!connected) return;
  const name = withName ? profileName() : '';
  const avatar = myAvatar();
  send({ t: 'profile', ...(name ? { name } : {}), cursorId: myCursorId(), ...(avatar !== sentAvatar ? { avatar } : {}) });
  sentAvatar = avatar;
}
onProfileChange(() => sendProfile());

/** Локальное хранилище автора на время совместной работы (save дополнительно рассылает проект). */
let hostLocalStorage: BoardsStorage | null = null;

/** Подключение автора (host) к собственному серверу совместной работы. */
export async function startHostConnection(port: number, code: string, hostKey: string, name: string): Promise<void> {
  const q = new URLSearchParams({ code, key: hostKey });
  await startCollab(`ws://127.0.0.1:${port}/ws?${q}`, true, name);
  finishHostConnection();
}

/** Автор подключился к комнате любым каналом (WebSocket приложения или память вкладки браузера). */
export async function connectHost(t: CollabTransport): Promise<void> {
  await connectCollab(t, true);
  finishHostConnection();
}

/**
 * Автор подключается к своей облачной комнате на сервере: состояние проекта берётся у сервера (в комнате без автора
 * его могли изменить гости), поэтому локальный проект в комнату не отправляется — дальше уходят только правки.
 * true — комната прислала состояние.
 */
export async function connectCloudHost(t: CollabTransport): Promise<boolean> {
  await connectCollab(t, true);
  if (!(await collabReady())) return false;
  finishHostConnection(false);
  return true;
}

function finishHostConnection(initialSend = true): void {
  // правки автора уходят гостям тем же путём, что и автосохранение
  if (!hostLocalStorage) {
    const local = storage;
    hostLocalStorage = local;
    setStorage({ ...local, save: async project => { await local.save(project); sendProject(project); } });
  }
  if (initialSend) sendProject(state.project);
}

export function stopCollab(): void {
  if (hostLocalStorage) { setStorage(hostLocalStorage); hostLocalStorage = null; }
  const t = transport;
  transport = null;
  t?.close();
  connected = false;
  settleReady(false);
  hubPatches = false;
  dropRemotePointers();
  for (const d of draftSends.values()) clearTimeout(d.timer);
  draftSends.clear();
  baselines.clear();
  sentStructure = null;
  incoming.length = 0;
  clearTimeout(syncThrottle.timer);
  syncThrottle.timer = 0;
  users = [];
  photos.clear();
  usersKnown = false;
  followHost = false;
  myUserId = -1;
  myAccessRole = null;
  myCaps = null;
  myPrincipalId = null;
  pendingResume = null;
  createdByMe.clear();
  clearTimeout(viewTimer);
  viewTimer = 0;
  viewSent = null;
  presenceKey = '';
  hostPages.clear();
  resetCursorVisibility();
  setChatSender(null);
  setChatAvatarLookup(null);
  setChatAvailable(false);
  // уведомления — о комнате: с концом совместной работы счётчик и стопка пустеют
  clearNotifyStack();
  clearNotices();
  if (allHidden) { allHidden = false; setAllHiddenBanner(false); }
  state.collabRole = null;
  renderRemoteCursors();
}

