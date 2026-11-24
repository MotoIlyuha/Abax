import { EGE, OGE, VPR, type ExerciseGroup } from './fipi-practice';
import imported from './fipi-imported.json';
import type { TaskExamType } from './types';

export const BANK_EXAMS = { vpr: 'ВПР', oge: 'ОГЭ', ege: 'ЕГЭ' } as const;
export type BankExam = keyof typeof BANK_EXAMS;
export type BankSubject = 'math' | 'informatics' | 'physics' | 'russian';

export interface BankTask {
  id: string;
  exam: BankExam;
  examType: TaskExamType;
  subject: BankSubject;
  number: number;
  topic: string;
  statementMd: string;
  answer: string;
  solutionMd: string;
  code?: string;
}

const PRACTICE: Record<BankExam, readonly ExerciseGroup[]> = { vpr: VPR, oge: OGE, ege: EGE };

export function bankNumbers(exam: BankExam): number[] {
  return PRACTICE[exam].map((_, i) => i + 1);
}

const TEAM_TASKS = (Object.keys(PRACTICE) as BankExam[]).flatMap(exam =>
  PRACTICE[exam].flatMap(([topic, ...items], i) => items.map(([statementMd, answer, solutionMd], variant): BankTask => ({
    id: 'abax:' + exam + ':' + (i + 1) + ':' + (variant + 1),
    exam, examType: exam === 'ege' ? 'ege_prof' : exam, subject: 'math', number: i + 1,
    topic, statementMd, answer, solutionMd,
  }))),
);

const SOURCE_TASKS = imported.flatMap((data): BankTask[] => {
  const { exam: examType, id, number, topic, statementMd, answer, solutionMd, code } = data;
  if (examType !== 'oge' && examType !== 'ege_prof' && examType !== 'ege_base') return [];
  const exam = examType === 'oge' ? 'oge' : 'ege';
  if (!bankNumbers(exam).includes(number) || !/^[0-9A-F]{6}$/.test(code)) return [];
  return [{ id, exam, examType, subject: 'math', number, topic, statementMd, answer, solutionMd, code }];
});

const BANK = [...SOURCE_TASKS, ...TEAM_TASKS].sort((a, b) => a.number - b.number);
const normalize = (text: string): string => text.toLocaleLowerCase('ru').replace(/ё/g, 'е').trim();
const searchIndex = BANK.map(task => normalize([task.code, task.topic, task.statementMd, task.code ? 'ФИПИ' : 'Тренировка'].join(' ')));

export interface BankFilters {
  subject: BankSubject;
  exam: BankExam;
  number?: number | null;
  query?: string;
}

/** Поиск по всем словам запроса, включая шестизначный код с символом #. */
export function filterBankTasks({ subject, exam, number, query = '' }: BankFilters): BankTask[] {
  const words = normalize(query.replace(/#/g, '')).split(/\s+/).filter(Boolean);
  return BANK.filter((task, index) => task.subject === subject && task.exam === exam
    && (number == null || task.number === number) && words.every(word => searchIndex[index].includes(word)));
}
