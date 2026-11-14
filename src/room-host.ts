// Комната совместной работы в браузере: участники, права, склейка проекта и дельта-патчи.
// Порт electron/room.cjs на TypeScript: без Node.js и ws — сокет участника задаёт интерфейс RoomSocket,
// сообщения приходят строкой или байтами UTF-8 (Uint8Array).

import type { Element, Page, PageRight, PlanTier, Project, TaskEl } from './types';
import { PLAN_LIMITS, canCreatePage, canGuestJoinRoom, effectivePermissions, isPageRight, planOf } from './limits';
import { applyBoardPatch, isBoardPatch, type BoardPatch, type ElementOp } from './delta';
import { sanitizeElement } from './file';
import { CLOSE_FREE_LIMIT, PROTO } from './collab-transport';
import { mergeGuestTask, projectTaskForRole } from './task-element';

export { PROTO };

const COLORS = ['#e8590c', '#1971c2', '#2f9e44', '#9c36b5', '#0c8599', '#f08c00'];
export const MAX_ID = 128;
export const MAX_SELECTION = 10000;
export const MAX_NAME = 40;
const DEFAULT_AWAY_MS = 45000;
/** Причина отказа гостю в бесплатной комнате. */
export const FREE_LIMIT_REASON = 'free-limit-reached';

/** Права участника: по умолчанию и по страницам. */
export interface UserRights { default: PageRight; pages: Record<string, PageRight> }

/**
 * Сокет участника — всё, что комнате нужно от транспорта: readyState (1 — канал открыт),
 * send(text), close(code?, reason?), on('message' | 'close', fn).
 */
export interface RoomSocket {
  readyState: number;
  send(text: string): void;
  close(code?: number, reason?: string): void;
  on(ev: 'message', fn: (raw: string | Uint8Array | ArrayBuffer) => void): void;
  on(ev: 'close', fn: () => void): void;
}

export interface RoomHubOptions {
  code: string;
  /** Новые гости сразу редакторы. */
  openEdit?: boolean;
  /** Тариф автора; нет — по ownerPlan проекта, а у проекта без него — free. */
  plan?: PlanTier;
  /** Сколько гостей (без автора) можно допустить; по умолчанию — по тарифу: free 1, pro/tutor безлимит. */
  maxGuests?: number;
  /** Сколько участников (с автором) могут одновременно быть редакторами; по умолчанию — по тарифу. */
  maxEditors?: number;
  /** Можно ли гостям копировать; по умолчанию — из прав проекта (allowCopy и forbidClone). */
  allowCopy?: boolean;
  /** Через сколько молчания участник считается «отошедшим». */
  awayMs?: number;
  /** Часы (для тестов). */
  now?: () => number;
}

export interface AttachOptions {
  isHost?: boolean;
  name?: string;
  /** Участник понимает пакеты t: 'patch'; иначе ему шлются полные проекты. Также включается сообщением { t: 'caps', patches: true }. */
  patches?: boolean;
}

type Rec = Record<string, unknown>;

interface Client {
  sock: RoomSocket;
  uid: number;
  host: boolean;
  name: string;
  color: string;
  last: number;
  cursor: { x: number; y: number } | null;
  pageId: string | null;
  selection: string[];
  patches: boolean;
}

export interface UserSnapshot {
  userId: number;
  name: string;
  color: string;
  host: boolean;
  away: boolean;
  cursor: { x: number; y: number } | null;
  pageId: string | null;
  selection: string[];
  rights: { default: string; pages: Record<string, string> };
}

/**
 * Имя участника приходит от него самого и уходит остальным: управляющие символы и переключатели
 * направления текста заменяются пробелами, пробелы схлопываются, длина — до MAX_NAME символов.
 */
export function normalizeName(raw: unknown): string {
  const s = String(raw ?? '')
    .replace(/[\p{Cc}\u2028\u2029\u202A-\u202E\u2066-\u2069]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return Array.from(s).slice(0, MAX_NAME).join('').trim();
}

// ----- Проверка входящих сообщений: они приходят от участников и не заслуживают доверия -----

const isId = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= MAX_ID;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isObj = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);
const optPageId = (v: unknown) => v === undefined || v === null || isId(v);

