// Выпадающий список на пружинах (по мотивам «Spring dropdown» с designbookmark.com/motion, dropdown.js).
// Меню выпадает из-под кнопки: высота — пружина с небольшим перелётом, строки появляются по очереди,
// подсветка тянется между строками (край, обращённый к движению, — жёсткий, отстающий — мягкий),
// у выбранной строки рисуется галочка, новое значение вкатывается в кнопку, и меню складывается.
// Пружины — ровно как в образце: высота 300/23, прозрачность 400/34, строки 300/24, галочка 260/26,
// нажатие кнопки 500/18, значение 340/26, подсветка 620/36 и 200/20.
//
// Три режима анимаций доски:
// - «Улучшенные» — пружины;
// - «Обычные» (body.no-motion) — меню выплывает и гаснет CSS-анимацией, как остальные меню;
// - «Выкл» (body.no-ui-anim) и «уменьшить движение» — меню показывается и прячется сразу.
//
// Клавиатура: стрелки, Enter или пробел открывают; стрелки, Home, End двигают; Enter выбирает; Esc закрывает.
// Фокус остаётся на кнопке. Меню — role="listbox" внутри того же окна (фокус-ловушка окна не ломается),
// стоит position: fixed и потому не обрезается прокруткой окна. Текст — только textContent.

import { S, clamp, motionEnabled, reduceMotion, register, snap, step, tune, uiAnimOff, wake, type Spring } from './motion';
import { createRoll, type Roll } from './roll-text';

export interface SelectOption {
  value: string;
  label: string;
  /** Красная строка-действие (например, «Отозвать приглашение»): отделена от остальных. */
  danger?: boolean;
  /** Действие, а не значение: сообщается через onChange, но выбранным не становится. */
  action?: boolean;
  /** Подсказка строки. */
  title?: string;
  /** Иконка строки — SVG-константа кода (не данные пользователя): перед подписью; у кнопки — иконка выбранного. */
  icon?: string;
  /** Счётчик справа в строке (акцентная пилюля, например непрочитанные); пусто — нет. */
  badge?: string;
}

export interface SpringSelectOptions {
  /** Классы кнопки (по ним её находят стили и тесты). */
  className: string;
  /** Доступное имя кнопки и списка. */
  label: string;
  options: readonly SelectOption[];
  value: string;
  onChange: (value: string) => void;
  /** Подсказка кнопки. */
  title?: string;
  /** Край, по которому меню выравнивается с кнопкой. */
  align?: 'start' | 'end';
}

export interface SpringSelect {
  readonly el: HTMLButtonElement;
  readonly value: string;
  /** Список открыт и ждёт выбора (после выбора меню ещё складывается, но уже не считается открытым). */
  readonly open: boolean;
  /** Новый список и значение (без события; меню, если открыто, закрывается). */
  setOptions(options: readonly SelectOption[], value: string): void;
  /** Значение без события: вкатывается, если меню закрыто и значение сменилось. */
  setValue(value: string, instant?: boolean): void;
  setDisabled(disabled: boolean): void;
  close(instant?: boolean): void;
  /**
   * Счётчик пункта value без пересоздания списка: строка открытого меню и кнопка обновляются на месте.
   * На кнопке виден счётчик первого НЕвыбранного пункта со счётчиком (у выбранного он и так «прочитан»).
   */
  setBadge(value: string, text: string): void;
}

const ROW_SHIFT = 14;   // px: строка выпадает сверху (у меню над кнопкой — снизу)
const GAP = 6;          // px: от кнопки до меню
const MARGIN = 8;       // px: от края окна
const T_CLOSE = 0.24;   // с: после выбора меню складывается

const CHEV = '<svg class="ss-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
const TICK = '<svg class="ss-tick" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

type Mode = 'off' | 'normal' | 'enhanced';
const modeNow = (): Mode => (uiAnimOff() || reduceMotion() ? 'off' : motionEnabled() ? 'enhanced' : 'normal');

interface Row { el: HTMLElement; opt: SelectOption; s: Spring; k: Spring; wait: number; top: number; h: number }

interface Inst {
  trigger: HTMLButtonElement;
  menu: HTMLElement | null;
  rows: Row[];
  opts: SpringSelectOptions;
  value: string;
  isOpen: boolean;
  above: boolean;
  mode: Mode;
  time: number;
  closeAt: number;
  MH: number;
  H: Spring; C: Spring; O: Spring; TS: Spring;
  HT: Spring; HB: Spring; HO: Spring;
  hov: number;
  cssTimer: number;
  roll: Roll;
  badge: HTMLElement;
}

