import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';
import { parseProject } from '../src/file';
import { CLOSE_BAD_CODE, CLOSE_BAD_REQUEST, CLOSE_HOST_OFFLINE, CLOSE_PROTOCOL_MISMATCH, CLOSE_RATE_LIMITED, CLOSE_ROOM_CLOSED, CLOSE_ROOM_NOT_FOUND, PROTO } from '../src/collab-transport';
import { effectivePermissions, sanitizePermissionsForPlan } from '../src/limits';
import { invitePageRight } from '../src/project-access';
import { createRoomHub, normalizeName, type ChangeKind, type RoomHub, type RoomSocket, type UserRights } from '../src/room-host';
import type { PageRight, PlanTier, Project } from '../src/types';
import { ingestElement, ingestProjectImages } from './assets';
import { verifySession } from './auth';
import type { AppContext } from './context';
import { findActiveInvite, type InviteRights } from './invites';
import { getActiveProject, getProjectRow, mergeStale, ownerPlanOf, projectOf, writeProject } from './projects';
import { effectivePlan, getUser, isAnonymousUser } from './users';

// Облачные комнаты (Cloud Rooms): серверный хаб из src/room-host.ts. Проект и настоящие ответы заданий живут в памяти
// сервера, участникам-гостям уходят только замаскированные задания. На pro и tutor комната живёт без автора.
// На free (при включённых лимитах) — пока автор подключён, с одним гостем. Всё, что происходит в комнате, пишется в базу.

const MAX_MESSAGE = 16 * 1024 * 1024;
const HELLO_TIMEOUT_MS = 10_000;
const ROOM_PATH = /^\/ws\/room\/([^/]+)$/;

type Rec = Record<string, unknown>;

/** События, которые попадают в журнал ревизий (черновики и реакции — нет). */
const JOURNAL_KINDS: ReadonlySet<ChangeKind> = new Set(['patch', 'project', 'task-submit', 'comment']);

/** Сокет участника для хаба поверх ws: сообщения приходят уже обработанными (картинки вынесены в хранилище). */
class WsRoomSocket implements RoomSocket {
  private readonly onMessage: ((raw: string) => void)[] = [];
  private readonly onClose: (() => void)[] = [];
  /** Сообщения обрабатываются строго по порядку, даже когда часть из них ждёт сохранения картинки. */
  private chain: Promise<void> = Promise.resolve();
  closed = false;

  constructor(readonly ws: WebSocket, preprocess: (text: string) => Promise<string | null>) {
    ws.on('message', (data: Buffer | ArrayBuffer | Buffer[], isBinary: boolean) => {
      if (isBinary) return;
      const text = Buffer.isBuffer(data) ? data.toString('utf8') : Array.isArray(data) ? Buffer.concat(data).toString('utf8') : Buffer.from(data).toString('utf8');
      this.chain = this.chain.then(async () => {
        const out = await preprocess(text).catch(() => null);
        if (out !== null) for (const fn of this.onMessage) fn(out);
      });
    });
    ws.on('close', () => { this.closed = true; for (const fn of this.onClose) fn(); });
    ws.on('error', () => { /* за ошибкой придёт close */ });
  }

  get readyState(): number { return this.ws.readyState; }
  send(text: string): void { try { this.ws.send(text); } catch { /* канал закрывается */ } }
  close(code?: number, reason?: string): void {
    try { this.ws.close(code ?? 1000, reason ? reason.slice(0, 100) : undefined); } catch { /* уже закрыт */ }
  }
  on(ev: 'message', fn: (raw: string | Uint8Array | ArrayBuffer) => void): void;
  on(ev: 'close', fn: () => void): void;
  on(ev: 'message' | 'close', fn: ((raw: string) => void) | (() => void)): void {
    if (ev === 'message') this.onMessage.push(fn as (raw: string) => void);
    else this.onClose.push(fn as () => void);
  }
}

interface Conn { sock: WsRoomSocket; isHost: boolean; inviteToken: string | null }

