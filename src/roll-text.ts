// «Перекатывающаяся» надпись (по мотивам roll() из «Invite people» и слотов значения «Spring dropdown»
// с designbookmark.com/motion): новая строка въезжает снизу и проявляется из лёгкого размытия, прежняя
// уезжает вверх и гаснет. Текущая строка стоит в потоке (ширина надписи — по ней), уходящие — поверх.
//
// Три режима анимаций доски:
// - «Улучшенные» — пружины (въезд 420/32, уход 680/40, как в образце);
// - «Обычные» (body.no-motion) — новая строка коротко проявляется CSS-анимацией;
// - «Выкл» (body.no-ui-anim) — текст меняется сразу.

import { S, clamp, motionEnabled, register, step, tune, uiAnimOff, wake, type Spring } from './motion';

const FADE: readonly [number, number] = [420, 32];
const LEAVE: readonly [number, number] = [680, 40];

interface Line { el: HTMLElement; y: Spring; o: Spring; dead: boolean }
interface State { box: HTMLElement; h: number; lines: Line[]; enter: readonly [number, number]; leave: readonly [number, number] }

const moving = new Set<State>();
let registered = false;

function ensureLoop(): void {
  if (registered) return;
  registered = true;
  register({
    frame(dt) {
      for (const st of moving) for (const l of st.lines) { step(l.y, dt); step(l.o, dt); }
    },
    render() {
      for (const st of [...moving]) {
        if (!st.box.isConnected) { finish(st); continue; }
        st.lines = st.lines.filter(l => {
          if (l.dead && l.o.x < 0.02) { l.el.remove(); return false; }
          return true;
        });
        let busy = false;
        for (const l of st.lines) {
          const v = clamp(l.o.x, 0, 1);
          const still = !l.dead && Math.abs(l.y.x) < 0.05 && Math.abs(l.y.v) < 0.5 && v > 0.99;
          if (still) { clearLine(l.el); continue; }
          busy = true;
          l.el.style.transform = `translateY(${l.y.x.toFixed(2)}px)`;
          l.el.style.opacity = v.toFixed(3);
          l.el.style.filter = v > 0.98 ? '' : `blur(${((1 - v) * 2).toFixed(2)}px)`;
        }
        if (!busy) finish(st);
      }
    },
    settled: () => moving.size === 0,
  });
}

function clearLine(el: HTMLElement): void {
  el.style.removeProperty('transform');
  el.style.removeProperty('opacity');
  el.style.removeProperty('filter');
}

/** Уходящие строки убираются, текущая остаётся без инлайн-стилей. */
function finish(st: State): void {
  moving.delete(st);
  st.lines = st.lines.filter(l => {
    if (l.dead) { l.el.remove(); return false; }
    clearLine(l.el);
    return true;
  });
}

export interface RollSetOptions {
  /** 1 — новая строка снизу (по умолчанию), -1 — сверху. */
  dir?: 1 | -1;
  /** SVG-иконка перед текстом: только константы кода. */
  icon?: string;
  /** Без движения (например, первое значение или обновление с сервера). */
  instant?: boolean;
}

export interface Roll {
  /** Контейнер надписи: вставляется в кнопку или поле. */
  readonly el: HTMLElement;
  readonly text: string;
  set(text: string, opts?: RollSetOptions): void;
}

/**
 * Надпись высотой h пикселей. springs — пружины въезда и ухода (по умолчанию как в «Invite people»;
 * у выпадающего списка — одна пружина 340/26 на обе стороны, как в его образце).
 */
export function createRoll(className: string, h: number, springs?: { enter?: readonly [number, number]; leave?: readonly [number, number] }): Roll {
  const box = document.createElement('span');
  box.className = `roll ${className}`.trim();
  const st: State = { box, h, lines: [], enter: springs?.enter ?? FADE, leave: springs?.leave ?? LEAVE };
  let text = '';
  let key = '';

  const fill = (el: HTMLElement, t: string, icon?: string) => {
    if (icon) {
      const i = document.createElement('span');
      i.className = 'roll-icon';
      i.setAttribute('aria-hidden', 'true');
      i.innerHTML = icon; // константа из кода
      el.append(i);
    }
    const s = document.createElement('span');
    s.className = 'roll-text';
    s.textContent = t;
    el.append(s);
  };

  return {
    el: box,
    get text() { return text; },
    set(t: string, opts: RollSetOptions = {}) {
      const k = `${t}\u0000${opts.icon ?? ''}`;
      if (k === key) return;
      const first = key === '';
      key = k;
      text = t;
      const line = document.createElement('span');
      line.className = 'roll-line';
      fill(line, t, opts.icon);
      const animate = !first && !opts.instant && !uiAnimOff();
      if (!animate || !motionEnabled()) {
        // «Выкл», «Обычные» и первое значение: прежние строки уходят сразу
        finish(st);
        for (const l of st.lines) l.el.remove();
        st.lines = [];
        box.append(line);
        st.lines.push({ el: line, y: S(0), o: S(1), dead: false });
        if (animate) {
          line.classList.add('roll-fade');
          line.addEventListener('animationend', () => line.classList.remove('roll-fade'), { once: true });
        }
        return;
      }
      const dir = opts.dir ?? 1;
      for (const l of st.lines) {
        if (l.dead) continue;
        l.dead = true;
        l.el.classList.add('roll-leaving');
        l.el.setAttribute('aria-hidden', 'true');
        l.y.t = -dir * h;
        l.o.t = 0;
        tune(l.y, ...st.leave);
        tune(l.o, ...st.leave);
      }
      const y = S(dir * h);
      const o = S(0);
      tune(y, ...st.enter);
      tune(o, ...st.enter);
      y.t = 0;
      o.t = 1;
      line.style.transform = `translateY(${dir * h}px)`;
      line.style.opacity = '0';
      box.append(line);
      st.lines.push({ el: line, y, o, dead: false });
      moving.add(st);
      ensureLoop();
      wake();
    },
  };
}
