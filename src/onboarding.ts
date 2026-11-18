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
import { BACK_CHEVRON_ICON, CLOSE_ICON, PROVIDER_ICONS } from './icons';
import { createEmailLogin, springLayout, type EmailLogin, type EmailStage } from './email-login';
import { nextFunnyName, randomFunnyName } from './funny-names';
import { motionEnabled, reduceMotion } from './motion';
import { createLetterLimit } from './letter-limit';
import { introEnabled, playIntro } from './onboarding-intro';
import { NAME_LIMIT, NAME_NEAR, initialChoice, resolveName, tabFill, type CursorChoice } from './onboarding-logic';
import { cursorEntitled, getProfile, setProfile } from './profile';
import { account, pushProfile, signedIn } from './profile-sync';

export const NO_LOGIN_NOTE = 'Без входа доски хранятся только в этом браузере. Вход нужен для синхронизации между устройствами и Pro';

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

/**
 * Поле имени с кнопкой-рандомайзером справа: по клику в поле подставляется другое случайное имя из списка
 * (и событие input — превью и бейдж обновляются). field — что ставить в ряд вместо самого поля
 * (обёртка со счётчиком). Возвращает ряд для вставки в разметку.
 */
export function nameRowWithDice(input: HTMLInputElement, field: HTMLElement = input): HTMLElement {
  const row = el('div', 'ob-name-row');
  const dice = el('button', 'ob-dice');
  dice.type = 'button';
  dice.title = 'Случайное имя';
  dice.setAttribute('aria-label', 'Случайное имя');
  dice.textContent = '🎲';
  dice.addEventListener('click', () => {
    input.value = nextFunnyName(input.value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  });
  row.append(field, dice);
  return row;
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
  win.tabIndex = -1;
  const closeBtn = el('button', 'ob-close');
  closeBtn.type = 'button';
  closeBtn.title = 'Закрыть';
  closeBtn.setAttribute('aria-label', 'Закрыть');
  closeBtn.innerHTML = CLOSE_ICON;
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
  // «Почта»: кнопка уступает место пружинному полю адреса, затем — клеткам кода (src/email-login.ts)
  let emailLogin: EmailLogin | null = null;
  for (const p of ['email', 'telegram', 'google'] as const) {
    const b = button(`ob-btn ob-provider ob-${p}`, PROVIDER_NAMES[p], PROVIDER_ICONS[p]);
    b.dataset.provider = p;
    b.addEventListener('click', () => {
      void chooseProvider(p, 'login', () => ({ where: 'onboarding', name: nameInput.value, cursorId: choice.saved, placeholder }), say1, () => {
        if (!emailLogin) {
          emailLogin = createEmailLogin({ mode: 'login', onDone: () => go(2), onResize: fitHeight, onStage: setEmailStage });
          msg1.hidden = true;
          b.replaceWith(emailLogin.el);
        }
        emailLogin.focus();
        fitHeight();
      });
    });
    providers.appendChild(b);
  }
  const others = el('div', 'ob-others', 'Другие способы входа');
  providers.insertBefore(others, providers.querySelector('.ob-telegram'));
  const or = el('div', 'ob-or', 'или');
  const skip = button('ob-btn ob-skip', 'Продолжить без входа');
  skip.addEventListener('click', () => go(2));
  const note = el('p', 'ob-note', NO_LOGIN_NOTE);
  s1.append(logo, h1, sub, providers, msg1, or, skip, note);

  // ----- шаг 2 -----
  const s2 = el('section', 'ob-step ob-step2');
  s2.dataset.step = '2';
  const backBtn = el('button', 'ob-back');
  backBtn.type = 'button';
  backBtn.title = 'Назад';
  backBtn.setAttribute('aria-label', 'Назад');
  backBtn.innerHTML = BACK_CHEVRON_ICON;
  backBtn.addEventListener('click', () => go(1));
  const h2 = el('h2', 'ob-title', 'Как вас зовут?');
  // шапка шага: кнопка «Назад» слева, заголовок по центру на той же линии
  const head = el('div', 'ob-head');
  head.append(backBtn, h2);
  const nameLabel = el('label', 'ob-field');
  const nameCaption = el('span', 'ob-caption', 'Введите имя');
  const nameHint = el('span', 'ob-hint', 'Это имя увидят участники совместной работы');
  // без maxLength: лишнее не блокируется, а отрезается и падает буквами (src/letter-limit.ts)
  const nameInput = el('input', 'ob-limit-input ob-name');
  nameInput.type = 'text';
  nameInput.setAttribute('autocomplete', 'nickname');
  nameInput.placeholder = placeholder;
  const nameField = createLetterLimit({ input: nameInput, limit: NAME_LIMIT, near: NAME_NEAR, pileHost: () => root, floorEl: () => win });
  nameField.set(resume?.name ?? '', false);
  nameLabel.append(nameCaption, nameRowWithDice(nameInput, nameField.el), nameHint);
  const cursorCaption = el('div', 'ob-caption', 'Выберите свой курсор');
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
  s2.append(head, nameLabel, cursorCaption, picker.el, link, msg2, done);

  track.append(s1, s2);

  nameInput.addEventListener('input', () => picker.setName(resolveName(nameInput.value, placeholder)));
  nameInput.addEventListener('keydown', e => {
    if (e.key === 'Tab') {
      const fill = tabFill(nameInput.value, nameInput.placeholder, e.shiftKey);
      if (fill !== null) {
        e.preventDefault();
        nameField.set(fill);
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
          if (!form.firstChild) {
            const login = createEmailLogin({ mode: 'link', onDone: () => { renderLink(); say2('Почта привязана', 'info'); }, onResize: fitHeight });
            b.hidden = true;
            form.appendChild(login.el);
          }
          form.querySelector<HTMLInputElement>('input')?.focus();
          fitHeight();
        });
      });
      row.appendChild(b);
    }
    link.append(row, form, el('p', 'ob-link-note', 'Это можно сделать в любой момент в Настройках, раздел «Профиль»'));
  }

  function enterStep2(): void {
    // вошли — имя аккаунта (если оно есть и поле ещё пустое)
    const fromAccount = accountName(account());
    if (fromAccount && !nameInput.value.trim()) nameField.set(fromAccount);
    h2.textContent = signedIn() ? 'Вы вошли. Как вас называть?' : 'Как вас зовут?';
    picker.setName(resolveName(nameInput.value, placeholder));
    renderLink();
  }

  /** Фокус шага 1: поле почты, если его уже открыли, иначе первая кнопка входа. */
  function focusStep1(): void {
    if (emailLogin) emailLogin.focus();
    else s1.querySelector<HTMLElement>('.ob-provider')?.focus({ preventScroll: true });
  }

  /** Вход по почте перешёл к коду (или вернулся к адресу): Telegram и Google встают в одну линию
   *  под подписью «Другие способы входа» (или обратно в столбик); всё ниже съезжает на пружинах. */
  function setEmailStage(st: EmailStage): void {
    const moving = [...providers.querySelectorAll<HTMLElement>('.ob-telegram, .ob-google'), msg1, or, skip, note];
    springLayout(moving, () => providers.classList.toggle('ob-stage-code', st === 'code'));
    fitHeight();
  }

  let fitTimer = 0;
  /** Высота окна по активному шагу; now — высота меняется покадрово, ставим её без CSS-перехода. */
  function fitHeight(now = false): void {
    const active = step === 1 ? s1 : s2;
    if (now) {
      viewport.style.transition = 'none';
      clearTimeout(fitTimer);
      fitTimer = window.setTimeout(() => { viewport.style.transition = ''; }, 120);
    }
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
    if (next === 2) nameInput.focus({ preventScroll: true });
    else focusStep1();
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
    if (e.key === 'Tab') { e.preventDefault(); if (step === 2) nameInput.focus(); else focusStep1(); }
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
    else if (cur === win) { e.preventDefault(); (e.shiftKey ? last : first).focus(); }
    else if (e.shiftKey && cur === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && cur === last) { e.preventDefault(); first.focus(); }
  }

  function close(): void {
    if (current?.root !== root) return;
    current = null;
    nameField.destroy();
    picker.dispose();
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
    // фокус на само окно, а не на кнопку «Почта»: без синей рамки на старте; Tab — по кнопкам как обычно
    const focusWin = () => win.focus({ preventScroll: true });
    if (introEnabled()) {
      // заставка: крупные логотип и заголовок, затем окно раскрывается; фокус — когда всё видно
      const rest = [closeBtn, sub, providers, msg1, or, skip, note];
      for (const e of rest) e.classList.add('ob-rest');
      playIntro({ root, win, logo, title: h1, rest, onReveal: focusWin });
    } else focusWin();
  }
}

/** Для тестов: закрыть окно без сохранения. */
export function closeOnboardingForTests(): void {
  current?.close();
  current = null;
}
