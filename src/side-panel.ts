// Правая боковая панель (SPEC_CHAT §5): #side-panel с режимами «Чат и уведомления», «История изменений»,
// «Справка», «Импорт», «Экспорт». Каркас: шапка с переключателем режимов (Spring dropdown, src/spring-select.ts)
// и действиями режима справа, ниже — виды режимов (монтируются при первом показе, src/panel-types.ts).
//
// Геометрия (широкий экран): панель 360 px у правого края (12 px от краёв окна), кнопка закрытия #side-panel-close —
// язычок 32×40, прикреплённый к левому краю панели снаружи (без зазора и правого скругления). Правая сторона шапки (.topbar-left) и #bottombar уезжают влево
// (--side-panel-shift); в режиме ЧУ кнопка ЧУ «влилась» в кнопку закрытия: её место в шапке — ровно под
// кнопкой закрытия (--side-panel-tuck), сама она скрыта. В других режимах ЧУ видна слева от кнопки закрытия:
// [аватары][Поделиться][ЧУ][✕]|панель|. Узкий экран (< 760 px): панель — лист под шапкой, кнопка закрытия —
// в шапке панели справа, шапка доски не сдвигается, кнопка ЧУ остаётся на месте (она и переключает лист).
//
// Три режима анимаций (SPEC_CHAT §0):
// - «Улучшенные» — пружины общего цикла src/motion.ts: кнопка закрытия выходит из кнопки ЧУ и перелетает
//   к панели (soft 260/24), облачко сжимается и поворачивается, «свернуть вправо» раскрывается с поворотом,
//   счётчик ЧУ перелетает в переключатель режимов, панель вырастает из угла кнопки (clip-path), содержимое
//   проявляется (fade 420/32) с небольшой задержкой, шапка и нижняя панель едут той же пружиной. Закрытие —
//   обратно: панель сворачивается в угол, кнопка летит на место ЧУ, превращается обратно, и ЧУ «принимает» её;
// - «Обычные» — панель выезжает справа с прозрачностью (220 мс), сдвиг и кнопки — CSS-переходы;
// - «Выкл» и «уменьшить движение» — всё сразу.
// Текст — только textContent; через innerHTML вставляются лишь SVG-константы каталога иконок.

import { S, clamp, register, snap, step, tune, wake, type Spring } from './motion';
import { claimMenu, menuMotion, releaseMenu, type MenuMotion } from './menu-motion';
import { createSpringSelect, type SelectOption, type SpringSelect } from './spring-select';
import { formatUnread, onNotices, unreadCount } from './notify-center';
import { NOTIFY_ICON, PANEL_COLLAPSE_ICON } from './icons';
import { setTopbarReserve } from './topbar-fit';
import type { PanelMode, PanelModeDef, PanelView } from './panel-types';

export type { PanelMode, PanelModeDef, PanelView } from './panel-types';

/** Ключ localStorage: последний режим (и другие настройки панели, например вкладка ЧУ). */
export const SIDE_PANEL_KEY = 'doska.sidePanel';
/** Уже этой ширины окно — панель листом. */
export const SIDE_PANEL_NARROW = 760;
/** Ширина панели (как --side-panel-w в style.css). */
export const SIDE_PANEL_W = 360;
const BTN = 48;      // кнопка ЧУ
const BAR_GAP = 12;  // промежуток между кнопками шапки
/** Язычок «Свернуть панель», прикреплённый к левому краю панели (как --sp-tab-* в style.css). */
const TAB_W = 32;
const TAB_H = 40;
const TAB_TOP = 8;   // от верха панели (панель — 12 px от верха окна, кнопка ЧУ — тоже)
/** На сколько уезжает правая сторона шапки и нижняя панель: панель + язычок + промежуток. */
export const SIDE_PANEL_SHIFT = SIDE_PANEL_W + TAB_W + BAR_GAP;
/** В режиме ЧУ место кнопки ЧУ — под кнопкой закрытия: шапка уезжает на столько меньше. */
const TUCK = BTN + BAR_GAP;
const CSS_MS = 220;
const FADE_DELAY = 0.08; // с: содержимое проявляется, когда панель уже начала расти

