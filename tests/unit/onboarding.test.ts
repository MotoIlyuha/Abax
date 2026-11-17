// Окно первого входа: шаги, сообщения без облака, Tab-подстановка, Pro-примерка, вход по почте и привязка.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApiClient, setApiForTests, type ApiClient } from '../../src/api-client';
import { resetAuthForTests } from '../../src/auth';
import { FUNNY_NAMES } from '../../src/funny-names';
import { NO_LOGIN_NOTE, accountName, closeOnboardingForTests, needsOnboarding, onboardingOpen, openOnboarding } from '../../src/onboarding';
import { clearServerPlan } from '../../src/plan';
import { getProfile, resetProfileForTests } from '../../src/profile';
import { account, resetProfileSyncForTests } from '../../src/profile-sync';
import { closeApps, makeApp } from '../server/helpers';

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const step = () => $('#onboarding').dataset.step;
const tick = () => new Promise(r => setTimeout(r, 0));

async function until<T>(fn: () => T | undefined | null | false, ms = 3000): Promise<T> {
  const t0 = Date.now();
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error('условие не выполнилось за отведённое время');
    await new Promise(r => setTimeout(r, 10));
  }
}

/** Ввод в поле: значение и событие input, как при наборе. */
function type(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function key(target: HTMLElement, k: string, o: KeyboardEventInit = {}): KeyboardEvent {
  const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...o });
  target.dispatchEvent(e);
  return e;
}

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
  closeOnboardingForTests();
  setApiForTests(undefined);
  vi.unstubAllEnvs();
  await closeApps();
});

