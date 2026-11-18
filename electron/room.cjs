// Комната совместной работы без сетевого кода: участники, права, склейка проекта.
// Транспорт подключает участника через hub.attach(sock, opts): локальный WebSocket (share.cjs)
// или, позже, виртуальный сокет облачного ретранслятора. Не зависит от Electron.

const tasks = require('./room-tasks.cjs');
const notes = require('./room-comments.cjs');
const access = require('./room-access.cjs');
const guard = require('./room-guard.cjs');
const crypto = require('crypto');

/** Версия протокола сообщений. Поднимать при несовместимых изменениях формата. */
const PROTO = 1;
const COLORS = ['#e8590c', '#1971c2', '#2f9e44', '#9c36b5', '#0c8599', '#f08c00'];
const MAX_EDITORS = 4;
const AWAY_MS = Number(process.env.DOSKA_AWAY_MS || 45000);
/** Длина идентификатора (страницы, элемента, проекта) — с запасом: id в приложении короткие. */
const MAX_ID = 128;
/** Сколько элементов можно выделить в одном сообщении. */
const MAX_SELECTION = 10000;
/** Длина имени участника в символах. */
const MAX_NAME = 32;
/**
 * Белый список персональных курсоров — зеркало каталога src/cursors.ts (паритет проверяет
 * tests/server/room-pointer.test.ts). Тариф гостя комната на компьютере автора не знает — разрешены все.
 */
const CURSOR_IDS = ['default', 'graphite', 'mint', 'coral', 'lavender', 'amber', 'geometry', 'cosmos', 'neon', 'hologram', 'pixel', 'gold', 'flame', 'aurora'];
const cleanCursorId = v => (typeof v === 'string' && CURSOR_IDS.includes(v) ? v : undefined);

// ----- Чат комнаты: зеркало src/room-chat.ts (паритет — tests/server/room-pointer.test.ts) -----
const CHAT_MAX_LEN = 500;
const CHAT_HISTORY = 100;
const CHAT_RATE_COUNT = 5;
const CHAT_RATE_MS = 3000;
/** Текст сообщения после trim; null — пустое, слишком длинное или не строка. */
function normalizeChatText(raw) {
  if (typeof raw !== 'string') return null;
  const text = raw.trim();
  return text.length === 0 || text.length > CHAT_MAX_LEN ? null : text;
}
/** Ограничитель частоты: true — сообщение можно принять (и оно учтено). */
function createRateLimiter(count = CHAT_RATE_COUNT, windowMs = CHAT_RATE_MS) {
  const times = [];
  return now => {
    while (times.length > 0 && now - times[0] >= windowMs) times.shift();
    if (times.length >= count) return false;
    times.push(now);
    return true;
  };
}

/** Пределы зума в пакетах view и summon — зеркало VIEW_ZOOM_MIN / VIEW_ZOOM_MAX из src/room-host.ts. */
const VIEW_ZOOM_MIN = 0.05;
const VIEW_ZOOM_MAX = 32;
/** Коды закрытия (src/collab-transport.ts). */
const CLOSE_ROOM_FULL = 4430;
const ROOM_FULL_REASON = 'room-full';
/** Верхняя граница своего лимита гостей (MAX_GUESTS_LIMIT в src/limits.ts). */
const MAX_GUESTS_LIMIT = 50;

/**
 * Имя участника приходит от него самого и уходит всем остальным: управляющие символы и
 * переключатели направления текста заменяются пробелами, пробелы схлопываются, длина — до MAX_NAME
 * символов (суррогатные пары не рвутся). Декодирование из URL — забота транспорта.
 */
