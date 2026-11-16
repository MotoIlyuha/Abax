import type { CollabTransport } from './collab-transport';
import { CLOSE_HOST_OFFLINE } from './collab-transport';
import type { AttachOptions, RoomSocket } from './room-host';

// Каналы без сети: автор и его собственный клиент в одной вкладке (память) и автор с гостями в разных
// вкладках одного браузера (BroadcastChannel — для тестов и демонстрации).

type Handler = (...args: never[]) => void;

/** Сокет хаба поверх обычных функций: на нём держится и память, и BroadcastChannel. */
class PipeSocket implements RoomSocket {
  readyState = 1;
  private readonly handlers: { message: Handler[]; close: Handler[] } = { message: [], close: [] };
  constructor(
    private readonly out: (text: string) => void,
    private readonly onClose: (code: number, reason: string) => void,
  ) {}
  send(text: string): void { if (this.readyState === 1) this.out(text); }
  close(code = 1000, reason = ''): void {
    if (this.readyState !== 1) return;
    this.readyState = 3;
    this.onClose(code, reason);
    this.emit('close');
  }
  /** Другая сторона закрыла канал. */
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

function emptyTransport(): CollabTransport {
  return { send: () => false, close() { /* заменяется ниже */ }, onopen: null, onmessage: null, onclose: null };
}

/**
 * Пара «клиент ↔ сокет хаба» в одной вкладке. Доставка — через очередь микрозадач: обработчики клиента
 * успевают выставиться после создания пары, а хаб — после attach.
 */
export function memoryChannel(): { client: CollabTransport; socket: RoomSocket } {
  const client = emptyTransport();
  let open = true;
  const socket = new PipeSocket(
    text => { queueMicrotask(() => { if (open) client.onmessage?.(text); }); },
    (code, reason) => { open = false; queueMicrotask(() => client.onclose?.(code, reason)); },
  );
  client.send = data => {
    if (!open) return false;
    queueMicrotask(() => { if (socket.readyState === 1) socket.emit('message', data); });
    return true;
  };
  client.close = () => {
    if (!open) return;
    open = false;
    queueMicrotask(() => socket.gone());
  };
  queueMicrotask(() => { if (open) client.onopen?.(); });
  return { client, socket };
}

// ----- BroadcastChannel -----

type Wire =
  | { k: 'hello'; cid: string; name: string; cursorId?: string }
  | { k: 'welcome'; cid: string }
  | { k: 'msg'; cid: string; data: string }
  | { k: 'bye'; cid: string }
  | { k: 'close'; cid: string; code: number; reason: string };

const channelName = (code: string) => `abax-local-${code}`;

/** Принимает гостей других вкладок по коду комнаты. Возвращает функцию остановки. */
export function listenLocalGuests(code: string, attach: (sock: RoomSocket, opts: AttachOptions) => number | null): () => void {
  const ch = new BroadcastChannel(channelName(code));
  const guests = new Map<string, PipeSocket>();
  ch.onmessage = ev => {
    const m = ev.data as Wire;
    if (!m || typeof m.cid !== 'string') return;
    if (m.k === 'hello') {
      if (guests.has(m.cid)) return;
      const sock = new PipeSocket(
        text => ch.postMessage({ k: 'msg', cid: m.cid, data: text } satisfies Wire),
        (c, reason) => { guests.delete(m.cid); ch.postMessage({ k: 'close', cid: m.cid, code: c, reason } satisfies Wire); },
      );
      guests.set(m.cid, sock);
      sock.on('close', () => { guests.delete(m.cid); });
      ch.postMessage({ k: 'welcome', cid: m.cid } satisfies Wire);
      attach(sock, { isHost: false, name: typeof m.name === 'string' ? m.name : '', cursorId: m.cursorId });
    } else if (m.k === 'msg') {
      guests.get(m.cid)?.emit('message', m.data);
    } else if (m.k === 'bye') {
      guests.get(m.cid)?.gone();
      guests.delete(m.cid);
    }
  };
  return () => {
    for (const g of [...guests.values()]) g.close(4410, 'room closed');
    guests.clear();
    ch.close();
  };
}

/** Гость в другой вкладке. Нет ответа автора за waitMs — канал закрывается кодом «автор не в сети». */
export function localGuestTransport(code: string, name: string, waitMs = 4000, cursorId?: string): CollabTransport {
  const ch = new BroadcastChannel(channelName(code));
  const cid = crypto.randomUUID();
  const t = emptyTransport();
  let state: 'wait' | 'open' | 'closed' = 'wait';
  const finish = (c: number, reason: string) => {
    if (state === 'closed') return;
    state = 'closed';
    clearTimeout(timer);
    ch.close();
    t.onclose?.(c, reason);
  };
  const timer = window.setTimeout(() => finish(CLOSE_HOST_OFFLINE, 'host offline'), waitMs);
  ch.onmessage = ev => {
    const m = ev.data as Wire;
    if (!m || m.cid !== cid) return;
    if (m.k === 'welcome' && state === 'wait') { state = 'open'; clearTimeout(timer); t.onopen?.(); }
    else if (m.k === 'msg' && state === 'open') t.onmessage?.(m.data);
    else if (m.k === 'close') finish(m.code, m.reason);
  };
  t.send = data => {
    if (state !== 'open') return false;
    ch.postMessage({ k: 'msg', cid, data } satisfies Wire);
    return true;
  };
  t.close = () => {
    if (state === 'closed') return;
    if (state === 'open') ch.postMessage({ k: 'bye', cid } satisfies Wire);
    state = 'closed';
    clearTimeout(timer);
    ch.close();
  };
  ch.postMessage({ k: 'hello', cid, name, ...(cursorId ? { cursorId } : {}) } satisfies Wire);
  return t;
}

/** Код комнаты из `?room=local:КОД`; null — это не локальная комната. */
export function localRoomCode(roomParam: string | null): string | null {
  if (!roomParam || !roomParam.startsWith('local:')) return null;
  const code = roomParam.slice(6);
  return /^[A-Za-z0-9_-]{1,64}$/.test(code) ? code : null;
}
