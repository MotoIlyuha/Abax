import type { Element, Page, Project } from './types';

// Тяжёлые картинки (data:image/… в base64) выносятся из JSON проекта в хранилище по хэшу содержимого:
// одинаковые картинки занимают одно место и по сети не гоняются дважды.

/** Префикс ссылки на вынесенную картинку: asset://<sha256 в hex>. */
export const ASSET_PREFIX = 'asset://';
const ASSET_RE = /^asset:\/\/([0-9a-f]{64})$/;
const DB_NAME = 'abax-assets';
const DB_STORE = 'assets';

export const assetRef = (hash: string): string => `${ASSET_PREFIX}${hash}`;

/** Хэш из ссылки asset://…; null — это не ссылка на вынесенную картинку. */
export function assetHashOf(src: string): string | null {
  return ASSET_RE.exec(src)?.[1] ?? null;
}

const isDataImage = (src: string): boolean => src.startsWith('data:image/');

// ----- SHA-256 -----

const PRIMES: number[] = [];
for (let n = 2; PRIMES.length < 64; n++) if (PRIMES.every(p => n % p !== 0)) PRIMES.push(n);
const frac32 = (v: number): number => Math.floor((v - Math.floor(v)) * 4294967296);
const K = PRIMES.map(p => frac32(Math.cbrt(p)) | 0);
const H0 = PRIMES.slice(0, 8).map(p => frac32(Math.sqrt(p)) | 0);
const rotr = (x: number, n: number): number => (x >>> n) | (x << (32 - n));

/** SHA-256 без WebCrypto: запасной путь для окружений без crypto.subtle. */
export function sha256Hex(data: Uint8Array): string {
  const len = data.length;
  const padded = new Uint8Array(((len + 9 + 63) >> 6) << 6);
  padded.set(data);
  padded[len] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(len / 0x20000000));
  view.setUint32(padded.length - 4, (len << 3) >>> 0);
  const h = Int32Array.from(H0);
  const w = new Int32Array(64);
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getInt32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) | 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      hh = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    h[0] = (h[0] + a) | 0; h[1] = (h[1] + b) | 0; h[2] = (h[2] + c) | 0; h[3] = (h[3] + d) | 0;
    h[4] = (h[4] + e) | 0; h[5] = (h[5] + f) | 0; h[6] = (h[6] + g) | 0; h[7] = (h[7] + hh) | 0;
  }
  return [...h].map(x => (x >>> 0).toString(16).padStart(8, '0')).join('');
}

const toHex = (buf: ArrayBuffer): string => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');

/** SHA-256 в hex от строки (UTF-8) или байтов: через crypto.subtle, без него — своей реализацией. */
export async function computeAssetHash(dataUrlOrBytes: string | Uint8Array): Promise<string> {
  const bytes = typeof dataUrlOrBytes === 'string' ? new TextEncoder().encode(dataUrlOrBytes) : dataUrlOrBytes;
  const subtle = typeof crypto !== 'undefined' ? crypto.subtle : undefined;
  if (subtle) {
    try { return toHex(await subtle.digest('SHA-256', bytes as BufferSource)); } catch { /* небезопасный контекст — считаем сами */ }
  }
  return sha256Hex(bytes);
}

// ----- Хранилище -----

export interface AssetStoreOptions {
  /** IndexedDB для долговременного хранения; по умолчанию — глобальный, если он есть; null — только память. */
  idb?: IDBFactory | null;
}

type Dict = Record<string, string>;

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export class AssetStore {
  private readonly mem = new Map<string, string>();
  private readonly idb: IDBFactory | null;
  private dbPromise: Promise<IDBDatabase | null> | null = null;

  constructor(opts: AssetStoreOptions = {}) {
    this.idb = opts.idb !== undefined ? opts.idb : (typeof indexedDB !== 'undefined' ? indexedDB : null);
  }

  private db(): Promise<IDBDatabase | null> {
    if (!this.idb) return Promise.resolve(null);
    this.dbPromise ??= new Promise<IDBDatabase | null>(resolve => {
      try {
        const req = this.idb!.open(DB_NAME, 1);
        req.onupgradeneeded = () => { req.result.createObjectStore(DB_STORE); };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      } catch { resolve(null); }
    });
    return this.dbPromise;
  }

  /** Положить картинку под хэшем (в памяти и, если есть, в IndexedDB). */
  async put(hash: string, dataUrl: string): Promise<void> {
    this.mem.set(hash, dataUrl);
    const db = await this.db();
    if (!db) return;
    try { await request(db.transaction(DB_STORE, 'readwrite').objectStore(DB_STORE).put(dataUrl, hash)); } catch { /* память остаётся */ }
  }

  /** Картинка по хэшу; undefined — неизвестна. */
  async get(hash: string): Promise<string | undefined> {
    const cached = this.mem.get(hash);
    if (cached !== undefined) return cached;
    const db = await this.db();
    if (!db) return undefined;
    try {
      const v = await request(db.transaction(DB_STORE, 'readonly').objectStore(DB_STORE).get(hash));
      if (typeof v === 'string') { this.mem.set(hash, v); return v; }
    } catch { /* нет в IndexedDB */ }
    return undefined;
  }

  async has(hash: string): Promise<boolean> {
    return (await this.get(hash)) !== undefined;
  }

  get size(): number { return this.mem.size; }

  /**
   * Заменяет src вида data:image/… у картинок на asset://<sha256> и возвращает словарь вынесенных
   * картинок (хэш → data URL). Исходный проект не меняется; нетронутые страницы и элементы остаются теми же объектами.
   */
  async extractProjectAssets(project: Project): Promise<{ strippedProject: Project; assets: Dict }> {
    const assets: Dict = {};
    const hashes = new Map<string, string>(); // одинаковая строка — один подсчёт
    const strip = async (el: Element): Promise<Element> => {
      if (el.type !== 'image' || !isDataImage(el.src)) return el;
      let hash = hashes.get(el.src);
      if (!hash) {
        hash = await computeAssetHash(el.src);
        hashes.set(el.src, hash);
        assets[hash] = el.src;
        await this.put(hash, el.src);
      }
      return { ...el, src: assetRef(hash) };
    };
    const pages = await mapPages(project.pages, strip);
    return { strippedProject: pages === project.pages ? project : { ...project, pages }, assets };
  }

  /**
   * Подставляет data:image/… вместо asset://… из хранилища (и из assets, если передан). Неизвестная
   * ссылка остаётся как есть. Исходный проект не меняется.
   */
  async hydrateProjectAssets(project: Project, assets: Dict = {}): Promise<Project> {
    const restore = async (el: Element): Promise<Element> => {
      if (el.type !== 'image') return el;
      const hash = assetHashOf(el.src);
      if (!hash) return el;
      const src = assets[hash] ?? await this.get(hash);
      return src ? { ...el, src } : el;
    };
    const pages = await mapPages(project.pages, restore);
    return pages === project.pages ? project : { ...project, pages };
  }
}

/** Применяет f к элементам страниц; без изменений возвращает тот же массив страниц. */
async function mapPages(pages: Page[], f: (el: Element) => Promise<Element>): Promise<Page[]> {
  let changed = false;
  const out: Page[] = [];
  for (const page of pages) {
    const els: Element[] = [];
    let pageChanged = false;
    for (const el of page.elements) {
      const next = await f(el);
      if (next !== el) pageChanged = true;
      els.push(next);
    }
    if (pageChanged) changed = true;
    out.push(pageChanged ? { ...page, elements: els } : page);
  }
  return changed ? out : pages;
}
