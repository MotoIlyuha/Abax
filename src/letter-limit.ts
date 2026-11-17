// Поле имени с видимым лимитом символов (по мотивам «Letter limit» с designbookmark.com/motion).
//
// Ввод анимирован так же, как поле почты на шаге входа (src/email-login.ts): настоящий <input> остаётся
// на месте (ввод, вставка, выделение, доступность), но его текст прозрачный. Зеркальный слой рисует
// по span на символ: новые буквы падают с отскоком (несколько сразу — волной), удалённые улетают вверх,
// свой курсор пружинит между позициями и вытягивается от скорости.
//
// То, что выходит за лимит, отрезается с конца и вылетает буквами: каждая подпрыгивает от конца текста,
// падает с вращением, один раз отскакивает и ложится в кучку под окном (где уже лежат буквы, «пол» выше).
// Стёрли символ: из кучки уходит одна буква, новые первыми.
//
// Кольцо и остаток символов справа появляются только после ввода с клавиатуры (или вставки):
// значение из кода и кнопка «Случайное имя» их прячут. Кольцо заполняется по мере ввода, у лимита
// оранжевое, на лимите красное, и на каждую лишнюю букву «мотает головой».

import { S, atRest, clamp, motionEnabled, reduceMotion, register, snap, spring, step, tune, unregister, wake, type MotionComponent, type Spring } from './motion';
import { limitState, splitAtLimit } from './onboarding-logic';

export interface LetterLimitOptions {
  /** Само поле: класс, placeholder, autocomplete и т. п. задаёт вызывающий. */
  input: HTMLInputElement;
  limit: number;
  /** С какого остатка счётчик оранжевый. */
  near: number;
  /** Куда класть слой с падающими буквами (сам слой position: fixed на весь экран); спрашивается при первом падении. */
  pileHost: () => HTMLElement;
  /** Под каким элементом лежит кучка: пол на 46 px ниже его нижнего края. */
  floorEl: () => HTMLElement;
}

