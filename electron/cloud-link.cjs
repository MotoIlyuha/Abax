// Подключение автора к облачному ретранслятору (relay/): гости из интернета попадают в ту же
// комнату (electron/room.cjs), что и гости из локальной сети. Каждый гость ретранслятора —
// «виртуальный» сокет, который передаётся в hub.attach. Протокол ретранслятора — relay/protocol.cjs.
//
// Все сообщения между автором и гостями зашифрованы ключом комнаты (electron/room-crypto.cjs):
// ключ живёт в якоре ссылки и ретранслятору недоступен. Гость после подключения первым
// сообщением присылает зашифрованное { t: 'hello', proto, name, sid }: имя и версию протокола
// комнаты (в локальной сети они в параметрах URL) и идентификатор своего сеанса шифрования.
const { EventEmitter } = require('events');
const WebSocket = require('ws');
const { RELAY_PROTO, CLOSE, encodeFrame, decodeFrame } = require('../relay/protocol.cjs');
const { PROTO } = require('./room.cjs');
const roomCrypto = require('./room-crypto.cjs');

/** Коды, с которыми автор отключает гостя ретранслятора (диапазон 4000–4999 — см. relay/protocol.cjs). */
const KICK = {
  /** Гость не прислал hello вовремя или прислал не то. */
  HELLO_EXPECTED: 4400,
  /** hello не расшифровывается: у гостя другой ключ (испорченная или чужая ссылка). */
  BAD_KEY: 4403,
  /** Версия протокола комнаты у гостя другая — тот же код, что у локального сервера (share.cjs). */
  PROTOCOL_MISMATCH: 4426,
  /** Автор переподключился, а гость ещё не представился — пусть подключится заново. */
  RETRY: 4503,
};

const DEFAULTS = {
  /** Сколько ждать hello от гостя. */
  helloTimeoutMs: 10_000,
  /** Паузы между попытками переподключения; последняя повторяется. */
  backoffMs: [1000, 2000, 4000, 8000, 16000, 30000],
  /** Нет ни сообщений, ни ping от ретранслятора столько времени — соединение считается мёртвым. */
  deadMs: 50_000,
  /** Сколько ждать установления соединения. */
  handshakeTimeoutMs: 10_000,
};

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Адрес ретранслятора из настроек: wss://, а ws:// — только для своей машины (разработка и тесты).
 * Возвращает адрес без завершающего «/», параметров и якоря.
 */
function normalizeRelayUrl(input) {
  let u;
  try { u = new URL(String(input || '').trim()); } catch { throw new Error('Неверный адрес ретранслятора'); }
  if (u.protocol !== 'wss:' && !(u.protocol === 'ws:' && LOCAL_HOSTS.has(u.hostname))) {
    throw new Error('Адрес ретранслятора должен начинаться с wss://');
  }
  if (u.username || u.password) throw new Error('Неверный адрес ретранслятора');
  return `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, '')}`;
}

/**
 * Ссылка для гостя: клиент доски (GitHub Pages) и, в якоре (на серверы не уходит), адрес
 * ретранслятора, комната и ключ шифрования.
 */
function cloudGuestUrl(guestBase, relayUrl, room, key) {
  const base = guestBase.endsWith('/') ? guestBase : guestBase + '/';
  return `${base}#${new URLSearchParams({ relay: relayUrl, r: room, k: key })}`;
}

