// Вкладки «Tab pill» (designbookmark.com/motion#tab-pill; SPEC_CHAT §1, §6): тёмная пилюля (--fg) под выбранной
// вкладкой, подпись на ней белая. У пилюли две пружины — по одной на край: край по ходу движения жёсткий (620/40),
// отстающий мягкий (170/19), поэтому пилюля тянется к новой вкладке и подбирает хвост.
// У вкладки может быть счётчик — маленькая пилюля, число перекатывается (src/roll-text.ts).
// Три режима анимаций: «Улучшенные» — пружины общего цикла src/motion.ts; «Обычные» (body.no-motion) —
// CSS-переход left/width 250 мс; «Выкл» (body.no-ui-anim) и «уменьшить движение» — сразу.
// Доступность: role="tablist"/"tab", aria-selected, aria-controls; стрелки, Home, End (выбор следует за фокусом).

import { S, motionEnabled, reduceMotion, register, step, tune, uiAnimOff, wake, type Spring } from './motion';
import { createRoll, type Roll } from './roll-text';
import { formatUnread } from './notify-center';

export interface TabPillTab { value: string; label: string; id?: string; controls?: string; title?: string }

export interface TabPillOptions {
  tabs: readonly TabPillTab[];
  value: string;
  /** Подпись списка вкладок для чтения с экрана. */
  label: string;
  onChange: (value: string) => void;
  className?: string;
}

export interface TabPill {
  readonly el: HTMLElement;
  readonly value: string;
  /** Выбрать вкладку программно (onChange не вызывается); instant — без движения. */
  setValue(value: string, opts?: { instant?: boolean }): void;
  /** Счётчик вкладки: 0 — скрыт. */
  setCount(value: string, n: number): void;
  /** Кнопка вкладки (фокус, тесты). */
  tab(value: string): HTMLButtonElement | null;
  /** Для диалогов, которые перехватывают клавиши до вкладки. */
  onKey(e: KeyboardEvent): boolean;
  dispose(): void;
  /** Края пилюли сейчас (для тестов и кадров). */
  readonly edges: { left: number; right: number };
}

/** Пружины образца: край по ходу движения и отстающий. */
export const TAB_LEAD: readonly [number, number] = [620, 40];
export const TAB_TRAIL: readonly [number, number] = [170, 19];
const ROW = 16;

interface Inst { root: HTMLElement; pill: HTMLElement; A: Spring; B: Spring; btns: HTMLButtonElement[]; centers: number[] }
const moving = new Set<Inst>();
let registered = false;

const near = (s: Spring): boolean => Math.abs(s.x - s.t) < 0.05 && Math.abs(s.v) < 0.5;

function paint(it: Inst): void {
  it.pill.style.left = `${it.A.x.toFixed(2)}px`;
  it.pill.style.width = `${Math.max(0, it.B.x - it.A.x).toFixed(2)}px`;
  // подпись белая, пока пилюля накрывает её середину: в полёте вкладки «загораются» по пути
  if (it.centers.length !== it.btns.length) return;
  it.btns.forEach((b, i) => b.classList.toggle('tp-on', it.A.x <= it.centers[i] && it.centers[i] <= it.B.x));
}

function ensureLoop(): void {
  if (registered) return;
  registered = true;
  register({
    frame(dt) { for (const it of moving) { step(it.A, dt); step(it.B, dt); } },
    render() {
      for (const it of [...moving]) {
        if (!it.root.isConnected || (near(it.A) && near(it.B))) {
          it.A.x = it.A.t; it.A.v = 0; it.B.x = it.B.t; it.B.v = 0;
          moving.delete(it);
        }
        paint(it);
      }
    },
    settled: () => moving.size === 0,
  });
}

