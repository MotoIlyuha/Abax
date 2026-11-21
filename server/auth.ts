import { createHmac, createHash, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { AppContext } from './context';
import type { UserRow } from './db';
import { HttpError, type Ctx, type Reply, type Router } from './router';
import { createUser, effectivePlan, findByDevice, getUser, meResponse, sha256Hex } from './users';
import { resolveIdentity, type Identity } from './identity';
import { canUseCursor, isCursorId } from '../src/cursors';
import { MAX_AVATAR_PHOTO, cleanAvatar } from '../src/avatar-value';
import { normalizeName } from '../src/room-host';

// Сессии (JWT HS256 на node:crypto), анонимный вход по токену устройства и проверка Telegram Login Widget.

export const SESSION_COOKIE = 'abax_session';
export const SESSION_TTL_MS = 30 * 24 * 3600 * 1000;
/** Вход через Telegram действителен, пока auth_date не старше суток. */
export const TELEGRAM_MAX_AGE_SEC = 24 * 3600;
const DEVICE_TOKEN_RE = /^[A-Za-z0-9_-]{32,128}$/;

const b64 = (v: string | Buffer): string => Buffer.from(v).toString('base64url');

function hmac(secret: string, data: string): Buffer {
  return createHmac('sha256', secret).update(data).digest();
}

function safeEqual(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}

// ----- Сессионный токен -----

export function signSession(secret: string, userId: string, nowMs: number, ttlMs = SESSION_TTL_MS): string {
  const head = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64(JSON.stringify({ sub: userId, iat: Math.floor(nowMs / 1000), exp: Math.floor((nowMs + ttlMs) / 1000) }));
  return `${head}.${body}.${b64(hmac(secret, `${head}.${body}`))}`;
}

/** Идентификатор пользователя из токена; null — подпись неверна, токен просрочен или испорчен. */
export function verifySession(secret: string, token: string, nowMs: number): { sub: string } | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [head, body, sig] = parts;
  let header: { alg?: unknown };
  let payload: { sub?: unknown; exp?: unknown };
  try {
    header = JSON.parse(Buffer.from(head, 'base64url').toString('utf8'));
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch { return null; }
  if (header.alg !== 'HS256') return null;
  if (!safeEqual(hmac(secret, `${head}.${body}`), Buffer.from(sig, 'base64url'))) return null;
  if (typeof payload.sub !== 'string' || typeof payload.exp !== 'number' || payload.exp * 1000 <= nowMs) return null;
  return { sub: payload.sub };
}

function cookieValue(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

/** Токен сессии из заголовка Authorization: Bearer … или cookie. */
export function sessionTokenOf(req: IncomingMessage): string | null {
  const auth = req.headers.authorization;
  if (typeof auth === 'string' && /^Bearer\s+\S+$/i.test(auth)) return auth.replace(/^Bearer\s+/i, '');
  return cookieValue(req.headers.cookie, SESSION_COOKIE);
}

/** Пользователь запроса; null — сессии нет или она недействительна. */
export function authenticate(app: AppContext, req: IncomingMessage): UserRow | null {
  const token = sessionTokenOf(req);
  if (!token) return null;
  const s = verifySession(app.opts.jwtSecret, token, app.now());
  return s ? getUser(app.db, s.sub) : null;
}

export function sessionCookie(app: AppContext, token: string): string {
  return `${SESSION_COOKIE}=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}${app.opts.secureCookies ? '; Secure' : ''}`;
}

const clearedCookie = (app: AppContext): string =>
  `${SESSION_COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0${app.opts.secureCookies ? '; Secure' : ''}`;

/** Пользователь запроса или 401. */
export function requireUser(ctx: Ctx): UserRow {
  if (!ctx.user) throw new HttpError(401, 'unauthorized');
  return ctx.user;
}

// ----- Telegram Login Widget -----

export interface TelegramPayload {
  id: number | string;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number | string;
  hash: string;
}

/**
 * Проверка подписи Telegram Login Widget по спецификации Telegram: secret = SHA256(токен бота),
 * HMAC-SHA256 от строки «ключ=значение» всех полей, кроме hash, отсортированных по алфавиту и склеенных «\n».
 * Подпись сравнивается за постоянное время; auth_date не старше суток и не из будущего.
 */
export function verifyTelegramLogin(payload: unknown, botToken: string, nowMs: number): boolean {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return false;
  const p = payload as Record<string, unknown>;
  if (typeof p.hash !== 'string' || !/^[0-9a-f]{64}$/i.test(p.hash)) return false;
  const lines: string[] = [];
  for (const key of Object.keys(p).sort()) {
    if (key === 'hash') continue;
    const v = p[key];
    if (v === undefined || v === null) continue;
    if (typeof v !== 'string' && typeof v !== 'number' && typeof v !== 'boolean') return false;
    lines.push(`${key}=${v}`);
  }
  const secret = createHash('sha256').update(botToken).digest();
  const expected = createHmac('sha256', secret).update(lines.join('\n')).digest();
  if (!safeEqual(expected, Buffer.from(p.hash, 'hex'))) return false;
  const authDate = Number(p.auth_date);
  if (!Number.isFinite(authDate)) return false;
  const age = nowMs / 1000 - authDate;
  return age <= TELEGRAM_MAX_AGE_SEC && age >= -300;
}

/** Подпись Telegram для данных (нужна тестам и демонстрации). */
export function signTelegramPayload(fields: Record<string, string | number>, botToken: string): string {
  const lines = Object.keys(fields).sort().map(k => `${k}=${fields[k]}`);
  return createHmac('sha256', createHash('sha256').update(botToken).digest()).update(lines.join('\n')).digest('hex');
}

/** Имя от провайдера входа: те же правила, что у имени участника комнаты (до MAX_NAME = 32 символов). */
const cleanName = (s: string): string => normalizeName(s);

// ----- Маршруты -----

/**
 * Данные Telegram Login (подпись уже проверена) → способ входа: id, имя (имя и фамилия, иначе username),
 * username и аватар (только https).
 */
export function telegramIdentity(p: TelegramPayload): Identity {
  const tgId = String(p.id);
  if (!/^\d{1,20}$/.test(tgId)) throw new HttpError(400, 'bad-telegram-id');
  const name = cleanName([p.first_name, p.last_name].filter((s): s is string => typeof s === 'string').join(' '))
    || (typeof p.username === 'string' ? cleanName(p.username) : '') || 'Пользователь Telegram';
  return {
    provider: 'telegram', subject: tgId, displayName: name,
    tgUsername: typeof p.username === 'string' ? cleanName(p.username) || null : null,
    avatarUrl: typeof p.photo_url === 'string' && /^https:\/\//.test(p.photo_url) ? p.photo_url.slice(0, 500) : null,
  };
}

/** Ответ входа: токен сессии, cookie и то же, что /api/me. */
export function sessionReply(app: AppContext, user: UserRow, status = 200): Reply {
  const token = signSession(app.opts.jwtSecret, user.id, app.now());
  return {
    status,
    json: { token, ...meResponse(user, app.now(), app.opts.enforceLimits) },
    headers: { 'Set-Cookie': sessionCookie(app, token) },
  };
}

export function registerAuthRoutes(router: Router): void {
  router.post('/api/auth/anon', async ctx => {
    const app = ctx.app;
    const body = await ctx.body() as { deviceToken?: unknown } | undefined;
    const token = body?.deviceToken;
    if (typeof token !== 'string' || !DEVICE_TOKEN_RE.test(token)) throw new HttpError(400, 'bad-device-token');
    const hash = sha256Hex(token);
    let user = findByDevice(app.db, hash);
    if (!user) {
      if (!app.rateLimit(`anon:${ctx.ip}`, app.opts.anonRateMax, app.opts.anonRateWindowMs)) throw new HttpError(429, 'rate-limited');
      user = createUser(app.db, app.now(), { device_token_hash: hash });
    }
    return sessionReply(app, user);
  });

  router.post('/api/auth/telegram', async ctx => {
    const app = ctx.app;
    const botToken = app.opts.telegramBotToken;
    if (!botToken) throw new HttpError(503, 'telegram-disabled');
    const payload = await ctx.body();
    if (!verifyTelegramLogin(payload, botToken, app.now())) throw new HttpError(401, 'bad-telegram-signature');
    const p = payload as TelegramPayload;
    const user = resolveIdentity(app.db, telegramIdentity(p), 'login', ctx.user, app.now());
    return sessionReply(app, user);
  });

  router.post('/api/auth/logout', ctx => ({ json: { ok: true }, headers: { 'Set-Cookie': clearedCookie(ctx.app) } }));

  router.get('/api/me', ctx => {
    const user = requireUser(ctx);
    return { json: meResponse(user, ctx.app.now(), ctx.app.opts.enforceLimits) };
  });

  // Фото только из проверенного профиля провайдера; произвольные адреса и перенаправления запрещены.
  router.get('/api/me/provider-avatar', async ctx => {
    const user = requireUser(ctx);
    let url: URL;
    try { url = new URL(user.avatar_url ?? ''); } catch { throw new HttpError(404, 'avatar-unavailable'); }
    const host = url.hostname.toLowerCase();
    if (url.protocol !== 'https:' || url.port || url.username || url.password ||
      !(host === 'googleusercontent.com' || host.endsWith('.googleusercontent.com') || host === 'telesco.pe' || host.endsWith('.telesco.pe'))) {
      throw new HttpError(404, 'avatar-unavailable');
    }
    try {
      const res = await ctx.app.fetch(url.toString(), { redirect: 'error', signal: AbortSignal.timeout(8000) });
      const type = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
      if (!res.ok || !['image/jpeg', 'image/png', 'image/webp'].includes(type) || !res.body) throw new Error();
      const reader = res.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 2_000_000) { await reader.cancel(); throw new Error(); }
        chunks.push(value);
      }
      return { json: { photo: `data:${type};base64,${Buffer.concat(chunks).toString('base64')}` }, headers: { 'Cache-Control': 'no-store' } };
    } catch { throw new HttpError(502, 'avatar-unavailable'); }
  });

  // профиль: своё имя, персональный курсор (SPEC_NIGHT4 §6) и аватар (смайл или фото; null — буквы)
  router.patch('/api/me', async ctx => {
    const app = ctx.app;
    const user = requireUser(ctx);
    const body = await ctx.body() as { displayName?: unknown; cursorId?: unknown; avatar?: unknown } | undefined;
    if (!body || typeof body !== 'object') throw new HttpError(400, 'bad-request');
    const now = app.now();
    let name: string | null = null;
    let cursor: string | null = null;
    if (body.displayName !== undefined) {
      name = normalizeName(body.displayName);
      if (!name) throw new HttpError(400, 'bad-name');
    }
    if (body.cursorId !== undefined) {
      if (!isCursorId(body.cursorId)) throw new HttpError(400, 'bad-cursor');
      if (!app.opts.devAuth && !canUseCursor(body.cursorId, effectivePlan(user, now))) throw new HttpError(403, 'plan-cursor');
      cursor = body.cursorId;
    }
    let avatar: string | null | undefined;
    if (body.avatar !== undefined) {
      avatar = cleanAvatar(body.avatar);
      if (avatar === undefined) throw new HttpError(400, 'bad-avatar');
    }
    if (name !== null) app.db.prepare('UPDATE users SET display_name = ?, name_custom = 1, updated_at = ? WHERE id = ?').run(name, now, user.id);
    if (cursor !== null) app.db.prepare('UPDATE users SET cursor_id = ?, updated_at = ? WHERE id = ?').run(cursor, now, user.id);
    if (avatar !== undefined) app.db.prepare('UPDATE users SET avatar = ?, updated_at = ? WHERE id = ?').run(avatar, now, user.id);
    return { json: meResponse(getUser(app.db, user.id)!, now, app.opts.enforceLimits) };
  }, { maxBody: MAX_AVATAR_PHOTO + 4096 });
}
