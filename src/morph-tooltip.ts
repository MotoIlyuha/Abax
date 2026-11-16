// «Морфящаяся» подсказка панели инструментов (по мотивам Morph Tooltip с designbookmark.com/motion).
// Одна подсказка на всю панель: она не прячется между кнопками, а перетекает к следующей и
// подгоняет размер под новую надпись. Край, обращённый к новой кнопке, на жёсткой пружине,
// противоположный — на мягкой: пузырь растягивается и оседает. Старая надпись уезжает туда, откуда
// пришла, новая въезжает с дальней стороны, хвостик едет на своей пружине. Подсветка кнопки под
// курсором тянется тем же способом. Пружины и токены — в style.css (--spring-*), сам движок — motion.ts.
//
// Подсказка рисуется в слое #morph-tip (position: fixed), подсветка — внутри #toolbar.
// Подписи только через textContent: текст приходит из title кнопок, но не доверяем ему.

import { S, atRest, clamp, register, snap, spring, step, tune, uiAnimOff, wake, type Spring } from './motion';

type Side = 'top' | 'bottom' | 'left' | 'right';
type Axis = 'x' | 'y';

const GAP = 12;            // зазор между панелью и пузырём
const MARGIN = 6;          // отступ от края окна
const SLIDE = 14;          // на сколько надпись выезжает при смене, px
const INTENT_DELAY = 120;  // мс до первой подсказки: чтобы не мигала, когда курсор просто пролетает
const HIDE_DELAY = 140;    // мс до скрытия при уходе: щель между кнопками не мигает
const POP_FROM = 0.78;     // масштаб иконки в момент клика, дальше пружина возвращает к 1

/** «Отменить (Ctrl+Z)» → надпись и хоткей отдельно. */
export function splitTipText(text: string): { label: string; key: string | null } {
  const m = /^(.+?)\s+\(((?:Ctrl|Cmd|Shift|Alt|Del|[A-Z0-9])[^()]*)\)$/.exec(text);
  return m ? { label: m[1], key: m[2] } : { label: text, key: null };
}

interface Lab {
  el: HTMLElement;
  o: Spring;      // видимость надписи
  dir: number;    // в какую сторону вдоль оси она сдвинута, когда невидима
  w: number;
  h: number;
}

// Пружины из токенов style.css; запасные значения — те же, что в tokens.css образца.
let LEAD: [number, number] = [620, 36];
let TRAIL: [number, number] = [190, 19];
let SOFT: [number, number] = [260, 24];
let FADE: [number, number] = [420, 32];
let POP: [number, number] = [520, 16];

let layer: HTMLDivElement | null = null;
let tipEl: HTMLDivElement;
let tailEl: HTMLElement;
let hlEl: HTMLElement;

// края пузыря во вьюпорте, центр хвоста вдоль оси, показ
const L = S(0), R = S(0), T = S(0), B = S(0);
const TX = S(0, 300, 22);
const A = S(0, 420, 24);
// края подсветки в координатах панели, показ
const HL = S(0), HR = S(0), HT = S(0), HB = S(0);
const H = S(0, 420, 32);

const labs = new Map<string, Lab>();
const pops = new Map<HTMLElement, Spring>();

let hover: HTMLElement | null = null;   // кнопка под курсором
let cur: HTMLElement | null = null;     // кнопка, к которой сейчас привязан пузырь
let curC = 0;                           // её центр вдоль оси
let side: Side = 'right';
let axis: Axis = 'y';
let hlBtn: HTMLElement | null = null;
let hlC = 0;
let intentT = 0;
let hideT = 0;

const edgeSprings = (): Spring[] => [L, R, T, B];
const hlSprings = (): Spring[] => [HL, HR, HT, HB];

function ensure(): void {
  if (layer) return;
  [LEAD, TRAIL, SOFT, FADE, POP] = [
    spring('--spring-lead', LEAD), spring('--spring-trail', TRAIL), spring('--spring-soft', SOFT),
    spring('--spring-fade', FADE), spring('--spring-pop', POP),
  ];
  layer = document.createElement('div');
  layer.id = 'morph-tip';
  layer.dataset.state = 'hidden';
  tipEl = document.createElement('div');
  tipEl.className = 'mt-tip';
  tipEl.setAttribute('role', 'tooltip');
  tailEl = document.createElement('i');
  tailEl.className = 'mt-tail';
  hlEl = document.createElement('i');
  hlEl.className = 'mt-hl';
  layer.append(tailEl, tipEl);
  document.body.appendChild(layer);
  register({ frame, render, settled });
  if (document.fonts?.ready) void document.fonts.ready.then(remeasure);
}

