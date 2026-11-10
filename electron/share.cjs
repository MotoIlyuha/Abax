// Сервер совместной работы: HTTP (раздача клиента доски) + WebSocket (синхронизация).
// Логика комнаты (участники, права, склейка) — в room.cjs; здесь только сеть.
// Не зависит от Electron — используется и приложением, и standalone-тестом.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const { createRoomHub, PROTO, MAX_EDITORS } = require('./room.cjs');

/**
 * Максимальный размер одного сообщения. Совпадает с прежним значением по умолчанию у ws (100 МиБ):
 * проект уходит целиком, вместе с картинками в base64, и меньший предел оборвал бы большие доски.
 */
const MAX_MESSAGE = 100 * 1024 * 1024;

let distDir = path.join(__dirname, '..', 'dist');

// Секрет автора: только у него, в гостевую ссылку не попадает.
function newHostKey() { return crypto.randomBytes(24).toString('base64url'); }

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function createShareServer({ port, code, hostKey = newHostKey(), openEdit = process.env.DOSKA_OPEN_EDIT === '1' }) {
  const hub = createRoomHub({ code, openEdit });
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

  const wss = new WebSocketServer({ server, maxPayload: MAX_MESSAGE });
  // ws пересылает сюда ошибки http-сервера (например, EADDRINUSE); их обрабатывает промис ниже
  wss.on('error', () => {});
  wss.on('connection', (ws, req) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname !== '/ws') { ws.close(); return; }
    if (!safeEqual(u.searchParams.get('code'), code)) { ws.close(4403, 'bad room code'); return; }
    // клиент другой версии протокола: без параметра — старый клиент той же сборки, пускаем
    const proto = u.searchParams.get('proto');
    if (proto !== null && proto !== String(PROTO)) { ws.close(4426, 'protocol mismatch'); return; }
    const isHost = u.searchParams.get('host') === '1';
    if (isHost && !safeEqual(u.searchParams.get('key'), hostKey)) { ws.close(4401, 'bad host key'); return; }
    hub.attach(ws, { isHost, name: decodeURIComponent(u.searchParams.get('name') || '') });
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, () => resolve({
      port: server.address().port, code, hostKey, room: hub.room,
      setDistDir(d) { distDir = d; },
      /** Подключить участника от другого транспорта (облачный ретранслятор); доступ проверяет вызывающий. */
      attach: hub.attach,
      setRights: hub.setRights,
      pushProject: hub.pushProject,
      users: hub.users,
      close: () => { hub.closeAll(); wss.close(); server.close(); },
    }));
  });
}

module.exports = { createShareServer, MAX_EDITORS, MAX_MESSAGE, PROTO };
