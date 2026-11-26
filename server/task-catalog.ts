import { randomUUID } from 'node:crypto';
import { SUBJECTS } from '../src/task-element';
import { isTaskIllustrations, TASK_ILLUSTRATION_DATA } from '../src/task-illustration';
import { BANK_EXAMS, catalogSearchText, type CatalogPage, type CatalogTask, type CatalogTaskFields, type CatalogSubject } from '../shared/task-catalog';
import type { Db } from './db';
import { HttpError, type Ctx, type Router } from './router';

const PUBLIC = '/api/task-catalog';
const ADMIN = '/api/admin/task-catalog';
const BODY = { maxBody: 8 * 1024 * 1024 };
const FROM = 'FROM catalog_tasks t JOIN catalog_subjects p ON p.id = t.subject_id';
const COLUMNS = `t.id, t.subject_id AS subjectId, t.exam, t.number, t.topic, t.statement AS statementMd,
  t.answer, t.solution AS solutionMd, t.code, t.source_url AS sourceUrl, t.published,
  p.name AS subjectName, p.board_subject AS boardSubject,
  json_array_length(t.illustrations) AS imageCount`;
type TaskRow = Omit<CatalogTask, 'published' | 'illustrations'> & { published: number; imageJson?: string };

function view({ imageJson, published, ...task }: TaskRow): CatalogTask {
  return { ...task, published: published === 1, ...(imageJson === undefined ? {} : { illustrations: JSON.parse(imageJson) }) };
}

function subjects(db: Db, publicOnly: boolean): CatalogSubject[] {
  return db.prepare(`SELECT id, name, board_subject AS boardSubject FROM catalog_subjects p
    ${publicOnly ? 'WHERE EXISTS (SELECT 1 FROM catalog_tasks t WHERE t.subject_id = p.id AND t.published = 1)' : ''}
    ORDER BY name_key`).all() as CatalogSubject[];
}

function detail(db: Db, id: string, publicOnly: boolean): CatalogTask {
  const row = db.prepare(`SELECT ${COLUMNS}, t.illustrations AS imageJson ${FROM}
    WHERE t.id = ? ${publicOnly ? 'AND t.published = 1' : ''}`).get(id) as TaskRow | undefined;
  if (!row) throw new HttpError(404, 'not-found');
  return view(row);
}

