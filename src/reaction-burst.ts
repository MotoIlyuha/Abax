// Частицы-реакции «Привлечь внимание» (SPEC_COMMENTS §5): эмодзи разлетаются из объекта во все стороны
// (и маленькие — из краевого курсора участника внутрь экрана). Слой #burst-layer над холстом, без нажатий.
//  • «Улучшенные» — частицы по баллистической дуге (WAAPI, ключевые кадры считаются здесь): всплывают с
//    подскоком масштаба, вращаются и гаснут в конце; разброс скорости, размера, длительности — случайный.
//  • «Обычные» — меньше частиц, прямой разлёт CSS-анимацией (burst-fly).
//  • «Выкл» и системное «уменьшить движение» — частиц нет.
// Эмодзи — только textContent.

import { menuMotion } from './menu-motion';

export const BURST_COUNT = 16;
export const BURST_COUNT_CSS = 10;
export const BURST_COUNT_SMALL = 6;
/** Частиц на экране одновременно не больше (щелчки подряд не копят сотни узлов). */
export const BURST_LIVE_MAX = 90;

let layer: HTMLElement | null = null;
let live = 0;

function host(): HTMLElement | null {
  if (layer?.isConnected) return layer;
  const wrap = document.getElementById('canvas-wrap');
  if (!wrap) return null;
  layer = document.getElementById('burst-layer') ?? document.createElement('div');
  layer.id = 'burst-layer';
  layer.setAttribute('aria-hidden', 'true');
  if (!layer.isConnected) wrap.appendChild(layer);
  return layer;
}

const rand = (a: number, b: number): number => a + Math.random() * (b - a);

export interface BurstOrigin {
  /** Центр (экранные координаты слоя). */
  x: number;
  y: number;
  /** Полуразмеры источника: частицы стартуют внутри него. */
  rx?: number;
  ry?: number;
  /** Направление разлёта (радианы) и раствор конуса; нет — во все стороны. */
  angle?: number;
  spread?: number;
  /** Маленькие частицы (из краевого курсора). */
  small?: boolean;
}

/** Ключевые кадры полёта частицы: старт в (x0, y0), скорость v px/с под углом a, «тяжесть» g, длительность ms. */
export function flightFrames(x0: number, y0: number, a: number, v: number, g: number, ms: number, spin: number, size: number): Keyframe[] {
  const out: Keyframe[] = [];
  const steps = 10;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    // замедление к концу: частица «зависает», прежде чем погаснуть
    const tt = (1 - (1 - t) ** 2.2) * ms / 1000;
    const x = x0 + Math.cos(a) * v * tt;
    const y = y0 + Math.sin(a) * v * tt + 0.5 * g * tt * tt;
    const scale = t < 0.14 ? 0.35 + (t / 0.14) * 0.85 : t < 0.26 ? 1.2 - ((t - 0.14) / 0.12) * 0.2 : 1 - (t - 0.26) * 0.25;
    const opacity = t < 0.08 ? t / 0.08 : t > 0.62 ? Math.max(0, 1 - (t - 0.62) / 0.38) : 1;
    out.push({
      transform: `translate(${(x - size / 2).toFixed(1)}px, ${(y - size / 2).toFixed(1)}px) rotate(${(spin * t).toFixed(1)}deg) scale(${scale.toFixed(3)})`,
      opacity: Number(opacity.toFixed(3)),
      offset: t,
    });
  }
  return out;
}

function particle(root: HTMLElement, emoji: string, size: number): HTMLElement {
  const p = document.createElement('span');
  p.className = 'burst-p';
  p.textContent = emoji;
  p.style.fontSize = `${size}px`;
  p.style.width = p.style.height = `${size}px`;
  root.appendChild(p);
  live++;
  return p;
}

function done(p: HTMLElement): void {
  if (!p.isConnected) return;
  p.remove();
  live = Math.max(0, live - 1);
}

/** Разлёт частиц emoji из точки o; false — частиц нет (анимации выключены или нет слоя). */
export function burst(emoji: string, o: BurstOrigin): boolean {
  const mode = menuMotion();
  if (mode === 'off') return false;
  const root = host();
  if (!root) return false;
  const small = !!o.small;
  let n = small ? BURST_COUNT_SMALL : mode === 'enhanced' ? BURST_COUNT : BURST_COUNT_CSS;
  n = Math.min(n, BURST_LIVE_MAX - live);
  if (n <= 0) return false;
  const rx = Math.min(o.rx ?? 0, 160) * 0.55;
  const ry = Math.min(o.ry ?? 0, 160) * 0.55;
  const reach = Math.max(rx, ry);
  for (let i = 0; i < n; i++) {
    const a = o.angle === undefined
      // во все стороны — равномерно по кругу с дрожанием, чтобы не было «звезды»
      ? (i / n) * Math.PI * 2 + rand(-0.35, 0.35)
      : o.angle + rand(-(o.spread ?? 1) / 2, (o.spread ?? 1) / 2);
    const size = small ? rand(13, 17) : rand(18, 30);
    const x0 = o.x + Math.cos(a) * rx * rand(0.2, 1);
    const y0 = o.y + Math.sin(a) * ry * rand(0.2, 1);
    const p = particle(root, emoji, size);
    const dist = (small ? rand(50, 110) : rand(70, 150)) + reach * 0.4;
    const ms = small ? rand(700, 1000) : rand(850, 1350);
    if (mode === 'enhanced' && typeof p.animate === 'function') {
      // скорость под дальность за время полёта; лёгкая «тяжесть» загибает дугу вниз
      const v = dist / (ms / 1000) * 1.35;
      const anim = p.animate(flightFrames(x0, y0, a, v, small ? 90 : 160, ms, rand(-70, 70), size), {
        duration: ms, delay: rand(0, 90), easing: 'linear', fill: 'both',
      });
      anim.onfinish = () => done(p);
      anim.oncancel = () => done(p);
    } else {
      p.classList.add('burst-css');
      p.style.left = `${(x0 - size / 2).toFixed(1)}px`;
      p.style.top = `${(y0 - size / 2).toFixed(1)}px`;
      p.style.setProperty('--dx', `${(Math.cos(a) * dist).toFixed(1)}px`);
      p.style.setProperty('--dy', `${(Math.sin(a) * dist).toFixed(1)}px`);
      p.style.setProperty('--rot', `${rand(-40, 40).toFixed(0)}deg`);
      p.style.animationDuration = `${Math.round(ms * 0.8)}ms`;
      p.addEventListener('animationend', () => done(p), { once: true });
      // без CSS-анимаций (тесты, старый движок) узел всё равно уходит
      window.setTimeout(() => done(p), ms + 400);
    }
  }
  return true;
}

/** Для тестов: сколько частиц сейчас на экране. */
export function liveParticles(): number {
  return live;
}

/** Для тестов: убрать всё. */
export function resetBursts(): void {
  layer?.remove();
  layer = null;
  live = 0;
}