interface CloudRoom {
  id: string;
  hub: RoomHub;
  conns: Set<Conn>;
  plan: PlanTier;
  inviteAllowCopy: boolean;
  /** Что случилось с момента последней записи в базу. */
  kinds: Map<ChangeKind | 'rest', number>;
  saveTimer: NodeJS.Timeout | null;
  unloadTimer: NodeJS.Timeout | null;
}

export interface CloudRooms {
  /** Сколько комнат сейчас в памяти. */
  count(): number;
  /** Проект в памяти комнаты (с настоящими ответами) — для проверок; null — комнаты нет. */
  projectOf(id: string): Project | null;
  /** Участники комнаты. */
  connections(id: string): number;
  /** Немедленно записать состояние комнаты в базу. */
  flush(id: string): void;
  close(): void;
}

/** Тариф, по которому живёт комната: пока лимиты на сервере выключены, free ведёт себя как pro (ничего не ограничено). */
function roomPlan(app: AppContext, ownerId: string): PlanTier {
  const plan = ownerPlanOf(app, ownerId);
  return !app.opts.enforceLimits && plan === 'free' ? 'pro' : plan;
}

/** Картинки data:image/… из сообщений участников уходят в хранилище, в комнате остаются ссылки asset://. */
function makePreprocess(app: AppContext, userId: string | null): (text: string) => Promise<string | null> {
  return async text => {
    if (!text.includes('data:image/')) return text;
    let m: Rec;
    try { m = JSON.parse(text) as Rec; } catch { return text; }
    if (m === null || typeof m !== 'object') return text;
    if (m.t === 'patch' && Array.isArray(m.ops)) {
      for (const op of m.ops as Rec[]) if (op && op.op === 'put' && op.el && typeof op.el === 'object') op.el = await ingestElement(app, op.el as never, userId);
      return JSON.stringify(m);
    }
    if (m.t === 'project' && m.project && typeof m.project === 'object' && Array.isArray((m.project as Rec).pages)) {
      m.project = await ingestProjectImages(app, m.project as never, userId);
      return JSON.stringify(m);
    }
    return text;
  };
}

