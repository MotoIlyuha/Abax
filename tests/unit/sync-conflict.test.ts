import { describe, expect, it } from 'vitest';
import { contentSignature, cyrb53 } from '../../src/sync-conflict';
import { parseProject, serializeProject } from '../../src/file';
import type { Project } from '../../src/types';

const task = { id: 't', type: 'task', x: 0, y: 0, w: 360, h: 220, taskId: 't1', examType: 'oge', topic: '', statementMd: 'Сколько?', answer: '4' };
const rect = { id: 'r', type: 'shape', shape: 'rect', x: 0, y: 0, w: 10, h: 10, color: '#000', width: 2 };
const project = (): Project => ({
  id: 'p', name: 'Доска', createdAt: 1, updatedAt: 2,
  pages: [{ id: 'g', name: 'Стр', grid: 'square', elements: [rect as never, task as never] }],
});

describe('подпись содержимого', () => {
  it('cyrb53 стабилен и различает строки', () => {
    expect(cyrb53('abc')).toBe(cyrb53('abc'));
    expect(cyrb53('abc')).not.toBe(cyrb53('abd'));
    expect(cyrb53('')).toMatch(/^[0-9a-f]{14}$/);
  });

  it('одинаковое содержимое — одинаковая подпись, порядок полей не важен', () => {
    const a = project();
    const b: Project = { pages: a.pages.map(pg => ({ elements: pg.elements.map(e => ({ ...e })), grid: pg.grid, name: pg.name, id: pg.id })), updatedAt: 2, createdAt: 1, name: 'Доска', id: 'p' };
    expect(contentSignature(a)).toBe(contentSignature(b));
    expect(contentSignature(a)).toMatch(/^v1:/);
  });

  it('метки времени, тариф и права не меняют подпись', () => {
    const a = project();
    expect(contentSignature({ ...a, updatedAt: 999, createdAt: 5, ownerPlan: 'pro', permissions: { allowCopy: false } })).toBe(contentSignature(a));
  });

  it('живые поля (реакции, ввод учеников, комментарии) не меняют подпись', () => {
    const a = project();
    const live: Project = {
      ...a,
      pages: [{
        ...a.pages[0],
        comments: [{ id: 'c', x: 1, y: 1, messages: [] } as never],
        elements: a.pages[0].elements.map(e => (e.id === 't'
          ? { ...e, attempts: [{ value: '3', correct: false, at: 1, by: 'x' }], studentDraft: '3' } as never
          : { ...e, reactions: { '👍': ['u'] } } as never)),
      }],
    };
    expect(contentSignature(live)).toBe(contentSignature(a));
  });

  it('правки автора меняют подпись', () => {
    const a = project();
    const sig = contentSignature(a);
    expect(contentSignature({ ...a, name: 'Другая' })).not.toBe(sig);
    expect(contentSignature({ ...a, pages: [{ ...a.pages[0], name: 'Стр 2' }] })).not.toBe(sig);
    expect(contentSignature({ ...a, pages: [{ ...a.pages[0], elements: [{ ...rect, x: 5 } as never, task as never] }] })).not.toBe(sig);
    expect(contentSignature({ ...a, pages: [{ ...a.pages[0], elements: [task as never, rect as never] }] })).not.toBe(sig);
    expect(contentSignature({ ...a, pages: [...a.pages, { id: 'g2', name: 'Ещё', grid: 'square', elements: [] }] })).not.toBe(sig);
  });

  it('элементы, которые не пройдут проверку формы на сервере, в подписи не учитываются', () => {
    const a = project();
    const noisy = { ...a, pages: [{ ...a.pages[0], elements: [...a.pages[0].elements, { id: 'bad', type: 'нет-такого' }] }] } as unknown as Project;
    expect(contentSignature(noisy)).toBe(contentSignature(a));
  });

  it('сохранение и загрузка не меняют подпись', () => {
    const a = project();
    const round = parseProject(JSON.parse(serializeProject(a)))!;
    expect(round.pages[0].elements).toHaveLength(2);
    expect(contentSignature(round)).toBe(contentSignature(a));
  });
});
