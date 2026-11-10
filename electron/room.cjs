// Комната совместной работы без сетевого кода: участники, права, склейка проекта.
// Транспорт подключает участника через hub.attach(sock, opts): локальный WebSocket (share.cjs)
// или, позже, виртуальный сокет облачного ретранслятора. Не зависит от Electron.

/** Версия протокола сообщений. Поднимать при несовместимых изменениях формата. */
const PROTO = 1;
const COLORS = ['#e8590c', '#1971c2', '#2f9e44', '#9c36b5', '#0c8599', '#f08c00'];
const MAX_EDITORS = 4;
const AWAY_MS = Number(process.env.DOSKA_AWAY_MS || 45000);
/** Длина идентификатора (страницы, элемента, проекта) — с запасом: id в приложении короткие. */
const MAX_ID = 128;
/** Сколько элементов можно выделить в одном сообщении. */
const MAX_SELECTION = 10000;

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

  const projectFor = info => info.host ? room.project : (room.project ? { ...room.project, pages: room.visiblePages(info.uid) } : null);

  function rightsOf(uid) {
    const r = room.rights.get(uid);
    const pages = {};
    if (room.project) for (const pg of room.project.pages) pages[pg.id] = room.userPageRight(uid, pg.id);
    return { default: r?.default || 'view', pages };
  }

  /**
   * Подключить участника. Проверку доступа (код комнаты, ключ автора) делает транспорт до вызова.
   * @param {RoomSocket} sock
   * @param {{ isHost?: boolean, name?: string }} [opts]
   * @returns {number | null} uid участника или null, если подключение отклонено
   */
  function attach(sock, { isHost = false, name = '' } = {}) {
    if (isHost && [...room.clients.values()].some(c => c.host)) { sock.close(4409, 'host already connected'); return null; }
    const uid = isHost ? 0 : room.nextUid++;
    const info = {
      sock, uid, host: isHost,
      name: name || (isHost ? 'Автор' : `Гость ${uid}`),
      color: isHost ? '#e03131' : COLORS[uid % COLORS.length],
      last: Date.now(), cursor: null, pageId: null, selection: [],
    };
    room.clients.set(sock, info);
    if (isHost) room.rights.set(0, { default: 'edit', pages: {} });
    else room.rights.set(uid, { default: openEdit ? 'edit' : 'view', pages: {} });

    sendTo(sock, { t: 'init', proto: PROTO, userId: uid, color: info.color, name: info.name, project: projectFor(info), rights: rightsOf(uid), users: room.usersSnapshot() });
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
        return newPg && room.userPageRight(uid, oldPg.id) === 'edit' ? newPg : oldPg;
      }) };
      // новые страницы разрешаем добавлять только тем, у кого есть хоть одна edit
      for (const newPg of project.pages) {
        if (!merged.pages.some(p => p.id === newPg.id) && room.userCanEditAnything(uid)) merged.pages.push(newPg);
      }
      return merged;
    }
    return uid;
  }

  function pushRights(uid) {
    const c = [...room.clients.values()].find(x => x.uid === uid);
    if (!c) return;
    sendTo(c.sock, { t: 'rights', rights: rightsOf(uid) });
    // состав видимых страниц мог измениться: скрытая страница пропадает у гостя сразу, открытая — появляется
    if (room.project) sendTo(c.sock, { t: 'project', project: { ...room.project, pages: room.visiblePages(uid) }, by: -1 });
  }

  return {
    room,
    attach,
    setRights: (uid, patch) => { const r = room.setRights(uid, patch); broadcastUsers(); pushRights(uid); return r; },
    pushProject: project => { room.project = project; for (const c of room.clients.values()) sendTo(c.sock, { t: 'project', project, by: -1 }); },
    users: () => room.usersSnapshot(),
    closeAll: () => { for (const sock of room.clients.keys()) try { sock.close(); } catch { /* уже закрыт */ } },
  };
}

module.exports = { createRoomHub, Room, PROTO, MAX_EDITORS, MAX_ID, MAX_SELECTION };