function labelFor(text: string): Lab {
  let lab = labs.get(text);
  if (lab) return lab;
  // кэш по тексту: подсказки кнопок повторяются, а надпись не пересоздаётся при каждом наведении
  for (const [k, l] of labs) {
    if (labs.size < 80) break;
    if (l.o.t === 0 && atRest(l.o)) { l.el.remove(); labs.delete(k); }
  }
  const { label, key } = splitTipText(text);
  const el = document.createElement('span');
  el.className = 'mt-lab';
  const t = document.createElement('span');
  t.textContent = label;
  el.appendChild(t);
  if (key) {
    const kbd = document.createElement('kbd');
    kbd.className = 'mt-kbd';
    kbd.textContent = key;
    el.appendChild(kbd);
  }
  tipEl.appendChild(el);
  lab = { el, o: S(0, FADE[0], FADE[1]), dir: 0, w: 0, h: 0 };
  measure(lab);
  labs.set(text, lab);
  return lab;
}

function measure(l: Lab): void {
  l.w = l.el.offsetWidth || l.w;
  l.h = l.el.offsetHeight || l.h;
}

/** Шрифт догрузился — размеры надписей изменились. */
function remeasure(): void {
  labs.forEach(measure);
  if (cur?.isConnected) {
    const lab = [...labs.values()].find(l => l.el.classList.contains('cur'));
    const g = lab && geometry(cur, lab);
    if (g) setTargets(g);
  }
}

const barOf = (btn: HTMLElement): HTMLElement | null => btn.closest<HTMLElement>('#toolbar');

function preferredSide(bar: HTMLElement): Side {
  switch (bar.dataset.pos) {
    case 'right': return 'left';
    case 'top': return 'bottom';
    case 'bottom': return 'top';
    default: return 'right';
  }
}

interface Geo { side: Side; axis: Axis; l: number; r: number; t: number; b: number; c: number }

/** Где должен стоять пузырь с этой надписью у этой кнопки (координаты окна). */
function geometry(btn: HTMLElement, lab: Lab): Geo | null {
  const bar = barOf(btn);
  if (!bar) return null;
  const br = bar.getBoundingClientRect();
  const r = btn.getBoundingClientRect();
  const w = lab.w, h = lab.h;
  const vw = window.innerWidth, vh = window.innerHeight;
  const fits = (s: Side): boolean =>
    s === 'right' ? br.right + GAP + w <= vw - MARGIN
    : s === 'left' ? br.left - GAP - w >= MARGIN
    : s === 'bottom' ? br.bottom + GAP + h <= vh - MARGIN
    : br.top - GAP - h >= MARGIN;
  const opposite: Record<Side, Side> = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };
  let s = preferredSide(bar);
  if (!fits(s) && fits(opposite[s])) s = opposite[s];
  if (s === 'top' || s === 'bottom') {
    const c = r.left + r.width / 2;
    const l = clamp(c - w / 2, MARGIN, Math.max(MARGIN, vw - w - MARGIN));
    const t = s === 'top' ? br.top - GAP - h : br.bottom + GAP;
    return { side: s, axis: 'x', l, r: l + w, t, b: t + h, c };
  }
  const c = r.top + r.height / 2;
  const t = clamp(c - h / 2, MARGIN, Math.max(MARGIN, vh - h - MARGIN));
  const l = s === 'left' ? br.left - GAP - w : br.right + GAP;
  return { side: s, axis: 'y', l, r: l + w, t, b: t + h, c };
}

function setTargets(g: Geo): void {
  L.t = g.l; R.t = g.r; T.t = g.t; B.t = g.b; TX.t = g.c;
}

function setSide(s: Side, ax: Axis): void {
  side = s;
  axis = ax;
  tipEl.dataset.side = s;
}

// ----- подсказка -----

