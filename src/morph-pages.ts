// Motion на панели страниц (пружины из motion.ts, значения — токены --spring-* в style.css).
//  1. Рамка выбранной страницы — одна на весь список: при смене страницы она перетекает от карточки
//     к карточке (край по ходу движения на жёсткой пружине, задний — на мягкой), как подсветка кнопок
//     панели инструментов. Рисуется псевдоэлементом #pages-list::before через переменные --sel-*.
//  2. Список раскрывается и закрывается на пружинах: лоток всплывает, кнопка «Страницы» поднимается над
//     ним с небольшим перелётом, стрелка поворачивается, карточки въезжают по очереди.
//  3. Клик по карточке, плитке «+» и кнопке «Страницы» «нажимает» их и пружинит обратно.
// Пока пружины идут, стили пишутся инлайном; когда всё успокоилось — инлайн снимается, и работает
// обычный CSS (состояние .open), так что без Motion-анимаций (класс no-motion) всё как раньше.

import { S, atRest, clamp, motionEnabled, register, snap, spring, step, tune, uiAnimOff, wake, type Spring } from './motion';

export interface PagesDockParts {
  dock: HTMLElement;
  tray: HTMLElement;
  list: HTMLElement;
  button: HTMLElement;
  /** Кнопка слева вверху, список колонкой (панель инструментов внизу). */
  atTop(): boolean;
  /** Карточка открытой страницы или черновика. */
  active(): HTMLElement | null;
}

const SLIDE_IN = 18;   // откуда въезжают карточки, px
const TRAY_SLIDE = 28; // на сколько лоток уходит вниз (вверх) в закрытом состоянии
const STAGGER = 0.026; // пауза между карточками, с
const STAGGER_MAX = 14; // дальше этого номера карточки въезжают вместе
const POP_FROM = 0.96;  // масштаб карточки в момент клика

let SETTLE: [number, number] = [280, 22];
let LEAD: [number, number] = [620, 36];
let TRAIL: [number, number] = [190, 19];
let SOFT: [number, number] = [260, 24];
let POP: [number, number] = [520, 16];

let parts: PagesDockParts | null = null;
let open = false;
let trayH = 150;

const O = S(0, 280, 22);                 // раскрытие списка: 0 — закрыт, 1 — открыт (с перелётом)
const RL = S(0), RR = S(0), RT = S(0), RB = S(0); // края рамки в координатах содержимого списка
const RV = S(0, 420, 32);                // видимость рамки
let ringEl: HTMLElement | null = null;   // карточка, к которой привязана рамка
let ringC = 0;                           // её центр вдоль оси

interface Entry { p: Spring; wait: number }
const entering = new Map<HTMLElement, Entry>();
const pops = new Map<HTMLElement, Spring>();

const ringSprings = (): Spring[] => [RL, RR, RT, RB];

export function initMorphPages(p: PagesDockParts): void {
  if (parts) return;
  parts = p;
  [SETTLE, LEAD, TRAIL, SOFT, POP] = [
    spring('--spring-settle', SETTLE), spring('--spring-lead', LEAD), spring('--spring-trail', TRAIL),
    spring('--spring-soft', SOFT), spring('--spring-pop', POP),
  ];
  tune(O, ...SETTLE);
  register({ frame, render, settled });
  document.addEventListener('click', e => {
    if (!motionEnabled() || !(e.target instanceof Element)) return;
    const el = e.target.closest<HTMLElement>('.page-item, .page-add, #btn-pages');
    if (!el || !p.dock.contains(el)) return;
    let s = pops.get(el);
    if (!s) { s = S(1, POP[0], POP[1]); pops.set(el, s); }
    tune(s, ...POP);
    s.x = POP_FROM;
    s.v = 0;
    s.t = 1;
    wake();
  }, true);
  // карточки и режим «список вверху/внизу» меняют размеры содержимого — рамка перечитывает положение
  if (typeof ResizeObserver === 'function') new ResizeObserver(() => morphPagesSync()).observe(p.list);
}

