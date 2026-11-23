import { registerTutorBoards } from './tutor-boards';
import { registerCalendar } from './tutor-calendar';
import { registerStudents } from './tutor-students';
import { registerMiniAppAuth } from './tma';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { LocalFsAssetBackend, type AssetStorageBackend } from './asset-storage';
import { registerAssetRoutes } from './assets';
import { createCloudRooms, type CloudRooms } from './cloud-room-manager';
import { registerInviteRoutes } from './invite-routes';
import { registerEmailInviteRoutes } from './email-invites';
import { registerProjectRoutes } from './projects';
import { authenticate, registerAuthRoutes } from './auth';
import { normalizeEmail, registerAuthFlowRoutes } from './auth-flows';
import { registerBillingRoutes } from './billing';
import type { Mailer } from './mailer';
import type { AppContext, ResolvedOptions } from './context';
import { openDb, type Db } from './db';
import { RateLimiter } from './rate-limit';
import { HttpError, Router, readBody, type Ctx, type Reply } from './router';
import { serveStatic } from './static';
import { adminOrigin } from './config';
import { isAdminHost, requireAdmin } from './admin-auth';
import { registerAdminRoutes } from './admin';

export interface AppOptions {
  /** Файл базы или ':memory:'. */
  dbPath: string;
  /** Каталог блобов картинок (если не задан assetBackend). */
  assetsDir: string;
  jwtSecret: string;
  telegramBotToken?: string | null;
  enforceLimits?: boolean;
  /** Dev-провайдеры входа (ABAX_DEV_AUTH): код почты в ответе, мгновенный вход тестовыми Telegram/Google. */
  devAuth?: boolean;
  yookassaShopId?: string | null;
  yookassaSecretKey?: string | null;
  /** Почта для кодов входа (server/mailer.ts). */
  mailer?: Mailer | null;
  googleClientId?: string | null;
  telegramClientId?: string | null;
  telegramClientSecret?: string | null;
  googleClientSecret?: string | null;
  publicApiUrl?: string;
  allowedOrigins?: string[];
  /** fetch для запросов к провайдерам входа (тесты). */
  fetch?: typeof fetch;
  publicWebUrl?: string;
  /** Каталог собранного клиента (dist): раздаётся тем же сервером. */
  staticDir?: string | null;
  /** Чистые ссылки /j/… (SPEC_NIGHT6 §5.3); по умолчанию — если задан staticDir. */
  prettyLinks?: boolean;
  trustProxy?: boolean;
  secureCookies?: boolean;
  cookieDomain?: string;
  adminOrigin?: string;
  adminAccounts?: [string, string][];
  anonRateMax?: number;
  anonRateWindowMs?: number;
  roomSaveMs?: number;
  roomIdleMs?: number;
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
  /** Облачные комнаты (WebSocket /ws/room/:проект). */
  rooms: CloudRooms;
  readonly url: string;
}

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Asset-Hash',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Max-Age': '600',
};