const SOFT: readonly [number, number] = [260, 24];
const FADE: readonly [number, number] = [420, 32];
const POP: readonly [number, number] = [520, 16];

export interface SidePanelState { open: boolean; mode: PanelMode }

interface ModeEntry { def: PanelModeDef; host: HTMLElement | null; view: PanelView | null }

const modes = new Map<PanelMode, ModeEntry>();
const subs = new Set<(s: SidePanelState) => void>();
let isOpen = false;
let current: PanelMode = 'notify';

interface Ui {
  panel: HTMLElement;
  inner: HTMLElement;
  head: HTMLElement;
  actions: HTMLElement;
  body: HTMLElement;
  close: HTMLButtonElement;
  cloud: HTMLElement;
  cross: HTMLElement;
  select: SpringSelect;
}
let ui: Ui | null = null;

// ----- Настройки в localStorage -----

/** Сохранённые настройки панели (режим и то, что добавят режимы); битые данные — пусто. */
export function sidePanelPref(): Record<string, unknown> {
  try {
    const raw = localStorage.getItem(SIDE_PANEL_KEY);
    const v = raw ? JSON.parse(raw) as unknown : null;
    return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
  } catch { return {}; }
}

/** Дописать настройки панели (например, вкладку ЧУ): остальные поля сохраняются. */
export function setSidePanelPref(patch: Record<string, unknown>): void {
  try { localStorage.setItem(SIDE_PANEL_KEY, JSON.stringify({ ...sidePanelPref(), ...patch })); } catch { /* хранилище недоступно */ }
}

function savedMode(): PanelMode | null {
  const m = sidePanelPref().mode;
  return typeof m === 'string' && modes.has(m as PanelMode) ? m as PanelMode : null;
}

// ----- Разметка -----

const narrow = (): boolean => window.innerWidth < SIDE_PANEL_NARROW;
const notifyBtn = (): HTMLElement | null => document.getElementById('btn-notify');

function modeOptions(): SelectOption[] {
  const badge = formatUnread(unreadCount());
  return [...modes.values()].map(({ def }) => ({ value: def.id, label: def.label, icon: def.icon, badge: def.id === 'notify' ? badge : '' }));
}

function build(): Ui {
  const panel = document.createElement('aside');
  panel.id = 'side-panel';
  panel.setAttribute('role', 'complementary');
  panel.setAttribute('aria-label', 'Боковая панель');
  panel.hidden = true;
  const inner = document.createElement('div');
  inner.className = 'sp-inner';
  const head = document.createElement('div');
  head.className = 'sp-head';
  const select = createSpringSelect({
    className: 'sp-mode', label: 'Режим панели', title: 'Режим панели', align: 'start',
    options: modeOptions(), value: current,
    onChange: v => openSidePanel(v as PanelMode),
  });
  const actions = document.createElement('div');
  actions.className = 'sp-actions';
  head.append(select.el, actions);
  const body = document.createElement('div');
  body.className = 'sp-body';
  inner.append(head, body);
  panel.append(inner);

  const close = document.createElement('button');
  close.id = 'side-panel-close';
  close.type = 'button';
  close.className = 'sp-close';
  close.title = 'Свернуть панель';
  close.setAttribute('aria-label', 'Свернуть панель');
  close.setAttribute('aria-controls', 'side-panel');
  close.dataset.tipSide = 'bottom';
  close.hidden = true;
  const cloud = document.createElement('span');
  cloud.className = 'spc-icon spc-cloud';
  cloud.setAttribute('aria-hidden', 'true');
  cloud.innerHTML = NOTIFY_ICON; // константа каталога иконок
  const cross = document.createElement('span');
  cross.className = 'spc-icon spc-cross';
  cross.setAttribute('aria-hidden', 'true');
  cross.innerHTML = PANEL_COLLAPSE_ICON; // константа каталога иконок
  close.append(cloud, cross);
  close.addEventListener('click', () => closeSidePanel());

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      // открытый выпадающий список закрывается первым (spring-select сам гасит событие)
      if (e.defaultPrevented || select.open) return;
      e.preventDefault();
      e.stopPropagation();
      closeSidePanel();
      return;
    }
    // клавиши без модификаторов в панели — её, а не доски (инструменты, стрелки, Delete); F1 и сочетания — дальше
    if (!e.ctrlKey && !e.metaKey && !e.altKey && !/^F\d+$/.test(e.key)) e.stopPropagation();
  };
  panel.addEventListener('keydown', onKey);
  close.addEventListener('keydown', onKey);
  document.body.append(panel, close);
  onNotices(() => ui?.select.setBadge('notify', formatUnread(unreadCount())));
  window.addEventListener('resize', onResize);
  return { panel, inner, head, actions, body, close, cloud, cross, select };
}