/** Список открыли или закрыли (вызывается после переключения .open). */
export function morphPagesOpen(isOpen: boolean): void {
  if (!parts || !motionEnabled()) return;
  open = isOpen;
  trayH = parts.tray.offsetHeight || trayH;
  parts.dock.classList.add('mt-showing');
  O.t = isOpen ? 1 : 0;
  tune(O, ...SETTLE);
  if (isOpen) {
    // карточки въезжают по очереди
    const cards = parts.list.querySelectorAll<HTMLElement>(':scope > .page-item, :scope > .page-add, :scope > .page-divider');
    for (const el of cards) {
      const i = Math.min(parseInt(el.style.getPropertyValue('--i'), 10) || 0, STAGGER_MAX);
      const p = S(0, SETTLE[0], SETTLE[1]);
      p.t = 1;
      entering.set(el, { p, wait: i * STAGGER + 0.04 });
    }
  } else {
    // закрываем на лету: недоехавшие карточки возвращаются к обычному виду
    for (const el of entering.keys()) { el.style.removeProperty('translate'); el.style.removeProperty('opacity'); }
    entering.clear();
  }
  morphPagesSync(true);
  wake();
}

/** Рамка выбранной страницы встаёт на карточку: перетекает от прежней или возникает на месте. */
export function morphPagesSync(forceSnap = false): void {
  if (!parts || !motionEnabled()) return;
  const el = parts.active();
  if (!el || !el.isConnected) {
    RV.t = 0;
    ringEl = null;
    wake();
    return;
  }
  const vertical = parts.atTop();
  const l = el.offsetLeft, t = el.offsetTop;
  const r = l + el.offsetWidth, b = t + el.offsetHeight;
  const c = vertical ? t + el.offsetHeight / 2 : l + el.offsetWidth / 2;
  const fresh = forceSnap || !ringEl || RV.x < 0.3 || (!open && O.x < 0.3);
  if (fresh) {
    RL.t = l; RR.t = r; RT.t = t; RB.t = b;
    ringSprings().forEach(snap);
  } else if (el === ringEl) {
    // та же карточка сдвинулась (удалили или переставили соседей)
    ringSprings().forEach(s => tune(s, ...SOFT));
    RL.t = l; RR.t = r; RT.t = t; RB.t = b;
  } else {
    const fwd = c >= ringC;
    const [lead, trail, cross] = vertical
      ? [fwd ? RB : RT, fwd ? RT : RB, [RL, RR]]
      : [fwd ? RR : RL, fwd ? RL : RR, [RT, RB]];
    tune(lead, ...LEAD);
    tune(trail, ...TRAIL);
    cross.forEach(s => tune(s, ...SOFT));
    RL.t = l; RR.t = r; RT.t = t; RB.t = b;
  }
  ringEl = el;
  ringC = c;
  RV.t = 1;
  wake();
}

/** «Motion анимации» выключили (или включили): снять всё инлайновое, вернуть обычный CSS. */
export function morphPagesReset(isOpen: boolean): void {
  if (!parts) return;
  open = isOpen;
  O.x = O.t = isOpen ? 1 : 0;
  O.v = 0;
  entering.clear();
  pops.clear();
  clearInline();
  parts.list.style.removeProperty('--sel-o');
  if (motionEnabled()) { ringEl = null; morphPagesSync(true); }
  wake();
}

function clearInline(): void {
  if (!parts) return;
  const { dock, tray, button, list } = parts;
  tray.style.removeProperty('opacity');
  tray.style.removeProperty('transform');
  button.style.removeProperty('transform');
  button.style.removeProperty('scale');
  button.querySelector<HTMLElement>('.pages-chev')?.style.removeProperty('transform');
  for (const el of list.children) {
    (el as HTMLElement).style.removeProperty('translate');
    (el as HTMLElement).style.removeProperty('opacity');
    (el as HTMLElement).style.removeProperty('scale');
  }
  dock.classList.remove('mt-showing');
}

// ----- цикл -----