function validCursor(m: Rec): boolean {
  return isNum(m.x) && isNum(m.y) && optPageId(m.pageId);
}
/** Без ids — пустое выделение (так клиент снимает выделение). */
function validSelection(m: Rec): boolean {
  const ids = m.ids ?? [];
  return Array.isArray(ids) && ids.length <= MAX_SELECTION && ids.every(isId) && optPageId(m.pageId);
}
function validPage(pg: unknown): pg is Page {
  return isObj(pg) && isId(pg.id) && Array.isArray(pg.elements)
    && pg.elements.every(el => isObj(el) && isId(el.id) && typeof el.type === 'string');
}
function validProject(p: unknown): p is Project {
  if (!isObj(p) || !isId(p.id) || !Array.isArray(p.pages) || !p.pages.every(validPage)) return false;
  return new Set(p.pages.map(pg => pg.id)).size === p.pages.length;
}

// ----- Задания: ученик не получает ответов и не может их подменить -----

const isTask = (el: Element): el is TaskEl & Element => el.type === 'task';

/** Страницы так, как их видит ученик: у заданий нет ответа и закрытого решения. Нетронутые страницы — те же объекты. */
function projectPagesForGuest(pages: Page[]): Page[] {
  return pages.map(pg => (pg.elements.some(isTask)
    ? { ...pg, elements: pg.elements.map(el => (isTask(el) ? projectTaskForRole(el, 'guest') as Element : el)) }
    : pg));
}

/** Элемент от участника поверх известного автору: у задания принимается только ввод ученика (черновик и попытки). */
function guardedElement(known: Element | undefined, incoming: Element): Element {
  if (!isTask(incoming) || !known || !isTask(known)) return incoming;
  return mergeGuestTask(known, incoming) as Element;
}

/** Страница участника поверх страницы автора с защитой заданий. */
function guardedPage(known: Page, incoming: Page): Page {
  if (!incoming.elements.some(isTask)) return incoming;
  const byId = new Map(known.elements.map(e => [e.id, e]));
  return { ...incoming, elements: incoming.elements.map(el => guardedElement(byId.get(el.id), el)) };
}

const decoder = new TextDecoder();
function textOf(raw: string | Uint8Array | ArrayBuffer): string {
  return typeof raw === 'string' ? raw : decoder.decode(raw);
}

export interface RoomHub {
  readonly room: Room;
  /** Подключить участника; uid или null, если подключение отклонено. Доступ (код, ключ автора) проверяет транспорт. */
  attach(sock: RoomSocket, opts?: AttachOptions): number | null;
  /** Заново отправить участнику полное состояние (мог пропустить сообщения). false — такого участника нет. */
  refresh(sock: RoomSocket): boolean;
  setRights(uid: number, patch: { default?: PageRight; all?: PageRight; pages?: Record<string, PageRight> }): { ok: boolean; error?: string };
  /** Заменить проект и разослать его всем. */
  pushProject(project: Project): void;
  /** Применить патч от имени автора и разослать всем. false — патч не принят. */
  pushPatch(patch: BoardPatch): boolean;
  users(): UserSnapshot[];
  closeAll(): void;
}

/** Состояние комнаты: проект, участники и их права. */
export class Room {
  project: Project | null = null;
  clients = new Map<RoomSocket, Client>();
  rights = new Map<number, UserRights>();
  nextUid = 1;
  /** Ревизии страниц: растут с каждым принятым патчем. */
  revs = new Map<string, number>();

  constructor(readonly code: string, private readonly opts: { now: () => number; awayMs: number; maxEditors: () => number }) {}

  private open(): Client[] {
    return [...this.clients.values()].filter(c => c.sock.readyState === 1);
  }
  clientOf(uid: number): Client | undefined {
    return [...this.clients.values()].find(c => c.uid === uid);
  }
  guestCount(): number {
    return this.open().filter(c => !c.host).length;
  }

