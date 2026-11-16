// ПОКА НЕ ПОДКЛЮЧЁН (группы панели теперь вытягиваются — stretch.ts); модуль и стили .goo-* оставлены для другого места.
// Goo-эффект для групп панели инструментов (по мотивам Goo Menu с designbookmark.com/motion).
// Открытие: из кнопки группы «выливаются» капли-инструменты, карточка панели растёт из кнопки,
// SVG-фильтр #goo склеивает их, пока они рядом, — капли отрываются тягучими перемычками.
// Закрытие: карточка и капли втягиваются обратно в кнопку.
// Слой капель (#goo-layer) лежит под панелью инструментов: капли выплывают из-за неё. Сама панель
// (настоящая или её копия при закрытии) открывается маской по растущему «пятну».
// Пружины и скорости — токены --goo-* в style.css, как в tokens.css образца.

import { S, atRest, clamp, motionEnabled, reduceMotion, register, spring, step, tune, uiAnimOff, wake, type Spring } from './motion';

interface Box { x: number; y: number; w: number; h: number }
interface Drop { x: Spring; y: Spring; s: Spring; wait: number; go: boolean; to: { x: number; y: number; s: number }; el: HTMLElement }
interface Anim {
  mode: 'open' | 'close';
  panel: HTMLElement;        // настоящая панель (открытие) или её копия (закрытие)
  ghost: boolean;
  layer: HTMLElement;        // слой с фильтром, по размеру пятна
  origin: Box;               // начало координат слоя
  main: HTMLElement;         // пятно-карточка
  M: { x: Spring; y: Spring; w: Spring; h: Spring };
  drops: Drop[];
  fade: HTMLElement[];       // заголовок и кнопки панели: проявляются по очереди
  rect: Box;                 // где стоит панель (координаты холста)
  t: number;
}

const BLOB = 34;     // размер капли = кнопка инструмента
const PANEL_R = 14;  // скругление карточки панели
const PAD = 80;      // запас вокруг: фильтр размывает за края
let OUT: [number, number] = [230, 15];
let IN: [number, number] = [520, 34];
let TOAST: [number, number] = [260, 17];
let STAGGER = 0.045;

const anims = new Set<Anim>();
const byPanel = new WeakMap<HTMLElement, Anim>();
let ready = false;

function enabled(): boolean {
  return motionEnabled() && !uiAnimOff() && !reduceMotion() && !!document.getElementById('goo-layer');
}

function init(): void {
  if (ready) return;
  ready = true;
  OUT = spring('--goo-out', OUT);
  IN = spring('--goo-in', IN);
  TOAST = spring('--goo-toast', TOAST);
  const st = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--goo-stagger'));
  if (Number.isFinite(st) && st > 0) STAGGER = st / 1000;
  register({ frame, render, settled });
}

const rel = (el: Element, o: DOMRect): Box => {
  const r = el.getBoundingClientRect();
  return { x: r.left - o.left, y: r.top - o.top, w: r.width, h: r.height };
};

