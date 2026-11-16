import type { AttachOptions, RoomSocket } from './room-host';
import { CLOSE_PROTOCOL_MISMATCH, PROTO } from './collab-transport';
import {
  MAX_SEQ, SID_BYTES, ZERO_SID, base64urlToBytes, bytesToBase64url, importRoomKey, open, randomBytes, seal, KEY_BYTES,
} from './room-crypto';

// Автор в браузере через облачный ретранслятор: порт electron/cloud-link.cjs на WebSocket и WebCrypto.
// Каждый гость ретранслятора — «виртуальный» сокет, который передаётся хабу комнаты (room-host.ts).
// Все сообщения шифруются ключом комнаты из ссылки гостя; ретранслятор видит только шифротекст.
// Протокол ретранслятора — relay/protocol.cjs.

/** Версия протокола ретранслятора (не путать с PROTO комнаты). */
export const RELAY_PROTO = 1;
const HEADER = 5;
const FLAG_BINARY = 1;

/** Коды закрытия соединения автора с ретранслятором (relay/protocol.cjs). */
const CLOSE = {
  BAD_REQUEST: 4400, BAD_TOKEN: 4401, ROOM_NOT_FOUND: 4404, REPLACED: 4409, ROOM_CLOSED: 4410,
  PROTOCOL_MISMATCH: 4426, RATE_LIMITED: 4429, SERVER_FULL: 4431,
};
/** Коды, с которыми автор отключает гостя. */
export const KICK = { HELLO_EXPECTED: 4400, BAD_KEY: 4403, PROTOCOL_MISMATCH: CLOSE_PROTOCOL_MISMATCH, RETRY: 4503 };

export type RelayState = 'idle' | 'connecting' | 'online' | 'reconnecting' | 'failed' | 'stopped';
export interface RelayStatus { state: RelayState; room: string | null; error: string | null; guests: number; relayUrl: string; key: string }

export interface RelayHostOptions {
  relayUrl: string;
  attach(sock: RoomSocket, opts: AttachOptions): number | null;
  refresh(sock: RoomSocket): boolean;
  onChange?: () => void;
  WebSocketImpl?: typeof WebSocket;
  /** Сколько ждать hello от гостя. */
  helloTimeoutMs?: number;
  /** Паузы между попытками переподключения; последняя повторяется. */
  backoffMs?: number[];
  /** Как часто слать ping ретранслятору (держит соединение за прокси и находит полуоткрытое). */
  pingMs?: number;
}

/** Через сколько пингов без ответа соединение считается мёртвым (если ретранслятор отвечать умеет). */
const MAX_MISSED_PONGS = 2;

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** Адрес ретранслятора из настроек: wss://, а ws:// — только для своей машины. Без «/» в конце, параметров и якоря. */
export function normalizeRelayUrl(input: string): string {
  let u: URL;
  try { u = new URL(String(input || '').trim()); } catch { throw new Error('Неверный адрес ретранслятора'); }
  if (u.protocol !== 'wss:' && !(u.protocol === 'ws:' && LOCAL_HOSTS.has(u.hostname))) {
    throw new Error('Адрес ретранслятора должен начинаться с wss://');
  }
  if (u.username || u.password) throw new Error('Неверный адрес ретранслятора');
  return `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, '')}`;
}

/** Ссылка для гостя: клиент доски и, в якоре (на серверы не уходит), ретранслятор, комната и ключ. */
export function cloudGuestUrl(guestBase: string, relayUrl: string, room: string, key: string): string {
  const base = guestBase.endsWith('/') ? guestBase : `${guestBase}/`;
  return `${base}#${new URLSearchParams({ relay: relayUrl, r: room, k: key })}`;
}

/** Кадр данных между автором и ретранслятором: [флаги][conn: 4 байта][содержимое]. */
export function encodeFrame(conn: number, payload: Uint8Array | string, binary: boolean): Uint8Array {
  const body = typeof payload === 'string' ? new TextEncoder().encode(payload) : payload;
  const frame = new Uint8Array(HEADER + body.length);
  frame[0] = binary ? FLAG_BINARY : 0;
  new DataView(frame.buffer).setUint32(1, conn >>> 0);
  frame.set(body, HEADER);
  return frame;
}

