// Синхронизация профиля с аккаунтом (SPEC_NIGHT4 §8) против настоящего сервера в памяти.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApiClient, setApiForTests, type ApiClient } from '../../src/api-client';
import { clearServerPlan, userPlan } from '../../src/plan';
import { getProfile, resetProfileForTests, setProfile } from '../../src/profile';
import { account, onAccountChange, pushProfile, resetProfileSyncForTests, setAccount, signedIn, startProfileSync, syncAccount } from '../../src/profile-sync';
import { call, closeApps, makeApp, setPlan, type TestApp } from '../server/helpers';

let app: TestApp;
let api: ApiClient;

async function until<T>(fn: () => T | undefined | null | false | Promise<T>, ms = 3000): Promise<T> {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error('условие не выполнилось за отведённое время');
    await new Promise(r => setTimeout(r, 10));
  }
}

beforeEach(async () => {
  localStorage.clear();
  clearServerPlan();
  resetProfileForTests();
  resetProfileSyncForTests();
  vi.stubEnv('DEV', false);
  app = await makeApp();
  api = createApiClient({ base: app.base });
  setApiForTests(api);
});
afterEach(async () => {
  setApiForTests(undefined);
  resetProfileSyncForTests();
  vi.unstubAllEnvs();
  await closeApps();
});

const serverUser = async () => (await api.me()).user;

describe('синхронизация профиля', () => {
  it('задержавшееся сохранение профиля не отменяет отображение привязанного Telegram', async () => {
    const before = await api.me();
    setAccount(before, api);
    setProfile({ name: 'Енот' });
    let finish!: (value: typeof before) => void;
    const delayed = { ...api, request: () => new Promise<typeof before>(resolve => { finish = resolve; }) } as ApiClient;
    const saving = pushProfile(delayed);
    const linked = { ...before, user: { ...before.user, telegram: true, tgUsername: 'enot', isAnonymous: false, nameCustom: true } };
    setAccount(linked, api);
    finish(before);
    await saving;
    expect(account()?.user).toMatchObject({ telegram: true, tgUsername: 'enot' });
  });

  it('без облака: syncAccount - false, ничего не делает', async () => {
    setApiForTests(null);
    expect(await syncAccount()).toBe(false);
    expect(account()).toBeNull();
  });

  it('аноним: имя и курсор устройства уходят на сервер', async () => {
    setProfile({ name: 'Капибара', cursorId: 'mint', onboarded: true });
    const seen: unknown[] = [];
    onAccountChange(me => seen.push(me?.user.id));
    expect(await syncAccount()).toBe(true);
    expect(seen).toHaveLength(1);
    expect(signedIn()).toBe(false);
    await until(async () => (await serverUser()).displayName === 'Капибара');
    expect(await serverUser()).toMatchObject({ cursorId: 'mint', nameCustom: true });
  });

  it('знакомство не пройдено - профиль не отправляется', async () => {
    setProfile({ name: 'Лемур' });
    await syncAccount();
    await new Promise(r => setTimeout(r, 50));
    expect((await serverUser()).nameCustom).toBe(false);
  });

  it('вошёл и у аккаунта своё имя - сервер главнее', async () => {
    setProfile({ name: 'Устройство', cursorId: 'coral', onboarded: true });
    const token = await api.ensureSession();
    await call(app, 'PATCH', '/api/me', { displayName: 'Аккаунт', cursorId: 'lavender' }, { token });
    app.db.prepare('UPDATE users SET email = ? WHERE id = (SELECT id FROM users LIMIT 1)').run('a@example.com');
    await syncAccount();
    expect(signedIn()).toBe(true);
    expect(getProfile()).toMatchObject({ name: 'Аккаунт', cursorId: 'lavender' });
  });

  it('тариф с сервера применяется вместе с аккаунтом', async () => {
    await api.ensureSession();
    const id = (await serverUser()).id;
    setPlan(app, id, 'tutor');
    await syncAccount();
    expect(userPlan()).toBe('tutor');
  });

  it('Pro-курсор без тарифа остаётся на устройстве, имя всё равно уходит', async () => {
    setProfile({ name: 'Енот', cursorId: 'gold', onboarded: true });
    await syncAccount();
    await until(async () => (await serverUser()).displayName === 'Енот');
    expect((await serverUser()).cursorId).toBe('default');
    expect(getProfile().cursorId).toBe('gold');
  });

  it('изменения профиля уходят на сервер с паузой', async () => {
    setProfile({ name: 'Енот', onboarded: true });
    await syncAccount();
    startProfileSync(5);
    setProfile({ name: 'Сурикат', cursorId: 'amber' });
    await until(async () => (await serverUser()).displayName === 'Сурикат');
    expect((await serverUser()).cursorId).toBe('amber');
  });

  it('pushProfile ничего не шлёт, если на сервере то же самое', async () => {
    setProfile({ name: 'Енот', cursorId: 'mint', onboarded: true });
    await syncAccount();
    await until(async () => (await serverUser()).displayName === 'Енот');
    await syncAccount();
    const spy = vi.spyOn(api, 'request');
    await pushProfile(api);
    expect(spy).not.toHaveBeenCalled();
  });
});
