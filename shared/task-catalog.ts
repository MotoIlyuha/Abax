import type { TaskIllustration } from '../src/task-illustration';
import type { TaskSubject } from '../src/types';

export interface CatalogSubject {
  id: string;
  name: string;
  boardSubject: TaskSubject;
}

export const BANK_EXAMS = { vpr: 'ВПР', oge: 'ОГЭ', ege_base: 'ЕГЭ | База', ege_prof: 'ЕГЭ | Профиль' } as const;
export type CatalogExam = keyof typeof BANK_EXAMS;

export interface CatalogTaskFields {
  subjectId: string;
  exam: CatalogExam;
  number: number | null;
  topic: string;
  statementMd: string;
  answer: string;
  solutionMd: string;
  code: string;
  sourceUrl: string;
  published: boolean;
}

export interface CatalogTask extends CatalogTaskFields {
  id: string;
  subjectName: string;
  boardSubject: TaskSubject;
  imageCount: number;
  illustrations?: TaskIllustration[];
}

export interface CatalogPage {
  items: CatalogTask[];
  page: number;
  hasMore: boolean;
  numbers: number[];
}

export function catalogSourceLabel(task: Pick<CatalogTask, 'code' | 'sourceUrl'>): string {
  if (!task.code) return task.sourceUrl ? 'Источник' : 'Тренировка';
  const fipi = !task.sourceUrl || /^https?:\/\/(?:[\w-]+\.)*fipi\.ru(?:[/:]|$)/i.test(task.sourceUrl);
  return (fipi ? 'ФИПИ #' : '#') + task.code;
}

export const catalogSearchText = (text: string): string => text.toLocaleLowerCase('ru').replace(/ё/g, 'е').trim();
