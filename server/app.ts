import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { LocalFsAssetBackend, type AssetStorageBackend } from './asset-storage';
import { registerAssetRoutes } from './assets';
import { authenticate, registerAuthRoutes } from './auth';
import type { AppContext, ResolvedOptions } from './context';
import { openDb, type Db } from './db';
import { RateLimiter } from './rate-limit';
import { HttpError, Router, readBody, type Ctx, type Reply } from './router';
import { serveStatic } from './static';

export interface AppOptions {
  /** Файл базы или ':memory:'. */
  dbPath: string;
  /** Каталог блобов картинок (если не задан assetBackend). */
  assetsDir: string;
  jwtSecret: string;
  telegramBotToken?: string | null;
  enforceLimits?: boolean;
  publicWebUrl?: string;
  /** Каталог собранного клиента (dist): раздаётся тем же сервером. */
  staticDir?: string | null;
  trustProxy?: boolean;
  secureCookies?: boolean;
  anonRateMax?: number;
  anonRateWindowMs?: number;
  assetBackend?: AssetStorageBackend;
  now?: () => number;
  log?: (msg: string) => void;
}

/** Подключаемые части: другие модули добавляют свои маршруты и обработчики апгрейда WebSocket. */
export type RouteModule = (router: Router, app: AppContext) => void;

export interface AppServer {
  server: Server;
  db: Db;
  app: AppContext;
  router: Router;
  /** Обработчик запросов (для встраивания в dev-сервер Vite). */
  handler(req: IncomingMessage, res: ServerResponse): void;
  /** Подключить обработчик апгрейда WebSocket: true — путь его, запрос принят. */
  onUpgrade(fn: (req: IncomingMessage, socket: import('node:stream').Duplex, head: Buffer) => boolean): void;
  /** Обработать апгрейд (для Vite); false — путь не наш. */
  handleUpgrade(req: IncomingMessage, socket: import('node:stream').Duplex, head: Buffer): boolean;
  listen(port?: number, host?: string): Promise<{ port: number; url: string }>;
  close(): Promise<void>;
  /** Дополнительные действия при закрытии (комнаты и т. п.). */
  onClose(fn: () => void | Promise<void>): void;
  readonly url: string;
}

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Asset-Hash',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Max-Age': '600',
};

function send(res: ServerResponse, method: string, reply: Reply): void {
  const headers: Record<string, string | number> = { ...CORS_HEADERS, 'X-Content-Type-Options': 'nosniff', ...reply.headers };
  let body: Buffer;
  if (reply.json !== undefined) {
    body = Buffer.from(JSON.stringify(reply.json));
    headers['Content-Type'] ??= 'application/json; charset=utf-8';
    headers['Cache-Control'] ??= 'no-store';
  } else if (reply.body !== undefined) {
    body = Buffer.isBuffer(reply.body) ? reply.body : Buffer.from(reply.body);
  } else {
    body = Buffer.alloc(0);
  }
  headers['Content-Length'] = body.length;
  res.writeHead(reply.status ?? (body.length === 0 ? 204 : 200), headers);
  res.end(method === 'HEAD' ? undefined : body);
}

function resolveOptions(o: AppOptions): ResolvedOptions {
  return {
    jwtSecret: o.jwtSecret,
    telegramBotToken: o.telegramBotToken || null,
    enforceLimits: o.enforceLimits === true,
    publicWebUrl: (o.publicWebUrl ?? '').replace(/\/+$/, ''),
    staticDir: o.staticDir ?? null,
    trustProxy: o.trustProxy === true,
    secureCookies: o.secureCookies === true,
    anonRateMax: o.anonRateMax ?? 30,
    anonRateWindowMs: o.anonRateWindowMs ?? 3600_000,
  };
}

function clientIp(req: IncomingMessage, trustProxy: boolean): string {
  if (trustProxy) {
    const xff = req.headers['x-forwarded-for'];
    const first = (Array.isArray(xff) ? xff[0] : xff)?.split(',')[0]?.trim();
    if (first) return first;
  }
  return req.socket.remoteAddress ?? 'unknown';
}

