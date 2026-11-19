// Счётчик «− число +» (по мотивам «Number stepper» с designbookmark.com/motion, stepper.js).
// Минус и плюс перекатывают число вниз или вверх; на краю кнопка «мотает головой», а число чуть толкается
// в ту же сторону — чувствуется упор. Пружины — как в образце: число 260/24, кнопки 600/14, толчок числа 500/16.
// Значения — список (например, лимит гостей: 1, 2, 3 … 50, «без ограничений»).
//
// Три режима анимаций доски: «Улучшенные» — пружины; «Обычные» (body.no-motion) — число меняется
// с коротким CSS-проявлением, без толчков; «Выкл» (body.no-ui-anim) — сразу.
// Клавиатура: поле числа — role="spinbutton" (стрелки, Home, End, PageUp/PageDown); кнопки — для мыши.

import { S, clamp, motionEnabled, register, step, uiAnimOff, wake, type Spring } from './motion';

export interface StepperOptions {
  values: readonly number[];
  value: number;
  /** Как показать значение (например, 0 → «∞»). */
  format: (v: number) => string;
  /** Полное название значения для скринридера и подсказки (например, «без ограничений»). */
  spoken?: (v: number) => string;
  label: string;
  onChange: (v: number) => void;
  className?: string;
}

export interface Stepper {
  readonly el: HTMLElement;
  readonly value: number;
  setValue(v: number, instant?: boolean): void;
  setDisabled(d: boolean): void;
}

const MINUS = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12h12"/></svg>';
const PLUS = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 6v12M6 12h12"/></svg>';

interface Inst { num: HTMLElement; a: HTMLElement; b: HTMLElement; minus: HTMLElement; plus: HTMLElement; R: Spring; KM: Spring; KP: Spring; NN: Spring; dir: number }
const moving = new Set<Inst>();
let registered = false;
const rest = (s: Spring): boolean => Math.abs(s.x - s.t) < 0.002 && Math.abs(s.v) < 0.02;

function ensureLoop(): void {
  if (registered) return;
  registered = true;
  register({
    frame(dt) { for (const it of moving) for (const s of [it.R, it.KM, it.KP, it.NN]) step(s, dt); },
    render() {
      for (const it of [...moving]) {
        if (!it.num.isConnected || [it.R, it.KM, it.KP, it.NN].every(rest)) {
          for (const s of [it.R, it.KM, it.KP, it.NN]) { s.x = s.t; s.v = 0; }
          for (const e of [it.a, it.b, it.minus, it.plus, it.num]) { e.style.removeProperty('transform'); e.style.removeProperty('opacity'); }
          it.b.textContent = '';
          moving.delete(it);
          continue;
        }
        const r = it.R.x;
        it.a.style.transform = `translateY(${(it.dir * r * 100).toFixed(2)}%)`;
        it.a.style.opacity = clamp(1 - Math.abs(r), 0, 1).toFixed(3);
        it.b.style.transform = `translateY(${((r - 1) * it.dir * 100).toFixed(2)}%)`;
        it.b.style.opacity = clamp(r, 0, 1).toFixed(3);
        it.minus.style.transform = `translateX(${(it.KM.x * 0.06).toFixed(2)}px)`;
        it.plus.style.transform = `translateX(${(it.KP.x * 0.06).toFixed(2)}px)`;
        it.num.style.transform = `translateX(${(it.NN.x * 0.04).toFixed(2)}px)`;
      }
    },
    settled: () => moving.size === 0,
  });
}

export function createNumberStepper(o: StepperOptions): Stepper {
  const root = document.createElement('div');
  root.className = `stepper ${o.className ?? ''}`.trim();
  const minus = document.createElement('button');
  minus.type = 'button';
  minus.className = 'stp-b stp-minus';
  minus.tabIndex = -1;
  minus.setAttribute('aria-label', 'Меньше');
  minus.innerHTML = MINUS; // константа из кода
  const plus = document.createElement('button');
  plus.type = 'button';
  plus.className = 'stp-b stp-plus';
  plus.tabIndex = -1;
  plus.setAttribute('aria-label', 'Больше');
  plus.innerHTML = PLUS; // константа из кода
  const num = document.createElement('span');
  num.className = 'stp-num';
  num.tabIndex = 0;
  num.setAttribute('role', 'spinbutton');
  num.setAttribute('aria-label', o.label);
  const a = document.createElement('span');
  const b = document.createElement('span');
  b.setAttribute('aria-hidden', 'true');
  num.append(a, b);
  root.append(minus, num, plus);

  const values = [...o.values];
  let i = Math.max(0, values.indexOf(o.value));
  let disabled = false;
  const it: Inst = { num, a, b, minus, plus, R: S(0, 260, 24), KM: S(0, 600, 14), KP: S(0, 600, 14), NN: S(0, 500, 16), dir: 1 };
  const spoken = (v: number) => (o.spoken ?? o.format)(v);

  const sync = () => {
    const v = values[i];
    root.dataset.value = String(v);
    num.setAttribute('aria-valuenow', String(i));
    num.setAttribute('aria-valuemin', '0');
    num.setAttribute('aria-valuemax', String(values.length - 1));
    num.setAttribute('aria-valuetext', spoken(v));
    num.title = spoken(v);
    minus.classList.toggle('off', i === 0);
    plus.classList.toggle('off', i === values.length - 1);
    minus.disabled = disabled;
    plus.disabled = disabled;
    num.tabIndex = disabled ? -1 : 0;
    num.setAttribute('aria-disabled', String(disabled));
    root.classList.toggle('disabled', disabled);
  };
  a.textContent = o.format(values[i]);
  sync();

  const show = (from: number, d: number, instant: boolean) => {
    a.textContent = o.format(values[i]);
    if (instant || uiAnimOff()) return;
    if (!motionEnabled()) {
      a.classList.remove('stp-fade');
      void a.offsetWidth;
      a.classList.add('stp-fade');
      return;
    }
    b.textContent = o.format(values[from]);
    it.dir = d;
    it.R.x = 1;
    it.R.v = 0;
    moving.add(it);
    ensureLoop();
    wake();
  };

  const move = (d: number) => {
    if (disabled) return;
    const n = i + d;
    if (n < 0 || n >= values.length) {
      // упор: кнопка мотает головой, число толкается в ту же сторону
      if (!motionEnabled() || uiAnimOff()) return;
      (d < 0 ? it.KM : it.KP).v = 300 * (d < 0 ? -1 : 1);
      it.NN.v = 160 * Math.sign(d);
      moving.add(it);
      ensureLoop();
      wake();
      return;
    }
    const from = i;
    i = n;
    sync();
    show(from, Math.sign(d), false);
    o.onChange(values[i]);
  };

  minus.addEventListener('click', () => move(-1));
  plus.addEventListener('click', () => move(1));
  num.addEventListener('keydown', e => {
    const step = e.key === 'ArrowUp' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowDown' || e.key === 'ArrowLeft' ? -1
      : e.key === 'PageUp' ? 3 : e.key === 'PageDown' ? -3 : e.key === 'Home' ? -i : e.key === 'End' ? values.length - 1 - i : 0;
    if (!step && !['Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    if (step) move(clamp(i + step, 0, values.length - 1) - i || step);
  });

  return {
    el: root,
    get value() { return values[i]; },
    setValue(v, instant = true) {
      const n = values.indexOf(v);
      if (n < 0 || n === i) return;
      const from = i;
      i = n;
      sync();
      show(from, Math.sign(n - from), instant);
    },
    setDisabled(d) { disabled = d; sync(); },
  };
}
