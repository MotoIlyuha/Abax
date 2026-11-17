// Раздел настроек «Профиль» (SPEC_NIGHT4 §10): имя, курсор с превью, вход, привязка способов входа и выход.
// Пользовательские данные (имя, почта, @username) — только textContent.

import { getApi } from './api-client';
import { AuthError, authErrorText, logout } from './auth';
import { createCursorPicker } from './cursor-picker';
import { createLetterLimit } from './letter-limit';
import { NAME_LIMIT, NAME_NEAR, initialChoice, previewLocked } from './onboarding-logic';
import { PROVIDER_ICONS, PROVIDER_NAMES, button, chooseProvider, emailForm, nameRowWithDice } from './onboarding';
import { cursorEntitled, getProfile, setProfile } from './profile';
import { account, onAccountChange, signedIn } from './profile-sync';
import type { SectionView } from './settings-dialog';

export interface ProfileSettingsOptions {
  /** Сообщение о входе после возврата от провайдера (показывается один раз). */
  notice?: { text: string; kind: 'error' | 'info' } | null;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export function renderProfileSettings(host: HTMLElement, rerender: () => void, opts: ProfileSettingsOptions = {}): SectionView {
  const box = el('div', 'ps');
  const profile = getProfile();

  // ----- имя -----
  const nameField = el('label', 'ps-field');
  nameField.appendChild(el('span', 'ps-caption', 'Имя'));
  // как в окне первого входа: без maxLength, лишнее отрезается и падает буквами (src/letter-limit.ts)
  const name = el('input', 'ob-limit-input ps-name');
  name.type = 'text';
  name.placeholder = 'Как вас называть в совместной работе';
  const limited = createLetterLimit({
    input: name, limit: NAME_LIMIT, near: NAME_NEAR,
    pileHost: () => host.closest<HTMLElement>('#settings-dialog') ?? document.body,
    floorEl: () => host.closest<HTMLElement>('.sd-window') ?? host,
  });
  limited.set(profile.name, false);
  name.addEventListener('change', () => { setProfile({ name: name.value }); limited.set(getProfile().name); });
  name.addEventListener('keydown', e => { if (e.key === 'Enter') name.blur(); });
  nameField.append(nameRowWithDice(name, limited.el), el('span', 'ps-hint', 'Его видят участники совместной работы рядом с вашим курсором.'));

  // ----- курсор -----
  const cursorBlock = el('div', 'ps-block');
  cursorBlock.appendChild(el('div', 'ps-caption', 'Курсор, цвет выделения и бейдж'));
  const entitled = cursorEntitled();
  const picker = createCursorPicker({
    choice: initialChoice(profile.cursorId, entitled),
    entitled,
    name: profile.name || 'Вы',
    onChange: c => { if (!previewLocked(c)) setProfile({ cursorId: c.saved }); },
  });
  name.addEventListener('input', () => picker.setName(name.value.trim() || 'Вы'));
  cursorBlock.appendChild(picker.el);

  // ----- аккаунт -----
  const acc = el('div', 'ps-block ps-account');
  acc.appendChild(el('div', 'ps-caption', 'Аккаунт'));
  const msg = el('div', 'ob-msg');
  msg.setAttribute('role', 'alert');
  msg.hidden = true;
  const say = (text: string, kind: 'error' | 'info' = 'error') => { msg.hidden = false; msg.textContent = text; msg.dataset.kind = kind; };
  const formHost = el('div', 'ob-email-host');
  const resume = () => ({ where: 'settings' as const });

  if (!getApi()) {
    acc.appendChild(el('p', 'ps-text', 'Облачный сервер не подключён в этой сборке: имя и курсор хранятся на этом устройстве.'));
  } else if (signedIn()) {
    const me = account()!;
    acc.appendChild(el('p', 'ps-text ps-status', 'Вы вошли. Доски синхронизируются между устройствами.'));
    const list = el('div', 'ps-methods');
    for (const p of ['email', 'telegram', 'google'] as const) {
      const row = el('div', 'ps-method');
      row.dataset.provider = p;
      const icon = el('span', 'ob-icon');
      icon.innerHTML = PROVIDER_ICONS[p];
      const label = el('span', 'ps-method-name', PROVIDER_NAMES[p]);
      const linked = p === 'email' ? !!me.user.email : !!me.user[p];
      const detail = p === 'email' && me.user.email ? me.user.email : p === 'telegram' && me.user.tgUsername ? `@${me.user.tgUsername}` : linked ? 'привязан' : '';
      row.append(icon, label, el('span', 'ps-method-detail', detail));
      if (!linked) {
        const b = button('ob-btn ob-chip ps-link', 'Привязать');
        b.addEventListener('click', () => {
          void chooseProvider(p, 'link', resume, say, () => {
            formHost.textContent = '';
            formHost.appendChild(emailForm('link', say, () => rerender()));
            formHost.querySelector<HTMLInputElement>('input')?.focus();
          });
        });
        row.appendChild(b);
      }
      list.appendChild(row);
    }
    const out = button('ob-btn ps-logout', 'Выйти');
    out.addEventListener('click', () => {
      out.disabled = true;
      void logout().then(() => rerender(), e => { out.disabled = false; say(authErrorText(e instanceof AuthError ? e.code : 'network')); });
    });
    acc.append(list, formHost, out);
  } else {
    acc.appendChild(el('p', 'ps-text', 'Вы не вошли. Войдите, чтобы доски синхронизировались между устройствами и не пропали при очистке браузера — все доски этого устройства сохранятся.'));
    const row = el('div', 'ps-providers');
    for (const p of ['email', 'telegram', 'google'] as const) {
      const b = button(`ob-btn ob-chip ob-${p}`, PROVIDER_NAMES[p], PROVIDER_ICONS[p]);
      b.dataset.provider = p;
      b.addEventListener('click', () => {
        void chooseProvider(p, 'login', resume, say, () => {
          formHost.textContent = '';
          formHost.appendChild(emailForm('login', say, () => rerender()));
          formHost.querySelector<HTMLInputElement>('input')?.focus();
        });
      });
      row.appendChild(b);
    }
    acc.append(row, formHost);
  }
  acc.appendChild(msg);
  if (opts.notice) say(opts.notice.text, opts.notice.kind);

  box.append(nameField, cursorBlock, acc);
  host.appendChild(box);
  // вошли / вышли / сменился тариф — раздел перерисовывается
  const off = onAccountChange(() => rerender());
  return { dispose: () => { off(); limited.destroy(); picker.dispose(); } };
}
