// Комната совместной работы без сетевого кода: участники, права, склейка проекта.
// Транспорт подключает участника через hub.attach(sock, opts): локальный WebSocket (share.cjs)
// или, позже, виртуальный сокет облачного ретранслятора. Не зависит от Electron.

const tasks = require('./room-tasks.cjs');

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
const MAX_NAME = 40;

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

class Room {
  constructor(code) {
    this.code = code;
    this.project = null; // последний известный проект
    this.clients = new Map(); // sock -> info
    this.rights = new Map(); // uid -> { default: 'view'|'edit', pages: {pageId: 'view'|'edit'} }
    this.nextUid = 1;
    this.revs = new Map(); // pageId -> ревизия: растёт с каждым принятым патчем
  }
  editorsCount() {
    let n = 0;
    for (const info of this.clients.values()) {
      if (this.userCanEditAnything(info.uid)) n++;
    }
    return n;
  }
  userCanEditAnything(uid) {
    const r = this.rights.get(uid);
    if (!r) return false;
    if (r.default === 'edit') return true;
    for (const m of Object.values(r.pages || {})) if (m === 'edit') return true;
    return false;
  }
  userPageRight(uid, pageId) {
    const info = [...this.clients.values()].find(c => c.uid === uid);
    if (info && info.host) return 'edit';
    const r = this.rights.get(uid);
    if (!r) return 'view';
    return r.pages[pageId] || r.default || 'view';
  }
  visiblePages(uid) {
    if (!this.project) return [];
    const info = [...this.clients.values()].find(c => c.uid === uid);
    if (info && info.host) return this.project.pages;
    return this.project.pages.filter(pg => this.userPageRight(uid, pg.id) !== 'hidden');
  }
  setRights(uid, patch) {
    // patch: { pageId: 'edit'|'view' } | { default: ... } | { all: ... }
    const info = [...this.clients.values()].find(c => c.uid === uid);
    if (info && info.host) return { ok: false, error: 'Автор всегда редактор' };
    const r = this.rights.get(uid) || { default: 'view', pages: {} };
    const next = { default: r.default, pages: { ...r.pages } };
    if (patch.default) next.default = patch.default;
    if (patch.all) { next.default = patch.all; next.pages = {}; }
    for (const [pid, mode] of Object.entries(patch.pages || {})) next.pages[pid] = mode;
    // лимит редакторов: применяем патч и проверяем, не превысил ли юзер порог
    const wasEditor = this.userCanEditAnything(uid);
    const probe = new Map(this.rights); probe.set(uid, next);
    const countEditors = () => { let n = 0; for (const i of this.clients.values()) { const rr = probe.get(i.uid); if (i.host) { n++; continue; } if (!rr) continue; if (rr.default === 'edit') { n++; continue; } for (const m of Object.values(rr.pages)) if (m === 'edit') { n++; break; } } return n; };
    if (!wasEditor && countEditors() > MAX_EDITORS) {
      return { ok: false, error: `Максимум ${MAX_EDITORS} одновременных редакторов` };
    }
    this.rights.set(uid, next);
    return { ok: true };
  }
  usersSnapshot() {
    return [...this.clients.values()].map(c => ({
      userId: c.uid, name: c.name, color: c.color, host: !!c.host,
      away: Date.now() - c.last > AWAY_MS,
      cursor: c.cursor || null, pageId: c.pageId || null,
      selection: c.selection || [], rights: { default: c.host ? 'edit' : (this.rights.get(c.uid)?.default || 'view'), pages: c.host ? {} : (this.rights.get(c.uid)?.pages || {}) },
    }));
  }
}

// ----- Проверка входящих сообщений: они приходят от участников и не заслуживают доверия -----

const isId = v => typeof v === 'string' && v.length > 0 && v.length <= MAX_ID;
const isNum = v => typeof v === 'number' && Number.isFinite(v);
const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const optPageId = v => v === undefined || v === null || isId(v);