let uid = 0;
let openInst: Inst | null = null;
const moving = new Set<Inst>();
let registered = false;

function ensureLoop(): void {
  if (registered) return;
  registered = true;
  register({ frame, render, settled: () => moving.size === 0 });
  // нажатие мимо меню и кнопки закрывает; прокрутка окна или смена размера — тоже (меню стоит fixed)
  document.addEventListener('pointerdown', e => {
    const o = openInst;
    if (!o || !e.isTrusted) return;
    const t = e.target as Node;
    if (o.trigger.contains(t) || o.menu?.contains(t)) return;
    closeInst(o);
  }, true);
  document.addEventListener('scroll', e => {
    const o = openInst;
    if (o && e.target instanceof Node && !o.menu?.contains(e.target) && e.target.contains(o.trigger)) closeInst(o, true);
  }, true);
  window.addEventListener('resize', () => { if (openInst) closeInst(openInst, true); });
}

function frame(dt: number): void {
  for (const it of moving) {
    it.time += dt;
    for (const s of [it.H, it.C, it.O, it.TS, it.HT, it.HB, it.HO]) step(s, dt);
    for (const r of it.rows) {
      if (it.time >= r.wait) r.s.t = it.isOpen ? 1 : 0;
      step(r.s, dt);
      step(r.k, dt);
    }
    if (it.closeAt > 0 && it.time >= it.closeAt) { it.closeAt = 0; closeInst(it); }
  }
}

const rest = (s: Spring, e = 0.01): boolean => Math.abs(s.x - s.t) < e && Math.abs(s.v) < e * 10;

function render(): void {
  for (const it of [...moving]) {
    if (!it.trigger.isConnected) { dropMenu(it); moving.delete(it); continue; }
    it.trigger.style.scale = Math.abs(it.TS.x - 1) < 0.0005 ? '' : it.TS.x.toFixed(4);
    const chev = it.trigger.querySelector<SVGElement>('.ss-chev');
    if (chev) chev.style.transform = it.C.x < 0.001 ? '' : `rotate(${(180 * it.C.x).toFixed(2)}deg)`;
    const m = it.menu;
    if (m && it.mode === 'enhanced') {
      const h = Math.max(0, it.H.x);
      const o = clamp(it.O.x, 0, 1);
      m.style.height = `${h.toFixed(2)}px`;
      m.style.opacity = o.toFixed(3);
      m.style.visibility = h < 1 ? 'hidden' : 'visible';
      m.style.transform = `scaleX(${(0.9 + 0.1 * clamp(it.MH ? h / it.MH : 1, 0, 1.06)).toFixed(4)})`;
      for (const r of it.rows) {
        const s = clamp(r.s.x, 0, 1);
        r.el.style.opacity = s.toFixed(3);
        r.el.style.transform = `translateY(${((r.s.x - 1) * ROW_SHIFT * (it.above ? -1 : 1)).toFixed(2)}px)`;
        const tick = r.el.querySelector<SVGPathElement>('.ss-tick path');
        if (tick) tick.style.strokeDashoffset = (22 * (1 - clamp(r.k.x, 0, 1))).toFixed(2);
      }
      const hl = m.querySelector<HTMLElement>('.ss-hl');
      if (hl) {
        hl.style.opacity = (clamp(it.HO.x, 0, 1) * o).toFixed(3);
        const ht = Math.min(it.HT.x, it.HB.x - 16);
        const hb = Math.max(it.HB.x, ht + 16);
        hl.style.height = `${(hb - ht).toFixed(2)}px`;
        hl.style.transform = `translateY(${ht.toFixed(2)}px)`;
      }
    }
    const still = [it.H, it.C, it.O, it.TS, it.HT, it.HB, it.HO].every(s => rest(s)) && it.rows.every(r => rest(r.s, 0.005) && rest(r.k, 0.005)) && it.closeAt === 0;
    if (still) {
      moving.delete(it);
      it.trigger.style.removeProperty('scale');
      if (!it.isOpen) dropMenu(it);
    }
  }
}

/** Меню убирается из документа. */
function dropMenu(it: Inst): void {
  clearTimeout(it.cssTimer);
  it.cssTimer = 0;
  it.menu?.remove();
  it.menu = null;
  it.rows = [];
  const chev = it.trigger.querySelector<SVGElement>('.ss-chev');
  if (chev) chev.style.removeProperty('transform');
}