describe('окно первого входа', () => {
  it('нужно, пока знакомство не пройдено', () => {
    expect(needsOnboarding()).toBe(true);
    localStorage.setItem('doska.profile', JSON.stringify({ onboarded: true }));
    expect(needsOnboarding()).toBe(false);
  });

  it('шаг 1: три способа входа, «Продолжить без входа» и пояснение под ней', () => {
    openOnboarding();
    expect(onboardingOpen()).toBe(true);
    expect(step()).toBe('1');
    const names = [...document.querySelectorAll('.ob-step1 .ob-provider')].map(b => b.textContent);
    expect(names).toEqual(['Почта', 'Telegram', 'Google']);
    const skip = $('.ob-skip');
    expect(skip.textContent).toBe('Продолжить без входа');
    expect(skip.nextElementSibling!.textContent).toBe(NO_LOGIN_NOTE);
    expect($('.ob-step2').hasAttribute('inert')).toBe(true);
  });

  it('без облака клик по способу входа — сообщение в окне, кнопки остаются', async () => {
    openOnboarding();
    for (const p of ['email', 'telegram', 'google']) {
      $(`.ob-step1 [data-provider="${p}"]`).click();
      await tick();
      expect($('.ob-step1 .ob-msg').hidden).toBe(false);
      expect($('.ob-step1 .ob-msg').textContent).toContain('Облачный сервер не подключён');
    }
    expect(document.querySelectorAll('.ob-step1 .ob-provider')).toHaveLength(3);
    expect(step()).toBe('1');
  });

  it('«Продолжить без входа» → шаг 2; «Назад» → шаг 1', () => {
    openOnboarding();
    $('.ob-skip').click();
    expect(step()).toBe('2');
    expect($('.ob-track').style.transform).toBe('translateX(-50%)');
    expect($('.ob-step1').hasAttribute('inert')).toBe(true);
    const name = $<HTMLInputElement>('.ob-name');
    expect(name.value).toBe('');
    expect(FUNNY_NAMES).toContain(name.placeholder);
    expect($('.ob-link').hidden).toBe(true); // не вошёл — привязки нет
    $('.ob-back').click();
    expect(step()).toBe('1');
    expect($('.ob-track').style.transform).toBe('translateX(0)');
  });

  it('Tab в пустом поле подставляет подсказку и не уводит фокус; второй Tab — штатно', () => {
    openOnboarding();
    $('.ob-skip').click();
    const name = $<HTMLInputElement>('.ob-name');
    name.focus();
    const e1 = key(name, 'Tab');
    expect(e1.defaultPrevented).toBe(true);
    expect(name.value).toBe(name.placeholder);
    expect(name.selectionStart).toBe(name.value.length);
    expect($('.cp-badge').textContent).toBe(name.placeholder);
    const e2 = key(name, 'Tab');
    expect(e2.defaultPrevented).toBe(false);
    name.value = '';
    expect(key(name, 'Tab', { shiftKey: true }).defaultPrevented).toBe(false);
    expect(name.value).toBe('');
  });

  it('«Продолжить» с пустым полем — имя из подсказки; профиль сохранён, окно закрыто', () => {
    const done = vi.fn();
    openOnboarding({ onDone: done });
    $('.ob-skip').click();
    const placeholder = $<HTMLInputElement>('.ob-name').placeholder;
    $('[data-cursor="coral"]').click();
    $('.ob-continue').click();
    expect(getProfile()).toMatchObject({ name: placeholder, cursorId: 'coral', onboarded: true });
    expect(onboardingOpen()).toBe(false);
    expect(document.getElementById('onboarding')).toBeNull();
    expect(done).toHaveBeenCalledOnce();
  });

  it('кнопка-рандомайзер рядом с именем подставляет другое имя и обновляет бейдж', () => {
    openOnboarding();
    $('.ob-skip').click();
    const name = $<HTMLInputElement>('.ob-name');
    const dice = $('.ob-name-row .ob-dice');
    expect(dice.title).toBe('Случайное имя');
    const seen = new Set<string>();
    let prev = '';
    for (let i = 0; i < 6; i++) {
      dice.click();
      expect(FUNNY_NAMES).toContain(name.value);
      expect(name.value).not.toBe(prev);
      expect($('.cp-badge').textContent).toBe(name.value);
      prev = name.value;
      seen.add(name.value);
    }
    expect(seen.size).toBeGreaterThan(1);
    $('.ob-continue').click();
    expect(getProfile().name).toBe(prev);
  });

  it('Enter в поле имени — как «Продолжить»; клавиши не уходят к доске', () => {
    const board = vi.fn();
    window.addEventListener('keydown', board);
    openOnboarding();
    $('.ob-skip').click();
    const name = $<HTMLInputElement>('.ob-name');
    name.value = '  Аня ';
    key(name, 'v');
    expect(board).not.toHaveBeenCalled();
    key(name, 'Enter');
    expect(getProfile().name).toBe('Аня');
    window.removeEventListener('keydown', board);
  });

  it('Esc — как «без входа»: имя из подсказки, классический курсор', () => {
    openOnboarding();
    const placeholder = $<HTMLInputElement>('.ob-name').placeholder;
    key($('.ob-step1 .ob-provider'), 'Escape');
    expect(getProfile()).toMatchObject({ name: placeholder, cursorId: 'default', onboarded: true });
  });

  it('Pro-курсор у free: превью и плашка, «Продолжить» не блокируется, сохраняется бесплатный', () => {
    openOnboarding();
    $('.ob-skip').click();
    $('[data-cursor="mint"]').click();
    expect($('[data-cursor="neon"] .cp-pro').textContent).toBe('PRO');
    $('[data-cursor="neon"]').click();
    expect($('.cp-lock').hidden).toBe(false);
    expect($('.cp-lock').textContent).toContain('Доступно в подписке Pro');
    expect($('.cp-preview').style.getPropertyValue('--cp-sel')).toBe('#0c8599');
    expect($<HTMLButtonElement>('.ob-continue').disabled).toBe(false);
    $('.cp-lock-back').click();
    expect($('.cp-lock').hidden).toBe(true);
    expect($('[data-cursor="mint"]').classList.contains('active')).toBe(true);
    $('[data-cursor="gold"]').click();
    $('.ob-continue').click();
    expect(getProfile().cursorId).toBe('mint');
  });

  it('после возврата от провайдера — сразу шаг 2 с сохранёнными именем и курсором; ошибка — на шаге 1', () => {
    openOnboarding({ step: 2, resume: { where: 'onboarding', name: 'Лемур', cursorId: 'lavender', placeholder: 'Вомбат' } });
    expect(step()).toBe('2');
    expect($<HTMLInputElement>('.ob-name').value).toBe('Лемур');
    expect($<HTMLInputElement>('.ob-name').placeholder).toBe('Вомбат');
    expect($('[data-cursor="lavender"]').classList.contains('active')).toBe(true);
    closeOnboardingForTests();
    openOnboarding({ step: 1, error: 'identity-taken' });
    expect(step()).toBe('1');
    expect($('.ob-step1 .ob-msg').textContent).toContain('уже привязан');
  });

  it('accountName: только у вошедшего и только «настоящее» имя', () => {
    const me = (user: Record<string, unknown>) => ({ user: { id: 'u', displayName: 'Гость', tgUsername: null, avatarUrl: null, isAnonymous: false, plan: 'free', ...user } }) as never;
    expect(accountName(null)).toBe('');
    expect(accountName(me({ isAnonymous: true, displayName: 'Аня', nameCustom: true }))).toBe('');
    expect(accountName(me({}))).toBe('');
    expect(accountName(me({ displayName: 'Тестовый Google' }))).toBe('Тестовый Google');
    expect(accountName(me({ displayName: 'Гость', nameCustom: true }))).toBe('Гость');
  });
});