export function decodeFrame(buf: ArrayBuffer): { conn: number; binary: boolean; payload: Uint8Array } | null {
  if (buf.byteLength < HEADER) return null;
  const view = new DataView(buf);
  return { binary: (view.getUint8(0) & FLAG_BINARY) !== 0, conn: view.getUint32(1), payload: new Uint8Array(buf, HEADER) };
}

type Handler = (...args: never[]) => void;

/** Сокет гостя ретранслятора для хаба (контракт RoomSocket). */
class GuestSocket implements RoomSocket {
  readyState = 1;
  inSeq = 0;
  outSeq = 0;
  /** Расшифровка по порядку поступления: WebCrypto асинхронный. */
  recv: Promise<unknown> = Promise.resolve();
  private readonly handlers: { message: Handler[]; close: Handler[] } = { message: [], close: [] };
  constructor(private readonly link: { sendData(s: GuestSocket, text: string): void; kick(conn: number, code: number, reason: string): void }, readonly conn: number, readonly sid: Uint8Array) {}
  send(text: string): void {
    if (this.readyState === 1) this.link.sendData(this, text);
  }
  /** Закрывает комната (например, closeAll): отключить гостя на ретрансляторе. */
  close(code = 4000, reason = ''): void {
    if (this.readyState !== 1) return;
    this.readyState = 3;
    this.link.kick(this.conn, code, reason);
    this.emit('close');
  }
  /** Гость ушёл сам или пропал вместе с комнатой ретранслятора. */
  gone(): void {
    if (this.readyState !== 1) return;
    this.readyState = 3;
    this.emit('close');
  }
  on(ev: 'message', fn: (raw: string | Uint8Array | ArrayBuffer) => void): void;
  on(ev: 'close', fn: () => void): void;
  on(ev: 'message' | 'close', fn: Handler): void { this.handlers[ev].push(fn); }
  emit(ev: 'message' | 'close', ...args: unknown[]): void {
    for (const fn of this.handlers[ev]) (fn as (...a: unknown[]) => void)(...args);
  }
}

export interface RelayHost {
  /** Открыть комнату: промис выполняется, когда ретранслятор ответил opened, и отклоняется, если не удалось. */
  start(): Promise<void>;
  /** Закрыть комнату: гости получат 4410, ссылка перестанет работать. */
  stop(): void;
  status(): RelayStatus;
}

