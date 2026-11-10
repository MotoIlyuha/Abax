// Облачный ретранслятор совместной работы: пересылает сообщения между автором и гостями.
// Логика комнаты (права, склейка проекта) живёт у автора; здесь — только маршрутизация,
// лимиты и ожидание автора после обрыва. Содержимое сообщений не разбирается и не хранится.
// Протокол описан в protocol.cjs.
const http = require('http');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const { RELAY_PROTO, CLOSE, ROOM_ID_RE, HEADER, encodeFrame, decodeFrame } = require('./protocol.cjs');

const MiB = 1024 * 1024;

const DEFAULTS = {
  port: 8080,
  host: '0.0.0.0',
  /**
   * Предел одного сообщения. Пока проект уходит целиком вместе с картинками в base64,
   * меньший предел оборвал бы большие доски; после перехода на изменения его можно снизить.
   */
  maxMessage: 32 * MiB,
  /** Гостей в одной комнате. */
  maxGuests: 30,
  /** Комнат на ретрансляторе. */
  maxRooms: 1000,
  /** Сколько комната ждёт автора после обрыва. */
  hostGraceMs: 60_000,
  /** Сколько ждать первого сообщения автора. */
  openTimeoutMs: 10_000,
  /** Период проверки живости соединений (ping/pong). */
  pingMs: 20_000,
  /** Сколько данных может скопиться в очереди на отправку одному участнику. */
  maxBuffer: 64 * MiB,
  /** Сколько ждать закрытия соединения, прежде чем оборвать его (клиент не забирает данные). */
  closeTimeoutMs: 5000,
  /** Брать адрес клиента из X-Forwarded-For (только за своим обратным прокси). */
  trustProxy: false,
  /** Разрешённые Origin для гостей; пусто — любые. */
  allowedOrigins: /** @type {string[]} */ ([]),
  /** Новых комнат в минуту с одного адреса. */
  roomsPerMinute: 10,
  /** Подключений гостей в минуту с одного адреса. */
  joinsPerMinute: 60,
  /** Одновременных соединений с одного адреса (класс за одним NAT — до нескольких десятков). */
  maxConnPerIp: 200,
  /** Сообщений в секунду от одного гостя (курсор — 25/с); лишние отбрасываются. */
  guestMsgsPerSec: 100,
  /** Период записи статистики в журнал; 0 — не писать. */
  statsIntervalMs: 5 * 60_000,
  /** Журнал: только счётчики и события без идентификаторов и содержимого. */
  log: /** @type {(msg: string) => void} */ (msg => console.log(`${new Date().toISOString()} ${msg}`)),
};

