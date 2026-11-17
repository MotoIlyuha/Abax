// Лёгкие эффекты персональных курсоров (Pro): шлейф частиц и искры при движении.
// Отдельный канвас поверх холста (без событий мыши), свой requestAnimationFrame, который работает,
// только пока есть живые частицы. Свечение («glow») вшито в сам SVG курсора и здесь не рисуется.
// Выключено при «уменьшении движения» в системе и выключенном переключателе «Motion анимации».

import { cursorPreset, type CursorEffect } from './cursors';
import { motionEnabled, reduceMotion } from './motion';

export interface Particle {
  x: number; y: number; vx: number; vy: number;
  /** Сколько осталось жить и сколько жила всего, мс. */
  life: number; max: number;
  size: number; color: string;
  shape: 'dot' | 'square' | 'star';
}

/** Не больше частиц на весь экран (свои и чужие курсоры вместе). */
export const MAX_PARTICLES = 160;
/** Шаг между частицами шлейфа, px экрана. */
const TRAIL_STEP = 5;

const particles: Particle[] = [];
const lastPos = new Map<string, { x: number; y: number }>();
let canvas: HTMLCanvasElement | null = null;
let raf = 0;
let lastT = 0;

/** Эффекты разрешены сейчас. */
export function fxEnabled(): boolean {
  try { return !reduceMotion() && motionEnabled(); } catch { return false; }
}

export function particleCount(): number {
  return particles.length;
}

/** Продвинуть частицы на dt мс: движение, затухание, удаление умерших (чистая логика). */
export function stepParticles(list: Particle[], dt: number): void {
  for (let i = list.length - 1; i >= 0; i--) {
    const p = list[i];
    p.life -= dt;
    if (p.life <= 0) { list.splice(i, 1); continue; }
    p.x += p.vx * dt / 1000;
    p.y += p.vy * dt / 1000;
    p.vy += 12 * dt / 1000; // чуть-чуть оседают
  }
}

function push(p: Particle): void {
  particles.push(p);
  if (particles.length > MAX_PARTICLES) particles.splice(0, particles.length - MAX_PARTICLES);
}

function spawn(effect: CursorEffect, color: string, square: boolean, x: number, y: number, rand: () => number): void {
  if (effect === 'trail') {
    push({
      x: x + (rand() - 0.5) * 2, y: y + (rand() - 0.5) * 2, vx: (rand() - 0.5) * 14, vy: (rand() - 0.5) * 14,
      life: 380, max: 380, size: square ? 3 : 2.6 + rand() * 1.4, color, shape: square ? 'square' : 'dot',
    });
  } else if (effect === 'sparkle') {
    if (rand() > 0.45) return;
    push({
      x: x + 4 + (rand() - 0.3) * 16, y: y + 6 + (rand() - 0.3) * 16, vx: (rand() - 0.5) * 10, vy: -6 - rand() * 10,
      life: 560, max: 560, size: 2.2 + rand() * 2.2, color, shape: 'star',
    });
  }
}

/**
 * Курсор с ключом key (свой — 'me', чужой — 'u<id>') переместился в точку (x, y) в координатах
 * #canvas-wrap. Для пресетов с шлейфом или искрами рождаются частицы.
 */
export function fxMove(key: string, x: number, y: number, cursorId: string, rand: () => number = Math.random): void {
  const p = cursorPreset(cursorId);
  if (p.effect !== 'trail' && p.effect !== 'sparkle') { lastPos.delete(key); return; }
  if (!fxEnabled()) return;
  const prev = lastPos.get(key);
  lastPos.set(key, { x, y });
  if (!prev) return;
  const dist = Math.hypot(x - prev.x, y - prev.y);
  if (dist < 1 || dist > 400) return; // скачок (другая страница, телепорт) — без шлейфа
  const n = Math.min(8, Math.max(1, Math.floor(dist / TRAIL_STEP)));
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    spawn(p.effect, p.effectColor, p.pattern === 'pixel', prev.x + (x - prev.x) * t, prev.y + (y - prev.y) * t, rand);
  }
  start();
}

/** Курсор ушёл (участник отключился, мышь покинула холст): следующий шлейф начнётся заново. */
export function fxForget(key: string): void {
  lastPos.delete(key);
}

function ensureCanvas(): HTMLCanvasElement | null {
  if (canvas?.isConnected) return canvas;
  const wrap = document.getElementById('canvas-wrap');
  if (!wrap) return null;
  canvas = document.createElement('canvas');
  canvas.id = 'cursor-fx';
  canvas.setAttribute('aria-hidden', 'true');
  wrap.appendChild(canvas);
  return canvas;
}

function start(): void {
  if (raf || typeof requestAnimationFrame !== 'function') return;
  lastT = 0;
  raf = requestAnimationFrame(frame);
}

function star(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    const rr = i % 2 === 0 ? r : r * 0.35;
    ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fill();
}

function frame(t: number): void {
  raf = 0;
  const dt = lastT ? Math.min(64, t - lastT) : 16;
  lastT = t;
  stepParticles(particles, dt);
  const c = ensureCanvas();
  const ctx = c?.getContext('2d');
  if (!c || !ctx) { particles.length = 0; return; }
  const dpr = window.devicePixelRatio || 1;
  const w = c.clientWidth, h = c.clientHeight;
  if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  if (!fxEnabled()) particles.length = 0;
  for (const p of particles) {
    const k = p.life / p.max;
    ctx.globalAlpha = Math.max(0, Math.min(1, k)) * 0.85;
    ctx.fillStyle = p.color;
    const s = p.size * (0.5 + 0.5 * k);
    if (p.shape === 'square') ctx.fillRect(Math.round(p.x - s / 2), Math.round(p.y - s / 2), Math.ceil(s), Math.ceil(s));
    else if (p.shape === 'star') star(ctx, p.x, p.y, s);
    else { ctx.beginPath(); ctx.arc(p.x, p.y, s / 2, 0, Math.PI * 2); ctx.fill(); }
  }
  ctx.globalAlpha = 1;
  if (particles.length > 0) raf = requestAnimationFrame(frame);
}

/** Для тестов: убрать частицы и запомненные позиции. */
export function resetFxForTests(): void {
  particles.length = 0;
  lastPos.clear();
  if (raf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(raf);
  raf = 0;
}