function ensureUi(): Ui {
  if (ui && ui.panel.isConnected) return ui;
  ui = build();
  return ui;
}

// ----- Режимы -----

/** Регистрирует режим панели (порядок регистрации — порядок в переключателе). Повторная — заменяет описание. */
export function registerPanelMode(def: PanelModeDef): void {
  const prev = modes.get(def.id);
  modes.set(def.id, { def, host: prev?.host ?? null, view: prev?.view ?? null });
  if (ui) ui.select.setOptions(modeOptions(), current);
}

/** Вид режима: монтируется при первом показе. */
function viewOf(m: PanelMode): ModeEntry | null {
  const e = modes.get(m);
  if (!e) return null;
  if (!e.host) {
    const u = ensureUi();
    const host = document.createElement('div');
    host.className = 'sp-view';
    host.dataset.mode = m;
    host.hidden = true;
    u.body.append(host);
    e.host = host;
    e.view = e.def.mount(host) ?? {};
  }
  return e;
}

function hideView(m: PanelMode): void {
  const e = modes.get(m);
  if (!e?.host || e.host.hidden) return;
  e.host.hidden = true;
  e.view?.hide?.();
}

function showView(m: PanelMode, anim: MenuMotion): void {
  const e = viewOf(m);
  const u = ensureUi();
  if (!e?.host) { u.actions.replaceChildren(); return; }
  const wasHidden = e.host.hidden;
  e.host.hidden = false;
  u.actions.replaceChildren(...(e.view?.actions ? [e.view.actions] : []));
  if (wasHidden) e.view?.show?.();
  if (!wasHidden) return;
  // смена режима в открытой панели: новый вид коротко проявляется
  if (anim === 'enhanced') {
    VF.x = 0; VF.v = 0; VF.t = 1;
    viewFading = e.host;
    kick();
  } else if (anim === 'normal') {
    e.host.classList.remove('sp-view-in');
    void e.host.offsetWidth;
    e.host.classList.add('sp-view-in');
    e.host.addEventListener('animationend', () => e.host?.classList.remove('sp-view-in'), { once: true });
  }
}

/** Фокус в панель: куда скажет вид, иначе первый фокусируемый элемент вида, иначе сам вид. */
function focusInto(m: PanelMode): void {
  const e = modes.get(m);
  const u = ui;
  if (!u) return;
  if (e?.view?.focus) { e.view.focus(); if (u.panel.contains(document.activeElement)) return; }
  const host = e?.host;
  const target = host?.querySelector<HTMLElement>('input:not([disabled]), textarea:not([disabled]), button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])')
    ?? host?.querySelector<HTMLElement>('[tabindex="-1"]')
    ?? u.select.el;
  target.focus({ preventScroll: true });
}

// ----- Пружины («Улучшенные») -----

