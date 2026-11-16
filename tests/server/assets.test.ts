// Хранилище картинок: загрузка, дедупликация, отдача, защита, подпись S3 и клиентский обмен.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LocalFsAssetBackend, S3AssetBackend, signS3Request, type AssetStorageBackend } from '../../server/asset-storage';
import { MAX_ASSET_BYTES, hashOfDataUrl, parseDataUrl } from '../../server/assets';
import { createApiClient } from '../../src/api-client';
import { AssetStore, collectAssetHashes, computeAssetHash, fetchMissingAssets, resetUploadedAssets, uploadMissingAssets } from '../../src/asset-store';
import type { Project } from '../../src/types';
import { anon, call, closeApps, makeApp } from './helpers';

afterEach(async () => { await closeApps(); resetUploadedAssets(); });

const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const PNG = `data:image/png;base64,${PNG_B64}`;
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

/** Хранилище, считающее вызовы. */
function countingBackend(inner: AssetStorageBackend) {
  const calls = { put: 0, get: 0, exists: 0 };
  const backend: AssetStorageBackend = {
    kind: inner.kind,
    put: (...a) => { calls.put++; return inner.put(...a); },
    get: (...a) => { calls.get++; return inner.get(...a); },
    exists: (...a) => { calls.exists++; return inner.exists(...a); },
  };
  return { backend, calls };
}