function normalizeName(raw) {
  const s = String(raw ?? '')
    .replace(/[\p{Cc}\u2028\u2029\u202A-\u202E\u2066-\u2069]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return Array.from(s).slice(0, MAX_NAME).join('').trim();
}

/**
 * Сокет участника — всё, что комнате нужно от транспорта:
 *   readyState  — 1, пока канал открыт;
 *   send(text)  — отправить строку;
 *   close(code?, reason?);
 *   on('message', raw => …), on('close', () => …).
 * WebSocket из пакета ws этому контракту соответствует как есть.
 * @typedef {{ readyState: number, send(text: string): void, close(code?: number, reason?: string): void,
 *   on(ev: 'message' | 'close', fn: (...args: any[]) => void): void }} RoomSocket
 */

/** Доступ гостя по умолчанию: старая роль (edit — редактор, view — комментатор), как раньше (зеркало defaultAccess). */
function defaultAccess(openEdit = false) {
  return { role: openEdit ? 'editor' : 'commenter', legacy: true, personal: {}, source: 'p2p' };
}
const defaultRightOf = a => a.personalAll || (a.role === 'editor' ? 'edit' : 'view');

class Room {
  constructor(code) {
    this.code = code;
    this.project = null; // последний известный проект
    this.clients = new Map(); // sock -> info
    this.access = new Map(); // uid гостя -> доступ по слоям (роль, личные права страниц) — зеркало ParticipantAccess
    this.nextUid = 1;
    this.revs = new Map(); // pageId -> ревизия: растёт с каждым принятым патчем
    this.chat = []; // последние сообщения чата (только в памяти)
    this.followHost = false; // «Автопереход участников за мной»
    this.permsKey = '{}'; // слепок permissions проекта, известный хабу
    this.resumes = new Map(); // секрет возобновления участника -> его автор элементов (только в памяти)
  }
  clientOf(uid) {
    return [...this.clients.values()].find(c => c.uid === uid);
  }
  guestCount() {
    let n = 0;
    for (const c of this.clients.values()) if (!c.host && c.sock.readyState === 1) n++;
    return n;
  }
  /** Страницы, скрытые от участника (у автора — ни одной). */
  hiddenPagesFor(uid) {
    const out = new Set();
    const info = this.clientOf(uid);
    if (!this.project || (info && info.host)) return out;
    for (const pg of this.project.pages) if (this.userPageRight(uid, pg.id) === 'hidden') out.add(pg.id);
    return out;
  }
  pageSetting(pageId) {
    const r = this.project && this.project.permissions && this.project.permissions.pageRights && this.project.permissions.pageRights[pageId];
    return access.isPageRight(r) ? r : undefined;
  }
  rightWith(a, pageId) {
    return access.effectivePageAccess({
      owner: false, role: a.role, legacy: a.legacy, pageSetting: this.pageSetting(pageId), personal: a.personal[pageId] || a.personalAll,
    });
  }
  canEditWith(a) {
    if (!a) return false;
    if (this.project && this.project.pages.length > 0) return this.project.pages.some(pg => this.rightWith(a, pg.id) === 'edit');
    return (a.role === 'editor' && !a.personalAll) || a.personalAll === 'edit' || Object.values(a.personal).some(m => m === 'edit');
  }
  editorsCount(probe = this.access) {
    let n = 0;
    for (const info of this.clients.values()) {
      if (info.host || this.canEditWith(probe.get(info.uid))) n++;
    }
    return n;
  }
  userCanEditAnything(uid) {
    const info = this.clientOf(uid);
    if (info && info.host) return true;
    return this.canEditWith(this.access.get(uid));
  }
  userPageRight(uid, pageId) {
    const info = this.clientOf(uid);
    if (info && info.host) return 'edit';
    const a = this.access.get(uid);
    return a ? this.rightWith(a, pageId) : 'view';
  }
  visiblePages(uid) {
    if (!this.project) return [];
    const info = this.clientOf(uid);
    if (info && info.host) return this.project.pages;
    return this.project.pages.filter(pg => this.userPageRight(uid, pg.id) !== 'hidden');
  }
  /** patch: { role? } | { default? } | { all? } | { pages: { pageId: право | null } } — зеркало Room.setRights. */
  setRights(uid, patch) {
    const info = this.clientOf(uid);
    if (info && info.host) return { ok: false, error: 'Автор всегда редактор' };
    const cur = this.access.get(uid) || defaultAccess();
    const next = { ...cur, personal: { ...cur.personal } };
    const applyDefault = d => {
      if (d === 'hidden') { next.personalAll = 'hidden'; return; }
      delete next.personalAll;
      next.role = d === 'edit' ? 'editor' : 'commenter';
      next.legacy = true;
    };
    const nr = access.normalizeRole(patch.role);
    if (nr) { next.role = nr.role; next.legacy = nr.legacy; delete next.personalAll; }
    if (access.isPageRight(patch.default)) applyDefault(patch.default);
    if (access.isPageRight(patch.all)) { next.personal = {}; applyDefault(patch.all); }
    for (const [pid, mode] of Object.entries(patch.pages || {})) {
      if (mode === null) delete next.personal[pid];
      else if (access.isPageRight(mode)) next.personal[pid] = mode;
    }
    // лимит редакторов: применяем патч и проверяем, не превысил ли юзер порог
    const wasEditor = this.userCanEditAnything(uid);
    const probe = new Map(this.access); probe.set(uid, next);
    if (!wasEditor && this.editorsCount(probe) > MAX_EDITORS) {
      return { ok: false, error: `Максимум ${MAX_EDITORS} одновременных редакторов` };
    }
    this.access.set(uid, next);
    return { ok: true };
  }
  snapshotRights(c) {
    if (c.host) return { default: 'edit', pages: {} };
    const a = this.access.get(c.uid);
    if (!a) return { default: 'view', pages: {} };
    const def = defaultRightOf(a);
    const pages = {};
    for (const pg of (this.project && this.project.pages) || []) {
      const r = this.rightWith(a, pg.id);
      if (r !== def) pages[pg.id] = r;
    }
    return { default: def, pages };
  }
  usersSnapshot() {
    return [...this.clients.values()].map(c => {
      const a = this.access.get(c.uid);
      return {
        userId: c.uid, name: c.name, color: c.color, host: !!c.host,
        away: Date.now() - c.last > AWAY_MS,
        cursor: c.cursor || null, pageId: c.pageId || null,
        selection: c.selection || [], rights: this.snapshotRights(c),
        ...(c.cursorId ? { cursorId: c.cursorId } : {}),
        ...(c.view ? { view: c.view } : {}),
        access: c.host ? { role: 'owner', source: 'owner' } : { role: (a && a.role) || 'commenter', source: (a && a.source) || 'p2p' },
      };
    });
  }
}

/** Снимок для гостя: без сведений о доступе остальных (зеркало stripAccess). */
function stripAccess(users) {
  return users.map(u => {
    if (!u.access) return u;
    const { access: _a, ...rest } = u;
    return rest;
  });
}

/** Камера из пакета view / summon (зеркало cleanView из src/room-host.ts). */
function cleanView(m) {
  if (!isId(m.pageId) || !isNum(m.vx) || !isNum(m.vy) || !isNum(m.vz)) return null;
  if (m.vz < VIEW_ZOOM_MIN || m.vz > VIEW_ZOOM_MAX) return null;
  return { pageId: m.pageId, vx: m.vx, vy: m.vy, vz: m.vz };
}

/** Снимок участников для получателя: на скрытой для него странице — без страницы, курсора, камеры, выделения (зеркало maskUsersFor). */
function maskUsersFor(users, viewerId, hidden) {
  if (hidden.size === 0) return users;
  return users.map(u => {
    if (u.userId === viewerId) return u;
    const onHidden = (u.pageId !== null && hidden.has(u.pageId)) || (!!u.view && hidden.has(u.view.pageId));
    return onHidden ? { ...u, pageId: null, cursor: null, view: null, selection: [], hiddenPage: true } : u;
  });
}

// ----- Проверка входящих сообщений: они приходят от участников и не заслуживают доверия -----

const isId = v => typeof v === 'string' && v.length > 0 && v.length <= MAX_ID;
const isNum = v => typeof v === 'number' && Number.isFinite(v);
const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const optPageId = v => v === undefined || v === null || isId(v);

function validCursor(m) {
  return isNum(m.x) && isNum(m.y) && optPageId(m.pageId);
}
const MAX_POINTER_PTS = 64;
const MAX_FLASH_IDS = 2000;
const POINTER_COLOR = /^#[0-9a-fA-F]{6}$/;
const clamp01 = v => Math.min(1, Math.max(0, v));

/**
 * Указка участника (лазер, исчезающий маркер, подсветка объектов) → то, что можно разослать остальным.
 * Зеркало cleanPointer из src/room-host.ts (паритет — tests/server/room-pointer.test.ts).
 */
function cleanPointer(m) {
  if (!isId(m.pageId)) return null;
  const pts = () => {
    if (!Array.isArray(m.pts) || m.pts.length === 0 || m.pts.length > MAX_POINTER_PTS) return null;
    const out = [];
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
      ...(m.opacity !== undefined && m.opacity < 1 ? { opacity: clamp01(m.opacity) } : {}),
    };
  }
  if (m.k === 'flash') {
    if (!Array.isArray(m.ids) || m.ids.length === 0 || m.ids.length > MAX_FLASH_IDS || !m.ids.every(isId)) return null;
    return { k: 'flash', pageId: m.pageId, ids: m.ids };
  }
  return null;
}