function setHover(it: Inst, i: number, snapIt = false): void {
  if (i < 0 || i >= it.rows.length || i === it.hov) return;
  const r = it.rows[i];
  if (snapIt || it.hov < 0 || it.mode !== 'enhanced') {
    it.HT.x = it.HT.t = r.top;
    it.HB.x = it.HB.t = r.top + r.h;
    it.HT.v = it.HB.v = 0;
  } else {
    const down = i > it.hov;
    tune(down ? it.HB : it.HT, 620, 36);
    tune(down ? it.HT : it.HB, 200, 20);
    it.HT.t = r.top;
    it.HB.t = r.top + r.h;
  }
  it.hov = i;
  it.HO.t = 1;
  for (const [j, row] of it.rows.entries()) row.el.classList.toggle('hover', j === i);
  it.trigger.setAttribute('aria-activedescendant', r.el.id);
  if (it.mode !== 'enhanced') placeHighlight(it);
  else { moving.add(it); wake(); }
}

/** «Обычные» и «Выкл»: подсветка встаёт на строку (движение — CSS-переход). */
function placeHighlight(it: Inst): void {
  const hl = it.menu?.querySelector<HTMLElement>('.ss-hl');
  if (!hl) return;
  const r = it.rows[it.hov];
  hl.style.opacity = r ? '1' : '0';
  if (r) { hl.style.transform = `translateY(${r.top}px)`; hl.style.height = `${r.h}px`; }
}

function buildMenu(it: Inst): HTMLElement {
  const menu = document.createElement('div');
  menu.className = 'ss-menu';
  menu.id = `ss-menu-${++uid}`;
  menu.setAttribute('role', 'listbox');
  menu.setAttribute('aria-label', it.opts.label);
  const hl = document.createElement('i');
  hl.className = 'ss-hl';
  hl.setAttribute('aria-hidden', 'true');
  menu.append(hl);
  it.rows = it.opts.options.map((opt, i) => {
    const el = document.createElement('div');
    el.className = `ss-opt${opt.danger ? ' danger' : ''}`;
    el.id = `${menu.id}-o${i}`;
    el.setAttribute('role', 'option');
    el.dataset.value = opt.value;
    if (opt.title) el.title = opt.title;
    const selected = !opt.action && opt.value === it.value;
    el.setAttribute('aria-selected', String(selected));
    if (opt.icon) {
      const ic = document.createElement('span');
      ic.className = 'ss-opt-icon';
      ic.setAttribute('aria-hidden', 'true');
      ic.innerHTML = opt.icon; // константа из кода
      el.append(ic);
    }
    const text = document.createElement('span');
    text.className = 'ss-opt-text';
    text.textContent = opt.label;
    el.append(text);
    const badge = document.createElement('span');
    badge.className = 'ss-opt-badge';
    badge.setAttribute('aria-hidden', 'true');
    badge.textContent = opt.badge ?? '';
    badge.hidden = !opt.badge;
    el.append(badge);
    if (!opt.action) el.insertAdjacentHTML('beforeend', TICK); // константа из кода
    el.addEventListener('pointermove', () => { if (it.isOpen) setHover(it, i); });
    el.addEventListener('click', () => { if (it.isOpen) choose(it, i); });
    menu.append(el);
    const k = S(selected ? 1 : 0, 260, 26);
    return { el, opt, s: S(0, 300, 24), k, wait: 0, top: 0, h: 0 };
  });
  // фокус остаётся на кнопке
  menu.addEventListener('pointerdown', e => e.preventDefault());
  return menu;
}

/** Ставит меню у кнопки: под ней, а если снизу мало места — над ней. */
function place(it: Inst): void {
  const m = it.menu!;
  const r = it.trigger.getBoundingClientRect();
  m.style.minWidth = `${Math.round(r.width)}px`;
  m.style.height = 'auto';
  m.style.visibility = 'hidden';
  const w = m.offsetWidth;
  const h = m.scrollHeight;
  it.MH = h;
  for (const row of it.rows) { row.top = row.el.offsetTop; row.h = row.el.offsetHeight; }
  const below = window.innerHeight - r.bottom - GAP - MARGIN;
  const aboveSpace = r.top - GAP - MARGIN;
  it.above = h > below && aboveSpace > below;
  const left = it.opts.align === 'start' ? r.left : r.right - w;
  m.style.left = `${Math.round(clamp(left, MARGIN, Math.max(MARGIN, window.innerWidth - w - MARGIN)))}px`;
  if (it.above) { m.style.top = 'auto'; m.style.bottom = `${Math.round(window.innerHeight - r.top + GAP)}px`; }
  else { m.style.bottom = 'auto'; m.style.top = `${Math.round(r.bottom + GAP)}px`; }
  m.style.maxHeight = `${Math.max(120, it.above ? aboveSpace : below)}px`;
  m.style.transformOrigin = it.above ? '50% 100%' : '50% 0';
  m.dataset.side = it.above ? 'above' : 'below';
  m.style.removeProperty('visibility');
  m.style.removeProperty('height');
}

