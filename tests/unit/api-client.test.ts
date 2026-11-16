// Клиент облачного сервера: адрес, сессия по токену устройства, повтор при 401, тариф с сервера.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  API_URL_KEY, ApiError, DEVICE_TOKEN_KEY, SESSION_KEY, apiBase, cloudEnabled, createApiClient, getApi, normalizeApiUrl,
  setApiForTests, syncPlanFromServer,
} from '../../src/api-client';
import { SERVER_PLAN_KEY, limitsEnforced, userPlan } from '../../src/plan';

const ME = (plan: string, enforced = false) => ({
  user: { id: 'u1', displayName: 'Гость', tgUsername: null, avatarUrl: null, isAnonymous: true, plan }, plan, planExpiresAt: null,
  limitsEnforced: enforced, limits: { maxProjects: 3, maxPagesPerProject: 3, maxRoomGuests: 1, canForbidClone: false, canDisableCopy: false },
});

type Call = { url: string; method: string; headers: Record<string, string>; body: unknown };

/** fetch-заглушка: отвечает по очереди из handlers (функция от запроса). */
function fakeFetch(handler: (c: Call, n: number) => { status?: number; body?: unknown } | 'network') {
  const calls: Call[] = [];
  const f = (async (url: string, init: RequestInit = {}) => {
    const call: Call = {
      url, method: init.method ?? 'GET', headers: (init.headers ?? {}) as Record<string, string>,
      body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    const r = handler(call, calls.length);
    if (r === 'network') throw new TypeError('Failed to fetch');
    const status = r.status ?? 200;
    return { ok: status >= 200 && status < 300, status, text: async () => (r.body === undefined ? '' : JSON.stringify(r.body)) } as Response;
  }) as unknown as typeof fetch;
  return { f, calls };
}

beforeEach(() => { localStorage.clear(); setApiForTests(undefined); });
afterEach(() => { setApiForTests(undefined); vi.unstubAllGlobals(); });

describe('адрес облака', () => {
  it('normalizeApiUrl: только http(s), без «/» в конце; мусор — пусто', () => {
    expect(normalizeApiUrl('https://api.example.com/')).toBe('https://api.example.com');
    expect(normalizeApiUrl(' http://localhost:5173 ')).toBe('http://localhost:5173');
    expect(normalizeApiUrl('https://example.com/v1/')).toBe('https://example.com/v1');
    for (const bad of ['', 'ftp://x', 'javascript:alert(1)', 'не адрес', null, 5, undefined]) expect(normalizeApiUrl(bad)).toBe('');
  });

  it('без адреса облако выключено: клиента нет, запросов нет, тариф не трогается', async () => {
    const spy = vi.fn();
    vi.stubGlobal('fetch', spy);
    expect(apiBase()).toBe('');
    expect(getApi()).toBeNull();
    expect(cloudEnabled()).toBe(false);
    expect(await syncPlanFromServer()).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it('doska.apiUrl включает облако', () => {
    localStorage.setItem(API_URL_KEY, 'http://127.0.0.1:9/');
    expect(apiBase()).toBe('http://127.0.0.1:9');
    expect(getApi()!.base).toBe('http://127.0.0.1:9');
    expect(cloudEnabled()).toBe(true);
  });
});

describe('сессия', () => {
  it('первый запрос входит анонимно по новому токену устройства и дальше шлёт Bearer', async () => {
    const { f, calls } = fakeFetch(c => (c.url.endsWith('/api/auth/anon') ? { body: { token: 'T1', ...ME('free') } } : { body: ME('free') }));
    const api = createApiClient({ base: 'https://api.test', fetch: f });
    await api.me();
    await api.me();
    expect(calls.map(c => c.url)).toEqual(['https://api.test/api/auth/anon', 'https://api.test/api/me', 'https://api.test/api/me']);
    const device = localStorage.getItem(DEVICE_TOKEN_KEY)!;
    expect(device).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(calls[0].body).toEqual({ deviceToken: device });
    expect(calls[1].headers.Authorization).toBe('Bearer T1');
    expect(localStorage.getItem(SESSION_KEY)).toBe('T1');
  });

  it('параллельные запросы входят один раз', async () => {
    const { f, calls } = fakeFetch(c => (c.url.endsWith('/api/auth/anon') ? { body: { token: 'T1', ...ME('free') } } : { body: ME('free') }));
    const api = createApiClient({ base: 'https://api.test', fetch: f });
    await Promise.all([api.me(), api.me(), api.me()]);
    expect(calls.filter(c => c.url.endsWith('/api/auth/anon'))).toHaveLength(1);
  });

  it('401 — тихий повторный вход и один повтор запроса; второй 401 — ошибка', async () => {
    localStorage.setItem(SESSION_KEY, 'OLD');
    localStorage.setItem(DEVICE_TOKEN_KEY, 'd'.repeat(43));
    const { f, calls } = fakeFetch(c => {
      if (c.url.endsWith('/api/auth/anon')) return { body: { token: 'NEW', ...ME('free') } };
      return c.headers.Authorization === 'Bearer NEW' ? { body: ME('free') } : { status: 401, body: { error: 'unauthorized' } };
    });
    const api = createApiClient({ base: 'https://api.test', fetch: f });
    expect((await api.me()).plan).toBe('free');
    expect(calls.map(c => c.url.replace('https://api.test', ''))).toEqual(['/api/me', '/api/auth/anon', '/api/me']);
    expect(localStorage.getItem(SESSION_KEY)).toBe('NEW');

    const always = fakeFetch(c => (c.url.endsWith('/api/auth/anon') ? { body: { token: 'N', ...ME('free') } } : { status: 401, body: { error: 'unauthorized' } }));
    const api2 = createApiClient({ base: 'https://api.test', fetch: always.f });
    await expect(api2.me()).rejects.toMatchObject({ status: 401, code: 'unauthorized' });
  });

  it('нет сети — ApiError со статусом 0; ошибка сервера — её код', async () => {
    const down = createApiClient({ base: 'https://api.test', fetch: fakeFetch(() => 'network').f });
    const e = await down.me().catch(x => x);
    expect(e).toBeInstanceOf(ApiError);
    expect(e.isNetwork).toBe(true);
    const bad = createApiClient({ base: 'https://api.test', fetch: fakeFetch(() => ({ status: 403, body: { error: 'plan-limit-projects' } })).f });
    localStorage.setItem(SESSION_KEY, 'S');
    await expect(bad.request('PUT', '/api/projects/x', {})).rejects.toMatchObject({ status: 403, code: 'plan-limit-projects' });
  });

  it('anonymous: без сессии и без Authorization', async () => {
    const { f, calls } = fakeFetch(() => ({ body: { ok: true } }));
    const api = createApiClient({ base: 'https://api.test', fetch: f });
    await api.request('GET', '/api/projects/p?x=1', undefined, { anonymous: true });
    expect(calls).toHaveLength(1);
    expect(calls[0].headers.Authorization).toBeUndefined();
  });

  it('logout: забывает сессию, токен устройства и серверный тариф', async () => {
    const { f, calls } = fakeFetch(c => (c.url.endsWith('/api/auth/anon') ? { body: { token: 'T1', ...ME('pro', true) } } : { body: { ok: true } }));
    const api = createApiClient({ base: 'https://api.test', fetch: f });
    await api.ensureSession();
    expect(userPlan()).toBe('pro');
    await api.logout();
    expect(calls.at(-1)!.url).toMatch(/logout$/);
    expect(localStorage.getItem(SESSION_KEY)).toBeNull();
    expect(localStorage.getItem(DEVICE_TOKEN_KEY)).toBeNull();
    expect(localStorage.getItem(SERVER_PLAN_KEY)).toBeNull();
    expect(userPlan()).toBe('free');
  });
});

describe('тариф с сервера', () => {
  it('syncPlanFromServer запоминает тариф и признак лимитов', async () => {
    localStorage.setItem(SESSION_KEY, 'S');
    const api = createApiClient({ base: 'https://api.test', fetch: fakeFetch(() => ({ body: ME('tutor', true) })).f });
    expect(await syncPlanFromServer(api)).toBe(true);
    expect(userPlan()).toBe('tutor');
    expect(limitsEnforced()).toBe(true);
  });

  it('сервер недоступен — тихо false, прежний тариф остаётся', async () => {
    localStorage.setItem(SESSION_KEY, 'S');
    localStorage.setItem(SERVER_PLAN_KEY, JSON.stringify({ plan: 'pro', limitsEnforced: false }));
    const api = createApiClient({ base: 'https://api.test', fetch: fakeFetch(() => 'network').f });
    expect(await syncPlanFromServer(api)).toBe(false);
    expect(userPlan()).toBe('pro');
  });
});
