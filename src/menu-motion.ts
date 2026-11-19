// Всплывающие меню шапки и углов: «Меню» с подменю, «Экспорт», иконка проекта, «Поделиться»,
// «Масштаб и вид», «Помощь и советы». Здесь общее для всех.
//  1. Открытое меню одно: claimMenu() закрывает то, что было открыто до него.
//  2. Появление и закрытие по трём уровням анимации (настройка доски «Анимации»):
//     • «Выкл» и системное «уменьшить движение» — меню показывается и прячется сразу;
//     • «Обычные» — CSS: меню выплывает со стороны кнопки (класс mm-in) и быстро гаснет (mm-out);
//     • «Улучшенные» — пружины motion.ts: контейнер выходит из кнопки-вызова, растягивается до своего
//       размера, затем пункты появляются по очереди; кнопка при этом пружинит, будто меню вышло из неё.
//       Закрытие — контейнер быстро втягивается обратно в кнопку.
//  3. Переход внутри открытого меню (drillMenu): подменю «Тип сетки» и «Фон страницы» в «Масштаб и вид».
// Пока идёт анимация, геометрия меню пишется инлайном (left/top/width/height), а прежние инлайн-значения
// запоминаются; когда всё успокоилось, они возвращаются, и меню снова живёт по своему CSS.

import { S, clamp, motionEnabled, reduceMotion, register, snap, spring, step, tune, uiAnimOff, wake, type Spring } from './motion';

export type MenuMotion = 'off' | 'normal' | 'enhanced';

/** Уровень анимации меню сейчас. */
export function menuMotion(): MenuMotion {
  if (uiAnimOff() || reduceMotion()) return 'off';
  return motionEnabled() ? 'enhanced' : 'normal';
}

// ----- Одно открытое меню -----

let claimed: { key: string; close: () => void } | null = null;

/** Меню key открывается: открытое до него другое меню закрывается. close должна быть безопасна при повторном вызове. */
export function claimMenu(key: string, close: () => void): void {
  if (claimed && claimed.key !== key) {
    const prev = claimed;
    claimed = null;
    prev.close();
  }
  claimed = { key, close };
}

/** Меню key закрылось. */
export function releaseMenu(key: string): void {
  if (claimed?.key === key) claimed = null;
}

// ----- Геометрия -----

interface Rect { x: number; y: number; w: number; h: number }
type Side = 'below' | 'above' | 'right' | 'left';

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const rectOf = (r: DOMRect): Rect => ({ x: r.left, y: r.top, w: r.width, h: r.height });
const lerpRect = (a: Rect, b: Rect, t: number): Rect => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), w: lerp(a.w, b.w, t), h: lerp(a.h, b.h, t) });
/** Прямоугольник, уменьшенный в k раз вокруг своего центра. */
const shrink = (r: Rect, k: number): Rect => ({ x: r.x + (r.w * (1 - k)) / 2, y: r.y + (r.h * (1 - k)) / 2, w: r.w * k, h: r.h * k });
const sized = (r: Rect): boolean => r.w > 0 && r.h > 0;

/** С какой стороны кнопки стоит меню. */
function sideOf(from: Rect, menu: Rect): Side {
  if (from.y + from.h <= menu.y + 1) return 'below';
  if (from.y >= menu.y + menu.h - 1) return 'above';
  if (from.x + from.w <= menu.x + 1) return 'right';
  if (from.x >= menu.x + menu.w - 1) return 'left';
  return from.y + from.h / 2 <= menu.y + menu.h / 2 ? 'below' : 'above';
}

/** «Вышедший из кнопки» контейнер: размером с кнопку, у края меню, обращённого к ней. */
function seedOf(from: Rect, menu: Rect, side: Side): Rect {
  if (side === 'below' || side === 'above') {
    const w = Math.min(from.w, menu.w);
    const h = Math.min(from.h, menu.h);
    const x = clamp(from.x + (from.w - w) / 2, menu.x, menu.x + menu.w - w);
    return { x, y: side === 'below' ? menu.y : menu.y + menu.h - h, w, h };
  }
  // подменю сбоку от пункта: короткий отрезок высотой с пункт
  const h = Math.min(from.h, menu.h);
  const w = Math.min(from.h * 1.5, menu.w);
  const y = clamp(from.y, menu.y, menu.y + menu.h - h);
  return { x: side === 'right' ? menu.x : menu.x + menu.w - w, y, w, h };
}