function openSel(it: Inst): void {
  if (it.isOpen || it.trigger.disabled) return;
  ensureLoop();
  if (openInst && openInst !== it) closeInst(openInst);
  if (it.menu) dropMenu(it);
  openInst = it;
  it.isOpen = true;
  it.closeAt = 0;
  it.mode = modeNow();
  it.time = 0;
  it.hov = -1;
  const menu = buildMenu(it);
  it.menu = menu;
  const host = it.trigger.closest<HTMLElement>('[role="dialog"]') ?? document.body;
  host.append(menu);
  place(it);
  it.trigger.setAttribute('aria-expanded', 'true');
  it.trigger.setAttribute('aria-controls', menu.id);
  const sel = it.rows.findIndex(r => !r.opt.action && r.opt.value === it.value);
  if (it.mode === 'enhanced') {
    it.H.t = it.MH;
    it.C.t = 1;
    it.O.t = 1;
    it.rows.forEach((r, i) => { r.wait = 0.05 + i * 0.045; });
    menu.style.height = '0px';
    menu.style.opacity = '0';
    for (const r of it.rows) { r.el.style.opacity = '0'; }
    it.TS.x = 0.965;
    setHover(it, Math.max(0, sel), true);
    moving.add(it);
    wake();
    return;
  }
  for (const r of it.rows) r.s.x = r.s.t = 1;
  it.H.x = it.H.t = it.MH;
  it.C.x = it.C.t = 1;
  const chev = it.trigger.querySelector<SVGElement>('.ss-chev');
  if (chev) chev.style.transform = 'rotate(180deg)';
  if (it.mode === 'normal') menu.classList.add('ss-in');
  setHover(it, Math.max(0, sel), true);
}

function closeInst(it: Inst, instant = false): void {
  if (openInst === it) openInst = null;
  it.closeAt = 0;
  if (!it.isOpen) { if (instant) { dropMenu(it); moving.delete(it); } return; }
  it.isOpen = false;
  it.hov = -1;
  it.trigger.setAttribute('aria-expanded', 'false');
  it.trigger.removeAttribute('aria-controls');
  it.trigger.removeAttribute('aria-activedescendant');
  const mode = instant ? 'off' : modeNow();
  if (mode === 'enhanced' && it.menu && it.mode === 'enhanced') {
    it.time = 0;
    it.H.t = 0;
    it.C.t = 0;
    it.O.t = 0;
    it.HO.t = 0;
    const n = it.rows.length;
    it.rows.forEach((r, i) => { r.wait = (n - 1 - i) * 0.02; });
    moving.add(it);
    wake();
    return;
  }
  snap(it.TS);
  it.trigger.style.removeProperty('scale');
  if (mode === 'normal' && it.menu) {
    const m = it.menu;
    m.classList.remove('ss-in');
    m.classList.add('ss-out');
    m.style.pointerEvents = 'none';
    it.cssTimer = window.setTimeout(() => { if (!it.isOpen && it.menu === m) dropMenu(it); }, 130);
    const chev = it.trigger.querySelector<SVGElement>('.ss-chev');
    if (chev) chev.style.removeProperty('transform');
    return;
  }
  dropMenu(it);
  moving.delete(it);
}

function choose(it: Inst, i: number): void {
  const r = it.rows[i];
  if (!r) return;
  const opt = r.opt;
  if (!opt.action && opt.value !== it.value) {
    it.value = opt.value;
    it.trigger.dataset.value = opt.value;
    it.roll.set(opt.label, { icon: opt.icon });
    syncTriggerBadge(it);
    for (const row of it.rows) {
      const on = !row.opt.action && row.opt.value === opt.value;
      row.el.setAttribute('aria-selected', String(on));
      row.k.t = on ? 1 : 0;
      if (it.mode !== 'enhanced') snap(row.k);
    }
  }
  if (it.mode === 'enhanced') {
    it.TS.x = 0.955;
    it.closeAt = it.time + T_CLOSE;
    // выбор сделан: пока список складывается, он уже не открыт — Esc достаётся окну или меню вокруг
    it.trigger.setAttribute('aria-expanded', 'false');
    moving.add(it);
    wake();
  } else closeInst(it);
  it.opts.onChange(opt.value);
}