function send(res: ServerResponse, method: string, reply: Reply, privateResponse = false): void {
  const headers: Record<string, string | number> = {
    ...(privateResponse ? { 'Cache-Control': 'no-store' } : CORS_HEADERS),
    'X-Content-Type-Options': 'nosniff', ...reply.headers,
  };
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
  const adminAccounts = new Map<string, string>();
  for (const [id, value] of o.adminAccounts ?? []) {
    const email = normalizeEmail(value);
    if (id && email) adminAccounts.set(id, email);
  }
  return {
    jwtSecret: o.jwtSecret,
    telegramBotToken: o.telegramBotToken || null,
    enforceLimits: o.enforceLimits === true,
    devAuth: o.devAuth === true,
    yookassaShopId: o.yookassaShopId || null,
    yookassaSecretKey: o.yookassaSecretKey || null,
    googleClientId: o.googleClientId || null,
    telegramClientId: o.telegramClientId || null,
    telegramClientSecret: o.telegramClientSecret || null,
    googleClientSecret: o.googleClientSecret || null,
    publicApiUrl: (o.publicApiUrl ?? '').replace(/\/+$/, ''),
    allowedOrigins: (o.allowedOrigins ?? []).map(s => { try { return new URL(s).origin; } catch { return ''; } }).filter(Boolean),
    publicWebUrl: (o.publicWebUrl ?? '').replace(/\/+$/, ''),
    staticDir: o.staticDir ?? null,
    prettyLinks: o.prettyLinks ?? !!o.staticDir,
    trustProxy: o.trustProxy === true,
    secureCookies: o.secureCookies === true,
    cookieDomain: o.cookieDomain === '.abaxboard.ru' ? o.cookieDomain : '',
    adminOrigin: adminOrigin(o.adminOrigin, o.secureCookies === true),
    adminAccounts,
    anonRateMax: o.anonRateMax ?? 30,
    anonRateWindowMs: o.anonRateWindowMs ?? 3600_000,
    roomSaveMs: o.roomSaveMs ?? 500,
    roomIdleMs: o.roomIdleMs ?? 60_000,
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
  const changedListeners: Parameters<AppContext['onProjectChanged']>[0][] = [];
  const accessListeners: Parameters<AppContext['onAccessChanged']>[0][] = [];
  const log = options.log ?? (() => {});
  const logError = (e: unknown) => log(`Ошибка обработчика: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
  const app: AppContext = {
    liveProject: id => rooms.projectOf(id),
    db,
    opts: resolveOptions(options),
    assets: options.assetBackend ?? new LocalFsAssetBackend(options.assetsDir),
    mailer: options.mailer ?? null,
    fetch: options.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a)),
    now,
    log,
    rateLimit: (key, max, windowMs) => limiter.take(key, max, windowMs),
    onProjectChanged: fn => { changedListeners.push(fn); },
    notifyProjectChanged: (id, project) => { for (const fn of changedListeners) try { fn(id, project); } catch (e) { logError(e); } },
    onAccessChanged: fn => { accessListeners.push(fn); },
    notifyAccessChanged: ev => { for (const fn of accessListeners) try { fn(ev); } catch (e) { logError(e); } },
  };
  const router = new Router();
  registerAuthRoutes(router);
  registerMiniAppAuth(router);
  registerStudents(router);
  registerCalendar(router);
  registerTutorBoards(router);
  registerAuthFlowRoutes(router);
  registerAssetRoutes(router);
  registerProjectRoutes(router);
  registerInviteRoutes(router);
  registerEmailInviteRoutes(router);
  registerBillingRoutes(router);
  registerAdminRoutes(router, app);
  for (const mod of extraRoutes) mod(router, app);

  const upgradeHandlers: Parameters<AppServer['onUpgrade']>[0][] = [];
  const closers: (() => void | Promise<void>)[] = [];

  async function dispatch(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const method = (req.method ?? 'GET').toUpperCase();
    const adminHost = isAdminHost(app, req);
    let privateResponse = adminHost;
    try {
      let url: URL;
      try { url = new URL(req.url ?? '/', 'http://abax.local'); } catch { throw new HttpError(400, 'bad-request'); }
      const path = '/' + url.pathname.split('/').filter(Boolean).join('/');
      const adminApi = path === '/api/admin' || path.startsWith('/api/admin/');
      privateResponse ||= adminApi;
      const admin = adminApi ? requireAdmin(app, req, method) : null;
      if (adminHost && !adminApi && !['/api/auth/email/start', '/api/auth/email/verify'].includes(path)) {
        throw new HttpError(404, 'not-found');
      }
      if (method === 'OPTIONS' && !privateResponse) { send(res, method, { status: 204 }); return; }
      const m = router.match(method, url.pathname);
      let reply: Reply | void = undefined;
      if (m && m !== 'method') {
        let rawP: Promise<Buffer> | null = null;
        const ctx: Ctx = {
          app, req, method, path: url.pathname, query: url.searchParams, params: m.params,
          ip: clientIp(req, app.opts.trustProxy),
          user: admin ?? (adminHost ? null : authenticate(app, req)),
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
      if (reply && !reply.next) { send(res, method, reply, privateResponse); return; }
      if (url.pathname.startsWith('/api/')) throw new HttpError(404, 'not-found');
      if ((method === 'GET' || method === 'HEAD') && app.opts.staticDir) {
        if (url.pathname === '/tutor/') { send(res, method, { status:308, headers:{Location:'/tutor' + url.search} }); return; }
        const file = await serveStatic(app.opts.staticDir, /^\/tutor\/?$/.test(url.pathname) ? '/index.html' : url.pathname);
        if (file) { send(res, method, file); return; }
      }
      throw new HttpError(404, 'not-found');
    } catch (e) {
      if (e instanceof HttpError) {
        send(res, method, { status: e.status, json: { error: e.code, ...e.extra } }, privateResponse);
      } else {
        app.log(`Ошибка обработки запроса: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
        if (!res.headersSent) send(res, method, { status: 500, json: { error: 'internal' } }, privateResponse);
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

  const rooms = createCloudRooms(app, { onUpgrade: fn => { upgradeHandlers.push(fn); }, onClose: fn => { closers.push(fn); } });

  let url = '';
  return {
    server, db, app, router, handler, rooms,
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
