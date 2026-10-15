import type { Project, ProjectMeta } from './types';

export interface BoardsStorage {
  list(): Promise<ProjectMeta[]>;
  load(id: string): Promise<Project | null>;
  save(project: Project): Promise<void>;
  remove(id: string): Promise<void>;
}

export interface DoskaApi {
  list(): Promise<ProjectMeta[]>;
  load(id: string): Promise<Project | null>;
  save(project: Project): Promise<void>;
  remove(id: string): Promise<void>;
  exportPng(dataUrl: string, name: string): Promise<boolean>;
  pickPdf(): Promise<string | null>;
  pickImage(): Promise<string | null>;
}

// Граница IPC: preload кладёт doskaAPI на window; форма проверяется в рантайме.
declare global {
  interface Window {
    doskaAPI?: unknown;
  }
}

function resolveApi(): DoskaApi | undefined {
  const candidate = typeof window !== 'undefined' ? window.doskaAPI : undefined;
  if (typeof candidate !== 'object' || candidate === null) return undefined;
  const api = candidate as Record<string, unknown>; // форма проверяется ниже
  for (const k of ['list', 'load', 'save', 'remove', 'exportPng', 'pickPdf', 'pickImage']) {
    if (typeof api[k] !== 'function') return undefined;
  }
  return candidate as DoskaApi;
}

export const doskaApi: DoskaApi | undefined = resolveApi();

const IDX_KEY = 'doska.projects';
const projectKey = (id: string) => `doska.p.${id}`;

/** Старая доска (до страниц) оборачивается в проект с одной страницей. */
function migrate(raw: unknown): Project | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (Array.isArray(o.pages)) return raw as Project;
  if (Array.isArray(o.elements)) {
    const b = o as unknown as { id: string; name: string; createdAt: number; updatedAt: number; elements: unknown[]; grid?: string };
    return {
      id: b.id,
      name: b.name,
      createdAt: b.createdAt,
      updatedAt: b.updatedAt,
      pages: [{
        id: `pg-${b.id}`,
        name: 'Страница 1',
        grid: (b.grid as Project['pages'][number]['grid']) || 'square',
        elements: b.elements as Project['pages'][number]['elements'],
      }],
    };
  }
  return null;
}

const lsStorage: BoardsStorage = {
  async list(): Promise<ProjectMeta[]> {
    try {
      const metas = JSON.parse(localStorage.getItem(IDX_KEY) || '[]') as ProjectMeta[];
      return metas.sort((a, b) => b.updatedAt - a.updatedAt);
    } catch {
      return [];
    }
  },
  async load(id): Promise<Project | null> {
    try {
      return migrate(JSON.parse(localStorage.getItem(projectKey(id)) || 'null'));
    } catch {
      return null;
    }
  },
  async save(project): Promise<void> {
    const metas = await lsStorage.list();
    const meta: ProjectMeta = {
      id: project.id, name: project.name,
      createdAt: project.createdAt, updatedAt: project.updatedAt,
      pageCount: project.pages.length,
    };
    localStorage.setItem(IDX_KEY, JSON.stringify([meta, ...metas.filter(m => m.id !== project.id)]));
    localStorage.setItem(projectKey(project.id), JSON.stringify(project));
  },
  async remove(id): Promise<void> {
    const metas = await lsStorage.list();
    localStorage.setItem(IDX_KEY, JSON.stringify(metas.filter(m => m.id !== id)));
    localStorage.removeItem(projectKey(id));
  },
};

export let storage: BoardsStorage = doskaApi
  ? {
      list: () => doskaApi.list(),
      load: async id => migrate(await doskaApi.load(id)),
      save: project => doskaApi.save(project),
      remove: id => doskaApi.remove(id),
    }
  : lsStorage;

/** Подмена хранилища (сетевой режим совместной работы). */
export function setStorage(impl: BoardsStorage): void {
  storage = impl;
}
