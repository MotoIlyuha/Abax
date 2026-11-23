import { analytics } from '../src/tutor-analytics';
import { randomUUID } from 'node:crypto';
import { canCreateProject, isOverPageLimit } from '../src/limits';
import { addReviewTask, lessonPage, progressOf, studentBoard } from '../src/tutor-board';
import { integer, key, type Student } from '../src/tutor-model';
import type { Project } from '../src/types';
import { requireUser } from './auth';
import { activeCount, getActiveProject, getProjectRow, ownerPlanOf, projectOf, writeProject } from './projects';
import { HttpError, type Ctx, type Router } from './router';
import { lessonOf, lessonsOf, saveLesson } from './tutor-calendar';
import { allStudents, mutation, saveStudent, studentOf } from './tutor-students';
import { activeAliasOf, linkInviteOf } from './invites';
import { inviteUrl, newToken } from './invite-routes';

type Effect = (fn: () => void) => void;

function ownedBoard(ctx: Ctx, id: string) {
  const row = getActiveProject(ctx.app, id);
  if (!row || row.owner_id !== requireUser(ctx).id) throw new HttpError(404, 'project-not-found');
  return row;
}
function persist(ctx: Ctx, project: Project, effect: Effect) {
  const owner = requireUser(ctx).id;
  const existing = getProjectRow(ctx.app, project.id);
  if (existing && (existing.is_deleted || existing.owner_id !== owner)) throw new HttpError(409, 'project-exists');
  const plan = ownerPlanOf(ctx.app, owner);
  if (ctx.app.opts.enforceLimits) {
    if (!existing && !canCreateProject(plan, activeCount(ctx.app, owner))) throw new HttpError(403, 'plan-limit-projects');
    if (isOverPageLimit(plan, project.pages.length) && project.pages.length > (existing ? projectOf(existing).pages.length : 0)) throw new HttpError(403, 'plan-limit-pages');
  }
  const p = { ...project, updatedAt: ctx.app.now() };
  writeProject(ctx.app, { existing, ownerId: owner, authorId: owner, project: p, revision: { kind: 'tutor' } });
  effect(() => ctx.app.notifyProjectChanged(p.id, p));
}

