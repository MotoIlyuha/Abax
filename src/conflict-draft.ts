import type { Project } from './types';
import { parseProject } from './file';

// Черновик офлайн-конфликта (SPEC_NIGHT5 §2.4, уточнение): если копию «… (копия с устройства)» создать нельзя
// (лимит проектов тарифа), локальная версия хранится черновиком при исходном проекте — не отдельным проектом,
// в число проектов не входит и размножиться не может: один черновик на проект, новый конфликт заменяет прежний.
// Картинки вынесены в хранилище картинок (asset://<хэш>), в localStorage — только сам проект.

const KEY = (id: string) => `doska.conflictDraft.${id}`;

export interface ConflictDraft {
  /** Локальная версия проекта (тот же id, картинки — ссылками asset://). */
  project: Project;
  /** Когда сохранён черновик. */
  savedAt: number;
}

/** Черновик проекта; null — нет или запись повреждена. */
export function getConflictDraft(id: string): ConflictDraft | null {
  try {
    const raw = localStorage.getItem(KEY(id));
    if (!raw) return null;
    const v = JSON.parse(raw) as { project?: unknown; savedAt?: unknown };
    const project = parseProject(v.project);
    if (!project || project.id !== id) return null;
    return { project, savedAt: typeof v.savedAt === 'number' ? v.savedAt : 0 };
  } catch { return null; }
}

export function hasConflictDraft(id: string): boolean {
  try { return localStorage.getItem(KEY(id)) !== null; } catch { return false; }
}

/** Сохранить черновик; false — хранилище недоступно или переполнено (черновик не записан). */
export function setConflictDraft(project: Project, savedAt = Date.now()): boolean {
  try {
    localStorage.setItem(KEY(project.id), JSON.stringify({ project, savedAt }));
    return true;
  } catch { return false; }
}

export function clearConflictDraft(id: string): void {
  try { localStorage.removeItem(KEY(id)); } catch { /* хранилище недоступно */ }
}