  static canEditAnything(r: UserRights | undefined): boolean {
    if (!r) return false;
    if (r.default === 'edit') return true;
    return Object.values(r.pages || {}).some(m => m === 'edit');
  }
  userCanEditAnything(uid: number): boolean {
    return Room.canEditAnything(this.rights.get(uid));
  }
  /** Сколько открытых участников редактируют; автор считается всегда, probe — права «что если». */
  editorsCount(probe: Map<number, UserRights> = this.rights): number {
    let n = 0;
    for (const c of this.open()) {
      if (c.host || Room.canEditAnything(probe.get(c.uid))) n++;
    }
    return n;
  }
  userPageRight(uid: number, pageId: string): PageRight {
    const info = this.clientOf(uid);
    if (info?.host) return 'edit';
    const r = this.rights.get(uid);
    if (!r) return 'view';
    return r.pages[pageId] || r.default || 'view';
  }
  visiblePages(uid: number): Page[] {
    if (!this.project) return [];
    if (this.clientOf(uid)?.host) return this.project.pages;
    return this.project.pages.filter(pg => this.userPageRight(uid, pg.id) !== 'hidden');
  }
  setRights(uid: number, patch: { default?: PageRight; all?: PageRight; pages?: Record<string, PageRight> }): { ok: boolean; error?: string } {
    if (this.clientOf(uid)?.host) return { ok: false, error: 'Автор всегда редактор' };
    const r = this.rights.get(uid) || { default: 'view' as PageRight, pages: {} };
    const next: UserRights = { default: r.default, pages: { ...r.pages } };
    if (isPageRight(patch.default)) next.default = patch.default;
    if (isPageRight(patch.all)) { next.default = patch.all; next.pages = {}; }
    for (const [pid, mode] of Object.entries(patch.pages || {})) if (isPageRight(mode)) next.pages[pid] = mode;
    // лимит редакторов: применяем патч и проверяем, не превысил ли участник порог
    const wasEditor = this.userCanEditAnything(uid);
    const probe = new Map(this.rights);
    probe.set(uid, next);
    const max = this.opts.maxEditors();
    if (!wasEditor && this.editorsCount(probe) > max) {
      return { ok: false, error: `Максимум ${max} одновременных редакторов` };
    }
    this.rights.set(uid, next);
    return { ok: true };
  }
  usersSnapshot(): UserSnapshot[] {
    const now = this.opts.now();
    return [...this.clients.values()].map(c => {
      const r = this.rights.get(c.uid);
      return {
        userId: c.uid, name: c.name, color: c.color, host: c.host,
        away: now - c.last > this.opts.awayMs,
        cursor: c.cursor, pageId: c.pageId, selection: c.selection,
        rights: { default: c.host ? 'edit' : (r?.default || 'view'), pages: c.host ? {} : (r?.pages || {}) },
      };
    });
  }
}

