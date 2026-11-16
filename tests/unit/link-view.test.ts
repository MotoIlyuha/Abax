import { describe, expect, it } from 'vitest';
import {
  NOTICE_NO_PAGE, NOTICE_NO_PROJECT, PUBLIC_WEB_URL, boardLinkFor, cloneProjectForViewer, linkBaseUrl, resolveViewProject,
} from '../../src/link-view';
import { parseBoardUrl } from '../../src/router';
import { createTaskElement, submitTaskAttempt } from '../../src/task-element';
import type { Page, Project } from '../../src/types';

const page = (id: string, extra: Partial<Page> = {}): Page => ({ id, name: id, grid: 'square', elements: [], ...extra });
const project = (pages: Page[], extra: Partial<Project> = {}): Project =>
  ({ id: 'p1', name: 'Алгебра', createdAt: 1, updatedAt: 2, pages, ...extra });
const blank = () => page('blank');

describe('ссылки', () => {
  it('база: в браузере — текущий адрес, в приложении и с file:// — веб-версия', () => {
    expect(linkBaseUrl({ protocol: 'https:', origin: 'https://x.test', pathname: '/Abax/' })).toBe('https://x.test/Abax/');
    expect(linkBaseUrl({ protocol: 'file:', origin: 'null', pathname: '/C:/app/index.html' })).toBe(PUBLIC_WEB_URL);
    expect(linkBaseUrl({ protocol: 'https:', origin: 'https://x.test', pathname: '/' }, true)).toBe(PUBLIC_WEB_URL);
  });

  it('ссылки разбираются обратно роутером', () => {
    const base = 'https://x.test/Abax/';
    const proj = boardLinkFor(base, 'project', { id: 'p1' }, 'g1')!;
    expect(parseBoardUrl(proj)).toEqual({ mode: 'view-project', projectId: 'p1' });
    const pg = boardLinkFor(base, 'page', { id: 'p1' }, 'g1')!;
    expect(parseBoardUrl(pg)).toEqual({ mode: 'view-page', projectId: 'p1', pageId: 'g1' });
    const focus = boardLinkFor(base, 'focus', { id: 'p1' }, 'g1', ['a', 'b'])!;
    expect(parseBoardUrl(focus)).toEqual({ mode: 'view-page', projectId: 'p1', pageId: 'g1', focusIds: ['a', 'b'] });
  });

  it('без данных — null', () => {
    expect(boardLinkFor('https://x.test/', 'focus', { id: 'p1' }, 'g1', [])).toBeNull();
    expect(boardLinkFor('https://x.test/', 'page', { id: 'p1' }, '')).toBeNull();
    expect(boardLinkFor('https://x.test/', 'project', { id: '' }, 'g')).toBeNull();
  });
});

describe('resolveViewProject', () => {
  const p = project([page('a'), page('b'), page('c')], { permissions: { pageRights: { b: 'hidden' } } });

  it('ссылка на проект: все страницы, кроме скрытых', () => {
    const r = resolveViewProject({ mode: 'view-project', projectId: 'p1' }, p, blank);
    expect(r.project.pages.map(x => x.id)).toEqual(['a', 'c']);
    expect(r.pageId).toBe('a');
    expect(r.notice).toBeNull();
    expect(p.pages).toHaveLength(3); // исходный проект не тронут
  });

  it('ссылка на страницу: только она', () => {
    const r = resolveViewProject({ mode: 'view-page', projectId: 'p1', pageId: 'c' }, p, blank);
    expect(r.project.pages.map(x => x.id)).toEqual(['c']);
    expect(r.pageId).toBe('c');
  });

  it('скрытая или несуществующая страница — первая видимая и сообщение', () => {
    for (const pageId of ['b', 'zzz']) {
      const r = resolveViewProject({ mode: 'view-page', projectId: 'p1', pageId }, p, blank);
      expect(r.project.pages.map(x => x.id)).toEqual(['a']);
      expect(r.notice).toBe(NOTICE_NO_PAGE);
    }
  });

  it('проекта нет — пустая доска и сообщение', () => {
    const r = resolveViewProject({ mode: 'view-project', projectId: 'p9' }, null, blank);
    expect(r).toMatchObject({ missing: true, notice: NOTICE_NO_PROJECT, pageId: 'blank' });
    expect(r.project.id).toBe('p9');
  });

  it('все страницы скрыты — пустая страница, а не падение', () => {
    const hidden = project([page('a')], { permissions: { pageRights: { a: 'hidden' } } });
    const r = resolveViewProject({ mode: 'view-project', projectId: 'p1' }, hidden, blank);
    expect(r.project.pages.map(x => x.id)).toEqual(['blank']);
  });
});

describe('cloneProjectForViewer', () => {
  it('новый id и владелец, без прав, комментариев, ответов и ввода ученика', () => {
    const t0 = createTaskElement({ x: 0, y: 0, taskId: 't', statementMd: 'У', answer: '42', id: 'task', solutionMd: 'решение' });
    const t = { ...submitTaskAttempt(t0, '42', 5).updated, studentDraft: 'x', markedHard: true };
    const src = project([page('a', { elements: [t], comments: [{ id: 'c', x: 0, y: 0, messages: [] }] })], {
      pinned: true, ownerPlan: 'tutor', permissions: { forbidClone: false, allowCopy: true },
    });
    const clone = cloneProjectForViewer(src, { plan: 'free', id: 'new', now: 99 });
    expect(clone).toMatchObject({ id: 'new', name: 'Алгебра (копия)', createdAt: 99, updatedAt: 99, ownerPlan: 'free' });
    expect(clone).not.toHaveProperty('permissions');
    expect(clone).not.toHaveProperty('pinned');
    expect(clone.pages[0]).not.toHaveProperty('comments');
    const el = clone.pages[0].elements[0] as typeof t;
    expect(el.answer).toBe('');
    expect(el).not.toHaveProperty('solutionMd');
    expect(el).not.toHaveProperty('attempts');
    expect(el).not.toHaveProperty('studentDraft');
    expect(el).not.toHaveProperty('markedHard');
    // исходник не менялся
    expect((src.pages[0].elements[0] as typeof t).answer).toBe('42');
    expect(src.id).toBe('p1');
  });

  it('страницы и элементы сохраняют id (ссылки между страницами не рвутся)', () => {
    const src = project([page('a'), page('b')]);
    expect(cloneProjectForViewer(src, { plan: 'pro', id: 'n' }).pages.map(x => x.id)).toEqual(['a', 'b']);
  });
});