const SH: Spring = S(0); // сдвиг шапки и нижней панели, px
const TK: Spring = S(0); // место ЧУ под кнопкой закрытия, px
const J: Spring = S(1);  // кнопка закрытия «на» кнопке ЧУ: 1 — совпадают, 0 — у панели
const G: Spring = S(0);  // панель выросла из угла
const F: Spring = S(0);  // содержимое проявилось
const M: Spring = S(0);  // облачко → «свернуть вправо»
const CB: Spring = S(1); // кнопка закрытия «принимает» кнопку ЧУ
const VF: Spring = S(1); // новый вид проявляется
let viewFading: HTMLElement | null = null;
let fly: { el: HTMLElement; Q: Spring; dx: number; dy: number } | null = null;
let time = 0;
let fadeAt = 0;
let absorbed = true;
let caught = true;
let animating = false;
let looped = false;
let cssTimer = 0;

const near = (s: Spring, dx: number, dv: number): boolean => Math.abs(s.x - s.t) < dx && Math.abs(s.v) < dv;

function kick(): void {
  if (!looped) {
    looped = true;
    register({ frame, render, settled: () => !animating });
  }
  animating = true;
  wake();
}

function frame(dt: number): void {
  if (!animating) return;
  time += dt;
  if (isOpen && time >= fadeAt) F.t = 1;
  for (const s of [SH, TK, J, G, F, M, CB, VF]) step(s, dt);
  if (fly) step(fly.Q, dt);
}

function render(): void {
  if (!animating) return;
  const u = ui;
  if (!u || menuMotion() !== 'enhanced') { settle(); return; }
  paint(u);
  const busy = !near(SH, 0.3, 5) || !near(TK, 0.3, 5) || !near(J, 0.004, 0.05) || !near(G, 0.002, 0.03)
    || !near(F, 0.005, 0.05) || !near(M, 0.004, 0.05) || !near(CB, 0.002, 0.03) || (viewFading && !near(VF, 0.005, 0.05))
    || (isOpen && time < fadeAt) || !!fly;
  if (!busy) settle();
}