function build(mode: 'open' | 'close', panel: HTMLElement, anchor: HTMLElement, ghost: boolean): Anim | null {
  const host = document.getElementById('goo-layer')!;
  const wr = host.getBoundingClientRect();
  const a = rel(anchor, wr);
  const p: Box = { x: panel.offsetLeft, y: panel.offsetTop, w: panel.offsetWidth, h: panel.offsetHeight };
  if (a.w === 0 || p.w === 0) return null;
  const x0 = Math.min(a.x, p.x) - PAD, y0 = Math.min(a.y, p.y) - PAD;
  const x1 = Math.max(a.x + a.w, p.x + p.w) + PAD, y1 = Math.max(a.y + a.h, p.y + p.h) + PAD;
  const origin = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  const layer = document.createElement('div');
  layer.className = 'goo-fx';
  Object.assign(layer.style, { left: `${x0}px`, top: `${y0}px`, width: `${origin.w}px`, height: `${origin.h}px` });
  const main = document.createElement('div');
  main.className = 'goo-blob';
  layer.appendChild(main);

  const open = mode === 'open';
  const from = open ? a : p, to = open ? p : a;
  const M = { x: S(from.x), y: S(from.y), w: S(from.w), h: S(from.h) };
  const [k, c] = open ? TOAST : IN;
  for (const s of Object.values(M)) tune(s, k, c);
  M.x.t = to.x; M.y.t = to.y; M.w.t = to.w; M.h.t = to.h;

  const tools = [...panel.querySelectorAll<HTMLElement>('.ctx-shapes .tool')];
  const ac = { x: a.x + a.w / 2, y: a.y + a.h / 2 };
  const n = tools.length;
  const drops = tools.map((btn, i): Drop => {
    const r = rel(btn, wr);
    const slot = { x: r.x + r.w / 2, y: r.y + r.h / 2 };
    const el = document.createElement('div');
    el.className = 'goo-blob goo-drop';
    layer.appendChild(el);
    const start = open ? { ...ac, s: 0.6 } : { ...slot, s: 1 };
    const end = open ? { ...slot, s: 1 } : { ...ac, s: 0.5 };
    return {
      x: S(start.x), y: S(start.y), s: S(start.s, 420, 22), el, to: end, go: false,
      wait: open ? i * STAGGER : (n - 1 - i) * STAGGER * 0.66,
    };
  });
  host.appendChild(layer);
  const fade = [panel.querySelector<HTMLElement>('.ctx-title'), ...tools].filter((e): e is HTMLElement => !!e);
  panel.classList.add('goo-anim'); // собственная рамка панели скрыта: контур рисует общее пятно
  const anim: Anim = { mode, panel, ghost, layer, origin, main, M, drops, fade, rect: p, t: 0 };
  anims.add(anim);
  render();
  wake();
  return anim;
}

/** Группа открыта: панель вырастает из кнопки, капли-инструменты выливаются. */
export function gooOpen(panel: HTMLElement, anchor: HTMLElement | null): void {
  if (!anchor || !enabled()) return;
  init();
  gooCancel(panel);
  const a = build('open', panel, anchor, false);
  if (a) byPanel.set(panel, a);
}

/**
 * Группа закрывается (вызывать ДО удаления панели из DOM): панель остаётся «призраком»-копией
 * и втягивается в кнопку. Если открытие ещё шло — продолжаем с того места, где оно было.
 */
export function gooClose(panel: HTMLElement, anchor: HTMLElement | null): void {
  if (!anchor || !enabled()) { gooCancel(panel); return; }
  init();
  const ghostEl = panel.cloneNode(true) as HTMLElement;
  // копия — не панель: у неё свой класс, чтобы её не путали с настоящими панелями (поиск по .ctx-panel)
  ghostEl.className = 'goo-ghost';
  ghostEl.removeAttribute('data-kind');
  ghostEl.removeAttribute('data-from');
  ghostEl.classList.remove('goo-anim');
  ghostEl.setAttribute('inert', '');
  ghostEl.style.pointerEvents = 'none';
  for (const k of ['mask-image', 'mask-repeat', 'mask-position', 'mask-size']) ghostEl.style.removeProperty(k);
  ghostEl.querySelectorAll<HTMLElement>('[style*="opacity"]').forEach(e => e.style.removeProperty('opacity'));
  const running = byPanel.get(panel);
  if (running && anims.has(running)) {
    // открытие не закончилось: тот же слой разворачивается обратно
    panel.parentElement?.appendChild(ghostEl);
    const wr = document.getElementById('goo-layer')!.getBoundingClientRect();
    const a = rel(anchor, wr);
    running.mode = 'close';
    running.ghost = true;
    ghostEl.classList.add('goo-anim');
    running.panel = ghostEl;
    running.fade = [ghostEl.querySelector<HTMLElement>('.ctx-title'), ...ghostEl.querySelectorAll<HTMLElement>('.ctx-shapes .tool')].filter((e): e is HTMLElement => !!e);
    running.t = 0;
    const ac = { x: a.x + a.w / 2, y: a.y + a.h / 2 };
    for (const s of Object.values(running.M)) tune(s, ...IN);
    running.M.x.t = a.x; running.M.y.t = a.y; running.M.w.t = a.w; running.M.h.t = a.h;
    running.drops.forEach((d, i) => {
      d.to = { ...ac, s: 0.5 };
      d.wait = (running.drops.length - 1 - i) * STAGGER * 0.66;
      d.go = false;
      d.x.t = d.x.x; d.y.t = d.y.x;
    });
    byPanel.delete(panel);
    wake();
    return;
  }
  panel.parentElement?.appendChild(ghostEl);
  const a = build('close', ghostEl, anchor, true);
  if (!a) ghostEl.remove();
}