/** Откуда выходит контейнер: кнопка, уменьшенная к центру (для подменю — правый край пункта). */
function startOf(from: Rect, seed: Rect, side: Side): Rect {
  if (side === 'right') return shrink({ x: from.x + from.w - seed.w, y: from.y, w: seed.w, h: from.h }, 0.6);
  if (side === 'left') return shrink({ x: from.x, y: from.y, w: seed.w, h: from.h }, 0.6);
  return shrink(from, 0.6);
}

/** Сдвиг пункта в момент появления: со стороны кнопки. */
function shiftOf(side: Side): { x: number; y: number } {
  if (side === 'below') return { x: 0, y: -6 };
  if (side === 'above') return { x: 0, y: 6 };
  return { x: side === 'right' ? -6 : 6, y: 0 };
}

// ----- Пружины (токены --menu-* в style.css) -----

let EMERGE: [number, number] = [700, 42];   // контейнер выходит из кнопки
let GROW: [number, number] = [520, 34];     // растягивается до своего размера (небольшой перелёт)
let ITEM: [number, number] = [560, 38];     // пункт появляется
let CLOSE: [number, number] = [1200, 70];   // втягивается обратно (без перелёта)
let POP: [number, number] = [520, 16];      // кнопка пружинит

const T_GROW = 0.06;     // с: контейнер начинает растягиваться
const T_ITEMS = 0.12;    // с: появляется первый пункт
const STAGGER = 0.028;    // с: пауза между пунктами…
const STAGGER_SUM = 0.12; // …но все вместе не дольше этого

/** Пружина почти дошла и почти стоит: dx — по положению, dv — по скорости (в секунду).
 *  Строже не нужно: в конце инлайн снимается, и меню встаёт на место по CSS. */
const near = (s: Spring, dx: number, dv: number): boolean => Math.abs(s.x - s.t) < dx && Math.abs(s.v) < dv;

const stagger = (n: number): number => Math.min(STAGGER, STAGGER_SUM / Math.max(1, n - 1));

// ----- Меню: открытие и закрытие -----

export interface MenuOpts {
  /** Кнопка или контейнер, из которого выходит меню. */
  from: HTMLElement;
  /** Что пружинит при открытии; по умолчанию from, null — ничего. */
  pop?: HTMLElement | null;
  /** Пункты, которые появляются по очереди; по умолчанию — видимые дочерние элементы. */
  items?: () => HTMLElement[];
  /** Пункты по очереди снизу вверх (меню раскрывается вверх). */
  reverse?: boolean;
  /** from — контейнер, а не кнопка: меню выходит из него целиком и при закрытии уходит в него целиком
   *  (иначе — из середины кнопки и в её середину). */
  whole?: boolean;
  /** Расставить меню: вызывается, когда оно уже показано и без инлайна анимации. */
  place?: () => void;
  /** Закрытое меню удалить из документа (окна, которые создаются при каждом открытии). */
  remove?: boolean;
  /** Анимация закончилась: меню стоит на своём месте или уже спрятано. */
  onSettled?: () => void;
}

interface ItemAnim { el: HTMLElement; p: Spring; wait: number; o0: number }

interface Morph {
  el: HTMLElement;
  opts: MenuOpts;
  phase: 'open' | 'close';
  time: number;
  side: Side;
  origin: { x: number; y: number };
  saved: Map<string, string>;
  start: Rect; seed: Rect; final: Rect; cur: Rect;
  E: Spring; GX: Spring; GY: Spring; A: Spring;
  items: ItemAnim[];
  shift: { x: number; y: number };
  observer: MutationObserver | null;
  // закрытие
  Q: Spring; from0: Rect; to: Rect; a0: number;
  /** Контейнер уже ушёл под кнопку, и она спружинила. */
  absorbed: boolean;
}

/** Инлайн-свойства, которые анимация пишет сама и потом возвращает. */
const GEOMETRY = ['left', 'top', 'right', 'bottom', 'width', 'height', 'opacity', 'z-index'];

const morphs = new Map<HTMLElement, Morph>();
const cssClosing = new Map<HTMLElement, number>();
const shown = new WeakSet<HTMLElement>();
const lastOpts = new WeakMap<HTMLElement, MenuOpts>();
const pops = new Map<HTMLElement, Spring>();
let ready = false;

function ensure(): void {
  if (ready) return;
  ready = true;
  [EMERGE, GROW, ITEM, CLOSE, POP] = [
    spring('--menu-emerge', EMERGE), spring('--menu-grow', GROW), spring('--menu-item', ITEM),
    spring('--menu-close', CLOSE), spring('--spring-pop', POP),
  ];
  register({ frame, render, settled });
}

