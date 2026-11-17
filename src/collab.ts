import type { Element, FadeStroke, GridMode, Page, Project, ProjectMeta, Pt } from './types';
import { state, openProject, setSelection, isDraftId, onDraft, onChange, touchProject, update } from './state';
import { MAX_PATCH_OPS, applyBoardPatch, diffElements, isBoardPatch, type BoardPatch } from './delta';
import { gestureActive } from './gesture';
import { sanitizeComments } from './file';
import { clientId } from './identity';
import { DEFAULT_CURSOR_ID, cursorPreset, cursorSvg, isCursorId } from './cursors';
import { fxForget, fxMove } from './cursor-fx';
import { myCursorId, onProfileChange, profileName } from './profile';
import { setStorage, storage, type BoardsStorage } from './storage';
import { getApi } from './api-client';
import { hydrateFromCloud } from './cloud-assets';
import { clearPills, diffUsers, showPill, showUserEvents } from './activity-pills';
import { chatReceive, chatReset, setChatAvailable, setChatSender } from './collab-chat';
import {
  CLOSE_BAD_CODE, CLOSE_BAD_REQUEST, CLOSE_FREE_LIMIT, CLOSE_HOST_OFFLINE, CLOSE_PROTOCOL_MISMATCH, CLOSE_RATE_LIMITED,
  CLOSE_ROOM_CLOSED, CLOSE_ROOM_FULL, CLOSE_ROOM_NOT_FOUND, CLOSE_TOO_SLOW, PROTO,
  wsTransport, type CollabTransport, type RelayEvent,
} from './collab-transport';

export { PROTO };

/** Событие на document, когда соединение закрылось; detail — код и причина. */
export interface CollabClosedDetail { code: number; reason: string }

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
  /** Участник на странице, скрытой от меня: где он, не сообщается (SPEC_NIGHT5 §3.1). */
  hiddenPage?: boolean;
}

/** Событие на document: автор позвал всех на страницу (SPEC_NIGHT5 §8); камеру наводит приложение. */
export interface CollabSummonDetail { pageId: string; vx: number; vy: number; vz: number; by: number }

let transport: CollabTransport | null = null;
let myUserId = -1;
let users: CollabUser[] = [];
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


export function collabActive(): boolean { return connected; }
export function myColor(): string { return users.find(u => u.userId === myUserId)?.color || '#e03131'; }
export function myName(): string { return users.find(u => u.userId === myUserId)?.name || ''; }
export function isHost(): boolean { return role === 'host'; }
/** Автор включил автопереход участников за собой. */
export function hostFollowEnabled(): boolean { return followHost; }
/** Участники комнаты (как их видит этот клиент: с маскировкой скрытых страниц). */
export function collabUsers(): readonly CollabUser[] { return users; }
/** Мой номер участника в комнате (-1 — не подключён). */
export function myCollabId(): number { return myUserId; }

/** Сообщение в чат комнаты; false — нет соединения. */
export function sendChat(text: string): boolean {
  if (!connected || !transport) return false;
  return transport.send(JSON.stringify({ t: 'chat', text })) !== false;
}
const cursorThrottle: { last: number; timer: number; pending: { x: number; y: number } | null } = { last: 0, timer: 0, pending: null };
const projectThrottle: { timer: number } = { timer: 0 };

