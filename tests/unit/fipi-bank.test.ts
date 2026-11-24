import { describe, expect, it } from 'vitest';
import { sanitizeElement } from '../../src/file';
import { createTaskElement, projectTaskForRole } from '../../src/task-element';
import { bankNumbers, filterBankTasks, type BankExam } from '../../src/fipi-bank';

describe('Банк заданий', () => {
  it.each([['vpr', 17], ['oge', 25], ['ege', 19]] as const)(
    'даёт не менее двух полных карточек на каждый номер (%s)', (exam: BankExam, count: number) => {
      expect(bankNumbers(exam)).toEqual(Array.from({ length: count }, (_, i) => i + 1));
      const all = filterBankTasks({ exam, subject: 'math' });
      expect(new Set(all.map(task => task.id)).size).toBe(all.length);
      for (const number of bankNumbers(exam)) {
        const tasks = filterBankTasks({ exam, subject: 'math', number });
        expect(tasks.length).toBeGreaterThanOrEqual(2);
        for (const task of tasks) {
          expect(task).toMatchObject({ exam, number, subject: 'math' });
          expect(task.statementMd.trim()).not.toBe('');
          expect(task.answer.trim()).not.toBe('');
          expect(task.solutionMd.trim()).not.toBe('');
        }
      }
    },
  );

  it('фильтрует одновременно по предмету, экзамену, номеру и условию или теме', () => {
    const params = { exam: 'oge', subject: 'math', number: 8 } as const;
    expect(filterBankTasks({ ...params, subject: 'physics' })).toEqual([]);
    expect(filterBankTasks({ ...params, subject: 'informatics' })).toEqual([]);
    expect(filterBankTasks({ ...params, subject: 'russian' })).toEqual([]);
    expect(filterBankTasks({ ...params, query: '  СТЕПЕНИ  √72 ' })).toHaveLength(1);
    expect(filterBankTasks({ ...params, query: 'трапеция' })).toEqual([]);
  });

  it('находит исходные карточки по коду без учёта регистра и решётки', () => {
    expect(filterBankTasks({ exam: 'oge', subject: 'math', query: 'фипи #45b944' })).toEqual([
      expect.objectContaining({ code: '45B944', number: 19, answer: '1' }),
    ]);
    expect(filterBankTasks({ exam: 'ege', subject: 'math', query: '45b944' })).toEqual([]);
    expect(filterBankTasks({ exam: 'oge', subject: 'math', number: 18, query: '45b944' })).toEqual([]);
  });

  it('сохраняет заголовок и условие задания при очистке данных ученика', () => {
    const [card] = filterBankTasks({ exam: 'oge', subject: 'math', query: '#45B944' });
    const saved = sanitizeElement(createTaskElement({
      statementMd: card.statementMd, answer: card.answer, solutionMd: card.solutionMd,
      title: 'ОГЭ № 19 · ФИПИ #45B944', taskId: 'проверка', x: 0, y: 0, solutionVisibleToStudent: false,
    }));
    expect(saved).toMatchObject({ title: 'ОГЭ № 19 · ФИПИ #45B944', answer: '1' });
    if (saved?.type !== 'task') throw new Error('Задание не сохранилось');
    const guest = projectTaskForRole(saved, 'guest');
    expect(guest).toMatchObject({ title: saved.title, statementMd: saved.statementMd, answer: '' });
    expect(guest).not.toHaveProperty('solutionMd');
  });
});