/** Без ids — пустое выделение (так клиент снимает выделение). */
function validSelection(m) {
  const ids = m.ids ?? [];
  return Array.isArray(ids) && ids.length <= MAX_SELECTION && ids.every(isId) && optPageId(m.pageId);
}
/** Минимум, без которого клиент упадёт при отрисовке: страница с id и списком элементов с id и type. */
function validPage(pg) {
  return isObj(pg) && isId(pg.id) && Array.isArray(pg.elements)
    && pg.elements.every(el => isObj(el) && isId(el.id) && typeof el.type === 'string');
}
function validProject(p) {
  if (!isObj(p) || !isId(p.id) || !Array.isArray(p.pages) || !p.pages.every(validPage)) return false;
  return new Set(p.pages.map(pg => pg.id)).size === p.pages.length;
}

// ----- Дельта-патчи (то же, что src/delta.ts: операции над элементами страницы) -----

const MAX_PATCH_OPS = 10000;
const GRIDS = ['none', 'dots', 'square', 'coord'];

/** Патч из сети: форма операций и размеры (как isBoardPatch в src/delta.ts). */
function validPatch(p) {
  if (!isObj(p) || p.t !== 'patch' || !isId(p.pageId) || !isNum(p.rev)) return false;
  if (!Array.isArray(p.ops) || p.ops.length > MAX_PATCH_OPS) return false;
  if (p.grid !== undefined && !GRIDS.includes(p.grid)) return false;
  if (p.backgroundColor !== undefined && p.backgroundColor !== null && typeof p.backgroundColor !== 'string') return false;
  if (p.coordLabels !== undefined && typeof p.coordLabels !== 'boolean') return false;
  return p.ops.every(o => {
    if (!isObj(o)) return false;
    if (o.op === 'put') return isObj(o.el) && isId(o.el.id) && typeof o.el.type === 'string';
    if (o.op === 'del') return typeof o.id === 'string' && o.id.length <= MAX_ID;
    if (o.op === 'order') return Array.isArray(o.ids) && o.ids.length <= MAX_PATCH_OPS && o.ids.every(i => typeof i === 'string');
    return false;
  });
}

/** Закреплённые сверху и снизу — по краям, остальные в своём порядке (как replaceElements в state.ts). */
function pinOrder(els) {
  if (!els.some(e => e.layerPin)) return els;
  return [...els.filter(e => e.layerPin === 'bottom'), ...els.filter(e => !e.layerPin), ...els.filter(e => e.layerPin === 'top')];
}