describe('окно первого входа с сервером', () => {
  let api: ApiClient;
  beforeEach(async () => {
    const app = await makeApp({ devAuth: true, telegramBotToken: null });
    api = createApiClient({ base: app.base });
    setApiForTests(api);
  });

  it('вход по почте: код (dev-подсказка) → шаг 2, блок привязки без почты', async () => {
    openOnboarding();
    $('.ob-step1 [data-provider="email"]').click();
    const email = await until(() => document.querySelector<HTMLInputElement>('.ob-step1 .em-input'));
    // кнопка «Почта» уступила место полю
    expect(document.querySelector('.ob-step1 [data-provider="email"]')).toBeNull();
    // неверный адрес: подсказка под полем, кода нет
    type(email, 'kapi@bara');
    $('.ob-step1 .em-go').click();
    await until(() => $('.ob-step1 .em-help').classList.contains('err'));
    expect($('.ob-step1 .em-field').classList.contains('err')).toBe(true);
    expect(document.querySelector('.em-otp')).toBeNull();
    type(email, 'kapi@bara.ru');
    expect($('.ob-step1 .em-help').textContent).toBe('');
    expect($('.ob-step1 .em-layer-in').textContent).toBe('kapi@bara.ru');
    $('.ob-step1 .em-go').click();
    // верный: поле сменяется клетками кода с адресом и dev-подсказкой
    const hint = await until(() => { const h = document.querySelector<HTMLElement>('.ob-step1 .em-otp .ob-dev-hint'); return h && !h.hidden && h; });
    expect($('.em-hint').textContent).toContain('kapi@bara.ru');
    const code = /(\d{6})/.exec(hint.textContent!)![1];
    // «Изменить почту» возвращает поле с тем же адресом
    $('.em-change').click();
    const again = await until(() => { const i = document.querySelector<HTMLInputElement>('.ob-step1 .em-input'); return i?.value ? i : null; });
    expect(again.value).toBe('kapi@bara.ru');
    $('.ob-step1 .em-go').click();
    const hint2 = await until(() => { const h = document.querySelector<HTMLElement>('.ob-step1 .em-otp .ob-dev-hint'); return h && !h.hidden && h; });
    const code2 = /(\d{6})/.exec(hint2.textContent!)![1];
    // неверный код: ошибка, клетки очищаются
    const wrong = code2 === '000000' ? '111111' : '000000';
    type($<HTMLInputElement>('.em-code'), wrong);
    await until(() => $('.em-otp .em-help').classList.contains('err'));
    // цифры уходят по одной, начиная с последней
    await until(() => $<HTMLInputElement>('.em-code').value === wrong.slice(0, 3));
    await until(() => $<HTMLInputElement>('.em-code').value === '');
    expect(code).toMatch(/^\d{6}$/);
    // пока стирание не закончилось, ввод не принимается — дожидаемся
    await until(() => { type($<HTMLInputElement>('.em-code'), code2); return $<HTMLInputElement>('.em-code').value === code2; });
    await until(() => step() === '2');
    expect(account()?.user.email).toBe('kapi@bara.ru');
    expect($('.ob-step2 .ob-title').textContent).toContain('Вы вошли');
    const link = $('.ob-link');
    expect(link.hidden).toBe(false);
    expect([...link.querySelectorAll('[data-provider]')].map(b => (b as HTMLElement).dataset.provider)).toEqual(['telegram', 'google']);
    expect(link.textContent).toContain('в любой момент в Настройках');
  }, 15000);
});