function pointTip(btn: HTMLElement, text: string): void {
  ensure();
  const lab = labelFor(text);
  if (cur === btn && lab.el.classList.contains('cur')) { A.t = 1; wake(); return; }
  measure(lab);
  const g = geometry(btn, lab);
  if (!g) return;
  const fresh = A.x < 0.3 || g.side !== side;
  if (fresh) {
    // на экране ничего нет (или панель переехала): возникаем сразу там, где нужно
    setSide(g.side, g.axis);
    setTargets(g);
    [...edgeSprings(), TX].forEach(snap);
    for (const l of labs.values()) { l.o.x = l.o.t = l === lab ? 1 : 0; l.o.v = 0; l.dir = 0; }
  } else {
    const dir = Math.sign(g.c - curC);
    const fwd = dir >= 0;
    const [lead, trail, cross] = g.axis === 'x'
      ? [fwd ? R : L, fwd ? L : R, [T, B]]
      : [fwd ? B : T, fwd ? T : B, [L, R]];
    tune(lead, ...LEAD);
    tune(trail, ...TRAIL);
    cross.forEach(s => tune(s, ...SOFT));
    setTargets(g);
    for (const l of labs.values()) {
      if (l === lab) { l.dir = dir; l.o.t = 1; }
      else if (l.o.t === 1) { l.dir = -dir; l.o.t = 0; }
    }
  }
  for (const l of labs.values()) l.el.classList.toggle('cur', l === lab);
  cur = btn;
  curC = g.c;
  A.t = 1;
  layer!.style.visibility = 'visible';
  layer!.dataset.state = 'shown';
  wake();
}

function hideTip(): void {
  window.clearTimeout(intentT);
  intentT = 0;
  if (!layer) return;
  A.t = 0;
  cur = null;
  for (const l of labs.values()) l.el.classList.remove('cur');
  layer.dataset.state = 'hidden';
  wake();
}

// ----- подсветка кнопки под курсором -----

function pointHl(btn: HTMLElement): void {
  const bar = barOf(btn);
  if (!bar) return;
  if (hlEl.parentElement !== bar) bar.prepend(hlEl);
  const br = bar.getBoundingClientRect();
  const r = btn.getBoundingClientRect();
  const ax: Axis = bar.dataset.pos === 'top' || bar.dataset.pos === 'bottom' ? 'x' : 'y';
  const x = r.left - br.left - bar.clientLeft;
  const y = r.top - br.top - bar.clientTop;
  const c = ax === 'x' ? r.left + r.width / 2 : r.top + r.height / 2;
  const fresh = H.x < 0.3 || !hlBtn?.isConnected;
  if (fresh) {
    HL.t = x; HR.t = x + r.width; HT.t = y; HB.t = y + r.height;
    hlSprings().forEach(snap);
  } else {
    const fwd = c >= hlC;
    const [lead, trail, cross] = ax === 'x'
      ? [fwd ? HR : HL, fwd ? HL : HR, [HT, HB]]
      : [fwd ? HB : HT, fwd ? HT : HB, [HL, HR]];
    tune(lead, ...LEAD);
    tune(trail, ...TRAIL);
    cross.forEach(s => tune(s, ...SOFT));
    HL.t = x; HR.t = x + r.width; HT.t = y; HB.t = y + r.height;
  }
  hlBtn = btn;
  hlC = c;
  H.t = 1;
  wake();
}

// ----- события (их ловит tooltip.ts) -----

/** Курсор над кнопкой панели; text — её подсказка (пусто — только подсветка). */
export function morphOver(btn: HTMLElement, text: string): void {
  ensure();
  window.clearTimeout(hideT);
  hideT = 0;
  hover = btn;
  pointHl(btn);
  window.clearTimeout(intentT);
  intentT = 0;
  if (!text) { hideTip(); return; }
  if (A.t === 1) { pointTip(btn, text); return; }
  intentT = window.setTimeout(() => {
    intentT = 0;
    if (hover === btn && btn.isConnected) pointTip(btn, btn.dataset.tip || text);
  }, INTENT_DELAY);
}

/** Курсор ушёл с панели. now — сразу (клавиша, прокрутка, смена окна), иначе после короткой паузы. */
export function morphLeave(now = false): void {
  if (!layer) return;
  window.clearTimeout(intentT);
  intentT = 0;
  window.clearTimeout(hideT);
  const done = (): void => {
    hideT = 0;
    hover = null;
    hlBtn = null;
    H.t = 0;
    hideTip();
    wake();
  };
  if (now) done();
  else hideT = window.setTimeout(done, HIDE_DELAY);
}

/** Убрать только пузырь, подсветка остаётся (нажатие на кнопку: пузырь не должен закрывать панели). */
export function morphHideTip(): void {
  hideTip();
}

/** Подсказка или подсветка сейчас заняты — tooltip.ts решает, нужно ли реагировать на уход курсора. */
export function morphActive(): boolean {
  return !!layer && (hover !== null || cur !== null);
}

/** Клик по кнопке панели: иконка «нажимается» и пружинит обратно. */
export function morphPop(target: EventTarget | null): void {
  const btn = target instanceof Element ? target.closest<HTMLElement>('#toolbar .tool') : null;
  if (!btn) return;
  ensure();
  let s = pops.get(btn);
  if (!s) { s = S(1, POP[0], POP[1]); pops.set(btn, s); }
  tune(s, ...POP);
  s.x = POP_FROM;
  s.v = 0;
  s.t = 1;
  wake();
}

