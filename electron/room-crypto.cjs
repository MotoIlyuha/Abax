// Сквозное шифрование совместной работы через интернет (сторона автора, Node).
// Та же схема в браузере — src/room-crypto.ts; совместимость проверяют тесты.
//
// Ключ комнаты — 32 случайных байта, AES-256-GCM. Автор создаёт его при открытии комнаты и
// передаёт гостям в якоре ссылки (#…&k=…): якорь браузер на серверы не отправляет, поэтому
// ретранслятор ключа не видит и не может ни прочитать, ни подделать сообщения.
//
// Кадр: [iv: 12 случайных байт][seq: 4 байта, big-endian][шифротекст + тег 16 байт].
// Дополнительные данные (AAD, проверяются тегом): направление ('hello' | 'g2h' | 'h2g'),
// идентификатор сеанса гостя (16 байт; в hello — нули) и seq. Так ретранслятор не может
// переслать сообщение одного гостя другому (другой сеанс), повторить старое (seq только растёт)
// или выдать сообщение автора за сообщение гостя (другое направление).
const crypto = require('crypto');

const KEY_BYTES = 32;
const SID_BYTES = 16;
const IV_BYTES = 12;
const SEQ_BYTES = 4;
const TAG_BYTES = 16;
const HEAD = IV_BYTES + SEQ_BYTES;
const ZERO_SID = Buffer.alloc(SID_BYTES);
/** Наибольший seq: дальше счётчик не растёт (при 25 сообщениях в секунду — пять лет). */
const MAX_SEQ = 0xffffffff;

const newKey = () => crypto.randomBytes(KEY_BYTES);

function aad(dir, sid, seqBuf) {
  return Buffer.concat([Buffer.from(dir, 'ascii'), sid, seqBuf]);
}

/**
 * Зашифровать текст.
 * @param {Buffer} key @param {'hello' | 'g2h' | 'h2g'} dir @param {Buffer} sid @param {number} seq @param {string} text
 * @returns {Buffer}
 */
function seal(key, dir, sid, seq, text) {
  const iv = crypto.randomBytes(IV_BYTES);
  const seqBuf = Buffer.alloc(SEQ_BYTES);
  seqBuf.writeUInt32BE(seq >>> 0);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  c.setAAD(aad(dir, sid, seqBuf));
  return Buffer.concat([iv, seqBuf, c.update(text, 'utf8'), c.final(), c.getAuthTag()]);
}

/**
 * Расшифровать кадр; null — чужой ключ, другой сеанс или направление, испорченные данные.
 * @param {Buffer} key @param {'hello' | 'g2h' | 'h2g'} dir @param {Buffer} sid @param {Buffer} frame
 * @returns {{ seq: number, text: string } | null}
 */
function open(key, dir, sid, frame) {
  if (!Buffer.isBuffer(frame) || frame.length < HEAD + TAG_BYTES) return null;
  const iv = frame.subarray(0, IV_BYTES);
  const seqBuf = frame.subarray(IV_BYTES, HEAD);
  const body = frame.subarray(HEAD, frame.length - TAG_BYTES);
  const tag = frame.subarray(frame.length - TAG_BYTES);
  try {
    const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
    d.setAAD(aad(dir, sid, seqBuf));
    d.setAuthTag(tag);
    const text = Buffer.concat([d.update(body), d.final()]).toString('utf8');
    return { seq: seqBuf.readUInt32BE(0), text };
  } catch {
    return null;
  }
}

/** Идентификатор сеанса из hello: 16 байт в base64url (22 символа); null — испорчен. */
function parseSid(s) {
  if (typeof s !== 'string' || !/^[A-Za-z0-9_-]{22}$/.test(s)) return null;
  const b = Buffer.from(s, 'base64url');
  return b.length === SID_BYTES ? b : null;
}

module.exports = { KEY_BYTES, SID_BYTES, ZERO_SID, MAX_SEQ, newKey, seal, open, parseSid };
