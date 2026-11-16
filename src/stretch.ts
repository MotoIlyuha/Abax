// «Вытягивание» группы панели инструментов: панель вытягивается из кнопки группы, а при закрытии
// втягивается обратно. Четыре края панели — на пружинах: край, уходящий от кнопки, на жёсткой
// (lead), прилегающий к кнопке — на мягкой (trail), поэтому панель тянется, как резинка, и
// оседает. При закрытии роли краёв меняются местами. Содержимое проявляется чуть позже.
// Закрытая панель уже убрана из DOM — втягивается её копия-«призрак» (класс stretch-ghost).
// Пружины — токены --spring-* в style.css.

import { S, clamp, motionEnabled, reduceMotion, register, spring, step, tune, uiAnimOff, wake, type Spring } from './motion';

interface Box { x: number; y: number; w: number; h: number }
interface Anim {
  mode: 'open' | 'close';
  panel: HTMLElement;       // настоящая панель (открытие) или её копия (закрытие)
  ghost: boolean;
  L: Spring; R: Spring; T: Spring; B: Spring;
  rect: Box;                // где панель стоит на самом деле (координаты слоя панелей)
  dir: 'right' | 'left' | 'down' | 'up'; // куда панель уходит от кнопки
  fade: HTMLElement[];      // заголовок и кнопки: проявляются по очереди
  t: number;
}

const STAGGER = 0.02;
let LEAD: [number, number] = [620, 36];
let TRAIL: [number, number] = [190, 19];
let SOFT: [number, number] = [260, 24];
let ready = false;

const anims = new Set<Anim>();
const byPanel = new WeakMap<HTMLElement, Anim>();

const enabled = (): boolean => motionEnabled() && !uiAnimOff() && !reduceMotion();

function init(): void {
  if (ready) return;
  ready = true;
  LEAD = spring('--spring-lead', LEAD);
  TRAIL = spring('--spring-trail', TRAIL);
  SOFT = spring('--spring-soft', SOFT);
  register({ frame, render, settled: () => anims.size === 0 });
}

/** Куда уходит панель от кнопки: по положению панели инструментов. */
function directionOf(a: Box, p: Box): Anim['dir'] {
  const dx = p.x + p.w / 2 - (a.x + a.w / 2), dy = p.y + p.h / 2 - (a.y + a.h / 2);
  return Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 'right' : 'left') : (dy >= 0 ? 'down' : 'up');
}

/** Назначает пружины краям: ведущий — тот, что уходит от кнопки (при закрытии — наоборот). */
function tuneEdges(a: Anim): void {
  const open = a.mode === 'open';
  const far = { right: a.R, left: a.L, down: a.B, up: a.T }[a.dir];
  const near = { right: a.L, left: a.R, down: a.T, up: a.B }[a.dir];
  const horizontal = a.dir === 'right' || a.dir === 'left';
  tune(open ? far : near, ...LEAD);
  tune(open ? near : far, ...TRAIL);
  for (const s of horizontal ? [a.T, a.B] : [a.L, a.R]) tune(s, ...SOFT);
}

function setTargets(a: Anim, to: Box): void {
  a.L.t = to.x; a.R.t = to.x + to.w; a.T.t = to.y; a.B.t = to.y + to.h;
}

function fadeList(panel: HTMLElement): HTMLElement[] {
  return [...panel.querySelectorAll<HTMLElement>('.ctx-title, .ctx-shapes .tool')];
}

function build(mode: 'open' | 'close', panel: HTMLElement, anchor: HTMLElement, ghost: boolean): Anim | null {
  const layer = document.getElementById('ctx-layer');
  if (!layer) return null;
  const lr = layer.getBoundingClientRect();
  const ar = anchor.getBoundingClientRect();
  const a: Box = { x: ar.left - lr.left, y: ar.top - lr.top, w: ar.width, h: ar.height };
  const p: Box = { x: panel.offsetLeft, y: panel.offsetTop, w: panel.offsetWidth, h: panel.offsetHeight };
  if (a.w === 0 || p.w === 0 || p.h === 0) return null;
  const from = mode === 'open' ? a : p;
  const anim: Anim = {
    mode, panel, ghost, rect: p, t: 0, dir: directionOf(a, p), fade: fadeList(panel),
    L: S(from.x), R: S(from.x + from.w), T: S(from.y), B: S(from.y + from.h),
  };
  setTargets(anim, mode === 'open' ? p : a);
  tuneEdges(anim);
  anims.add(anim);
  panel.style.transformOrigin = '0 0';
  render();
  wake();
  return anim;
}

