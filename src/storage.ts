import type { Board, BoardMeta } from './types';

export interface BoardsStorage {
  list(): Promise<BoardMeta[]>;
  load(id: string): Promise<Board | null>;
  save(board: Board): Promise<void>;
  remove(id: string): Promise<void>;
}

export interface DoskaApi {
  list(): Promise<BoardMeta[]>;
  load(id: string): Promise<Board | null>;
  save(board: Board): Promise<void>;
  remove(id: string): Promise<void>;
  exportPng(dataUrl: string, name: string): Promise<boolean>;
  pickPdf(): Promise<string | null>;
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
  for (const k of ['list', 'load', 'save', 'remove', 'exportPng']) {
    if (typeof api[k] !== 'function') return undefined;
  }
  return candidate as DoskaApi;
}

export const doskaApi: DoskaApi | undefined = resolveApi();

const IDX_KEY = 'doska.index';
const boardKey = (id: string) => `doska.b.${id}`;

const lsStorage: BoardsStorage = {
  async list(): Promise<BoardMeta[]> {
    try {
      const metas = JSON.parse(localStorage.getItem(IDX_KEY) || '[]') as BoardMeta[];
      return metas.sort((a, b) => b.updatedAt - a.updatedAt);
    } catch {
      return [];
    }
  },
  async load(id): Promise<Board | null> {
    try {
      return JSON.parse(localStorage.getItem(boardKey(id)) || 'null') as Board | null;
    } catch {
      return null;
    }
  },
  async save(board): Promise<void> {
    const metas = await lsStorage.list();
    const meta: BoardMeta = { id: board.id, name: board.name, createdAt: board.createdAt, updatedAt: board.updatedAt };
    localStorage.setItem(IDX_KEY, JSON.stringify([meta, ...metas.filter(m => m.id !== board.id)]));
    localStorage.setItem(boardKey(board.id), JSON.stringify(board));
  },
  async remove(id): Promise<void> {
    const metas = await lsStorage.list();
    localStorage.setItem(IDX_KEY, JSON.stringify(metas.filter(m => m.id !== id)));
    localStorage.removeItem(boardKey(id));
  },
};

export const storage: BoardsStorage = doskaApi
  ? {
      list: () => doskaApi.list(),
      load: id => doskaApi.load(id),
      save: board => doskaApi.save(board),
      remove: id => doskaApi.remove(id),
    }
  : lsStorage;