export function createCloudRooms(app: AppContext, attach: { onUpgrade(fn: (req: IncomingMessage, socket: Duplex, head: Buffer) => boolean): void; onClose(fn: () => void): void }): CloudRooms {
  const rooms = new Map<string, CloudRoom>();
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE });

  // ----- Запись в базу -----

  function persist(room: CloudRoom): void {
    if (room.saveTimer) { clearTimeout(room.saveTimer); room.saveTimer = null; }
    if (room.kinds.size === 0) return;
    const kinds = room.kinds;
    room.kinds = new Map();
    const row = getProjectRow(app, room.id);
    const live = room.hub.room.project;
    if (!row || row.is_deleted !== 0 || !live) return;
    // граница доверия: всё, что пишется в базу, проходит проверку формы
    const parsed = parseProject(JSON.parse(JSON.stringify(live)));
    if (!parsed || parsed.id !== row.id) { app.log(`Комната ${room.id}: состояние не прошло проверку, не сохранено`); return; }
    const plan = ownerPlanOf(app, row.owner_id);
    const project: Project = { ...parsed, ownerPlan: plan, permissions: sanitizePermissionsForPlan(plan, parsed.permissions ?? {}) };
    const worth = [...kinds.keys()].some(k => k === 'rest' || JOURNAL_KINDS.has(k as ChangeKind));
    writeProject(app, {
      existing: row, ownerId: row.owner_id, project, authorId: null,
      revision: worth ? { kind: 'room', events: Object.fromEntries(kinds) } : null,
    });
  }

  function onChange(room: CloudRoom, kind: ChangeKind | 'rest'): void {
    room.kinds.set(kind, (room.kinds.get(kind) ?? 0) + 1);
    if (kind === 'task-submit') { persist(room); return; } // ответ ученика — сразу
    if (!room.saveTimer) {
      room.saveTimer = setTimeout(() => { room.saveTimer = null; persist(room); }, app.opts.roomSaveMs);
      room.saveTimer.unref();
    }
  }

  // ----- Жизнь комнаты -----

  function unload(room: CloudRoom, code = CLOSE_ROOM_CLOSED, reason = 'room closed'): void {
    if (room.saveTimer) clearTimeout(room.saveTimer);
    if (room.unloadTimer) clearTimeout(room.unloadTimer);
    for (const c of [...room.conns]) c.sock.close(code, reason);
    rooms.delete(room.id);
  }

  function open(id: string): CloudRoom | null {
    const existing = rooms.get(id);
    if (existing) {
      if (existing.unloadTimer) { clearTimeout(existing.unloadTimer); existing.unloadTimer = null; }
      return existing;
    }
    const row = getActiveProject(app, id);
    if (!row) return null;
    const plan = roomPlan(app, row.owner_id);
    const room: CloudRoom = { id, conns: new Set(), plan, inviteAllowCopy: true, kinds: new Map(), saveTimer: null, unloadTimer: null, hub: null as never };
    room.hub = createRoomHub({
      code: `cloud:${id}`, plan,
      allowCopy: () => {
        const perms = effectivePermissions(room.hub.room.project);
        return perms.allowCopy !== false && perms.forbidClone !== true && room.inviteAllowCopy;
      },
      onChange: (_p, kind) => onChange(room, kind),
    });
    room.hub.pushProject(projectOf(row));
    rooms.set(id, room);
    return room;
  }

  function leave(room: CloudRoom, conn: Conn): void {
    room.conns.delete(conn);
    // бесплатная комната живёт, пока подключён автор
    if (conn.isHost && room.plan === 'free') for (const c of [...room.conns]) c.sock.close(CLOSE_HOST_OFFLINE, 'host left');
    if (room.conns.size === 0) {
      persist(room);
      room.unloadTimer = setTimeout(() => { if (room.conns.size === 0) unload(room); }, app.opts.roomIdleMs);
      room.unloadTimer.unref();
    }
  }

  // ----- Подключение -----

  /** Права гостя по приглашению: на каждую страницу — своё, остальное — роль по умолчанию. */
  function guestRights(project: Project, invite: InviteRights): UserRights {
    const pages: Record<string, PageRight> = {};
    for (const pg of project.pages) pages[pg.id] = invitePageRight(project, invite, pg.id);
    return { default: invite.defaultRole, pages };
  }

  function join(ws: WebSocket, projectId: string, hello: Rec, ip: string): void {
    const sendClose = (code: number, reason: string, denied?: string) => {
      if (denied && ws.readyState === 1) ws.send(JSON.stringify({ t: 'denied', reason: denied }));
      try { ws.close(code, reason); } catch { /* уже закрыт */ }
    };
    if (hello.t !== 'hello') { sendClose(CLOSE_BAD_REQUEST, 'hello expected'); return; }
    if (hello.proto !== PROTO) { sendClose(CLOSE_PROTOCOL_MISMATCH, 'protocol mismatch'); return; }
    if (!app.rateLimit(`ws:${ip}`, 120, 60_000)) { sendClose(CLOSE_RATE_LIMITED, 'rate limited'); return; }

    const row = getActiveProject(app, projectId);
    if (!row) { sendClose(CLOSE_ROOM_NOT_FOUND, 'room not found'); return; }
    // кто подключается: владелец по сессии или гость по приглашению
    let user = null as ReturnType<typeof getUser>;
    if (typeof hello.session === 'string') {
      const s = verifySession(app.opts.jwtSecret, hello.session, app.now());
      user = s ? getUser(app.db, s.sub) : null;
    }
    const isOwner = !!user && user.id === row.owner_id;
    const invite = !isOwner && typeof hello.invite === 'string' ? findActiveInvite(app, hello.invite, projectId) : null;
    if (!isOwner && !invite) { sendClose(CLOSE_BAD_CODE, 'bad invite'); return; }

    const room = open(projectId);
    if (!room) { sendClose(CLOSE_ROOM_NOT_FOUND, 'room not found'); return; }
    // бесплатная комната без автора не создаётся: гость увидит проект только для чтения
    if (!isOwner && room.plan === 'free' && ![...room.conns].some(c => c.isHost)) {
      if (room.conns.size === 0) unload(room);
      sendClose(CLOSE_HOST_OFFLINE, 'host offline', 'host-offline');
      return;
    }

    const sock = new WsRoomSocket(ws, makePreprocess(app, user?.id ?? null));
    const conn: Conn = { sock, isHost: isOwner, inviteToken: invite?.token ?? null };
    const name = normalizeName(hello.name) || (user && (!isAnonymousUser(user) || user.name_custom === 1) ? user.display_name : '');
    if (invite) room.inviteAllowCopy = invite.allowCopy;
    // Pro-курсор — только при эффективном тарифе pro/tutor того, чья это сессия (гость без сессии — классический)
    const allowProCursor = !!user && effectivePlan(user, app.now()) !== 'free';
    const uid = room.hub.attach(sock, {
      isHost: isOwner, name, cursorId: hello.cursorId, allowProCursor,
      ...(invite ? { rights: guestRights(room.hub.room.project ?? projectOf(row), invite) } : {}),
    });
    if (uid === null) { if (room.conns.size === 0) unload(room); return; } // хаб отказал и сам закрыл сокет
    room.conns.add(conn);
    if (room.unloadTimer) { clearTimeout(room.unloadTimer); room.unloadTimer = null; }
    sock.on('close', () => leave(room, conn));
  }

  attach.onUpgrade((req, socket, head) => {
    const m = ROOM_PATH.exec(new URL(req.url ?? '/', 'http://abax.local').pathname);
    if (!m) return false;
    let code: string;
    try { code = decodeURIComponent(m[1]); } catch { return false; }
    const projectId = code.startsWith('cloud:') ? code.slice(6) : code;
    const ip = (app.opts.trustProxy ? String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() : '') || req.socket.remoteAddress || 'unknown';
    wss.handleUpgrade(req, socket, head, ws => {
      const timer = setTimeout(() => { try { ws.close(CLOSE_BAD_REQUEST, 'hello expected'); } catch { /* закрыт */ } }, HELLO_TIMEOUT_MS);
      timer.unref();
      ws.once('message', (data: Buffer, isBinary: boolean) => {
        clearTimeout(timer);
        let hello: Rec = {};
        try { if (!isBinary) hello = JSON.parse(data.toString('utf8')) as Rec; } catch { /* ниже — отказ */ }
        join(ws, projectId, hello && typeof hello === 'object' ? hello : {}, ip);
      });
      ws.on('close', () => clearTimeout(timer));
      ws.on('error', () => { /* за ошибкой придёт close */ });
    });
    return true;
  });

  // ----- Изменения через REST и отзыв доступа -----

  app.onProjectChanged((id, project) => {
    const room = rooms.get(id);
    if (!room) return;
    const live = room.hub.room.project;
    // то, что в комнате менялось мимо автора (ответы, реакции, комментарии), не теряется
    room.hub.pushProject(live ? mergeStale(live, project) : project);
    onChange(room, 'rest');
  });

  app.onAccessChanged(ev => {
    const room = rooms.get(ev.projectId);
    if (!room) return;
    if (ev.kind === 'deleted') { unload(room); return; }
    for (const c of [...room.conns]) if (c.inviteToken === ev.token) c.sock.close(CLOSE_BAD_CODE, 'invite revoked');
  });

  attach.onClose(() => close());

  function close(): void {
    for (const room of [...rooms.values()]) { persist(room); unload(room, 1001, 'server shutdown'); }
    wss.close();
  }

  return {
    count: () => rooms.size,
    projectOf: id => rooms.get(id)?.hub.room.project ?? null,
    connections: id => rooms.get(id)?.conns.size ?? 0,
    flush: id => { const r = rooms.get(id); if (r) persist(r); },
    close,
  };
}