/** Сокет гостя ретранслятора для hub.attach (контракт RoomSocket из electron/room.cjs). */
class GuestSocket extends EventEmitter {
  constructor(link, conn, sid) {
    super();
    this.link = link;
    this.conn = conn;
    this.readyState = 1;
    /** Сеанс шифрования гостя и счётчики сообщений: от гостя — последний принятый, к гостю — последний отправленный. */
    this.sid = sid;
    this.inSeq = 0;
    this.outSeq = 0;
  }
  send(text) {
    if (this.readyState === 1) this.link.sendData(this, text);
  }
  /** Закрывает комната (например, closeAll): отключить гостя на ретрансляторе. */
  close(code = 4000, reason = '') {
    if (this.readyState !== 1) return;
    this.readyState = 3;
    this.link.kick(this.conn, code, reason);
    this.emit('close');
  }
  /** Гость ушёл сам или пропал вместе с комнатой ретранслятора. */
  gone() {
    if (this.readyState !== 1) return;
    this.readyState = 3;
    this.emit('close');
  }
}

/**
 * @param {{
 *   relayUrl: string,
 *   attach: (sock: GuestSocket, opts: { isHost?: boolean, name?: string }) => number | null,
 *   refresh: (sock: GuestSocket) => boolean,
 *   onChange?: () => void,
 *   WebSocketImpl?: typeof WebSocket,
 * } & Partial<typeof DEFAULTS>} options
 */
