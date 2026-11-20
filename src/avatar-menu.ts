// Контекстное меню аватара (группа аватаров в шапке). Пункты собирает вызывающий (src/collab-presence.ts) —
// здесь только разметка, расстановка, закрытие и движение по трём уровням анимаций (src/menu-motion.ts).
// Подменю (пункт kind: 'submenu', например «Настройки доступа») открывается в этом же меню переходом drillMenu —
// как «Тип сетки» в «Масштаб и вид»: пункт становится заголовком со стрелкой «назад».
// Имя и статус приходят от других участников — только textContent; иконки — константы кода.

import { createUserAvatar, type AvatarData } from './avatar';
import { BACK_ARROW_ICON } from './icons';
import { morphLeave } from './morph-tooltip';
import { claimMenu, closeMenu, drillMenu, menuShown, openMenu, releaseMenu } from './menu-motion';
import { createToggleSwitch } from './toggle-switch';

/** Содержимое подменю: узел и закрытие его выпадающих списков (меню закрывается или уходит назад). */
export interface AvatarSubmenu { el: HTMLElement; close?: () => void }

export type AvatarMenuEntry =
  | {
    kind: 'action'; id: string; label: string; icon: string; run: () => void;
    disabled?: boolean; title?: string; danger?: boolean;
    /** Опасное действие: первое нажатие меняет подпись на эту, второе (в течение CONFIRM_MS) — выполняет. */
    confirm?: string;
    /** Пометка справа (например, «Скоро»). */
    badge?: string;
  }
  | { kind: 'switch'; id: string; label: string; icon: string; checked: boolean; onChange: (on: boolean) => void; disabled?: boolean; title?: string; badge?: string }
  /** Подменю в этом же меню: содержимое строится при каждом входе. */
  | { kind: 'submenu'; id: string; label: string; icon: string; title?: string; content: () => AvatarSubmenu }
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
interface Current {
  menu: HTMLElement;
  spec: AvatarMenuSpec;
  cleanup: () => void;
  /** Страница меню сейчас: корневая или подменю. */
  page: HTMLElement;
  /** Открытое подменю: из какого пункта и его содержимое. */
  sub: { id: string; content: AvatarSubmenu } | null;
}
let current: Current | null = null;

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

function submenuRow(e: Extract<AvatarMenuEntry, { kind: 'submenu' }>): HTMLButtonElement {
  const b = el('button', 'avatar-menu-item avatar-menu-drill');
  b.type = 'button';
  b.setAttribute('role', 'menuitem');
  b.setAttribute('aria-haspopup', 'true');
  b.dataset.action = e.id;
  if (e.title) b.title = e.title;
  const icon = el('span', 'main-menu-icon');
  icon.innerHTML = e.icon; // константа кода
  b.append(icon, el('span', 'main-menu-text', e.label));
  const arrow = el('span', 'view-arrow', '›');
  arrow.setAttribute('aria-hidden', 'true');
  b.append(arrow);
  b.addEventListener('click', ev => { ev.stopPropagation(); drillIn(e); });
  return b;
}

/** Корневая страница меню (строится заново при каждом возврате: drillMenu оставляет на ушедшей странице инлайн). */
function rootPage(entries: readonly AvatarMenuEntry[]): HTMLElement {
  const page = el('div', 'view-page avatar-menu-page');
  for (const e of entries) {
    if (e.kind === 'sep') page.append(el('hr', ''));
    else page.append(e.kind === 'action' ? actionRow(e) : e.kind === 'switch' ? switchRow(e) : submenuRow(e));
  }
  return page;
}

