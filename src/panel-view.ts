// Общие детали видов боковой панели («История», «Справка», «Импорт», «Экспорт»): каркас с прокруткой
// (своя тонкая полоса, как в окне «Поделиться»), строка-кнопка с иконкой и подсказки. Текст — только
// через textContent; через innerHTML вставляются лишь SVG-константы из src/icons.ts.

import { attachOverlayScroll, type OverlayScroll } from './overlay-scroll';

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** Иконка-константа каталога (src/icons.ts) в обёртке. */
export function iconEl(className: string, svg: string): HTMLSpanElement {
  const s = el('span', className);
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = svg; // константа каталога иконок, без пользовательских данных
  return s;
}

export interface PanelScaffold {
  /** Корень вида: колонка на всю высоту панели. */
  root: HTMLElement;
  /** Неподвижная рамка прокрутки (в ней лежит ползунок). */
  box: HTMLElement;
  /** Прокручиваемое содержимое. */
  body: HTMLElement;
  scroll: OverlayScroll;
}

/** Каркас вида: корень .pv, ниже — прокручиваемая часть со своей тонкой полосой и тенями у краёв. */
export function panelScaffold(host: HTMLElement, kind: string): PanelScaffold {
  const root = el('div', `pv pv-${kind}`);
  // запасное место для фокуса при открытии, когда в виде нечего нажать
  root.tabIndex = -1;
  const box = el('div', 'pv-scroll-box');
  const body = el('div', 'pv-scroll');
  box.append(body);
  root.append(box);
  host.append(root);
  const scroll = attachOverlayScroll(body, { axis: 'y', host: box, edges: 'shadow' });
  return { root, box, body, scroll };
}

/**
 * Подсказка элемента. title подхватывает общий пузырь (src/tooltip.ts) и переносит в data-tip;
 * пустая подсказка убирает и уже перенесённую.
 */
export function setTip(e: HTMLElement, text: string): void {
  if (text) {
    if (e.dataset.tip !== undefined) e.dataset.tip = text;
    else e.title = text;
  } else {
    e.removeAttribute('title');
    delete e.dataset.tip;
  }
}

export interface RowOptions {
  /** Идентификатор строки (data-row): по нему строку находят тесты и обработчики. */
  id: string;
  icon: string;
  title: string;
  hint?: string;
  /** Метка справа («Скоро»). */
  badge?: string;
  /** Клавиши справа (подписи, по одной на клавишу). */
  keys?: string[];
}

/** Строка-кнопка: иконка в скруглённом квадрате, заголовок и пояснение. */
export function rowButton(o: RowOptions): HTMLButtonElement {
  const b = el('button', 'pv-row');
  b.type = 'button';
  b.dataset.row = o.id;
  const text = el('span', 'pv-row-text');
  text.append(el('span', 'pv-row-title', o.title));
  if (o.hint) text.append(el('span', 'pv-row-hint', o.hint));
  b.append(iconEl('pv-row-icon', o.icon), text);
  if (o.keys?.length) {
    const keys = el('span', 'pv-keys');
    for (const k of o.keys) keys.append(el('kbd', '', k));
    b.append(keys);
  }
  if (o.badge) b.append(el('span', 'pv-badge', o.badge));
  return b;
}

/**
 * Недоступная строка: aria-disabled, а не disabled — на ней видна подсказка «почему» (у disabled-кнопки
 * браузер не показывает наведение), а щелчок отбрасывает обработчик (rowDisabled).
 */
export function setRowDisabled(b: HTMLElement, disabled: boolean, why = ''): void {
  if (disabled) b.setAttribute('aria-disabled', 'true');
  else b.removeAttribute('aria-disabled');
  b.classList.toggle('is-disabled', disabled);
  setTip(b, disabled ? why : '');
}

export function rowDisabled(b: Element): boolean {
  return b.getAttribute('aria-disabled') === 'true';
}
