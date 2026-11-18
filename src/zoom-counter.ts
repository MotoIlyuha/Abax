// Процент масштаба в шапке. Три поведения по режиму анимаций:
//  • «Выкл» (и системное «уменьшить движение») — текст меняется сразу;
//  • «Обычные» — число пробегает через промежуточные целые значения на пружине без перелёта;
//  • «Улучшенные» — как кодовый замок: каждая цифра — своё колёсико, которое прокручивается
//    к нужной цифре через промежуточные (по кратчайшему пути), правые колёсики стартуют раньше.

import { S, atRest, motionEnabled, reduceMotion, register, snap, spring, step, tune, uiAnimOff, wake, type Spring } from './motion';

type Kind = 'plain' | 'count' | 'lock';

const SETTLE: readonly [number, number] = [280, 22];
const STAGGER = 0.045;   // пауза между колёсиками, с

interface Wheel { col: HTMLElement; strip: HTMLElement; p: Spring; wait: number }

let el: HTMLElement | null = null;
let kind: Kind = 'plain';
let built = false;        // разметка el соответствует kind
let target = 100;
let shown = '';
let registered = false;
let wheels: Wheel[] = [];
const P: Spring = S(100, SETTLE[0], 2 * Math.sqrt(SETTLE[0])); // счётчик «обычных» анимаций

const mod10 = (x: number): number => ((x % 10) + 10) % 10;
const label = (n: number): string => `${Math.round(n)}%`;

function currentKind(): Kind {
  if (uiAnimOff() || reduceMotion()) return 'plain';
  return motionEnabled() ? 'lock' : 'count';
}

function writeText(text: string): void {
  if (el && text !== shown) { el.textContent = text; shown = text; }
}

// ----- колёсики -----

function makeWheel(startDigit: number): Wheel {
  const col = document.createElement('span');
  col.className = 'zoom-wheel';
  col.setAttribute('aria-hidden', 'true');
  const strip = document.createElement('span');
  strip.className = 'zoom-strip';
  // 0–9 и ещё раз 0: между 9 и 0 колёсико проходит без скачка
  for (let d = 0; d <= 10; d++) {
    const digit = document.createElement('span');
    digit.dataset.d = String(d % 10); // цифра рисуется CSS (content: attr), чтобы не попадать в textContent
    strip.append(digit);
  }
  col.append(strip);
  const p = S(startDigit, SETTLE[0], SETTLE[1]);
  const [k, c] = spring('--spring-settle', SETTLE);
  tune(p, k, c);
  return { col, strip, p, wait: 0 };
}

function drawWheel(w: Wheel): void {
  w.strip.style.transform = `translateY(${(-mod10(w.p.x) * 100) / 11}%)`;
}

/** Колёсики под число: правые сохраняются, новые слева стартуют с нуля, лишние уходят. */
function fitWheels(digits: number[]): void {
  if (!el) return;
  if (wheels.length > digits.length) wheels = wheels.slice(wheels.length - digits.length);
  while (wheels.length < digits.length) wheels.unshift(makeWheel(0));
  el.textContent = '';
  const pct = document.createElement('span');
  pct.className = 'zoom-pct';
  pct.setAttribute('aria-hidden', 'true');
  pct.dataset.d = '%';
  // настоящий текст масштаба: его читают скринридеры и textContent, колёсики — только картинка
  const sr = document.createElement('span');
  sr.className = 'zoom-sr';
  sr.textContent = label(target);
  el.append(sr, ...wheels.map(w => w.col), pct);
}

function setLockTarget(percent: number, instant: boolean): void {
  if (!el) return;
  const digits = String(percent).split('').map(Number);
  if (!built || wheels.length !== digits.length) { fitWheels(digits); built = true; }
  const sr = el.querySelector('.zoom-sr');
  if (sr) sr.textContent = label(percent);
  digits.forEach((d, i) => {
    const w = wheels[i];
    // кратчайший путь по кругу цифр: от 1 до 9 — назад через 0
    let diff = d - mod10(w.p.t);
    if (diff > 5) diff -= 10;
    if (diff < -5) diff += 10;
    w.p.t += diff;
    w.wait = diff === 0 || instant ? 0 : (digits.length - 1 - i) * STAGGER;
    if (instant) snap(w.p);
    drawWheel(w);
  });
}

// ----- цикл -----

function settled(): boolean {
  if (kind === 'lock') return wheels.every(w => w.wait <= 0 && atRest(w.p, 0.02));
  if (kind === 'count') return atRest(P, 0.5);
  return true;
}

function frame(dt: number): void {
  if (kind === 'lock') {
    for (const w of wheels) {
      if (w.wait > 0) { w.wait -= dt; continue; }
      step(w.p, dt);
    }
  } else if (kind === 'count') {
    step(P, dt);
  }
}

function render(): void {
  if (!el) return;
  // режим анимаций сменили на ходу: разметку не пересобираем в кадре, а ставим значение сразу
  if (currentKind() !== kind) { apply(target, true); return; }
  if (kind === 'lock') {
    const done = settled();
    for (const w of wheels) { if (done) snap(w.p); drawWheel(w); }
  } else if (kind === 'count') {
    writeText(label(settled() ? P.t : P.x));
  }
}

function apply(percent: number, instant: boolean): void {
  if (!el) return;
  const next = currentKind();
  if (next !== kind || !built) {
    instant = true; // разметка собирается заново — сразу в нужное значение
    kind = next;
    built = false;
    wheels = [];
    shown = '';
    el.textContent = '';
  }
  target = percent;
  if (kind === 'lock') { setLockTarget(percent, instant); }
  else if (kind === 'count') {
    built = true;
    P.t = percent;
    if (instant) { P.x = percent; snap(P); }
    writeText(label(instant ? percent : P.x));
  } else {
    built = true;
    snap(Object.assign(P, { x: percent, t: percent }));
    writeText(label(percent));
  }
}

/** Показывает масштаб в процентах так, как велит режим анимаций (см. шапку файла). */
export function setZoomCounter(host: HTMLElement, percent: number): void {
  if (!registered) {
    registered = true;
    const [k] = spring('--spring-settle', SETTLE);
    tune(P, k, 2 * Math.sqrt(k)); // критическое затухание: число не уходит за цель
    register({ frame, render, settled });
  }
  const first = el !== host;
  if (first) { el = host; built = false; }
  apply(percent, first);
  if (kind !== 'plain' && !settled()) wake();
}
