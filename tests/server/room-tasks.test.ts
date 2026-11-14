// Серверные функции заданий (electron/room-tasks.cjs) обязаны вести себя так же, как src/task-element.ts.
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import * as ts from '../../src/task-element';
import type { TaskEl } from '../../src/types';

const require = createRequire(import.meta.url);
const cjs = require('../../electron/room-tasks.cjs');

const base = (extra: Partial<TaskEl> = {}): TaskEl =>
  ts.createTaskElement({ x: 0, y: 0, taskId: 't', statementMd: 'У', answer: '0,75|3/4', id: 'k', solutionMd: 'реш', ...extra });

const INPUTS = ['0.75', ' 0,750 ', '3/4', '3 / 4', '−5', '-5', '5 м/с', 'Ёлка', 'елка', '', '   ', 'abc', '1e3', '.5', '5.', '+2', 'ДА'];

describe('room-tasks.cjs совпадает с task-element.ts', () => {
  it('нормализация и сравнение ответов', () => {
    for (const s of INPUTS) expect(cjs.normalizeAnswer(s), s).toBe(ts.normalizeAnswer(s));
    for (const [correct, unit] of [['0,75|3/4', undefined], ['5', 'м/с'], ['-5', undefined], ['елка', undefined], ['', undefined], ['.5', undefined]] as const) {
      for (const input of INPUTS) {
        expect(cjs.answersMatch(correct, input, unit), `${correct} / ${input}`).toBe(ts.answersMatch(correct, input, unit));
      }
    }
  });

  it('попытка ответа и черновик', () => {
    for (const el of [base(), base({ answerUnit: 'м/с', answer: '5' }), base({ attempts: [{ value: 'x', timestamp: 1, isCorrect: false }], studentDraft: 'd' })]) {
      for (const input of INPUTS) {
        expect(cjs.submitTaskAttempt(el, input, 42), input).toEqual(ts.submitTaskAttempt(el, input, 42));
        expect(cjs.updateStudentDraft(el, input), input).toEqual(ts.updateStudentDraft(el, input));
      }
    }
    // лимиты длины и числа попыток
    const long = 'я'.repeat(1500);
    expect(cjs.updateStudentDraft(base(), long)).toEqual(ts.updateStudentDraft(base(), long));
    let a = base(); let b = base();
    for (let i = 0; i < 105; i++) { a = cjs.submitTaskAttempt(a, String(i), i).updated; b = ts.submitTaskAttempt(b, String(i), i).updated; }
    expect(a).toEqual(b);
    expect(a.attempts).toHaveLength(100);
  });

  it('маскировка для ученика', () => {
    for (const el of [base(), base({ solutionVisibleToStudent: true }), base({ solutionMd: undefined })]) {
      expect(cjs.projectTaskForGuest(el)).toEqual(ts.projectTaskForRole(el, 'guest'));
    }
    expect(cjs.projectTaskForGuest(base()).answer).toBe('');
  });

  it('слияние: ввод ученика и правка автора', () => {
    const host = base({ attempts: [{ value: '1', timestamp: 5, isCorrect: false }], studentDraft: 'старый' });
    const guests: TaskEl[] = [
      { ...host, studentDraft: 'новый', answer: 'взлом', attempts: [...host.attempts!, { value: '0.75', timestamp: 6, isCorrect: false }, { value: '  ', timestamp: 7, isCorrect: true }] },
      { ...host, studentDraft: '' },
      { ...host, studentDraft: undefined },
    ];
    for (const g of guests) expect(cjs.mergeGuestTask(host, g)).toEqual(ts.mergeGuestTask(host, g));
    const known = base({ attempts: [{ value: '1', timestamp: 5, isCorrect: false }], studentDraft: 'свежий' });
    for (const inc of [base({ x: 9 }), { ...base({ x: 9 }), studentDraft: 'чужой', attempts: [] as never }, known]) {
      expect(cjs.mergeHostTask(known, inc)).toEqual(ts.mergeHostTask(known, inc));
    }
    expect(cjs.mergeHostTask(known, base({ x: 9 }))).toMatchObject({ x: 9, studentDraft: 'свежий' });
  });
});