/** Страница с применёнными операциями; ops уже проверены и очищены (put без негодных элементов). */
function applyPatchToPage(page, patch) {
  let els = page.elements.slice();
  for (const op of patch.ops) {
    if (op.op === 'put') {
      const i = els.findIndex(e => e.id === op.el.id);
      if (i < 0) els.push(op.el); else els[i] = op.el;
    } else if (op.op === 'del') {
      els = els.filter(e => e.id !== op.id);
    } else if (op.op === 'order') {
      const byId = new Map(els.map(e => [e.id, e]));
      const ordered = [];
      for (const id of op.ids) { const e = byId.get(id); if (e) { ordered.push(e); byId.delete(id); } }
      els = [...ordered, ...els.filter(e => byId.has(e.id))];
    }
  }
  const out = { ...page, elements: pinOrder(els) };
  if (patch.grid !== undefined) out.grid = patch.grid;
  if (patch.backgroundColor === null) delete out.backgroundColor;
  else if (typeof patch.backgroundColor === 'string') out.backgroundColor = patch.backgroundColor;
  if (patch.coordLabels === false) out.coordLabels = false;
  else if (patch.coordLabels === true) delete out.coordLabels;
  return out;
}

// ----- Задания: ученик не получает ответов и не может их подменить -----

/** Страницы так, как их видит ученик: у заданий нет ответа и закрытого решения. Нетронутые страницы — те же объекты. */
function projectPagesForGuest(pages) {
  return pages.map(pg => (pg.elements.some(tasks.isTask)
    ? { ...pg, elements: pg.elements.map(el => (tasks.isTask(el) ? tasks.projectTaskForGuest(el) : el)) }
    : pg));
}
/** Страница участника, но с комментариями хаба: их ведёт хаб, а не присланный проект. */
function keepHubComments(known, incoming) {
  if (known.comments === incoming.comments) return incoming;
  const { comments: _c, ...rest } = incoming;
  return known.comments ? { ...rest, comments: known.comments } : rest;
}
/**
 * Хаб комнаты: принимает участников от любого транспорта и рассылает им сообщения.
 * Тарифа автора комната на компьютере не знает: лимита гостей по тарифу нет (как и раньше), лимит автора
 * permissions.maxGuests действует у проекта с ownerPlan pro/tutor, «Автопереход» разрешён (кнопку ограничивает клиент).
 * @param {{ code: string, openEdit?: boolean, maxGuests?: number, canFollowHost?: boolean, multiHost?: boolean }} opts
 *   maxGuests — явный лимит гостей; multiHost — несколько соединений автора вместо отказа 4409
 */
