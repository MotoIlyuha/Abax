import { createHmac, timingSafeEqual } from 'node:crypto';
import { sessionTokenOf, sessionReply, telegramIdentity, TELEGRAM_MAX_AGE_SEC } from './auth';
import { meResponse } from './users';
import { resolveIdentity } from './identity';
import { HttpError, type Router } from './router';

function invalid(): never {
  throw new HttpError(401, 'bad-telegram-signature');
}

/** Подпись Mini App использует отдельный ключ, отличный от ключа Login Widget. */
export function miniAppIdentity(raw: unknown, token: string, now: number) {
  if (typeof raw !== 'string' || raw.length > 16384) return invalid();
  const fields = new URLSearchParams(raw);
  if (new Set(fields.keys()).size !== fields.size) return invalid();
  const hash = fields.get('hash') ?? '';
  if (!/^[a-f\d]{64}$/i.test(hash)) return invalid();
  fields.delete('hash');
  fields.sort();
  const check = Array.from(fields, ([key, value]) => key + '=' + value).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  const signature = createHmac('sha256', secret).update(check).digest();
  const stamp = fields.get('auth_date') ?? '';
  const age = Math.floor(now / 1000) - Number(stamp);
  if (
    !timingSafeEqual(signature, Buffer.from(hash, 'hex')) ||
    !/^\d+$/.test(stamp) ||
    age < -300 ||
    age > TELEGRAM_MAX_AGE_SEC
  )
    return invalid();
  let user;
  try {
    user = JSON.parse(fields.get('user') ?? 'null');
  } catch {
    return invalid();
  }
  if (!user || !Number.isSafeInteger(user.id) || user.id <= 0) return invalid();
  return telegramIdentity(user);
}

export function registerMiniAppAuth(router: Router): void {
  router.post('/api/auth/session', (ctx) => {
    if (!ctx.user) throw new HttpError(401, 'unauthorized');
    return {
      json: { token: sessionTokenOf(ctx.req), ...meResponse(ctx.user, ctx.app.now(), ctx.app.opts.enforceLimits) },
    };
  });

  router.post(
    '/api/auth/tma',
    async (ctx) => {
      const { app } = ctx;
      const body = (await ctx.body()) as { initData?: unknown } | undefined;
      const token = app.opts.telegramBotToken || (app.opts.devAuth ? 'abax-dev-mini-app' : null);
      if (!token) throw new HttpError(503, 'telegram-disabled');
      const identity = miniAppIdentity(body?.initData, token, app.now());
      const user = app.db.transaction(() => resolveIdentity(app.db, identity, 'login', ctx.user, app.now()))();
      return sessionReply(app, user);
    },
    { maxBody: 32768 },
  );
}
