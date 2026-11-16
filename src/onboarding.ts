// Окно первого входа (SPEC_NIGHT4 §9): два шага в одной ленте со «слайдом».
// Шаг 1 — способ входа (Почта, Telegram, Google) или «Продолжить без входа».
// Шаг 2 — имя (подсказка-placeholder из смешных имён), курсор с превью и, если вошли, привязка других способов.
// Весь текст пользователя — через textContent; иконки — константы.

import { getApi, type MeResponse } from './api-client';
import {
  AuthError, authErrorText, authProviders, canRedirectAuth, startEmail, startRedirect, verifyEmail,
  type AuthMode, type AuthResume,
} from './auth';
import { createCursorPicker, type CursorPicker } from './cursor-picker';
import { DEFAULT_CURSOR_ID } from './cursors';
import { randomFunnyName } from './funny-names';
import { motionEnabled, reduceMotion } from './motion';
import { initialChoice, resolveName, tabFill, type CursorChoice } from './onboarding-logic';
import { cursorEntitled, getProfile, setProfile } from './profile';
import { account, pushProfile, signedIn } from './profile-sync';

export const NO_LOGIN_NOTE = 'Без входа доступны рисование, экспорт, участие по ссылкам и хранение досок в этом браузере. '
  + 'Вход нужен для облачной синхронизации между устройствами, сохранения досок при очистке браузера и подписки Pro';

export const PROVIDER_ICONS = {
  email: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M3.5 7l8.5 6 8.5-6"/></svg>',
  telegram: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 4L3 11l6 2.5M21 4l-3 16-9-6.5M21 4L9 13.5V19l3-3.5"/></svg>',
  google: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M20 12.2h-8M20 12.2A8 8 0 1 1 17.4 6.3"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
} as const;

type Provider = 'email' | 'telegram' | 'google';
export const PROVIDER_NAMES: Record<Provider, string> = { email: 'Почта', telegram: 'Telegram', google: 'Google' };

export interface OnboardingOptions {
  /** С какого шага открыть (после возврата от провайдера — 2). */
  step?: 1 | 2;
  /** Что было выбрано до перехода к провайдеру. */
  resume?: AuthResume | null;
  /** Ошибка входа после возврата — показывается на шаге 1. */
  error?: string | null;
  /** Окно закрыто (имя и курсор сохранены). */
  onDone?(): void;
}

interface Open { root: HTMLElement; close(): void; step(): 1 | 2; go(step: 1 | 2): void }
let current: Open | null = null;

export function onboardingOpen(): boolean {
  return current !== null;
}

/** Показать окно первого входа на обычном запуске: знакомство ещё не пройдено. */
export function needsOnboarding(): boolean {
  return !getProfile().onboarded;
}