function validCursor(m) {
  return isNum(m.x) && isNum(m.y) && optPageId(m.pageId);
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
  return out;
}

// ----- Задания: ученик не получает ответов и не может их подменить -----

/** Страницы так, как их видит ученик: у заданий нет ответа и закрытого решения. Нетронутые страницы — те же объекты. */
function projectPagesForGuest(pages) {
  return pages.map(pg => (pg.elements.some(tasks.isTask)
    ? { ...pg, elements: pg.elements.map(el => (tasks.isTask(el) ? tasks.projectTaskForGuest(el) : el)) }
    : pg));
}
/** Элемент от ученика поверх известного: у задания принимается только ввод ученика. */
function guardedElement(known, incoming) {
  if (!tasks.isTask(incoming) || !tasks.isTask(known)) return incoming;
  return tasks.mergeGuestTask(known, incoming);
}
/** Элемент от автора поверх известного: ввод ученика остаётся хабу. */
function hostElement(known, incoming) {
  if (!tasks.isTask(incoming) || !tasks.isTask(known)) return incoming;
  return tasks.mergeHostTask(known, incoming);
}
function mapPage(known, incoming, fn) {
  if (!incoming.elements.some(tasks.isTask)) return incoming;
  const byId = new Map(known.elements.map(e => [e.id, e]));
  return { ...incoming, elements: incoming.elements.map(el => fn(byId.get(el.id), el)) };
}

/**
 * Хаб комнаты: принимает участников от любого транспорта и рассылает им сообщения.
 * @param {{ code: string, openEdit?: boolean }} opts
 */
