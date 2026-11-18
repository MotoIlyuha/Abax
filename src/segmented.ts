// Сегментный переключатель (по мотивам «Smooth tab» от Kokonut UI, MIT; designbookmark.com/motion#smooth-tab).
// Как в образце, положение выбора — дробное число (0 … n−1) на одной пружине 420/38 («чуть меньше
// критического затухания»); от него считаются и подложка-«пилюля», и слой подписей активного цвета,
// обрезанный clip-path по пилюле. Поэтому каждая подпись верного цвета в любой точке пути — без перехода цвета.
// Перетаскивание панелей из образца здесь не нужно: у переключателя нет панелей.
//
// Три режима анимаций доски: «Улучшенные» — пружина; «Обычные» (body.no-motion) — CSS-переход;
// «Выкл» (body.no-ui-anim) и «уменьшить движение» — сразу.
// Доступность: role="radiogroup" и кнопки role="radio"; стрелки, Home и End меняют выбор.

import { S, clamp, motionEnabled, reduceMotion, register, step, uiAnimOff, wake, type Spring } from './motion';

export interface SegmentOption { value: string; label: string; title?: string }

export interface SegmentedOptions {
  options: readonly SegmentOption[];
  value: string;
  label: string;
  onChange: (value: string) => void;
  className?: string;
}

export interface Segmented {
  readonly el: HTMLElement;
  readonly value: string;
  setValue(value: string): void;
}

/** Пружина образца (stiffness 420, damping 38). */
const SPRING: readonly [number, number] = [420, 38];

interface Rect { left: number; width: number }
interface Inst { root: HTMLElement; pill: HTMLElement; overlay: HTMLElement; btns: HTMLButtonElement[]; P: Spring; rects: Rect[]; w: number }

const moving = new Set<Inst>();
let registered = false;

function ensureLoop(): void {
  if (registered) return;
  registered = true;
  register({
    frame(dt) { for (const it of moving) step(it.P, dt); },
    render() {
      for (const it of [...moving]) {
        paint(it, it.P.x);
        if (!it.root.isConnected || (Math.abs(it.P.x - it.P.t) < 0.001 && Math.abs(it.P.v) < 0.01)) {
          it.P.x = it.P.t;
          it.P.v = 0;
          moving.delete(it);
          paint(it, it.P.x);
        }
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
function paint(it: Inst, p: number): void {
  if (!it.rects.length || it.w <= 0) return;
  const last = it.rects.length - 1;
  const q = clamp(p, 0, last);
  const i = Math.min(Math.floor(q), Math.max(last - 1, 0));
  const a = it.rects[i];
  const b = it.rects[Math.min(i + 1, last)];
  const t = q - i;
  const left = a.left + (b.left - a.left) * t;
  const width = a.width + (b.width - a.width) * t;
  it.pill.style.transform = `translateX(${left.toFixed(2)}px)`;
  it.pill.style.width = `${width.toFixed(2)}px`;
  const right = it.w - left - width;
  it.overlay.style.clipPath = `inset(0 ${right.toFixed(2)}px 0 ${left.toFixed(2)}px round 7px)`;
}

export function createSegmented(o: SegmentedOptions): Segmented {
  const root = document.createElement('div');
  root.className = `seg ${o.className ?? ''}`.trim();
  root.setAttribute('role', 'radiogroup');
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
    b.setAttribute('role', 'radio');
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
  const it: Inst = { root, pill, overlay, btns, P: S(0, ...SPRING), rects: [], w: 0 };
  let cur = Math.max(0, o.options.findIndex(x => x.value === o.value));
  it.P.x = it.P.t = cur;

  const sync = () => {
    btns.forEach((b, i) => {
      b.setAttribute('aria-checked', String(i === cur));
      b.tabIndex = i === cur ? 0 : -1;
    });
    root.dataset.value = o.options[cur].value;
  };
  sync();

  // размеры известны только в документе: меряем при первом показе и при смене размера
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => { measure(it); paint(it, it.P.x); }) : null;
  ro?.observe(root);

  function select(i: number, user: boolean): void {
    if (i === cur) return;
    cur = i;
    sync();
    it.P.t = i;
    measure(it);
    const animate = user && !uiAnimOff() && !reduceMotion();
    if (animate && motionEnabled()) {
      root.classList.remove('seg-css');
      moving.add(it);
      ensureLoop();
      wake();
    } else {
      it.P.x = i;
      it.P.v = 0;
      root.classList.toggle('seg-css', animate);
      paint(it, i);
    }
    if (user) o.onChange(o.options[i].value);
  }

  root.addEventListener('keydown', e => {
    const n = btns.length;
    const i = btns.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    const next = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? (i + 1) % n
      : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? (i - 1 + n) % n
        : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : -1;
    if (next < 0) return;
    e.preventDefault();
    btns[next].focus();
    select(next, true);
  });

  return {
    el: root,
    get value() { return o.options[cur].value; },
    setValue(v) {
      const i = o.options.findIndex(x => x.value === v);
      if (i >= 0) select(i, false);
    },
  };
}