/** Кадр пружин в DOM. */
function paint(u: Ui): void {
  const root = document.documentElement.style;
  root.setProperty('--side-panel-shift', `${SH.x.toFixed(2)}px`);
  root.setProperty('--side-panel-tuck', `${TK.x.toFixed(2)}px`);
  // кнопка закрытия — на месте кнопки ЧУ (с учётом сдвига шапки) или у панели
  // в полёте кнопка закрытия — кнопка ЧУ (48×48 на её месте), у панели — узкий язычок без правого скругления
  const g0 = narrow() ? 1 : clamp(G.x, 0, 1);
  const k = 1 - g0;
  const dx = narrow() ? 0 : SIDE_PANEL_SHIFT - SH.x + TK.x - TUCK * J.x + (BTN - TAB_W - 1) * k; // язычок заходит на рамку панели на 1 px
  u.close.style.translate = `${dx.toFixed(2)}px ${(-TAB_TOP * k).toFixed(2)}px`;
  if (narrow() || k < 0.002) {
    for (const p of ['width', 'height', 'border-top-right-radius', 'border-bottom-right-radius', 'border-right-width', 'clip-path']) u.close.style.removeProperty(p);
  } else {
    u.close.style.clipPath = 'none'; // в полёте — целая кнопка с тенью со всех сторон
    u.close.style.width = `${(TAB_W + 1 + (BTN - TAB_W - 1) * k).toFixed(2)}px`;
    u.close.style.height = `${(TAB_H + (BTN - TAB_H) * k).toFixed(2)}px`;
    u.close.style.borderTopRightRadius = u.close.style.borderBottomRightRadius = `${(12 * k).toFixed(2)}px`;
    u.close.style.borderRightWidth = k > 0.15 ? '1px' : '0';
  }
  u.close.style.scale = Math.abs(CB.x - 1) < 0.0005 ? '' : CB.x.toFixed(4);
  const m = clamp(M.x, 0, 1.1);
  u.cloud.style.transform = `rotate(${(-90 * m).toFixed(2)}deg) scale(${clamp(1 - 0.7 * m, 0, 1).toFixed(3)})`;
  u.cloud.style.opacity = clamp(1 - m * 1.6, 0, 1).toFixed(3);
  u.cross.style.transform = `rotate(${(-90 * (1 - m)).toFixed(2)}deg) scale(${(0.3 + 0.7 * m).toFixed(3)})`;
  u.cross.style.opacity = clamp(m * 1.6 - 0.6, 0, 1).toFixed(3);
  // панель растёт из правого верхнего угла — там, где стоит кнопка ЧУ
  const g = clamp(G.x, 0, 1);
  const w = u.panel.offsetWidth || SIDE_PANEL_W;
  const h = u.panel.offsetHeight || 600;
  const ins = (v: number) => `${v.toFixed(2)}px`;
  u.panel.style.clipPath = `inset(0 0 ${ins((h - BTN) * (1 - g))} ${ins((w - BTN) * (1 - g))} round ${ins(12 + 4 * g)})`;
  u.inner.style.opacity = clamp(F.x, 0, 1).toFixed(3);
  u.inner.style.translate = `0 ${((1 - clamp(F.x, 0, 1)) * -6).toFixed(2)}px`;
  if (viewFading) {
    viewFading.style.opacity = clamp(VF.x, 0, 1).toFixed(3);
    viewFading.style.translate = `0 ${((1 - clamp(VF.x, 0, 1)) * 6).toFixed(2)}px`;
  }
  // ЧУ скрыта, когда кнопка закрытия уже стоит на ней
  syncMerged(J.x > 0.97);
  // кнопка закрытия почти долетела до ЧУ при закрытии — ЧУ «принимает» её
  if (!isOpen && !absorbed && G.x < 0.25) {
    absorbed = true;
    document.dispatchEvent(new CustomEvent('doska:side-panel-absorb'));
  }
  // ЧУ въехала под кнопку закрытия (переключение на режим ЧУ) — кнопка закрытия пружинит, принимая её
  if (isOpen && !caught && J.x > 0.8) {
    caught = true;
    CB.x = 1.08; CB.v = 0; CB.t = 1;
  }
  if (fly) {
    const q = clamp(fly.Q.x, 0, 1.05);
    fly.el.style.translate = `${(fly.dx * q).toFixed(2)}px ${(fly.dy * q).toFixed(2)}px`;
    fly.el.style.scale = (1 - 0.35 * clamp(q, 0, 1)).toFixed(3);
    fly.el.style.opacity = (q < 0.7 ? 1 : clamp((1 - q) / 0.3, 0, 1)).toFixed(3);
    if (q > 0.98) { fly.el.remove(); fly = null; }
  }
}

/** Всё на месте: инлайн анимации снимается, дальше — CSS по классам. */
function settle(): void {
  animating = false;
  for (const s of [SH, TK, J, G, F, M, CB, VF]) snap(s);
  fly?.el.remove();
  fly = null;
  const u = ui;
  applyStatic();
  if (!u) return;
  for (const p of ['translate', 'scale', 'width', 'height', 'border-top-right-radius', 'border-bottom-right-radius', 'border-right-width', 'clip-path']) u.close.style.removeProperty(p);
  for (const el of [u.cloud, u.cross]) { el.style.removeProperty('transform'); el.style.removeProperty('opacity'); }
  u.panel.style.removeProperty('clip-path');
  u.inner.style.removeProperty('opacity');
  u.inner.style.removeProperty('translate');
  if (viewFading) { viewFading.style.removeProperty('opacity'); viewFading.style.removeProperty('translate'); viewFading = null; }
  if (!isOpen && !absorbed) { absorbed = true; document.dispatchEvent(new CustomEvent('doska:side-panel-absorb')); }
}

// ----- Целевое состояние -----

const targetShift = (): number => (isOpen && !narrow() ? SIDE_PANEL_SHIFT : 0);
const targetTuck = (): number => (isOpen && !narrow() && current === 'notify' ? TUCK : 0);
const targetJoin = (): number => (!isOpen || narrow() || current === 'notify' ? 1 : 0);

/** ЧУ «влилась» в кнопку закрытия (широкий экран, режим ЧУ). */
function syncMerged(ready: boolean): void {
  const on = isOpen && !narrow() && current === 'notify' && ready;
  notifyBtn()?.classList.toggle('sp-merged', on);
}