/** Оборвать анимацию панели (панель открепили или убрали без эффекта): всё встаёт на место сразу. */
export function gooCancel(panel: HTMLElement): void {
  const a = byPanel.get(panel);
  byPanel.delete(panel);
  if (a && anims.has(a)) finish(a);
}

function finish(a: Anim): void {
  anims.delete(a);
  a.layer.remove();
  if (a.ghost) { a.panel.remove(); return; }
  a.panel.classList.remove('goo-anim');
  for (const k of ['mask-image', 'mask-repeat', 'mask-position', 'mask-size']) a.panel.style.removeProperty(k);
  for (const e of a.fade) e.style.removeProperty('opacity');
}

function frame(dt: number): void {
  for (const a of anims) {
    a.t += dt;
    for (const s of Object.values(a.M)) step(s, dt);
    for (const d of a.drops) {
      if (!d.go && (d.wait -= dt) <= 0) {
        d.go = true;
        const [k, c] = a.mode === 'open' ? OUT : IN;
        tune(d.x, k, c); tune(d.y, k, c);
        d.x.t = d.to.x; d.y.t = d.to.y; d.s.t = d.to.s;
        tune(d.s, a.mode === 'open' ? 300 : 420, a.mode === 'open' ? 14 : 30);
      }
      step(d.x, dt); step(d.y, dt); step(d.s, dt);
    }
  }
}

function render(): void {
  for (const a of [...anims]) {
    const o = a.origin;
    const { x, y, w, h } = { x: a.M.x.x, y: a.M.y.x, w: Math.max(2, a.M.w.x), h: Math.max(2, a.M.h.x) };
    a.main.style.width = `${w.toFixed(2)}px`;
    a.main.style.height = `${h.toFixed(2)}px`;
    a.main.style.borderRadius = `${Math.min(PANEL_R, w / 2, h / 2).toFixed(2)}px`;
    a.main.style.transform = `translate(${(x - o.x).toFixed(2)}px,${(y - o.y).toFixed(2)}px)`;
    for (const d of a.drops) {
      // капля вытягивается по направлению полёта
      const sp = Math.hypot(d.x.v, d.y.v);
      const st = 1 + Math.min(sp / 2600, 0.32);
      const ang = Math.atan2(d.y.v, d.x.v);
      const sc = Math.max(0.01, d.s.x);
      d.el.style.transform = `translate(${(d.x.x - o.x - BLOB / 2).toFixed(2)}px,${(d.y.x - o.y - BLOB / 2).toFixed(2)}px) rotate(${ang.toFixed(3)}rad) scale(${(sc * st).toFixed(3)},${(sc / st).toFixed(3)})`;
    }
    // панель видна только внутри пятна
    const p = a.rect;
    // маска, а не clip-path: маска не мешает попаданию курсора, и панель можно нажимать, пока она проявляется
    const st = a.panel.style;
    st.maskImage = 'linear-gradient(#000, #000)';
    st.maskRepeat = 'no-repeat';
    st.maskPosition = `${(x - p.x).toFixed(1)}px ${(y - p.y).toFixed(1)}px`;
    st.maskSize = `${w.toFixed(1)}px ${h.toFixed(1)}px`;
    a.fade.forEach((e, i) => {
      const v = a.mode === 'open' ? (a.t - 0.08 - i * STAGGER) / 0.18 : 1 - (a.t - i * 0.01) / 0.14;
      e.style.opacity = clamp(v, 0, 1).toFixed(3);
    });
    if (isDone(a)) finish(a);
  }
}

/** Пружина в пикселях стоит «на глаз»: меньше 0,6px от цели и почти без скорости. */
const restPx = (s: Spring): boolean => Math.abs(s.x - s.t) < 0.6 && Math.abs(s.v) < 15;

function isDone(a: Anim): boolean {
  const fadeEnd = a.mode === 'open' ? 0.08 + a.fade.length * STAGGER + 0.18 : 0.2;
  return a.t > fadeEnd && Object.values(a.M).every(restPx)
    && a.drops.every(d => d.go && restPx(d.x) && restPx(d.y) && atRest(d.s, 0.02));
}

function settled(): boolean {
  return anims.size === 0;
}