/** Право на активной странице: edit / view / hidden. */
export function pageRight(pageId: string): 'edit' | 'view' | 'hidden' {
  if (role === 'host' || isDraftId(pageId)) return 'edit';
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
  myUserId = -1;
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
      usersKnown = Array.isArray(m.users);
      if (Array.isArray(m.users)) users = m.users as CollabUser[];
      followHost = m.followHost === true;
      setChatSender(sendChat);
      setChatAvailable(true);
      chatReset(m.chat, myUserId);
      if (lostAt !== null && Date.now() - lostAt < RESTORE_WINDOW_MS) showPill({ kind: 'ok', text: 'Связь с доской восстановлена' });
      lostAt = null;
      // хаб умеет патчи — сообщаем, что мы тоже: до ответа он шлёт полные проекты
      hubPatches = m.patches === true;
      if (hubPatches) send({ t: 'caps', patches: true });
      if (m.project) applyRemoteProject(m.project as Project);
      renderRemoteCursors();
      settleReady(true);
    } else if (m.t === 'users') {
      const next = Array.isArray(m.users) ? m.users as CollabUser[] : users;
      if (usersKnown) showUserEvents(diffUsers(users, next, myUserId));
      usersKnown = true;
      users = next;
      renderRemoteCursors();
    } else if (m.t === 'rights') {
      const nextRights = (m.rights as typeof myRights) || myRights;
      if (role === 'guest' && JSON.stringify(nextRights) !== JSON.stringify(myRights)) showPill({ kind: 'info', text: 'Автор изменил права доступа' });
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
    } else if (m.t === 'chat') {
      chatReceive(m);
    } else if (m.t === 'follow-host') {
      followHost = m.enabled === true;
    } else if (m.t === 'summon') {
      receiveSummon(m);
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
      connected = false;
      dropRemotePointers();
      renderRemoteCursors();
      settleReady(false);
      setChatSender(null);
      notifyClosed(code, reason);
      // гостю причину объясняет карточка уведомления; автору — пилюля: его комната подключится снова
      if (wasInRoom && role === 'host') {
        lostAt = Date.now();
        showPill({ kind: 'warn', text: 'Соединение прервано, переподключаемся…' });
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
  showPill({ kind: 'info', text: `Автор позвал всех на страницу «${page.name}»` });
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

function notifyClosed(code: number, reason: string): void {
  document.dispatchEvent(new CustomEvent<CollabClosedDetail>('doska:collab-closed', { detail: { code, reason } }));
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
  const keepPageId = state.pageId;
  const keepCam = { ...state.camera };
  openProject(project, keepPageId ?? undefined);
  state.camera = keepCam;
  setSelection([...state.selection]);
  // содержимое теперь общее: следующие правки считаются от него
  markSent(state.project);
  document.dispatchEvent(new CustomEvent('doska:collab-project'));
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

// ----- Указка: лазер, исчезающий маркер и подсветка объектов видны остальным участникам -----

const TRAIL_FLUSH_MS = 40;
/** Не больше, чем хаб принимает в одном сообщении. */
const TRAIL_CHUNK = 64;
const TRAIL_MAX_PTS = 400;
const FADE_MAX_PTS = 4000;
/** Росчерк, от которого давно нет вестей (связь оборвалась), считаем оторванным. */
const REMOTE_STALE_MS = 8000;
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

/** Чужие исчезающие росчерки, которые ещё тянутся: ключ — «участник:росчерк». */
const remoteFades = new Map<string, { stroke: FadeStroke; at: number }>();

function releaseRemoteFades(onlyStale: boolean): void {
  const now = performance.now();
  for (const [key, f] of remoteFades) {
    if (onlyStale && now - f.at < REMOTE_STALE_MS) continue;
    f.stroke.endT = now;
    remoteFades.delete(key);
  }
}

function dropRemotePointers(): void {
  for (const [key, o] of trailOut) { clearTimeout(o.timer); trailOut.delete(key); }
  state.remoteLasers.clear();
  releaseRemoteFades(false);
}

const finiteNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Указка другого участника. Хаб уже проверил форму, но клиент не полагается на это: проект и сообщения могут прийти откуда угодно. */
function applyIncomingPointer(m: Record<string, unknown>): void {
  const by = m.by;
  if (!finiteNum(by) || by === myUserId || m.pageId !== state.pageId) return;
  releaseRemoteFades(true);
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
  const key = `${by}:${m.sid}`;
  let f = remoteFades.get(key);
  if (!f) {
    const opacity = finiteNum(m.opacity) && m.opacity < 1 ? Math.max(0, m.opacity) : undefined;
    const stroke: FadeStroke = { color, width: m.width, ...(opacity !== undefined ? { opacity } : {}), pts: [], endT: null };
    f = { stroke, at: now };
    remoteFades.set(key, f);
    state.fadeStrokes.push(stroke);
  }
  f.at = now;
  if (f.stroke.pts.length < FADE_MAX_PTS) f.stroke.pts.push(...pts);
  if (end) { f.stroke.endT = now; remoteFades.delete(key); }
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

export type CommentRequest =
  | { op: 'create'; x: number; y: number; targetElementId?: string; text: string }
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
  if (!connected) return;
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

/** Текст для гостя, когда соединение закрылось: по известной причине — её объяснение, иначе общий. */
export function closedNotice(code: number): { title: string; text: string } {
  if (code === CLOSE_BAD_REQUEST) return CLOSED_GENERIC;
  return CLOSED_NOTICES[code] ?? CLOSED_GENERIC;
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
    if (u.userId === myUserId || !u.cursor || u.pageId !== state.pageId) continue;
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
      n.arrow.innerHTML = cursorSvg(id, { size: 24 });
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
}

/** Чужие выделения для отрисовки рамок (только активная страница). */
export function foreignSelections(): { color: string; ids: string[] }[] {
  if (!connected) return [];
  return users
    .filter(u => u.userId !== myUserId && u.pageId === state.pageId && u.selection.length > 0)
    .map(u => ({ color: u.away ? '#9aa0ab' : userColors(u).selection, ids: u.selection }));
}

/** Свой профиль поменялся (имя или курсор) — сообщить комнате (хаб разошлёт всем). */
function sendProfile(): void {
  if (!connected) return;
  const name = profileName();
  send({ t: 'profile', ...(name ? { name } : {}), cursorId: myCursorId() });
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
  usersKnown = false;
  followHost = false;
  myUserId = -1;
  setChatSender(null);
  setChatAvailable(false);
  clearPills();
  state.collabRole = null;
  renderRemoteCursors();
}

