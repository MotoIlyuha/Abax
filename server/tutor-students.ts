import { materialize } from './tutor-calendar';
import { randomUUID } from 'node:crypto';
import { integer, key, record, studentForm, TutorError, type Student } from '../src/tutor-model';
import { requireUser } from './auth';
import { type Ctx, HttpError, type Router } from './router';
import { getActiveProject } from './projects';

type StudentRow = Omit<Student, 'schedule' | 'archived' | 'auto_create_page'> & {
  schedule_json: string; archived: number; auto_create_page: number; tutor_id: string;
};

function decode({ tutor_id: _owner, schedule_json, archived, auto_create_page, ...row }: StudentRow): Student {
  return { ...row, archived: !!archived, auto_create_page: !!auto_create_page, schedule: JSON.parse(schedule_json) };
}
export function studentOf(ctx: Ctx, id: string): Student {
  const row = ctx.app.db.prepare('SELECT * FROM tutor_students WHERE id=? AND tutor_id=?').get(id, requireUser(ctx).id) as StudentRow | undefined;
  if (!row) throw new HttpError(404, 'student-not-found');
  return decode(row);
}
export function allStudents(ctx: Ctx): Student[] {
  const rows = ctx.app.db.prepare('SELECT * FROM tutor_students WHERE tutor_id=? ORDER BY name,id').all(requireUser(ctx).id) as StudentRow[];
  return rows.map(decode);
}
export function saveStudent(ctx: Ctx, s: Student, create = false): void {
  const owner = requireUser(ctx).id;
  const { schedule, archived, auto_create_page, ...fields } = s;
  const values = { ...fields, archived: Number(archived), auto_create_page: Number(auto_create_page),
    schedule_json: JSON.stringify(schedule), tutor_id: owner };
  const names = Object.keys(values);
  if (create) {
    const result = ctx.app.db.prepare(`INSERT INTO tutor_students (${names}) VALUES (${names.map(k => '@' + k)}) ON CONFLICT(id) DO NOTHING`).run(values);
    if (!result.changes) throw new HttpError(409, 'student-exists');
  } else {
    ctx.app.db.prepare(`UPDATE tutor_students SET ${names.map(k => k + '=@' + k)} WHERE id=@id AND tutor_id=@tutor_id`).run(values);
  }
}

/** Операция и квитанция сохраняются одной транзакцией, в том числе при повторе после обрыва сети. */
export async function mutation(ctx: Ctx, perform: (body: Record<string, unknown>, now: number, afterCommit: (effect: () => void) => void) => unknown) {
  const owner = requireUser(ctx).id;
  try {
    const body = record(await ctx.body() ?? {});
    if (body.accountId !== undefined && body.accountId !== owner) throw new HttpError(409, 'account-changed');
    const op = body.operationId === undefined ? null : key(body.operationId);
    const request = JSON.stringify([ctx.method, ctx.path, body]);
    const db = ctx.app.db;
    const effects: (() => void)[] = [];
    const reply = db.transaction(() => {
      if (op) {
        const receipt = db.prepare('SELECT request,response FROM tutor_operations WHERE tutor_id=? AND id=?').get(owner, op) as { request: string; response: string } | undefined;
        if (receipt) {
          if (request !== receipt.request) throw new HttpError(409, 'operation-conflict');
          return { json: JSON.parse(receipt.response) };
        }
      }
      const json = perform(body, ctx.app.now(), fn => effects.push(fn));
      if (op) db.prepare('INSERT INTO tutor_operations VALUES (?,?,?,?)').run(owner, op, request, JSON.stringify(json));
      return { json };
    })();
    for (const effect of effects) effect();
    return reply;
  } catch (e) {
    if (e instanceof TutorError) throw new HttpError(e.status, e.code);
    throw e;
  }
}

export function registerStudents(router: Router): void {
  const path = '/api/tutor/students';
  router.get(path, ctx => ({ json: allStudents(ctx) }));
  router.get(path + '/:id', ctx => ({ json: studentOf(ctx, ctx.params.id) }));
  const edit = (create: boolean) => (ctx: Ctx) => mutation(ctx, (body, now) => {
    const id = create ? key(body.id ?? randomUUID()) : ctx.params.id;
    const old = create ? undefined : studentOf(ctx, id);
    const s = studentForm(body, id, now, old);
    if (s.project_id && getActiveProject(ctx.app, s.project_id)?.owner_id !== requireUser(ctx).id) throw new HttpError(404, 'project-not-found');
    saveStudent(ctx, s, create);
    if (create || 'schedule' in body || 'archived' in body) materialize(ctx, s, now);
    return s;
  });
  router.post(path, edit(true));
  router.patch(path + '/:id', edit(false));
  router.delete(path + '/:id', ctx => mutation(ctx, (_body, now) => {
    const s = { ...studentOf(ctx, ctx.params.id), archived: true, updated_at: now };
    saveStudent(ctx, s);
    materialize(ctx, s, now);
    return s;
  }));
  router.post(path + '/:id/balance', ctx => mutation(ctx, (body, now) => {
    const s = studentOf(ctx, ctx.params.id);
    const amount = integer(body.amount, 1, 10000000);
    s.balance = integer(s.balance + amount, 0, Number.MAX_SAFE_INTEGER);
    s.updated_at = now;
    saveStudent(ctx, s);
    ctx.app.db.prepare('INSERT INTO tutor_payments VALUES (?,?,?,?,?,?)').run(randomUUID(), requireUser(ctx).id, s.id, null, amount, now);
    return s;
  }));
  router.get(path + '/:id/payments', ctx => {
    const s = studentOf(ctx, ctx.params.id);
    return { json: ctx.app.db.prepare('SELECT id,student_id,lesson_id,amount,created_at FROM tutor_payments WHERE student_id=? AND tutor_id=? ORDER BY created_at,id').all(s.id, requireUser(ctx).id) };
  });
}
