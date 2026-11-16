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