/** Группа открыта: панель вытягивается из кнопки. */
export function stretchOpen(panel: HTMLElement, anchor: HTMLElement | null): void {
  if (!anchor || !enabled()) return;
  init();
  stretchCancel(panel);
  const a = build('open', panel, anchor, false);
  if (a) byPanel.set(panel, a);
}

/**
 * Группа закрывается (вызывать ДО удаления панели из DOM): её копия втягивается в кнопку.
 * Если открытие ещё шло — втягивание начинается с того размера, который успел вытянуться.
 */
export function stretchClose(panel: HTMLElement, anchor: HTMLElement | null): void {
  if (!anchor || !enabled()) { stretchCancel(panel); return; }
  init();
  const ghostEl = panel.cloneNode(true) as HTMLElement;
  // копия — не панель: свой класс, чтобы её не путали с настоящими (поиск по .ctx-panel)
  ghostEl.className = 'stretch-ghost';
  ghostEl.removeAttribute('data-kind');
  ghostEl.removeAttribute('data-from');
  ghostEl.setAttribute('inert', '');
  ghostEl.style.pointerEvents = 'none';
  ghostEl.style.transform = '';
  ghostEl.querySelectorAll<HTMLElement>('[style*="opacity"]').forEach(e => e.style.removeProperty('opacity'));
  const running = byPanel.get(panel);
  const layer = document.getElementById('ctx-layer')!;
  if (running && anims.has(running)) {
    layer.appendChild(ghostEl);
    const lr = layer.getBoundingClientRect();
    const ar = anchor.getBoundingClientRect();
    ghostEl.style.transformOrigin = '0 0';
    running.mode = 'close';
    running.ghost = true;
    running.panel = ghostEl;
    running.fade = fadeList(ghostEl);
    running.t = 0;
    setTargets(running, { x: ar.left - lr.left, y: ar.top - lr.top, w: ar.width, h: ar.height });
    tuneEdges(running);
    byPanel.delete(panel);
    wake();
    return;
  }
  layer.appendChild(ghostEl);
  if (!build('close', ghostEl, anchor, true)) ghostEl.remove();
}

/** Оборвать анимацию панели (её открепили или убрали без эффекта): всё встаёт на место сразу. */
export function stretchCancel(panel: HTMLElement): void {
  const a = byPanel.get(panel);
  byPanel.delete(panel);
  if (a && anims.has(a)) finish(a);
}

function finish(a: Anim): void {
  anims.delete(a);
  if (a.ghost) { a.panel.remove(); return; }
  a.panel.style.removeProperty('transform');
  a.panel.style.removeProperty('transform-origin');
  a.panel.style.removeProperty('opacity');
  for (const e of a.fade) e.style.removeProperty('opacity');
}

function frame(dt: number): void {
  for (const a of anims) {
    a.t += dt;
    for (const s of [a.L, a.R, a.T, a.B]) step(s, dt);
  }
}

function render(): void {
  for (const a of [...anims]) {
    const p = a.rect;
    // края могут на миг разойтись «наоборот» — держим минимальный размер
    const l = Math.min(a.L.x, a.R.x - 6), t = Math.min(a.T.x, a.B.x - 6);
    const w = Math.max(6, a.R.x - l), h = Math.max(6, a.B.x - t);
    a.panel.style.transform = `translate(${(l - p.x).toFixed(2)}px,${(t - p.y).toFixed(2)}px) scale(${(w / p.w).toFixed(4)},${(h / p.h).toFixed(4)})`;
    const open = a.mode === 'open';
    // панель проявляется в начале вытягивания и гаснет в конце втягивания
    const cover = open ? clamp(a.t / 0.08, 0, 1) : clamp(1 - (a.t - 0.1) / 0.12, 0, 1);
    a.panel.style.opacity = cover.toFixed(3);
    a.fade.forEach((e, i) => {
      const v = open ? (a.t - 0.07 - i * STAGGER) / 0.16 : 1 - (a.t - i * 0.006) / 0.1;
      e.style.opacity = clamp(v, 0, 1).toFixed(3);
    });
    if (isDone(a)) finish(a);
  }
}

/** Пружина в пикселях стоит «на глаз»: меньше 0,6px от цели и почти без скорости. */
const restPx = (s: Spring): boolean => Math.abs(s.x - s.t) < 0.6 && Math.abs(s.v) < 15;

function isDone(a: Anim): boolean {
  const fadeEnd = a.mode === 'open' ? 0.07 + a.fade.length * STAGGER + 0.16 : 0.2;
  return a.t > fadeEnd && [a.L, a.R, a.T, a.B].every(restPx);
}