/** Меню открыто (закрывающееся уже не считается открытым). */
export function menuShown(el: HTMLElement): boolean {
  return shown.has(el) && el.isConnected;
}

function saveGeometry(el: HTMLElement): Map<string, string> {
  const saved = new Map<string, string>();
  for (const p of GEOMETRY) saved.set(p, el.style.getPropertyValue(p));
  return saved;
}

function restoreGeometry(el: HTMLElement, saved: Map<string, string>): void {
  for (const [p, v] of saved) {
    if (v) el.style.setProperty(p, v);
    else el.style.removeProperty(p);
  }
}

function clearItem(el: HTMLElement): void {
  el.style.removeProperty('opacity');
  el.style.removeProperty('translate');
}

/** Начало координат для left/top меню: у fixed — окно, у absolute — рамка родителя (подменю). */
function originOf(el: HTMLElement): { x: number; y: number } {
  const parent = el.offsetParent;
  if (!(parent instanceof HTMLElement) || getComputedStyle(el).position === 'fixed') return { x: 0, y: 0 };
  const r = parent.getBoundingClientRect();
  return { x: r.left + parent.clientLeft, y: r.top + parent.clientTop };
}

function defaultItems(el: HTMLElement): HTMLElement[] {
  return [...el.children].filter((c): c is HTMLElement => c instanceof HTMLElement && !c.hidden);
}

function itemsOf(m: Morph): HTMLElement[] {
  const list = (m.opts.items ?? (() => defaultItems(m.el)))();
  return m.opts.reverse ? list.reverse() : list;
}

/** Убирает анимацию меню без следа: инлайн и классы — как до неё. */
function drop(m: Morph): void {
  m.observer?.disconnect();
  restoreGeometry(m.el, m.saved);
  m.el.classList.remove('mm-morph', 'mm-closing');
  for (const it of m.items) clearItem(it.el);
  morphs.delete(m.el);
}

function hideNow(el: HTMLElement, opts: MenuOpts): void {
  el.classList.remove('mm-in', 'mm-out', 'mm-closing');
  if (opts.remove) el.remove();
  else el.hidden = true;
  opts.onSettled?.();
}

/** Доводит закрывающееся меню до конца сразу (перед тем как открыть такое же заново). */
export function settleMenu(el: HTMLElement): void {
  const timer = cssClosing.get(el);
  if (timer !== undefined) {
    clearTimeout(timer);
    cssClosing.delete(el);
    hideNow(el, lastOpts.get(el) ?? { from: el });
    return;
  }
  const m = morphs.get(el);
  if (!m) return;
  drop(m);
  if (m.phase === 'close') hideNow(el, m.opts);
  else m.opts.onSettled?.();
}

/**
 * Слой, на котором закрывающееся меню уходит ПОД свою кнопку: у подменю (absolute внутри меню) — под пункты
 * родителя, у меню в document.body — сразу под плашкой кнопки (шапка или правый нижний угол).
 */
function underZ(el: HTMLElement, from: HTMLElement): string {
  if (getComputedStyle(el).position !== 'fixed') return '-1';
  let z = NaN;
  for (let a: HTMLElement | null = from; a && a !== document.body; a = a.parentElement) {
    const cs = getComputedStyle(a);
    if (cs.position !== 'static' && cs.zIndex !== 'auto') z = Number(cs.zIndex);
  }
  return Number.isFinite(z) ? String(z - 1) : '0';
}

/** Кнопка пружинит: сжимается и с перелётом возвращается к своему размеру. */
function popButton(b: HTMLElement | null): void {
  if (!b) return;
  const r = b.getBoundingClientRect();
  if (!r.width || !r.height) return;
  // широкие контейнеры сжимаются на те же несколько пикселей, что и кнопки, а не на ту же долю
  const dip = clamp(8 / Math.max(r.width, r.height), 0.03, 0.12);
  let s = pops.get(b);
  if (!s) { s = S(1); pops.set(b, s); }
  tune(s, ...POP);
  s.x = 1 - dip;
  s.v = 0;
  s.t = 1;
}

/** Меню ушло в кнопку: она чуть раздувается, будто в неё что-то вошло, и с перелётом успокаивается. */
function absorbButton(b: HTMLElement | null): void {
  if (!b || !b.isConnected) return;
  const r = b.getBoundingClientRect();
  if (!r.width || !r.height) return;
  const bump = clamp(7 / Math.max(r.width, r.height), 0.025, 0.1);
  let s = pops.get(b);
  if (!s) { s = S(1); pops.set(b, s); }
  tune(s, ...POP);
  s.x = 1 + bump;
  s.v = 0;
  s.t = 1;
}