/** Счётчик на кнопке: первый невыбранный пункт со счётчиком. */
function syncTriggerBadge(it: Inst): void {
  const other = it.opts.options.find(o => !o.action && o.value !== it.value && o.badge);
  const text = other?.badge ?? '';
  if (it.badge.textContent !== text && text) it.badge.textContent = text;
  it.badge.classList.toggle('on', !!text);
  it.trigger.classList.toggle('ss-has-badge', !!text);
}

export function createSpringSelect(o: SpringSelectOptions): SpringSelect {
  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = `ss-trigger ${o.className}`;
  trigger.setAttribute('aria-haspopup', 'listbox');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.setAttribute('aria-label', o.label);
  if (o.title) trigger.title = o.title;
  const roll = createRoll('ss-value', 18, { enter: [340, 26], leave: [340, 26] });
  const tBadge = document.createElement('span');
  tBadge.className = 'ss-badge';
  tBadge.setAttribute('aria-hidden', 'true');
  trigger.append(roll.el, tBadge);
  trigger.insertAdjacentHTML('beforeend', CHEV); // константа из кода
  const it: Inst = {
    trigger, menu: null, rows: [], opts: { ...o, options: [...o.options] }, value: o.value, isOpen: false, above: false,
    mode: 'enhanced', time: 0, closeAt: 0, MH: 0,
    H: S(0, 300, 23), C: S(0, 300, 18), O: S(0, 400, 34), TS: S(1, 500, 18),
    HT: S(0, 620, 36), HB: S(0, 620, 36), HO: S(0, 400, 32),
    hov: -1, cssTimer: 0, roll, badge: tBadge,
  };
  const optOf = (v: string) => it.opts.options.find(x => !x.action && x.value === v);
  const labelOf = (v: string) => optOf(v)?.label ?? v;
  const iconOf = (v: string) => optOf(v)?.icon;
  trigger.dataset.value = o.value;
  roll.set(labelOf(o.value), { instant: true, icon: iconOf(o.value) });
  syncTriggerBadge(it);

  trigger.addEventListener('click', () => {
    if (it.isOpen) closeInst(it);
    else openSel(it);
  });
  trigger.addEventListener('keydown', e => {
    const n = it.rows.length;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!it.isOpen) { openSel(it); return; }
      const d = e.key === 'ArrowDown' ? 1 : -1;
      setHover(it, clamp((it.hov < 0 ? 0 : it.hov + d), 0, n - 1));
    } else if ((e.key === 'Home' || e.key === 'End') && it.isOpen) {
      e.preventDefault();
      setHover(it, e.key === 'Home' ? 0 : n - 1);
    } else if ((e.key === 'Enter' || e.key === ' ') && it.isOpen && it.hov >= 0) {
      e.preventDefault();
      choose(it, it.hov);
    } else if (e.key === 'Escape' && it.isOpen && it.closeAt === 0) {
      // Esc закрывает только список, окно остаётся
      e.preventDefault();
      e.stopPropagation();
      closeInst(it);
    } else if (e.key === 'Tab' && it.isOpen) closeInst(it);
  });

  return {
    el: trigger,
    get value() { return it.value; },
    get open() { return it.isOpen && it.closeAt === 0; },
    setOptions(options, value) {
      if (it.isOpen) closeInst(it, true);
      it.opts = { ...it.opts, options: [...options] };
      it.value = value;
      trigger.dataset.value = value;
      roll.set(labelOf(value), { instant: true, icon: iconOf(value) });
      syncTriggerBadge(it);
    },
    setValue(value, instant = false) {
      if (value === it.value) return;
      it.value = value;
      trigger.dataset.value = value;
      roll.set(labelOf(value), { instant: instant || it.isOpen, icon: iconOf(value) });
      if (it.isOpen) closeInst(it, true);
      syncTriggerBadge(it);
    },
    setDisabled(d) {
      trigger.disabled = d;
      if (d && it.isOpen) closeInst(it, true);
    },
    close(instant = false) { closeInst(it, instant); },
    setBadge(value, text) {
      const i = it.opts.options.findIndex(x => x.value === value);
      if (i < 0 || (it.opts.options[i].badge ?? '') === text) return;
      const options = [...it.opts.options];
      options[i] = { ...options[i], badge: text };
      it.opts = { ...it.opts, options };
      const row = it.rows.find(r => r.opt.value === value);
      if (row) {
        row.opt = options[i];
        const b = row.el.querySelector<HTMLElement>('.ss-opt-badge');
        if (b) { b.textContent = text; b.hidden = !text; }
      }
      syncTriggerBadge(it);
    },
  };
}
