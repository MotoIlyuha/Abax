// Раздел настроек «Профиль»: имя, курсор, вход, привязка способов и выход.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApiClient, setApiForTests, type ApiClient } from '../../src/api-client';
import { resetAuthForTests, startEmail, verifyEmail } from '../../src/auth';
import { clearServerPlan } from '../../src/plan';
import { getProfile, resetProfileForTests, setProfile } from '../../src/profile';
import { account, resetProfileSyncForTests } from '../../src/profile-sync';
import { renderProfileSettings } from '../../src/profile-settings';
import { closeApps, makeApp } from '../server/helpers';

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

async function until<T>(fn: () => T | undefined | null | false, ms = 3000): Promise<T> {
  const t0 = Date.now();
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error('условие не выполнилось за отведённое время');
    await new Promise(r => setTimeout(r, 10));
  }
}

/** Раздел в контейнере; rerender перерисовывает его, как окно настроек. */
function mount(opts: Parameters<typeof renderProfileSettings>[2] = {}) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  let view: ReturnType<typeof renderProfileSettings> | null = null;
  const renders = { n: 0 };
  const rerender = () => { view?.dispose?.(); host.textContent = ''; renders.n++; view = renderProfileSettings(host, rerender, {}); };
  view = renderProfileSettings(host, rerender, opts);
  return { host, renders, dispose: () => view?.dispose?.() };
}

let disposers: (() => void)[] = [];

beforeEach(() => {
  document.body.innerHTML = '';
  localStorage.clear();
  sessionStorage.clear();
  clearServerPlan();
  resetProfileForTests();
  resetProfileSyncForTests();
  resetAuthForTests();
  setApiForTests(null);
  vi.stubEnv('DEV', false);
});
afterEach(async () => {
  for (const d of disposers.splice(0)) d();
  setApiForTests(undefined);
  vi.unstubAllEnvs();
  await closeApps();
});

describe('раздел «Профиль»', () => {
  it('без облака: имя и курсор меняются, про аккаунт — пояснение', () => {
    setProfile({ name: 'Лемур', onboarded: true });
    const m = mount();
    disposers.push(m.dispose);
    const name = $<HTMLInputElement>('.ps-name');
    expect(name.value).toBe('Лемур');
    name.value = '  Бодрый Енот ';
    name.dispatchEvent(new Event('change'));
    expect(getProfile().name).toBe('Бодрый Енот');
    expect(name.value).toBe('Бодрый Енот');
    $('[data-cursor="amber"]').click();
    expect(getProfile().cursorId).toBe('amber');
    // Pro без права — только примерка
    $('[data-cursor="cosmos"]').click();
    expect(getProfile().cursorId).toBe('amber');
    expect($('.cp-lock').hidden).toBe(false);
    expect($('.ps-account').textContent).toContain('Облачный сервер не подключён');
  });

  it('сообщение после возврата от провайдера', () => {
    const m = mount({ notice: { text: 'Способ входа привязан', kind: 'info' } });
    disposers.push(m.dispose);
    expect($('.ps-account .ob-msg').textContent).toBe('Способ входа привязан');
  });

  describe('с сервером', () => {
    let api: ApiClient;
    beforeEach(async () => {
      const app = await makeApp({ devAuth: true, telegramBotToken: null });
      api = createApiClient({ base: app.base });
      setApiForTests(api);
    });

    it('не вошёл: три способа входа; вход по почте перерисовывает раздел', async () => {
      const m = mount();
      disposers.push(m.dispose);
      expect([...document.querySelectorAll('.ps-providers [data-provider]')].map(b => (b as HTMLElement).dataset.provider)).toEqual(['email', 'telegram', 'google']);
      const { devCode } = await startEmail('ps@abax.ru');
      await verifyEmail('ps@abax.ru', devCode!);
      await until(() => document.querySelector('.ps-methods'));
      const email = $('.ps-method[data-provider="email"]');
      expect(email.textContent).toContain('ps@abax.ru');
      expect(email.querySelector('.ps-link')).toBeNull();
      expect($('.ps-method[data-provider="telegram"] .ps-link').textContent).toBe('Привязать');
      expect($('.ps-method[data-provider="google"] .ps-link').textContent).toBe('Привязать');
    });

    it('«Выйти» — снова аноним, раздел перерисован', async () => {
      const { devCode } = await startEmail('out@abax.ru');
      await verifyEmail('out@abax.ru', devCode!);
      const m = mount();
      disposers.push(m.dispose);
      $('.ps-logout').click();
      await until(() => account()?.user.isAnonymous === true && document.querySelector('.ps-providers'));
      expect(m.renders.n).toBeGreaterThan(0);
    });
  });
});
