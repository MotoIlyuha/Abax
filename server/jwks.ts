import { createPublicKey, verify as cryptoVerify, type JsonWebKey, type KeyObject } from 'node:crypto';

// Проверка подписи JWT (id_token) по набору открытых ключей провайдера (JWKS) — на node:crypto, без библиотек.
// Алгоритмы: RS256, ES256, EdDSA (Ed25519). Ключи кэшируются; неизвестный kid — один повторный запрос набора.

export interface JwtParts { header: Record<string, unknown>; payload: Record<string, unknown> }

/** Разобрать JWT без проверки подписи; null — не JWT. */
export function decodeJwt(token: unknown): (JwtParts & { signingInput: string; signature: Buffer }) | null {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')) as Record<string, unknown>;
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as Record<string, unknown>;
    if (!header || typeof header !== 'object' || !payload || typeof payload !== 'object') return null;
    return { header, payload, signingInput: `${parts[0]}.${parts[1]}`, signature: Buffer.from(parts[2], 'base64url') };
  } catch { return null; }
}

const ALGS: Record<string, { hash: string | null; kty: string; dsa?: 'ieee-p1363' }> = {
  RS256: { hash: 'sha256', kty: 'RSA' },
  ES256: { hash: 'sha256', kty: 'EC', dsa: 'ieee-p1363' },
  EdDSA: { hash: null, kty: 'OKP' },
};

interface Cached { keys: (JsonWebKey & { kid?: string; alg?: string })[]; at: number }

export interface JwksVerifier {
  /** Полезная нагрузка, если подпись верна; иначе null. */
  verify(token: unknown): Promise<Record<string, unknown> | null>;
}

/**
 * Проверяющий по адресу JWKS. fetchImpl и now — для тестов; ttlMs — сколько держать набор ключей.
 * Ключ выбирается по kid (а без kid — первый ключ того же типа и алгоритма).
 */
export function jwksVerifier(url: string, fetchImpl: () => typeof fetch, now: () => number, ttlMs = 3600_000): JwksVerifier {
  let cache: Cached | null = null;
  const keyObjects = new Map<string, KeyObject>();

  async function load(force: boolean): Promise<Cached> {
    if (cache && !force && now() - cache.at < ttlMs) return cache;
    const res = await fetchImpl()(url);
    if (!res.ok) throw new Error(`JWKS: ответ ${res.status}`);
    const data = await res.json() as { keys?: unknown };
    if (!Array.isArray(data.keys)) throw new Error('JWKS: нет ключей');
    cache = { keys: data.keys as Cached['keys'], at: now() };
    keyObjects.clear();
    return cache;
  }

  function pick(set: Cached, kid: unknown, alg: string): (JsonWebKey & { kid?: string; alg?: string }) | null {
    const spec = ALGS[alg];
    const fits = (k: JsonWebKey & { alg?: string }) => k.kty === spec.kty && (!k.alg || k.alg === alg);
    if (typeof kid === 'string') return set.keys.find(k => k.kid === kid && fits(k)) ?? null;
    return set.keys.find(fits) ?? null;
  }

  return {
    async verify(token) {
      const jwt = decodeJwt(token);
      if (!jwt) return null;
      const alg = jwt.header.alg;
      if (typeof alg !== 'string' || !ALGS[alg]) return null;
      let set = await load(false);
      let jwk = pick(set, jwt.header.kid, alg);
      if (!jwk) { set = await load(true); jwk = pick(set, jwt.header.kid, alg); } // ключи сменились
      if (!jwk) return null;
      const id = `${jwk.kid ?? ''}:${alg}:${jwk.n ?? jwk.x ?? ''}`;
      let key = keyObjects.get(id);
      if (!key) {
        try { key = createPublicKey({ key: jwk, format: 'jwk' }); } catch { return null; }
        keyObjects.set(id, key);
      }
      const spec = ALGS[alg];
      const ok = cryptoVerify(spec.hash, Buffer.from(jwt.signingInput), spec.dsa ? { key, dsaEncoding: spec.dsa } : key, jwt.signature);
      return ok ? jwt.payload : null;
    },
  };
}
