// Подключение автора к облачному ретранслятору (relay/): гости из интернета попадают в ту же
// комнату (electron/room.cjs), что и гости из локальной сети. Каждый гость ретранслятора —
// «виртуальный» сокет, который передаётся в hub.attach. Протокол ретранслятора — relay/protocol.cjs.
//
// Гость после подключения первым сообщением присылает { t: 'hello', proto, name }: имя и версию
// протокола комнаты, которые в локальной сети приходят в параметрах URL.
const { EventEmitter } = require('events');
const WebSocket = require('ws');
const { RELAY_PROTO, CLOSE, encodeFrame, decodeFrame } = require('../relay/protocol.cjs');
const { PROTO } = require('./room.cjs');

/** Коды, с которыми автор отключает гостя ретранслятора (диапазон 4000–4999 — см. relay/protocol.cjs). */
const KICK = {
  /** Гость не прислал hello вовремя или прислал не то. */
  HELLO_EXPECTED: 4400,
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

/** Без шифрования: текст гостя — как есть. Этап шифрования подставит сюда AES-GCM. */
const plainCodec = {
  /** @returns {string | null} текст сообщения или null, если его не удалось прочитать */
  decode: (payload, isBinary) => (isBinary ? null : payload.toString('utf8')),
  encode: text => ({ payload: text, isBinary: false }),
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
 * ретранслятора и комната.
 */
function cloudGuestUrl(guestBase, relayUrl, room) {
  const base = guestBase.endsWith('/') ? guestBase : guestBase + '/';
  return `${base}#${new URLSearchParams({ relay: relayUrl, r: room })}`;
}

/** Сокет гостя ретранслятора для hub.attach (контракт RoomSocket из electron/room.cjs). */
class GuestSocket extends EventEmitter {
  constructor(link, conn) {
    super();
    this.link = link;
    this.conn = conn;
    this.readyState = 1;
  }
  send(text) {
    if (this.readyState === 1) this.link.sendData(this.conn, text);
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
 *   codec?: typeof plainCodec,
 *   WebSocketImpl?: typeof WebSocket,
 * } & Partial<typeof DEFAULTS>} options
 */
function createCloudLink(options) {
  const o = { ...DEFAULTS, codec: plainCodec, WebSocketImpl: WebSocket, onChange: () => {}, ...options };
  const relayUrl = normalizeRelayUrl(o.relayUrl);

  /** @type {WebSocket | null} */
  let ws = null;
  /** @type {string | null} */
  let room = null;
  /** @type {string | null} */
  let token = null;
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
    sendData(conn, text) {
      if (!ws || ws.readyState !== ws.OPEN) return; // переподключаемся — сообщение потеряется, после возвращения будет refresh
      const { payload, isBinary } = o.codec.encode(text);
      ws.send(encodeFrame(conn, payload, isBinary));
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

  function onHello(conn, text) {
    let m = null;
    try { m = JSON.parse(text); } catch { /* ниже — отказ */ }
    if (!m || typeof m !== 'object' || m.t !== 'hello') { kickPending(conn, KICK.HELLO_EXPECTED, 'hello expected'); return; }
    if (m.proto !== PROTO) { kickPending(conn, KICK.PROTOCOL_MISMATCH, 'protocol mismatch'); return; }
    clearTimeout(pending.get(conn));
    pending.delete(conn);
    const sock = new GuestSocket(link, conn);
    guests.set(conn, sock);
    sock.once('close', () => { if (guests.get(conn) === sock) guests.delete(conn); });
    o.attach(sock, { isHost: false, name: typeof m.name === 'string' ? m.name : '' });
  }

  function onData(data) {
    const f = decodeFrame(data);
    if (!f) return;
    const text = o.codec.decode(f.payload, f.isBinary);
    if (text === null) return; // не прочитали (на этапе шифрования — чужой ключ); гость пропустит сообщение
    const sock = guests.get(f.conn);
    if (sock) { sock.emit('message', text); return; }
    if (pending.has(f.conn)) onHello(f.conn, text);
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
      // комната пропала (ретранслятор перезапускался или мы не успели вернуться) — откроем новую
      dropGuests();
      room = null;
      token = null;
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
    status() {
      return { state, room, error, guests: guests.size, relayUrl };
    },
  };
}

module.exports = { createCloudLink, normalizeRelayUrl, cloudGuestUrl, plainCodec, KICK, DEFAULTS };
