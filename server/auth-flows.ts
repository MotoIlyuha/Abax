import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { AppContext } from './context';
import type { AuthFlowRow, EmailCodeRow } from './db';
import { sessionReply, telegramIdentity, verifyTelegramLogin, requireUser, type TelegramPayload } from './auth';
import { isAuthMode, resolveIdentity, type AuthMode, type Identity } from './identity';
import { HttpError, type Ctx, type Reply, type Router } from './router';
import { getUser, sha256Hex } from './users';
import { normalizeName } from '../src/room-host';

// Вход по почте (код) и через провайдеров с переходом на их сайт (Google, Telegram, dev) — SPEC_NIGHT4 §7.

export const EMAIL_CODE_TTL_MS = 10 * 60_000;
export const EMAIL_MAX_ATTEMPTS = 5;
export const FLOW_TTL_MS = 10 * 60_000;
/** Тестовые аккаунты dev-провайдеров. */
export const DEV_TELEGRAM = { subject: '100000001', displayName: 'Тестовый Telegram', tgUsername: 'abax_dev' };
export const DEV_GOOGLE = { subject: 'dev-google-1', displayName: 'Тестовый Google' };

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com']);

const b64url = (b: Buffer): string => b.toString('base64url');
const EMAIL_RE = /^[^\s@<>()",;:\\[\]]{1,64}@[^\s@<>()",;:\\[\]]+\.[^\s@<>()",;:\\[\]]{2,}$/;

/** Адрес почты: нижний регистр, без пробелов по краям; неверный — null. */
export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim().toLowerCase();
  return s.length <= 254 && EMAIL_RE.test(s) ? s : null;
}

const hashCode = (email: string, code: string): string => sha256Hex(`${email}:${code}`);

function safeEqualHex(a: string, b: string): boolean {
  const x = Buffer.from(a, 'hex');
  const y = Buffer.from(b, 'hex');
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}

/** Адрес самого сервера: из настройки или из запроса (только чтобы отправить браузер этого же пользователя). */
function apiOrigin(app: AppContext, req: IncomingMessage): string {
  if (app.opts.publicApiUrl) return app.opts.publicApiUrl;
  const fwd = app.opts.trustProxy ? String(req.headers['x-forwarded-proto'] ?? '').split(',')[0].trim() : '';
  const proto = fwd || ((req.socket as { encrypted?: boolean }).encrypted ? 'https' : 'http');
  return `${proto}://${req.headers.host ?? 'localhost'}`;
}

/**
 * Куда можно вернуть пользователя после входа: только http(s) и только разрешённые адреса — веб-клиент
 * (publicWebUrl), сам сервер (publicApiUrl), ALLOWED_ORIGINS, а с dev-провайдерами — localhost.
 * Иначе ссылку входа можно было бы подсунуть так, чтобы результат ушёл на чужой сайт.
 */
export function allowedReturn(app: AppContext, raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 2000) return null;
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (u.username || u.password) return null;
  const origins = new Set<string>(app.opts.allowedOrigins);
  for (const s of [app.opts.publicWebUrl, app.opts.publicApiUrl]) {
    try { if (s) origins.add(new URL(s).origin); } catch { /* неверная настройка */ }
  }
  const local = app.opts.devAuth && (u.hostname === 'localhost' || u.hostname === '127.0.0.1');
  if (!local && !origins.has(u.origin)) return null;
  u.hash = '';
  return u.toString();
}

/** Провайдер работает через dev-заглушку: dev-режим и нет настоящих ключей. */
function devFor(app: AppContext, provider: 'telegram' | 'google'): boolean {
  if (!app.opts.devAuth) return false;
  return provider === 'telegram' ? !app.opts.telegramBotToken : !app.opts.googleClientId;
}

function providerEnabled(app: AppContext, provider: 'telegram' | 'google'): boolean {
  return provider === 'telegram' ? !!app.opts.telegramBotToken || app.opts.devAuth : !!app.opts.googleClientId || app.opts.devAuth;
}

function getFlow(app: AppContext, id: unknown): AuthFlowRow | null {
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{16,64}$/.test(id)) return null;
  return (app.db.prepare('SELECT * FROM auth_flows WHERE id = ?').get(id) as AuthFlowRow | undefined) ?? null;
}