export interface LetterLimit {
  /** Обёртка поля (рамка, кольцо, счётчик) для вставки в разметку. */
  el: HTMLElement;
  /**
   * Поставить значение из кода: лишнее отрезается молча, без падающих букв, счётчик прячется.
   * animate = false — буквы встают сразу (первое заполнение поля).
   */
  set(value: string, animate?: boolean): void;
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

/** Ввод с клавиатуры, вставка, перетаскивание — у них InputEvent; у программного события (кубик) — нет. */
const isUserInput = (e: Event): boolean => typeof InputEvent !== 'undefined' && e instanceof InputEvent;

export function createLetterLimit(opts: LetterLimitOptions): LetterLimit {
  const { input, limit, near, pileHost, floorEl } = opts;

  const el = document.createElement('div');
  el.className = 'ob-limit';
  const box = document.createElement('div');
  box.className = 'ob-limit-box';
  const layerOut = document.createElement('div');
  layerOut.className = 'ob-limit-layer';
  layerOut.setAttribute('aria-hidden', 'true');
  const layer = document.createElement('div');
  layer.className = 'ob-limit-layer-in';
  layerOut.appendChild(layer);
  const caret = document.createElement('span');
  caret.className = 'ob-limit-caret';
  box.append(layerOut, input, caret);

  const meta = document.createElement('div');
  meta.className = 'ob-limit-meta';
  meta.setAttribute('aria-hidden', 'true');
  const meter = document.createElementNS(SVG_NS, 'svg');
  meter.setAttribute('class', 'ob-limit-meter');
  meter.setAttribute('viewBox', '0 0 24 24');
  const fill = circle('ob-limit-fill');
  fill.setAttribute('pathLength', '1');
  meter.append(circle('ob-limit-track'), fill);
  const count = document.createElement('span');
  count.className = 'ob-limit-count';
  meta.append(meter, count);
  el.append(box, meta);

  const pop = spring('--spring-pop', [520, 16]);
  const settle = spring('--spring-settle', [280, 22]);
  const caretK = spring('--input-caret', [700, 32]);
  const F = S(0, ...settle);   // заполнение кольца
  const CP = S(1, ...pop);     // «прыжок» счётчика
  const SH = S(0, ...SHAKE);   // «мотает головой» на лишнюю букву
  const C = S(0, ...caretK);   // x своего курсора
  tune(F, ...settle);
  tune(CP, ...pop);
  tune(SH, ...SHAKE);
  tune(C, ...caretK);
  const springs: Spring[] = [F, CP, SH, C];

  // зеркальный слой
  let spans: HTMLSpanElement[] = [];
  let prev: string[] = [];
  let scroll = 0;
  let want = 0;
  let lastMove = 0;
  let focused = false;
  let shown = false;

  // кучка лишних букв
  let pile: HTMLDivElement | null = null;
  let letters: Letter[] = [];
  let bins: Record<number, number> = {};
  let floorY = 0;
  let W = 0;

  const animated = (): boolean => !reduceMotion() && motionEnabled();

  function ensurePile(): HTMLDivElement {
    if (!pile) {
      pile = document.createElement('div');
      pile.className = 'ob-pile';
      pile.setAttribute('aria-hidden', 'true');
      pileHost().appendChild(pile);
    }
    return pile;
  }

  function measure(): void {
    if (!pile) return;
    const p = pile.getBoundingClientRect();
    const f = floorEl().getBoundingClientRect();
    W = p.width;
    floorY = Math.min(f.bottom - p.top + 46, p.height - 14);
  }

  /** Правый край текста в слое (без прокрутки). */
  function textEnd(): number {
    const l = spans[spans.length - 1];
    return l ? l.offsetLeft + l.offsetWidth : 0;
  }

  /** Где встал бы следующий символ: конец текста в поле, в координатах слоя с буквами. */
  function endOfText(): [number, number] {
    const p = ensurePile().getBoundingClientRect();
    const r = layerOut.getBoundingClientRect();
    const x = Math.min(r.left + textEnd() - scroll, r.right);
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

  /** Зеркальный слой догоняет значение поля: удалённые буквы улетают, вставленные падают (как в поле почты). */
  function mirror(anim: boolean): void {
    const next = Array.from(input.value);
    let a = 0;
    while (a < prev.length && a < next.length && prev[a] === next[a]) a++;
    let b = 0;
    while (b < prev.length - a && b < next.length - a && prev[prev.length - 1 - b] === next[next.length - 1 - b]) b++;
    if (a === prev.length && a === next.length) return;
    for (const s of spans.splice(a, prev.length - a - b)) {
      if (!anim) { s.remove(); continue; }
      const left = s.offsetLeft;
      s.classList.remove('in');
      s.style.left = `${left}px`;
      s.classList.add('out');
      setTimeout(() => s.remove(), 360);
    }
    const ref = spans[a] ?? null;
    const fresh = next.slice(a, next.length - b).map((ch, i) => {
      const s = document.createElement('span');
      s.className = anim ? 'em-ch in' : 'em-ch';
      s.textContent = ch;
      s.style.setProperty('--d', `${Math.min(i, 30) * 18}ms`);
      layer.insertBefore(s, ref);
      return s;
    });
    spans.splice(a, 0, ...fresh);
    prev = next;
    lastMove = performance.now();
    if (!anim) {
      C.t = textEnd();
      snap(C);
    }
  }

  function showMeta(on: boolean): void {
    shown = on;
    el.classList.toggle('has-count', on);
  }

  function sync(fromUser: boolean, anim = true): void {
    const before = prev.length;
    const { kept, extra } = splitAtLimit(input.value, limit);
    if (extra) {                       // отрезаем то, что не влезло, и выбрасываем буквами
      const caretAt = input.selectionStart ?? kept.length;
      input.value = kept;
      if (document.activeElement === input) {
        const at = Math.min(caretAt, kept.length);
        input.setSelectionRange(at, at);
      }
    }
    mirror(anim && motionEnabled());
    if (extra && fromUser && animated()) drop(extra);
    const len = prev.length;
    if (len < before) {                // место освободилось: кучка отдаёт столько же букв
      const live = letters.filter(l => !l.out);
      for (let i = 0; i < Math.min(before - len, live.length); i++) leave(live[live.length - 1 - i]);
    }
    if (len !== before && shown) CP.x = Math.max(CP.x, 1.12);
    const left = limit - len;
    count.textContent = String(left);
    const st = limitState(left, near);
    el.classList.toggle('is-near', st === 'near');
    el.classList.toggle('is-full', st === 'full');
    F.t = len / limit;
    if (!shown) snap(F);               // кольцо скрыто — при появлении сразу на своём месте
    wake();
  }

  /** Куда встать курсору: позиция каретки поля по буквам слоя. */
  function caretTarget(): number {
    const end = input.selectionEnd ?? input.value.length;
    const i = Array.from(input.value.slice(0, end)).length;
    if (!spans.length) return 0;
    if (i < spans.length) return spans[i].offsetLeft;
    return textEnd();
  }

  const onInput = (e: Event): void => {
    if ((e as InputEvent).isComposing) return;   // набор через IME — режем по его окончании
    const user = isUserInput(e);
    if (user && !shown) { showMeta(true); snap(F); }
    else if (!user) showMeta(false);             // кнопка «Случайное имя» и прочие программные события
    sync(user);
  };
  const onMove = (): void => { lastMove = performance.now(); wake(); };
  input.addEventListener('input', onInput);
  input.addEventListener('compositionend', () => { showMeta(true); sync(true); });
  input.addEventListener('focus', () => { focused = true; el.classList.add('focus'); wake(); });
  input.addEventListener('blur', () => { focused = false; el.classList.remove('focus'); wake(); });
  for (const ev of ['keydown', 'keyup', 'click', 'select']) input.addEventListener(ev, onMove);
  window.addEventListener('resize', measure);

  const instant = (): boolean => !motionEnabled();
  const adv = (s: Spring, dt: number): void => { if (instant()) snap(s); else step(s, dt); };

  const comp: MotionComponent = {
    frame(dt) {
      C.t = caretTarget();
      for (const s of springs) adv(s, dt);
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
      // курсор всегда в поле зрения, если текст шире поля (как в поле почты)
      const width = layerOut.clientWidth;
      want = Math.max(0, C.t - width + 6);
      scroll += (want - scroll) * 0.25;
      if (Math.abs(want - scroll) < 0.3 || instant()) scroll = want;
      layer.style.transform = `translateX(${-scroll}px)`;
      input.scrollLeft = scroll;

      const speed = Math.abs(C.v);
      const stretch = Math.min(speed / 80, 7);
      caret.style.width = `${2 + stretch}px`;
      caret.style.transform = `translateX(${C.x - scroll - (C.v > 0 ? stretch : 0)}px)`;
      const idle = performance.now() - lastMove > 550 && speed < 5;
      const sel = input.selectionStart !== input.selectionEnd;
      caret.style.opacity = focused && !sel ? '1' : '0';
      caret.classList.toggle('blink', focused && idle);

      fill.style.strokeDashoffset = (1 - clamp(F.x, 0, 1)).toFixed(4);
      const sh = (SH.x * 0.5).toFixed(2);
      count.style.transform = `translateX(${sh}px) scale(${CP.x.toFixed(4)})`;
      meter.style.transform = `translateX(${sh}px) rotate(-90deg)`;
      for (const l of letters) {
        l.el.style.transform = `translate(${l.x.toFixed(1)}px,${l.y.toFixed(1)}px) rotate(${l.r.toFixed(1)}deg) scale(${l.s.toFixed(3)})`;
      }
    },
    settled() {
      return springs.every(s => atRest(s, 0.01)) && letters.every(l => l.rest && !l.out)
        && Math.abs(want - scroll) < 0.3 && (!focused || caret.classList.contains('blink'));
    },
  };
  register(comp);
  sync(false, false);
  snap(F);
  CP.x = 1;

  return {
    el,
    set(value, animate = true) {
      input.value = value;
      showMeta(false);
      sync(false, animate);
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