/** Показывает меню el. Уже открытое не трогает; закрывающееся разворачивает обратно. */
export function openMenu(el: HTMLElement, opts: MenuOpts): void {
  ensure();
  lastOpts.set(el, opts);
  if (shown.has(el)) {
    const m = morphs.get(el);
    if (m) m.opts = opts;
    return;
  }
  shown.add(el);
  const prev = morphs.get(el);
  const cssTimer = cssClosing.get(el);
  if (cssTimer !== undefined) { clearTimeout(cssTimer); cssClosing.delete(el); }
  // закрывающееся меню разворачивается с того места, где оно сейчас
  const resume = prev ? { rect: prev.cur, a: Number(el.style.opacity || 1), items: new Map(prev.items.map(it => [it.el, clamp(it.o0 * (1 - clamp(prev.Q.x * 3, 0, 1)), 0, 1)])) } : null;
  if (prev) drop(prev);
  el.classList.remove('mm-in', 'mm-out', 'mm-closing');
  el.hidden = false;
  opts.place?.();
  const mode = menuMotion();
  if (mode === 'off') { opts.onSettled?.(); return; }
  const final = rectOf(el.getBoundingClientRect());
  const fromRect = rectOf(opts.from.getBoundingClientRect());
  // без раскладки (jsdom, скрытая кнопка) показывать нечего
  if (!sized(final)) { opts.onSettled?.(); return; }
  const side = sized(fromRect) ? sideOf(fromRect, final) : 'below';
  el.dataset.side = side;
  if (mode === 'normal') {
    void el.offsetWidth; // перезапуск CSS-анимации, если меню не успело спрятаться
    el.classList.add('mm-in');
    el.addEventListener('animationend', () => el.classList.remove('mm-in'), { once: true });
    opts.onSettled?.();
    return;
  }
  popButton(opts.pop === undefined ? opts.from : opts.pop);
  const seed = resume ? resume.rect : sized(fromRect) ? seedOf(fromRect, final, side) : shrink(final, 0.3);
  const start = resume ? resume.rect : sized(fromRect) ? (opts.whole ? fromRect : startOf(fromRect, seed, side)) : shrink(final, 0.2);
  const m: Morph = {
    el, opts, phase: 'open', time: 0, side,
    origin: originOf(el),
    saved: saveGeometry(el),
    start, seed, final, cur: start,
    E: S(resume ? 1 : 0), GX: S(0), GY: S(0), A: S(resume ? resume.a : 0),
    items: [], shift: shiftOf(side), observer: null,
    Q: S(0), from0: start, to: start, a0: 1, absorbed: false,
  };
  m.E.t = 1; m.A.t = 1;
  tune(m.E, ...EMERGE); tune(m.A, ...CLOSE);
  // ширина растягивается чуть живее высоты: меню «разворачивается» от кнопки
  tune(m.GX, GROW[0] * 1.25, GROW[1] * 1.1); tune(m.GY, ...GROW);
  const list = itemsOf(m);
  const gap = stagger(list.length);
  m.items = list.map((item, i) => {
    const p = S(resume?.items.get(item) ?? 0);
    p.t = 1;
    tune(p, ...ITEM);
    return { el: item, p, wait: T_ITEMS + i * gap, o0: 1 };
  });
  el.classList.add('mm-morph');
  el.style.right = 'auto';
  el.style.bottom = 'auto';
  morphs.set(el, m);
  // содержимое поменялось на ходу (окно «Поделиться» дозагрузило данные) — меню растёт к новому размеру
  if (typeof MutationObserver === 'function') {
    m.observer = new MutationObserver(() => remeasure(m));
    m.observer.observe(el, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'class'] });
  }
  renderMorph(m);
  wake();
}

/** Новый конечный размер меню, когда его содержимое изменилось во время появления. */
function remeasure(m: Morph): void {
  if (m.phase !== 'open' || morphs.get(m.el) !== m) return;
  m.observer?.takeRecords();
  const cur = new Map<string, string>();
  for (const p of GEOMETRY) cur.set(p, m.el.style.getPropertyValue(p));
  restoreGeometry(m.el, m.saved);
  m.el.classList.remove('mm-morph');
  const final = rectOf(m.el.getBoundingClientRect());
  m.el.classList.add('mm-morph');
  restoreGeometry(m.el, cur);
  m.observer?.takeRecords();
  if (sized(final)) m.final = final;
  wake();
}

