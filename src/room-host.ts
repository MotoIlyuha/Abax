// Комната совместной работы в браузере: участники, права, склейка проекта и дельта-патчи.
// Порт electron/room.cjs на TypeScript: без Node.js и ws — сокет участника задаёт интерфейс RoomSocket,
// сообщения приходят строкой или байтами UTF-8 (Uint8Array).

import type { Element, Page, PageRight, PlanTier, Project, TaskEl } from './types';
import { PLAN_LIMITS, canCreatePage, effectiveMaxGuests, isPageRight, planOf, sanitizePermissionsForPlan } from './limits';
import { OWNER_CAPS, effectivePageAccess, normalizeRole, participantCaps, type AccessRole, type ParticipantCaps, type StoredRole } from './access';
import { applyBoardPatch, isBoardPatch, type BoardPatch, type ElementOp } from './delta';
import { sanitizeElement } from './file';
import { CLOSE_FREE_LIMIT, CLOSE_ROOM_FULL, PROTO } from './collab-transport';
import { CHAT_HISTORY, createRateLimiter, normalizeChatText, type ChatMessage } from './room-chat';
import { cleanCursorId } from './cursors';
import { addCommentReply, createCommentThread, resolveCommentThread, toggleElementReaction } from './comments';
import { mergeGuestTask, mergeHostTask, projectTaskForRole, submitTaskAttempt, updateStudentDraft } from './task-element';

export { PROTO };

const COLORS = ['#e8590c', '#1971c2', '#2f9e44', '#9c36b5', '#0c8599', '#f08c00'];
export const MAX_ID = 128;
export const MAX_SELECTION = 10000;
export const MAX_NAME = 32;
const DEFAULT_AWAY_MS = 45000;
/** Причина закрытия сокета гостю в бесплатной комнате (текст кода 4402). */
export const FREE_LIMIT_REASON = 'free-limit-reached';
/** Причина отказа в пакете { t: 'denied' }, когда мест нет по лимиту автора (planLimited: false, код 4430). */
export const ROOM_FULL_REASON = 'room-full';
/** Пределы зума в пакетах view и summon — как ZOOM_MIN / ZOOM_MAX в src/state.ts (паритет — tests/unit/room-host.test.ts). */
export const VIEW_ZOOM_MIN = 0.05;
export const VIEW_ZOOM_MAX = 32;

/** Что изменило состояние проекта в комнате. */
export type ChangeKind = 'patch' | 'project' | 'task-draft' | 'task-submit' | 'react' | 'comment';

/** Права участника: по умолчанию и по страницам. */
export interface UserRights { default: PageRight; pages: Record<string, PageRight> }

/** Откуда у участника доступ (видит только автор). */
export type AccessSource = 'owner' | 'link' | 'alias' | 'email' | 'p2p';

/**
 * Доступ участника по слоям (SPEC_NIGHT6 §3.1): роль, личные права страниц и откуда доступ. Итоговое право страницы
 * считается из них и прав страниц проекта (effectivePageAccess) — личное право живой сменой права страницы не затирается.
 */
export interface ParticipantAccess {
  role: AccessRole;
  /** Старая роль edit/view (Ночи №3–5): право страницы edit повышает её, как раньше. */
  legacy: boolean;
  /** Личные права по страницам (таблица участников P2P, старые page_rights приглашения). */
  personal: Record<string, PageRight>;
  /** Личное право на все страницы, кроме названных в personal (старое setRights({ all: 'hidden' })). */
  personalAll?: PageRight;
  /** Ссылка участника запрещает копирование (старые ссылки с allow_copy = 0). */
  inviteAllowCopy?: boolean;
  source: AccessSource;
  /** Приглашение, по которому вошёл участник (автор сопоставляет его со своим списком). */
  inviteId?: string;
  /** Автор элементов этого участника (SPEC_NIGHT6 §4); null — выдаст хаб. */
  principal?: string | null;
}

/** Доступ из параметров подключения (облачная комната): роль — хранимое значение, включая старые синонимы. */
export interface AttachAccess {
  role?: StoredRole;
  personal?: Record<string, PageRight>;
  inviteAllowCopy?: boolean;
  source?: AccessSource;
  inviteId?: string;
  principal?: string | null;
}

