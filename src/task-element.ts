import type { TaskAttempt, TaskEl, TaskExamType, TaskSubject } from './types';

// Задание ОГЭ/ЕГЭ на доске. Чистые функции: правильный ответ проверяет только автор (хост),
// ученику он не отправляется (projectTaskForRole), а его попытки хост пересчитывает сам (mergeGuestTask).

export const TASK_W = 360;
export const TASK_H = 220;
export const MAX_ATTEMPTS = 100;
export const MAX_DRAFT = 1000;

export const EXAM_LABELS: Record<TaskExamType, string> = {
  oge: 'ОГЭ', ege_base: 'ЕГЭ (база)', ege_prof: 'ЕГЭ (профиль)', vpr: 'ВПР', custom: 'Задание',
};
export const SUBJECT_LABELS: Record<TaskSubject, string> = {
  math: 'Математика', physics: 'Физика', informatics: 'Информатика', other: '',
};
export const EXAM_TYPES = Object.keys(EXAM_LABELS) as TaskExamType[];
export const SUBJECTS = Object.keys(SUBJECT_LABELS) as TaskSubject[];

let seq = 1;
function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `task-${Date.now().toString(36)}-${seq++}`;
}

export function createTaskElement(params: Partial<TaskEl> & { x: number; y: number; taskId: string; statementMd: string; answer: string }): TaskEl {
  return {
    ...params,
    id: params.id ?? newId(),
    type: 'task',
    w: params.w ?? TASK_W,
    h: params.h ?? TASK_H,
    examType: params.examType ?? 'custom',
    topic: params.topic ?? '',
    subject: params.subject ?? 'math',
  };
}

// ----- Проверка ответа -----

/** Ответ для сравнения: без пробелов и регистра, «,» как «.», разные минусы — одним, «ё» как «е». */
export function normalizeAnswer(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/,/g, '.')
    .replace(/[\u2212\u2013\u2014]/g, '-')
    .replace(/ё/g, 'е');
}

const NUMBER_RE = /^[+-]?(\d+(\.\d*)?|\.\d+)$/;

/** Ввод без единиц измерения в конце, если они совпадают с unit («5м/с» при unit «м/с» → «5»). */
function withoutUnit(input: string, unit?: string): string {
  const u = unit ? normalizeAnswer(unit) : '';
  return u && input.length > u.length && input.endsWith(u) ? input.slice(0, input.length - u.length) : input;
}

/**
 * Совпадает ли ввод с правильным ответом. Допустимые ответы — через «|»; числа сравниваются
 * как числа («0,25» = «0.25» = «0.250»), остальное — как нормализованные строки. Пустой ответ ничему не равен.
 */
export function answersMatch(correct: string, input: string, unit?: string): boolean {
  const given = withoutUnit(normalizeAnswer(input), unit);
  if (given === '') return false;
  for (const variant of correct.split('|')) {
    const want = withoutUnit(normalizeAnswer(variant), unit);
    if (want === '') continue;
    if (want === given) return true;
    if (NUMBER_RE.test(want) && NUMBER_RE.test(given) && Number(want) === Number(given)) return true;
  }
  return false;
}

function capAttempts(list: TaskAttempt[]): TaskAttempt[] {
  return list.length > MAX_ATTEMPTS ? list.slice(list.length - MAX_ATTEMPTS) : list;
}

/**
 * Попытка ответа: ввод нормализуется и сверяется с ответом, запись добавляется в attempts.
 * Пустой ввод попытки не создаёт. Если ответа в задании нет (ученическая копия), попытка записывается
 * как неверная — окончательно её оценит автор (mergeGuestTask).
 */
export function submitTaskAttempt(el: TaskEl, rawInput: string, now: number = Date.now()): { updated: TaskEl; isCorrect: boolean } {
  const value = rawInput.trim().slice(0, MAX_DRAFT);
  if (value === '') return { updated: el, isCorrect: false };
  const isCorrect = answersMatch(el.answer, value, el.answerUnit);
  const attempts = capAttempts([...(el.attempts ?? []), { value, timestamp: now, isCorrect }]);
  return { updated: { ...el, attempts }, isCorrect };
}

/** Ввод ученика в реальном времени; пустой черновик поле убирает. */
export function updateStudentDraft(el: TaskEl, draft: string): TaskEl {
  const next = draft.slice(0, MAX_DRAFT);
  if ((el.studentDraft ?? '') === next) return el;
  const { studentDraft: _old, ...rest } = el;
  return next === '' ? rest : { ...rest, studentDraft: next };
}

/** Пометка «сложное»: переключается; снятая пометка поля не оставляет. */
export function toggleTaskHardFlag(el: TaskEl): TaskEl {
  const { markedHard: _old, ...rest } = el;
  return el.markedHard ? rest : { ...rest, markedHard: true };
}

export type TaskRole = 'host' | 'guest';

/**
 * Задание в том виде, в каком оно уходит участнику. Ученик (guest) не получает ответ (answer = «»)
 * и решение, пока автор не открыл его (solutionVisibleToStudent). Автору — без изменений.
 */
export function projectTaskForRole(el: TaskEl, role: TaskRole): TaskEl {
  if (role === 'host') return el;
  const { solutionMd, ...rest } = el;
  return { ...rest, answer: '', ...(solutionMd !== undefined && el.solutionVisibleToStudent ? { solutionMd } : {}) };
}

const attemptKey = (a: TaskAttempt): string => `${a.timestamp}\u0000${a.value}`;

/**
 * Принимает от ученика только его ввод: свежий черновик и новые попытки, которые автор оценивает сам
 * по своему ответу. Условие, ответ, решение, флаги и положение берутся у автора (hostEl).
 * Те же данные — тот же объект.
 */
export function mergeGuestTask(hostEl: TaskEl, guestEl: TaskEl): TaskEl {
  let out = hostEl;
  // нет поля — ввод не менялся (чужая правка страницы не должна стирать черновик ученика); пустая строка — ученик очистил поле
  if (typeof guestEl.studentDraft === 'string') out = updateStudentDraft(out, guestEl.studentDraft);
  const known = new Set((hostEl.attempts ?? []).map(attemptKey));
  const fresh = (guestEl.attempts ?? []).filter(a => !known.has(attemptKey(a)) && a.value.trim() !== '');
  if (fresh.length > 0) {
    const added = fresh.map(a => ({
      value: a.value.slice(0, MAX_DRAFT), timestamp: a.timestamp, isCorrect: answersMatch(hostEl.answer, a.value, hostEl.answerUnit),
    }));
    out = { ...out, attempts: capAttempts([...(hostEl.attempts ?? []), ...added]) };
  }
  return out;
}

export type TaskStatus = 'solved' | 'unsolved' | 'none';

/** Решено — есть верная попытка; не решено — попытки есть, верной нет; нет ответа — попыток нет. */
export function taskStatus(el: TaskEl): TaskStatus {
  const attempts = el.attempts ?? [];
  if (attempts.length === 0) return 'none';
  return attempts.some(a => a.isCorrect) ? 'solved' : 'unsolved';
}

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  solved: 'Решено', unsolved: 'Не решено', none: 'Нет ответа',
};