/** Ведро токенов: capacity — запас, refillPerMs — пополнение. */
class Bucket {
  constructor(capacity, refillPerMs) {
    this.capacity = capacity;
    this.tokens = capacity;
    this.rate = refillPerMs;
    this.at = Date.now();
  }
  refill() {
    const now = Date.now();
    this.tokens = Math.min(this.capacity, this.tokens + (now - this.at) * this.rate);
    this.at = now;
  }
  take() {
    this.refill();
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
  full() {
    this.refill();
    return this.tokens >= this.capacity;
  }
}

/** Ключ адреса для лимитов: IPv4 целиком, IPv6 — по сети /64 (у одного абонента их много). */
function ipKey(ip) {
  let s = String(ip || '').trim();
  if (s.startsWith('::ffff:') && s.includes('.')) s = s.slice(7);
  if (!s.includes(':')) return s;
  s = s.split('%')[0].toLowerCase();
  const [head, tail] = s.split('::');
  const a = head ? head.split(':') : [];
  const b = tail !== undefined && tail ? tail.split(':') : [];
  const groups = tail === undefined ? a : [...a, ...Array(Math.max(0, 8 - a.length - b.length)).fill('0'), ...b];
  return groups.slice(0, 4).map(g => g.replace(/^0+(?=.)/, '')).join(':') + '::/64';
}

function clientIp(req, trustProxy) {
  if (trustProxy) {
    const xff = req.headers['x-forwarded-for'];
    // крайний правый адрес дописал наш прокси; левые мог подставить сам клиент
    const last = typeof xff === 'string' ? xff.split(',').pop().trim() : '';
    if (last) return last;
  }
  return req.socket.remoteAddress || '';
}

const sha256 = s => crypto.createHash('sha256').update(String(s)).digest();
const newRoomId = () => crypto.randomBytes(16).toString('base64url');
const newToken = () => crypto.randomBytes(32).toString('base64url');

/** Причина закрытия WebSocket — не длиннее 123 байт. */
function safeReason(r) {
  return typeof r === 'string' && Buffer.byteLength(r) <= 123 ? r : '';
}

function rejectUpgrade(socket, status, text) {
  try {
    socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  } catch { /* соединение уже оборвано */ }
  socket.destroy();
}

/**
 * Запустить ретранслятор.
 * @param {Partial<typeof DEFAULTS>} [options]
 */
function createRelay(options = {}) {
  const o = { ...DEFAULTS, ...options };
  /** @type {Map<string, Room>} */
  const rooms = new Map();
  /** Состояние по адресам: соединения и вёдра лимитов. */
  const ips = new Map();
  /** Живость соединений для ping/pong. */
  const alive = new Map();

  /**
   * @typedef {{ id: string, tokenHash: Buffer, host: import('ws').WebSocket | null, hostAway: boolean,
   *   guests: Map<number, import('ws').WebSocket>, nextConn: number, graceTimer: NodeJS.Timeout | null, closed: boolean }} Room
   */

  function ipEntry(key) {
    let e = ips.get(key);
    if (!e) {
      e = {
        conns: 0,
        rooms: new Bucket(o.roomsPerMinute, o.roomsPerMinute / 60_000),
        joins: new Bucket(o.joinsPerMinute, o.joinsPerMinute / 60_000),
      };
      ips.set(key, e);
    }
    return e;
  }

  /** Закрыть соединение; если очередь не уходит (медленный клиент), через closeTimeoutMs оборвать. */
  function closeHard(ws, code, reason) {
    try { ws.close(code, reason); } catch { /* уже закрыто */ }
    setTimeout(() => { if (ws.readyState !== ws.CLOSED) ws.terminate(); }, o.closeTimeoutMs).unref();
  }

  /** Отправить с контролем очереди: участник, который не успевает принимать, отключается. */
  function deliver(ws, data, isBinary) {
    if (!ws || ws.readyState !== ws.OPEN) return;
    if (ws.bufferedAmount > o.maxBuffer) { closeHard(ws, CLOSE.TOO_SLOW, 'too slow'); return; }
    ws.send(data, { binary: isBinary });
  }
  const control = (ws, obj) => deliver(ws, JSON.stringify(obj), false);

  function closeRoom(room, code, reason) {
    if (room.closed) return;
    room.closed = true;
    if (room.graceTimer) clearTimeout(room.graceTimer);
    rooms.delete(room.id);
    for (const g of room.guests.values()) closeHard(g, code, reason);
    room.guests.clear();
    const host = room.host;
    room.host = null;
    if (host) closeHard(host, code, reason);
  }

  function hostLeft(room, intentional) {
    room.host = null;
    if (intentional) { closeRoom(room, CLOSE.ROOM_CLOSED, 'room closed'); return; }
    room.hostAway = true;
    for (const g of room.guests.values()) control(g, { t: 'relay', event: 'host-away' });
    room.graceTimer = setTimeout(() => closeRoom(room, CLOSE.ROOM_CLOSED, 'host did not return'), o.hostGraceMs);
  }

  // ----- автор -----

  function onHost(ws, ip) {
    /** @type {Room | null} */
    let room = null;
    const openTimer = setTimeout(() => closeHard(ws, CLOSE.BAD_REQUEST, 'open expected'), o.openTimeoutMs);

    ws.on('message', (data, isBinary) => {
      if (!room) { open(data, isBinary); return; }
      if (room.host !== ws) return; // соединение уже заменено новым
      if (isBinary) {
        const f = decodeFrame(/** @type {Buffer} */ (data));
        if (!f) return;
        const guest = room.guests.get(f.conn);
        if (guest) deliver(guest, f.isBinary ? f.payload : f.payload.toString('utf8'), f.isBinary);
        return;
      }
      let m; try { m = JSON.parse(String(data)); } catch { return; }
      if (!m || typeof m !== 'object') return;
      if (m.t === 'kick') {
        const guest = room.guests.get(m.conn);
        const code = Number.isInteger(m.code) && m.code >= 4000 && m.code <= 4999 ? m.code : 4000;
        if (guest) closeHard(guest, code, safeReason(m.reason));
      } else if (m.t === 'close') {
        const r = room;
        room.host = null;
        closeRoom(r, CLOSE.ROOM_CLOSED, 'room closed');
        closeHard(ws, 1000, 'room closed');
      }
      // прочие сообщения — из будущих версий протокола, пропускаем
    });

    ws.on('close', code => {
      clearTimeout(openTimer);
      if (room && room.host === ws) hostLeft(room, code === 1000);
    });

    function open(data, isBinary) {
      let m = null;
      if (!isBinary) { try { m = JSON.parse(String(data)); } catch { /* ниже — отказ */ } }
      if (!m || typeof m !== 'object' || m.t !== 'open') { closeHard(ws, CLOSE.BAD_REQUEST, 'open expected'); return; }
      if (m.proto !== RELAY_PROTO) { closeHard(ws, CLOSE.PROTOCOL_MISMATCH, 'protocol mismatch'); return; }
      clearTimeout(openTimer);

      if (m.room !== undefined) {
        // возвращение в свою комнату после обрыва
        const r = typeof m.room === 'string' && ROOM_ID_RE.test(m.room) ? rooms.get(m.room) : undefined;
        if (!r) { closeHard(ws, CLOSE.ROOM_NOT_FOUND, 'room not found'); return; }
        if (typeof m.token !== 'string' || !crypto.timingSafeEqual(sha256(m.token), r.tokenHash)) {
          closeHard(ws, CLOSE.BAD_TOKEN, 'bad token'); return;
        }
        const old = r.host;
        r.host = ws;
        if (old) closeHard(old, CLOSE.REPLACED, 'replaced');
        if (r.graceTimer) { clearTimeout(r.graceTimer); r.graceTimer = null; }
        room = r;
        control(ws, { t: 'opened', room: r.id, token: m.token, resumed: true, guests: [...r.guests.keys()] });
        if (r.hostAway) {
          r.hostAway = false;
          for (const g of r.guests.values()) control(g, { t: 'relay', event: 'host-back' });
        }
        return;
      }

      if (!ipEntry(ip).rooms.take()) { closeHard(ws, CLOSE.RATE_LIMITED, 'too many rooms'); return; }
      if (rooms.size >= o.maxRooms) { closeHard(ws, CLOSE.SERVER_FULL, 'server full'); return; }
      let id = newRoomId();
      while (rooms.has(id)) id = newRoomId();
      const token = newToken();
      room = { id, tokenHash: sha256(token), host: ws, hostAway: false, guests: new Map(), nextConn: 1, graceTimer: null, closed: false };
      rooms.set(id, room);
      control(ws, { t: 'opened', room: id, token, resumed: false, guests: [] });
    }
  }

  // ----- гость -----

  function onGuest(ws, roomId, ip) {
    if (!ipEntry(ip).joins.take()) { closeHard(ws, CLOSE.RATE_LIMITED, 'too many joins'); return; }
    const room = ROOM_ID_RE.test(roomId) ? rooms.get(roomId) : undefined;
    if (!room) { closeHard(ws, CLOSE.ROOM_NOT_FOUND, 'room not found'); return; }
    if (!room.host) { closeHard(ws, CLOSE.HOST_OFFLINE, 'host offline'); return; }
    if (room.guests.size >= o.maxGuests) { closeHard(ws, CLOSE.ROOM_FULL, 'room full'); return; }
    const conn = room.nextConn++;
    room.guests.set(conn, ws);
    const flood = new Bucket(o.guestMsgsPerSec * 2, o.guestMsgsPerSec / 1000);
    control(room.host, { t: 'join', conn });

    ws.on('message', (data, isBinary) => {
      if (!flood.take()) return; // поток сверх лимита отбрасываем
      if (!room.host) return; // автор переподключается — сообщения не копим
      deliver(room.host, encodeFrame(conn, /** @type {Buffer} */ (data), isBinary), true);
    });
    ws.on('close', () => {
      if (room.guests.get(conn) !== ws) return;
      room.guests.delete(conn);
      if (room.host) control(room.host, { t: 'leave', conn });
    });
  }

  // ----- HTTP и подключения -----

  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('ok');
      return;
    }
    res.writeHead(404);
    res.end();
  });
  const hostWss = new WebSocketServer({ noServer: true, maxPayload: o.maxMessage + HEADER });
  const guestWss = new WebSocketServer({ noServer: true, maxPayload: o.maxMessage });

  server.on('upgrade', (req, socket, head) => {
    socket.on('error', () => { /* клиент оборвал соединение */ });
    let path;
    try { path = new URL(req.url || '/', 'http://x').pathname; } catch { rejectUpgrade(socket, 400, 'Bad Request'); return; }
    const guestMatch = /^\/g\/([^/]+)$/.exec(path);
    if (path !== '/host' && !guestMatch) { rejectUpgrade(socket, 404, 'Not Found'); return; }
    if (guestMatch && o.allowedOrigins.length > 0 && !o.allowedOrigins.includes(String(req.headers.origin || ''))) {
      rejectUpgrade(socket, 403, 'Forbidden'); return;
    }
    const key = ipKey(clientIp(req, o.trustProxy));
    const wss = guestMatch ? guestWss : hostWss;
    wss.handleUpgrade(req, socket, head, ws => {
      const entry = ipEntry(key);
      if (entry.conns >= o.maxConnPerIp) { closeHard(ws, CLOSE.RATE_LIMITED, 'too many connections'); return; }
      entry.conns++;
      alive.set(ws, true);
      ws.on('pong', () => alive.set(ws, true));
      ws.on('error', () => { /* за ним придёт close */ });
      ws.on('close', () => { entry.conns--; alive.delete(ws); });
      if (guestMatch) onGuest(ws, guestMatch[1], key);
      else onHost(ws, key);
    });
  });

  const pingTimer = setInterval(() => {
    for (const [ws, ok] of alive) {
      if (!ok) { ws.terminate(); continue; }
      alive.set(ws, false);
      try { ws.ping(); } catch { /* закрывается */ }
    }
  }, o.pingMs);
  pingTimer.unref();

  // адреса без соединений и с полными вёдрами больше не нужны
  const sweepTimer = setInterval(() => {
    for (const [k, e] of ips) if (e.conns === 0 && e.rooms.full() && e.joins.full()) ips.delete(k);
  }, 60_000);
  sweepTimer.unref();

  const stats = () => {
    let guests = 0;
    let away = 0;
    for (const r of rooms.values()) { guests += r.guests.size; if (r.hostAway) away++; }
    return { rooms: rooms.size, guests, hostsAway: away };
  };
  let lastStats = '';
  const statsTimer = o.statsIntervalMs > 0 ? setInterval(() => {
    const s = stats();
    const line = `rooms=${s.rooms} guests=${s.guests} hostsAway=${s.hostsAway}`;
    if (line !== lastStats) { o.log(line); lastStats = line; }
  }, o.statsIntervalMs) : null;
  statsTimer?.unref();

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(o.port, o.host, () => {
      server.off('error', reject);
      const port = /** @type {import('net').AddressInfo} */ (server.address()).port;
      resolve({
        port,
        stats,
        /** Закрыть всё: участники получают 1001 (going away), комнаты теряются. */
        close: () => new Promise(done => {
          clearInterval(pingTimer);
          clearInterval(sweepTimer);
          if (statsTimer) clearInterval(statsTimer);
          for (const r of [...rooms.values()]) closeRoom(r, 1001, 'relay shutting down');
          for (const ws of alive.keys()) ws.terminate();
          hostWss.close();
          guestWss.close();
          server.close(() => done(undefined));
          server.closeAllConnections?.();
        }),
      });
    });
  });
}

module.exports = { createRelay, DEFAULTS, ipKey, Bucket };
