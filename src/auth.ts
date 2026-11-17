// Вход в аккаунт на клиенте (SPEC_NIGHT4 §7.4): почта (код), Telegram и Google (переход на сайт провайдера
// и возврат), привязка дополнительных способов, выход. Без облака функции отвечают ошибкой 'no-cloud'.

import { ApiError, getApi, saveSession, type ApiClient, type MeResponse } from './api-client';
import { setAccount, syncAccount } from './profile-sync';
import { isNativeApp } from './native';

export type AuthProvider = 'email' | 'telegram' | 'google';
export type AuthMode = 'login' | 'link';

export interface Providers {
  email: boolean;
  telegram: boolean;
  google: boolean;
  dev: boolean;
  telegramBotId: string | null;
}

/** Что восстановить после возврата от провайдера: где был пользователь и что успел выбрать. */
export interface AuthResume {
  where: 'onboarding' | 'settings';
  name?: string;
  cursorId?: string;
  placeholder?: string;
}

export const PENDING_KEY = 'doska.authPending';

interface Pending { flowId: string; secret: string; provider: AuthProvider; mode: AuthMode; resume: AuthResume | null }

/** Ошибка входа с кодом для authErrorText. */
export class AuthError extends Error {
  constructor(readonly code: string) { super(code); }
}

const TEXTS: Record<string, string> = {
  'no-cloud': 'Облачный сервер не подключён в этой сборке — нажмите «Продолжить без входа».',
  'native': 'Этот способ входа пока доступен только в веб-версии — войдите по почте.',
  'provider-disabled': 'Этот способ входа не настроен на сервере.',
  'email-disabled': 'Вход по почте не настроен на сервере.',
  'telegram-disabled': 'Вход через Telegram не настроен на сервере.',
  'bad-email': 'Проверьте адрес почты.',
  'bad-code': 'Неверный код. Проверьте письмо и попробуйте ещё раз.',
  'code-expired': 'Код устарел — запросите новый.',
  'too-many-attempts': 'Слишком много попыток — запросите новый код.',
  'rate-limited': 'Слишком много запросов. Попробуйте чуть позже.',
  'mail-failed': 'Не получилось отправить письмо. Попробуйте позже.',
  'identity-taken': 'Этот способ входа уже привязан к другому аккаунту.',
  'flow-expired': 'Время на вход истекло — попробуйте ещё раз.',
  'bad-flow': 'Не удалось завершить вход — попробуйте ещё раз.',
  'cancelled': 'Вход отменён.',
  'google-failed': 'Google не подтвердил вход — попробуйте ещё раз.',
  'telegram-failed': 'Telegram не подтвердил вход — попробуйте ещё раз.',
  'bad-telegram-signature': 'Telegram не подтвердил вход — попробуйте ещё раз.',
  'bad-return': 'Вход с этого адреса не разрешён на сервере.',
  'network': 'Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.',
};

/** Понятный текст ошибки входа. */
export function authErrorText(code: string): string {
  return TEXTS[code] ?? 'Не удалось войти. Попробуйте ещё раз.';
}

const codeOf = (e: unknown): string => (e instanceof AuthError ? e.code : e instanceof ApiError ? (e.isNetwork ? 'network' : e.code) : 'auth-failed');

function needApi(api: ApiClient | null): ApiClient {
  if (!api) throw new AuthError('no-cloud');
  return api;
}

let providersCache: { base: string; value: Providers } | null = null;

/** Какие способы входа включены на сервере; null — облака нет или сервер не ответил. */
export async function authProviders(api: ApiClient | null = getApi()): Promise<Providers | null> {
  if (!api) return null;
  if (providersCache?.base === api.base) return providersCache.value;
  try {
    const value = await api.request<Providers>('GET', '/api/auth/providers', undefined, { anonymous: true });
    providersCache = { base: api.base, value };
    return value;
  } catch { return null; }
}

/** Переход на сайт провайдера возможен: обычная веб-страница (не Electron из файла и не Android). */
export function canRedirectAuth(): boolean {
  try {
    if (isNativeApp()) return false;
  } catch { /* нет Capacitor */ }
  return location.protocol === 'http:' || location.protocol === 'https:';
}

function adopt(r: { token: string } & MeResponse, api: ApiClient): MeResponse {
  saveSession(r.token);
  setAccount(r, api);
  document.dispatchEvent(new CustomEvent('doska:account-changed'));
  return r;
}