export function createTabPill(o: TabPillOptions): TabPill {
  const root = document.createElement('div');
  root.className = `tp ${o.className ?? ''}`.trim();
  root.setAttribute('role', 'tablist');
  root.setAttribute('aria-label', o.label);
  const pill = document.createElement('span');
  pill.className = 'tp-pill';
  pill.setAttribute('aria-hidden', 'true');
  root.append(pill);
  const counts = new Map<string, { box: HTMLElement; roll: Roll; n: number }>();
  const btns = o.tabs.map((t, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tp-tab';
    b.setAttribute('role', 'tab');
    if (t.id) b.id = t.id;
    if (t.controls) b.setAttribute('aria-controls', t.controls);
    if (t.title) b.title = t.title;
    b.dataset.value = t.value;
    const label = document.createElement('span');
    label.className = 'tp-label';
    label.textContent = t.label;
    const box = document.createElement('span');
    box.className = 'tp-count';
    box.setAttribute('aria-hidden', 'true');
    const roll = createRoll('tp-roll', ROW);
    box.append(roll.el);
    counts.set(t.value, { box, roll, n: 0 });
    b.append(label, box);
    b.addEventListener('click', () => select(i, true));
    return b;
  });
  root.append(...btns);
  const it: Inst = { root, pill, A: S(0), B: S(0), btns, centers: [] };
  let cur = Math.max(0, o.tabs.findIndex(t => t.value === o.value));
  let measured = false;

  const sync = () => btns.forEach((b, i) => {
    b.setAttribute('aria-selected', String(i === cur));
    b.tabIndex = i === cur ? 0 : -1;
  });
  sync();

  /** Цели пружин — края выбранной вкладки. */
  const targets = (): boolean => {
    const b = btns[cur];
    if (!b || b.offsetWidth <= 0) return false;
    it.A.t = b.offsetLeft;
    it.B.t = b.offsetLeft + b.offsetWidth;
    it.centers = btns.map(x => x.offsetLeft + x.offsetWidth / 2);
    return true;
  };

  const snapNow = () => {
    moving.delete(it);
    root.classList.remove('tp-css');
    it.A.x = it.A.t; it.A.v = 0; it.B.x = it.B.t; it.B.v = 0;
    paint(it);
  };

  /** Размеры сменились (появился счётчик, панель шире): идущее движение едет к новым краям, стоящее — встаёт. */
  const remeasure = () => {
    if (!targets()) return;
    if (!measured) { measured = true; root.classList.add('tp-measured'); snapNow(); return; }
    if (moving.has(it)) return;
    snapNow();
  };
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(remeasure) : null;
  ro?.observe(root);
  for (const b of btns) ro?.observe(b);

  function go(dir: number, animate: boolean): void {
    if (!targets()) return;
    if (!measured) { measured = true; root.classList.add('tp-measured'); snapNow(); return; }
    if (animate && motionEnabled()) {
      root.classList.remove('tp-css');
      // край по ходу движения — жёсткий, второй отстаёт
      if (dir > 0) { tune(it.B, ...TAB_LEAD); tune(it.A, ...TAB_TRAIL); } else { tune(it.A, ...TAB_LEAD); tune(it.B, ...TAB_TRAIL); }
      moving.add(it);
      ensureLoop();
      wake();
      return;
    }
    moving.delete(it);
    root.classList.toggle('tp-css', animate);
    it.A.x = it.A.t; it.A.v = 0; it.B.x = it.B.t; it.B.v = 0;
    paint(it);
  }

  function select(i: number, user: boolean, instant = false): void {
    if (i === cur || i < 0) return;
    const dir = i > cur ? 1 : -1;
    cur = i;
    sync();
    if (user) o.onChange(o.tabs[i].value);
    go(dir, !instant && !uiAnimOff() && !reduceMotion());
  }

  function onKey(e: KeyboardEvent): boolean {
    const n = btns.length;
    const i = btns.indexOf(e.target as HTMLButtonElement);
    if (i < 0) return false;
    const next = e.key === 'ArrowRight' ? (i + 1) % n : e.key === 'ArrowLeft' ? (i - 1 + n) % n
      : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : -1;
    if (next < 0) return false;
    e.preventDefault();
    btns[next].focus();
    select(next, true, e.repeat);
    return true;
  }
  root.addEventListener('keydown', onKey);

  return {
    el: root,
    get value() { return o.tabs[cur].value; },
    get edges() { return { left: it.A.x, right: it.B.x }; },
    onKey,
    dispose() { ro?.disconnect(); moving.delete(it); },
    setValue(v, opts) { select(o.tabs.findIndex(t => t.value === v), false, opts?.instant); },
    setCount(v, n) {
      const c = counts.get(v);
      if (!c) return;
      const k = Math.max(0, Math.floor(n));
      if (k === c.n) return;
      const prev = c.n;
      c.n = k;
      const text = formatUnread(k);
      // 0 — прежнее число остаётся на сжимающемся счётчике
      if (text) c.roll.set(text, { instant: prev === 0, dir: k >= prev ? 1 : -1 });
      c.box.classList.toggle('on', k > 0);
      const b = btns[o.tabs.findIndex(t => t.value === v)];
      const base = o.tabs.find(t => t.value === v)?.label ?? '';
      b.setAttribute('aria-label', k > 0 ? `${base}: непрочитанных - ${text}` : base);
    },
    tab(v) { return btns[o.tabs.findIndex(t => t.value === v)] ?? null; },
  };
}