/** Выполнить вход по данным провайдера и запомнить результат в потоке (ошибку — тоже). */
function settleFlow(app: AppContext, flow: AuthFlowRow, identity: Identity): void {
  const current = flow.user_id ? getUser(app.db, flow.user_id) : null;
  try {
    const user = resolveIdentity(app.db, identity, flow.mode as AuthMode, current, app.now());
    app.db.prepare('UPDATE auth_flows SET result_user_id = ?, error = NULL WHERE id = ?').run(user.id, flow.id);
  } catch (e) {
    const code = e instanceof HttpError ? e.code : 'auth-failed';
    app.db.prepare('UPDATE auth_flows SET error = ? WHERE id = ?').run(code, flow.id);
  }
}

function backToApp(flow: AuthFlowRow): Reply {
  return { status: 302, headers: { Location: `${flow.return_to}#abaxAuth=${encodeURIComponent(flow.id)}`, 'Cache-Control': 'no-store' } };
}

/** Поток по параметру ?flow= для перехода на сайт провайдера: есть, не просрочен, ещё не завершён. */
function startableFlow(ctx: Ctx, provider: string): AuthFlowRow {
  const flow = getFlow(ctx.app, ctx.query.get('flow'));
  if (!flow || flow.provider !== provider || flow.expires_at <= ctx.app.now()) throw new HttpError(400, 'bad-flow');
  return flow;
}

/**
 * nonce для Google (защита от повтора id_token): HMAC секрета сессий от id потока — его не нужно хранить,
 * а без секрета сервера его не подобрать. Google возвращает его в id_token, сервер сверяет.
 */
export function googleNonce(app: AppContext, flowId: string): string {
  return createHmac('sha256', app.opts.jwtSecret).update(`google-nonce:${flowId}`).digest('base64url');
}

/** Полезная нагрузка JWT без проверки подписи (id_token получен напрямую от Google по TLS). */
function jwtPayload(token: unknown): Record<string, unknown> | null {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try { return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as Record<string, unknown>; } catch { return null; }
}