function list({ app: { db }, query }: Ctx, publicOnly: boolean): CatalogPage {
  const page = Number(query.get('page') ?? '1');
  const q = query.get('q') ?? '';
  if (!Number.isSafeInteger(page) || page < 1 || page > 10000) throw new HttpError(400, 'bad-page');
  if (q.length > 200) throw new HttpError(400, 'bad-search');
  const conditions = publicOnly ? ['t.published = 1'] : [];
  const params: (string | number)[] = [];
  for (const [key, column] of [['subject', 'p.id'], ['exam', 't.exam'], ['published', 't.published']]) {
    const value = query.get(key);
    if (!value) continue;
    if (key === 'exam' && !Object.hasOwn(BANK_EXAMS, value) || key === 'published' && !['0', '1'].includes(value)) {
      throw new HttpError(400, 'bad-catalog-task');
    }
    conditions.push(column + ' = ?');
    params.push(value);
  }
  const where = () => conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
  const numbers = (db.prepare(`SELECT DISTINCT t.number ${FROM} ${where()} ${conditions.length ? 'AND' : 'WHERE'} t.number IS NOT NULL ORDER BY t.number`)
    .all(...params) as { number: number }[]).map(row => row.number);
  const number = query.get('number');
  if (number) {
    if (!/^[1-9]\d{0,2}$/.test(number)) throw new HttpError(400, 'bad-catalog-task');
    conditions.push('t.number = ?');
    params.push(Number(number));
  }
  for (const word of catalogSearchText(q.replace(/#/g, '')).split(/\s+/).filter(Boolean)) {
    conditions.push("instr(t.search_text || ' ' || p.name_key, ?) > 0");
    params.push(word);
  }
  const size = 24;
  const rows = db.prepare(`SELECT ${COLUMNS} ${FROM} ${where()}
    ORDER BY t.number IS NULL, t.number, t.code = '', t.id LIMIT ? OFFSET ?`).all(...params, size + 1, (page - 1) * size) as TaskRow[];
  return { items: rows.slice(0, size).map(view), page, hasMore: rows.length > size, numbers };
}

function record(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  throw new HttpError(400, 'bad-catalog-task');
}

function str(value: unknown, limit: number, required = false): string {
  if (typeof value !== 'string' || value.length > limit || required && !value.trim() || value.includes('\0')) {
    throw new HttpError(400, 'bad-catalog-task');
  }
  return value.trim();
}

function source(value: unknown): string {
  const text = str(value, 2048);
  if (!text) return '';
  try {
    const url = new URL(text);
    if (['https:', 'http:'].includes(url.protocol) && !url.username && !url.password) return url.href;
  } catch { /* неверный адрес */ }
  throw new HttpError(400, 'bad-catalog-task');
}

function writeTask(db: Db, raw: unknown, id: string, create: boolean): void {
  const data = record(raw);
  const subjectId = str(data.subjectId, 80, true);
  if (!db.prepare('SELECT 1 FROM catalog_subjects WHERE id = ?').get(subjectId)) throw new HttpError(400, 'bad-catalog-subject');
  if (typeof data.exam !== 'string' || !Object.hasOwn(BANK_EXAMS, data.exam) || typeof data.published !== 'boolean'
    || (data.published || data.number !== null) && (typeof data.number !== 'number'
      || !Number.isInteger(data.number) || data.number < 1 || data.number > 999)) {
    throw new HttpError(400, 'bad-catalog-task');
  }
  const task: CatalogTaskFields = {
    subjectId, exam: data.exam as CatalogTaskFields['exam'], number: data.number as number | null,
    topic: str(data.topic, 240, true), statementMd: str(data.statementMd, 20000, true), answer: str(data.answer, 4000, data.published),
    solutionMd: str(data.solutionMd, 20000), code: str(data.code, 80), sourceUrl: source(data.sourceUrl), published: data.published,
  };
  const images = data.illustrations ?? [];
  if (!isTaskIllustrations(images)) throw new HttpError(400, 'bad-catalog-image');
  for (const { src } of images) {
    const [, mime, encoded] = TASK_ILLUSTRATION_DATA.exec(src)!;
    const bytes = Buffer.from(encoded, 'base64');
    const marker = {
      png: bytes.subarray(0, 8).toString('hex') === '89504e470d0a1a0a',
      jpeg: bytes.subarray(0, 3).toString('hex') === 'ffd8ff',
      webp: bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP',
      gif: ['GIF87a', 'GIF89a'].includes(bytes.toString('ascii', 0, 6)),
    }[mime];
    if (!marker || bytes.toString('base64') !== encoded) throw new HttpError(400, 'bad-catalog-image');
  }
  const columns = 'subject_id, exam, number, topic, statement, answer, solution, code, source_url, published, illustrations, search_text';
  const sql = create ? `INSERT INTO catalog_tasks (${columns}, id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    : `UPDATE catalog_tasks SET (${columns}) = (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) WHERE id = ?`;
  const result = db.prepare(sql).run(task.subjectId, task.exam, task.number, task.topic, task.statementMd, task.answer, task.solutionMd,
    task.code, task.sourceUrl, Number(task.published), JSON.stringify(images.map(({ src, width, height, alt }) => ({ src, width, height, alt }))),
    catalogSearchText([task.code, task.topic, task.statementMd, task.code ? 'ФИПИ' : 'Тренировка'].join(' ')), id);
  if (!result.changes) throw new HttpError(404, 'not-found');
}

function constraint(error: unknown): never {
  const code = (error as { code?: string } | null)?.code;
  if (code === 'SQLITE_CONSTRAINT_UNIQUE' || code === 'SQLITE_CONSTRAINT_PRIMARYKEY') throw new HttpError(409, 'catalog-duplicate');
  if (code === 'SQLITE_CONSTRAINT_TRIGGER' || code === 'SQLITE_CONSTRAINT_FOREIGNKEY') throw new HttpError(409, 'catalog-in-use');
  throw error;
}

export function registerTaskCatalog(router: Router): void {
  router.get(PUBLIC, ({ app }) => ({ json: subjects(app.db, true) }));
  router.get(PUBLIC + '/tasks', ctx => ({ json: list(ctx, true) }));
  router.get(PUBLIC + '/tasks/:id', ({ app, params }) => ({ json: detail(app.db, params.id, true) }));
  router.get(ADMIN, ({ app }) => ({ json: subjects(app.db, false) }));
  router.get(ADMIN + '/tasks', ctx => ({ json: list(ctx, false) }));
  router.get(ADMIN + '/tasks/:id', ({ app, params }) => ({ json: detail(app.db, params.id, false) }));

  const subjectPath = ADMIN + '/subjects';
  async function writeSubject(ctx: Ctx, create: boolean) {
    const db = ctx.app.db;
    const data = record(await ctx.body());
    const name = str(data.name, 240, true);
    const id = create ? randomUUID() : ctx.params.id;
    const key = catalogSearchText(name);
    const boardSubject = str(data.boardSubject, 40, true);
    if (!SUBJECTS.includes(boardSubject as never)) throw new HttpError(400, 'bad-catalog-subject');
    const sql = create ? 'INSERT INTO catalog_subjects (name, name_key, board_subject, id) VALUES (?, ?, ?, ?)'
      : 'UPDATE catalog_subjects SET name = ?, name_key = ?, board_subject = ? WHERE id = ?';
    try {
      if (!db.prepare(sql).run(name, key, boardSubject, id).changes) throw new HttpError(404, 'not-found');
    } catch (error) { constraint(error); }
    return { status: create ? 201 : 200, json: { id } };
  }
  router.post(subjectPath, ctx => writeSubject(ctx, true));
  router.put(subjectPath + '/:id', ctx => writeSubject(ctx, false));
  router.delete(subjectPath + '/:id', ({ app, params }) => {
    try {
      if (!app.db.prepare('DELETE FROM catalog_subjects WHERE id = ?').run(params.id).changes) throw new HttpError(404, 'not-found');
    } catch (error) { constraint(error); }
    return { status: 204 };
  });

  for (const create of [true, false]) {
    router.add(create ? 'POST' : 'PUT', ADMIN + '/tasks' + (create ? '' : '/:id'), async ctx => {
      const raw = await ctx.body();
      const id = create ? randomUUID() : ctx.params.id;
      try { writeTask(ctx.app.db, raw, id, create); } catch (error) { constraint(error); }
      return { status: create ? 201 : 200, json: detail(ctx.app.db, id, false) };
    }, BODY);
  }
  router.delete(ADMIN + '/tasks/:id', ({ app, params }) => {
    if (!app.db.prepare('DELETE FROM catalog_tasks WHERE id = ?').run(params.id).changes) throw new HttpError(404, 'not-found');
    return { status: 204 };
  });

  router.post(ADMIN + '/import', async ctx => {
    const { subjectId, items } = record(await ctx.body());
    if (!Array.isArray(items) || !items.length || items.length > 50) throw new HttpError(400, 'bad-catalog-import');
    const db = ctx.app.db;
    const duplicate = db.prepare('SELECT 1 FROM catalog_tasks WHERE exam = ? AND source_url = ? AND code = ?');
    const count = db.transaction(() => {
      let imported = 0;
      for (const [i, item] of items.entries()) {
        try {
          const raw = record(item);
          const code = str(raw.code, 80, true);
          const sourceUrl = source(raw.url ?? raw.sourceUrl);
          if (!sourceUrl || raw.needsImage && (!Array.isArray(raw.illustrations) || !raw.illustrations.length)
            || raw.imagesMissing) throw new HttpError(400, 'bad-catalog-image');
          if (duplicate.get(raw.exam, sourceUrl, code)) continue;
          writeTask(db, {
            subjectId, sourceUrl, code, exam: raw.exam, number: raw.number ?? null,
            topic: raw.topic ?? 'ФИПИ #' + code, statementMd: raw.statementMd,
            answer: raw.answer ?? '', solutionMd: raw.solutionMd ?? '', illustrations: raw.illustrations, published: false,
          }, randomUUID(), true);
          imported++;
        } catch (error) {
          if (error instanceof HttpError) throw new HttpError(error.status, error.code, { row: i + 1 });
          throw error;
        }
      }
      return imported;
    }).immediate();
    return { json: { imported: count, skipped: items.length - count } };
  }, BODY);
}