/** Хаб комнаты: принимает участников от любого транспорта и рассылает им сообщения. */
export function createRoomHub(options: RoomHubOptions): RoomHub {
  const now = options.now ?? (() => Date.now());
  const planNow = (): PlanTier => options.plan ?? planOf(room.project);
  const maxEditors = () => options.maxEditors ?? PLAN_LIMITS[planNow()].maxEditors;
  const allowCopy = () => {
    if (options.allowCopy !== undefined) return options.allowCopy;
    const perms = effectivePermissions(room.project);
    return perms.allowCopy !== false && perms.forbidClone !== true;
  };
  const room: Room = new Room(options.code, { now, awayMs: options.awayMs ?? DEFAULT_AWAY_MS, maxEditors });
  const guestAllowed = () => options.maxGuests !== undefined ? room.guestCount() < options.maxGuests : canGuestJoinRoom(planNow(), room.guestCount());

  const sendTo = (sock: RoomSocket, obj: unknown): void => {
    if (sock.readyState === 1) try { sock.send(JSON.stringify(obj)); } catch { /* канал закрывается */ }
  };

  function broadcastUsers(): void {
    const users = { t: 'users', users: room.usersSnapshot() };
    for (const c of room.clients.values()) sendTo(c.sock, users);
  }

  const projectFor = (info: Client): Project | null =>
    info.host ? room.project : (room.project ? { ...room.project, pages: projectPagesForGuest(room.visiblePages(info.uid)) } : null);

  function rightsOf(uid: number): UserRights {
    const r = room.rights.get(uid);
    const pages: Record<string, PageRight> = {};
    if (room.project) for (const pg of room.project.pages) pages[pg.id] = room.userPageRight(uid, pg.id);
    return { default: r?.default || 'view', pages };
  }

  const initFor = (info: Client) => ({
    t: 'init', proto: PROTO, userId: info.uid, color: info.color, name: info.name,
    project: projectFor(info), rights: rightsOf(info.uid), allowCopy: allowCopy(), users: room.usersSnapshot(),
  });

  /** Права нового гостя: по умолчанию и по страницам, заданным автором в permissions.pageRights. */
  function initialRights(): UserRights {
    const pages: Record<string, PageRight> = {};
    for (const [id, r] of Object.entries(room.project?.permissions?.pageRights ?? {})) if (isPageRight(r)) pages[id] = r;
    return { default: options.openEdit ? 'edit' : 'view', pages };
  }

  function attach(sock: RoomSocket, { isHost = false, name = '', patches = false }: AttachOptions = {}): number | null {
    if (isHost && [...room.clients.values()].some(c => c.host && c.sock.readyState === 1)) {
      sock.close(4409, 'host already connected');
      return null;
    }
    if (!isHost && !guestAllowed()) {
      sendTo(sock, { t: 'denied', reason: FREE_LIMIT_REASON });
      sock.close(CLOSE_FREE_LIMIT, FREE_LIMIT_REASON);
      return null;
    }
    const uid = isHost ? 0 : room.nextUid++;
    const info: Client = {
      sock, uid, host: isHost,
      name: normalizeName(name) || (isHost ? 'Автор' : `Гость ${uid}`),
      color: isHost ? '#e03131' : COLORS[uid % COLORS.length],
      last: now(), cursor: null, pageId: null, selection: [], patches,
    };
    room.clients.set(sock, info);
    room.rights.set(uid, isHost ? { default: 'edit', pages: {} } : initialRights());

    sendTo(sock, initFor(info));
    broadcastUsers(); // остальные сразу видят нового участника

    sock.on('message', raw => {
      info.last = now();
      let m: unknown;
      try { m = JSON.parse(textOf(raw)); } catch { return; }
      if (!isObj(m)) return;
      if (m.t === 'cursor') {
        if (!validCursor(m)) return;
        info.cursor = { x: m.x as number, y: m.y as number };
        info.pageId = (m.pageId as string | null | undefined) ?? info.pageId;
        broadcastUsers();
        return;
      }
      if (m.t === 'selection') {
        if (!validSelection(m)) return;
        info.selection = (m.ids as string[] | undefined) ?? [];
        info.pageId = (m.pageId as string | null | undefined) ?? info.pageId;
        broadcastUsers();
        return;
      }
      if (m.t === 'caps') {
        info.patches = m.patches === true;
        return;
      }
      if (m.t === 'project') {
        if (validProject(m.project)) acceptProject(info, m.project);
        return;
      }
      if (m.t === 'patch') {
        if (isBoardPatch(m)) acceptPatch(info, m);
      }
    });
    sock.on('close', () => { room.clients.delete(sock); broadcastUsers(); });
    return uid;
  }

  /** Страницы присланного проекта поверх известных — только те, где у отправителя есть edit. */
  function mergePages(uid: number, isHost: boolean, project: Project): Project {
    const merged: Project = { ...project, pages: room.project!.pages.map(oldPg => {
      const newPg = project.pages.find(p => p.id === oldPg.id);
      if (!newPg || room.userPageRight(uid, oldPg.id) !== 'edit') return oldPg;
      return isHost ? newPg : guardedPage(oldPg, newPg);
    }) };
    // новые страницы разрешаем добавлять только тем, у кого есть хоть одна edit; на free — не больше лимита
    for (const newPg of project.pages) {
      if (merged.pages.some(p => p.id === newPg.id) || !room.userCanEditAnything(uid)) continue;
      if (!isHost && !canCreatePage(planNow(), merged.pages.length)) continue;
      merged.pages.push(newPg);
    }
    return merged;
  }

  function acceptProject(info: Client, project: Project): void {
    if (!room.project) {
      // первый проект задаёт только автор
      if (!info.host) return;
      room.project = project;
    } else if (info.host) {
      room.project = mergePages(info.uid, true, project);
    } else {
      // id, название, иконку, тариф и права проекта меняет только автор: иначе гость мог бы подменить id,
      // и автор сохранил бы доску поверх другой своей доски, или снять запрет на копирование
      const merged = mergePages(info.uid, false, project);
      room.project = { ...room.project, pages: merged.pages, updatedAt: isNum(project.updatedAt) ? project.updatedAt : room.project.updatedAt };
    }
    for (const c of room.clients.values()) {
      if (c.sock !== info.sock) sendTo(c.sock, { t: 'project', project: projectFor(c), by: info.uid });
    }
  }

  /** Операции так, как их видит ученик: у заданий в put нет ответа. */
  const opsForGuest = (ops: ElementOp[]): ElementOp[] =>
    ops.map(op => (op.op === 'put' && isTask(op.el) ? { op: 'put', el: projectTaskForRole(op.el, 'guest') as Element } : op));

  /** Принять патч страницы от участника: нужен edit на ней. Применяется к странице хаба и уходит остальным. */
  function acceptPatch(info: Client | null, patch: BoardPatch): boolean {
    const project = room.project;
    if (!project || !project.pages.some(p => p.id === patch.pageId)) return false;
    if (info && room.userPageRight(info.uid, patch.pageId) !== 'edit') return false;
    const known = new Map(project.pages.find(p => p.id === patch.pageId)!.elements.map(e => [e.id, e]));
    const fromGuest = !!info && !info.host;
    const ops: ElementOp[] = [];
    for (const op of patch.ops) {
      if (op.op !== 'put') { ops.push(op); continue; }
      const el = sanitizeElement(op.el);
      if (el) ops.push({ op: 'put', el: fromGuest ? guardedElement(known.get(el.id), el) : el });
    }
    const rev = (room.revs.get(patch.pageId) ?? 0) + 1;
    room.revs.set(patch.pageId, rev);
    const clean: BoardPatch = { ...patch, ops, rev };
    room.project = {
      ...project,
      updatedAt: now(),
      pages: project.pages.map(pg => (pg.id === patch.pageId ? applyBoardPatch(pg, clean) : pg)),
    };
    const by = info ? info.uid : -1;
    for (const c of room.clients.values()) {
      if (info && c.sock === info.sock) continue;
      if (room.userPageRight(c.uid, patch.pageId) === 'hidden') continue; // скрытая страница до участника не доходит
      if (c.patches) sendTo(c.sock, { ...clean, ops: c.host ? ops : opsForGuest(ops), by });
      else sendTo(c.sock, { t: 'project', project: projectFor(c), by });
    }
    return true;
  }

  function pushRights(uid: number): void {
    const c = room.clientOf(uid);
    if (!c) return;
    sendTo(c.sock, { t: 'rights', rights: rightsOf(uid), allowCopy: allowCopy() });
    // состав видимых страниц мог измениться: скрытая страница пропадает у гостя сразу, открытая — появляется
    if (room.project) sendTo(c.sock, { t: 'project', project: projectFor(c), by: -1 });
  }

  return {
    room,
    attach,
    refresh(sock) {
      const info = room.clients.get(sock);
      if (!info) return false;
      sendTo(sock, initFor(info));
      return true;
    },
    setRights(uid, patch) {
      const r = room.setRights(uid, patch);
      broadcastUsers();
      pushRights(uid);
      return r;
    },
    pushProject(project) {
      room.project = project;
      for (const c of room.clients.values()) sendTo(c.sock, { t: 'project', project: projectFor(c), by: -1 });
    },
    pushPatch: patch => acceptPatch(null, patch),
    users: () => room.usersSnapshot(),
    closeAll() {
      for (const sock of [...room.clients.keys()]) try { sock.close(); } catch { /* уже закрыт */ }
    },
  };
}