describe('POST /api/assets', () => {
  it('сохраняет картинку: хэш совпадает с computeAssetHash клиента и с SHA-256 от строки', async () => {
    const app = await makeApp();
    const a = await anon(app);
    const r = await call(app, 'POST', '/api/assets', { dataUrl: PNG }, { token: a.token });
    expect(r.status).toBe(201);
    const want = await computeAssetHash(PNG);
    expect(want).toBe(sha(PNG));
    expect(r.body).toEqual({ hash: want, uri: `asset://${want}`, deduplicated: false });
    expect(hashOfDataUrl(PNG)).toBe(want);
    const row = app.db.prepare('SELECT * FROM assets WHERE hash = ?').get(want) as any;
    expect(row).toMatchObject({ mime_type: 'image/png', size_bytes: Buffer.from(PNG_B64, 'base64').length, storage_backend: 'local', uploaded_by: a.id });
    expect(row.storage_key).toBe(`${want.slice(0, 2)}/${want}`);
  });

  it('хэш считается от всей строки: другое написание той же картинки — другой ассет', async () => {
    const app = await makeApp();
    const a = await anon(app);
    const other = `data:image/png;charset=utf-8;base64,${PNG_B64}`;
    const r1 = await call(app, 'POST', '/api/assets', { dataUrl: PNG }, { token: a.token });
    const r2 = await call(app, 'POST', '/api/assets', { dataUrl: other }, { token: a.token });
    expect(r1.body.hash).not.toBe(r2.body.hash);
    expect(r2.body.hash).toBe(sha(other));
  });

  it('повторная загрузка не пишет файл заново', async () => {
    const dir = (await makeApp()).dir; // каталог для файлов
    await closeApps();
    const { backend, calls } = countingBackend(new LocalFsAssetBackend(join(dir, 'a')));
    const app = await makeApp({ assetBackend: backend });
    const a = await anon(app);
    const first = await call(app, 'POST', '/api/assets', { dataUrl: PNG }, { token: a.token });
    const second = await call(app, 'POST', '/api/assets', { dataUrl: PNG }, { token: a.token });
    expect(second.status).toBe(200);
    expect(second.body).toEqual({ hash: first.body.hash, uri: first.body.uri, deduplicated: true });
    expect(calls.put).toBe(1);
    expect(app.db.prepare('SELECT COUNT(*) n FROM assets').get()).toEqual({ n: 1 });
  });

  it('если файл потерялся, а запись осталась, загрузка восстанавливает его', async () => {
    const app = await makeApp();
    const a = await anon(app);
    const r = await call(app, 'POST', '/api/assets', { dataUrl: PNG }, { token: a.token });
    const path = join(app.dir, 'assets', r.body.hash.slice(0, 2), r.body.hash);
    expect(existsSync(path)).toBe(true);
    const { rmSync } = await import('node:fs');
    rmSync(path);
    expect((await call(app, 'GET', `/api/assets/${r.body.hash}`)).status).toBe(404);
    const again = await call(app, 'POST', '/api/assets', { dataUrl: PNG }, { token: a.token });
    expect(again.body.deduplicated).toBe(true);
    expect((await call(app, 'GET', `/api/assets/${r.body.hash}`)).status).toBe(200);
  });

  it('файл лежит в каталоге с префиксом хэша, временных файлов не остаётся', async () => {
    const app = await makeApp();
    const a = await anon(app);
    const r = await call(app, 'POST', '/api/assets', { dataUrl: PNG }, { token: a.token });
    const shard = join(app.dir, 'assets', r.body.hash.slice(0, 2));
    expect(readdirSync(shard).sort()).toEqual([r.body.hash, `${r.body.hash}.mime`]);
  });

  it('нужна сессия; негодные данные — 400, не картинка — 415, лимит размера — 413', async () => {
    const app = await makeApp();
    const a = await anon(app);
    expect((await call(app, 'POST', '/api/assets', { dataUrl: PNG })).status).toBe(401);
    for (const dataUrl of [undefined, 5, '', 'http://x/y.png', 'data:image/png;base64,не*base64', 'data:image/png', 'data:image/;base64,AAAA']) {
      expect((await call(app, 'POST', '/api/assets', { dataUrl }, { token: a.token })).status, String(dataUrl)).toBe(400);
    }
    expect((await call(app, 'POST', '/api/assets', { dataUrl: 'data:text/html;base64,PGI+' }, { token: a.token })).status).toBe(415);
    expect((await call(app, 'POST', '/api/assets', { dataUrl: 'data:application/pdf;base64,AAAA' }, { token: a.token })).status).toBe(415);
    const big = `data:image/png;base64,${Buffer.alloc(MAX_ASSET_BYTES + 3).toString('base64')}`;
    const r = await call(app, 'POST', '/api/assets', { dataUrl: big }, { token: a.token });
    expect(r.status).toBe(413);
    const huge = `data:image/png;base64,${'A'.repeat(MAX_ASSET_BYTES * 2)}`;
    expect((await call(app, 'POST', '/api/assets', { dataUrl: huge }, { token: a.token })).status).toBe(413);
    expect(app.db.prepare('SELECT COUNT(*) n FROM assets').get()).toEqual({ n: 0 });
  });

  it('картинка ровно предельного размера принимается', async () => {
    const app = await makeApp();
    const a = await anon(app);
    const edge = `data:image/png;base64,${Buffer.alloc(MAX_ASSET_BYTES, 7).toString('base64')}`;
    expect((await call(app, 'POST', '/api/assets', { dataUrl: edge }, { token: a.token })).status).toBe(201);
  });
});

