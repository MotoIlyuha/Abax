// Вход на клиенте (src/auth.ts) против настоящего сервера в памяти с dev-провайдерами.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_KEY, createApiClient, setApiForTests, type ApiClient } from '../../src/api-client';
import {
  AuthError, PENDING_KEY, authErrorText, authProviders, canRedirectAuth, completePendingAuth, logout, resetAuthForTests, startEmail, startRedirect, verifyEmail,
} from '../../src/auth';
import { clearServerPlan } from '../../src/plan';
import { resetProfileForTests, setProfile } from '../../src/profile';
import { account, resetProfileSyncForTests, signedIn } from '../../src/profile-sync';
import { closeApps, makeApp, type TestApp } from '../server/helpers';

let app: TestApp;
let api: ApiClient;

beforeEach(async () => {
  localStorage.clear();
  sessionStorage.clear();
  clearServerPlan();
  resetProfileForTests();
  resetProfileSyncForTests();
  resetAuthForTests();
  history.replaceState(null, '', '/');
  app = await makeApp({ devAuth: true, telegramBotToken: null });
  api = createApiClient({ base: app.base });
  setApiForTests(api);
});
afterEach(async () => {
  setApiForTests(undefined);
  resetProfileSyncForTests();
  vi.unstubAllGlobals();
  await closeApps();
});

describe('вход на клиенте', () => {
  it('без облака: понятная ошибка «облачный сервер не подключён»', async () => {
    setApiForTests(null);
    await expect(startEmail('a@b.ru')).rejects.toMatchObject({ code: 'no-cloud' });
    expect(authErrorText('no-cloud')).toContain('Облачный сервер не подключён');
    expect(await authProviders()).toBeNull();
    expect(await completePendingAuth()).toBeNull();
  });

  it('providers кэшируются', async () => {
    expect(await authProviders(api)).toMatchObject({ email: true, telegram: true, google: true, dev: true });
    const spy = vi.spyOn(api, 'request');
    await authProviders(api);
    expect(spy).not.toHaveBeenCalled();
  });

  it('почта: dev-код, вход, сессия и аккаунт', async () => {
    setProfile({ name: 'Капибара', onboarded: true });
    const { devCode } = await startEmail('Kapi@Bara.ru');
    expect(devCode).toMatch(/^\d{6}$/);
    const events: Event[] = [];
    document.addEventListener('doska:account-changed', e => events.push(e));
    const me = await verifyEmail('kapi@bara.ru', devCode!);
    expect(me.user.email).toBe('kapi@bara.ru');
    expect(localStorage.getItem(SESSION_KEY)).toBe((me as unknown as { token: string }).token);
    expect(signedIn()).toBe(true);
    expect(events).toHaveLength(1);
    await expect(verifyEmail('kapi@bara.ru', '000000')).rejects.toBeInstanceOf(AuthError);
  });

  it('переход на провайдера и возврат: вход через dev-Google', async () => {
    let target = '';
    await startRedirect('google', 'login', { where: 'onboarding', name: 'Лемур', cursorId: 'mint' }, api, u => { target = u; });
    expect(target).toContain('/api/auth/dev/start?flow=');
    const pending = JSON.parse(sessionStorage.getItem(PENDING_KEY)!);
    expect(pending).toMatchObject({ provider: 'google', mode: 'login', resume: { where: 'onboarding', name: 'Лемур' } });
    // сервер отправляет обратно на страницу с #abaxAuth=…
    const back = (await fetch(target, { redirect: 'manual' })).headers.get('location')!;
    history.replaceState(null, '', `/${new URL(back).hash}`);
    const out = await completePendingAuth();
    expect(out).toMatchObject({ ok: true, error: null, mode: 'login', resume: { where: 'onboarding', name: 'Лемур', cursorId: 'mint' } });
    expect(location.hash).toBe('');
    expect(sessionStorage.getItem(PENDING_KEY)).toBeNull();
    expect(account()?.user).toMatchObject({ google: true, isAnonymous: false });
  });

  it('чужая ссылка возврата без ожидающего потока игнорируется, хеш убирается', async () => {
    history.replaceState(null, '', '/#abaxAuth=abcdefabcdefabcdef');
    expect(await completePendingAuth()).toBeNull();
    expect(location.hash).toBe('');
  });

  it('поток другой вкладки (другой id) — ошибка bad-flow', async () => {
    sessionStorage.setItem(PENDING_KEY, JSON.stringify({ flowId: 'x'.repeat(24), secret: 's', provider: 'google', mode: 'login', resume: null }));
    history.replaceState(null, '', '/#abaxAuth=yyyyyyyyyyyyyyyyyyyyyyyy');
    expect(await completePendingAuth()).toMatchObject({ ok: false, error: 'bad-flow' });
  });

  it('выход: новый анонимный аккаунт, профиль остаётся', async () => {
    setProfile({ name: 'Енот', onboarded: true });
    const { devCode } = await startEmail('e@n.ru');
    const me = await verifyEmail('e@n.ru', devCode!);
    await logout(api);
    expect(account()?.user.isAnonymous).toBe(true);
    expect(account()?.user.id).not.toBe(me.user.id);
    expect(localStorage.getItem('doska.profile')).toContain('Енот');
  });

  it('canRedirectAuth: обычная веб-страница — да', () => {
    expect(canRedirectAuth()).toBe(true);
  });
});
