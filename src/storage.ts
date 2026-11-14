import type { Project, ProjectMeta } from './types';
import { parseProject } from './file';

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
  /** ОС и переносная ли версия — для выбора файла обновления (в старом preload нет). */
  appInfo?(): Promise<{ platform: string; portable: boolean }>;
  /** Иконка окна приложения (PNG data URL) — свои цвета логотипа. */
  setAppIcon?(png: string): Promise<boolean>;
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
      return parseProject(JSON.parse(localStorage.getItem(projectKey(id)) || 'null'));
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
      ...(project.pinned ? { pinned: true } : {}),
      ...(project.icon ? { icon: project.icon } : {}),
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
      load: async id => parseProject(await doskaApi.load(id)),
      save: project => doskaApi.save(project),
      remove: id => doskaApi.remove(id),
    }
  : lsStorage;

/** Подмена хранилища (сетевой режим совместной работы). */
export function setStorage(impl: BoardsStorage): void {
  storage = impl;
}
