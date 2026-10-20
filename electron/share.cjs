// Сервер совместной работы: HTTP (раздача клиента доски) + WebSocket (синхронизация).
// Не зависит от Electron — используется и приложением, и standalone-тестом.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const COLORS = ['#e8590c', '#1971c2', '#2f9e44', '#9c36b5', '#0c8599', '#f08c00'];
const MAX_EDITORS = 4;
const AWAY_MS = Number(process.env.DOSKA_AWAY_MS || 45000);

let distDir = path.join(__dirname, '..', 'dist');

class Room {
  constructor(code) {
    this.code = code;
    this.project = null; // последний известный проект
    this.clients = new Map(); // ws -> info
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

function createShareServer({ port, code, openEdit = process.env.DOSKA_OPEN_EDIT === '1' }) {
  const room = new Room(code);
  const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };

  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    let p = u.pathname === '/' ? '/index.html' : u.pathname;
    const file = path.join(distDir, p.replace(/^\//, ''));
    if (!file.startsWith(distDir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404); res.end('not found'); return;
    }
    res.writeHead(200, { 'content-type': mime[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });

  const wss = new WebSocketServer({ server });
  // ws пересылает сюда ошибки http-сервера (например, EADDRINUSE); их обрабатывает промис ниже
  wss.on('error', () => {});
  wss.on('connection', (ws, req) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname !== '/ws') { ws.close(); return; }
    const isHost = u.searchParams.get('host') === '1';
    const uid = isHost ? 0 : room.nextUid++;
    const info = {
      ws, uid, host: isHost,
      name: decodeURIComponent(u.searchParams.get('name') || '') || (isHost ? 'Автор' : `Гость ${uid}`),
      color: isHost ? '#e03131' : COLORS[uid % COLORS.length],
      last: Date.now(), cursor: null, pageId: null, selection: [],
    };
    room.clients.set(ws, info);
    if (isHost) room.rights.set(0, { default: 'edit', pages: {} });
    else room.rights.set(uid, { default: openEdit ? 'edit' : 'view', pages: {} });

    const rightsOf = () => { const r = room.rights.get(uid); const pages = {}; if (room.project) for (const pg of room.project.pages) pages[pg.id] = room.userPageRight(uid, pg.id); return { default: r?.default || 'view', pages }; };
    const projectFor = () => isHost ? room.project : (room.project ? { ...room.project, pages: room.visiblePages(uid) } : null);
    ws.send(JSON.stringify({ t: 'init', userId: uid, color: info.color, name: info.name, project: projectFor(), rights: rightsOf(), users: room.usersSnapshot() }));
    broadcastUsers(); // остальные сразу видят нового участника

    ws.on('message', (raw) => {
      info.last = Date.now();
      let m; try { m = JSON.parse(raw); } catch { return; }
      if (m.t === 'cursor') { info.cursor = { x: m.x, y: m.y }; info.pageId = m.pageId ?? info.pageId; broadcastUsers(); return; }
      if (m.t === 'selection') { info.selection = m.ids || []; info.pageId = m.pageId ?? info.pageId; broadcastUsers(); return; }
      if (m.t === 'project' && m.project && Array.isArray(m.project.pages)) {
        // серверный enforcement: чужие view-страницы не применяем
        if (!room.project) { room.project = m.project; }
        else {
          const merged = { ...m.project, pages: room.project.pages.map(oldPg => {
            const newPg = m.project.pages.find(p => p.id === oldPg.id);
            return newPg && room.userPageRight(uid, oldPg.id) === 'edit' ? newPg : oldPg;
          }) };
          // новые страницы разрешаем добавлять только тем, у кого есть хоть одна edit
          for (const newPg of m.project.pages) {
            if (!merged.pages.some(p => p.id === newPg.id) && room.userCanEditAnything(uid)) merged.pages.push(newPg);
          }
          room.project = merged;
        }
        for (const c of room.clients.values()) {
          if (c.ws !== ws) {
            const proj = c.host ? room.project : (room.project ? { ...room.project, pages: room.visiblePages(c.uid) } : null);
            c.ws.send(JSON.stringify({ t: 'project', project: proj, by: uid }));
          }
        }
        return;
      }
    });
    ws.on('close', () => { room.clients.delete(ws); broadcastUsers(); });
  });

  function broadcastUsers() {
    const users = JSON.stringify({ t: 'users', users: room.usersSnapshot() });
    for (const c of room.clients.values()) { if (c.ws.readyState === 1) c.ws.send(users); }
  }

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, () => resolve({
      port: server.address().port, code, room,
      setDistDir(d) { distDir = d; },
      setRights: (uid, patch) => { const r = room.setRights(uid, patch); broadcastUsers(); pushRights(uid); return r; },
      pushProject: (project) => { room.project = project; for (const c of room.clients.values()) try { c.ws.send(JSON.stringify({ t: 'project', project, by: -1 })); } catch {} },
      users: () => room.usersSnapshot(),
      close: () => { for (const c of room.clients.keys()) c.close(); wss.close(); server.close(); },
    }));
    function pushRights(uid) {
      const c = [...room.clients.values()].find(x => x.uid === uid);
      if (!c) return;
      const r = room.rights.get(uid);
      const pages = {}; if (room.project) for (const pg of room.project.pages) pages[pg.id] = room.userPageRight(uid, pg.id);
      try { c.ws.send(JSON.stringify({ t: 'rights', rights: { default: r?.default || 'view', pages } })); } catch {}
      // состав видимых страниц мог измениться: скрытая страница пропадает у гостя сразу, открытая — появляется
      if (room.project) {
        try { c.ws.send(JSON.stringify({ t: 'project', project: { ...room.project, pages: room.visiblePages(uid) }, by: -1 })); } catch {}
      }
    }
  });
}

module.exports = { createShareServer, MAX_EDITORS };