/** Создаёт сервер Abax: база, маршруты API, раздача клиента. Подключение к порту — listen(). */
export function createAppServer(options: AppOptions, extraRoutes: RouteModule[] = []): AppServer {
  const now = options.now ?? (() => Date.now());
  const db = openDb(options.dbPath);
  const limiter = new RateLimiter(now);
  const app: AppContext = {
    db,
    opts: resolveOptions(options),
    assets: options.assetBackend ?? new LocalFsAssetBackend(options.assetsDir),
    now,
    log: options.log ?? (() => {}),
    rateLimit: (key, max, windowMs) => limiter.take(key, max, windowMs),
  };
  const router = new Router();
  registerAuthRoutes(router);
  registerAssetRoutes(router);
  for (const mod of extraRoutes) mod(router, app);

  const upgradeHandlers: Parameters<AppServer['onUpgrade']>[0][] = [];
  const closers: (() => void | Promise<void>)[] = [];

  async function dispatch(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const method = (req.method ?? 'GET').toUpperCase();
    try {
      if (method === 'OPTIONS') { send(res, method, { status: 204 }); return; }
      let url: URL;
      try { url = new URL(req.url ?? '/', 'http://abax.local'); } catch { throw new HttpError(400, 'bad-request'); }
      const m = router.match(method, url.pathname);
      let reply: Reply | void = undefined;
      if (m && m !== 'method') {
        let rawP: Promise<Buffer> | null = null;
        const ctx: Ctx = {
          app, req, method, path: url.pathname, query: url.searchParams, params: m.params,
          ip: clientIp(req, app.opts.trustProxy),
          user: authenticate(app, req),
          raw: () => (rawP ??= readBody(req, m.route.maxBody)),
          async body() {
            const buf = await ctx.raw();
            if (buf.length === 0) return undefined;
            try { return JSON.parse(buf.toString('utf8')); } catch { throw new HttpError(400, 'bad-json'); }
          },
        };
        reply = await m.route.handler(ctx);
      } else if (m === 'method') {
        throw new HttpError(405, 'method-not-allowed');
      }
      if (reply && !reply.next) { send(res, method, reply); return; }
      if (url.pathname.startsWith('/api/')) throw new HttpError(404, 'not-found');
      if ((method === 'GET' || method === 'HEAD') && app.opts.staticDir) {
        const file = await serveStatic(app.opts.staticDir, url.pathname);
        if (file) { send(res, method, file); return; }
      }
      throw new HttpError(404, 'not-found');
    } catch (e) {
      if (e instanceof HttpError) {
        send(res, method, { status: e.status, json: { error: e.code, ...e.extra } });
      } else {
        app.log(`Ошибка обработки запроса: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
        if (!res.headersSent) send(res, method, { status: 500, json: { error: 'internal' } });
        else res.destroy();
      }
    }
  }

  const handler = (req: IncomingMessage, res: ServerResponse): void => { void dispatch(req, res); };
  const server = createServer(handler);
  const handleUpgrade: AppServer['handleUpgrade'] = (req, socket, head) => upgradeHandlers.some(fn => fn(req, socket, head));
  server.on('upgrade', (req, socket, head) => {
    if (!handleUpgrade(req, socket, head)) {
      socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
      socket.destroy();
    }
  });

  let url = '';
  return {
    server, db, app, router, handler,
    onUpgrade: fn => { upgradeHandlers.push(fn); },
    handleUpgrade,
    onClose: fn => { closers.push(fn); },
    get url() { return url; },
    listen(port = 0, host = '127.0.0.1') {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => {
          const p = (server.address() as AddressInfo).port;
          url = `http://${host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host}:${p}`;
          resolve({ port: p, url });
        });
      });
    },
    async close() {
      for (const fn of closers) await fn();
      server.closeAllConnections?.();
      await new Promise<void>(r => { server.close(() => r()); if (!server.listening) r(); });
      db.close();
    },
  };
}
