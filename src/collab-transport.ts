import {
  KEY_BYTES, MAX_SEQ, SID_BYTES, ZERO_SID, base64urlToBytes, bytesToBase64url, importRoomKey, open, randomBytes, seal,
  type Direction,
} from './room-crypto';

// Канал до комнаты совместной работы. collab.ts работает только через этот интерфейс:
// WebSocket до компьютера автора (локальная сеть) или до облачного ретранслятора (relay/).

export interface CollabTransport {
  /** Отправить текст; false — канал ещё не открыт или уже закрыт. */
  send(data: string): boolean;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((data: string) => void) | null;
  /** Канал закрыт: сервером (code из 4xxx — причина отказа), сетью или нами. */
  onclose: ((code: number, reason: string) => void) | null;
}

/** Версия протокола сообщений комнаты; должна совпадать с PROTO в electron/room.cjs. */
export const PROTO = 1;

/**
 * Причины закрытия, которые видит гость. Локальный сервер (electron/share.cjs), подключение автора
 * к облаку (electron/cloud-link.cjs) и ретранслятор (relay/protocol.cjs) пользуются одними кодами.
 */
export const CLOSE_BAD_REQUEST = 4400;
/** Бесплатная комната: гость уже есть, второй не помещается. */
export const CLOSE_FREE_LIMIT = 4402;
export const CLOSE_BAD_CODE = 4403;
export const CLOSE_ROOM_NOT_FOUND = 4404;
export const CLOSE_TOO_SLOW = 4408;
export const CLOSE_ROOM_CLOSED = 4410;
export const CLOSE_PROTOCOL_MISMATCH = 4426;
export const CLOSE_RATE_LIMITED = 4429;
export const CLOSE_ROOM_FULL = 4430;
export const CLOSE_HOST_OFFLINE = 4503;

/** Транспорт поверх WebSocket. */
export function wsTransport(url: string): CollabTransport {
  const ws = new WebSocket(url);
  const t: CollabTransport = {
    send(data) {
      if (ws.readyState !== 1) return false;
      ws.send(data);
      return true;
    },
    close() {
      try { ws.close(); } catch { /* уже закрыт */ }
    },
    onopen: null,
    onmessage: null,
    onclose: null,
  };
  ws.onopen = () => t.onopen?.();
  ws.onmessage = ev => t.onmessage?.(String(ev.data));
  // после ошибки всегда приходит close — отдельный onerror не нужен
  ws.onclose = ev => t.onclose?.(ev.code, ev.reason);
  return t;
}

/** Уведомление ретранслятора гостю: автор пропал и ретранслятор ждёт его / автор вернулся. */
export type RelayEvent = 'host-away' | 'host-back';

/** Начало уведомления ретранслятора: автор текстом не пишет (его сообщения зашифрованы и двоичные). */
const RELAY_NOTICE = '{"t":"relay"';

/**
 * Транспорт через облачный ретранслятор: WebSocket до relay/g/<комната>. Все сообщения зашифрованы
 * ключом комнаты из ссылки (src/room-crypto.ts), ретранслятор видит только шифротекст. Первым
 * сообщением представляемся автору: имя, версия протокола и идентификатор сеанса шифрования.
 * WebCrypto асинхронный — отправка и приём идут через очереди, порядок сообщений сохраняется.
 */
export function cloudTransport(relayUrl: string, room: string, rawKey: Uint8Array, name: string, onRelay?: (ev: RelayEvent) => void): CollabTransport {
  const ws = new WebSocket(`${relayUrl}/g/${encodeURIComponent(room)}`);
  ws.binaryType = 'arraybuffer';
  const sid = randomBytes(SID_BYTES);
  const keyReady = importRoomKey(rawKey);
  let outSeq = 0;
  let inSeq = 0;
  /** Очереди: шифрование и расшифровка по порядку поступления. */
  let sending: Promise<unknown> = keyReady;
  let receiving: Promise<unknown> = keyReady;
  const enqueueSend = (dir: Direction, s: Uint8Array, seq: number, text: string) => {
    sending = sending.then(async () => {
      const frame = await seal(await keyReady, dir, s, seq, text);
      if (ws.readyState === 1) ws.send(frame);
    }).catch(() => { /* канал закрылся — сообщение уже никому не нужно */ });
  };

  const t: CollabTransport = {
    send(data) {
      if (ws.readyState !== 1 || outSeq >= MAX_SEQ) return false;
      enqueueSend('g2h', sid, ++outSeq, data);
      return true;
    },
    close() {
      try { ws.close(); } catch { /* уже закрыт */ }
    },
    onopen: null,
    onmessage: null,
    onclose: null,
  };
  ws.onopen = () => {
    enqueueSend('hello', ZERO_SID, 0, JSON.stringify({ t: 'hello', proto: PROTO, name, sid: bytesToBase64url(sid) }));
    // onopen — после hello в очереди: первые сообщения комнаты уйдут уже после знакомства
    sending = sending.then(() => t.onopen?.());
  };
  ws.onmessage = ev => {
    if (typeof ev.data === 'string') {
      if (ev.data.startsWith(RELAY_NOTICE)) {
        try {
          const m = JSON.parse(ev.data) as { event?: unknown };
          if (m.event === 'host-away' || m.event === 'host-back') onRelay?.(m.event);
        } catch { /* испорченное уведомление — пропускаем */ }
      }
      return; // прочий текст — не от автора
    }
    const frame = new Uint8Array(ev.data as ArrayBuffer);
    receiving = receiving.then(async () => {
      const opened = await open(await keyReady, 'h2g', sid, frame);
      // не расшифровалось или повтор (seq не вырос) — подделка или повтор ретранслятором
      if (!opened || opened.seq <= inSeq) return;
      inSeq = opened.seq;
      t.onmessage?.(opened.text);
    }).catch(() => { /* ошибка обработчика не должна останавливать очередь */ });
  };
  // закрытие — после уже принятых сообщений: причина отказа не обгоняет init
  ws.onclose = ev => { receiving = receiving.then(() => t.onclose?.(ev.code, ev.reason)); };
  return t;
}

/** Приглашение через интернет: ретранслятор, комната, ключ шифрования и (для тестового окна) имя гостя. */
export interface CloudInvite { relayUrl: string; room: string; key: Uint8Array; name: string | null }

const ROOM_ID_RE = /^[A-Za-z0-9_-]{22}$/;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Разбор якоря ссылки `#relay=wss://…&r=<комната>&k=<ключ>[&name=…]` (electron/cloud-link.cjs,
 * cloudGuestUrl). null — это не приглашение или оно испорчено (без ключа — тоже): ws:// допускается
 * только для своей машины.
 */
export function parseCloudInvite(hash: string): CloudInvite | null {
  const p = new URLSearchParams(hash.replace(/^#/, ''));
  const relay = p.get('relay');
  const room = p.get('r');
  if (!relay || !room || !ROOM_ID_RE.test(room)) return null;
  const key = base64urlToBytes(p.get('k') || '');
  if (!key || key.length !== KEY_BYTES) return null;
  let u: URL;
  try { u = new URL(relay); } catch { return null; }
  if (u.protocol !== 'wss:' && !(u.protocol === 'ws:' && LOCAL_HOSTS.has(u.hostname))) return null;
  if (u.username || u.password || u.search || u.hash) return null;
  return { relayUrl: `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, '')}`, room, key, name: p.get('name') };
}
