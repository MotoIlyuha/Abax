import type { PlanTier } from './types';
import { applyServerPlan, clearServerPlan } from './plan';

// Клиент облачного сервера Abax. Адрес сервера — из сборки (apiUrl в package.json, DOSKA_API_URL) или
// localStorage['doska.apiUrl'] (для тестов и проверки вручную). Адреса нет — облако выключено:
// клиент не делает ни одного запроса, и всё работает как раньше, только на этом устройстве.
// Сессия — токен в localStorage (Authorization: Bearer): сервер может быть на другом домене, cookie туда не доедет.

export const API_URL_KEY = 'doska.apiUrl';
export const DEVICE_TOKEN_KEY = 'doska.deviceToken';
export const SESSION_KEY = 'doska.session';

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, readonly data: unknown = null) {
    super(code);
  }
  /** Сервер не ответил (нет сети, недоступен, CORS). */
  get isNetwork(): boolean { return this.status === 0; }
}

/** Возможности тарифа, как их отдаёт сервер; null — без ограничений. */
export interface ServerLimits {
  maxProjects: number | null;
  maxPagesPerProject: number | null;
  maxRoomGuests: number | null;
  canForbidClone: boolean;
  canDisableCopy: boolean;
}

/** Пользователь, как его отдаёт сервер (/api/me, вход). */
export interface MeUser {
  id: string; displayName: string; tgUsername: string | null; avatarUrl: string | null; isAnonymous: boolean; plan: PlanTier;
  /** Профиль (Ночь №4): курсор, своё ли имя, привязанные способы входа. Старый сервер их не присылает. */
  cursorId?: string; nameCustom?: boolean; email?: string | null; telegram?: boolean; google?: boolean;
}

export interface MeResponse {
  user: MeUser;
  plan: PlanTier;
  planExpiresAt: number | null;
  limitsEnforced: boolean;
  limits: ServerLimits;
}

export interface RequestOptions {
  /** Без сессии (по умолчанию — с сессией). */
  anonymous?: boolean;
  /** Только уже имеющаяся сессия: нет её — запрос уходит без входа (гостю по ссылке учётная запись не нужна). */
  optionalAuth?: boolean;
  headers?: Record<string, string>;
  /** Ответ — текст, а не JSON (например, data URL картинки). */
  text?: boolean;
}

export interface ApiClient {
  readonly base: string;
  request<T>(method: string, path: string, body?: unknown, opts?: RequestOptions): Promise<T>;
  /** Токен сессии; при необходимости входит анонимно по токену устройства. */
  ensureSession(): Promise<string>;
  me(): Promise<MeResponse>;
  logout(): Promise<void>;
}

export interface ApiClientOptions {
  base: string;
  fetch?: typeof fetch;
}

/** Хранилище недоступно (приватный режим) — токены живут в памяти до перезагрузки. */
const memory = new Map<string, string>();
function store(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return memory.get(key) ?? null; }
}
function storeSet(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value);
  } catch {
    if (value === null) memory.delete(key); else memory.set(key, value);
  }
}

function newDeviceToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Адрес сервера без «/» в конце; не http(s) — считается незаданным. */
export function normalizeApiUrl(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    return `${u.origin}${u.pathname.replace(/\/+$/, '')}`;
  } catch { return ''; }
}

/**
 * Адрес облака: переопределение в localStorage, затем значение из сборки; пусто — облако выключено.
 * В `npm run dev:cloud` сервер встроен в dev-сервер, поэтому берётся адрес самой страницы: открыли по localhost —
 * туннель (PUBLIC_API_URL) не нужен, открыли через туннель — запросы идут через него же.
 */
export function apiBase(): string {
  const local = normalizeApiUrl(store(API_URL_KEY));
  if (local) return local;
  if (typeof __API_SAME_ORIGIN__ === 'boolean' && __API_SAME_ORIGIN__ && typeof location !== 'undefined') {
    const own = normalizeApiUrl(location.origin);
    if (own) return own;
  }
  return typeof __DEFAULT_API_URL__ === 'string' ? normalizeApiUrl(__DEFAULT_API_URL__) : '';
}