function ensureBoard(ctx: Ctx, s: Student, body: Record<string, unknown>, now: number, effect: Effect) {
  if (s.project_id) return projectOf(ownedBoard(ctx, s.project_id));
  const id = key(body.newProjectId ?? randomUUID());
  if (getProjectRow(ctx.app, id)) throw new HttpError(409, 'project-exists');
  const project = studentBoard(s, id, key(body.homePageId ?? randomUUID()), now);
  persist(ctx, project, effect);
  s.project_id = project.id;
  s.updated_at = now;
  saveStudent(ctx, s);
  return project;
}
export function registerTutorBoards(router: Router): void {
  router.get('/api/tutor/analytics', ctx => {
    requireUser(ctx);
    const from = Number(ctx.query.get('from')), to = Number(ctx.query.get('to'));
    if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from < 0 || to <= from ||
        to > Date.UTC(2200,0,1) || to - from > 10 * 366 * 86400000) throw new HttpError(400, 'bad-period');
    const mode = ctx.query.get('mode') ?? 'month';
    if (!['day','week','month','custom'].includes(mode) || (mode === 'day' && to-from > 25*3600000)) throw new HttpError(400, 'bad-period');
    const students = allStudents(ctx);
    const r = analytics(students,students.flatMap(s => lessonsOf(ctx,s.id)),new Date(from),new Date(to),mode==='day');
    return { json: { ...r,bins:r.bins.map(b => ({ ...b,groups:[...b.groups.values()] })) } };
  });
  router.get('/api/tutor/snapshot', ctx => {
    const owner = requireUser(ctx).id;
    const students = allStudents(ctx);
    const lessons = students.flatMap(s => lessonsOf(ctx,s.id));
    const payments = ctx.app.db.prepare('SELECT id,student_id,lesson_id,amount,created_at FROM tutor_payments WHERE tutor_id=? ORDER BY created_at,id').all(owner);
    return { json: { accountId: owner, students, lessons, payments } };
  });
  const path = '/api/tutor/students/:id';
  router.post(path + '/board', ctx => mutation(ctx, (body, now, effect) => {
    const s = studentOf(ctx, ctx.params.id);
    return { projectId: ensureBoard(ctx, s, body, now, effect).id };
  }));
  router.post(path + '/invite', ctx => mutation(ctx, (body, now, effect) => {
    const s = studentOf(ctx, ctx.params.id);
    const p = ensureBoard(ctx, s, body, now, effect);
    const link = linkInviteOf(ctx.app, p.id);
    if (link?.disabled_at != null) throw new HttpError(409, 'invite-paused');
    const token = link?.token ?? newToken();
    if (!link) ctx.app.db.prepare('INSERT INTO invites (token,project_id,created_by,default_role,created_at) VALUES (?,?,?,?,?)')
      .run(token, p.id, requireUser(ctx).id, 'edit', now);
    const alias = activeAliasOf(ctx.app, p.id);
    saveStudent(ctx, { ...s, invite_slug: alias ?? '', updated_at: now });
    return { url: inviteUrl(ctx.app, alias ?? token), projectId: p.id };
  }));
  router.get(path + '/progress', ctx => {
    const s = studentOf(ctx, ctx.params.id);
    return { json: s.project_id ? progressOf(projectOf(ownedBoard(ctx, s.project_id))) : { total: 0, solved: 0, difficult: [] } };
  });
  router.post('/api/tutor/lessons/:id/start', ctx => mutation(ctx, (body, now, effect) => {
    const l = lessonOf(ctx, ctx.params.id);
    if (!['scheduled','current'].includes(l.status)) throw new HttpError(409, 'lesson-closed');
    const s = studentOf(ctx, l.student_id);
    const p = l.board_project_id ? projectOf(ownedBoard(ctx, l.board_project_id)) : ensureBoard(ctx,s,body,now,effect);
    const result = lessonPage(p, s, l, lessonsOf(ctx,s.id), key(body.pageId ?? randomUUID()), integer(body.offset ?? 0,-720,840));
    if (result.project !== p) persist(ctx, result.project, effect);
    saveLesson(ctx, { ...l, status: 'current', board_project_id: p.id, board_page_id: result.page.id, updated_at: now });
    const query = new URLSearchParams({ route: 'board', tutorProject: p.id, tutorPage: result.page.id });
    return { projectId: p.id, pageId: result.page.id, url: '/?' + query };
  }));
  router.post(path + '/review', ctx => mutation(ctx, (body, now, effect) => {
    const s = studentOf(ctx, ctx.params.id);
    if (!s.project_id) throw new HttpError(404, 'project-not-found');
    const p = projectOf(ownedBoard(ctx, s.project_id));
    const source = p.pages.find(page => page.id === body.sourcePage)?.elements.find(el => el.id === body.elementId);
    if (source?.type !== 'task') throw new HttpError(404, 'task-not-found');
    const lessons = lessonsOf(ctx, s.id);
    const l = lessons.find(row => row.start_at >= now && row.status === 'scheduled' && (!row.board_project_id || row.board_project_id === p.id));
    if (!l) throw new HttpError(409, 'next-lesson-missing');
    const result = lessonPage(p,s,l,lessons,key(body.pageId ?? randomUUID()),integer(body.offset ?? 0,-720,840));
    const updated = addReviewTask(result.project,result.page,source,randomUUID(),randomUUID());
    persist(ctx,updated,effect);
    saveLesson(ctx, { ...l, board_page_id: result.page.id, board_project_id: p.id, updated_at: now });
    return { lessonId: l.id, pageId: result.page.id };
  }));
}
