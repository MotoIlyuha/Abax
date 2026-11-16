// Общее для серверных тестов Ночи №3: приложение в памяти и маленький HTTP-клиент.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAppServer, type AppOptions, type AppServer, type RouteModule } from '../../server/app';

export const BOT_TOKEN = '123456:TEST-BOT-TOKEN';

export interface TestApp extends AppServer {
  base: string;
  dir: string;
  /** Часы сервера: тест двигает время, меняя clock.t. */
  clock: { t: number };
  stop(): Promise<void>;
}

const apps: TestApp[] = [];

/** Приложение с базой в памяти на свободном порту; закрывается через closeApps() в afterEach. */
export async function makeApp(over: Partial<AppOptions> = {}, extra: RouteModule[] = []): Promise<TestApp> {
  const dir = mkdtempSync(join(tmpdir(), 'abax-test-'));
  const clock = { t: Date.UTC(2026, 10, 1, 12, 0, 0) };
  const srv = createAppServer({
    dbPath: ':memory:', assetsDir: join(dir, 'assets'), jwtSecret: 'test-secret', telegramBotToken: BOT_TOKEN,
    enforceLimits: true, publicWebUrl: 'https://abax.example', now: () => clock.t, ...over,
  }, extra);
  const { url } = await srv.listen(0, '127.0.0.1');
  const app: TestApp = Object.assign(srv, {
    base: url, dir, clock,
    async stop() { await srv.close(); rmSync(dir, { recursive: true, force: true }); },
  });
  apps.push(app);
  return app;
}

export async function closeApps(): Promise<void> {
  for (const a of apps.splice(0)) await a.stop().catch(() => {});
}

export interface Resp<T = any> { status: number; body: T; headers: Headers }

export interface CallOptions { token?: string; headers?: Record<string, string> }

export async function call<T = any>(app: { base: string }, method: string, path: string, body?: unknown, opts: CallOptions = {}): Promise<Resp<T>> {
  const headers: Record<string, string> = { ...opts.headers };
  if (body !== undefined && typeof body !== 'string') headers['Content-Type'] = 'application/json';
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  const res = await fetch(app.base + path, { method, headers, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
  const text = await res.text();
  let parsed: any = text;
  try { parsed = text ? JSON.parse(text) : null; } catch { /* не JSON */ }
  return { status: res.status, body: parsed, headers: res.headers };
}

let seq = 0;
export const deviceToken = (): string => `device-token-${Date.now()}-${++seq}-`.padEnd(40, 'x');

/** Анонимный вход: токен сессии и пользователь. */
export async function anon(app: { base: string }, device = deviceToken()): Promise<{ token: string; id: string; device: string; body: any }> {
  const r = await call(app, 'POST', '/api/auth/anon', { deviceToken: device });
  if (r.status !== 200) throw new Error(`anon: ${r.status} ${JSON.stringify(r.body)}`);
  return { token: r.body.token, id: r.body.user.id, device, body: r.body };
}

export function setPlan(app: AppServer, userId: string, plan: string, expiresAt: number | null = null): void {
  app.db.prepare('UPDATE users SET plan = ?, plan_expires_at = ? WHERE id = ?').run(plan, expiresAt, userId);
}

// ----- Данные для проектов -----

export const rectEl = (id: string) => ({ id, type: 'shape', shape: 'rect', x: 0, y: 0, w: 10, h: 10, color: '#000000', width: 2 });
export const taskEl = (over: Record<string, unknown> = {}) => ({
  id: 't1', type: 'task', x: 0, y: 0, w: 360, h: 220, taskId: 'tk', examType: 'oge', topic: '', statementMd: 'Сколько будет 6×7?',
  answer: '42', solutionMd: 'СЕКРЕТНОЕ-РЕШЕНИЕ', ...over,
});

/** Проект из двух страниц: на первой задание и фигура, на второй фигура. */
export function proj(id: string, over: Record<string, unknown> = {}): any {
  return {
    id, name: `Проект ${id}`, createdAt: 1, updatedAt: 1,
    pages: [
      { id: `${id}-p1`, name: 'Первая', grid: 'square', elements: [taskEl(), rectEl('r1')] },
      { id: `${id}-p2`, name: 'Вторая', grid: 'square', elements: [rectEl('r2')] },
    ],
    ...over,
  };
}

export const putProject = (app: { base: string }, token: string, project: any, expectedRev?: number) =>
  call(app, 'PUT', `/api/projects/${project.id}`, { project, ...(expectedRev !== undefined ? { expectedRev } : {}) }, { token });

export interface InviteSpec { defaultRole?: string; allowCopy?: number; pageRights?: Record<string, string>; revoked?: number; expiresAt?: number | null }

/** Приглашение напрямую в базе (маршруты приглашений проверяются отдельно). */
export function addInvite(app: AppServer, token: string, projectId: string, createdBy: string, spec: InviteSpec = {}): string {
  app.db.prepare('INSERT INTO invites (token, project_id, created_by, default_role, allow_copy, page_rights_json, revoked, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)')
    .run(token, projectId, createdBy, spec.defaultRole ?? 'edit', spec.allowCopy ?? 1, JSON.stringify(spec.pageRights ?? {}), spec.revoked ?? 0, spec.expiresAt ?? null);
  return token;
}

/** Правка сохранённого проекта мимо API (так в базе оказываются ответы учеников, которых автор не видел). */
export function editStored(app: AppServer, id: string, edit: (p: any) => void): void {
  const row = app.db.prepare('SELECT data_json, rev FROM projects WHERE id = ?').get(id) as { data_json: string; rev: number };
  const p = JSON.parse(row.data_json);
  edit(p);
  app.db.prepare('UPDATE projects SET data_json = ?, rev = ? WHERE id = ?').run(JSON.stringify(p), row.rev + 1, id);
}
