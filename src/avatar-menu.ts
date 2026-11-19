// Контекстное меню аватара (группа аватаров в шапке). Пункты собирает вызывающий (src/collab-presence.ts) —
// здесь только разметка, расстановка, закрытие и движение по трём уровням анимаций (src/menu-motion.ts).
// Имя и статус приходят от других участников — только textContent; иконки — константы кода.

import { createUserAvatar, type AvatarData } from './avatar';
import { claimMenu, closeMenu, menuShown, openMenu, releaseMenu } from './menu-motion';
import { createToggleSwitch } from './toggle-switch';

export type AvatarMenuEntry =
  | {
    kind: 'action'; id: string; label: string; icon: string; run: () => void;
    disabled?: boolean; title?: string; danger?: boolean;
    /** Опасное действие: первое нажатие меняет подпись на эту, второе (в течение CONFIRM_MS) — выполняет. */
    confirm?: string;
    /** Пометка справа (например, «Скоро»). */
    badge?: string;
  }
  | { kind: 'switch'; id: string; label: string; icon: string; checked: boolean; onChange: (on: boolean) => void; disabled?: boolean; title?: string }
  | { kind: 'sep' };

export interface AvatarMenuSpec {
  anchor: HTMLElement;
  /** Шапка меню: аватар, имя и строка статуса. */
  face: AvatarData;
  name: string;
  sub: string;
  entries: readonly AvatarMenuEntry[];
  /** Меню закрылось (любым способом). */
  onClose?: () => void;
}

/** Сколько ждёт подтверждения опасный пункт, мс. */
export const CONFIRM_MS = 3000;

const KEY = 'avatar';
let current: { menu: HTMLElement; spec: AvatarMenuSpec; cleanup: () => void } | null = null;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

function actionRow(e: Extract<AvatarMenuEntry, { kind: 'action' }>): HTMLButtonElement {
  const b = el('button', 'avatar-menu-item' + (e.danger ? ' danger' : ''));
  b.type = 'button';
  b.setAttribute('role', 'menuitem');
  b.dataset.action = e.id;
  if (e.title) b.title = e.title;
  const icon = el('span', 'main-menu-icon');
  icon.innerHTML = e.icon; // константа кода
  const text = el('span', 'main-menu-text', e.label);
  b.append(icon, text);
  if (e.badge) b.append(el('span', 'avatar-menu-badge', e.badge));
  if (e.disabled) { b.disabled = true; b.setAttribute('aria-disabled', 'true'); return b; }
  let armed = 0;
  b.addEventListener('click', ev => {
    ev.stopPropagation();
    if (e.confirm && !armed) {
      text.textContent = e.confirm;
      b.classList.add('armed');
      armed = window.setTimeout(() => { armed = 0; text.textContent = e.label; b.classList.remove('armed'); }, CONFIRM_MS);
      return;
    }
    clearTimeout(armed);
    closeAvatarMenu();
    e.run();
  });
  return b;
}

function switchRow(e: Extract<AvatarMenuEntry, { kind: 'switch' }>): HTMLLabelElement {
  const row = createToggleSwitch({ className: 'grid-switch avatar-menu-switch', label: e.label, icon: e.icon, checked: e.checked, title: e.title, onChange: e.onChange });
  row.dataset.action = e.id;
  const input = row.querySelector<HTMLInputElement>('.switch-input')!;
  if (e.disabled) input.disabled = true;
  return row;
}

/** Меню под аватаром, в пределах окна. */
function place(menu: HTMLElement, anchor: HTMLElement): void {
  const r = anchor.getBoundingClientRect();
  const w = menu.offsetWidth;
  const h = menu.offsetHeight;
  const left = Math.max(8, Math.min(r.left + r.width / 2 - w / 2, window.innerWidth - w - 8));
  let top = r.bottom + 8;
  if (top + h > window.innerHeight - 8 && r.top - 8 - h >= 8) top = r.top - 8 - h;
  menu.style.left = `${Math.round(left)}px`;
  menu.style.top = `${Math.round(top)}px`;
}

/** Открытое меню аватара (для тестов и проверок). */
export function avatarMenuOpen(): boolean {
  return !!current && menuShown(current.menu);
}

/** Открыть меню; открытое раньше (в том числе у другого аватара) закрывается. */
export function openAvatarMenu(spec: AvatarMenuSpec): HTMLElement {
  closeAvatarMenu(true);
  const menu = el('div', 'popup-menu menu-list avatar-menu');
  menu.id = 'avatar-menu';
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', spec.name);
  const head = el('div', 'avatar-menu-head');
  const face = createUserAvatar(spec.face, 'avatar-menu-face');
  face.tabIndex = -1;
  face.setAttribute('aria-hidden', 'true');
  const who = el('div', 'avatar-menu-who');
  who.append(el('div', 'avatar-menu-name', spec.name));
  if (spec.sub) who.append(el('div', 'avatar-menu-sub', spec.sub));
  head.append(face, who);
  menu.append(head);
  for (const e of spec.entries) {
    if (e.kind === 'sep') menu.append(el('hr', ''));
    else menu.append(e.kind === 'action' ? actionRow(e) : switchRow(e));
  }
  document.body.append(menu);
  spec.anchor.setAttribute('aria-expanded', 'true');

  const away = (ev: PointerEvent) => {
    if (ev.target instanceof Node && (menu.contains(ev.target) || spec.anchor.contains(ev.target))) return;
    closeAvatarMenu();
  };
  const onKey = (ev: KeyboardEvent) => {
    if (ev.key !== 'Escape') return;
    ev.stopPropagation();
    closeAvatarMenu();
    spec.anchor.focus();
  };
  // pointerdown, которым меню открыли, сюда уже не попадёт: подписка — после него
  const timer = setTimeout(() => document.addEventListener('pointerdown', away, true), 0);
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('resize', closeAvatarMenuSoon);
  const cleanup = () => {
    clearTimeout(timer);
    document.removeEventListener('pointerdown', away, true);
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', closeAvatarMenuSoon);
  };
  current = { menu, spec, cleanup };
  claimMenu(KEY, () => closeAvatarMenu());
  openMenu(menu, { from: spec.anchor, remove: true, place: () => place(menu, spec.anchor) });
  menu.querySelector<HTMLElement>('button:not(:disabled), input:not(:disabled)')?.focus({ preventScroll: true });
  return menu;
}

function closeAvatarMenuSoon(): void { closeAvatarMenu(true); }

/** Закрыть меню аватара; instant — без анимации. */
export function closeAvatarMenu(instant = false): void {
  const c = current;
  if (!c) return;
  current = null;
  c.cleanup();
  c.spec.anchor.setAttribute('aria-expanded', 'false');
  releaseMenu(KEY);
  closeMenu(c.menu, instant);
  c.spec.onClose?.();
}