/** Отправить код на почту. devCode — только с dev-провайдерами (подсказка в интерфейсе). */
export async function startEmail(email: string, api: ApiClient | null = getApi()): Promise<{ devCode?: string }> {
  const a = needApi(api);
  try {
    return await a.request<{ ok: boolean; devCode?: string }>('POST', '/api/auth/email/start', { email }, { anonymous: true });
  } catch (e) { throw new AuthError(codeOf(e)); }
}

/** Проверить код и войти (или привязать почту к текущему аккаунту). */
export async function verifyEmail(email: string, code: string, mode: AuthMode = 'login', api: ApiClient | null = getApi()): Promise<MeResponse> {
  const a = needApi(api);
  try {
    // текущая (анонимная) сессия нужна, чтобы доски этого устройства перешли в аккаунт
    await a.ensureSession();
    const r = await a.request<{ token: string } & MeResponse>('POST', '/api/auth/email/verify', { email, code, mode });
    return adopt(r, a);
  } catch (e) { throw new AuthError(codeOf(e)); }
}

/** Адрес возврата: эта же страница без фрагмента. */
function returnUrl(): string {
  return `${location.origin}${location.pathname}${location.search}`;
}

/**
 * Вход или привязка через Telegram / Google: сервер создаёт поток, секрет запоминается в sessionStorage,
 * браузер уходит на сайт провайдера. Промис не завершится — страница уходит (кроме ошибки).
 */
export async function startRedirect(provider: 'telegram' | 'google', mode: AuthMode, resume: AuthResume | null, api: ApiClient | null = getApi(), go: (url: string) => void = u => location.assign(u)): Promise<void> {
  const a = needApi(api);
  if (!canRedirectAuth()) throw new AuthError('native');
  try {
    await a.ensureSession();
    const r = await a.request<{ flowId: string; secret: string; url: string }>('POST', '/api/auth/flow', { provider, mode, returnTo: returnUrl() });
    const pending: Pending = { flowId: r.flowId, secret: r.secret, provider, mode, resume };
    sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending));
    go(r.url);
  } catch (e) { throw new AuthError(codeOf(e)); }
}

function readPending(): Pending | null {
  try {
    const raw = sessionStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Pending;
    return typeof p.flowId === 'string' && typeof p.secret === 'string' ? p : null;
  } catch { return null; }
}

export interface AuthOutcome {
  ok: boolean;
  error: string | null;
  resume: AuthResume | null;
  mode: AuthMode;
}

/**
 * На запуске: вернулись от провайдера (#abaxAuth=…) и в этой вкладке ждёт поток — завершить вход.
 * null — ничего не ждали. Фрагмент адреса убирается в любом случае.
 */
export async function completePendingAuth(api: ApiClient | null = getApi()): Promise<AuthOutcome | null> {
  const hash = location.hash;
  const abax = /^#abaxAuth=([A-Za-z0-9_-]+)/.exec(hash);
  if (!abax) return null;
  try { history.replaceState(history.state, '', returnUrl()); } catch { /* адрес не меняется — не страшно */ }
  const pending = readPending();
  try { sessionStorage.removeItem(PENDING_KEY); } catch { /* недоступно */ }
  if (!pending) return null; // чужая ссылка или поток из другой вкладки — молча игнорируем
  const out = (ok: boolean, error: string | null): AuthOutcome => ({ ok, error, resume: pending.resume, mode: pending.mode });
  if (abax[1] !== pending.flowId) return out(false, 'bad-flow');
  if (!api) return out(false, 'no-cloud');
  try {
    const r = await api.request<{ token: string } & MeResponse>('POST', '/api/auth/flow/complete', {
      flowId: pending.flowId, secret: pending.secret,
    }, { optionalAuth: true });
    adopt(r, api);
    return out(true, null);
  } catch (e) { return out(false, codeOf(e)); }
}

/** Выйти: сессия и токен устройства забываются, устройство получает новый анонимный аккаунт. Профиль остаётся. */
export async function logout(api: ApiClient | null = getApi()): Promise<void> {
  if (!api) return;
  await api.logout();
  setAccount(null, api);
  await syncAccount(api);
  document.dispatchEvent(new CustomEvent('doska:account-changed'));
}

/** Для тестов. */
export function resetAuthForTests(): void {
  providersCache = null;
}