export function registerAuthFlowRoutes(router: Router): void {
  router.get('/api/auth/providers', ctx => {
    const o = ctx.app.opts;
    return {
      json: {
        email: !!ctx.app.mailer || o.devAuth,
        telegram: !!o.telegramBotToken || o.devAuth,
        google: !!o.googleClientId || o.devAuth,
        dev: o.devAuth,
        telegramBotId: o.telegramBotToken ? o.telegramBotToken.split(':')[0] : null,
      },
    };
  });

  // ----- почта -----

  router.post('/api/auth/email/start', async ctx => {
    const app = ctx.app;
    if (!app.mailer && !app.opts.devAuth) throw new HttpError(503, 'email-disabled');
    const body = await ctx.body() as { email?: unknown } | undefined;
    const email = normalizeEmail(body?.email);
    if (!email) throw new HttpError(400, 'bad-email');
    if (!app.rateLimit(`email-ip:${ctx.ip}`, 20, 3600_000) || !app.rateLimit(`email:${email}`, 5, 3600_000)) throw new HttpError(429, 'rate-limited');
    const now = app.now();
    app.db.prepare('DELETE FROM email_codes WHERE expires_at <= ?').run(now);
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    app.db.prepare(`INSERT INTO email_codes (email, code_hash, expires_at, attempts, created_at) VALUES (?, ?, ?, 0, ?)
      ON CONFLICT(email) DO UPDATE SET code_hash = excluded.code_hash, expires_at = excluded.expires_at, attempts = 0, created_at = excluded.created_at`)
      .run(email, hashCode(email, code), now + EMAIL_CODE_TTL_MS, now);
    if (app.opts.devAuth) app.log(`[dev] код входа для ${email}: ${code}`);
    if (app.mailer) {
      try {
        await app.mailer.send({
          to: email,
          subject: `Код входа в Abax: ${code}`,
          text: `Ваш код входа в Abax: ${code}\n\nКод действует 10 минут. Если вы не запрашивали вход, просто проигнорируйте это письмо.`,
        });
      } catch (e) {
        app.db.prepare('DELETE FROM email_codes WHERE email = ?').run(email);
        app.log(`Не удалось отправить письмо: ${e instanceof Error ? e.message : String(e)}`);
        throw new HttpError(502, 'mail-failed');
      }
    }
    return { json: { ok: true, ...(app.opts.devAuth ? { devCode: code } : {}) } };
  }, { maxBody: 4096 });

  router.post('/api/auth/email/verify', async ctx => {
    const app = ctx.app;
    const body = await ctx.body() as { email?: unknown; code?: unknown; mode?: unknown } | undefined;
    const email = normalizeEmail(body?.email);
    const code = typeof body?.code === 'string' ? body.code.replace(/\s+/g, '') : '';
    const mode: AuthMode = isAuthMode(body?.mode) ? body.mode : 'login';
    if (!email || !/^\d{6}$/.test(code)) throw new HttpError(400, 'bad-code');
    if (mode === 'link') requireUser(ctx);
    const row = app.db.prepare('SELECT * FROM email_codes WHERE email = ?').get(email) as EmailCodeRow | undefined;
    if (!row) throw new HttpError(400, 'bad-code');
    const now = app.now();
    if (row.expires_at <= now) {
      app.db.prepare('DELETE FROM email_codes WHERE email = ?').run(email);
      throw new HttpError(400, 'code-expired');
    }
    if (!safeEqualHex(row.code_hash, hashCode(email, code))) {
      const attempts = row.attempts + 1;
      if (attempts >= EMAIL_MAX_ATTEMPTS) {
        app.db.prepare('DELETE FROM email_codes WHERE email = ?').run(email);
        throw new HttpError(429, 'too-many-attempts');
      }
      app.db.prepare('UPDATE email_codes SET attempts = ? WHERE email = ?').run(attempts, email);
      throw new HttpError(400, 'bad-code');
    }
    app.db.prepare('DELETE FROM email_codes WHERE email = ?').run(email);
    const user = resolveIdentity(app.db, { provider: 'email', subject: email }, mode, ctx.user, now);
    return sessionReply(app, user);
  }, { maxBody: 4096 });

  // ----- потоки с переходом на сайт провайдера -----

  router.post('/api/auth/flow', async ctx => {
    const app = ctx.app;
    const body = await ctx.body() as { provider?: unknown; mode?: unknown; returnTo?: unknown } | undefined;
    const provider = body?.provider;
    if (provider !== 'telegram' && provider !== 'google') throw new HttpError(400, 'bad-provider');
    if (!providerEnabled(app, provider)) throw new HttpError(503, 'provider-disabled');
    const mode: AuthMode = isAuthMode(body?.mode) ? body.mode : 'login';
    if (mode === 'link') requireUser(ctx);
    const returnTo = allowedReturn(app, body?.returnTo);
    if (!returnTo) throw new HttpError(400, 'bad-return');
    if (!app.rateLimit(`flow:${ctx.ip}`, 60, 3600_000)) throw new HttpError(429, 'rate-limited');
    const now = app.now();
    app.db.prepare('DELETE FROM auth_flows WHERE expires_at <= ?').run(now);
    const id = b64url(randomBytes(18));
    const secret = b64url(randomBytes(24));
    const verifier = provider === 'google' ? b64url(randomBytes(32)) : null;
    app.db.prepare(`INSERT INTO auth_flows (id, secret_hash, provider, mode, user_id, return_to, code_verifier, result_user_id, error, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)`)
      .run(id, sha256Hex(secret), provider, mode, ctx.user?.id ?? null, returnTo, verifier, now, now + FLOW_TTL_MS);
    const base = apiOrigin(app, ctx.req);
    let url: string;
    if (devFor(app, provider)) {
      url = `${base}/api/auth/dev/start?flow=${id}`;
    } else if (provider === 'google') {
      url = `${base}/api/auth/google/start?flow=${id}`;
    } else {
      // Telegram вернёт пользователя на returnTo с #tgAuthResult=…, клиент завершит поток сам
      const q = new URLSearchParams({ bot_id: app.opts.telegramBotToken!.split(':')[0], origin: new URL(returnTo).origin, request_access: 'write', return_to: returnTo });
      url = `https://oauth.telegram.org/auth?${q}`;
    }
    return { json: { flowId: id, secret, url } };
  }, { maxBody: 8192 });

  router.get('/api/auth/dev/start', ctx => {
    const app = ctx.app;
    if (!app.opts.devAuth) throw new HttpError(404, 'not-found');
    const flow = getFlow(app, ctx.query.get('flow'));
    if (!flow || flow.expires_at <= app.now() || !devFor(app, flow.provider as 'telegram' | 'google')) throw new HttpError(400, 'bad-flow');
    const identity: Identity = flow.provider === 'telegram'
      ? { provider: 'telegram', ...DEV_TELEGRAM }
      : { provider: 'google', ...DEV_GOOGLE };
    settleFlow(app, flow, identity);
    return backToApp(flow);
  });

  router.get('/api/auth/google/start', ctx => {
    const app = ctx.app;
    if (!app.opts.googleClientId) throw new HttpError(503, 'provider-disabled');
    const flow = startableFlow(ctx, 'google');
    const challenge = b64url(createHash('sha256').update(flow.code_verifier ?? '').digest());
    const q = new URLSearchParams({
      client_id: app.opts.googleClientId,
      redirect_uri: `${apiOrigin(app, ctx.req)}/api/auth/google/callback`,
      response_type: 'code',
      scope: 'openid email profile',
      state: flow.id,
      nonce: googleNonce(app, flow.id),
      code_challenge: challenge,
      code_challenge_method: 'S256',
      prompt: 'select_account',
    });
    return { status: 302, headers: { Location: `${GOOGLE_AUTH_URL}?${q}`, 'Cache-Control': 'no-store' } };
  });

  router.get('/api/auth/google/callback', async ctx => {
    const app = ctx.app;
    const flow = getFlow(app, ctx.query.get('state'));
    if (!flow || flow.provider !== 'google' || flow.expires_at <= app.now()) throw new HttpError(400, 'bad-flow');
    const code = ctx.query.get('code');
    if (!code || ctx.query.get('error') || !app.opts.googleClientId) {
      app.db.prepare('UPDATE auth_flows SET error = ? WHERE id = ?').run('cancelled', flow.id);
      return backToApp(flow);
    }
    try {
      const res = await app.fetch(GOOGLE_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code, client_id: app.opts.googleClientId, client_secret: app.opts.googleClientSecret ?? '',
          redirect_uri: `${apiOrigin(app, ctx.req)}/api/auth/google/callback`, grant_type: 'authorization_code', code_verifier: flow.code_verifier ?? '',
        }).toString(),
      });
      const data = await res.json() as { id_token?: unknown };
      const claims = res.ok ? jwtPayload(data.id_token) : null;
      const valid = !!claims && claims.aud === app.opts.googleClientId && GOOGLE_ISSUERS.has(String(claims.iss))
        && typeof claims.exp === 'number' && claims.exp * 1000 > app.now() && typeof claims.sub === 'string' && /^[\w-]{1,255}$/.test(claims.sub)
        && claims.nonce === googleNonce(app, flow.id);
      if (!valid) throw new Error('неверный id_token');
      settleFlow(app, flow, { provider: 'google', subject: claims!.sub as string, displayName: normalizeName(claims!.name) || undefined });
    } catch (e) {
      app.log(`Вход через Google не удался: ${e instanceof Error ? e.message : String(e)}`);
      app.db.prepare('UPDATE auth_flows SET error = ? WHERE id = ?').run('google-failed', flow.id);
    }
    return backToApp(flow);
  });

  router.post('/api/auth/flow/complete', async ctx => {
    const app = ctx.app;
    const body = await ctx.body() as { flowId?: unknown; secret?: unknown; telegram?: unknown } | undefined;
    let flow = getFlow(app, body?.flowId);
    if (!flow || typeof body?.secret !== 'string' || !safeEqualHex(flow.secret_hash, sha256Hex(body.secret))) throw new HttpError(400, 'bad-flow');
    const done = () => app.db.prepare('DELETE FROM auth_flows WHERE id = ?').run(flow!.id);
    if (flow.expires_at <= app.now()) { done(); throw new HttpError(400, 'flow-expired'); }
    // Telegram возвращает данные во фрагменте адреса — их приносит клиент; подпись проверяется здесь
    if (flow.provider === 'telegram' && !flow.result_user_id && !flow.error && body.telegram !== undefined) {
      const token = app.opts.telegramBotToken;
      if (!token || !verifyTelegramLogin(body.telegram, token, app.now())) { done(); throw new HttpError(401, 'bad-telegram-signature'); }
      settleFlow(app, flow, telegramIdentity(body.telegram as TelegramPayload));
      flow = getFlow(app, flow.id)!;
    }
    done();
    if (flow.error) throw new HttpError(flow.error === 'identity-taken' ? 409 : 400, flow.error);
    const user = flow.result_user_id ? getUser(app.db, flow.result_user_id) : null;
    if (!user) throw new HttpError(400, 'flow-pending');
    return sessionReply(app, user);
  }, { maxBody: 8192 });
}