/** Прячет меню el (с анимацией по уровню); instant — сразу. Повторный вызов не мешает идущему закрытию. */
export function closeMenu(el: HTMLElement, instant = false): void {
  ensure();
  if (drill?.menu === el) finishDrill();
  const opts = lastOpts.get(el) ?? { from: el };
  const wasShown = shown.has(el);
  shown.delete(el);
  const m = morphs.get(el);
  if (m?.phase === 'close' || cssClosing.has(el)) {
    if (instant) settleMenu(el);
    return;
  }
  if (!wasShown && !m) {
    if (!el.hidden && !opts.remove) el.hidden = true;
    return;
  }
  const mode = menuMotion();
  const rect = m ? m.cur : rectOf(el.getBoundingClientRect());
  if (instant || mode === 'off' || el.hidden || !el.isConnected || !sized(rect)) {
    if (m) drop(m);
    hideNow(el, opts);
    return;
  }
  if (mode === 'normal') {
    if (m) drop(m);
    el.classList.add('mm-closing');
    el.classList.remove('mm-in');
    el.classList.add('mm-out');
    cssClosing.set(el, window.setTimeout(() => {
      cssClosing.delete(el);
      hideNow(el, opts);
    }, 130));
    return;
  }
  const from = rectOf(opts.from.getBoundingClientRect());
  const target = sized(from) && opts.from.isConnected ? shrink(from, opts.whole ? 1 : 0.6) : shrink(rect, 0.3);
  if (m) {
    m.phase = 'close';
    m.observer?.disconnect();
    m.a0 = clamp(m.A.x, 0, 1);
    for (const it of m.items) it.o0 = clamp(it.p.x, 0, 1);
  } else {
    const fresh: Morph = {
      el, opts, phase: 'close', time: 0, side: 'below',
      origin: originOf(el),
      saved: saveGeometry(el),
      start: rect, seed: rect, final: rect, cur: rect,
      E: S(1), GX: S(1), GY: S(1), A: S(1),
      items: (opts.items ?? (() => defaultItems(el)))().map(item => ({ el: item, p: S(1), wait: 0, o0: 1 })),
      shift: { x: 0, y: 0 }, observer: null,
      Q: S(0), from0: rect, to: rect, a0: 1, absorbed: false,
    };
    el.classList.add('mm-morph');
    el.style.right = 'auto';
    el.style.bottom = 'auto';
    morphs.set(el, fresh);
  }
  el.classList.add('mm-closing');
  // уходит под кнопку: слой ниже её плашки
  if (opts.from.isConnected) el.style.zIndex = underZ(el, opts.from);
  const c = morphs.get(el)!;
  c.absorbed = false;
  c.from0 = rect;
  c.to = target;
  c.Q = S(0);
  c.Q.t = 1;
  tune(c.Q, ...CLOSE);
  renderMorph(c);
  wake();
}

function writeRect(m: Morph, r: Rect): void {
  const s = m.el.style;
  s.left = `${(r.x - m.origin.x).toFixed(2)}px`;
  s.top = `${(r.y - m.origin.y).toFixed(2)}px`;
  s.width = `${Math.max(0, r.w).toFixed(2)}px`;
  s.height = `${Math.max(0, r.h).toFixed(2)}px`;
  m.cur = r;
}

function renderMorph(m: Morph): void {
  if (m.phase === 'open') {
    const base = lerpRect(m.start, m.seed, m.E.x);
    writeRect(m, {
      x: lerp(base.x, m.final.x, m.GX.x), w: lerp(base.w, m.final.w, m.GX.x),
      y: lerp(base.y, m.final.y, m.GY.x), h: lerp(base.h, m.final.h, m.GY.x),
    });
    m.el.style.opacity = clamp(m.A.x, 0, 1).toFixed(3);
    for (const it of m.items) {
      const p = clamp(it.p.x, 0, 1.2);
      it.el.style.opacity = clamp(p, 0, 1).toFixed(3);
      it.el.style.translate = `${(m.shift.x * (1 - p)).toFixed(2)}px ${(m.shift.y * (1 - p)).toFixed(2)}px`;
    }
    return;
  }
  const q = clamp(m.Q.x, 0, 1);
  writeRect(m, lerpRect(m.from0, m.to, q));
  // пункты гаснут сразу; контейнер не гаснет — его прячет кнопка, под которую он уходит
  m.el.style.opacity = (m.a0 * (q < 0.85 ? 1 : 1 - (q - 0.85) / 0.15)).toFixed(3);
  for (const it of m.items) it.el.style.opacity = (it.o0 * Math.max(0, 1 - q * 3)).toFixed(3);
  // контейнер почти целиком под кнопкой — она пружинит, принимая его
  if (!m.absorbed && q > 0.7) {
    m.absorbed = true;
    absorbButton(m.opts.pop === undefined ? m.opts.from : m.opts.pop);
  }
}

