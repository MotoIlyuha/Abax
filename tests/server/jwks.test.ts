// Проверка подписи JWT по JWKS на node:crypto: RS256, ES256, EdDSA, смена ключей.
import { generateKeyPairSync, sign as cryptoSign, type KeyObject } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decodeJwt, jwksVerifier } from '../../server/jwks';

const part = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');

function jwt(alg: string, kid: string | undefined, payload: Record<string, unknown>, key: KeyObject): string {
  const input = `${part({ alg, ...(kid ? { kid } : {}) })}.${part(payload)}`;
  const hash = alg === 'EdDSA' ? null : 'sha256';
  const sig = cryptoSign(hash, Buffer.from(input), alg === 'ES256' ? { key, dsaEncoding: 'ieee-p1363' } : key);
  return `${input}.${sig.toString('base64url')}`;
}

function setup(keys: () => unknown[]) {
  let fetches = 0;
  const fetchImpl = (async () => { fetches++; return new Response(JSON.stringify({ keys: keys() }), { status: 200 }); }) as unknown as typeof fetch;
  const clock = { t: 0 };
  const v = jwksVerifier('https://idp.example/jwks', () => fetchImpl, () => clock.t, 1000);
  return { v, clock, fetches: () => fetches };
}

describe('JWKS', () => {
  const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const ec = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const ed = generateKeyPairSync('ed25519');
  const jwks = [
    { ...rsa.publicKey.export({ format: 'jwk' }), kid: 'r1', alg: 'RS256' },
    { ...ec.publicKey.export({ format: 'jwk' }), kid: 'e1', alg: 'ES256' },
    { ...ed.publicKey.export({ format: 'jwk' }), kid: 'd1', alg: 'EdDSA' },
  ];

  it('RS256, ES256 и EdDSA проверяются; чужой ключ и подмена — нет', async () => {
    const { v } = setup(() => jwks);
    expect(await v.verify(jwt('RS256', 'r1', { a: 1 }, rsa.privateKey))).toEqual({ a: 1 });
    expect(await v.verify(jwt('ES256', 'e1', { b: 2 }, ec.privateKey))).toEqual({ b: 2 });
    expect(await v.verify(jwt('EdDSA', 'd1', { c: 3 }, ed.privateKey))).toEqual({ c: 3 });
    expect(await v.verify(jwt('RS256', undefined, { a: 1 }, rsa.privateKey))).toEqual({ a: 1 }); // без kid — по типу
    const other = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
    expect(await v.verify(jwt('RS256', 'r1', { a: 1 }, other))).toBeNull();
    const t = jwt('RS256', 'r1', { admin: false }, rsa.privateKey).split('.');
    expect(await v.verify(`${t[0]}.${part({ admin: true })}.${t[2]}`)).toBeNull();
    expect(await v.verify(jwt('RS256', 'e1', { a: 1 }, rsa.privateKey))).toBeNull(); // kid другого типа
    expect(await v.verify(`${part({ alg: 'none' })}.${part({ a: 1 })}.`)).toBeNull();
    expect(await v.verify('nope')).toBeNull();
  });

  it('ключи кэшируются; новый kid — повторная загрузка набора', async () => {
    let keys: unknown[] = [jwks[0]];
    const s = setup(() => keys);
    await s.v.verify(jwt('RS256', 'r1', {}, rsa.privateKey));
    await s.v.verify(jwt('RS256', 'r1', {}, rsa.privateKey));
    expect(s.fetches()).toBe(1);
    const rsa2 = generateKeyPairSync('rsa', { modulusLength: 2048 });
    keys = [jwks[0], { ...rsa2.publicKey.export({ format: 'jwk' }), kid: 'r2', alg: 'RS256' }];
    expect(await s.v.verify(jwt('RS256', 'r2', { n: 2 }, rsa2.privateKey))).toEqual({ n: 2 });
    expect(s.fetches()).toBe(2);
    s.clock.t += 2000; // истёк срок кэша
    await s.v.verify(jwt('RS256', 'r1', {}, rsa.privateKey));
    expect(s.fetches()).toBe(3);
  });

  it('decodeJwt', () => {
    expect(decodeJwt('a.b')).toBeNull();
    expect(decodeJwt(`${part({ alg: 'RS256' })}.${part({ x: 1 })}.c2ln`)?.payload).toEqual({ x: 1 });
  });
});
