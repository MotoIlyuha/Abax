import { randomBytes } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { AppContext } from './context';
import { HttpError } from './router';
import { getUser, sha256Hex } from './users';
import type { UserRow } from './db';

const SESSION_TTL = 8 * 3600_000;

export function isAdminHost(app: AppContext, req: IncomingMessage): boolean {
  return !!app.opts.adminOrigin && req.headers.host?.toLowerCase() === app.opts.adminOrigin.host;
}

function assertSameOrigin(app: AppContext, req: IncomingMessage): void {
  if (req.headers.origin !== app.opts.adminOrigin?.origin
    || !/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] ?? '')) {
    throw new HttpError(403, 'admin-origin');
  }
}

export function checkAdminLogin(app: AppContext, req: IncomingMessage): boolean {
  if (!isAdminHost(app, req)) return false;
  if (!app.opts.adminAccounts.size) throw new HttpError(403, 'admin-disabled');
  assertSameOrigin(app, req);
  return true;
}

function canAdmin(app: AppContext, user: UserRow | null): user is UserRow {
  return !!user && user.email !== null && app.opts.adminAccounts.get(user.id) === user.email;
}

function cookieName(app: AppContext): string {
  return app.opts.adminOrigin?.protocol === 'https:' ? '__Host-abax_admin' : 'abax_admin_local';
}

function cookie(app: AppContext, token: string, age: number): string {
  const secure = app.opts.adminOrigin?.protocol === 'https:';
  return `${cookieName(app)}=${token}; HttpOnly; Path=/; SameSite=Strict; Max-Age=${age}${secure ? '; Secure' : ''}`;
}

function sessionHash(app: AppContext, req: IncomingMessage): string | null {
  const name = cookieName(app);
  for (const part of req.headers.cookie?.split(';') ?? []) {
    const [key, token] = part.trim().split('=');
    if (key === name && /^[\w-]{43}$/.test(token ?? '')) return sha256Hex(token);
  }
  return null;
}

export function requireAdmin(app: AppContext, req: IncomingMessage, method: string): UserRow {
  if (!isAdminHost(app, req)) throw new HttpError(404, 'not-found');
  if (!app.opts.adminAccounts.size) throw new HttpError(403, 'admin-disabled');
  if (method !== 'GET' && method !== 'HEAD') assertSameOrigin(app, req);
  const hash = sessionHash(app, req);
  const row = hash ? app.db.prepare('SELECT user_id FROM admin_sessions WHERE token_hash = ? AND expires_at > ?')
    .get(hash, app.now()) as { user_id: string } | undefined : undefined;
  const user = row ? getUser(app.db, row.user_id) : null;
  if (!user) throw new HttpError(401, 'unauthorized');
  if (!canAdmin(app, user)) throw new HttpError(403, 'admin-forbidden');
  return user;
}

export function startAdminSession(app: AppContext, user: UserRow | null): string {
  if (!canAdmin(app, user)) throw new HttpError(403, 'admin-forbidden');
  const token = randomBytes(32).toString('base64url');
  const now = app.now();
  app.db.transaction(() => {
    app.db.prepare('DELETE FROM admin_sessions WHERE expires_at <= ?').run(now);
    app.db.prepare('INSERT INTO admin_sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
      .run(sha256Hex(token), user.id, now + SESSION_TTL);
  })();
  return cookie(app, token, SESSION_TTL / 1000);
}

export function endAdminSession(app: AppContext, req: IncomingMessage): string {
  app.db.prepare('DELETE FROM admin_sessions WHERE token_hash = ?').run(sessionHash(app, req));
  return cookie(app, '', 0);
}