export function createApiClient(options: ApiClientOptions): ApiClient {
  const base = normalizeApiUrl(options.base);
  const doFetch = options.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  let loginInFlight: Promise<string> | null = null;

  async function send<T>(method: string, path: string, body: unknown, headers: Record<string, string>, asText = false): Promise<T> {
    let res: Response;
    try {
      res = await doFetch(base + path, {
        method, headers: body === undefined ? headers : { 'Content-Type': 'application/json', ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch { throw new ApiError(0, 'network'); }
    let data: unknown = null;
    try {
      const text = await res.text();
      if (asText && res.ok) data = text;
      else if (text) data = JSON.parse(text);
    } catch { /* не JSON */ }
    if (!res.ok) {
      const code = typeof data === 'object' && data !== null && typeof (data as { error?: unknown }).error === 'string'
        ? (data as { error: string }).error : 'http-error';
      throw new ApiError(res.status, code, data);
    }
    return data as T;
  }

  function login(): Promise<string> {
    loginInFlight ??= (async () => {
      let device = store(DEVICE_TOKEN_KEY);
      if (!device) { device = newDeviceToken(); storeSet(DEVICE_TOKEN_KEY, device); }
      const r = await send<{ token: string } & MeResponse>('POST', '/api/auth/anon', { deviceToken: device }, {});
      storeSet(SESSION_KEY, r.token);
      applyServerPlan({ plan: r.plan, limitsEnforced: r.limitsEnforced });
      return r.token;
    })().finally(() => { loginInFlight = null; });
    return loginInFlight;
  }

  const client: ApiClient = {
    base,
    ensureSession: async () => store(SESSION_KEY) ?? login(),
    async request<T>(method: string, path: string, body?: unknown, opts: RequestOptions = {}): Promise<T> {
      if (opts.anonymous) return send<T>(method, path, body, opts.headers ?? {}, opts.text);
      if (opts.optionalAuth) {
        const have = store(SESSION_KEY);
        if (!have) return send<T>(method, path, body, opts.headers ?? {}, opts.text);
        try {
          return await send<T>(method, path, body, { ...opts.headers, Authorization: `Bearer ${have}` }, opts.text);
        } catch (e) {
          // сессия просрочена — для гостя это не помеха
          if (e instanceof ApiError && e.status === 401) { storeSet(SESSION_KEY, null); return send<T>(method, path, body, opts.headers ?? {}, opts.text); }
          throw e;
        }
      }
      const attempt = async (): Promise<T> => {
        const token = await client.ensureSession();
        return send<T>(method, path, body, { ...opts.headers, Authorization: `Bearer ${token}` }, opts.text);
      };
      try {
        return await attempt();
      } catch (e) {
        // сессия просрочена или сервер её не знает: входим заново по токену устройства и повторяем один раз
        if (e instanceof ApiError && e.status === 401) { storeSet(SESSION_KEY, null); return attempt(); }
        throw e;
      }
    },
    me: () => client.request<MeResponse>('GET', '/api/me'),
    async logout() {
      try { await send('POST', '/api/auth/logout', undefined, { Authorization: `Bearer ${store(SESSION_KEY) ?? ''}` }); } catch { /* сервера нет — выходим локально */ }
      storeSet(SESSION_KEY, null);
      storeSet(DEVICE_TOKEN_KEY, null);
      clearServerPlan();
    },
  };
  return client;
}

/** Запомнить токен сессии после входа через провайдера (null — забыть). */
export function saveSession(token: string | null): void {
  storeSet(SESSION_KEY, token);
}

/** Токен сессии, если он уже есть (без входа). */
export function currentSession(): string | null {
  return store(SESSION_KEY);
}

// ----- Общий клиент приложения -----

let override: ApiClient | null | undefined;
let cached: ApiClient | null = null;

/** Клиент по текущему адресу; null — облако выключено. */
export function getApi(): ApiClient | null {
  if (override !== undefined) return override;
  const base = apiBase();
  if (!base) { cached = null; return null; }
  if (!cached || cached.base !== base) cached = createApiClient({ base });
  return cached;
}

/** Для тестов: подставить клиент (null — облако выключено); undefined — вернуть выбор по адресу. */
export function setApiForTests(client: ApiClient | null | undefined): void {
  override = client;
}

/** Облако настроено? */
export function cloudEnabled(): boolean {
  return getApi() !== null;
}

/**
 * Узнать у сервера тариф пользователя и запомнить его. Тихо: без облака и без сети — false и никаких ошибок.
 */
export async function syncPlanFromServer(api: ApiClient | null = getApi()): Promise<boolean> {
  if (!api) return false;
  try {
    const me = await api.me();
    applyServerPlan({ plan: me.plan, limitsEnforced: me.limitsEnforced });
    return true;
  } catch { return false; }
}
