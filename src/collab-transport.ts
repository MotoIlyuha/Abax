// Канал до комнаты совместной работы. collab.ts работает только через этот интерфейс:
// сейчас это WebSocket (локальная сеть), позже — облачный ретранслятор с шифрованием.

export interface CollabTransport {
  /** Отправить текст; false — канал ещё не открыт или уже закрыт. */
  send(data: string): boolean;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((data: string) => void) | null;
  /** Канал закрыт: сервером (code из 4xxx — причина отказа), сетью или нами. */
  onclose: ((code: number, reason: string) => void) | null;
}

/** Причины закрытия, которые отправляет сервер (electron/share.cjs, electron/room.cjs). */
export const CLOSE_PROTOCOL_MISMATCH = 4426;

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