function frame(dt: number): void {
  if (!parts || !motionEnabled()) return;
  if (uiAnimOff()) {
    [O, ...ringSprings(), RV, ...[...entering.values()].map(e => e.p), ...pops.values()].forEach(snap);
    entering.forEach(e => { e.wait = 0; });
    return;
  }
  step(O, dt);
  ringSprings().forEach(s => step(s, dt));
  step(RV, dt);
  for (const e of entering.values()) {
    if (e.wait > 0) { e.wait -= dt; continue; }
    step(e.p, dt);
  }
  for (const s of pops.values()) step(s, dt);
}

function render(): void {
  if (!parts || !motionEnabled()) return;
  const { tray, button, list } = parts;
  const top = parts.atTop();
  const animating = !(atRest(O, 0.002) && [...entering.values()].every(e => e.wait <= 0 && atRest(e.p, 0.002)));

  if (animating) {
    tray.style.opacity = clamp(O.x, 0, 1).toFixed(3);
    tray.style.transform = `translateY(${((1 - O.x) * TRAY_SLIDE * (top ? -1 : 1)).toFixed(2)}px)`;
    // сверху кнопка стоит на месте; снизу — поднимается над списком
    if (!top) button.style.transform = `translateY(${(-(trayH + 10) * O.x).toFixed(2)}px)`;
    const chev = button.querySelector<HTMLElement>('.pages-chev');
    if (chev) chev.style.transform = `rotate(${(180 * (top ? 1 - O.x : O.x)).toFixed(2)}deg)`;
  }
  for (const [el, e] of entering) {
    const p = e.wait > 0 ? 0 : e.p.x;
    el.style.translate = `0 ${((1 - p) * SLIDE_IN * (top ? -1 : 1)).toFixed(2)}px`;
    el.style.opacity = (0.92 * clamp(p, 0, 1)).toFixed(3);
    if (e.wait <= 0 && atRest(e.p, 0.002)) {
      el.style.removeProperty('translate');
      el.style.removeProperty('opacity');
      entering.delete(el);
    }
  }
  for (const [el, s] of pops) {
    const done = atRest(s, 0.002);
    if (done) { el.style.removeProperty('scale'); pops.delete(el); } else el.style.scale = s.x.toFixed(4);
  }

  // рамка выбранной страницы: едет вместе с въезжающей карточкой и «нажимается» вместе с ней
  const entry = ringEl ? entering.get(ringEl) : undefined;
  const p = entry ? (entry.wait > 0 ? 0 : clamp(entry.p.x, 0, 1)) : 1;
  const w = Math.max(8, RR.x - Math.min(RL.x, RR.x - 8)), h = Math.max(8, RB.x - Math.min(RT.x, RB.x - 8));
  const x = Math.min(RL.x, RR.x - 8), y = Math.min(RT.x, RB.x - 8) + (1 - p) * SLIDE_IN * (top ? -1 : 1);
  list.style.setProperty('--sel-x', `${x.toFixed(2)}px`);
  list.style.setProperty('--sel-y', `${y.toFixed(2)}px`);
  list.style.setProperty('--sel-w', `${w.toFixed(2)}px`);
  list.style.setProperty('--sel-h', `${h.toFixed(2)}px`);
  list.style.setProperty('--sel-o', (clamp(RV.x, 0, 1) * p).toFixed(3));
  list.style.setProperty('--sel-s', ((ringEl && pops.get(ringEl)?.x) || 1).toFixed(4));

  if (!animating) {
    // движение кончилось: дальше видимость лотка ведёт обычный CSS (.open)
    parts.dock.classList.remove('mt-showing');
    tray.style.removeProperty('opacity');
    tray.style.removeProperty('transform');
    button.style.removeProperty('transform');
    button.querySelector<HTMLElement>('.pages-chev')?.style.removeProperty('transform');
  }
}

function settled(): boolean {
  return atRest(O, 0.002) && atRest(RV, 0.002) && ringSprings().every(s => atRest(s, 0.05))
    && [...entering.values()].every(e => e.wait <= 0 && atRest(e.p, 0.002))
    && [...pops.values()].every(s => atRest(s, 0.002));
}
