import { describe, expect, it } from 'vitest';
import { AssetStore, assetHashOf, assetRef, computeAssetHash, sha256Hex } from '../../src/asset-store';
import type { ImageEl, Project } from '../../src/types';

const PNG_A = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const PNG_B = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';

const img = (id: string, src: string, extra: Partial<ImageEl> = {}): ImageEl => ({ id, type: 'image', x: 0, y: 0, w: 10, h: 10, src, ...extra });
const project = (...els: ImageEl[]): Project => ({
  id: 'p', name: 'П', createdAt: 1, updatedAt: 2,
  pages: [
    { id: 'a', name: 'А', grid: 'square', elements: els.slice(0, 2) },
    { id: 'b', name: 'Б', grid: 'square', elements: els.slice(2) },
  ],
});
const srcs = (p: Project) => p.pages.flatMap(pg => pg.elements.map(e => (e as ImageEl).src));

describe('computeAssetHash', () => {
  it('SHA-256 известных значений', async () => {
    expect(await computeAssetHash('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(await computeAssetHash('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(await computeAssetHash(new TextEncoder().encode('abc'))).toBe(await computeAssetHash('abc'));
  });

  it('запасная реализация совпадает с crypto.subtle (в том числе на длинных и многобайтовых данных)', async () => {
    const samples = ['', 'a', 'abc', 'x'.repeat(55), 'x'.repeat(56), 'x'.repeat(64), 'я'.repeat(1000), PNG_A, PNG_B + PNG_A.repeat(40)];
    for (const s of samples) {
      const bytes = new TextEncoder().encode(s);
      expect(sha256Hex(bytes)).toBe(await computeAssetHash(bytes));
    }
  });

  it('без crypto.subtle считается своей реализацией', async () => {
    const real = Object.getOwnPropertyDescriptor(globalThis, 'crypto')!;
    Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true });
    try {
      expect(await computeAssetHash('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    } finally {
      Object.defineProperty(globalThis, 'crypto', real);
    }
  });
});

describe('AssetStore: вынос и возврат картинок', () => {
  it('две одинаковые картинки получают одну ссылку, а гидратация возвращает исходный data URL', async () => {
    const store = new AssetStore({ idb: null });
    const p = project(img('1', PNG_A), img('2', PNG_A), img('3', PNG_B), img('4', PNG_A, { rot: 1 }));
    const { strippedProject, assets } = await store.extractProjectAssets(p);
    const [s1, s2, s3, s4] = srcs(strippedProject);
    expect(s1).toMatch(/^asset:\/\/[0-9a-f]{64}$/);
    expect(s1).toBe(s2);
    expect(s1).toBe(s4);
    expect(s3).not.toBe(s1);
    expect(Object.keys(assets)).toHaveLength(2);
    expect(assets[assetHashOf(s1)!]).toBe(PNG_A);
    expect(assetHashOf(s1)).toBe(await computeAssetHash(PNG_A));
    // прочие поля сохраняются
    expect((strippedProject.pages[1].elements[1] as ImageEl).rot).toBe(1);

    const back = await store.hydrateProjectAssets(strippedProject);
    expect(srcs(back)).toEqual([PNG_A, PNG_A, PNG_B, PNG_A]);
    expect(back).toEqual(p);
  });

  it('исходный проект не меняется', async () => {
    const store = new AssetStore({ idb: null });
    const p = project(img('1', PNG_A), img('2', PNG_B));
    const before = JSON.stringify(p);
    await store.extractProjectAssets(p);
    expect(JSON.stringify(p)).toBe(before);
  });

  it('что выносить нечего — тот же проект; страницы и ссылки не трогаются', async () => {
    const store = new AssetStore({ idb: null });
    const link = img('l', '', { page: 'b' });
    const plain = img('u', 'https://example.org/a.png');
    const p = project(link, plain);
    const { strippedProject, assets } = await store.extractProjectAssets(p);
    expect(strippedProject).toBe(p);
    expect(assets).toEqual({});
    expect(await store.hydrateProjectAssets(p)).toBe(p);
  });

  it('нетронутые страницы остаются теми же объектами', async () => {
    const store = new AssetStore({ idb: null });
    const p = project(img('1', PNG_A), img('2', 'https://x/y.png'), img('3', 'https://x/z.png'));
    const { strippedProject } = await store.extractProjectAssets(p);
    expect(strippedProject.pages[1]).toBe(p.pages[1]);
    expect(strippedProject.pages[0]).not.toBe(p.pages[0]);
  });

  it('неизвестная ссылка остаётся ссылкой; словарь из пакета подставляется', async () => {
    const hash = await computeAssetHash(PNG_A);
    const orphan = project(img('1', assetRef(hash)), img('2', 'asset://не-хэш'));
    const empty = new AssetStore({ idb: null });
    expect(srcs(await empty.hydrateProjectAssets(orphan))).toEqual([assetRef(hash), 'asset://не-хэш']);
    expect(srcs(await empty.hydrateProjectAssets(orphan, { [hash]: PNG_A }))).toEqual([PNG_A, 'asset://не-хэш']);
  });

  it('второе хранилище восстанавливает картинки из словаря, а в своей памяти — нет', async () => {
    const a = new AssetStore({ idb: null });
    const { strippedProject, assets } = await a.extractProjectAssets(project(img('1', PNG_A)));
    expect(a.size).toBe(1);
    const b = new AssetStore({ idb: null });
    expect(srcs(await b.hydrateProjectAssets(strippedProject))).toEqual([strippedProject.pages[0].elements[0] && (strippedProject.pages[0].elements[0] as ImageEl).src]);
    expect(srcs(await b.hydrateProjectAssets(strippedProject, assets))).toEqual([PNG_A]);
  });
});

/** Минимальная имитация IndexedDB: open → upgrade → success, put/get по запросам. */
function fakeIdb(): { factory: IDBFactory; data: Map<string, unknown>; opens: number } {
  const data = new Map<string, unknown>();
  const state = { opens: 0 };
  const later = (req: Record<string, any>, result: unknown) => queueMicrotask(() => { req.result = result; req.onsuccess?.(); });
  const store = {
    put: (v: unknown, k: string) => { const r: Record<string, any> = {}; data.set(k, v); later(r, k); return r; },
    get: (k: string) => { const r: Record<string, any> = {}; later(r, data.get(k)); return r; },
  };
  const db = { createObjectStore: () => store, transaction: () => ({ objectStore: () => store }) };
  const factory = {
    open: () => {
      state.opens++;
      const r: Record<string, any> = { result: db };
      queueMicrotask(() => { r.onupgradeneeded?.(); r.onsuccess?.(); });
      return r;
    },
  } as unknown as IDBFactory;
  return { factory, data, get opens() { return state.opens; } } as never;
}

describe('AssetStore с IndexedDB', () => {
  it('картинки сохраняются в базе и находятся новым хранилищем', async () => {
    const idb = fakeIdb();
    const first = new AssetStore({ idb: idb.factory });
    const { strippedProject } = await first.extractProjectAssets(project(img('1', PNG_A)));
    expect([...idb.data.values()]).toEqual([PNG_A]);
    const second = new AssetStore({ idb: idb.factory });
    expect(srcs(await second.hydrateProjectAssets(strippedProject))).toEqual([PNG_A]);
    expect(idb.opens).toBe(2); // база открывается один раз на хранилище
    expect(await second.has(await computeAssetHash(PNG_A))).toBe(true);
    expect(await second.has('0'.repeat(64))).toBe(false);
  });

  it('сломанный IndexedDB не мешает: остаётся память', async () => {
    const broken = { open: () => { throw new Error('нет доступа'); } } as unknown as IDBFactory;
    const store = new AssetStore({ idb: broken });
    const { strippedProject } = await store.extractProjectAssets(project(img('1', PNG_A)));
    expect(srcs(await store.hydrateProjectAssets(strippedProject))).toEqual([PNG_A]);
  });
});