/** Правка прав участника автором: роль, право по умолчанию (старое), всё сразу, личные права страниц (null — снять). */
export interface RightsPatch {
  /** Роль; старые синонимы edit/view оставляют старые правила (legacy). */
  role?: StoredRole;
  default?: PageRight;
  all?: PageRight;
  pages?: Record<string, PageRight | null>;
}

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
  /**
   * Сколько гостей (без автора) можно допустить; по умолчанию — по тарифу (free 1, pro/tutor безлимит)
   * и лимиту автора permissions.maxGuests (Pro/Tutor, SPEC_NIGHT5 §3.3).
   */
  maxGuests?: number;
  /** Можно ли автору включать «Автопереход за мной»; по умолчанию — по тарифу (PLAN_LIMITS.canFollowHost). */
  canFollowHost?: boolean;
  /** Несколько соединений автора (его устройства) вместо отказа 4409; включает облачная комната (SPEC_NIGHT5 §2.3). */
  multiHost?: boolean;
  /** Сколько участников (с автором) могут одновременно быть редакторами; по умолчанию — по тарифу. */
  maxEditors?: number;
  /** Можно ли гостям копировать; по умолчанию — из прав проекта (allowCopy и forbidClone). Функция — значение может меняться. */
  allowCopy?: boolean | (() => boolean);
  /**
   * Состояние проекта в комнате изменилось (серверная комната сохраняет его в базу). Не вызывается из pushProject:
   * его делает сам владелец комнаты. kind — что произошло: patch, project, task-draft, task-submit, react, comment.
   */
  onChange?: (project: Project, kind: ChangeKind) => void;
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
  /** Права гостя вместо прав по умолчанию (старый вид: default — роль-синоним, pages — личные права). */
  rights?: UserRights;
  /** Доступ гостя по слоям (облачная комната, SPEC_NIGHT6 §3.1); главнее rights. */
  access?: AttachAccess;
  /** Персональный курсор участника (идентификатор из каталога src/cursors.ts). */
  cursorId?: unknown;
  /** Можно ли участнику Pro-курсор (по умолчанию да: тариф проверяет только облачная комната). */
  allowProCursor?: boolean;
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
  cursorId?: string;
  allowProCursor: boolean;
  /** Центр экрана участника в мировых координатах и его зум (пакет view). */
  view: ParticipantView | null;
  /** Ограничитель частоты сообщений чата. */
  chatOk: (now: number) => boolean;
}

/** Где участник смотрит: страница, центр экрана в мировых координатах, зум. */
export interface ParticipantView { pageId: string; vx: number; vy: number; vz: number }

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
  /** Персональный курсор (нет — участник со старой версией: курсор классический, бейдж цвета color). */
  cursorId?: string;
  /** Камера участника (нет поля — участник её не присылал). */
  view?: ParticipantView | null;
  /** Участник на странице, скрытой для получателя: страница, курсор, камера и выделение не передаются. */
  hiddenPage?: true;
  /** Роль и откуда доступ — только получателям-авторам (SPEC_NIGHT6 §3.2). */
  access?: { role: AccessRole | 'owner'; source: AccessSource; inviteId?: string };
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

/** Камера из пакета view / summon: id страницы, конечные координаты, зум в пределах приложения. */
export function cleanView(m: Rec): ParticipantView | null {
  if (!isId(m.pageId) || !isNum(m.vx) || !isNum(m.vy) || !isNum(m.vz)) return null;
  if (m.vz < VIEW_ZOOM_MIN || m.vz > VIEW_ZOOM_MAX) return null;
  return { pageId: m.pageId, vx: m.vx, vy: m.vy, vz: m.vz };
}

/**
 * Снимок участников так, как его видит получатель: участник на странице, скрытой для получателя, приходит
 * без страницы, курсора, камеры и выделения, с пометкой hiddenPage (SPEC_NIGHT5 §3.1). Себя получатель видит как есть.
 */
export function maskUsersFor(users: UserSnapshot[], viewerId: number, hidden: ReadonlySet<string>): UserSnapshot[] {
  if (hidden.size === 0) return users;
  return users.map(u => {
    if (u.userId === viewerId) return u;
    const onHidden = (u.pageId !== null && hidden.has(u.pageId)) || (!!u.view && hidden.has(u.view.pageId));
    return onHidden ? { ...u, pageId: null, cursor: null, view: null, selection: [], hiddenPage: true as const } : u;
  });
}

function validCursor(m: Rec): boolean {
  return isNum(m.x) && isNum(m.y) && optPageId(m.pageId);
}
const MAX_POINTER_PTS = 64;
const MAX_FLASH_IDS = 2000;
const POINTER_COLOR = /^#[0-9a-fA-F]{6}$/;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/**
 * Указка участника (лазер, исчезающий маркер, подсветка объектов) → то, что можно разослать остальным.
 * Пересобираем сообщение, а не пересылаем присланное: приходит от участника и не заслуживает доверия.
 */
