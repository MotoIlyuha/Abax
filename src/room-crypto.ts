// Сквозное шифрование совместной работы через интернет (сторона гостя, WebCrypto).
// Схема и формат кадра описаны в electron/room-crypto.cjs; совместимость проверяют тесты.

export type Direction = 'hello' | 'g2h' | 'h2g';

export const KEY_BYTES = 32;
export const SID_BYTES = 16;
const IV_BYTES = 12;
const SEQ_BYTES = 4;
const TAG_BYTES = 16;
const HEAD = IV_BYTES + SEQ_BYTES;
export const ZERO_SID = new Uint8Array(SID_BYTES);
export const MAX_SEQ = 0xffffffff;

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

export function bytesToBase64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** base64url → байты; null — не base64url. */
export function base64urlToBytes(s: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(s) || s.length % 4 === 1) return null;
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function randomBytes(n: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(n));
}

export function importRoomKey(raw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', raw as BufferSource, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

function aad(dir: Direction, sid: Uint8Array, seq: Uint8Array): Uint8Array {
  const d = encoder.encode(dir);
  const out = new Uint8Array(d.length + sid.length + seq.length);
  out.set(d, 0);
  out.set(sid, d.length);
  out.set(seq, d.length + sid.length);
  return out;
}

export async function seal(key: CryptoKey, dir: Direction, sid: Uint8Array, seq: number, text: string): Promise<Uint8Array> {
  const iv = randomBytes(IV_BYTES);
  const seqBytes = new Uint8Array(SEQ_BYTES);
  new DataView(seqBytes.buffer).setUint32(0, seq >>> 0);
  const ct = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource, additionalData: aad(dir, sid, seqBytes) as BufferSource },
    key, encoder.encode(text) as BufferSource,
  ));
  const frame = new Uint8Array(HEAD + ct.length);
  frame.set(iv, 0);
  frame.set(seqBytes, IV_BYTES);
  frame.set(ct, HEAD);
  return frame;
}

/** null — чужой ключ, другой сеанс или направление, испорченные данные. */
export async function open(key: CryptoKey, dir: Direction, sid: Uint8Array, frame: Uint8Array): Promise<{ seq: number; text: string } | null> {
  if (frame.length < HEAD + TAG_BYTES) return null;
  const iv = frame.subarray(0, IV_BYTES);
  const seqBytes = frame.subarray(IV_BYTES, HEAD);
  try {
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv as BufferSource, additionalData: aad(dir, sid, seqBytes) as BufferSource },
      key, frame.subarray(HEAD) as BufferSource,
    );
    const seq = new DataView(seqBytes.buffer, seqBytes.byteOffset, SEQ_BYTES).getUint32(0);
    return { seq, text: decoder.decode(plain) };
  } catch {
    return null;
  }
}
