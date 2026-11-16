// Чистая логика доступа: скрытые страницы, маскировка заданий, права по приглашению, копия проекта.
import { describe, expect, it } from 'vitest';
import { cloneProjectForViewer, hiddenPageIds, invitePageRight, maskPagesForGuest, stripStudentData, withoutPages } from '../../src/project-access';
import { createTaskElement } from '../../src/task-element';
import type { Page, Project } from '../../src/types';

const task = createTaskElement({ id: 't', x: 0, y: 0, taskId: 'k', statementMd: 'У', answer: '42', solutionMd: 'Р' });
const rect = { id: 'r', type: 'shape' as const, shape: 'rect' as const, x: 0, y: 0, w: 1, h: 1, color: '#000000', width: 1 };
const page = (id: string, elements: Page['elements'] = [rect], extra: Partial<Page> = {}): Page => ({ id, name: id, grid: 'square', elements, ...extra });
const project = (pages: Page[], extra: Partial<Project> = {}): Project => ({ id: 'p', name: 'П', createdAt: 1, updatedAt: 1, pages, ...extra });

describe('скрытые страницы', () => {
  it('hiddenPageIds берёт только hidden; withoutPages не трогает проект без скрытых', () => {
    const p = project([page('a'), page('b')], { permissions: { pageRights: { a: 'hidden', b: 'view' } } });
    expect([...hiddenPageIds(p)]).toEqual(['a']);
    expect(withoutPages(p, hiddenPageIds(p)).pages.map(x => x.id)).toEqual(['b']);
    const clean = project([page('a')]);
    expect(withoutPages(clean, new Set(['zzz']))).toBe(clean);
    expect(hiddenPageIds(project([]))).toEqual(new Set());
  });
});

describe('маскировка', () => {
  it('maskPagesForGuest: ответ и закрытое решение убраны, страницы без заданий — те же объекты', () => {
    const plain = page('plain');
    const [a, b] = maskPagesForGuest([page('t', [task]), plain]);
    expect(a.elements[0]).toMatchObject({ answer: '' });
    expect(a.elements[0]).not.toHaveProperty('solutionMd');
    expect(b).toBe(plain);
  });

  it('stripStudentData: нет комментариев, попыток, черновика и «сложное»; ответ не трогает', () => {
    const t = { ...task, attempts: [{ value: '1', timestamp: 1, isCorrect: false }], studentDraft: 'x', markedHard: true };
    const [pg] = stripStudentData([page('a', [t, rect], { comments: [{ id: 'c', x: 0, y: 0, messages: [] }] })]);
    expect(pg).not.toHaveProperty('comments');
    const el = pg.elements[0] as typeof t;
    expect(el.answer).toBe('42');
    for (const k of ['attempts', 'studentDraft', 'markedHard']) expect(el).not.toHaveProperty(k);
    expect(pg.elements[1]).toBe(rect);
  });
});

describe('invitePageRight', () => {
  it('права приглашения, затем проекта, затем роль по умолчанию', () => {
    const p = { permissions: { pageRights: { a: 'hidden' as const, b: 'view' as const } } };
    const inv = { defaultRole: 'edit' as const, pageRights: { b: 'edit' as const } };
    expect(invitePageRight(p, inv, 'b')).toBe('edit');
    expect(invitePageRight(p, inv, 'a')).toBe('hidden');
    expect(invitePageRight(p, inv, 'z')).toBe('edit');
    expect(invitePageRight({}, { defaultRole: 'view', pageRights: {} }, 'z')).toBe('view');
  });
});

describe('cloneProjectForViewer', () => {
  it('сбрасывает «сложное» вместе с попытками и черновиком', () => {
    const t = { ...task, attempts: [{ value: '1', timestamp: 1, isCorrect: false }], studentDraft: 'x', markedHard: true };
    const clone = cloneProjectForViewer(project([page('a', [t])]), { plan: 'pro', id: 'n', now: 5 });
    const el = clone.pages[0].elements[0];
    for (const k of ['attempts', 'studentDraft', 'markedHard', 'solutionMd']) expect(el).not.toHaveProperty(k);
    expect(clone).toMatchObject({ id: 'n', ownerPlan: 'pro', createdAt: 5 });
  });
});