function createRoomHub({ code, openEdit = false, maxGuests, canFollowHost = true, multiHost = false }) {
  const room = new Room(code);
  let chatSeq = 0;

  const sendTo = (sock, obj) => { if (sock.readyState === 1) try { sock.send(JSON.stringify(obj)); } catch { /* канал закрывается */ } };

  /** Лимит гостей: явный из опций или лимит автора у Pro/Tutor-проекта; без них — без ограничений. */
  function guestLimit() {
    if (maxGuests !== undefined) return maxGuests;
    const p = room.project;
    const own = p && p.permissions && p.permissions.maxGuests;
    const paid = p && (p.ownerPlan === 'pro' || p.ownerPlan === 'tutor');
    return paid && Number.isInteger(own) && own >= 1 && own <= MAX_GUESTS_LIMIT ? own : Infinity;
  }

  const usersFor = info => {
    const base = room.usersSnapshot();
    return maskUsersFor(info.host ? base : stripAccess(base), info.uid, room.hiddenPagesFor(info.uid));
  };

  function broadcastUsers() {
    const base = room.usersSnapshot();
    let guestBase = null;
    let sharedHost = null;
    let sharedGuest = null;
    for (const c of room.clients.values()) {
      if (c.sock.readyState !== 1) continue;
      if (c.host) {
        if (sharedHost === null) sharedHost = JSON.stringify({ t: 'users', users: base });
        try { c.sock.send(sharedHost); } catch { /* канал закрывается */ }
        continue;
      }
      if (guestBase === null) guestBase = stripAccess(base);
      const hidden = room.hiddenPagesFor(c.uid);
      if (hidden.size === 0) {
        if (sharedGuest === null) sharedGuest = JSON.stringify({ t: 'users', users: guestBase });
        try { c.sock.send(sharedGuest); } catch { /* канал закрывается */ }
      } else {
        sendTo(c.sock, { t: 'users', users: maskUsersFor(guestBase, c.uid, hidden) });
      }
    }
  }

  const projectFor = info => info.host ? room.project : (room.project ? { ...room.project, pages: projectPagesForGuest(room.visiblePages(info.uid)) } : null);

  function rightsOf(uid) {
    const a = room.access.get(uid);
    const info = room.clientOf(uid);
    const pages = {};
    if (room.project) for (const pg of room.project.pages) pages[pg.id] = room.userPageRight(uid, pg.id);
    return { default: info && info.host ? 'edit' : a ? defaultRightOf(a) : 'view', pages };
  }

  /** Возможности участника (зеркало capsOf из src/room-host.ts). */
  function capsOf(info) {
    if (info.host) return { ...access.OWNER_CAPS };
    const a = room.access.get(info.uid) || defaultAccess(openEdit);
    return access.participantCaps({ owner: false, role: a.role, legacy: a.legacy, inviteAllowCopy: a.inviteAllowCopy }, access.hubPermissions(room.project));
  }
  const roleOf = info => (info.host ? 'owner' : (room.access.get(info.uid) || defaultAccess(openEdit)).role);
  const accessFor = info => {
    const caps = capsOf(info);
    return { rights: rightsOf(info.uid), allowCopy: caps.copy, role: roleOf(info), caps };
  };

  const principalOf = info => (info.host ? null : (room.access.get(info.uid) || {}).principal || null);
  /** Кто правит (зеркало whoOf): владелец, автор элементов участника, включена ли защита. */
  const whoOf = info => ({ privileged: !info || info.host, principal: info ? principalOf(info) : null, protect: access.hubPermissions(room.project).protectElements === true });
  const resumeOf = info => {
    const p = principalOf(info);
    if (!p) return undefined;
    for (const [secret, who] of room.resumes) if (who === p) return secret;
    return undefined;
  };

  // patches: true — хаб понимает t: 'patch'; клиент отвечает { t: 'caps', patches: true }, и ему шлются патчи вместо проектов
  const initFor = info => {
    const principal = principalOf(info);
    const resume = resumeOf(info);
    return {
      t: 'init', proto: PROTO, userId: info.uid, color: info.color, name: info.name, project: projectFor(info), ...accessFor(info),
      users: usersFor(info), patches: true, chat: room.chat, followHost: room.followHost,
      ...(principal ? { principal } : {}), ...(resume ? { resume } : {}),
    };
  };

  /** Секрет возобновления (зеркало acceptResume): до первой правки, автор свободен — он снова этого участника. */
  function acceptResume(info, m) {
    if (info.host) return;
    const a = room.access.get(info.uid);
    const want = typeof m.secret === 'string' ? room.resumes.get(m.secret) : undefined;
    const busy = !!want && [...room.clients.values()].some(c => c !== info && c.sock.readyState === 1 && (room.access.get(c.uid) || {}).principal === want);
    if (!a || !want || busy || info.edited) { sendTo(info.sock, { t: 'resume', ok: false }); return; }
    for (const [secret, p] of room.resumes) if (p === a.principal && secret !== m.secret) room.resumes.delete(secret);
    a.principal = want;
    sendTo(info.sock, { t: 'resume', ok: true, principal: want });
  }

  const permsKeyOf = p => JSON.stringify((p && p.permissions) || {});
  /** Права и возможности гостей перед сменой прав проекта (зеркало accessBefore); null — права не меняются. */
  function accessBefore(next) {
    if (permsKeyOf(next) === room.permsKey) return null;
    const out = new Map();
    for (const c of room.clients.values()) if (!c.host) out.set(c.uid, JSON.stringify(accessFor(c)));
    return out;
  }
  /** Гостям с изменившимися правами — { t: 'rights' }, затем всем — { t: 'users' } (зеркало afterAccessChange). */
  function afterAccessChange(before) {
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

  function acceptChat(info, m) {
    if (!capsOf(info).chat) return; // читатель чат читает, но не пишет
    const text = normalizeChatText(m.text);
    if (text === null) return;
    const ts = Date.now();
    if (!info.chatOk(ts)) return; // флуд — молча
    const msg = { id: `${ts.toString(36)}-${(++chatSeq).toString(36)}`, by: info.uid, name: info.name, ...(info.cursorId ? { cursorId: info.cursorId } : {}), text, ts };
    room.chat = [...room.chat, msg].slice(-CHAT_HISTORY);
    for (const c of room.clients.values()) sendTo(c.sock, { t: 'chat', ...msg });
  }

  function acceptView(info, m) {
    const view = cleanView(m);
    if (!view || !(room.project && room.project.pages.some(p => p.id === view.pageId))) return;
    if (room.userPageRight(info.uid, view.pageId) === 'hidden') return;
    info.view = view;
    info.pageId = view.pageId;
    broadcastUsers();
  }

  function acceptSummon(info, m) {
    if (!info.host && !capsOf(info).summon) return;
    const view = cleanView(m);
    if (!view || !(room.project && room.project.pages.some(p => p.id === view.pageId))) return;
    for (const c of room.clients.values()) {
      if (c.host || room.userPageRight(c.uid, view.pageId) === 'hidden') continue;
      sendTo(c.sock, { t: 'summon', ...view, by: info.uid });
    }
  }

  function acceptFollowHost(info, m) {
    if (!info.host || typeof m.enabled !== 'boolean' || !canFollowHost) return;
    if (room.followHost === m.enabled) return;
    room.followHost = m.enabled;
    for (const c of room.clients.values()) sendTo(c.sock, { t: 'follow-host', enabled: room.followHost, by: info.uid });
  }

  /**
   * Подключить участника. Проверку доступа (код комнаты, ключ автора) делает транспорт до вызова.
   * @param {RoomSocket} sock
   * @param {{ isHost?: boolean, name?: string, patches?: boolean, cursorId?: unknown }} [opts] patches — участник понимает патчи без caps; cursorId — персональный курсор
   * @returns {number | null} uid участника или null, если подключение отклонено
   */
  function attach(sock, { isHost = false, name = '', patches = false, cursorId } = {}) {
    if (isHost && !multiHost && [...room.clients.values()].some(c => c.host)) { sock.close(4409, 'host already connected'); return null; }
    if (!isHost) {
      const max = guestLimit();
      if (room.guestCount() >= max) {
        sendTo(sock, { t: 'denied', reason: ROOM_FULL_REASON, maxGuests: max, planLimited: false });
        sock.close(CLOSE_ROOM_FULL, ROOM_FULL_REASON);
        return null;
      }
    }
    // первое устройство автора — uid 0, следующие (multiHost) — свои номера
    const uid = isHost && !room.clientOf(0) ? 0 : room.nextUid++;
    const info = {
      sock, uid, host: isHost,
      name: normalizeName(name) || (isHost ? 'Автор' : `Гость ${uid}`),
      color: isHost ? '#e03131' : COLORS[uid % COLORS.length],
      last: Date.now(), cursor: null, pageId: null, selection: [], patches,
      cursorId: cleanCursorId(cursorId),
      view: null, chatOk: createRateLimiter(), edited: false,
    };
    room.clients.set(sock, info);
    // доступ нового гостя: старая роль по умолчанию; права страниц проекта хаб читает сам (зеркало initialAccess)
    if (isHost) room.access.delete(uid);
    else {
      // автор элементов участника и секрет возобновления выдаёт хаб (SPEC_NIGHT6 §4.3)
      const a = defaultAccess(openEdit);
      a.principal = `c:${crypto.randomBytes(6).toString('hex')}`;
      room.resumes.set(crypto.randomBytes(16).toString('base64url'), a.principal);
      room.access.set(uid, a);
    }

    sendTo(sock, initFor(info));
    broadcastUsers(); // остальные сразу видят нового участника

    sock.on('message', raw => {
      info.last = Date.now();
      let m; try { m = JSON.parse(raw); } catch { return; }
      if (!isObj(m)) return;
      if (m.t === 'cursor') {
        if (!validCursor(m)) return;
        info.cursor = { x: m.x, y: m.y }; info.pageId = m.pageId ?? info.pageId; broadcastUsers(); return;
      }
      if (m.t === 'selection') {
        if (!validSelection(m)) return;
        info.selection = m.ids ?? []; info.pageId = m.pageId ?? info.pageId; broadcastUsers(); return;
      }
      if (m.t === 'caps') { info.patches = m.patches === true; return; }
      if (m.t === 'profile') {
        // смена имени и курсора на лету (зеркало src/room-host.ts)
        const nextName = m.name === undefined ? info.name : normalizeName(m.name);
        const nextCursor = m.cursorId === undefined ? info.cursorId : cleanCursorId(m.cursorId) ?? info.cursorId;
        if (!nextName || (nextName === info.name && nextCursor === info.cursorId)) return;
        info.name = nextName; info.cursorId = nextCursor; broadcastUsers(); return;
      }
      if (m.t === 'patch') { if (validPatch(m)) { acceptPatch(info, m); info.edited = true; } return; }
      if (m.t === 'resume') { acceptResume(info, m); return; }
      // ученик печатает и отправляет ответ даже на странице с правом view (не читатель); проверяет хаб по настоящему ответу
      if (m.t === 'task-draft') { acceptTaskInput(info, m, 'draft'); return; }
      if (m.t === 'task-submit') { acceptTaskInput(info, m, 'submit'); return; }
      // реакции и комментарии — кто видит страницу и может комментировать (не читатель)
      if (m.t === 'pointer') { relayPointer(info, m); return; }
      if (m.t === 'react') { acceptReaction(info, m); return; }
      if (m.t === 'comment') { acceptComment(info, m); return; }
      if (m.t === 'chat') { acceptChat(info, m); return; }
      if (m.t === 'view') { acceptView(info, m); return; }
      if (m.t === 'summon') { acceptSummon(info, m); return; }
      if (m.t === 'follow-host') { acceptFollowHost(info, m); return; }
      if (m.t === 'project' && validProject(m.project)) {
        info.edited = true;
        // права проекта меняет только автор; их смену хаб доносит до гостей
        const before = isHost ? accessBefore(m.project) : null;
        let refusedProject = false;
        // серверный enforcement: чужие view-страницы не применяем
        if (!room.project) {
          // первый проект задаёт только автор
          if (!isHost) return;
          room.project = m.project;
        } else if (isHost) {
          const merged = mergePages(m.project);
          room.project = merged.project;
          refusedProject = merged.refused;
        } else {
          // id, название, иконку и прочие свойства проекта меняет только автор:
          // иначе гость мог бы подменить id, и автор сохранил бы доску поверх другой своей доски
          const merged = mergePages(m.project);
          room.project = { ...room.project, pages: merged.project.pages, updatedAt: isNum(m.project.updatedAt) ? m.project.updatedAt : room.project.updatedAt };
          refusedProject = merged.refused;
        }
        for (const c of room.clients.values()) {
          if (c.sock !== sock) sendTo(c.sock, { t: 'project', project: projectFor(c), by: uid });
        }
        // отклонённое и поставленные хабом авторы — отправителю: его доска снова совпадает с хабом
        if (refusedProject) sendTo(sock, { t: 'project', project: projectFor(info), by: -1 });
        afterAccessChange(before);
      }
    });
    sock.on('close', () => { room.clients.delete(sock); broadcastUsers(); });

    /** Страницы присланного проекта поверх известных — только те, где у отправителя есть edit (зеркало mergePages). */
    function mergePages(project) {
      const who = whoOf(info);
      let refused = false;
      const merged = { ...project, pages: room.project.pages.map(oldPg => {
        const newPg = project.pages.find(p => p.id === oldPg.id);
        if (!newPg || room.userPageRight(uid, oldPg.id) !== 'edit') return oldPg;
        const g = guard.guardPageReplace(oldPg, newPg, who);
        if (g.refused) refused = true;
        const sentBy = new Map(newPg.elements.map(e => [e.id, e.by]));
        if (g.page.elements.some(e => sentBy.has(e.id) && sentBy.get(e.id) !== e.by)) refused = true;
        return keepHubComments(oldPg, g.page);
      }) };
      // новые страницы разрешаем добавлять только тем, у кого есть хоть одна edit; при защите гости страниц не добавляют
      for (const newPg of project.pages) {
        if (merged.pages.some(p => p.id === newPg.id) || !room.userCanEditAnything(uid)) continue;
        if (!isHost && who.protect) { refused = true; continue; }
        if (!isHost && newPg.elements.some(el => el.by !== (who.principal || undefined))) refused = true;
        merged.pages.push(isHost ? newPg : { ...newPg, elements: newPg.elements.map(el => guard.withBy(el, who.principal || undefined)) });
      }
      return { project: merged, refused };
    }
    return uid;
  }

  /** Применить очищенный патч к странице хаба и разослать; skip — отправитель, которому его же правку возвращать не нужно. */
  function commitPatch(patch, by, skip) {
    const project = room.project;
    const rev = (room.revs.get(patch.pageId) || 0) + 1;
    room.revs.set(patch.pageId, rev);
    const clean = { ...patch, rev };
    room.project = {
      ...project,
      updatedAt: Date.now(),
      pages: project.pages.map(pg => (pg.id === patch.pageId ? applyPatchToPage(pg, clean) : pg)),
    };
    const forGuest = clean.ops.map(op => (op.op === 'put' && tasks.isTask(op.el) ? { op: 'put', el: tasks.projectTaskForGuest(op.el) } : op));
    for (const c of room.clients.values()) {
      if (skip && c.sock === skip) continue;
      if (room.userPageRight(c.uid, patch.pageId) === 'hidden') continue; // скрытая страница до участника не доходит
      if (c.patches) sendTo(c.sock, { ...clean, ops: c.host ? clean.ops : forGuest, by });
      else sendTo(c.sock, { t: 'project', project: projectFor(c), by });
    }
  }

  /** Принять патч страницы: нужен edit на ней. Применяется к странице хаба и уходит остальным; info = null — от автора. */
  function acceptPatch(info, patch) {
    const project = room.project;
    if (!project || !project.pages.some(p => p.id === patch.pageId)) return false;
    if (info && room.userPageRight(info.uid, patch.pageId) !== 'edit') return false;
    const page = project.pages.find(p => p.id === patch.pageId);
    // задания, авторы элементов и (при защите) чужие элементы — решает хаб (зеркало acceptPatch)
    const { patch: allowed, refused } = guard.guardPatch(page, patch, whoOf(info));
    const anyRefused = refused.ids.length > 0 || refused.order || refused.page;
    const empty = allowed.ops.length === 0 && allowed.grid === undefined && allowed.backgroundColor === undefined && allowed.coordLabels === undefined;
    if (!(anyRefused && empty)) commitPatch(allowed, info ? info.uid : -1, info ? info.sock : null);
    const sentBy = new Map(patch.ops.filter(op => op.op === 'put').map(op => [op.el.id, op.el.by]));
    const stamped = allowed.ops.filter(op => op.op === 'put' && sentBy.get(op.el.id) !== op.el.by).map(op => op.el.id);
    if (info && (anyRefused || stamped.length > 0)) sendCorrection(info, patch.pageId, { ...refused, ids: [...refused.ids, ...stamped] });
    return true;
  }

  /** Отправителю — состояние хаба там, где правку не приняли или поставили автора (зеркало sendCorrection). */
  function sendCorrection(info, pageId, refused) {
    const page = room.project && room.project.pages.find(p => p.id === pageId);
    if (!page) return;
    if (!info.patches) { sendTo(info.sock, { t: 'project', project: projectFor(info), by: -1 }); return; }
    const byId = new Map(page.elements.map(e => [e.id, e]));
    const seen = new Set();
    const ops = [];
    for (const id of refused.ids) {
      if (seen.has(id)) continue;
      seen.add(id);
      const el = byId.get(id);
      if (el) ops.push({ op: 'put', el: !info.host && tasks.isTask(el) ? tasks.projectTaskForGuest(el) : el });
      else ops.push({ op: 'del', id });
    }
    if (refused.order || refused.ids.length > 0) ops.push({ op: 'order', ids: page.elements.map(e => e.id) });
    const fix = { t: 'patch', pageId, rev: room.revs.get(pageId) || 0, ops };
    if (refused.page) {
      fix.grid = page.grid;
      fix.backgroundColor = page.backgroundColor === undefined ? null : page.backgroundColor;
      fix.coordLabels = page.coordLabels !== false;
    }
    sendTo(info.sock, { ...fix, by: -1 });
  }

  /**
   * Ввод ученика в задание: черновик (task-draft) или ответ на проверку (task-submit). Нужен лишь доступ
   * к странице. Результат — правка задания от хаба (by = -1): её получают все, и сам отправитель тоже.
   */
  function acceptTaskInput(info, m, kind) {
    if (!isId(m.pageId) || !isId(m.elId)) return;
    if (typeof (kind === 'draft' ? m.draft : m.value) !== 'string') return;
    const page = room.project && room.project.pages.find(p => p.id === m.pageId);
    if (!page || !capsOf(info).comment || room.userPageRight(info.uid, page.id) === 'hidden') return;
    const el = page.elements.find(e => e.id === m.elId);
    if (!el || !tasks.isTask(el)) return;
    let next;
    if (kind === 'draft') {
      next = tasks.updateStudentDraft(el, m.draft);
    } else {
      const res = tasks.submitTaskAttempt(el, m.value);
      // отправленное в черновике уже не нужно
      next = res.updated === el ? el : tasks.updateStudentDraft(res.updated, '');
    }
    if (next === el) return;
    commitPatch({ t: 'patch', pageId: page.id, rev: 0, ops: [{ op: 'put', el: next }] }, -1, null);
  }

  /** Указка не хранится: чистое сообщение уходит всем остальным, кто видит страницу. */
  function relayPointer(info, m) {
    const clean = cleanPointer(m);
    if (!clean || !(room.project && room.project.pages.some(p => p.id === clean.pageId))) return;
    if (!capsOf(info).pointer || room.userPageRight(info.uid, clean.pageId) === 'hidden') return;
    for (const c of room.clients.values()) {
      if (c === info || room.userPageRight(c.uid, clean.pageId) === 'hidden') continue;
      sendTo(c.sock, { t: 'pointer', ...clean, by: info.uid });
    }
  }

  /** Реакция участника на элемент: ставится или снимается; результат — правка элемента от хаба (её получают все). */
  function acceptReaction(info, m) {
    if (!isId(m.pageId) || !isId(m.elId) || typeof m.emoji !== 'string') return;
    const page = room.project && room.project.pages.find(p => p.id === m.pageId);
    if (!page || !capsOf(info).comment || room.userPageRight(info.uid, page.id) === 'hidden') return;
    const el = page.elements.find(e => e.id === m.elId);
    if (!el) return;
    const next = notes.toggleElementReaction(el, m.emoji, notes.cleanUserId(m.userId) || `u${info.uid}`);
    if (next === el) return;
    commitPatch({ t: 'patch', pageId: page.id, rev: 0, ops: [{ op: 'put', el: next }] }, -1, null);
  }

  /** Комментарии: создать ветку, ответить, закрыть. Имя автора — имя участника в комнате, а не присланное. */
  function acceptComment(info, m) {
    const project = room.project;
    if (!project || !isId(m.pageId)) return;
    const page = project.pages.find(p => p.id === m.pageId);
    if (!page || !capsOf(info).comment || room.userPageRight(info.uid, page.id) === 'hidden') return;
    const author = { authorId: notes.cleanUserId(m.userId) || `u${info.uid}`, authorName: info.name };
    let next = page;
    if (m.op === 'create') {
      if (!isNum(m.x) || !isNum(m.y) || typeof m.text !== 'string') return;
      next = notes.createCommentThread(page, { x: m.x, y: m.y, ...(isId(m.targetElementId) ? { targetElementId: m.targetElementId } : {}), ...author, text: m.text });
    } else if (m.op === 'reply') {
      if (!isId(m.threadId) || typeof m.text !== 'string') return;
      next = notes.addCommentReply(page, m.threadId, { ...author, text: m.text });
    } else if (m.op === 'resolve') {
      if (!isId(m.threadId)) return;
      next = notes.resolveCommentThread(page, m.threadId, m.resolved !== false);
    }
    if (next === page) return;
    room.project = { ...project, updatedAt: Date.now(), pages: project.pages.map(pg => (pg === page ? next : pg)) };
    const msg = { t: 'comments', pageId: page.id, comments: next.comments || [], by: -1 };
    for (const c of room.clients.values()) {
      if (room.userPageRight(c.uid, page.id) !== 'hidden') sendTo(c.sock, msg);
    }
  }

  function pushRights(uid) {
    const c = [...room.clients.values()].find(x => x.uid === uid);
    if (!c) return;
    sendTo(c.sock, { t: 'rights', ...accessFor(c) });
    // состав видимых страниц мог измениться: скрытая страница пропадает у гостя сразу, открытая — появляется
    if (room.project) sendTo(c.sock, { t: 'project', project: projectFor(c), by: -1 });
  }

  /**
   * Заново отправить участнику init — полное текущее состояние. Транспорт вызывает это, когда
   * участник мог пропустить сообщения (обрыв связи автора с ретранслятором). Клиент принимает
   * повторный init как обычный: проект, права и участники заменяются, страница и камера остаются.
   * @returns {boolean} false — такого участника нет
   */
  function refresh(sock) {
    const info = room.clients.get(sock);
    if (!info) return false;
    sendTo(sock, initFor(info));
    return true;
  }

  return {
    room,
    attach,
    refresh,
    setRights: (uid, patch) => { const r = room.setRights(uid, patch); broadcastUsers(); pushRights(uid); return r; },
    pushPatch: patch => validPatch(patch) && acceptPatch(null, patch),
    pushProject: project => {
      const before = accessBefore(project);
      room.project = project;
      for (const c of room.clients.values()) sendTo(c.sock, { t: 'project', project: projectFor(c), by: -1 });
      afterAccessChange(before);
    },
    users: () => room.usersSnapshot(),
    closeAll: () => { for (const sock of room.clients.keys()) try { sock.close(); } catch { /* уже закрыт */ } },
  };
}

module.exports = {
  createRoomHub, Room, defaultAccess, stripAccess, PROTO, MAX_EDITORS, MAX_ID, MAX_SELECTION, MAX_NAME, CURSOR_IDS, normalizeName, cleanPointer,
  CHAT_MAX_LEN, CHAT_HISTORY, CHAT_RATE_COUNT, CHAT_RATE_MS, VIEW_ZOOM_MIN, VIEW_ZOOM_MAX, normalizeChatText, createRateLimiter, cleanView, maskUsersFor,
};
