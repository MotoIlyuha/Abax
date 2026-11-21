import { beforeEach, describe, expect, it } from 'vitest';
import {
  STARTER_PAGE_NAME, STARTER_PROJECT_NAME, SYNC_STATUS_TEXT, clearStarter, clearSyncBase, getSyncBase, isPristineStarterProject,
  markStarter, setSyncBase, starterId, syncStatusOf,
} from '../../src/sync-state';
import { blankProject } from '../../src/state';
import type { Project } from '../../src/types';

const starter = (): Project => blankProject(STARTER_PROJECT_NAME);

describe('стартовая заглушка', () => {
  beforeEach(() => localStorage.clear());

  it('метка ставится, читается и снимается только для своего проекта', () => {
    expect(starterId()).toBeNull();
    markStarter('a');
    expect(starterId()).toBe('a');
    clearStarter('b');
    expect(starterId()).toBe('a');
    clearStarter('a');
    expect(starterId()).toBeNull();
    markStarter('c');
    clearStarter();
    expect(starterId()).toBeNull();
  });

  it('пустой автоматически созданный проект - заглушка', () => {
    const p = starter();
    expect(p.pages[0].name).toBe(STARTER_PAGE_NAME);
    expect(isPristineStarterProject(p, p.id)).toBe(true);
  });

  it('без метки или с меткой другого проекта - не заглушка', () => {
    const p = starter();
    expect(isPristineStarterProject(p, null)).toBe(false);
    expect(isPristineStarterProject(p, 'другой')).toBe(false);
    expect(isPristineStarterProject(null, p.id)).toBe(false);
  });

  it('любая пользовательская правка снимает признак', () => {
    const base = starter();
    const id = base.id;
    const variants: Project[] = [
      { ...base, name: 'Моя доска' },
      { ...base, pages: [...base.pages, { ...base.pages[0], id: 'p2' }] },
      { ...base, pages: [{ ...base.pages[0], elements: [{ id: 'e', type: 'shape', shape: 'rect', x: 0, y: 0, w: 1, h: 1, color: '#000', width: 1 } as never] }] },
      { ...base, pages: [{ ...base.pages[0], name: 'Алгебра' }] },
      { ...base, pages: [{ ...base.pages[0], grid: 'dots' as never }] },
      { ...base, pages: [{ ...base.pages[0], backgroundColor: '#fff' }] },
      { ...base, pages: [{ ...base.pages[0], coordLabels: false }] },
      { ...base, pages: [{ ...base.pages[0], comments: [{ id: 't', x: 0, y: 0, messages: [] } as never] }] },
      { ...base, permissions: { allowCopy: false } },
      { ...base, icon: '📘' },
      { ...base, pinned: true },
    ];
    for (const v of variants) expect(isPristineStarterProject(v, id)).toBe(false);
  });

  it('пустой список комментариев не мешает', () => {
    const p = starter();
    expect(isPristineStarterProject({ ...p, pages: [{ ...p.pages[0], comments: [] }] }, p.id)).toBe(true);
  });
});

describe('статус синхронизации', () => {
  it('без облака и при подавлении - скрыт', () => {
    expect(syncStatusOf({ cloud: false })).toBe('hidden');
    expect(syncStatusOf({ cloud: true, suppressed: true, busy: true })).toBe('hidden');
  });

  it('обычный путь: в полёте - синхронизация, иначе сохранено', () => {
    expect(syncStatusOf({ cloud: true })).toBe('synced');
    expect(syncStatusOf({ cloud: true, busy: true })).toBe('syncing');
  });

  it('сеть и лимит', () => {
    expect(syncStatusOf({ cloud: true, networkError: true, busy: true })).toBe('offline');
    expect(syncStatusOf({ cloud: true, limit: true, networkError: true })).toBe('limit');
  });

  it('черновик офлайн-конфликта главнее остального, но не показывается при подавлении', () => {
    expect(syncStatusOf({ cloud: true, draft: true, busy: true, limit: true, room: 'open' })).toBe('draft');
    expect(syncStatusOf({ cloud: true, draft: true, suppressed: true })).toBe('hidden');
    expect(SYNC_STATUS_TEXT.draft).toBe('Есть офлайн-правки с этого устройства');
  });

  it('облачная комната автора главнее отправок', () => {
    expect(syncStatusOf({ cloud: true, room: 'open', networkError: true })).toBe('synced');
    expect(syncStatusOf({ cloud: true, room: 'reconnecting' })).toBe('offline');
  });

  it('тексты индикатора', () => {
    expect(SYNC_STATUS_TEXT.synced).toBe('Сохранено в облаке');
    expect(SYNC_STATUS_TEXT.syncing).toBe('Синхронизация…');
    expect(SYNC_STATUS_TEXT.offline).toBe('Сохранено на устройстве (офлайн)');
    expect(SYNC_STATUS_TEXT.limit).toBe('Только на устройстве (превышен лимит тарифа)');
  });
});

describe('подпись версии с сервера', () => {
  beforeEach(() => localStorage.clear());
  it('хранится по проекту', () => {
    expect(getSyncBase('p')).toBeNull();
    setSyncBase('p', 'v1:abc');
    expect(getSyncBase('p')).toBe('v1:abc');
    expect(getSyncBase('q')).toBeNull();
    clearSyncBase('p');
    expect(getSyncBase('p')).toBeNull();
  });
});
