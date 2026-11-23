import { randomUUID } from 'node:crypto';
import { changeStatus, editLesson, lessonId, moveLesson, newLesson, reconcileSchedule, timestamp, type Lesson } from '../src/tutor-lessons';
import { key, type Student } from '../src/tutor-model';
import { requireUser } from './auth';
import { HttpError, type Ctx, type Router } from './router';
import { mutation, saveStudent, studentOf } from './tutor-students';

type Row = Lesson & { tutor_id: string };
function lessonRow({ tutor_id: _owner, ...l }: Row): Lesson { return l; }
export function lessonsOf(ctx: Ctx, studentId: string): Lesson[] {
  return (ctx.app.db.prepare('SELECT * FROM tutor_lessons WHERE tutor_id=? AND student_id=? ORDER BY start_at,id')
    .all(requireUser(ctx).id, studentId) as Row[]).map(lessonRow);
}
export function lessonOf(ctx: Ctx, id: string): Lesson {
  const row = ctx.app.db.prepare('SELECT * FROM tutor_lessons WHERE tutor_id=? AND id=?').get(requireUser(ctx).id, id) as Row | undefined;
  if (!row) throw new HttpError(404, 'lesson-not-found');
  return lessonRow(row);
}
export function saveLesson(ctx: Ctx, lesson: Lesson, create = false): void {
  const values = { ...lesson, tutor_id: requireUser(ctx).id };
  const fields = Object.keys(values);
  if (create) {
    const changed = ctx.app.db.prepare(`INSERT INTO tutor_lessons (${fields}) VALUES (${fields.map(f => '@' + f)}) ON CONFLICT(id) DO NOTHING`).run(values).changes;
    if (!changed) throw new HttpError(409, 'lesson-exists');
  } else {
    ctx.app.db.prepare(`UPDATE tutor_lessons SET ${fields.map(f => f + '=@' + f)} WHERE id=@id AND tutor_id=@tutor_id`).run(values);
  }
}
export function materialize(ctx: Ctx, student: Student, now: number): void {
  const old = lessonsOf(ctx, student.id);
  const existing = new Set(old.map(l => l.id));
  const { write, remove } = reconcileSchedule(student, old, now);
  for (const l of write) saveLesson(ctx, l, !existing.has(l.id));
  for (const id of remove) ctx.app.db.prepare('DELETE FROM tutor_lessons WHERE id=? AND tutor_id=?').run(id, requireUser(ctx).id);
}
export function settle(ctx: Ctx, l: Lesson, status: unknown, now: number): Lesson {
  const s = studentOf(ctx, l.student_id);
  const charged = ctx.app.db.prepare('SELECT COALESCE(-SUM(amount),0) AS total FROM tutor_payments WHERE student_id=? AND lesson_id=?').get(s.id, l.id) as { total: number };
  const { lesson, amount } = changeStatus(l, status, s.balance, charged.total, now);
  if (amount) {
    saveStudent(ctx, { ...s, balance: s.balance + amount, updated_at: now });
    ctx.app.db.prepare('INSERT INTO tutor_payments VALUES (?,?,?,?,?,?)').run(randomUUID(), requireUser(ctx).id, s.id, l.id, amount, now);
  }
  return lesson;
}
export function registerCalendar(router: Router): void {
  const path = '/api/tutor/lessons';
  router.get(path, ctx => {
    const owner = requireUser(ctx).id;
    const from = Number(ctx.query.get('from') ?? 0), to = Number(ctx.query.get('to') ?? Number.MAX_SAFE_INTEGER);
    if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from > to) throw new HttpError(400, 'bad-period');
    return { json: (ctx.app.db.prepare('SELECT * FROM tutor_lessons WHERE tutor_id=? AND start_at>=? AND start_at<? ORDER BY start_at,id').all(owner, from, to) as Row[]).map(lessonRow) };
  });
  router.get(path + '/:id', ctx => ({ json: lessonOf(ctx, ctx.params.id) }));
  router.post(path, ctx => mutation(ctx, (body, now) => {
    const s = studentOf(ctx, key(body.student_id));
    const l = editLesson(newLesson(s, key(body.id ?? randomUUID()), timestamp(body.start_at), now), body, now);
    saveLesson(ctx, l, true);
    return l;
  }));
  router.patch(path + '/:id', ctx => mutation(ctx, (body, now) => {
    const old = lessonOf(ctx, ctx.params.id);
    if ('start_at' in body && old.schedule_slot_id && old.start_at !== body.start_at) throw new HttpError(409, 'use-reschedule');
    const edited = editLesson(old, body, now);
    const result = 'status' in body ? settle(ctx, edited, body.status, now) : edited;
    saveLesson(ctx, result);
    return result;
  }));
  router.delete(path + '/:id', ctx => mutation(ctx, (_body, now) => {
    const l = lessonOf(ctx, ctx.params.id);
    const cancelled = settle(ctx, l, 'cancelled', now);
    saveLesson(ctx, cancelled);
    return cancelled;
  }));
  router.post(path + '/:id/reschedule', ctx => mutation(ctx, (body, now) => {
    const old = lessonOf(ctx, ctx.params.id), at = timestamp(body.start_at);
    const all = body.scope === 'following' && old.schedule_slot_id;
    const batch = all ? lessonsOf(ctx, old.student_id).filter(l => l.schedule_slot_id === old.schedule_slot_id &&
      l.start_at >= old.start_at && l.status === 'scheduled') : [old];
    const moved: Lesson[] = [];
    if (!batch.some(l => l.id === old.id)) throw new HttpError(409, 'cannot-reschedule');
    for (const l of batch) {
      const id = l.id === old.id ? lessonId(body.id ?? randomUUID()) : randomUUID();
      const [before, after] = moveLesson(l, l.start_at + at - old.start_at, id, now);
      const replacement = editLesson(after, body.duration_min === undefined ? {} : { duration_min: body.duration_min }, now);
      saveLesson(ctx, before);
      saveLesson(ctx, replacement, true);
      moved.push(replacement);
    }
    return moved;
  }));
}
