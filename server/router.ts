import type { IncomingMessage } from 'node:http';
import type { UserRow } from './db';
import type { AppContext } from './context';

// Минимальный роутер поверх node:http: маршруты с параметрами `/api/projects/:id`, лимит тела, ошибки HttpError.

export class HttpError extends Error {
  constructor(readonly status: number, readonly code: string, readonly extra: Record<string, unknown> = {}) {
    super(code);
  }
}

/** Ответ обработчика: JSON или готовое тело. */
export interface Reply {
  status?: number;
  json?: unknown;
  body?: Buffer | string;
  headers?: Record<string, string>;
  /** Не отвечать: передать запрос дальше (раздаче файлов клиента). */
  next?: true;
}

export interface Ctx {
  app: AppContext;
  req: IncomingMessage;
  method: string;
  path: string;
  query: URLSearchParams;
  params: Record<string, string>;
  ip: string;
  /** Пользователь по сессии; null — без сессии. */
  user: UserRow | null;
  /** Тело запроса целиком (с лимитом маршрута). */
  raw(): Promise<Buffer>;
  /** Тело как JSON; пустое тело — undefined. */
  body(): Promise<unknown>;
}

export type Handler = (ctx: Ctx) => Promise<Reply | void> | Reply | void;

interface Route { method: string; segs: string[]; handler: Handler; maxBody: number }

export const DEFAULT_MAX_BODY = 1024 * 1024;

export class Router {
  private readonly routes: Route[] = [];

  add(method: string, pattern: string, handler: Handler, opts: { maxBody?: number } = {}): void {
    this.routes.push({ method, segs: pattern.split('/').filter(Boolean), handler, maxBody: opts.maxBody ?? DEFAULT_MAX_BODY });
  }
  get(pattern: string, handler: Handler, opts?: { maxBody?: number }): void { this.add('GET', pattern, handler, opts); }
  post(pattern: string, handler: Handler, opts?: { maxBody?: number }): void { this.add('POST', pattern, handler, opts); }
  put(pattern: string, handler: Handler, opts?: { maxBody?: number }): void { this.add('PUT', pattern, handler, opts); }
  delete(pattern: string, handler: Handler, opts?: { maxBody?: number }): void { this.add('DELETE', pattern, handler, opts); }

  /** Маршрут и его параметры; 'method' — путь известен, но метод не подходит; null — пути нет. */
  match(method: string, path: string): { route: Route; params: Record<string, string> } | 'method' | null {
    const segs = path.split('/').filter(Boolean);
    let pathKnown = false;
    for (const route of this.routes) {
      const params = matchSegs(route.segs, segs);
      if (!params) continue;
      pathKnown = true;
      if (route.method === method || (method === 'HEAD' && route.method === 'GET')) return { route, params };
    }
    return pathKnown ? 'method' : null;
  }
}

function matchSegs(pattern: string[], segs: string[]): Record<string, string> | null {
  if (pattern.length !== segs.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < pattern.length; i++) {
    const p = pattern[i];
    if (p.startsWith(':')) {
      let v: string;
      try { v = decodeURIComponent(segs[i]); } catch { return null; }
      if (v === '') return null;
      params[p.slice(1)] = v;
    } else if (p !== segs[i]) return null;
  }
  return params;
}

/** Читает тело запроса; больше лимита — 413. */
export function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > limit) { reject(new HttpError(413, 'payload-too-large')); return; }
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > limit) { reject(new HttpError(413, 'payload-too-large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', () => reject(new HttpError(400, 'bad-request')));
  });
}
