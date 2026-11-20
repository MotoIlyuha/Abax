// Плавное скрытие и показ блока по высоте (сворачиваемые разделы панелей).
// Три режима анимаций доски, как у спойлера (src/spoiler.ts):
// - «Улучшенные» — высота на пружине --spring-soft, содержимое проявляется;
// - «Обычные» (body.no-motion) — CSS-переход высоты;
// - «Выкл» (body.no-ui-anim) и «уменьшить движение» — сразу.
// Блок — без padding, border и margin (иначе высота не доедет до нуля); в конце у него остаётся только hidden; повторный вызов посреди движения едет от текущей высоты.

import { S, clamp, motionEnabled, reduceMotion, register, spring, step, tune, uiAnimOff, wake, type Spring } from './motion';

const SOFT: readonly [number, number] = [260, 24];
const CSS_MS = 200;

interface Inst { el: HTMLElement; H: Spring; show: boolean; onFrame?: () => void; timer: number }
const insts = new WeakMap<HTMLElement, Inst>();
const moving = new Set<Inst>();
let registered = false;

function ensureLoop(): void {
  if (registered) return;
  registered = true;
  register({
    frame(dt) { for (const it of moving) step(it.H, dt); },
    render() {
      for (const it of [...moving]) {
        const done = !it.el.isConnected || (Math.abs(it.H.x - it.H.t) < 0.5 && Math.abs(it.H.v) < 5);
        if (done) { moving.delete(it); finish(it); continue; }
        const h = Math.max(0, it.H.x);
        it.el.style.height = `${h.toFixed(2)}px`;
        const full = it.show ? it.H.t : Math.max(1, it.el.scrollHeight);
        it.el.style.opacity = clamp(h / Math.max(1, full), 0, 1).toFixed(3);
        it.onFrame?.();
      }
    },
    settled: () => moving.size === 0,
  });
}

const STYLES = ['height', 'opacity', 'overflow', 'transition'];

function finish(it: Inst): void {
  window.clearTimeout(it.timer);
  for (const k of STYLES) it.el.style.removeProperty(k);
  it.el.hidden = !it.show;
  it.onFrame?.();
}

/** Показывает (show) или скрывает блок; onFrame — на каждом шаге высоты (например, переставить панель). */
export function setShown(el: HTMLElement, show: boolean, onFrame?: () => void): void {
  let it = insts.get(el);
  if (!it) { it = { el, H: S(0, ...SOFT), show: !el.hidden, timer: 0 }; insts.set(el, it); }
  const wasMoving = moving.has(it) || it.timer !== 0;
  if (!wasMoving && it.show === show && el.hidden === !show) return;
  // высота сейчас: у скрытого — ноль, у едущего — его инлайн-высота
  const from = el.hidden ? 0 : el.getBoundingClientRect().height;
  it.show = show;
  it.onFrame = onFrame;
  window.clearTimeout(it.timer);
  it.timer = 0;
  if (uiAnimOff() || reduceMotion()) { moving.delete(it); finish(it); return; }
  el.hidden = false;
  el.style.removeProperty('height');
  el.style.removeProperty('transition');
  el.style.overflow = 'hidden';
  const to = show ? el.scrollHeight : 0;
  if (!motionEnabled()) {
    moving.delete(it);
    el.style.height = `${from}px`;
    el.style.opacity = from > 0 || !show ? '1' : '0';
    void el.offsetHeight;
    el.style.transition = `height ${CSS_MS}ms cubic-bezier(0.22, 0.8, 0.24, 1), opacity ${CSS_MS}ms`;
    el.style.height = `${to}px`;
    el.style.opacity = show ? '1' : '0';
    // панель переставляем по ходу перехода
    const t0 = performance.now();
    const follow = () => { if (it.timer && performance.now() - t0 < CSS_MS) { onFrame?.(); requestAnimationFrame(follow); } };
    it.timer = window.setTimeout(() => { it.timer = 0; finish(it); }, CSS_MS + 20);
    requestAnimationFrame(follow);
    return;
  }
  if (!wasMoving || !moving.has(it)) { it.H.x = from; it.H.v = 0; }
  it.H.t = to;
  tune(it.H, ...spring('--spring-soft', SOFT));
  el.style.height = `${it.H.x}px`;
  moving.add(it);
  ensureLoop();
  wake();
}
