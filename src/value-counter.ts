// Число рядом с ползунком (толщина, скругление, прозрачность). Те же три поведения, что у процента
// масштаба в шапке (src/zoom-counter.ts), но экземпляров много — по одному на строку панели:
//  • «Выкл» (и системное «уменьшить движение») — текст меняется сразу;
//  • «Обычные» — число пробегает через промежуточные значения на пружине без перелёта;
//  • «Улучшенные» — каждая цифра — своё колёсико кодового замка, правые стартуют раньше;
//    запятая и «%» стоят на месте.
// Разметка колёсиков и стили — те же (.zoom-wheel, .zoom-strip, .zoom-pct, .zoom-sr в style.css).

import { S, atRest, motionEnabled, reduceMotion, register, snap, spring, step, tune, uiAnimOff, wake, type Spring } from './motion';

type Kind = 'plain' | 'count' | 'lock';

const SETTLE: readonly [number, number] = [280, 22];
const STAGGER = 0.045;   // пауза между колёсиками, с

interface Wheel { col: HTMLElement; strip: HTMLElement; p: Spring; wait: number }

export interface ValueCounter {
  /** Показывает значение; instant — без анимации (первая отрисовка строки). */
  set(value: number, instant?: boolean): void;
}

interface Inst {
  host: HTMLElement;
  format: (v: number) => string;
  eps: number;
  kind: Kind;
  built: boolean;
  target: number;
  shown: string;
  wheels: Wheel[];
  count: Spring;
}

const mod10 = (x: number): number => ((x % 10) + 10) % 10;
const isDigit = (ch: string): boolean => ch >= '0' && ch <= '9';

const insts = new Set<Inst>();
let registered = false;

function currentKind(): Kind {
  if (uiAnimOff() || reduceMotion()) return 'plain';
  return motionEnabled() ? 'lock' : 'count';
}

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

function writeText(i: Inst, text: string): void {
  if (text !== i.shown) { i.host.textContent = text; i.shown = text; }
}

/** Колёсики под цифры строки: правые сохраняются, новые слева стартуют с нуля, лишние уходят. */
function fitWheels(i: Inst, text: string): void {
  const digitCount = [...text].filter(isDigit).length;
  if (i.wheels.length > digitCount) i.wheels = i.wheels.slice(i.wheels.length - digitCount);
  while (i.wheels.length < digitCount) i.wheels.unshift(makeWheel(0));
  i.host.textContent = '';
  // настоящий текст значения: его читают скринридеры и textContent, колёсики — только картинка
  const sr = document.createElement('span');
  sr.className = 'zoom-sr';
  sr.textContent = text;
  const parts: HTMLElement[] = [];
  let w = 0;
  for (const ch of text) {
    if (isDigit(ch)) { parts.push(i.wheels[w++].col); continue; }
    const mark = document.createElement('span');
    mark.className = 'zoom-pct';
    mark.setAttribute('aria-hidden', 'true');
    mark.dataset.d = ch;
    parts.push(mark);
  }
  i.host.append(sr, ...parts);
}

function setLockTarget(i: Inst, value: number, instant: boolean): void {
  const text = i.format(value);
  // форма строки («0,5» → «14») изменилась — разметка собирается заново, колёсики переиспользуются
  if (!i.built || i.shown !== text.replace(/\d/g, '0')) {
    fitWheels(i, text);
    i.shown = text.replace(/\d/g, '0');
    i.built = true;
  }
  const sr = i.host.querySelector('.zoom-sr');
  if (sr) sr.textContent = text;
  const digits = [...text].filter(isDigit).map(Number);
  digits.forEach((d, n) => {
    const w = i.wheels[n];
    // кратчайший путь по кругу цифр: от 1 до 9 — назад через 0
    let diff = d - mod10(w.p.t);
    if (diff > 5) diff -= 10;
    if (diff < -5) diff += 10;
    w.p.t += diff;
    w.wait = diff === 0 || instant ? 0 : (digits.length - 1 - n) * STAGGER;
    if (instant) snap(w.p);
    drawWheel(w);
  });
}

function settled(i: Inst): boolean {
  if (i.kind === 'lock') return i.wheels.every(w => w.wait <= 0 && atRest(w.p, 0.02));
  if (i.kind === 'count') return atRest(i.count, i.eps);
  return true;
}

function apply(i: Inst, value: number, instant: boolean): void {
  const next = currentKind();
  if (next !== i.kind || !i.built) {
    instant = true; // разметка собирается заново — сразу в нужное значение
    i.kind = next;
    i.built = false;
    i.wheels = [];
    i.shown = '';
    i.host.textContent = '';
  }
  i.target = value;
  if (i.kind === 'lock') { setLockTarget(i, value, instant); return; }
  i.built = true;
  if (i.kind === 'count') {
    i.count.t = value;
    if (instant) { i.count.x = value; snap(i.count); }
    writeText(i, i.format(instant ? value : i.count.x));
  } else {
    snap(Object.assign(i.count, { x: value, t: value }));
    writeText(i, i.format(value));
  }
}

function frame(dt: number): void {
  for (const i of insts) {
    if (i.kind === 'lock') {
      for (const w of i.wheels) {
        if (w.wait > 0) { w.wait -= dt; continue; }
        step(w.p, dt);
      }
    } else if (i.kind === 'count') {
      step(i.count, dt);
    }
  }
}

function render(): void {
  for (const i of [...insts]) {
    if (!i.host.isConnected) { insts.delete(i); continue; } // панель пересобрана — строка ушла
    // режим анимаций сменили на ходу: разметку не пересобираем в кадре, а ставим значение сразу
    if (currentKind() !== i.kind) { apply(i, i.target, true); continue; }
    if (i.kind === 'lock') {
      const done = settled(i);
      for (const w of i.wheels) { if (done) snap(w.p); drawWheel(w); }
    } else if (i.kind === 'count') {
      writeText(i, i.format(settled(i) ? i.count.t : i.count.x));
    }
  }
}

/**
 * Число в host, которое меняется так, как велит режим анимаций (см. шапку файла).
 * eps — точность успокоения пружины в единицах значения (для «обычных» анимаций).
 */
export function createValueCounter(host: HTMLElement, format: (v: number) => string, eps: number, initial: number): ValueCounter {
  if (!registered) {
    registered = true;
    register({
      frame, render,
      settled: () => [...insts].every(i => !i.host.isConnected || settled(i)),
    });
  }
  const [k] = spring('--spring-settle', SETTLE);
  const count = S(initial, SETTLE[0], 2 * Math.sqrt(SETTLE[0]));
  tune(count, k, 2 * Math.sqrt(k)); // критическое затухание: число не уходит за цель
  for (const old of [...insts]) if (!old.host.isConnected) insts.delete(old); // строки пересобранных панелей
  const inst: Inst = { host, format, eps, kind: 'plain', built: false, target: initial, shown: '', wheels: [], count };
  insts.add(inst);
  apply(inst, initial, true);
  return {
    set(value, instant = false) {
      apply(inst, value, instant);
      insts.add(inst);
      if (inst.kind !== 'plain' && !settled(inst)) wake();
    },
  };
}