// ----- цикл анимации -----

function frame(dt: number): void {
  if (uiAnimOff()) {
    // «Анимация меню и панелей» выключена: всё встаёт на цель сразу
    [...edgeSprings(), ...hlSprings(), TX, A, H, ...pops.values(), ...[...labs.values()].map(l => l.o)].forEach(snap);
    return;
  }
  for (const s of [...edgeSprings(), ...hlSprings(), TX, A, H]) step(s, dt);
  for (const l of labs.values()) step(l.o, dt);
  for (const s of pops.values()) step(s, dt);
}

const OFFSET: Record<Side, [number, number]> = { top: [0, 1], bottom: [0, -1], left: [1, 0], right: [-1, 0] };

function render(): void {
  if (!layer) return;
  const a = clamp(A.x, 0, 1.15);
  const op = clamp(A.x, 0, 1);
  const vw = window.innerWidth, vh = window.innerHeight;
  // края могут на миг разойтись «наоборот»: держим минимальный размер
  const l0 = Math.min(L.x, R.x - 30), t0 = Math.min(T.x, B.x - 20);
  const w = R.x - l0, h = B.x - t0;
  const lx = clamp(l0, 0, Math.max(0, vw - w)), ty = clamp(t0, 0, Math.max(0, vh - h));
  const [vx, vy] = OFFSET[side];
  const pop = 1 - a;
  tipEl.style.width = `${w.toFixed(2)}px`;
  tipEl.style.height = `${h.toFixed(2)}px`;
  tipEl.style.opacity = op.toFixed(3);
  tipEl.style.transform = `translate(${(lx + vx * pop * 6).toFixed(2)}px,${(ty + vy * pop * 6).toFixed(2)}px) scale(${(0.72 + 0.28 * a).toFixed(4)})`;
  // хвостик смотрит на кнопку; пузырь прижат к краю окна — хвостик всё равно указывает на неё
  const along = axis === 'x' ? clamp(TX.x, lx + 12, lx + w - 12) : clamp(TX.x, ty + 12, ty + h - 12);
  const [cx, cy] = side === 'top' ? [along, ty + h - 3]
    : side === 'bottom' ? [along, ty + 3]
    : side === 'left' ? [lx + w - 3, along]
    : [lx + 3, along];
  tailEl.style.opacity = op.toFixed(3);
  tailEl.style.transform = `translate(${(cx - 6 + vx * pop * 8).toFixed(2)}px,${(cy - 6 + vy * pop * 8).toFixed(2)}px) rotate(45deg) scale(${a.toFixed(3)})`;

  for (const lab of labs.values()) {
    const o = clamp(lab.o.x, 0, 1);
    const shift = lab.dir * (1 - o) * SLIDE;
    lab.el.style.opacity = o.toFixed(3);
    lab.el.style.transform = `translate(calc(-50% + ${(axis === 'x' ? shift : 0).toFixed(2)}px), calc(-50% + ${(axis === 'y' ? shift : 0).toFixed(2)}px))`;
    lab.el.style.filter = o > 0.02 && o < 0.98 ? `blur(${((1 - o) * 3).toFixed(2)}px)` : 'none';
  }

  hlEl.style.opacity = clamp(H.x, 0, 1).toFixed(3);
  const hx = Math.min(HL.x, HR.x - 8), hy = Math.min(HT.x, HB.x - 8);
  hlEl.style.width = `${Math.max(8, HR.x - hx).toFixed(2)}px`;
  hlEl.style.height = `${Math.max(8, HB.x - hy).toFixed(2)}px`;
  hlEl.style.transform = `translate(${hx.toFixed(2)}px,${hy.toFixed(2)}px)`;

  for (const [btn, s] of pops) {
    const icon = btn.firstElementChild as HTMLElement | null;
    const done = atRest(s, 0.002);
    if (icon) icon.style.transform = done ? '' : `scale(${s.x.toFixed(4)})`;
    if (done) pops.delete(btn);
  }

  if (A.t === 0 && A.x < 0.01) layer.style.visibility = 'hidden';
}

function settled(): boolean {
  return [...edgeSprings(), ...hlSprings(), TX].every(s => atRest(s, 0.05))
    && atRest(A, 0.002) && atRest(H, 0.002)
    && [...labs.values()].every(l => atRest(l.o, 0.002))
    && [...pops.values()].every(s => atRest(s, 0.002));
}
