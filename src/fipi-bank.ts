import { EGE, OGE, VPR, type ExerciseGroup } from './fipi-practice';
import imported from './fipi-imported.json';
import { BANK_EXAMS, type CatalogExam } from '../shared/task-catalog';

export { BANK_EXAMS };
export type BankExam = CatalogExam;
export type BankSubject = 'math' | 'informatics' | 'physics' | 'russian';

export interface BankTask {
  id: string;
  exam: BankExam;
  examType: BankExam;
  subject: BankSubject;
  number: number;
  topic: string;
  statementMd: string;
  answer: string;
  solutionMd: string;
  code?: string;
}

const PRACTICE: Record<BankExam, readonly ExerciseGroup[]> = { vpr: VPR, oge: OGE, ege_base: [], ege_prof: EGE };

export function bankNumbers(exam: BankExam): number[] {
  const count = exam === 'ege_base' ? 21 : PRACTICE[exam].length;
  return Array.from({ length: count }, (_, i) => i + 1);
}

const TEAM_TASKS = (Object.keys(PRACTICE) as BankExam[]).flatMap(exam =>
  PRACTICE[exam].flatMap(([topic, ...items], i) => items.map(([statementMd, answer, solutionMd], variant): BankTask => ({
    id: 'abax:' + (exam === 'ege_prof' ? 'ege' : exam) + ':' + (i + 1) + ':' + (variant + 1),
    exam, examType: exam, subject: 'math', number: i + 1,
    topic, statementMd, answer, solutionMd,
  }))),
);

const SOURCE_TASKS = imported.flatMap((data): BankTask[] => {
  const { exam, id, number, topic, statementMd, answer, solutionMd, code } = data;
  if (exam !== 'oge' && exam !== 'ege_prof' && exam !== 'ege_base') return [];
  if (!bankNumbers(exam).includes(number) || !/^[0-9A-F]{6}$/.test(code)) return [];
  return [{ id, exam, examType: exam, subject: 'math', number, topic, statementMd, answer, solutionMd, code }];
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