/** В подменю: пункт становится заголовком со стрелкой «назад», под ним — содержимое. */
function drillIn(e: Extract<AvatarMenuEntry, { kind: 'submenu' }>): void {
  const c = current;
  if (!c || c.sub) return;
  const from = c.page;
  const content = e.content();
  const to = el('div', 'view-page avatar-menu-page avatar-menu-subpage');
  to.dataset.submenu = e.id;
  const back = el('button', 'view-back avatar-menu-item');
  back.type = 'button';
  back.dataset.action = 'back';
  back.setAttribute('aria-label', `Назад: ${e.label}`);
  const icon = el('span', 'main-menu-icon');
  const arrow = el('span', 'vb-arrow');
  arrow.innerHTML = BACK_ARROW_ICON; // константа кода
  const ghost = el('span', 'vb-ghost');
  ghost.innerHTML = e.icon; // константа кода
  icon.append(arrow, ghost);
  const tail = el('span', 'view-arrow vb-ghost', '›');
  tail.setAttribute('aria-hidden', 'true');
  back.append(icon, el('span', 'main-menu-text', e.label), tail);
  back.addEventListener('click', ev => { ev.stopPropagation(); drillOut(); });
  to.append(back, el('hr', ''), content.el);
  const focused = c.menu.contains(document.activeElement);
  // ширина меню не скачет при смене страниц: держится та, с которой меню открылось
  c.menu.style.width = `${c.menu.offsetWidth}px`;
  drillMenu(c.menu, from, to, { dir: 'in', row: from.querySelector<HTMLElement>(`[data-action="${e.id}"]`) ?? undefined, head: back });
  c.page = to;
  c.sub = { id: e.id, content };
  if (focused) back.focus({ preventScroll: true });
}

/** Из подменю назад: заголовок уезжает на место пункта. */
function drillOut(): void {
  const c = current;
  if (!c || !c.sub) return;
  const { id, content } = c.sub;
  content.close?.();
  const from = c.page;
  const to = rootPage(c.spec.entries);
  const focused = c.menu.contains(document.activeElement);
  drillMenu(c.menu, from, to, { dir: 'out', row: to.querySelector<HTMLElement>(`[data-action="${id}"]`) ?? undefined, head: from.querySelector<HTMLElement>('.view-back') ?? undefined });
  c.page = to;
  c.sub = null;
  if (focused) to.querySelector<HTMLElement>(`[data-action="${id}"]`)?.focus({ preventScroll: true });
}

function switchRow(e: Extract<AvatarMenuEntry, { kind: 'switch' }>): HTMLLabelElement {
  const row = createToggleSwitch({ className: 'grid-switch avatar-menu-switch', label: e.label, icon: e.icon, checked: e.checked, title: e.title, onChange: e.onChange });
  row.dataset.action = e.id;
  const input = row.querySelector<HTMLInputElement>('.switch-input')!;
  if (e.disabled) input.disabled = true;
  if (e.badge) {
    // переключатель скрыт за меткой (например, «Pro»): ввод недоступен
    input.disabled = true;
    row.classList.add('has-badge');
    row.querySelector('.switch-track')?.replaceWith(el('span', 'avatar-menu-badge avatar-menu-badge-pro', e.badge));
  }
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
  menu.dataset.tipSide = 'left'; // подсказки — сбоку от меню (в режиме без анимаций тоже)
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
  const page = rootPage(spec.entries);
  menu.append(head, page);
  document.body.append(menu);
  spec.anchor.setAttribute('aria-expanded', 'true');

  const away = (ev: PointerEvent) => {
    if (ev.target instanceof Node && (menu.contains(ev.target) || spec.anchor.contains(ev.target))) return;
    // выпадающий список подменю стоит в body поверх меню — нажатие в нём меню не закрывает
    if (ev.target instanceof Element && ev.target.closest('.ss-menu')) return;
    closeAvatarMenu();
  };
  const onKey = (ev: KeyboardEvent) => {
    if (ev.key !== 'Escape') return;
    // Esc при открытом выпадающем списке закрывает только список (его обработчик на кнопке)
    if (menu.querySelector('.ss-trigger[aria-expanded="true"]')) return;
    ev.stopPropagation();
    // в подменю Esc возвращает назад, в корне — закрывает меню
    if (current?.menu === menu && current.sub) { drillOut(); return; }
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
    morphLeave(true); // подсказка и подсветка пункта не остаются висеть после закрытия меню
  };
  current = { menu, spec, cleanup, page, sub: null };
  claimMenu(KEY, () => closeAvatarMenu());
  openMenu(menu, {
    from: spec.anchor, remove: true, place: () => place(menu, spec.anchor),
    items: () => [head, ...[...page.children].filter((n): n is HTMLElement => n instanceof HTMLElement)],
  });
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
  c.sub?.content.close?.();
  c.spec.anchor.setAttribute('aria-expanded', 'false');
  releaseMenu(KEY);
  closeMenu(c.menu, instant);
  c.spec.onClose?.();
}