/** Имя аккаунта для подстановки: только у вошедшего и только «настоящее» (своё или от провайдера). */
export function accountName(me: MeResponse | null): string {
  if (!me || me.user.isAnonymous) return '';
  if (me.user.nameCustom) return me.user.displayName;
  return me.user.displayName && me.user.displayName !== 'Гость' ? me.user.displayName : '';
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export function button(cls: string, text: string, icon?: string): HTMLButtonElement {
  const b = el('button', cls);
  b.type = 'button';
  if (icon) {
    const i = el('span', 'ob-icon');
    i.innerHTML = icon;
    b.appendChild(i);
  }
  b.appendChild(el('span', 'ob-label', text));
  return b;
}

/** Форма входа по почте: адрес → код. done — вошли (общая с разделом «Профиль»). */
export function emailForm(mode: AuthMode, say: (text: string, kind?: 'error' | 'info') => void, done: () => void): HTMLElement {
  const form = el('form', 'ob-email');
  form.noValidate = true;
  const email = el('input', 'ob-input');
  email.type = 'email';
  email.name = 'email';
  email.autocomplete = 'email';
  email.placeholder = 'Адрес почты';
  email.setAttribute('aria-label', 'Адрес почты');
  const send = button('ob-btn ob-primary ob-send', 'Получить код');
  send.type = 'submit';
  const codeRow = el('div', 'ob-code-row');
  codeRow.hidden = true;
  const code = el('input', 'ob-input ob-code');
  code.inputMode = 'numeric';
  code.autocomplete = 'one-time-code';
  code.maxLength = 6;
  code.placeholder = 'Код из письма';
  code.setAttribute('aria-label', 'Код из письма');
  const enter = button('ob-btn ob-primary ob-verify', 'Войти');
  const hint = el('div', 'ob-dev-hint');
  hint.hidden = true;
  codeRow.append(code, enter);
  form.append(email, send, codeRow, hint);

  let sentTo = '';
  form.addEventListener('submit', e => {
    e.preventDefault();
    if (!codeRow.hidden && code.value.trim()) { void verify(); return; }
    void request();
  });
  enter.addEventListener('click', () => { void verify(); });

  async function request(): Promise<void> {
    const addr = email.value.trim();
    if (!addr) { say(authErrorText('bad-email'), 'error'); email.focus(); return; }
    send.disabled = true;
    try {
      const r = await startEmail(addr);
      sentTo = addr;
      codeRow.hidden = false;
      send.querySelector('.ob-label')!.textContent = 'Отправить ещё раз';
      say(`Код отправлен на ${addr}. Он действует 10 минут.`, 'info');
      if (r.devCode) {
        hint.hidden = false;
        hint.textContent = `Режим разработки: код ${r.devCode}`;
      }
      code.focus();
    } catch (e) {
      say(authErrorText(e instanceof AuthError ? e.code : 'auth-failed'), 'error');
    } finally { send.disabled = false; }
  }

  async function verify(): Promise<void> {
    enter.disabled = true;
    try {
      await verifyEmail(sentTo || email.value.trim(), code.value, mode);
      done();
    } catch (e) {
      say(authErrorText(e instanceof AuthError ? e.code : 'auth-failed'), 'error');
      code.select();
    } finally { enter.disabled = false; }
  }
  return form;
}

/** Нажали способ входа: проверки (облако, платформа, сервер), затем почта — форма, остальные — переход. */
export async function chooseProvider(p: Provider, mode: AuthMode, resume: () => AuthResume, say: (t: string, k?: 'error' | 'info') => void, showEmail: () => void): Promise<void> {
  if (!getApi()) { say(authErrorText('no-cloud'), 'error'); return; }
  if (p !== 'email' && !canRedirectAuth()) { say(authErrorText('native'), 'error'); return; }
  const providers = await authProviders();
  if (!providers) { say(authErrorText('network'), 'error'); return; }
  if (!providers[p]) { say(authErrorText(p === 'email' ? 'email-disabled' : 'provider-disabled'), 'error'); return; }
  if (p === 'email') { showEmail(); return; }
  try {
    await startRedirect(p, mode, resume());
  } catch (e) {
    say(authErrorText(e instanceof AuthError ? e.code : 'auth-failed'), 'error');
  }
}

export function openOnboarding(opts: OnboardingOptions = {}): void {
  if (current) return;
  const resume = opts.resume ?? null;
  const placeholder = resume?.placeholder || randomFunnyName();
  const entitled = cursorEntitled();
  let choice: CursorChoice = initialChoice(resume?.cursorId ?? getProfile().cursorId ?? DEFAULT_CURSOR_ID, entitled);
  let step: 1 | 2 = 1;

  const root = el('div');
  root.id = 'onboarding';
  if (reduceMotion() || !motionEnabled()) root.classList.add('ob-instant');
  const win = el('div', 'ob-window');
  win.setAttribute('role', 'dialog');
  win.setAttribute('aria-modal', 'true');
  win.setAttribute('aria-label', 'Знакомство с Abax');
  const closeBtn = el('button', 'ob-close');
  closeBtn.type = 'button';
  closeBtn.title = 'Закрыть';
  closeBtn.setAttribute('aria-label', 'Закрыть');
  closeBtn.innerHTML = PROVIDER_ICONS.close;
  const viewport = el('div', 'ob-viewport');
  const track = el('div', 'ob-track');
  viewport.appendChild(track);
  win.append(closeBtn, viewport);
  root.appendChild(win);

  // ----- шаг 1 -----
  const s1 = el('section', 'ob-step ob-step1');
  s1.dataset.step = '1';
  const logo = el('img', 'ob-logo');
  logo.src = 'logo.svg';
  logo.alt = '';
  const h1 = el('h2', 'ob-title', 'Добро пожаловать в Abax');
  const sub = el('p', 'ob-sub', 'Войдите, чтобы доски были с вами на любом устройстве');
  const providers = el('div', 'ob-providers');
  const msg1 = el('div', 'ob-msg');
  msg1.setAttribute('role', 'alert');
  msg1.hidden = true;
  const say1 = (text: string, kind: 'error' | 'info' = 'error') => { msg1.hidden = false; msg1.textContent = text; msg1.dataset.kind = kind; fitHeight(); };
  const emailHost = el('div', 'ob-email-host');
  for (const p of ['email', 'telegram', 'google'] as const) {
    const b = button(`ob-btn ob-provider ob-${p}`, PROVIDER_NAMES[p], PROVIDER_ICONS[p]);
    b.dataset.provider = p;
    b.addEventListener('click', () => {
      void chooseProvider(p, 'login', () => ({ where: 'onboarding', name: nameInput.value, cursorId: choice.saved, placeholder }), say1, () => {
        if (!emailHost.firstChild) emailHost.appendChild(emailForm('login', say1, () => go(2)));
        emailHost.querySelector<HTMLInputElement>('input')?.focus();
        fitHeight();
      });
    });
    providers.appendChild(b);
  }
  const or = el('div', 'ob-or', 'или');
  const skip = button('ob-btn ob-skip', 'Продолжить без входа');
  skip.addEventListener('click', () => go(2));
  const note = el('p', 'ob-note', NO_LOGIN_NOTE);
  s1.append(logo, h1, sub, providers, emailHost, msg1, or, skip, note);

  // ----- шаг 2 -----
  const s2 = el('section', 'ob-step ob-step2');
  s2.dataset.step = '2';
  const backBtn = button('ob-back', '← Назад');
  backBtn.addEventListener('click', () => go(1));
  const h2 = el('h2', 'ob-title', 'Как вас зовут?');
  const nameLabel = el('label', 'ob-field');
  const nameCaption = el('span', 'ob-caption', 'Имя — его увидят участники совместной работы');
  const nameInput = el('input', 'ob-input ob-name');
  nameInput.type = 'text';
  nameInput.maxLength = 40;
  nameInput.setAttribute('autocomplete', 'nickname');
  nameInput.placeholder = placeholder;
  nameInput.value = resume?.name ?? '';
  nameLabel.append(nameCaption, nameInput);
  const cursorCaption = el('div', 'ob-caption', 'Курсор, цвет выделения и бейдж с именем');
  const picker: CursorPicker = createCursorPicker({
    choice, entitled, name: resolveName(nameInput.value, placeholder),
    onChange: c => { choice = c; fitHeight(); },
  });
  const link = el('div', 'ob-link');
  const msg2 = el('div', 'ob-msg');
  msg2.setAttribute('role', 'alert');
  msg2.hidden = true;
  const say2 = (text: string, kind: 'error' | 'info' = 'error') => { msg2.hidden = false; msg2.textContent = text; msg2.dataset.kind = kind; fitHeight(); };
  const done = button('ob-btn ob-primary ob-continue', 'Продолжить');
  done.addEventListener('click', finish);
  s2.append(backBtn, h2, nameLabel, cursorCaption, picker.el, link, msg2, done);

  track.append(s1, s2);

  nameInput.addEventListener('input', () => picker.setName(resolveName(nameInput.value, placeholder)));
  nameInput.addEventListener('keydown', e => {
    if (e.key === 'Tab') {
      const fill = tabFill(nameInput.value, nameInput.placeholder, e.shiftKey);
      if (fill !== null) {
        e.preventDefault();
        nameInput.value = fill;
        nameInput.setSelectionRange(fill.length, fill.length);
        picker.setName(fill);
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      finish();
    }
  });

  /** Блок «Привязать ещё способ входа» — только вошедшему и только непривязанные способы. */
  function renderLink(): void {
    link.textContent = '';
    const me = account();
    if (!signedIn() || !me) { link.hidden = true; return; }
    const missing = (['email', 'telegram', 'google'] as const).filter(p => !(p === 'email' ? me.user.email : me.user[p]));
    link.hidden = missing.length === 0;
    if (link.hidden) return;
    link.appendChild(el('div', 'ob-link-title', 'Привязать ещё способ входа'));
    const row = el('div', 'ob-link-row');
    const form = el('div', 'ob-email-host');
    for (const p of missing) {
      const b = button(`ob-btn ob-chip ob-${p}`, PROVIDER_NAMES[p], PROVIDER_ICONS[p]);
      b.dataset.provider = p;
      b.addEventListener('click', () => {
        void chooseProvider(p, 'link', () => ({ where: 'onboarding', name: nameInput.value, cursorId: choice.saved, placeholder }), say2, () => {
          if (!form.firstChild) form.appendChild(emailForm('link', say2, () => { say2('Почта привязана', 'info'); renderLink(); }));
          form.querySelector<HTMLInputElement>('input')?.focus();
          fitHeight();
        });
      });
      row.appendChild(b);
    }
    link.append(row, form, el('p', 'ob-link-note', 'Это можно сделать в любой момент в Настройках → Профиль'));
  }

  function enterStep2(): void {
    // вошли — имя аккаунта (если оно есть и поле ещё пустое)
    const fromAccount = accountName(account());
    if (fromAccount && !nameInput.value.trim()) nameInput.value = fromAccount;
    h2.textContent = signedIn() ? 'Вы вошли — как вас называть?' : 'Как вас зовут?';
    picker.setName(resolveName(nameInput.value, placeholder));
    renderLink();
  }

  function fitHeight(): void {
    const active = step === 1 ? s1 : s2;
    viewport.style.height = `${active.scrollHeight}px`;
  }

  function go(next: 1 | 2): void {
    if (next === 2) enterStep2();
    step = next;
    root.dataset.step = String(next);
    track.style.transform = next === 2 ? 'translateX(-50%)' : 'translateX(0)';
    s1.toggleAttribute('inert', next !== 1);
    s2.toggleAttribute('inert', next !== 2);
    s1.setAttribute('aria-hidden', next !== 1 ? 'true' : 'false');
    s2.setAttribute('aria-hidden', next !== 2 ? 'true' : 'false');
    fitHeight();
    (next === 2 ? nameInput : s1.querySelector<HTMLElement>('.ob-provider'))?.focus({ preventScroll: true });
  }

  function finish(): void {
    const name = resolveName(nameInput.value, placeholder);
    setProfile({ name, cursorId: choice.saved, onboarded: true });
    if (getApi()) void pushProfile();
    close();
  }

  // Клавиши внутри окна: сначала обработчики полей (Tab-подстановка, Enter), затем здесь — Esc и Tab по кругу;
  // дальше окна (к доске) клавиши не уходят.
  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      finish();
    } else if (e.key === 'Tab' && !e.defaultPrevented) {
      trapFocus(e);
    }
    e.stopPropagation();
  }

  /** Клавиша пришла не из окна (фокус где-то снаружи): доске её не отдаём, фокус возвращаем в окно. */
  function onOutsideKey(e: KeyboardEvent): void {
    if (e.target instanceof Node && root.contains(e.target)) return;
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); finish(); return; }
    if (e.key === 'Tab') { e.preventDefault(); (step === 2 ? nameInput : s1.querySelector<HTMLElement>('.ob-provider'))?.focus(); }
  }

  function trapFocus(e: KeyboardEvent): void {
    const active = step === 1 ? s1 : s2;
    const items = [closeBtn, ...active.querySelectorAll<HTMLElement>('button, input, [tabindex]:not([tabindex="-1"])')]
      .filter(x => !(x as HTMLButtonElement).disabled && !x.closest('[hidden]'));
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    const cur = document.activeElement;
    if (!win.contains(cur)) { e.preventDefault(); first.focus(); }
    else if (e.shiftKey && cur === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && cur === last) { e.preventDefault(); first.focus(); }
  }

  function close(): void {
    if (current?.root !== root) return;
    current = null;
    window.removeEventListener('keydown', onOutsideKey, true);
    root.remove();
    opts.onDone?.();
  }

  closeBtn.addEventListener('click', finish);
  root.addEventListener('keydown', onKey);
  window.addEventListener('keydown', onOutsideKey, true);
  document.body.appendChild(root);
  current = { root, close, step: () => step, go };
  // первый шаг всегда — способы входа; после возврата от провайдера — сразу второй
  root.dataset.step = '1';
  s2.setAttribute('inert', '');
  s2.setAttribute('aria-hidden', 'true');
  if (opts.error) say1(authErrorText(opts.error), 'error');
  if (opts.step === 2) {
    // без анимации: окно только что появилось
    root.classList.add('ob-no-anim');
    go(2);
    requestAnimationFrame(() => root.classList.remove('ob-no-anim'));
  } else {
    fitHeight();
    s1.querySelector<HTMLElement>('.ob-provider')?.focus({ preventScroll: true });
  }
}

/** Для тестов: закрыть окно без сохранения. */
export function closeOnboardingForTests(): void {
  current?.close();
  current = null;
}
