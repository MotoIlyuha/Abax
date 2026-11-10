// Протокол облачного ретранслятора — общий для сервера (relay/server.cjs) и автора (Electron).
// Ретранслятор не разбирает сообщения доски: он только пересылает их между автором и гостями.
//
// Подключения:
//   автор  → wss://<relay>/host      — управляющие сообщения (JSON, текстовые кадры) и данные (бинарные кадры)
//   гость  → wss://<relay>/g/<room>  — любые кадры; уходят автору как есть
//
// Управляющие сообщения автор ↔ ретранслятор (текстовые кадры, JSON):
//   автор → { t: 'open', proto }                      — открыть новую комнату
//   автор → { t: 'open', proto, room, token }         — вернуться в свою комнату после обрыва
//   ретр. → { t: 'opened', room, token, resumed, guests: [conn…] }
//   ретр. → { t: 'join', conn }                       — подключился гость
//   ретр. → { t: 'leave', conn }                      — гость отключился
//   автор → { t: 'kick', conn, code?, reason? }       — отключить гостя (code 4000–4999)
//   автор → { t: 'close' }                            — закрыть комнату (гостей отключит с CLOSE.ROOM_CLOSED)
//
// Данные автор ↔ ретранслятор (бинарные кадры): [флаги: 1 байт][conn: 4 байта, big-endian][содержимое].
//   Флаг FLAG_BINARY: содержимое — двоичные данные гостя; без него — текст UTF-8.
//   От автора conn — кому отправить, к автору — от кого пришло. Гость получает и отправляет содержимое как есть,
//   тем же типом кадра (текст или двоичный).
//
// Ретранслятор сам пишет гостю только текстовые кадры { t: 'relay', event: 'host-away' | 'host-back' }:
// автор пропал и ретранслятор ждёт его возвращения / автор вернулся.

/** Версия протокола ретранслятора (не путать с PROTO комнаты в electron/room.cjs). */
const RELAY_PROTO = 1;

const HEADER = 5;
const FLAG_BINARY = 1;

/** Коды закрытия соединений, которые отправляет ретранслятор. */
const CLOSE = {
  /** Неверное первое сообщение автора или испорченный запрос. */
  BAD_REQUEST: 4400,
  /** Возврат в комнату с неверным токеном. */
  BAD_TOKEN: 4401,
  /** Комнаты нет: не было, закрыта или ретранслятор перезапускался. */
  ROOM_NOT_FOUND: 4404,
  /** Гость не успевает принимать данные — буфер переполнен. */
  TOO_SLOW: 4408,
  /** Автор подключился заново, это соединение заменено новым. */
  REPLACED: 4409,
  /** Комната закрыта: автор завершил работу или не вернулся вовремя. */
  ROOM_CLOSED: 4410,
  /** Версия протокола автора не поддерживается. */
  PROTOCOL_MISMATCH: 4426,
  /** Слишком много подключений или комнат с одного адреса. */
  RATE_LIMITED: 4429,
  /** В комнате нет мест. */
  ROOM_FULL: 4430,
  /** На ретрансляторе нет мест для новых комнат. */
  SERVER_FULL: 4431,
  /** Автор временно недоступен — новые гости ждут его возвращения. */
  HOST_OFFLINE: 4503,
};

/** Идентификатор комнаты: 16 случайных байт в base64url. */
const ROOM_ID_RE = /^[A-Za-z0-9_-]{22}$/;

/**
 * Кадр данных между автором и ретранслятором.
 * @param {number} conn
 * @param {Buffer | string} payload
 * @param {boolean} isBinary
 */
function encodeFrame(conn, payload, isBinary) {
  const body = typeof payload === 'string' ? Buffer.from(payload, 'utf8') : payload;
  const frame = Buffer.allocUnsafe(HEADER + body.length);
  frame.writeUInt8(isBinary ? FLAG_BINARY : 0, 0);
  frame.writeUInt32BE(conn >>> 0, 1);
  body.copy(frame, HEADER);
  return frame;
}

/**
 * Разбор кадра данных; null — кадр короче заголовка.
 * @param {Buffer} frame
 * @returns {{ conn: number, isBinary: boolean, payload: Buffer } | null}
 */
function decodeFrame(frame) {
  if (!Buffer.isBuffer(frame) || frame.length < HEADER) return null;
  return {
    isBinary: (frame.readUInt8(0) & FLAG_BINARY) !== 0,
    conn: frame.readUInt32BE(1),
    payload: frame.subarray(HEADER),
  };
}

module.exports = { RELAY_PROTO, CLOSE, ROOM_ID_RE, HEADER, FLAG_BINARY, encodeFrame, decodeFrame };