function createCloudLink(options) {
  const o = { ...DEFAULTS, WebSocketImpl: WebSocket, onChange: () => {}, ...options };
  const relayUrl = normalizeRelayUrl(o.relayUrl);

  /** @type {WebSocket | null} */
  let ws = null;
  /** @type {string | null} */
  let room = null;
  /** @type {string | null} */
  let token = null;
  /** Ключ комнаты: новый для каждой новой комнаты, при возвращении в ту же — прежний. */
  let key = roomCrypto.newKey();
  /** connecting → online ⇄ reconnecting; stopped; failed (без повторов) */
  let state = 'idle';
  /** @type {string | null} */
  let error = null;
  let attempt = 0;
  let stopped = false;
  let lastSeen = 0;
  /** @type {NodeJS.Timeout | null} */
  let retryTimer = null;
  /** @type {NodeJS.Timeout | null} */
  let deadTimer = null;
  /** Ожидание первого opened в start(). */
  let firstOpen = /** @type {{ resolve: (v: unknown) => void, reject: (e: Error) => void } | null} */ (null);

  /** @type {Map<number, GuestSocket>} */
  const guests = new Map();
  /** Гости, от которых ждём hello: conn → таймер. */
  const pending = new Map();

  const setState = (next, err = null) => {
    state = next;
    error = err;
    o.onChange();
  };

  function sendControl(obj) {
    if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
  }

  const link = {
    /** @param {GuestSocket} sock */
    sendData(sock, text) {
      if (!ws || ws.readyState !== ws.OPEN) return; // переподключаемся — сообщение потеряется, после возвращения будет refresh
      if (sock.outSeq >= roomCrypto.MAX_SEQ) return;
      sock.outSeq++;
      ws.send(encodeFrame(sock.conn, roomCrypto.seal(key, 'h2g', sock.sid, sock.outSeq, text), true));
    },
    kick(conn, code, reason) {
      const c = Number.isInteger(code) && code >= 4000 && code <= 4999 ? code : 4000;
      sendControl({ t: 'kick', conn, code: c, reason: typeof reason === 'string' ? reason : '' });
    },
  };

  function kickPending(conn, code, reason) {
    clearTimeout(pending.get(conn));
    pending.delete(conn);
    link.kick(conn, code, reason);
  }

  function dropGuests() {
    for (const t of pending.values()) clearTimeout(t);
    pending.clear();
    for (const g of guests.values()) g.gone();
    guests.clear();
  }

  function onJoin(conn) {
    if (guests.has(conn) || pending.has(conn)) return;
    pending.set(conn, setTimeout(() => kickPending(conn, KICK.HELLO_EXPECTED, 'hello expected'), o.helloTimeoutMs));
  }

  function onHello(conn, frame) {
    const opened = roomCrypto.open(key, 'hello', roomCrypto.ZERO_SID, frame);
    if (!opened) { kickPending(conn, KICK.BAD_KEY, 'bad key'); return; }
    let m = null;
    try { m = JSON.parse(opened.text); } catch { /* ниже — отказ */ }
    if (!m || typeof m !== 'object' || m.t !== 'hello') { kickPending(conn, KICK.HELLO_EXPECTED, 'hello expected'); return; }
    if (m.proto !== PROTO) { kickPending(conn, KICK.PROTOCOL_MISMATCH, 'protocol mismatch'); return; }
    const sid = roomCrypto.parseSid(m.sid);
    // тот же сеанс уже в комнате — это повтор чужого hello, а не новый гость
    if (!sid || [...guests.values()].some(g => g.sid.equals(sid))) { kickPending(conn, KICK.HELLO_EXPECTED, 'hello expected'); return; }
    clearTimeout(pending.get(conn));
    pending.delete(conn);
    const sock = new GuestSocket(link, conn, sid);
    guests.set(conn, sock);
    sock.once('close', () => { if (guests.get(conn) === sock) guests.delete(conn); });
    o.attach(sock, { isHost: false, name: typeof m.name === 'string' ? m.name : '' });
  }

  function onData(data) {
    const f = decodeFrame(data);
    if (!f || !f.isBinary) return; // без шифрования гость ничего не присылает
    const sock = guests.get(f.conn);
    if (sock) {
      const opened = roomCrypto.open(key, 'g2h', sock.sid, f.payload);
      // не расшифровалось или повтор (seq не вырос) — отбрасываем: подделка или повтор ретранслятором
      if (!opened || opened.seq <= sock.inSeq) return;
      sock.inSeq = opened.seq;
      sock.emit('message', opened.text);
      return;
    }
    if (pending.has(f.conn)) onHello(f.conn, f.payload);
  }

  /** Возвращение в комнату: кто остался — получает полное состояние заново, кто ушёл — отключается. */
  function reconcile(present) {
    const keep = new Set(present);
    for (const [conn, sock] of guests) if (!keep.has(conn)) sock.gone();
    for (const [conn, t] of pending) if (!keep.has(conn)) { clearTimeout(t); pending.delete(conn); }
    for (const conn of keep) {
      const sock = guests.get(conn);
      if (sock) o.refresh(sock);
      // hello мог потеряться, пока нас не было
      else kickPending(conn, KICK.RETRY, 'host reconnected');
    }
  }

  function onControl(text) {
    let m;
    try { m = JSON.parse(text); } catch { return; }
    if (!m || typeof m !== 'object') return;
    if (m.t === 'opened') {
      if (m.resumed && m.room === room) {
        reconcile(Array.isArray(m.guests) ? m.guests : []);
      } else {
        dropGuests(); // новая комната — прежние гости остались в старой
        room = m.room;
      }
      token = m.token;
      attempt = 0;
      setState('online');
      if (firstOpen) { firstOpen.resolve(undefined); firstOpen = null; }
    } else if (m.t === 'join' && Number.isInteger(m.conn)) {
      onJoin(m.conn);
    } else if (m.t === 'leave' && Number.isInteger(m.conn)) {
      const sock = guests.get(m.conn);
      if (sock) { guests.delete(m.conn); sock.gone(); }
      if (pending.has(m.conn)) { clearTimeout(pending.get(m.conn)); pending.delete(m.conn); }
    }
  }

  function connect() {
    const sock = new o.WebSocketImpl(`${relayUrl}/host`, { handshakeTimeout: o.handshakeTimeoutMs });
    ws = sock;
    const touch = () => { lastSeen = Date.now(); };
    sock.on('open', () => {
      touch();
      sock.send(JSON.stringify(room && token ? { t: 'open', proto: RELAY_PROTO, room, token } : { t: 'open', proto: RELAY_PROTO }));
    });
    sock.on('ping', touch);
    sock.on('message', (data, isBinary) => {
      if (ws !== sock) return;
      touch();
      if (isBinary) onData(/** @type {Buffer} */ (data));
      else onControl(String(data));
    });
    sock.on('error', () => { /* за ним придёт close */ });
    sock.on('close', (code, reason) => {
      if (ws !== sock) return;
      ws = null;
      onClosed(code, String(reason || ''));
    });
  }

  function fail(message) {
    dropGuests();
    room = null;
    token = null;
    stopTimers();
    setState('failed', message);
    if (firstOpen) { firstOpen.reject(new Error(message)); firstOpen = null; }
  }

  function onClosed(code) {
    if (stopped) return;
    if (firstOpen) {
      // первое подключение не удалось — сообщаем сразу, без фоновых повторов
      fail(code === CLOSE.PROTOCOL_MISMATCH ? 'Ретранслятор несовместим с этой версией Abax'
        : code === CLOSE.RATE_LIMITED || code === CLOSE.SERVER_FULL ? 'Ретранслятор перегружен, попробуйте позже'
          : 'Не удалось подключиться к ретранслятору');
      return;
    }
    if (code === CLOSE.PROTOCOL_MISMATCH) { fail('Ретранслятор несовместим с этой версией Abax'); return; }
    if (code === CLOSE.REPLACED) { fail('Комнату перехватило другое подключение'); return; }
    if (code === CLOSE.BAD_REQUEST) { fail('Ретранслятор отклонил подключение'); return; }
    if (code === CLOSE.ROOM_NOT_FOUND || code === CLOSE.BAD_TOKEN || code === CLOSE.ROOM_CLOSED) {
      // комната пропала (ретранслятор перезапускался или мы не успели вернуться) — откроем новую,
      // с новым ключом: ключ живёт столько же, сколько комната
      dropGuests();
      room = null;
      token = null;
      key = roomCrypto.newKey();
      attempt = 0;
    }
    scheduleReconnect();
  }

  function scheduleReconnect() {
    const base = o.backoffMs[Math.min(attempt, o.backoffMs.length - 1)];
    attempt++;
    // разброс ±20%, чтобы после сбоя ретранслятора авторы не переподключались все разом
    const delay = Math.round(base * (0.8 + Math.random() * 0.4));
    setState('reconnecting');
    retryTimer = setTimeout(() => { retryTimer = null; if (!stopped) connect(); }, delay);
  }

  function stopTimers() {
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
    if (deadTimer) { clearInterval(deadTimer); deadTimer = null; }
  }

  return {
    /** Открыть комнату. Промис выполняется, когда ретранслятор ответил opened, и отклоняется, если не удалось. */
    start() {
      if (state !== 'idle') return Promise.reject(new Error('Уже запущено'));
      setState('connecting');
      deadTimer = setInterval(() => {
        if (ws && ws.readyState === ws.OPEN && Date.now() - lastSeen > o.deadMs) ws.terminate();
      }, Math.max(10, Math.floor(o.deadMs / 3)));
      deadTimer.unref?.();
      const p = new Promise((resolve, reject) => { firstOpen = { resolve, reject }; });
      connect();
      return p;
    },
    /** Закрыть комнату: гости получат 4410, ссылка перестанет работать. */
    stop() {
      if (stopped) return;
      stopped = true;
      stopTimers();
      const sock = ws;
      ws = null;
      if (sock && sock.readyState === sock.OPEN) {
        sock.send(JSON.stringify({ t: 'close' }));
        sock.close(1000, 'room closed');
      } else if (sock) {
        sock.terminate();
      }
      dropGuests();
      if (firstOpen) { firstOpen.reject(new Error('Остановлено')); firstOpen = null; }
      setState('stopped');
    },
    /** key — ключ комнаты в base64url для ссылки гостя; только для автора. */
    status() {
      return { state, room, error, guests: guests.size, relayUrl, key: key.toString('base64url') };
    },
  };
}

module.exports = { createCloudLink, normalizeRelayUrl, cloudGuestUrl, KICK, DEFAULTS };
