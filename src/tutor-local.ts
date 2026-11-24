import {
  changeStatus,
  editLesson,
  moveSeries,
  newLesson,
  reconcileSchedule,
  timestamp,
  type Lesson,
} from './tutor-lessons';
import { integer, record, key, studentForm, TutorError, type Student, type TutorPayment } from './tutor-model';
import { addReviewTask, lessonPage, studentBoard } from './tutor-board';
import type { BoardsStorage } from './storage';

export interface TutorBook {
  students: Student[];
  lessons: Lesson[];
  payments: TutorPayment[];
}
export type TutorAction =
  | 'student'
  | 'editStudent'
  | 'archive'
  | 'balance'
  | 'lesson'
  | 'editLesson'
  | 'move'
  | 'board'
  | 'start'
  | 'review';
export interface TutorCommand {
  action: TutorAction;
  target: string;
  body: Record<string, unknown>;
  time: number;
}
export const emptyBook = (): TutorBook => ({ students: [], lessons: [], payments: [] });
export const uid = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(16)), (n) => n.toString(16).padStart(2, '0')).join('');
export function makeCommand(action: TutorAction, target: string, fields: Record<string, unknown>): TutorCommand {
  const ids = {
    ...(action === 'student' || action === 'lesson' || action === 'move' ? { id: uid() } : {}),
    ...(['board', 'start', 'review'].includes(action)
      ? { newProjectId: uid(), homePageId: uid(), pageId: uid(), offset: -new Date().getTimezoneOffset() }
      : {}),
  };
  return { action, target, body: { ...ids, ...fields, operationId: uid() }, time: Date.now() };
}
export function endpoint({ action, target }: TutorCommand): [string, string] {
  const path = '/api/tutor/',
    s = path + 'students',
    l = path + 'lessons',
    id = '/' + encodeURIComponent(target);
  const routes: Record<TutorAction, [string, string]> = {
    student: ['POST', s],
    editStudent: ['PATCH', s + id],
    archive: ['DELETE', s + id],
    balance: ['POST', s + id + '/balance'],
    lesson: ['POST', l],
    editLesson: ['PATCH', l + id],
    move: ['POST', l + id + '/reschedule'],
    board: ['POST', s + id + '/board'],
    start: ['POST', l + id + '/start'],
    review: ['POST', s + id + '/review'],
  };
  return routes[action];
}
export type ActionResult = { id?: string; projectId?: string; pageId?: string; lessonId?: string; url?: string };
export async function applyLocal(book: TutorBook, cmd: TutorCommand, boards: BoardsStorage): Promise<ActionResult> {
  const { action, body, time, target } = cmd;
  const old = book.lessons.find((l) => l.id === target);
  const sid =
    action === 'student'
      ? key(body.id)
      : action === 'lesson'
        ? key(body.student_id)
        : ['start', 'move', 'editLesson'].includes(action)
          ? old?.student_id
          : target;
  const s = book.students.find((row) => row.id === sid);
  if (action !== 'student' && !s) throw new TutorError('student-not-found');
  if (action === 'student' || action === 'editStudent' || action === 'archive') {
    if (action === 'student' && s) throw new TutorError('student-exists', 409);
    const row = studentForm(action === 'archive' ? { archived: true } : body, sid!, time, s);
    book.students = [...book.students.filter((v) => v.id !== row.id), row];
    if (!s || 'archived' in body || 'schedule' in body || action === 'archive') {
      const { write, remove } = reconcileSchedule(
        row,
        book.lessons.filter((l) => l.student_id === row.id),
        time,
      );
      const replaced = new Set([...remove, ...write.map((l) => l.id)]);
      book.lessons = [...book.lessons.filter((l) => !replaced.has(l.id)), ...write];
    }
    return { id: row.id };
  }
  const student = s!;
  if (action === 'balance') {
    const amount = integer(body.amount, 1, 10000000);
    student.balance = integer(student.balance + amount, 0, Number.MAX_SAFE_INTEGER);
    book.payments.push({
      id: key(body.operationId),
      student_id: student.id,
      lesson_id: null,
      amount,
      created_at: time,
    });
    return { id: student.id };
  }
  if (action === 'lesson') {
    const row = editLesson(newLesson(student, key(body.id), timestamp(body.start_at), time), body, time);
    if (book.lessons.some((l) => l.id === row.id)) throw new TutorError('lesson-exists');
    book.lessons.push(row);
    return { id: row.id };
  }
  if (action === 'editLesson') {
    if (!old) throw new TutorError('lesson-not-found');
    let l = editLesson(old, body, time);
    if ('status' in body) {
      const charged = -book.payments.filter((p) => p.lesson_id === old.id).reduce((a, p) => a + p.amount, 0);
      const result = changeStatus(l, body.status, student.balance, charged, time, body.reversePayment === true);
      l = result.lesson;
      if (result.amount) {
        student.balance += result.amount;
        book.payments.push({
          id: key(body.operationId),
          student_id: student.id,
          lesson_id: l.id,
          amount: result.amount,
          created_at: time,
        });
      }
    }
    Object.assign(old, l);
    return { id: l.id };
  }
  if (action === 'move') {
    if (!old) throw new TutorError('lesson-not-found');
    const result = moveSeries(
      student,
      book.lessons.filter((l) => l.student_id === student.id),
      old,
      timestamp(body.start_at),
      body.scope === 'following',
      key(body.id),
      body.followingIds ? record(body.followingIds) : {},
      integer(body.duration_min ?? old.duration_min, 5, 720),
      time,
      uid,
    );
    const changes = new Map(result.write.map((l) => [l.id, l]));
    book.lessons = [...book.lessons.map((l) => changes.get(l.id) ?? l), ...result.create];
    student.schedule = result.schedule;
    return { id: key(body.id) };
  }
  if (action === 'start' && (!old || !['scheduled', 'current'].includes(old.status)))
    throw new TutorError('lesson-closed');
  const pid = (action === 'start' && old?.board_project_id) || student.project_id;
  let project = pid
    ? await boards.load(pid)
    : studentBoard(student, key(body.newProjectId), key(body.homePageId), time);
  if (!project) throw new TutorError('project-not-found');
  student.project_id ??= project.id;
  if (action === 'board') {
    if (!pid) await boards.save(project);
    return { projectId: project.id };
  }
  const l =
    action === 'start'
      ? old
      : book.lessons
          .filter(
            (l) =>
              l.student_id === student.id &&
              l.status === 'scheduled' &&
              l.start_at >= time &&
              (!l.board_project_id || l.board_project_id === project!.id),
          )
          .sort((a, b) => a.start_at - b.start_at)[0];
  if (!l) throw new TutorError('next-lesson-missing');
  const result = lessonPage(project, student, l, book.lessons, key(body.pageId), integer(body.offset, -720, 840));
  if (action === 'review') {
    const source = project.pages.find((p) => p.id === body.sourcePage)?.elements.find((el) => el.id === body.elementId);
    if (source?.type !== 'task') throw new TutorError('task-not-found');
    project = addReviewTask(result.project, result.page, source, key(body.operationId), key(body.operationId));
  } else {
    project = result.project;
    l.status = 'current';
  }
  await boards.save({ ...project, updatedAt: time });
  l.board_project_id = project.id;
  l.board_page_id = result.page.id;
  return { projectId: project.id, pageId: result.page.id, lessonId: l.id };
}
