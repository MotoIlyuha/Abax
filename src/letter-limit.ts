// Поле с видимым лимитом символов (по мотивам «Letter limit» с designbookmark.com/motion).
// Это настоящее поле ввода в одну строку: то, что выходит за лимит, отрезается с конца и вылетает
// буквами. Каждая буква подпрыгивает от конца текста, падает с вращением, один раз отскакивает
// и ложится в кучку под окном (где уже лежат буквы, «пол» выше). Кольцо справа заполняется
// по мере ввода, у лимита становится оранжевым, на лимите красным, и на каждую лишнюю букву
// «мотает головой». Стёрли символ: из кучки уходит одна буква, новые первыми.

import { S, atRest, clamp, motionEnabled, reduceMotion, register, spring, step, tune, unregister, wake, type MotionComponent } from './motion';
import { limitState, splitAtLimit } from './onboarding-logic';

export interface LetterLimitOptions {
  /** Само поле: класс, placeholder, autocomplete и т. п. задаёт вызывающий. */
  input: HTMLInputElement;
  limit: number;
  /** С какого остатка счётчик оранжевый. */
  near: number;
  /** Куда класть слой с падающими буквами: элемент на весь экран (position: fixed). */
  pileHost: HTMLElement;
  /** Под каким элементом лежит кучка: пол на 46 px ниже его нижнего края. */
  floorEl: HTMLElement;
}

export interface LetterLimit {
  /** Обёртка поля (рамка, кольцо, счётчик) для вставки в разметку. */
  el: HTMLElement;
  /** Поставить значение из кода: лишнее отрезается молча, без падающих букв. */
  set(value: string): void;
  /** Убрать буквы и снять анимацию с цикла (окно закрыли). */
  destroy(): void;
}

