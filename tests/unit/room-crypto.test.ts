// Шифрование совместной работы: браузерная реализация (src/room-crypto.ts, WebCrypto) и
// реализация автора (electron/room-crypto.cjs, Node) должны понимать друг друга.
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import * as web from '../../src/room-crypto';

const require = createRequire(import.meta.url);
const node = require('../../electron/room-crypto.cjs');

const key = node.newKey() as Buffer;
const sid = Buffer.from(web.randomBytes(16));
const otherSid = Buffer.from(web.randomBytes(16));

describe('формат кадра', () => {
  it('браузер шифрует — автор расшифровывает, и обратно; текст с кириллицей и эмодзи', async () => {
    const wk = await web.importRoomKey(new Uint8Array(key));
    const text = JSON.stringify({ t: 'project', name: 'Доска 📐', pages: [] });
    const fromGuest = await web.seal(wk, 'g2h', new Uint8Array(sid), 7, text);
    expect(node.open(key, 'g2h', sid, Buffer.from(fromGuest))).toEqual({ seq: 7, text });
    const fromHost = node.seal(key, 'h2g', sid, 0xfffffffe, text);
    expect(await web.open(wk, 'h2g', new Uint8Array(sid), new Uint8Array(fromHost))).toEqual({ seq: 0xfffffffe, text });
  });

  it('кадр: 12 байт iv, 4 байта seq, шифротекст с тегом 16 байт; iv каждый раз новый', () => {
    const a = node.seal(key, 'h2g', sid, 1, 'abc');
    const b = node.seal(key, 'h2g', sid, 1, 'abc');
    expect(a.length).toBe(12 + 4 + 3 + 16);
    expect([...a.subarray(12, 16)]).toEqual([0, 0, 0, 1]);
    expect(a.subarray(0, 12).equals(b.subarray(0, 12))).toBe(false);
  });

  it('чужой ключ, другой сеанс, другое направление, подмена seq или байта — не расшифровывается', async () => {
    const frame = node.seal(key, 'g2h', sid, 5, 'секрет');
    const wk = await web.importRoomKey(new Uint8Array(key));
    expect(node.open(node.newKey(), 'g2h', sid, frame)).toBeNull();
    expect(node.open(key, 'g2h', otherSid, frame)).toBeNull(); // переслали другому гостю
    expect(node.open(key, 'h2g', sid, frame)).toBeNull(); // выдали за сообщение автора
    const seqForged = Buffer.from(frame); seqForged[15] = 9; // подменили номер сообщения
    expect(node.open(key, 'g2h', sid, seqForged)).toBeNull();
    const flipped = Buffer.from(frame); flipped[20] ^= 1;
    expect(node.open(key, 'g2h', sid, flipped)).toBeNull();
    expect(node.open(key, 'g2h', sid, frame.subarray(0, 20))).toBeNull();
    expect(await web.open(wk, 'h2g', new Uint8Array(sid), new Uint8Array(frame))).toBeNull();
    expect(await web.open(wk, 'g2h', new Uint8Array(sid), new Uint8Array(4))).toBeNull();
  });

  it('hello — с нулевым сеансом', async () => {
    const wk = await web.importRoomKey(new Uint8Array(key));
    const hello = await web.seal(wk, 'hello', web.ZERO_SID, 0, '{"t":"hello"}');
    expect(node.open(key, 'hello', node.ZERO_SID, Buffer.from(hello))!.text).toBe('{"t":"hello"}');
  });
});

describe('base64url и идентификатор сеанса', () => {
  it('ключ из ссылки: туда и обратно', () => {
    const k = new Uint8Array(key);
    const s = web.bytesToBase64url(k);
    expect(s).toBe(key.toString('base64url'));
    expect(s).toHaveLength(43);
    expect(web.base64urlToBytes(s)).toEqual(k);
    expect(web.base64urlToBytes('не base64')).toBeNull();
    expect(web.base64urlToBytes('a')).toBeNull();
  });

  it('parseSid: 22 символа base64url = 16 байт', () => {
    const s = web.bytesToBase64url(web.randomBytes(16));
    expect(node.parseSid(s)).toHaveLength(16);
    for (const bad of [undefined, 42, '', 'короткий', 'A'.repeat(23), 'A'.repeat(21) + '+']) expect(node.parseSid(bad)).toBeNull();
  });
});
