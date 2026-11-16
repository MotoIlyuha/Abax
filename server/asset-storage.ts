import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createHash, createHmac, randomBytes } from 'node:crypto';

// Хранилище блобов картинок по хэшу содержимого. Реализации: локальные файлы и S3-совместимое облако.

export interface AssetStorageBackend {
  readonly kind: 'local' | 's3';
  put(hash: string, data: Uint8Array, mimeType: string): Promise<void>;
  get(hash: string): Promise<{ data: Uint8Array; mimeType: string } | null>;
  exists(hash: string): Promise<boolean>;
}

const HASH_RE = /^[0-9a-f]{64}$/;

function checkHash(hash: string): void {
  if (!HASH_RE.test(hash)) throw new Error('Неверный хэш ассета');
}

/** Ключ в хранилище: двухуровневое шардирование по префиксу хэша. */
export const storageKey = (hash: string): string => `${hash.slice(0, 2)}/${hash}`;

/** Файлы в каталоге: `<dir>/<xx>/<hash>` и рядом `<hash>.mime` с типом содержимого; запись через временный файл. */
export class LocalFsAssetBackend implements AssetStorageBackend {
  readonly kind = 'local' as const;

  constructor(private readonly dir: string) {}

  private pathOf(hash: string): string {
    checkHash(hash);
    return join(this.dir, storageKey(hash));
  }

  private async atomicWrite(path: string, data: Uint8Array | string): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    const tmp = `${path}.${randomBytes(6).toString('hex')}.tmp`;
    await writeFile(tmp, data);
    await rename(tmp, path);
  }

  async put(hash: string, data: Uint8Array, mimeType: string): Promise<void> {
    const path = this.pathOf(hash);
    await this.atomicWrite(`${path}.mime`, mimeType);
    await this.atomicWrite(path, data);
  }

  async get(hash: string): Promise<{ data: Uint8Array; mimeType: string } | null> {
    const path = this.pathOf(hash);
    try {
      const [data, mime] = await Promise.all([readFile(path), readFile(`${path}.mime`, 'utf8').catch(() => 'application/octet-stream')]);
      return { data, mimeType: mime };
    } catch { return null; }
  }

  async exists(hash: string): Promise<boolean> {
    try { return (await stat(this.pathOf(hash))).isFile(); } catch { return false; }
  }
}

// ----- S3-совместимое хранилище: AWS Signature V4 на node:crypto + fetch (без @aws-sdk) -----

const sha256hex = (data: Uint8Array | string): string => createHash('sha256').update(data).digest('hex');
const hmacRaw = (key: Uint8Array | string, data: string): Buffer => createHmac('sha256', key).update(data).digest();

/** Кодирование по правилам SigV4: всё, кроме A-Z a-z 0-9 - _ . ~ (и «/», если это путь). */
function awsEncode(s: string, keepSlash: boolean): string {
  const enc = encodeURIComponent(s).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return keepSlash ? enc.replace(/%2F/g, '/') : enc;
}

export interface SignParams {
  method: string;
  host: string;
  /** Путь запроса без параметров, не закодированный: «/bucket/ab/abcdef…». */
  path: string;
  /** Параметры запроса (уже разобранные). */
  query?: Record<string, string>;
  /** Заголовки, которые тоже подписываются (host, x-amz-date и x-amz-content-sha256 добавляются сами). */
  headers?: Record<string, string>;
  payloadHash: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Момент подписи в формате 20130524T000000Z. */
  amzDate: string;
}

export interface SignResult {
  authorization: string;
  signedHeaders: string;
  canonicalRequest: string;
  stringToSign: string;
  signature: string;
}

/** Подпись запроса к S3 (AWS Signature Version 4): вся цепочка — канонический запрос, строка для подписи, ключ. */
export function signS3Request(p: SignParams): SignResult {
  const date = p.amzDate.slice(0, 8);
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(p.headers ?? {})) headers[k.toLowerCase()] = v.trim().replace(/\s+/g, ' ');
  headers.host = p.host;
  headers['x-amz-content-sha256'] = p.payloadHash;
  headers['x-amz-date'] = p.amzDate;
  const names = Object.keys(headers).sort();
  const canonicalHeaders = names.map(n => `${n}:${headers[n]}\n`).join('');
  const signedHeaders = names.join(';');
  const canonicalQuery = Object.entries(p.query ?? {})
    .map(([k, v]) => [awsEncode(k, false), awsEncode(v, false)] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`).join('&');
  const canonicalRequest = [p.method, awsEncode(p.path, true), canonicalQuery, canonicalHeaders, signedHeaders, p.payloadHash].join('\n');
  const scope = `${date}/${p.region}/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', p.amzDate, scope, sha256hex(canonicalRequest)].join('\n');
  const key = hmacRaw(hmacRaw(hmacRaw(hmacRaw(`AWS4${p.secretAccessKey}`, date), p.region), 's3'), 'aws4_request');
  const signature = createHmac('sha256', key).update(stringToSign).digest('hex');
  return {
    authorization: `AWS4-HMAC-SHA256 Credential=${p.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    signedHeaders, canonicalRequest, stringToSign, signature,
  };
}

export interface S3Options {
  endpoint: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  fetch?: typeof fetch;
  now?: () => number;
}

const amzDateOf = (ms: number): string => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

/** S3-совместимое хранилище (Yandex Object Storage, Timeweb Cloud): адресация «путь/бакет/ключ». */
export class S3AssetBackend implements AssetStorageBackend {
  readonly kind = 's3' as const;
  private readonly endpoint: URL;
  private readonly doFetch: typeof fetch;

  constructor(private readonly o: S3Options) {
    this.endpoint = new URL(o.endpoint);
    this.doFetch = o.fetch ?? ((...a) => fetch(...a));
  }

  private async send(method: string, hash: string, body?: Uint8Array, extra: Record<string, string> = {}): Promise<Response> {
    checkHash(hash);
    const path = `${this.endpoint.pathname.replace(/\/+$/, '')}/${this.o.bucket}/${storageKey(hash)}`;
    const payloadHash = sha256hex(body ?? '');
    const amzDate = amzDateOf((this.o.now ?? Date.now)());
    const sig = signS3Request({
      method, host: this.endpoint.host, path, payloadHash, amzDate,
      region: this.o.region, accessKeyId: this.o.accessKeyId, secretAccessKey: this.o.secretAccessKey,
    });
    return this.doFetch(`${this.endpoint.origin}${awsEncode(path, true)}`, {
      method,
      headers: { 'x-amz-date': amzDate, 'x-amz-content-sha256': payloadHash, Authorization: sig.authorization, ...extra },
      body: body as BodyInit | undefined,
    });
  }

  async put(hash: string, data: Uint8Array, mimeType: string): Promise<void> {
    const res = await this.send('PUT', hash, data, { 'Content-Type': mimeType });
    if (!res.ok) throw new Error(`S3: PUT ${res.status}`);
  }

  async get(hash: string): Promise<{ data: Uint8Array; mimeType: string } | null> {
    const res = await this.send('GET', hash);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`S3: GET ${res.status}`);
    return { data: new Uint8Array(await res.arrayBuffer()), mimeType: res.headers.get('content-type') ?? 'application/octet-stream' };
  }

  async exists(hash: string): Promise<boolean> {
    const res = await this.send('HEAD', hash);
    if (res.status === 404) return false;
    if (!res.ok) throw new Error(`S3: HEAD ${res.status}`);
    return true;
  }
}