/** Конечное состояние без пружин: классы, переменные и видимость («Обычные», «Выкл» и конец анимации). */
function applyStatic(): void {
  const root = document.documentElement.style;
  root.setProperty('--side-panel-shift', `${targetShift()}px`);
  root.setProperty('--side-panel-tuck', `${targetTuck()}px`);
  document.body.classList.toggle('side-panel-open', isOpen);
  document.body.classList.toggle('side-panel-notify', isOpen && current === 'notify');
  syncMerged(true);
  const u = ui;
  if (!u) return;
  u.panel.classList.toggle('sp-open', isOpen);
  u.close.classList.toggle('on', isOpen);
  if (isOpen) { u.panel.hidden = false; u.close.hidden = false; }
  else if (!cssTimer) { u.panel.hidden = true; u.close.hidden = true; }
}

function syncReserve(): void {
  setTopbarReserve(isOpen && !narrow() ? SIDE_PANEL_SHIFT - targetTuck() : 0);
}

function onResize(): void {
  if (!ui) return;
  // переход «широкий ↔ узкий» — сразу
  if (animating) settle();
  else applyStatic();
  syncReserve();
}

function emit(): void {
  const s = { open: isOpen, mode: current };
  for (const fn of [...subs]) {
    try { fn(s); } catch (e) { console.error(e); }
  }
}

/** Пружины к новым целям; from — откуда начинается (только что открыта: кнопка закрытия выходит из ЧУ). */
function animateTo(anim: MenuMotion, opening: boolean, closing: boolean): void {
  const u = ensureUi();
  clearTimeout(cssTimer);
  cssTimer = 0;
  if (anim === 'enhanced') {
    u.panel.classList.remove('sp-css');
    u.close.classList.remove('sp-css');
    if (opening && !animating) {
      // старт из закрытого состояния: всё в кнопке ЧУ
      SH.x = 0; TK.x = 0; J.x = 1; G.x = 0; F.x = 0; M.x = 0;
      for (const s of [SH, TK, J, G, F, M]) s.v = 0;
    }
    for (const s of [SH, TK, J, G, M]) tune(s, ...SOFT);
    tune(F, ...FADE);
    tune(CB, ...POP);
    tune(VF, ...FADE);
    SH.t = targetShift();
    TK.t = targetTuck();
    J.t = targetJoin();
    G.t = isOpen ? 1 : 0;
    M.t = isOpen ? 1 : 0;
    time = 0;
    fadeAt = opening ? FADE_DELAY : 0;
    if (!isOpen) F.t = 0;
    if (closing) absorbed = false;
    if (isOpen && J.t === 1 && J.x < 0.9) caught = false;
    document.body.classList.toggle('side-panel-open', isOpen);
    document.body.classList.toggle('side-panel-notify', isOpen && current === 'notify');
    u.panel.hidden = false;
    u.close.hidden = false;
    u.panel.classList.toggle('sp-open', isOpen);
    u.close.classList.toggle('on', isOpen);
    if (opening) flyBadge(u);
    paint(u);
    kick();
    return;
  }
  if (animating) settle();
  const css = anim === 'normal';
  u.panel.classList.toggle('sp-css', css);
  u.close.classList.toggle('sp-css', css);
  if (opening) {
    u.panel.hidden = false;
    u.close.hidden = false;
    if (css) { void u.panel.offsetWidth; } // старт CSS-перехода из закрытого вида
  }
  if (closing && css) {
    cssTimer = window.setTimeout(() => { cssTimer = 0; applyStatic(); }, CSS_MS);
  }
  applyStatic();
  if (closing && anim === 'normal') document.dispatchEvent(new CustomEvent('doska:side-panel-absorb'));
}