export function cleanPointer(m: Rec): Rec | null {
  if (!isId(m.pageId)) return null;
  const pts = (): Rec[] | null => {
    if (!Array.isArray(m.pts) || m.pts.length === 0 || m.pts.length > MAX_POINTER_PTS) return null;
    const out: Rec[] = [];
    for (const p of m.pts) {
      if (!isObj(p) || !isNum(p.x) || !isNum(p.y)) return null;
      out.push({ x: p.x, y: p.y, p: isNum(p.p) ? clamp01(p.p) : 0.5 });
    }
    return out;
  };
  if (m.k === 'laser') {
    const list = pts();
    if (!list || typeof m.color !== 'string' || !POINTER_COLOR.test(m.color)) return null;
    return { k: 'laser', pageId: m.pageId, color: m.color, pts: list.map(p => ({ x: p.x, y: p.y })), end: m.end === true };
  }
  if (m.k === 'fade') {
    const list = pts();
    if (!list || !isId(m.sid) || typeof m.color !== 'string' || !POINTER_COLOR.test(m.color)) return null;
    if (!isNum(m.width) || m.width <= 0 || m.width > 200) return null;
    if (m.opacity !== undefined && !isNum(m.opacity)) return null;
    return {
      k: 'fade', pageId: m.pageId, sid: m.sid, color: m.color, width: m.width, pts: list, end: m.end === true,
      ...(m.opacity !== undefined && m.opacity < 1 ? { opacity: clamp01(m.opacity as number) } : {}),
    };
  }
  if (m.k === 'flash') {
    if (!Array.isArray(m.ids) || m.ids.length === 0 || m.ids.length > MAX_FLASH_IDS || !m.ids.every(isId)) return null;
    return { k: 'flash', pageId: m.pageId, ids: m.ids };
  }
  return null;
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
export function guardedElement(known: Element | undefined, incoming: Element): Element {
  if (!isTask(incoming) || !known || !isTask(known)) return incoming;
  return mergeGuestTask(known, incoming) as Element;
}

/** Страница участника поверх страницы автора с защитой заданий. */
function guardedPage(known: Page, incoming: Page): Page {
  if (!incoming.elements.some(isTask)) return incoming;
  const byId = new Map(known.elements.map(e => [e.id, e]));
  return { ...incoming, elements: incoming.elements.map(el => guardedElement(byId.get(el.id), el)) };
}

/** Элемент от автора поверх известного: ввод ученика в задании остаётся хабу. */
export function hostElement(known: Element | undefined, incoming: Element): Element {
  if (!isTask(incoming) || !known || !isTask(known)) return incoming;
  return mergeHostTask(known, incoming) as Element;
}

function hostPage(known: Page, incoming: Page): Page {
  if (!incoming.elements.some(isTask)) return incoming;
  const byId = new Map(known.elements.map(e => [e.id, e]));
  return { ...incoming, elements: incoming.elements.map(el => hostElement(byId.get(el.id), el)) };
}

/** Идентификатор автора реакции или комментария из сообщения участника: короткая строка без управляющих символов. */
export const MAX_USER_ID = 64;
export function cleanUserId(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.replace(/[\p{Cc}\u2028\u2029]/gu, '').trim();
  return s && s.length <= MAX_USER_ID ? s : null;
}

/** Страница проекта поверх страницы участника, но с комментариями хаба: их ведёт хаб, а не присланный проект. */
function keepHubComments(known: Page, incoming: Page): Page {
  if (known.comments === incoming.comments) return incoming;
  const { comments: _c, ...rest } = incoming;
  return known.comments ? { ...rest, comments: known.comments } : rest;
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
  setRights(uid: number, patch: RightsPatch): { ok: boolean; error?: string };
  /**
   * Заменить доступ гостя целиком (облако: приглашение изменилось) и сразу разослать ему права.
   * false — такого гостя нет.
   */
  setAccess(uid: number, access: AttachAccess): boolean;
  /** Заменить проект и разослать его всем. */
  pushProject(project: Project): void;
  /** Применить патч от имени автора и разослать всем. false — патч не принят. */
  pushPatch(patch: BoardPatch): boolean;
  users(): UserSnapshot[];
  closeAll(): void;
}

/** Доступ гостя по умолчанию (P2P без приглашения): старая роль — как раньше. */
export function defaultAccess(openEdit = false): ParticipantAccess {
  return { role: openEdit ? 'editor' : 'commenter', legacy: true, personal: {}, source: 'p2p' };
}

/** Право по умолчанию в старом виде (поле rights.default): личное «на всё» или по роли. */
function defaultRightOf(a: ParticipantAccess): PageRight {
  return a.personalAll ?? (a.role === 'editor' ? 'edit' : 'view');
}

/** Состояние комнаты: проект, участники и их доступ. */
export class Room {
  project: Project | null = null;
  clients = new Map<RoomSocket, Client>();
  /** Доступ гостей по слоям (у автора записи нет — он всегда редактор). */
  access = new Map<number, ParticipantAccess>();
  nextUid = 1;
  /** Ревизии страниц: растут с каждым принятым патчем. */
  revs = new Map<string, number>();
  /** Последние сообщения чата (кольцевой буфер CHAT_HISTORY): только в памяти, в проект не пишутся. */
  chat: ChatMessage[] = [];
  /** «Автопереход участников за мной» включён автором. */
  followHost = false;
  /** Слепок permissions проекта, известный хабу: его смену хаб доносит до гостей (SPEC_NIGHT5 §3.2, SPEC_NIGHT6 §3.3). */
  permsKey = '{}';

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

  /** Право страницы из permissions проекта. */
  pageSetting(pageId: string): PageRight | undefined {
    const r = this.project?.permissions?.pageRights?.[pageId];
    return isPageRight(r) ? r : undefined;
  }
  /** Право участника с таким доступом на страницу (без учёта автора). */
  rightWith(a: ParticipantAccess, pageId: string): PageRight {
    return effectivePageAccess({
      owner: false, role: a.role, legacy: a.legacy, pageSetting: this.pageSetting(pageId), personal: a.personal[pageId] ?? a.personalAll,
    });
  }
  /** Может ли участник с таким доступом что-то редактировать. */
  canEditWith(a: ParticipantAccess | undefined): boolean {
    if (!a) return false;
    if (this.project && this.project.pages.length > 0) return this.project.pages.some(pg => this.rightWith(a, pg.id) === 'edit');
    return (a.role === 'editor' && !a.personalAll) || a.personalAll === 'edit' || Object.values(a.personal).some(m => m === 'edit');
  }
  userCanEditAnything(uid: number): boolean {
    if (this.clientOf(uid)?.host) return true;
    return this.canEditWith(this.access.get(uid));
  }
  /** Сколько открытых участников редактируют; автор считается всегда, probe — доступ «что если». */
  editorsCount(probe: Map<number, ParticipantAccess> = this.access): number {
    let n = 0;
    for (const c of this.open()) {
      if (c.host || this.canEditWith(probe.get(c.uid))) n++;
    }
    return n;
  }
  userPageRight(uid: number, pageId: string): PageRight {
    if (this.clientOf(uid)?.host) return 'edit';
    const a = this.access.get(uid);
    return a ? this.rightWith(a, pageId) : 'view';
  }
  /** Страницы, скрытые от участника (у автора — ни одной). */
  hiddenPagesFor(uid: number): Set<string> {
    const out = new Set<string>();
    if (!this.project || this.clientOf(uid)?.host) return out;
    for (const pg of this.project.pages) if (this.userPageRight(uid, pg.id) === 'hidden') out.add(pg.id);
    return out;
  }
  visiblePages(uid: number): Page[] {
    if (!this.project) return [];
    if (this.clientOf(uid)?.host) return this.project.pages;
    return this.project.pages.filter(pg => this.userPageRight(uid, pg.id) !== 'hidden');
  }
  setRights(uid: number, patch: RightsPatch): { ok: boolean; error?: string } {
    if (this.clientOf(uid)?.host) return { ok: false, error: 'Автор всегда редактор' };
    const cur = this.access.get(uid) ?? defaultAccess();
    const next: ParticipantAccess = { ...cur, personal: { ...cur.personal } };
    const applyDefault = (d: PageRight) => {
      // старое «право по умолчанию»: edit/view — роль-синоним (как в Ночах №3–5), hidden — скрыть всё
      if (d === 'hidden') { next.personalAll = 'hidden'; return; }
      delete next.personalAll;
      next.role = d === 'edit' ? 'editor' : 'commenter';
      next.legacy = true;
    };
    const nr = normalizeRole(patch.role);
    if (nr) { next.role = nr.role; next.legacy = nr.legacy; delete next.personalAll; }
    if (isPageRight(patch.default)) applyDefault(patch.default);
    if (isPageRight(patch.all)) { next.personal = {}; applyDefault(patch.all); }
    for (const [pid, mode] of Object.entries(patch.pages || {})) {
      if (mode === null) delete next.personal[pid];
      else if (isPageRight(mode)) next.personal[pid] = mode;
    }
    // лимит редакторов: применяем патч и проверяем, не превысил ли участник порог
    const wasEditor = this.userCanEditAnything(uid);
    const probe = new Map(this.access);
    probe.set(uid, next);
    const max = this.opts.maxEditors();
    if (!wasEditor && this.editorsCount(probe) > max) {
      return { ok: false, error: `Максимум ${max} одновременных редакторов` };
    }
    this.access.set(uid, next);
    return { ok: true };
  }
  /** Права участника в старом виде для снимка: по умолчанию и страницы, где итог отличается от него. */
  snapshotRights(c: Client): { default: string; pages: Record<string, string> } {
    if (c.host) return { default: 'edit', pages: {} };
    const a = this.access.get(c.uid);
    if (!a) return { default: 'view', pages: {} };
    const def = defaultRightOf(a);
    const pages: Record<string, string> = {};
    for (const pg of this.project?.pages ?? []) {
      const r = this.rightWith(a, pg.id);
      if (r !== def) pages[pg.id] = r;
    }
    return { default: def, pages };
  }
  usersSnapshot(): UserSnapshot[] {
    const now = this.opts.now();
    return [...this.clients.values()].map(c => {
      const a = this.access.get(c.uid);
      return {
        userId: c.uid, name: c.name, color: c.color, host: c.host,
        away: now - c.last > this.opts.awayMs,
        cursor: c.cursor, pageId: c.pageId, selection: c.selection,
        rights: this.snapshotRights(c),
        ...(c.cursorId ? { cursorId: c.cursorId } : {}),
        ...(c.view ? { view: c.view } : {}),
        access: c.host ? { role: 'owner' as const, source: 'owner' as const }
          : { role: a?.role ?? 'commenter', source: a?.source ?? 'p2p', ...(a?.inviteId ? { inviteId: a.inviteId } : {}) },
      };
    });
  }
}

/** Снимок для гостя: без сведений о доступе остальных (их видит только автор). */
export function stripAccess(users: UserSnapshot[]): UserSnapshot[] {
  return users.map(u => {
    if (!u.access) return u;
    const { access: _a, ...rest } = u;
    return rest;
  });
}

/** Хаб комнаты: принимает участников от любого транспорта и рассылает им сообщения. */
export function createRoomHub(options: RoomHubOptions): RoomHub {
  const now = options.now ?? (() => Date.now());
  const planNow = (): PlanTier => options.plan ?? planOf(room.project);
  const maxEditors = () => options.maxEditors ?? PLAN_LIMITS[planNow()].maxEditors;
  /** Права проекта с поправкой на тариф комнаты. */
  const perms = () => sanitizePermissionsForPlan(planNow(), room.project?.permissions ?? {});
  /** Запрет копирования, заданный владельцем хаба (опция); нет опции — не запрещено. */
  const hubAllowsCopy = () => (options.allowCopy === undefined ? true : typeof options.allowCopy === 'function' ? options.allowCopy() : options.allowCopy);
  const room: Room = new Room(options.code, { now, awayMs: options.awayMs ?? DEFAULT_AWAY_MS, maxEditors });
  /** Лимит гостей и чей он: тарифа (planLimited — код 4402) или автора / владельца хаба (код 4430). */
  const guestLimit = (): { max: number; planLimited: boolean } => {
    const plan = planNow();
    const max = options.maxGuests ?? effectiveMaxGuests(plan, room.project?.permissions);
    // лимит не строже тарифного — это лимит тарифа (Free); строже — ограничение автора
    return { max, planLimited: max >= PLAN_LIMITS[plan].maxP2PGuests };
  };
  const canFollowHost = () => options.canFollowHost ?? PLAN_LIMITS[planNow()].canFollowHost;
  let chatSeq = 0;

  const sendTo = (sock: RoomSocket, obj: unknown): void => {
    if (sock.readyState === 1) try { sock.send(JSON.stringify(obj)); } catch { /* канал закрывается */ }
  };

  /** Снимок участников для получателя (§3.1): сведения о доступе — только автору (SPEC_NIGHT6 §3.2). */
  const usersFor = (info: Client, base: UserSnapshot[] = room.usersSnapshot()): UserSnapshot[] =>
    maskUsersFor(info.host ? base : stripAccess(base), info.uid, room.hiddenPagesFor(info.uid));

  function broadcastUsers(): void {
    const base = room.usersSnapshot();
    let guestBase: UserSnapshot[] | null = null;
    let sharedHost: string | null = null;
    let sharedGuest: string | null = null;
    for (const c of room.clients.values()) {
      if (c.sock.readyState !== 1) continue;
      const hidden = room.hiddenPagesFor(c.uid);
      if (c.host) {
        sharedHost ??= JSON.stringify({ t: 'users', users: base });
        try { c.sock.send(sharedHost); } catch { /* канал закрывается */ }
        continue;
      }
      guestBase ??= stripAccess(base);
      if (hidden.size === 0) {
        sharedGuest ??= JSON.stringify({ t: 'users', users: guestBase });
        try { c.sock.send(sharedGuest); } catch { /* канал закрывается */ }
      } else {
        sendTo(c.sock, { t: 'users', users: maskUsersFor(guestBase, c.uid, hidden) });
      }
    }
  }

  const projectFor = (info: Client): Project | null =>
    info.host ? room.project : (room.project ? { ...room.project, pages: projectPagesForGuest(room.visiblePages(info.uid)) } : null);

  function rightsOf(uid: number): UserRights {
    const a = room.access.get(uid);
    const pages: Record<string, PageRight> = {};
    if (room.project) for (const pg of room.project.pages) pages[pg.id] = room.userPageRight(uid, pg.id);
    const host = room.clientOf(uid)?.host === true;
    return { default: host ? 'edit' : a ? defaultRightOf(a) : 'view', pages };
  }

  /** Возможности участника (SPEC_NIGHT6 §2.3): решает хаб, клиент лишь не показывает лишнего. */
  function capsOf(info: Client): ParticipantCaps {
    if (info.host) return { ...OWNER_CAPS };
    const a = room.access.get(info.uid) ?? defaultAccess(options.openEdit);
    const caps = participantCaps({ owner: false, role: a.role, legacy: a.legacy, inviteAllowCopy: a.inviteAllowCopy }, perms());
    if (!hubAllowsCopy()) caps.copy = false;
    return caps;
  }
  /** Роль участника для клиента; автор — owner. */
  const roleOf = (info: Client): AccessRole | 'owner' => (info.host ? 'owner' : (room.access.get(info.uid) ?? defaultAccess(options.openEdit)).role);

  /** Права, роль и возможности участника — то, что уходит ему в init и { t: 'rights' }. */
  const accessFor = (info: Client) => {
    const caps = capsOf(info);
    return { rights: rightsOf(info.uid), allowCopy: caps.copy, role: roleOf(info), caps };
  };

  const initFor = (info: Client) => ({
    t: 'init', proto: PROTO, userId: info.uid, color: info.color, name: info.name,
    project: projectFor(info), ...accessFor(info), users: usersFor(info),
    patches: true, chat: room.chat, followHost: room.followHost,
  });

  /** Доступ нового гостя: из параметров подключения (облако), старых прав (rights) или по умолчанию (P2P). */
  function initialAccess(rights: UserRights | undefined, access: AttachAccess | undefined): ParticipantAccess {
    const cleanPages = (raw: Record<string, unknown> | undefined): Record<string, PageRight> => {
      const out: Record<string, PageRight> = {};
      for (const [id, v] of Object.entries(raw ?? {})) if (isPageRight(v)) out[id] = v;
      return out;
    };
    const fromAccess = access ? normalizeRole(access.role) : null;
    if (access && fromAccess) {
      return {
        role: fromAccess.role, legacy: fromAccess.legacy, personal: cleanPages(access.personal),
        ...(access.inviteAllowCopy === false ? { inviteAllowCopy: false } : {}),
        source: access.source ?? 'link', ...(access.inviteId ? { inviteId: access.inviteId } : {}),
        principal: access.principal ?? null,
      };
    }
    if (rights && isPageRight(rights.default)) {
      const a: ParticipantAccess = { ...defaultAccess(), personal: cleanPages(rights.pages) };
      if (rights.default === 'hidden') a.personalAll = 'hidden';
      else a.role = rights.default === 'edit' ? 'editor' : 'commenter';
      return a;
    }
    return defaultAccess(options.openEdit);
  }

  function attach(sock: RoomSocket, { isHost = false, name = '', patches = false, rights, access, cursorId, allowProCursor = true }: AttachOptions = {}): number | null {
    const hostOnline = [...room.clients.values()].some(c => c.host && c.sock.readyState === 1);
    if (isHost && hostOnline && !options.multiHost) {
      sock.close(4409, 'host already connected');
      return null;
    }
    if (!isHost) {
      const { max, planLimited } = guestLimit();
      if (room.guestCount() >= max) {
        // причина лимита тарифа — прежняя (free-limit-reached), лимита автора — room-full; клиент смотрит на planLimited и код
        sendTo(sock, { t: 'denied', reason: planLimited ? FREE_LIMIT_REASON : ROOM_FULL_REASON, maxGuests: max, planLimited });
        if (planLimited) sock.close(CLOSE_FREE_LIMIT, FREE_LIMIT_REASON);
        else sock.close(CLOSE_ROOM_FULL, ROOM_FULL_REASON);
        return null;
      }
    }
    // первое устройство автора — uid 0, следующие (multiHost) — свои номера
    const uid = isHost && !room.clientOf(0) ? 0 : room.nextUid++;
    const info: Client = {
      sock, uid, host: isHost,
      name: normalizeName(name) || (isHost ? 'Автор' : `Гость ${uid}`),
      color: isHost ? '#e03131' : COLORS[uid % COLORS.length],
      last: now(), cursor: null, pageId: null, selection: [], patches,
      cursorId: cleanCursorId(cursorId, allowProCursor), allowProCursor,
      view: null, chatOk: createRateLimiter(),
    };
    room.clients.set(sock, info);
    if (isHost) room.access.delete(uid);
    else room.access.set(uid, initialAccess(rights, access));

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
      if (m.t === 'profile') {
        // смена имени и курсора на лету: имя — как при входе, курсор — по белому списку (и тарифу)
        const nextName = m.name === undefined ? info.name : normalizeName(m.name);
        const nextCursor = m.cursorId === undefined ? info.cursorId : cleanCursorId(m.cursorId, info.allowProCursor) ?? info.cursorId;
        if (!nextName || (nextName === info.name && nextCursor === info.cursorId)) return;
        info.name = nextName;
        info.cursorId = nextCursor;
        broadcastUsers();
        return;
      }
      if (m.t === 'project') {
        if (validProject(m.project)) acceptProject(info, m.project);
        return;
      }
      if (m.t === 'chat') { acceptChat(info, m); return; }
      if (m.t === 'view') { acceptView(info, m); return; }
      if (m.t === 'summon') { acceptSummon(info, m); return; }
      if (m.t === 'follow-host') { acceptFollowHost(info, m); return; }
      if (m.t === 'patch') {
        if (isBoardPatch(m)) acceptPatch(info, m);
        return;
      }
      // ученик печатает и отправляет ответ даже на странице с правом view (не читатель); проверяет хаб по настоящему ответу
      if (m.t === 'task-draft') acceptTaskInput(info, m, 'draft');
      else if (m.t === 'task-submit') acceptTaskInput(info, m, 'submit');
      // реакции, комментарии и ввод в задание — кто видит страницу и может комментировать (не читатель)
      else if (m.t === 'pointer') relayPointer(info, m);
      else if (m.t === 'react') acceptReaction(info, m);
      else if (m.t === 'comment') acceptComment(info, m);
    });
    sock.on('close', () => { room.clients.delete(sock); broadcastUsers(); });
    return uid;
  }

  /** Страницы присланного проекта поверх известных — только те, где у отправителя есть edit. */
  function mergePages(uid: number, isHost: boolean, project: Project): Project {
    const merged: Project = { ...project, pages: room.project!.pages.map(oldPg => {
      const newPg = project.pages.find(p => p.id === oldPg.id);
      if (!newPg || room.userPageRight(uid, oldPg.id) !== 'edit') return oldPg;
      return keepHubComments(oldPg, isHost ? hostPage(oldPg, newPg) : guardedPage(oldPg, newPg));
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
    // права проекта меняет только автор; их смену хаб доносит до гостей (SPEC_NIGHT6 §3.3)
    const before = info.host ? accessBefore(project) : null;
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
    afterAccessChange(before);
    if (room.project) options.onChange?.(room.project, 'project');
  }

  const permsKeyOf = (p: Project | null): string => JSON.stringify(p?.permissions ?? {});

  /**
   * Перед заменой проекта: если права проекта меняются, запоминаем права и возможности каждого гостя
   * (живые права страниц SPEC_NIGHT5 §3.2 и прочие права SPEC_NIGHT6 §3.3); null — права не меняются.
   */
  function accessBefore(next: Project): Map<number, string> | null {
    if (permsKeyOf(next) === room.permsKey) return null;
    const out = new Map<number, string>();
    for (const c of room.clients.values()) if (!c.host) out.set(c.uid, JSON.stringify(accessFor(c)));
    return out;
  }

  /**
   * После замены проекта: гостям, у которых изменились права или возможности, — { t: 'rights' }, затем всем —
   * { t: 'users' }. Личные права участника живая смена права страницы не затирает (SPEC_NIGHT6 Решение 4).
   */
  function afterAccessChange(before: Map<number, string> | null): void {
    room.permsKey = permsKeyOf(room.project);
    if (!before) return;
    let any = false;
    for (const c of room.clients.values()) {
      if (c.host) continue;
      const cur = accessFor(c);
      if (before.get(c.uid) === JSON.stringify(cur)) continue;
      any = true;
      sendTo(c.sock, { t: 'rights', ...cur });
    }
    if (any) broadcastUsers();
  }

  /** Сообщение чата: проверка текста и частоты, буфер последних CHAT_HISTORY, рассылка всем (и отправителю). */
  function acceptChat(info: Client, m: Rec): void {
    if (!capsOf(info).chat) return; // читатель чат читает, но не пишет
    const text = normalizeChatText(m.text);
    if (text === null) return;
    const ts = now();
    if (!info.chatOk(ts)) return; // флуд — молча
    const msg: ChatMessage = {
      id: `${ts.toString(36)}-${(++chatSeq).toString(36)}`, by: info.uid, name: info.name,
      ...(info.cursorId ? { cursorId: info.cursorId } : {}), text, ts,
    };
    room.chat = [...room.chat, msg].slice(-CHAT_HISTORY);
    for (const c of room.clients.values()) sendTo(c.sock, { t: 'chat', ...msg });
  }

  /** Камера участника: страница должна существовать и не быть для него скрытой. */
  function acceptView(info: Client, m: Rec): void {
    const view = cleanView(m);
    if (!view || !room.project?.pages.some(p => p.id === view.pageId)) return;
    if (room.userPageRight(info.uid, view.pageId) === 'hidden') return;
    info.view = view;
    info.pageId = view.pageId;
    broadcastUsers();
  }

  /** «Позвать всех сюда»: от автора или (по настройке доски) редактора, гостям, которым страница видна. */
  function acceptSummon(info: Client, m: Rec): void {
    if (!info.host && !capsOf(info).summon) return;
    const view = cleanView(m);
    if (!view || !room.project?.pages.some(p => p.id === view.pageId)) return;
    for (const c of room.clients.values()) {
      if (c.host || room.userPageRight(c.uid, view.pageId) === 'hidden') continue;
      sendTo(c.sock, { t: 'summon', ...view, by: info.uid });
    }
  }

  /** «Автопереход участников за мной»: только автор и только на тарифе, где это есть. */
  function acceptFollowHost(info: Client, m: Rec): void {
    if (!info.host || typeof m.enabled !== 'boolean' || !canFollowHost()) return;
    if (room.followHost === m.enabled) return;
    room.followHost = m.enabled;
    for (const c of room.clients.values()) sendTo(c.sock, { t: 'follow-host', enabled: room.followHost, by: info.uid });
  }

  /** Указка не хранится: чистое сообщение уходит всем остальным, кто видит страницу. */
  function relayPointer(info: Client, m: Rec): void {
    const clean = cleanPointer(m);
    if (!clean || !room.project?.pages.some(p => p.id === clean.pageId)) return;
    if (!capsOf(info).pointer || room.userPageRight(info.uid, clean.pageId as string) === 'hidden') return;
    for (const c of room.clients.values()) {
      if (c === info || room.userPageRight(c.uid, clean.pageId as string) === 'hidden') continue;
      sendTo(c.sock, { t: 'pointer', ...clean, by: info.uid });
    }
  }

  /** Операции так, как их видит ученик: у заданий в put нет ответа. */
  const opsForGuest = (ops: ElementOp[]): ElementOp[] =>
    ops.map(op => (op.op === 'put' && isTask(op.el) ? { op: 'put', el: projectTaskForRole(op.el, 'guest') as Element } : op));

  /** Применить очищенный патч к странице хаба и разослать; skip — отправитель, которому его же правку возвращать не нужно. */
  function commitPatch(patch: BoardPatch, by: number, skip: RoomSocket | null, kind: ChangeKind = 'patch'): void {
    const project = room.project!;
    const rev = (room.revs.get(patch.pageId) ?? 0) + 1;
    room.revs.set(patch.pageId, rev);
    const clean: BoardPatch = { ...patch, rev };
    room.project = {
      ...project,
      updatedAt: now(),
      pages: project.pages.map(pg => (pg.id === patch.pageId ? applyBoardPatch(pg, clean) : pg)),
    };
    for (const c of room.clients.values()) {
      if (skip && c.sock === skip) continue;
      if (room.userPageRight(c.uid, patch.pageId) === 'hidden') continue; // скрытая страница до участника не доходит
      if (c.patches) sendTo(c.sock, { ...clean, ops: c.host ? clean.ops : opsForGuest(clean.ops), by });
      else sendTo(c.sock, { t: 'project', project: projectFor(c), by });
    }
    options.onChange?.(room.project, kind);
  }

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
      if (el) ops.push({ op: 'put', el: fromGuest ? guardedElement(known.get(el.id), el) : hostElement(known.get(el.id), el) });
    }
    commitPatch({ ...patch, ops }, info ? info.uid : -1, info ? info.sock : null);
    return true;
  }

  /**
   * Ввод ученика в задание: черновик (task-draft) или ответ на проверку (task-submit). Нужен лишь доступ
   * к странице. Результат — правка задания от хаба (by = -1): её получают все, и сам отправитель тоже.
   */
  function acceptTaskInput(info: Client, m: Rec, kind: 'draft' | 'submit'): void {
    if (!isId(m.pageId) || !isId(m.elId)) return;
    if (typeof (kind === 'draft' ? m.draft : m.value) !== 'string') return;
    const page = room.project?.pages.find(p => p.id === m.pageId);
    if (!page || !capsOf(info).comment || room.userPageRight(info.uid, page.id) === 'hidden') return;
    const el = page.elements.find(e => e.id === m.elId);
    if (!el || !isTask(el)) return;
    let next: TaskEl;
    if (kind === 'draft') {
      next = updateStudentDraft(el, m.draft as string);
    } else {
      const res = submitTaskAttempt(el, m.value as string, now());
      // отправленное в черновике уже не нужно
      next = res.updated === el ? el : updateStudentDraft(res.updated, '');
    }
    if (next === el) return;
    commitPatch({ t: 'patch', pageId: page.id, rev: 0, ops: [{ op: 'put', el: next as Element }] }, -1, null, kind === 'draft' ? 'task-draft' : 'task-submit');
  }

  /** Реакция участника на элемент: ставится или снимается; результат — правка элемента от хаба (её получают все). */
  function acceptReaction(info: Client, m: Rec): void {
    if (!isId(m.pageId) || !isId(m.elId) || typeof m.emoji !== 'string') return;
    const page = room.project?.pages.find(p => p.id === m.pageId);
    if (!page || !capsOf(info).comment || room.userPageRight(info.uid, page.id) === 'hidden') return;
    const el = page.elements.find(e => e.id === m.elId);
    if (!el) return;
    const next = toggleElementReaction(el, m.emoji, cleanUserId(m.userId) ?? `u${info.uid}`);
    if (next === el) return;
    commitPatch({ t: 'patch', pageId: page.id, rev: 0, ops: [{ op: 'put', el: next }] }, -1, null, 'react');
  }

  /** Комментарии: создать ветку, ответить, закрыть. Имя автора — имя участника в комнате, а не присланное. */
  function acceptComment(info: Client, m: Rec): void {
    const project = room.project;
    if (!project || !isId(m.pageId)) return;
    const page = project.pages.find(p => p.id === m.pageId);
    if (!page || !capsOf(info).comment || room.userPageRight(info.uid, page.id) === 'hidden') return;
    const authorId = cleanUserId(m.userId) ?? `u${info.uid}`;
    const author = { authorId, authorName: info.name };
    let next = page;
    if (m.op === 'create') {
      if (!isNum(m.x) || !isNum(m.y) || typeof m.text !== 'string') return;
      next = createCommentThread(page, { x: m.x, y: m.y, ...(isId(m.targetElementId) ? { targetElementId: m.targetElementId } : {}), ...author, text: m.text });
    } else if (m.op === 'reply') {
      if (!isId(m.threadId) || typeof m.text !== 'string') return;
      next = addCommentReply(page, m.threadId, { ...author, text: m.text });
    } else if (m.op === 'resolve') {
      if (!isId(m.threadId)) return;
      next = resolveCommentThread(page, m.threadId, m.resolved !== false);
    }
    if (next === page) return;
    room.project = { ...project, updatedAt: now(), pages: project.pages.map(pg => (pg === page ? next : pg)) };
    const msg = { t: 'comments', pageId: page.id, comments: next.comments ?? [], by: -1 };
    for (const c of room.clients.values()) {
      if (room.userPageRight(c.uid, page.id) !== 'hidden') sendTo(c.sock, msg);
    }
    options.onChange?.(room.project, 'comment');
  }

  function pushRights(uid: number): void {
    const c = room.clientOf(uid);
    if (!c) return;
    sendTo(c.sock, { t: 'rights', ...accessFor(c) });
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
      const before = accessBefore(project);
      room.project = project;
      for (const c of room.clients.values()) sendTo(c.sock, { t: 'project', project: projectFor(c), by: -1 });
      afterAccessChange(before);
    },
    setAccess(uid, access) {
      const c = room.clientOf(uid);
      if (!c || c.host) return false;
      const prev = room.access.get(uid);
      room.access.set(uid, { ...initialAccess(undefined, access), ...(prev?.principal ? { principal: prev.principal } : {}) });
      broadcastUsers();
      pushRights(uid);
      return true;
    },
    pushPatch: patch => acceptPatch(null, patch),
    users: () => room.usersSnapshot(),
    closeAll() {
      for (const sock of [...room.clients.keys()]) try { sock.close(); } catch { /* уже закрыт */ }
    },
  };
}
