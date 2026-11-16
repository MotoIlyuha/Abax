import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';

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
