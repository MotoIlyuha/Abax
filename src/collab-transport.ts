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

/** Начало уведомления ретранслятора: сообщения комнаты так начинаться не могут (t: 'relay' комната не шлёт). */
const RELAY_NOTICE = '{"t":"relay"';

/**
 * Транспорт через облачный ретранслятор: WebSocket до relay/g/<комната>. Первым сообщением
 * представляемся автору — имя и версия протокола (в локальной сети они в параметрах URL).
 */
export function cloudTransport(relayUrl: string, room: string, name: string, onRelay?: (ev: RelayEvent) => void): CollabTransport {
  const t = wsTransport(`${relayUrl}/g/${encodeURIComponent(room)}`);
  const wrapped: CollabTransport = {
    send: data => t.send(data),
    close: () => t.close(),
    onopen: null,
    onmessage: null,
    onclose: null,
  };
  t.onopen = () => {
    t.send(JSON.stringify({ t: 'hello', proto: PROTO, name }));
    wrapped.onopen?.();
  };
  t.onmessage = data => {
    // без полного разбора: проекты бывают по несколько мегабайт, а разберёт их collab.ts
    if (data.startsWith(RELAY_NOTICE)) {
      try {
        const m = JSON.parse(data) as { event?: unknown };
        if (m.event === 'host-away' || m.event === 'host-back') onRelay?.(m.event);
      } catch { /* испорченное уведомление — пропускаем */ }
      return;
    }
    wrapped.onmessage?.(data);
  };
  t.onclose = (code, reason) => wrapped.onclose?.(code, reason);
  return wrapped;
}

/** Приглашение через интернет: ретранслятор, комната и (для тестового окна) имя гостя. */
export interface CloudInvite { relayUrl: string; room: string; name: string | null }

const ROOM_ID_RE = /^[A-Za-z0-9_-]{22}$/;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Разбор якоря ссылки `#relay=wss://…&r=<комната>[&name=…]` (electron/cloud-link.cjs, cloudGuestUrl).
 * null — это не приглашение или оно испорчено. ws:// допускается только для своей машины.
 */
export function parseCloudInvite(hash: string): CloudInvite | null {
  const p = new URLSearchParams(hash.replace(/^#/, ''));
  const relay = p.get('relay');
  const room = p.get('r');
  if (!relay || !room || !ROOM_ID_RE.test(room)) return null;
  let u: URL;
  try { u = new URL(relay); } catch { return null; }
  if (u.protocol !== 'wss:' && !(u.protocol === 'ws:' && LOCAL_HOSTS.has(u.hostname))) return null;
  if (u.username || u.password || u.search || u.hash) return null;
  return { relayUrl: `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, '')}`, room, name: p.get('name') };
}