function openDone(m: Morph): boolean {
  // доля размера, равная полупикселю
  const gx = 0.5 / Math.max(1, Math.abs(m.final.w - m.seed.w));
  const gy = 0.5 / Math.max(1, Math.abs(m.final.h - m.seed.h));
  return m.time > T_ITEMS && near(m.E, 0.01, 0.1) && near(m.A, 0.01, 0.1) && near(m.GX, gx, gx * 30) && near(m.GY, gy, gy * 30)
    && m.items.every(it => m.time >= it.wait && near(it.p, 0.02, 0.3));
}

// ----- Переход внутри меню -----

export interface DrillOpts {
  /** 'in' — в подменю (row на уходящей странице, head — заголовок новой); 'out' — назад (head уходит, row приходит);
   *  'swap' — просто смена страниц. */
  dir: 'in' | 'out' | 'swap';
  row?: HTMLElement;
  head?: HTMLElement;
  /** Меню прижато нижним краем (раскрывается вверх): при смене высоты двигается верхний край. */
  bottom?: boolean;
  onSettled?: () => void;
}

interface DrillItem { el: HTMLElement; p: Spring; wait: number; top: number }

interface Drill {
  menu: HTMLElement;
  from: HTMLElement;
  to: HTMLElement;
  opts: DrillOpts;
  time: number;
  saved: Map<string, string>;
  H: Spring; P: Spring; X: Spring; F: Spring;
  edge: number;      // неподвижный край меню на экране (нижний или верхний)
  border: number;
  rowY: number;      // 'in': где был пункт; 'out': где пункт в новой странице (от края рамки)
  headY: number;     // 'in': где заголовок в новой странице (от края рамки); 'out': где он был на экране
  headTop: number;   // заголовок от края рамки (в своей странице, для пунктов)
  others: HTMLElement[];
  items: DrillItem[];
  ghosts: HTMLElement[];
  arrow: HTMLElement | null;
  cssTimer: number;
}

let drill: Drill | null = null;
const T_HEAD_OUT = 0.05; // назад: заголовок трогается, когда пункты подменю начали втягиваться
const T_ROOT_IN = 0.09;  // назад: пункты меню проявляются

function finishDrill(): void {
  const d = drill;
  if (!d) return;
  drill = null;
  clearTimeout(d.cssTimer);
  d.from.remove();
  restoreGeometry(d.menu, d.saved);
  d.menu.classList.remove('mm-drill');
  d.to.classList.remove('mm-fade');
  for (const el of [...d.others, ...d.items.map(it => it.el), ...d.ghosts]) clearItem(el);
  if (d.opts.row) clearItem(d.opts.row);
  if (d.opts.head) clearItem(d.opts.head);
  if (d.arrow) clearItem(d.arrow);
  d.opts.onSettled?.();
}

/**
 * Меню menu меняет страницу from на to (to встаёт после from, from в конце удаляется).
 * «Улучшенные»: в подменю — остальные пункты гаснут, нажатый пункт становится заголовком и уезжает наверх,
 * появляется стрелка «назад», пункты подменю по очереди выходят из заголовка, высота меню меняется вместе
 * с ними; «назад» — всё в обратную сторону. «Обычные» — новая страница проявляется, высота плавно меняется.
 */