export function createRelayHost(options: RelayHostOptions): RelayHost {
  const o = { helloTimeoutMs: 10_000, backoffMs: [1000, 2000, 4000, 8000, 16000, 30000], pingMs: 25_000, onChange: () => {}, ...options };
  const WS = options.WebSocketImpl ?? WebSocket;
  const relayUrl = normalizeRelayUrl(o.relayUrl);

  let ws: WebSocket | null = null;
  let room: string | null = null;
  let token: string | null = null;
  let rawKey = randomBytes(KEY_BYTES);
  let keyP = importRoomKey(rawKey);
  let state: RelayState = 'idle';
  let error: string | null = null;
  let attempt = 0;
  let stopped = false;
  let retryTimer = 0;
  let pingTimer = 0;
  /** Пингов без ответа подряд; отвечал ли ретранслятор хоть раз (старый pong не знает — тогда не рвём соединение). */
  let missedPongs = 0;
  let relayPongs = false;
  let firstOpen: { resolve(): void; reject(e: Error): void } | null = null;
  let sending: Promise<unknown> = Promise.resolve();

  const guests = new Map<number, GuestSocket>();
  const pending = new Map<number, number>();

  const setState = (next: RelayState, err: string | null = null) => { state = next; error = err; o.onChange(); };
  const sendControl = (obj: unknown) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); };

  const link = {
    sendData(sock: GuestSocket, text: string): void {
      const socket = ws;
      if (!socket || socket.readyState !== 1 || sock.outSeq >= MAX_SEQ) return; // переподключаемся — после возвращения будет refresh
      const seq = ++sock.outSeq;
      const key = keyP;
      sending = sending.then(async () => {
        const frame = await seal(await key, 'h2g', sock.sid, seq, text);
        if (socket.readyState === 1) socket.send(encodeFrame(sock.conn, frame, true));
      }).catch(() => { /* канал закрылся — сообщение уже никому не нужно */ });
    },
    kick(conn: number, code: number, reason: string): void {
      const c = Number.isInteger(code) && code >= 4000 && code <= 4999 ? code : 4000;
      // после уже поставленных в очередь сообщений: отказ (denied) должен дойти до гостя раньше, чем его отключат
      sending = sending.then(() => sendControl({ t: 'kick', conn, code: c, reason: typeof reason === 'string' ? reason : '' }));
    },
  };

  function kickPending(conn: number, code: number, reason: string): void {
    clearTimeout(pending.get(conn));
    pending.delete(conn);
    link.kick(conn, code, reason);
  }

  function dropGuests(): void {
    for (const t of pending.values()) clearTimeout(t);
    pending.clear();
    for (const g of guests.values()) g.gone();
    guests.clear();
  }

  function onJoin(conn: number): void {
    if (guests.has(conn) || pending.has(conn)) return;
    pending.set(conn, window.setTimeout(() => kickPending(conn, KICK.HELLO_EXPECTED, 'hello expected'), o.helloTimeoutMs));
  }

  async function onHello(conn: number, frame: Uint8Array): Promise<void> {
    const opened = await open(await keyP, 'hello', ZERO_SID, frame);
    if (!pending.has(conn)) return; // пока расшифровывали, гость ушёл или уже представился
    if (!opened) { kickPending(conn, KICK.BAD_KEY, 'bad key'); return; }
    let m: Record<string, unknown> | null = null;
    try { m = JSON.parse(opened.text) as Record<string, unknown>; } catch { /* ниже — отказ */ }
    if (!m || typeof m !== 'object' || m.t !== 'hello') { kickPending(conn, KICK.HELLO_EXPECTED, 'hello expected'); return; }
    if (m.proto !== PROTO) { kickPending(conn, KICK.PROTOCOL_MISMATCH, 'protocol mismatch'); return; }
    const sid = typeof m.sid === 'string' ? base64urlToBytes(m.sid) : null;
    // тот же сеанс уже в комнате — это повтор чужого hello, а не новый гость
    const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);
    if (!sid || sid.length !== SID_BYTES || [...guests.values()].some(g => same(g.sid, sid))) { kickPending(conn, KICK.HELLO_EXPECTED, 'hello expected'); return; }
    clearTimeout(pending.get(conn));
    pending.delete(conn);
    const sock = new GuestSocket(link, conn, sid);
    guests.set(conn, sock);
    sock.on('close', () => { if (guests.get(conn) === sock) guests.delete(conn); });
    o.attach(sock, { isHost: false, name: typeof m.name === 'string' ? m.name : '', cursorId: m.cursorId });
  }

  function onData(buf: ArrayBuffer): void {
    const f = decodeFrame(buf);
    if (!f || !f.binary) return; // без шифрования гость ничего не присылает
    const sock = guests.get(f.conn);
    if (sock) {
      sock.recv = sock.recv.then(async () => {
        const opened = await open(await keyP, 'g2h', sock.sid, f.payload);
        // не расшифровалось или повтор (seq не вырос) — подделка или повтор ретранслятором
        if (!opened || opened.seq <= sock.inSeq) return;
        sock.inSeq = opened.seq;
        sock.emit('message', opened.text);
      }).catch(() => { /* ошибка обработчика не должна останавливать очередь */ });
      return;
    }
    if (pending.has(f.conn)) void onHello(f.conn, f.payload);
  }

  /** Возвращение в комнату: кто остался — получает полное состояние заново, кто ушёл — отключается. */
  function reconcile(present: number[]): void {
    const keep = new Set(present);
    for (const [conn, sock] of guests) if (!keep.has(conn)) sock.gone();
    for (const [conn, t] of pending) if (!keep.has(conn)) { clearTimeout(t); pending.delete(conn); }
    for (const conn of keep) {
      const sock = guests.get(conn);
      if (sock) o.refresh(sock);
      else kickPending(conn, KICK.RETRY, 'host reconnected'); // hello мог потеряться, пока нас не было
    }
  }

  function onControl(text: string): void {
    let m: Record<string, unknown>;
    try { m = JSON.parse(text) as Record<string, unknown>; } catch { return; }
    if (!m || typeof m !== 'object') return;
    if (m.t === 'pong') {
      relayPongs = true;
      return;
    }
    if (m.t === 'opened') {
      if (m.resumed && m.room === room) {
        reconcile(Array.isArray(m.guests) ? m.guests as number[] : []);
      } else {
        dropGuests(); // новая комната — прежние гости остались в старой
        room = String(m.room);
      }
      token = String(m.token);
      attempt = 0;
      setState('online');
      if (firstOpen) { firstOpen.resolve(); firstOpen = null; }
    } else if (m.t === 'join' && Number.isInteger(m.conn)) {
      onJoin(m.conn as number);
    } else if (m.t === 'leave' && Number.isInteger(m.conn)) {
      const conn = m.conn as number;
      const sock = guests.get(conn);
      if (sock) { guests.delete(conn); sock.gone(); }
      if (pending.has(conn)) { clearTimeout(pending.get(conn)); pending.delete(conn); }
    }
  }

  function connect(): void {
    const sock = new WS(`${relayUrl}/host`);
    sock.binaryType = 'arraybuffer';
    ws = sock;
    sock.onopen = () => {
      sock.send(JSON.stringify(room && token ? { t: 'open', proto: RELAY_PROTO, room, token } : { t: 'open', proto: RELAY_PROTO }));
      startPing(sock);
    };
    sock.onmessage = ev => {
      if (ws !== sock) return;
      missedPongs = 0; // любое сообщение ретранслятора — соединение живо
      if (typeof ev.data === 'string') onControl(ev.data);
      else onData(ev.data as ArrayBuffer);
    };
    sock.onclose = ev => {
      if (ws !== sock) return;
      ws = null;
      stopPing();
      onClosed(ev.code);
    };
  }

  function stopPing(): void {
    clearInterval(pingTimer);
    pingTimer = 0;
  }

  /** Раз в pingMs: ping ретранслятору; нет ответов — соединение полуоткрытое, переподключаемся. */
  function startPing(sock: WebSocket): void {
    stopPing();
    missedPongs = 0;
    pingTimer = window.setInterval(() => {
      if (ws !== sock) { stopPing(); return; }
      if (relayPongs && missedPongs >= MAX_MISSED_PONGS) {
        ws = null;
        stopPing();
        try { sock.close(); } catch { /* уже закрыт */ }
        onClosed(1006);
        return;
      }
      missedPongs++;
      sendControl({ t: 'ping' });
    }, o.pingMs);
  }

  function fail(message: string): void {
    stopPing();
    dropGuests();
    room = null;
    token = null;
    clearTimeout(retryTimer);
    setState('failed', message);
    if (firstOpen) { firstOpen.reject(new Error(message)); firstOpen = null; }
  }

  function onClosed(code: number): void {
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
      // комната пропала — откроем новую, с новым ключом: ключ живёт столько же, сколько комната
      dropGuests();
      room = null;
      token = null;
      rawKey = randomBytes(KEY_BYTES);
      keyP = importRoomKey(rawKey);
      attempt = 0;
    }
    scheduleReconnect();
  }

  function scheduleReconnect(): void {
    const base = o.backoffMs[Math.min(attempt, o.backoffMs.length - 1)];
    attempt++;
    // разброс ±20%, чтобы после сбоя ретранслятора авторы не переподключались все разом
    const delay = Math.round(base * (0.8 + Math.random() * 0.4));
    setState('reconnecting');
    retryTimer = window.setTimeout(() => { if (!stopped) connect(); }, delay);
  }

  return {
    start() {
      if (state !== 'idle') return Promise.reject(new Error('Уже запущено'));
      setState('connecting');
      const p = new Promise<void>((resolve, reject) => { firstOpen = { resolve, reject }; });
      connect();
      return p;
    },
    stop() {
      if (stopped) return;
      stopped = true;
      clearTimeout(retryTimer);
      stopPing();
      const sock = ws;
      ws = null;
      if (sock && sock.readyState === 1) {
        sock.send(JSON.stringify({ t: 'close' }));
        sock.close(1000, 'room closed');
      } else {
        try { sock?.close(); } catch { /* уже закрыт */ }
      }
      dropGuests();
      if (firstOpen) { firstOpen.reject(new Error('Остановлено')); firstOpen = null; }
      setState('stopped');
    },
    status() {
      return { state, room, error, guests: guests.size, relayUrl, key: bytesToBase64url(rawKey) };
    },
  };
}