function createRoomHub({ code, openEdit = false }) {
  const room = new Room(code);

  const sendTo = (sock, obj) => { if (sock.readyState === 1) try { sock.send(JSON.stringify(obj)); } catch { /* канал закрывается */ } };

  function broadcastUsers() {
    const users = JSON.stringify({ t: 'users', users: room.usersSnapshot() });
    for (const c of room.clients.values()) { if (c.sock.readyState === 1) try { c.sock.send(users); } catch { /* канал закрывается */ } }
  }

  const projectFor = info => info.host ? room.project : (room.project ? { ...room.project, pages: projectPagesForGuest(room.visiblePages(info.uid)) } : null);

  function rightsOf(uid) {
    const r = room.rights.get(uid);
    const pages = {};
    if (room.project) for (const pg of room.project.pages) pages[pg.id] = room.userPageRight(uid, pg.id);
    return { default: r?.default || 'view', pages };
  }

  // patches: true — хаб понимает t: 'patch'; клиент отвечает { t: 'caps', patches: true }, и ему шлются патчи вместо проектов
  const initFor = info => ({ t: 'init', proto: PROTO, userId: info.uid, color: info.color, name: info.name, project: projectFor(info), rights: rightsOf(info.uid), users: room.usersSnapshot(), patches: true });

  /**
   * Подключить участника. Проверку доступа (код комнаты, ключ автора) делает транспорт до вызова.
   * @param {RoomSocket} sock
   * @param {{ isHost?: boolean, name?: string, patches?: boolean }} [opts] patches — участник понимает патчи без caps
   * @returns {number | null} uid участника или null, если подключение отклонено
   */
  function attach(sock, { isHost = false, name = '', patches = false } = {}) {
    if (isHost && [...room.clients.values()].some(c => c.host)) { sock.close(4409, 'host already connected'); return null; }
    const uid = isHost ? 0 : room.nextUid++;
    const info = {
      sock, uid, host: isHost,
      name: normalizeName(name) || (isHost ? 'Автор' : `Гость ${uid}`),
      color: isHost ? '#e03131' : COLORS[uid % COLORS.length],
      last: Date.now(), cursor: null, pageId: null, selection: [], patches,
    };
    room.clients.set(sock, info);
    if (isHost) room.rights.set(0, { default: 'edit', pages: {} });
    else room.rights.set(uid, { default: openEdit ? 'edit' : 'view', pages: {} });

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
      if (m.t === 'patch') { if (validPatch(m)) acceptPatch(info, m); return; }
      // ученик печатает и отправляет ответ даже на странице с правом view; проверяет хаб по настоящему ответу
      if (m.t === 'task-draft') { acceptTaskInput(info, m, 'draft'); return; }
      if (m.t === 'task-submit') { acceptTaskInput(info, m, 'submit'); return; }
      if (m.t === 'project' && validProject(m.project)) {
        // серверный enforcement: чужие view-страницы не применяем
        if (!room.project) {
          // первый проект задаёт только автор
          if (!isHost) return;
          room.project = m.project;
        } else if (isHost) {
          room.project = mergePages(m.project);
        } else {
          // id, название, иконку и прочие свойства проекта меняет только автор:
          // иначе гость мог бы подменить id, и автор сохранил бы доску поверх другой своей доски
          const merged = mergePages(m.project);
          room.project = { ...room.project, pages: merged.pages, updatedAt: isNum(m.project.updatedAt) ? m.project.updatedAt : room.project.updatedAt };
        }
        for (const c of room.clients.values()) {
          if (c.sock !== sock) sendTo(c.sock, { t: 'project', project: projectFor(c), by: uid });
        }
      }
    });
    sock.on('close', () => { room.clients.delete(sock); broadcastUsers(); });

    /** Страницы присланного проекта поверх известных — только те, где у отправителя есть edit. */
    function mergePages(project) {
      const merged = { ...project, pages: room.project.pages.map(oldPg => {
        const newPg = project.pages.find(p => p.id === oldPg.id);
        if (!newPg || room.userPageRight(uid, oldPg.id) !== 'edit') return oldPg;
        return mapPage(oldPg, newPg, isHost ? hostElement : guardedElement);
      }) };
      // новые страницы разрешаем добавлять только тем, у кого есть хоть одна edit
      for (const newPg of project.pages) {
        if (!merged.pages.some(p => p.id === newPg.id) && room.userCanEditAnything(uid)) merged.pages.push(newPg);
      }
      return merged;
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
    const known = new Map(project.pages.find(p => p.id === patch.pageId).elements.map(e => [e.id, e]));
    const guard = info && !info.host ? guardedElement : hostElement;
    const ops = patch.ops.map(op => (op.op === 'put' ? { op: 'put', el: guard(known.get(op.el.id), op.el) } : op));
    commitPatch({ ...patch, ops }, info ? info.uid : -1, info ? info.sock : null);
    return true;
  }

  /**
   * Ввод ученика в задание: черновик (task-draft) или ответ на проверку (task-submit). Нужен лишь доступ
   * к странице. Результат — правка задания от хаба (by = -1): её получают все, и сам отправитель тоже.
   */
  function acceptTaskInput(info, m, kind) {
    if (!isId(m.pageId) || !isId(m.elId)) return;
    if (typeof (kind === 'draft' ? m.draft : m.value) !== 'string') return;
    const page = room.project && room.project.pages.find(p => p.id === m.pageId);
    if (!page || room.userPageRight(info.uid, page.id) === 'hidden') return;
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

  function pushRights(uid) {
    const c = [...room.clients.values()].find(x => x.uid === uid);
    if (!c) return;
    sendTo(c.sock, { t: 'rights', rights: rightsOf(uid) });
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
    pushProject: project => { room.project = project; for (const c of room.clients.values()) sendTo(c.sock, { t: 'project', project: projectFor(c), by: -1 }); },
    users: () => room.usersSnapshot(),
    closeAll: () => { for (const sock of room.clients.keys()) try { sock.close(); } catch { /* уже закрыт */ } },
  };
}

module.exports = { createRoomHub, Room, PROTO, MAX_EDITORS, MAX_ID, MAX_SELECTION, MAX_NAME, normalizeName };