describe('GET /api/assets/:hash', () => {
  it('отдаёт байты с типом и вечным кэшем; защитные заголовки на месте', async () => {
    const app = await makeApp();
    const a = await anon(app);
    const { body: { hash } } = await call(app, 'POST', '/api/assets', { dataUrl: PNG }, { token: a.token });
    const res = await fetch(`${app.base}/api/assets/${hash}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('content-security-policy')).toBe("default-src 'none'; sandbox");
    expect(res.headers.get('etag')).toBe(`"${hash}"`);
    expect(Buffer.from(await res.arrayBuffer()).equals(Buffer.from(PNG_B64, 'base64'))).toBe(true);
  });

  it('?format=dataUrl возвращает исходную строку бит-в-бит', async () => {
    const app = await makeApp();
    const a = await anon(app);
    const odd = `data:image/png;charset=utf-8;base64,${PNG_B64}`;
    const { body: { hash } } = await call(app, 'POST', '/api/assets', { dataUrl: odd }, { token: a.token });
    const r = await call(app, 'GET', `/api/assets/${hash}?format=dataUrl`);
    expect(r.body).toBe(odd);
    expect(r.headers.get('cache-control')).toContain('immutable');
    expect(sha(r.body)).toBe(hash);
  });

  it('битый хэш — 400, неизвестный — 404', async () => {
    const app = await makeApp();
    for (const h of ['zz', 'A'.repeat(64), 'a'.repeat(63), 'a'.repeat(65), '../etc/passwd']) {
      expect((await call(app, 'GET', `/api/assets/${encodeURIComponent(h)}`)).status, h).toBe(400);
    }
    expect((await call(app, 'GET', `/api/assets/${'a'.repeat(64)}`)).status).toBe(404);
  });

  it('SVG не показывается в браузере: octet-stream и attachment', async () => {
    const app = await makeApp();
    const a = await anon(app);
    const svg = `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>').toString('base64')}`;
    const { body: { hash } } = await call(app, 'POST', '/api/assets', { dataUrl: svg }, { token: a.token });
    const res = await fetch(`${app.base}/api/assets/${hash}`);
    expect(res.headers.get('content-type')).toBe('application/octet-stream');
    expect(res.headers.get('content-disposition')).toBe('attachment');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });
});

describe('parseDataUrl', () => {
  it('base64, процентное кодирование, параметры и регистр', () => {
    expect(parseDataUrl(PNG)).toMatchObject({ mime: 'image/png' });
    expect(parseDataUrl('data:IMAGE/JPEG;Base64,AAAA')!.mime).toBe('image/jpeg');
    expect(parseDataUrl('data:image/gif,%47%49%46')!.bytes.toString()).toBe('GIF');
    for (const bad of ['', 'data:', 'data:image/png', 'png', 'data:text/plain,hi', 'data:image/png;base64,@@@']) expect(parseDataUrl(bad)).toBeNull();
  });
});

describe('LocalFsAssetBackend', () => {
  it('put/get/exists, тип сохраняется, неверный хэш отвергается', async () => {
    const app = await makeApp();
    const b = new LocalFsAssetBackend(join(app.dir, 'fs'));
    const hash = 'ab'.padEnd(64, 'c');
    expect(await b.exists(hash)).toBe(false);
    expect(await b.get(hash)).toBeNull();
    await b.put(hash, Buffer.from('данные'), 'image/webp');
    expect(await b.exists(hash)).toBe(true);
    const got = await b.get(hash);
    expect(Buffer.from(got!.data).toString()).toBe('данные');
    expect(got!.mimeType).toBe('image/webp');
    await expect(b.put('../x', Buffer.from('1'), 'image/png')).rejects.toThrow();
    await expect(b.get('XYZ')).rejects.toThrow();
  });

  it('одновременные записи одного хэша не портят файл', async () => {
    const app = await makeApp();
    const b = new LocalFsAssetBackend(join(app.dir, 'fs'));
    const hash = 'cd'.padEnd(64, 'e');
    await Promise.all(Array.from({ length: 8 }, () => b.put(hash, Buffer.from('одинаково'), 'image/png')));
    expect(Buffer.from((await b.get(hash))!.data).toString()).toBe('одинаково');
    expect(readdirSync(join(app.dir, 'fs', 'cd')).filter(f => f.endsWith('.tmp'))).toEqual([]);
  });
});

describe('подпись S3 (AWS Signature Version 4)', () => {
  const secret = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY';
  const key = 'AKIAIOSFODNN7EXAMPLE';

  it('официальный пример AWS: GET Object с Range', () => {
    const r = signS3Request({
      method: 'GET', host: 'examplebucket.s3.amazonaws.com', path: '/test.txt', headers: { Range: 'bytes=0-9' },
      payloadHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      region: 'us-east-1', accessKeyId: key, secretAccessKey: secret, amzDate: '20130524T000000Z',
    });
    expect(r.signedHeaders).toBe('host;range;x-amz-content-sha256;x-amz-date');
    expect(r.signature).toBe('f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41');
    expect(r.authorization).toBe(`AWS4-HMAC-SHA256 Credential=${key}/20130524/us-east-1/s3/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=${r.signature}`);
  });

  it('официальный пример AWS: PUT Object (символ «$» в ключе кодируется)', () => {
    const r = signS3Request({
      method: 'PUT', host: 'examplebucket.s3.amazonaws.com', path: '/test$file.text',
      headers: { Date: 'Fri, 24 May 2013 00:00:00 GMT', 'x-amz-storage-class': 'REDUCED_REDUNDANCY' },
      payloadHash: sha('Welcome to Amazon S3.'),
      region: 'us-east-1', accessKeyId: key, secretAccessKey: secret, amzDate: '20130524T000000Z',
    });
    expect(r.canonicalRequest.split('\n')[1]).toBe('/test%24file.text');
    expect(r.signature).toBe('98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd');
  });

  it('официальный пример AWS: список объектов с параметрами запроса', () => {
    const r = signS3Request({
      method: 'GET', host: 'examplebucket.s3.amazonaws.com', path: '/', query: { 'max-keys': '2', prefix: 'J' },
      payloadHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      region: 'us-east-1', accessKeyId: key, secretAccessKey: secret, amzDate: '20130524T000000Z',
    });
    expect(r.signature).toBe('34b48302e7b5fa45bde8084f4b7868a86f0a534bc59db6670ed5711ef69dc6f7');
  });

  it('S3AssetBackend: подписанные запросы к «адрес/бакет/aa/хэш», тип и статусы', async () => {
    const hash = 'ab'.padEnd(64, '1');
    const seen: { url: string; method: string; headers: Record<string, string>; body?: unknown }[] = [];
    const store = new Map<string, { data: Uint8Array; type: string }>();
    const fakeFetch = (async (url: string, init: RequestInit) => {
      const headers = init.headers as Record<string, string>;
      seen.push({ url, method: init.method!, headers, body: init.body });
      const k = new URL(url).pathname;
      if (init.method === 'PUT') { store.set(k, { data: init.body as Uint8Array, type: headers['Content-Type'] }); return new Response(null, { status: 200 }); }
      const o = store.get(k);
      if (!o) return new Response(null, { status: 404 });
      return init.method === 'HEAD' ? new Response(null, { status: 200 }) : new Response(o.data as BodyInit, { status: 200, headers: { 'content-type': o.type } });
    }) as unknown as typeof fetch;
    const s3 = new S3AssetBackend({
      endpoint: 'https://storage.example.net', bucket: 'abax', region: 'ru-central1', accessKeyId: key, secretAccessKey: secret,
      fetch: fakeFetch, now: () => Date.UTC(2026, 10, 1, 12, 30, 45),
    });
    expect(await s3.exists(hash)).toBe(false);
    expect(await s3.get(hash)).toBeNull();
    await s3.put(hash, Buffer.from('байты'), 'image/png');
    expect(await s3.exists(hash)).toBe(true);
    const got = await s3.get(hash);
    expect(Buffer.from(got!.data).toString()).toBe('байты');
    expect(got!.mimeType).toBe('image/png');
    const put = seen.find(c => c.method === 'PUT')!;
    expect(put.url).toBe(`https://storage.example.net/abax/ab/${hash}`);
    expect(put.headers['x-amz-date']).toBe('20261101T123045Z');
    expect(put.headers['x-amz-content-sha256']).toBe(sha('байты'));
    expect(put.headers.Authorization).toMatch(new RegExp(`^AWS4-HMAC-SHA256 Credential=${key}/20261101/ru-central1/s3/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$`));
    await expect(s3.get('плохой')).rejects.toThrow();
    const failing = new S3AssetBackend({ endpoint: 'https://s', bucket: 'b', region: 'r', accessKeyId: 'k', secretAccessKey: 's', fetch: (async () => new Response(null, { status: 500 })) as unknown as typeof fetch });
    await expect(failing.put(hash, Buffer.from('x'), 'image/png')).rejects.toThrow(/500/);
  });
});

describe('клиентский обмен: uploadMissingAssets и fetchMissingAssets', () => {
  const project = (src: string): Project => ({
    id: 'p', name: 'П', createdAt: 1, updatedAt: 1,
    pages: [{ id: 'pg', name: 'С', grid: 'square', elements: [{ id: 'i1', type: 'image', x: 0, y: 0, w: 10, h: 10, src }] }],
  });

  it('картинка уходит на сервер при сохранении, а другой клиент получает её по ссылке asset://', async () => {
    const app = await makeApp();
    const api = createApiClient({ base: app.base });
    const storeA = new AssetStore({ idb: null });
    const { strippedProject, assets } = await storeA.extractProjectAssets(project(PNG));
    const hash = (await computeAssetHash(PNG));
    expect(strippedProject.pages[0].elements[0]).toMatchObject({ src: `asset://${hash}` });
    expect(await uploadMissingAssets(assets, api)).toBe(1);
    // второй раз в этой сессии то же не отправляется
    expect(await uploadMissingAssets(assets, api)).toBe(0);
    expect(app.db.prepare('SELECT COUNT(*) n FROM assets').get()).toEqual({ n: 1 });

    // другой клиент: пустое хранилище
    resetUploadedAssets();
    const storeB = new AssetStore({ idb: null });
    expect(collectAssetHashes(strippedProject)).toEqual([hash]);
    expect(await fetchMissingAssets(strippedProject, storeB, api)).toEqual([]);
    const hydrated = await storeB.hydrateProjectAssets(strippedProject);
    expect(hydrated.pages[0].elements[0]).toMatchObject({ src: PNG });
    // уже имеющееся не докачивается
    expect(await fetchMissingAssets(strippedProject, storeB, api)).toEqual([]);
  });

  it('неизвестная на сервере картинка — в списке неудач, остальное докачивается', async () => {
    const app = await makeApp();
    const api = createApiClient({ base: app.base });
    const store = new AssetStore({ idb: null });
    await uploadMissingAssets({ [await computeAssetHash(PNG)]: PNG }, api);
    const p: Project = { ...project(`asset://${await computeAssetHash(PNG)}`) };
    p.pages[0].elements.push({ id: 'i2', type: 'image', x: 0, y: 0, w: 1, h: 1, src: `asset://${'f'.repeat(64)}` });
    resetUploadedAssets();
    expect(await fetchMissingAssets(p, new AssetStore({ idb: null }), api)).toEqual(['f'.repeat(64)]);
    expect(store.size).toBe(0);
  });

  it('сервер подсунул не то содержимое — в хранилище оно не попадает', async () => {
    const hash = 'a'.repeat(64);
    const api = createApiClient({
      base: 'https://x.test',
      fetch: (async (url: string) => (String(url).includes('/api/assets/')
        ? new Response(PNG, { status: 200 })
        : new Response(JSON.stringify({ token: 't' }), { status: 200 }))) as unknown as typeof fetch,
    });
    const store = new AssetStore({ idb: null });
    expect(await fetchMissingAssets(project(`asset://${hash}`), store, api)).toEqual([hash]);
    expect(await store.has(hash)).toBe(false);
  });

  it('ошибка отправки пробрасывается и не запоминается как отправленное', async () => {
    const api = createApiClient({ base: 'https://x.test', fetch: (async (url: string) => (String(url).endsWith('/api/auth/anon')
      ? new Response(JSON.stringify({ token: 't' }), { status: 200 }) : new Response('{"error":"x"}', { status: 500 }))) as unknown as typeof fetch });
    const h = await computeAssetHash(PNG);
    await expect(uploadMissingAssets({ [h]: PNG }, api)).rejects.toMatchObject({ status: 500 });
    resetUploadedAssets();
  });
});