export function drillMenu(menu: HTMLElement, from: HTMLElement, to: HTMLElement, opts: DrillOpts): void {
  ensure();
  finishDrill();
  const m = morphs.get(menu);
  if (m) {
    drop(m);
    if (m.phase === 'close') hideNow(menu, m.opts);
    else m.opts.onSettled?.();
  }
  const mode = menuMotion();
  const box = rectOf(menu.getBoundingClientRect());
  if (mode === 'off' || !sized(box) || menu.hidden) {
    from.replaceWith(to);
    opts.onSettled?.();
    return;
  }
  const H0 = box.h;
  const border = menu.clientTop;
  const edge = opts.bottom ? box.y + box.h : box.y;
  const saved = new Map<string, string>([['height', menu.style.getPropertyValue('height')], ['transition', menu.style.getPropertyValue('transition')]]);
  const d: Drill = {
    menu, from, to, opts, time: 0, saved,
    H: S(H0), P: S(0), X: S(0), F: S(1),
    edge, border, rowY: 0, headY: 0, headTop: 0,
    others: [], items: [], ghosts: [], arrow: null, cssTimer: 0,
  };
  const row = opts.row;
  const head = opts.head;
  if (mode === 'normal' || opts.dir === 'swap' || !row || !head) {
    // новая страница проявляется (CSS), высота меню плавно меняется (CSS-переход)
    from.replaceWith(to);
    const H1 = menu.offsetHeight;
    drill = d;
    menu.classList.add('mm-drill');
    menu.style.height = `${H0}px`;
    to.classList.add('mm-fade');
    void menu.offsetHeight;
    menu.style.transition = 'height 0.18s cubic-bezier(0.22, 0.8, 0.24, 1)';
    menu.style.height = `${H1}px`;
    d.cssTimer = window.setTimeout(finishDrill, 220);
    return;
  }
  // уходящая страница вынимается из потока и остаётся на своём месте экрана
  const leaving = [...from.children].filter((c): c is HTMLElement => c instanceof HTMLElement);
  const leavingTops = new Map(leaving.map(c => [c, c.getBoundingClientRect().top]));
  const rowTop = row.getBoundingClientRect().top;
  const headTop = head.getBoundingClientRect().top;
  const fl = from.offsetLeft, ft = from.offsetTop, fw = from.offsetWidth, fh = from.offsetHeight;
  const ch = menu.clientHeight;
  from.classList.add('mm-leaving');
  from.style.left = `${fl}px`;
  from.style.width = `${fw}px`;
  if (opts.bottom) from.style.bottom = `${ch - ft - fh}px`;
  else from.style.top = `${ft}px`;
  from.after(to);
  const H1 = menu.offsetHeight;
  menu.classList.add('mm-drill');
  menu.style.height = `${H0}px`;
  // от края рамки меню: страница to в потоке, её положение на экране едет вместе с краем меню
  const local = (el: HTMLElement): number => el.getBoundingClientRect().top - menu.getBoundingClientRect().top - border;
  d.H.t = H1;
  tune(d.H, ...GROW);
  tune(d.P, GROW[0] * 0.9, GROW[1]);
  tune(d.X, ...ITEM);
  tune(d.F, ...CLOSE);
  d.arrow = head.querySelector<HTMLElement>('.vb-arrow');
  d.ghosts = [...head.querySelectorAll<HTMLElement>('.vb-ghost')];
  row.style.opacity = '0';
  if (opts.dir === 'in') {
    // нажатый пункт превращается в заголовок: сам пункт прячется, заголовок встаёт на его место
    d.rowY = rowTop;
    d.headY = local(head);
    d.P.t = 1;
    d.X.t = 1;
    d.F.t = 0;
    d.others = leaving.filter(c => c !== row);
    const entering = [...to.children].filter((c): c is HTMLElement => c instanceof HTMLElement && c !== head);
    const gap = stagger(entering.length);
    d.items = entering.map((el, i) => {
      const p = S(0);
      p.t = 1;
      tune(p, ...ITEM);
      return { el, p, wait: 0.08 + i * gap, top: local(el) };
    });
  } else {
    // назад: пункты подменю втягиваются в заголовок (последний — первым), заголовок едет на место пункта,
    // пункты меню проявляются
    d.X = S(1);
    tune(d.X, ...ITEM);
    d.X.t = 0;
    d.F = S(0);
    tune(d.F, ...ITEM);
    d.headY = headTop;
    d.headTop = headTop;
    d.rowY = local(row);
    d.P.t = 1;
    d.others = [...to.children].filter((c): c is HTMLElement => c instanceof HTMLElement && c !== row);
    const going = leaving.filter(c => c !== head);
    const gap = Math.min(0.022, 0.1 / Math.max(1, going.length - 1));
    d.items = going.map((el, i) => {
      const p = S(0);
      p.t = 1;
      tune(p, ...CLOSE);
      return { el, p, wait: (going.length - 1 - i) * gap, top: leavingTops.get(el) ?? 0 };
    });
  }
  drill = d;
  renderDrill(d);
  wake();
}