/** «Улучшенные»: счётчик кнопки ЧУ перелетает в переключатель режимов. */
function flyBadge(u: Ui): void {
  if (current !== 'notify' || narrow()) return;
  const from = notifyBtn()?.querySelector<HTMLElement>('.nb-badge.on');
  const text = formatUnread(unreadCount());
  if (!from || !text) return;
  const a = from.getBoundingClientRect();
  const b = u.select.el.getBoundingClientRect();
  if (!a.width || !b.width) return;
  fly?.el.remove();
  const el = document.createElement('span');
  el.className = 'sp-fly-badge';
  el.setAttribute('aria-hidden', 'true');
  el.textContent = text;
  el.style.left = `${a.left.toFixed(1)}px`;
  el.style.top = `${a.top.toFixed(1)}px`;
  document.body.append(el);
  const Q = S(0);
  tune(Q, ...SOFT);
  Q.t = 1;
  fly = { el, Q, dx: b.right - 34 - a.left, dy: b.top + b.height / 2 - a.height / 2 - a.top };
}

// ----- API -----

/** Панель открыта. */
export function sidePanelOpen(): boolean {
  return isOpen;
}

/** Текущий режим (и у закрытой панели — тот, что откроется). */
export function sidePanelMode(): PanelMode {
  return current;
}

/** Подписка на открытие, закрытие и смену режима; возвращает отписку. */
export function onSidePanel(fn: (s: SidePanelState) => void): () => void {
  subs.add(fn);
  return () => { subs.delete(fn); };
}

/** Открыть панель (в режиме mode, без него — в последнем; уже открытая — переключается). */
export function openSidePanel(mode?: PanelMode, opts: { focus?: boolean } = {}): void {
  const next = mode && modes.has(mode) ? mode : (isOpen ? current : savedMode() ?? (modes.has('notify') ? 'notify' : [...modes.keys()][0]));
  if (!next) return;
  const u = ensureUi();
  const anim = menuMotion();
  const opening = !isOpen;
  if (!opening && next === current) {
    if (opts.focus !== false) focusInto(current);
    return;
  }
  // открытое всплывающее меню шапки закрывается (сама панель меню не «занимает»)
  if (opening) { claimMenu('side-panel', () => {}); releaseMenu('side-panel'); }
  if (!opening) hideView(current);
  current = next;
  isOpen = true;
  setSidePanelPref({ mode: next });
  if (u.select.value !== next) u.select.setValue(next, opening);
  showView(next, opening ? 'off' : anim);
  animateTo(anim, opening, false);
  syncReserve();
  emit();
  if (opts.focus !== false) focusInto(next);
}

/** Закрыть панель; instant — без анимации (уход на домашнюю страницу). */
export function closeSidePanel(instant = false): void {
  if (!isOpen) return;
  const u = ensureUi();
  const hadFocus = u.panel.contains(document.activeElement) || u.close.contains(document.activeElement);
  u.select.close(true);
  isOpen = false;
  hideView(current);
  animateTo(instant ? 'off' : menuMotion(), false, true);
  syncReserve();
  emit();
  if (hadFocus) notifyBtn()?.focus({ preventScroll: true });
}

/** Открыть в режиме mode или закрыть, если панель уже открыта в нём. */
export function toggleSidePanel(mode: PanelMode): void {
  if (isOpen && current === mode) closeSidePanel();
  else openSidePanel(mode);
}

/** Элементы панели (для тестов и интегратора). */
export function sidePanelElements(): { panel: HTMLElement; close: HTMLButtonElement; select: SpringSelect } {
  const u = ensureUi();
  return { panel: u.panel, close: u.close, select: u.select };
}

/** Сброс для unit-тестов: панель закрыта, режимы забыты, разметка убрана. */
export function resetSidePanelForTests(): void {
  if (animating) settle();
  clearTimeout(cssTimer);
  cssTimer = 0;
  isOpen = false;
  current = 'notify';
  modes.clear();
  // подписчики (кнопка ЧУ, стопка) живут всё время модуля — не сбрасываются
  ui?.panel.remove();
  ui?.close.remove();
  window.removeEventListener('resize', onResize);
  ui = null;
  setTopbarReserve(0);
}
