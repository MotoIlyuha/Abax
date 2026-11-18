// Сегменты и вкладки (по мотивам «Smooth tab» от Kokonut UI, MIT; designbookmark.com/motion#smooth-tab).
// Как в образце, положение выбора — дробное число (0 … n−1) на одной пружине 420/38 («чуть меньше
// критического затухания»); от него считаются и подложка-«пилюля», и слой подписей активного цвета,
// обрезанный clip-path по пилюле (каждая подпись верного цвета в любой точке пути, без перехода цвета).
// Во вкладках (tabs: true) от того же числа через onPaint едут и панели — так делает окно «Поделиться».
// Перетаскивание панелей (свайп) ведёт drag()/release(): пружина подхватывает скорость пальца.
//
// Три режима анимаций доски: «Улучшенные» — пружина; «Обычные» (body.no-motion) — CSS-переход
// (класс seg-css; для панелей — у того, кто рисует их в onPaint); «Выкл» (body.no-ui-anim) и «уменьшить движение» — сразу.
// Доступность: role="radiogroup"/"radio" или role="tablist"/"tab" (aria-selected, aria-controls); стрелки, Home, End.

import { S, clamp, motionEnabled, reduceMotion, register, step, tune, uiAnimOff, wake, type Spring } from './motion';

export interface SegmentOption { value: string; label: string; title?: string; id?: string; controls?: string }

export interface SegmentedOptions {
  options: readonly SegmentOption[];
  value: string;
  label: string;
  onChange: (value: string) => void;
  className?: string;
  /** Вкладки: role="tablist", у кнопок — role="tab". */
  tabs?: boolean;
  /** Каждая отрисовка положения p (0 … n−1) и как движется: 'spring' — пружина, 'css' — CSS-переход, 'jump' — сразу. */
  onPaint?: (p: number, how: 'spring' | 'css' | 'jump') => void;
}

export interface Segmented {
  readonly el: HTMLElement;
  readonly value: string;
  /** Текущее дробное положение. */
  readonly progress: number;
  setValue(value: string): void;
  /** Палец тянет: положение задаётся напрямую, пружина стоит. */
  drag(p: number): void;
  /** Палец отпустили: выбрать i и доехать пружиной с начальной скоростью v (вкладок в секунду). */
  release(i: number, v: number): void;
}

/** Пружина образца (stiffness 420, damping 38). */
const SPRING: readonly [number, number] = [420, 38];

interface Rect { left: number; width: number }
interface Inst { root: HTMLElement; pill: HTMLElement; overlay: HTMLElement; btns: HTMLButtonElement[]; P: Spring; rects: Rect[]; w: number; onPaint?: SegmentedOptions['onPaint'] }

const moving = new Set<Inst>();
let registered = false;

function ensureLoop(): void {
  if (registered) return;
  registered = true;
  register({
    frame(dt) { for (const it of moving) step(it.P, dt); },
    render() {
      for (const it of [...moving]) {
        const done = !it.root.isConnected || (Math.abs(it.P.x - it.P.t) < 0.001 && Math.abs(it.P.v) < 0.01);
        if (done) {
          it.P.x = it.P.t;
          it.P.v = 0;
          moving.delete(it);
        }
        // последний кадр — «встал» (jump): тот, кто рисует панели, знает, что движение закончилось
        paint(it, it.P.x, done ? 'jump' : 'spring');
      }
    },
    settled: () => moving.size === 0,
  });
}

function measure(it: Inst): void {
  const box = it.root.getBoundingClientRect();
  it.w = box.width;
  it.rects = it.btns.map(b => {
    const r = b.getBoundingClientRect();
    return { left: r.left - box.left, width: r.width };
  });
}

/** Пилюля и обрезка подписей в дробном положении p (как indicatorRect образца). */
function paint(it: Inst, p: number, how: 'spring' | 'css' | 'jump'): void {
  it.onPaint?.(p, how);
  if (!it.rects.length || it.w <= 0) return;
  const last = it.rects.length - 1;
  const q = clamp(p, 0, last);
  const i = Math.min(Math.floor(q), Math.max(last - 1, 0));
  const a = it.rects[i];
  const b = it.rects[Math.min(i + 1, last)];
  const t = q - i;
  let left = a.left + (b.left - a.left) * t;
  let width = a.width + (b.width - a.width) * t;
  // за крайней вкладкой пилюля упирается в стенку и сжимается (как в образце)
  const over = p < 0 ? -p : p - last;
  if (over > 0) {
    const squash = width * Math.min(over, 0.5) * 0.4;
    width -= squash;
    if (p > last) left += squash;
  }
  it.pill.style.transform = `translateX(${left.toFixed(2)}px)`;
  it.pill.style.width = `${width.toFixed(2)}px`;
  const right = it.w - left - width;
  it.overlay.style.clipPath = `inset(0 ${right.toFixed(2)}px 0 ${left.toFixed(2)}px round 7px)`;
}

