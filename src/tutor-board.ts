import type { Page, Project, TaskEl } from './types';
import type { Lesson } from './tutor-lessons';
import { defaultPageTitle, TutorError, type Student } from './tutor-model';

export function pageTitle(student: Student, lesson: Lesson, lessons: Lesson[], offset: number): string {
  const d = new Date(lesson.start_at + offset * 60000);
  const ordered = lessons
    .filter((l) => l.student_id === student.id && l.status !== 'cancelled' && l.status !== 'rescheduled')
    .sort((a, b) => a.start_at - b.start_at || a.id.localeCompare(b.id));
  const fields: Record<string, string> = {
    n: String(
      1 +
        Math.max(
          0,
          ordered.findIndex((l) => l.id === lesson.id),
        ),
    ),
    date: d.toLocaleDateString('ru-RU', { timeZone: 'UTC' }),
    weekday: d.toLocaleDateString('ru-RU', { weekday: 'long', timeZone: 'UTC' }),
    student: student.name,
    subject: student.subject,
    topic: lesson.topic,
  };
  return (student.page_title_template || defaultPageTitle)
    .replace(/\{(date|weekday|student|subject|topic|n)\}/g, (_, k: string) => fields[k])
    .slice(0, 200);
}
export function studentBoard(s: Student, id: string, pageId: string, now: number): Project {
  return {
    id,
    name: s.name + ' · ' + s.subject,
    createdAt: now,
    updatedAt: now,
    pages: [{ id: pageId, name: 'Материалы', grid: 'square', elements: [] }],
  };
}
export function lessonPage(project: Project, s: Student, l: Lesson, list: Lesson[], id: string, offset: number) {
  const saved = project.pages.find((p) => p.id === l.board_page_id);
  if (saved) return { project, page: saved };
  if (!s.auto_create_page && project.pages.length) return { project, page: project.pages[0] };
  const synced = project.pages.find((p) => p.id === id);
  if (synced) {
    if (list.some((other) => other.id !== l.id && other.board_project_id === project.id && other.board_page_id === id))
      throw new TutorError('page-exists', 409);
    return { project, page: synced };
  }
  const page: Page = { id, name: pageTitle(s, l, list, offset), grid: 'square', elements: [] };
  return { project: { ...project, pages: [...project.pages, page] }, page };
}
export function progressOf(project: Project) {
  const tasks = project.pages.flatMap((page) =>
    page.elements.flatMap((el) => {
      if (el.type !== 'task') return [];
      const tries = el.attempts ?? [];
      return [
        {
          pageId: page.id,
          elementId: el.id,
          topic: el.topic,
          statement: el.statementMd,
          marked: !!el.markedHard,
          wrong: tries.filter((a) => !a.isCorrect).length,
          solved: tries.some((a) => a.isCorrect),
        },
      ];
    }),
  );
  return {
    total: tasks.length,
    solved: tasks.filter((t) => t.solved).length,
    difficult: tasks.filter((t) => t.marked || t.wrong),
  };
}
export function addReviewTask(project: Project, page: Page, source: TaskEl, id: string, taskId: string): Project {
  const { attempts: _tries, studentDraft: _draft, by: _author, reactions: _reactions, ...template } = source;
  const bottom = page.elements.reduce((y, el) => ('y' in el ? Math.max(y, el.y + ('h' in el ? el.h : 40)) : y), 0);
  const copy = { ...template, id, taskId, x: 40, y: bottom + 32, markedHard: false, solutionVisibleToStudent: false };
  return {
    ...project,
    pages: project.pages.map((p) => (p.id === page.id ? { ...p, elements: [...p.elements, copy] } : p)),
  };
}
