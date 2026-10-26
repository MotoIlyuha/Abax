import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Project } from '../../src/types';

type StorageModule = typeof import('../../src/storage');

const project = (id: string, updatedAt: number, pages = 1): Project => ({
  id, name: `P-${id}`, createdAt: 1, updatedAt,
  pages: Array.from({ length: pages }, (_, i) => ({ id: `${id}-${i}`, name: `Стр ${i + 1}`, grid: 'square' as const, elements: [] })),
});

async function load(): Promise<StorageModule> {
  vi.resetModules();
  return import('../../src/storage');
}

beforeEach(() => {
  localStorage.clear();
  delete window.doskaAPI;
});
afterEach(() => {
  delete window.doskaAPI;
});

describe('localStorage-хранилище (браузер)', () => {
  it('без doskaAPI используется localStorage', async () => {
    const m = await load();
    expect(m.doskaApi).toBeUndefined();
    expect(await m.storage.list()).toEqual([]);
  });

  it('save/list/load/remove', async () => {
    const { storage } = await load();
    await storage.save(project('a', 10));
    await storage.save(project('b', 20, 3));
    await storage.save(project('a', 30)); // пересохранение не плодит дубль
    const metas = await storage.list();
    expect(metas.map(m => m.id)).toEqual(['a', 'b']); // свежие сверху
    expect(metas[1]).toEqual({ id: 'b', name: 'P-b', createdAt: 1, updatedAt: 20, pageCount: 3 });
    expect((await storage.load('b'))?.pages).toHaveLength(3);
    await storage.remove('a');
    expect((await storage.list()).map(m => m.id)).toEqual(['b']);
    expect(await storage.load('a')).toBeNull();
  });

  it('избранное сохраняется в метаданных', async () => {
    const { storage } = await load();
    await storage.save({ ...project('a', 10), pinned: true });
    await storage.save(project('b', 20));
    const metas = await storage.list();
    expect(metas.find(m => m.id === 'a')?.pinned).toBe(true);
    expect(metas.find(m => m.id === 'b')).not.toHaveProperty('pinned');
    expect((await storage.load('a'))?.pinned).toBe(true);
    // открепили — пропало и из метаданных
    await storage.save({ ...project('a', 10), pinned: undefined });
    expect((await storage.list()).find(m => m.id === 'a')).not.toHaveProperty('pinned');
  });

  it('иконка проекта сохраняется в метаданных', async () => {
    const { storage } = await load();
    await storage.save({ ...project('a', 10), icon: '🚀' });
    await storage.save(project('b', 20));
    const metas = await storage.list();
    expect(metas.find(m => m.id === 'a')?.icon).toBe('🚀');
    expect(metas.find(m => m.id === 'b')).not.toHaveProperty('icon');
    expect((await storage.load('a'))?.icon).toBe('🚀');
    // убрали — пропала и из метаданных
    await storage.save(project('a', 10));
    expect((await storage.list()).find(m => m.id === 'a')).not.toHaveProperty('icon');
  });

  it('битые данные не роняют хранилище', async () => {
    const { storage } = await load();
    localStorage.setItem('doska.projects', '{oops');
    localStorage.setItem('doska.p.x', '{oops');
    expect(await storage.list()).toEqual([]);
    expect(await storage.load('x')).toBeNull();
  });

  it('миграция старой доски без страниц', async () => {
    const { storage } = await load();
    const el = { id: 'e', type: 'shape', shape: 'rect', x: 0, y: 0, w: 1, h: 1, color: '#000', width: 1 };
    localStorage.setItem('doska.p.old', JSON.stringify({ id: 'old', name: 'Старая', createdAt: 1, updatedAt: 2, grid: 'dots', elements: [el] }));
    localStorage.setItem('doska.p.old2', JSON.stringify({ id: 'old2', name: 'Старая', createdAt: 1, updatedAt: 2, elements: [] }));
    const p = await storage.load('old');
    expect(p).toEqual({
      id: 'old', name: 'Старая', createdAt: 1, updatedAt: 2,
      pages: [{ id: 'pg-old', name: 'Страница 1', grid: 'dots', elements: [el] }],
    });
    expect((await storage.load('old2'))?.pages[0].grid).toBe('square');
  });

  it('неизвестный формат — null', async () => {
    const { storage } = await load();
    localStorage.setItem('doska.p.z', JSON.stringify({ foo: 1 }));
    localStorage.setItem('doska.p.n', '42');
    expect(await storage.load('z')).toBeNull();
    expect(await storage.load('n')).toBeNull();
  });

  it('setStorage подменяет реализацию', async () => {
    const m = await load();
    const impl = { list: vi.fn(async () => []), load: vi.fn(), save: vi.fn(), remove: vi.fn() };
    m.setStorage(impl);
    await m.storage.list();
    expect(impl.list).toHaveBeenCalled();
  });
});

describe('Electron-хранилище (doskaAPI)', () => {
  const fullApi = () => ({
    list: vi.fn(async () => [{ id: 'a', name: 'A', createdAt: 1, updatedAt: 2, pageCount: 1 }]),
    load: vi.fn(async () => ({ id: 'a', name: 'A', createdAt: 1, updatedAt: 2, elements: [] })),
    save: vi.fn(async () => undefined),
    remove: vi.fn(async () => undefined),
    exportPng: vi.fn(), pickPdf: vi.fn(), pickImage: vi.fn(),
  });

  it('полный API подхватывается, load проходит миграцию', async () => {
    const api = fullApi();
    window.doskaAPI = api;
    const { storage, doskaApi } = await load();
    expect(doskaApi).toBe(api);
    expect(await storage.list()).toHaveLength(1);
    const p = await storage.load('a');
    expect(p?.pages).toHaveLength(1);
    await storage.save(project('a', 1));
    await storage.remove('a');
    expect(api.save).toHaveBeenCalled();
    expect(api.remove).toHaveBeenCalledWith('a');
  });

  it('неполный или некорректный API игнорируется', async () => {
    const api: Record<string, unknown> = fullApi();
    delete api.pickImage;
    window.doskaAPI = api;
    expect((await load()).doskaApi).toBeUndefined();
    window.doskaAPI = 'строка';
    expect((await load()).doskaApi).toBeUndefined();
    window.doskaAPI = null;
    expect((await load()).doskaApi).toBeUndefined();
  });
});