export function createSegmented(o: SegmentedOptions): Segmented {
  const root = document.createElement('div');
  root.className = `seg ${o.className ?? ''}`.trim();
  root.setAttribute('role', o.tabs ? 'tablist' : 'radiogroup');
  root.setAttribute('aria-label', o.label);
  const pill = document.createElement('span');
  pill.className = 'seg-pill';
  pill.setAttribute('aria-hidden', 'true');
  const overlay = document.createElement('span');
  overlay.className = 'seg-overlay';
  overlay.setAttribute('aria-hidden', 'true');
  root.append(pill);
  const btns = o.options.map((opt, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'seg-opt';
    b.setAttribute('role', o.tabs ? 'tab' : 'radio');
    if (opt.id) b.id = opt.id;
    if (opt.controls) b.setAttribute('aria-controls', opt.controls);
    b.dataset.value = opt.value;
    b.textContent = opt.label;
    if (opt.title) b.title = opt.title;
    b.addEventListener('click', () => select(i, true));
    const ghost = document.createElement('span');
    ghost.className = 'seg-ghost';
    ghost.textContent = opt.label;
    overlay.append(ghost);
    return b;
  });
  root.append(...btns, overlay);
  const it: Inst = { root, pill, overlay, btns, P: S(0, ...SPRING), rects: [], w: 0, onPaint: o.onPaint };
  let cur = Math.max(0, o.options.findIndex(x => x.value === o.value));
  it.P.x = it.P.t = cur;

  const sync = () => {
    btns.forEach((b, i) => {
      b.setAttribute(o.tabs ? 'aria-selected' : 'aria-checked', String(i === cur));
      b.tabIndex = i === cur ? 0 : -1;
    });
    root.dataset.value = o.options[cur].value;
  };
  sync();

  // размеры известны только в документе: меряем при первом показе и при смене размера
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => { measure(it); paint(it, it.P.x, 'jump'); }) : null;
  ro?.observe(root);

  /** Доехать до cur: пружиной, CSS-переходом или сразу. */
  function go(user: boolean, v = 0, instant = false): void {
    it.P.t = cur;
    measure(it);
    const animate = user && !instant && !uiAnimOff() && !reduceMotion();
    if (animate && motionEnabled()) {
      root.classList.remove('seg-css');
      tune(it.P, ...SPRING);
      if (v) it.P.v = v;
      moving.add(it);
      ensureLoop();
      wake();
    } else {
      moving.delete(it);
      it.P.x = cur;
      it.P.v = 0;
      root.classList.toggle('seg-css', animate);
      paint(it, cur, animate ? 'css' : 'jump');
    }
  }

  function select(i: number, user: boolean, instant = false): void {
    if (i === cur) return;
    cur = i;
    sync();
    go(user, 0, instant);
    if (user) o.onChange(o.options[i].value);
  }

  root.addEventListener('keydown', e => {
    const n = btns.length;
    const i = btns.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    const next = e.key === 'ArrowRight' || (!o.tabs && e.key === 'ArrowDown') ? (i + 1) % n
      : e.key === 'ArrowLeft' || (!o.tabs && e.key === 'ArrowUp') ? (i - 1 + n) % n
        : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : -1;
    if (next < 0) return;
    e.preventDefault();
    btns[next].focus();
    // зажатая клавиша повторяется быстрее, чем успокаивается пружина: перескок
    select(next, true, e.repeat);
  });

  return {
    el: root,
    get value() { return o.options[cur].value; },
    get progress() { return it.P.x; },
    setValue(v) {
      const i = o.options.findIndex(x => x.value === v);
      if (i >= 0) select(i, false);
    },
    drag(p) {
      moving.delete(it);
      root.classList.remove('seg-css');
      if (!it.rects.length) measure(it);
      it.P.x = p;
      it.P.v = 0;
      paint(it, p, 'jump');
    },
    release(i, v) {
      const next = clamp(i, 0, btns.length - 1);
      const changed = next !== cur;
      cur = next;
      sync();
      go(true, v);
      if (changed) o.onChange(o.options[next].value);
    },
  };
}