interface Letter {
  el: HTMLSpanElement;
  x: number; y: number; vx: number; vy: number; r: number; vr: number;
  rest: boolean; out: number; s: number; bin: number | null; hits: number;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const BIN = 10;     // ширина «ячейки» пола, px
const MAXP = 46;    // больше букв в кучке не держим: старые уходят
const SHAKE: [number, number] = [700, 12];

function circle(cls: string): SVGCircleElement {
  const c = document.createElementNS(SVG_NS, 'circle');
  c.setAttribute('class', cls);
  c.setAttribute('cx', '12');
  c.setAttribute('cy', '12');
  c.setAttribute('r', '9');
  return c;
}

export function createLetterLimit(opts: LetterLimitOptions): LetterLimit {
  const { input, limit, near, pileHost, floorEl } = opts;

  const el = document.createElement('div');
  el.className = 'ob-limit';
  const mirror = document.createElement('span');
  mirror.className = 'ob-limit-mirror';
  mirror.setAttribute('aria-hidden', 'true');
  const meter = document.createElementNS(SVG_NS, 'svg');
  meter.setAttribute('class', 'ob-limit-meter');
  meter.setAttribute('viewBox', '0 0 24 24');
  meter.setAttribute('aria-hidden', 'true');
  const fill = circle('ob-limit-fill');
  fill.setAttribute('pathLength', '1');
  meter.append(circle('ob-limit-track'), fill);
  const count = document.createElement('span');
  count.className = 'ob-limit-count';
  count.setAttribute('aria-hidden', 'true');
  el.append(input, mirror, meter, count);

  const pop = spring('--spring-pop', [520, 16]);
  const settle = spring('--spring-settle', [280, 22]);
  const F = S(0, ...settle);   // заполнение кольца
  const CP = S(1, ...pop);     // «прыжок» счётчика
  const SH = S(0, ...SHAKE);   // «мотает головой» на лишнюю букву
  tune(F, ...settle);
  tune(CP, ...pop);
  tune(SH, ...SHAKE);
  const springs = [F, CP, SH];

  let pile: HTMLDivElement | null = null;
  let letters: Letter[] = [];
  let bins: Record<number, number> = {};
  let len = 0;
  let floorY = 0;
  let W = 0;

  const animated = (): boolean => !reduceMotion() && motionEnabled();

  function ensurePile(): HTMLDivElement {
    if (!pile) {
      pile = document.createElement('div');
      pile.className = 'ob-pile';
      pile.setAttribute('aria-hidden', 'true');
      pileHost.appendChild(pile);
    }
    return pile;
  }

  function measure(): void {
    if (!pile) return;
    const p = pile.getBoundingClientRect();
    const f = floorEl.getBoundingClientRect();
    W = p.width;
    floorY = Math.min(f.bottom - p.top + 46, p.height - 14);
  }

  /** Где встал бы следующий символ: конец текста в поле, в координатах слоя с буквами. */
  function endOfText(): [number, number] {
    const p = ensurePile().getBoundingClientRect();
    const r = input.getBoundingClientRect();
    mirror.textContent = input.value;
    const x = Math.min(r.left + mirror.offsetWidth - input.scrollLeft, r.right);
    return [x - p.left, r.top + r.height / 2 - p.top];
  }

  function drop(chars: string): void {
    ensurePile();
    measure();
    const [x, y] = endOfText();
    Array.from(chars).forEach((ch, i) => {
      if (!ch.trim()) return;
      const span = document.createElement('span');
      span.textContent = ch;
      pile!.appendChild(span);
      letters.push({
        el: span, x: x + 4 + i * 8, y, vx: -40 + Math.random() * 150, vy: -150 - Math.random() * 110,
        r: 0, vr: (Math.random() - 0.5) * 720, rest: false, out: 0, s: 1, bin: null, hits: 0,
      });
    });
    let live = letters.filter(l => !l.out);
    while (live.length > MAXP) { leave(live[0]); live = live.slice(1); }
    SH.v += 34;
    CP.x = 1.25;
  }

  /** Буква уходит из кучки: подпрыгивает и тает. */
  function leave(l: Letter): void {
    if (l.out) return;
    l.out = 0.001;
    l.vy = -230;
    l.rest = false;
    if (l.bin !== null) bins[l.bin] = Math.max(0, (bins[l.bin] || 0) - 1);
  }

  function sync(fromUser: boolean): void {
    const { kept, extra } = splitAtLimit(input.value, limit);
    if (extra) {                       // отрезаем то, что не влезло, и выбрасываем буквами
      const caret = input.selectionStart ?? kept.length;
      input.value = kept;
      if (document.activeElement === input) {
        const at = Math.min(caret, kept.length);
        input.setSelectionRange(at, at);
      }
      if (fromUser && animated()) drop(extra);
    }
    const was = len;
    len = Array.from(input.value).length;
    if (len < was) {                   // место освободилось: кучка отдаёт столько же букв
      const live = letters.filter(l => !l.out);
      for (let i = 0; i < Math.min(was - len, live.length); i++) leave(live[live.length - 1 - i]);
    }
    if (len !== was) CP.x = Math.max(CP.x, 1.12);
    const left = limit - len;
    count.textContent = String(left);
    const st = limitState(left, near);
    el.classList.toggle('is-near', st === 'near');
    el.classList.toggle('is-full', st === 'full');
    F.t = len / limit;
    wake();
  }

  const onInput = (e: Event): void => {
    if ((e as InputEvent).isComposing) return;   // набор через IME — режем по его окончании
    sync(true);
  };
  input.addEventListener('input', onInput);
  input.addEventListener('compositionend', () => sync(true));
  window.addEventListener('resize', measure);

  const comp: MotionComponent = {
    frame(dt) {
      for (const s of springs) step(s, dt);
      for (const l of letters) {
        if (l.out) {
          l.out += dt; l.vy += 900 * dt; l.y += l.vy * dt; l.s = Math.max(0, 1 - l.out / 0.32);
          continue;
        }
        if (l.rest) continue;
        l.vy += 1900 * dt; l.x += l.vx * dt; l.y += l.vy * dt; l.r += l.vr * dt;
        if (l.x < 14) { l.x = 14; l.vx = Math.abs(l.vx) * 0.5; } else if (l.x > W - 14) { l.x = W - 14; l.vx = -Math.abs(l.vx) * 0.5; }
        const b = Math.round(l.x / BIN);
        const ground = floorY - (bins[b] || 0) * 9;
        if (l.y >= ground && l.vy > 0) {
          l.y = ground;
          if (l.hits++ < 1 && l.vy > 260) { l.vy *= -0.3; l.vx *= 0.6; l.vr *= 0.5; }
          else {                       // легла: на ближайший бок, и пол здесь поднимается
            l.rest = true; l.bin = b; bins[b] = Math.min(3, (bins[b] || 0) + 1);
            l.r = Math.round(l.r / 90) * 90 + (Math.random() - 0.5) * 34;
            l.el.classList.add('is-down');
          }
        }
      }
      letters = letters.filter(l => {
        if (l.out > 0.34) { l.el.remove(); return false; }
        return true;
      });
    },
    render() {
      fill.style.strokeDashoffset = (1 - clamp(F.x, 0, 1)).toFixed(4);
      const sh = (SH.x * 0.5).toFixed(2);
      count.style.transform = `translateX(${sh}px) scale(${CP.x.toFixed(4)})`;
      meter.style.transform = `translateX(${sh}px) rotate(-90deg)`;
      for (const l of letters) {
        l.el.style.transform = `translate(${l.x.toFixed(1)}px,${l.y.toFixed(1)}px) rotate(${l.r.toFixed(1)}deg) scale(${l.s.toFixed(3)})`;
      }
    },
    settled() {
      return springs.every(s => atRest(s, 0.001)) && letters.every(l => l.rest && !l.out);
    },
  };
  register(comp);
  sync(false);
  // первый кадр без анимации: кольцо сразу на месте
  F.x = F.t; F.v = 0; CP.x = 1;

  return {
    el,
    set(value) {
      input.value = value;
      sync(false);
    },
    destroy() {
      unregister(comp);
      window.removeEventListener('resize', measure);
      pile?.remove();
      pile = null;
      letters = [];
      bins = {};
    },
  };
}