function renderDrill(d: Drill): void {
  const head = d.opts.head;
  if (d.cssTimer || !head) return;
  const h = d.H.x;
  d.menu.style.height = `${h.toFixed(2)}px`;
  const top = d.opts.bottom ? d.edge - h : d.edge;
  const a = clamp(d.X.x, 0, 1);
  if (d.arrow) d.arrow.style.opacity = a.toFixed(3);
  for (const g of d.ghosts) g.style.opacity = (1 - a).toFixed(3);
  for (const el of d.others) el.style.opacity = clamp(d.F.x, 0, 1).toFixed(3);
  if (d.opts.dir === 'in') {
    // заголовок: с места пункта на экране — на своё место в новой странице, которое едет вместе с краем меню
    const natural = top + d.border + d.headY;
    const ty = (d.rowY - natural) * (1 - d.P.x);
    head.style.translate = `0 ${ty.toFixed(2)}px`;
    // пункты подменю выходят из заголовка цепочкой: каждый — из-под предыдущего, там, где тот сейчас
    let prevY = d.headY + ty, prevTop = d.headY;
    for (const it of d.items) {
      const p = clamp(it.p.x, 0, 1.05);
      const y = prevY + (it.top - prevTop) * p;
      it.el.style.translate = `0 ${(y - it.top).toFixed(2)}px`;
      it.el.style.opacity = clamp(p, 0, 1).toFixed(3);
      prevY = y;
      prevTop = it.top;
    }
    return;
  }
  // назад: заголовок (в неподвижной уходящей странице) едет на место пункта в новой странице
  const ty = (top + d.border + d.rowY - d.headY) * d.P.x;
  head.style.translate = `0 ${ty.toFixed(2)}px`;
  // пункты подменю втягиваются цепочкой: каждый — под предыдущий, первый — в заголовок
  let prevY = d.headTop + ty, prevTop = d.headTop;
  for (const it of d.items) {
    const p = clamp(it.p.x, 0, 1);
    const y = prevY + (it.top - prevTop) * (1 - p);
    it.el.style.translate = `0 ${(y - it.top).toFixed(2)}px`;
    it.el.style.opacity = (1 - Math.min(1, p * 1.4)).toFixed(3);
    prevY = y;
    prevTop = it.top;
  }
}

function drillDone(d: Drill): boolean {
  if (d.cssTimer) return false; // CSS-переход завершит таймер
  if (d.opts.dir === 'out' && d.time < T_ROOT_IN) return false;
  if (!near(d.H, 0.5, 15) || !near(d.P, 0.003, 0.08) || !near(d.X, 0.01, 0.1) || !near(d.F, 0.01, 0.1)) return false;
  return d.items.every(it => d.time >= it.wait && near(it.p, 0.02, 0.3));
}

// ----- Цикл -----

function frame(dt: number): void {
  for (const m of morphs.values()) {
    m.time += dt;
    if (m.phase === 'open') {
      if (m.time >= T_GROW) { m.GX.t = 1; m.GY.t = 1; }
      step(m.E, dt); step(m.A, dt); step(m.GX, dt); step(m.GY, dt);
      for (const it of m.items) if (m.time >= it.wait) step(it.p, dt);
    } else {
      step(m.Q, dt);
    }
  }
  for (const s of pops.values()) step(s, dt);
  const d = drill;
  if (d) {
    d.time += dt;
    step(d.H, dt);
    step(d.F, dt);
    if (d.opts.dir !== 'out' || d.time >= T_HEAD_OUT) { step(d.P, dt); step(d.X, dt); }
    if (d.opts.dir === 'out' && d.time >= T_ROOT_IN) d.F.t = 1;
    for (const it of d.items) if (d.time >= it.wait) step(it.p, dt);
  }
}

function render(): void {
  for (const m of [...morphs.values()]) {
    if (m.phase === 'open') {
      if (openDone(m)) {
        snap(m.GX); snap(m.GY);
        drop(m);
        m.opts.onSettled?.();
        continue;
      }
      renderMorph(m);
    } else if (m.Q.x > 0.97) {
      drop(m);
      hideNow(m.el, m.opts);
    } else {
      renderMorph(m);
    }
  }
  for (const [b, s] of [...pops]) {
    if (near(s, 0.002, 0.03)) {
      b.style.removeProperty('scale');
      pops.delete(b);
    } else {
      b.style.scale = s.x.toFixed(4);
    }
  }
  const d = drill;
  if (d) {
    if (drillDone(d)) finishDrill();
    else renderDrill(d);
  }
}

function settled(): boolean {
  return morphs.size === 0 && pops.size === 0 && (drill === null || drill.cssTimer !== 0);
}
