// Текущий тариф в шапке: надпись без плашки («Бесплатный», «Pro», «Tutor»), нажатие — окно подписки.
// При наведении в углу появляется крестик «Скрыть»; скрыть и вернуть можно и в меню «Скрыть» (как другие кнопки шапки).
//
// Смена тарифа — превращение надписи (около 3 с): тариф выше — надпись дрожит и набирает свечение, к ней
// стягиваются искры, буквы разлетаются, вспышка и ударная волна, конфетти цветов нового тарифа, новые буквы
// выпрыгивают по одной на пружинах, по надписи пробегает блик, вокруг мерцают звёздочки. Тариф ниже — буквы
// выцветают и осыпаются пылью, новая надпись проявляется из размытия. Пока открыто окно подписки или настроек,
// превращение ждёт их закрытия — его должно быть видно.
//
// Три режима анимаций доски: «Улучшенные» — всё описанное (частицы — Canvas 2D поверх страницы);
// «Обычные» (body.no-motion) — короткая CSS-смена со вспышкой; «Выкл» (body.no-ui-anim) — сразу.
// Текст надписи — из констант (PLAN_TITLES), через textContent.

import { PLAN_TITLES, dateText, planRank } from './billing';
import { CLOSE_ICON, ICONS } from './icons';
import { S, clamp, motionEnabled, reduceMotion, register, step, tune, uiAnimOff, unregister, wake, type MotionComponent, type Spring } from './motion';
import { onPlanChange, userPlan } from './plan';
import { onPlansDialogClose, plansDialogOpen } from './plans-dialog';
import { requestUpgrade } from './pro-badge';
import { settingsDialogOpen } from './settings-dialog';
import { setTopbarGroupHidden } from './topbar-hide';
import { billingState, onBillingChange } from './subscription';
import type { PlanTier } from './types';

export const HIDE_TIER_KEY = 'abax.hideTier';

/** Цвета тарифа: начало и конец градиента надписи, частицы. */
const PALETTE: Record<PlanTier, readonly string[]> = {
  free: ['#8b93a0', '#aeb5c0', '#c3c8d1'],
  pro: ['#7048e8', '#ae3ec9', '#9775fa', '#e599f7', '#ffffff'],
  tutor: ['#f59f00', '#f76707', '#ffd43b', '#ffa94d', '#ffffff'],
};

export function tierHidden(): boolean {
  try { return localStorage.getItem(HIDE_TIER_KEY) === 'true'; } catch { return false; }
}

let ui: { wrap: HTMLElement; btn: HTMLButtonElement; label: HTMLElement; icon: HTMLElement; shown: PlanTier } | null = null;
const hideListeners = new Set<(hidden: boolean) => void>();

/** Скрыть или показать тариф в шапке (крестик, меню «Скрыть»). */
export function setTierHidden(hidden: boolean): void {
  try { localStorage.setItem(HIDE_TIER_KEY, String(hidden)); } catch { /* хранилище недоступно */ }
  if (ui) setTopbarGroupHidden(ui.wrap, hidden, h => document.body.classList.toggle('hide-tier-button', h));
  for (const fn of [...hideListeners]) fn(hidden);
}

export function onTierHiddenChange(fn: (hidden: boolean) => void): () => void {
  hideListeners.add(fn);
  return () => { hideListeners.delete(fn); };
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function tierTitle(plan: PlanTier): string {
  const b = billingState();
  if (plan === 'free') return 'Бесплатный тариф - посмотреть подписку';
  const until = b && b.plan === plan && b.planExpiresAt ? ` до ${dateText(b.planExpiresAt)}` : '';
  return `${b?.trial && b.plan === plan ? 'Пробный период' : 'Тариф'} ${PLAN_TITLES[plan]}${until} - подписка`;
}

function paintStatic(plan: PlanTier): void {
  if (!ui) return;
  ui.shown = plan;
  ui.wrap.dataset.plan = plan;
  ui.label.textContent = PLAN_TITLES[plan];
  ui.label.className = 'tier-label';
  ui.btn.title = tierTitle(plan);
  ui.btn.setAttribute('aria-label', `Тариф: ${PLAN_TITLES[plan]}`);
}

/** Поставить кнопку тарифа в шапку (один раз при запуске). */
export function mountTierButton(): void {
  if (ui) return;
  const side = document.querySelector<HTMLElement>('#topbar .topbar-left');
  if (!side) return;
  const wrap = el('div', 'tier-wrap');
  wrap.id = 'tier-chip';
  const btn = el('button', 'tier-btn');
  btn.id = 'btn-tier';
  btn.type = 'button';
  btn.dataset.tipSide = 'bottom';
  const icon = el('span', 'tier-icon');
  icon.setAttribute('aria-hidden', 'true');
  icon.innerHTML = ICONS.crown; // константа значка
  const label = el('span', 'tier-label');
  btn.append(icon, label);
  const hide = el('button', 'tier-hide');
  hide.type = 'button';
  hide.title = 'Скрыть';
  hide.setAttribute('aria-label', 'Скрыть тариф из шапки');
  hide.innerHTML = CLOSE_ICON; // константа значка
  wrap.append(btn, hide);
  // row-reverse: последний в разметке — левее всех в правой части шапки
  side.appendChild(wrap);
  ui = { wrap, btn, label, icon, shown: userPlan() };
  paintStatic(userPlan());
  document.body.classList.toggle('hide-tier-button', tierHidden());
  btn.addEventListener('click', () => requestUpgrade(null));
  hide.addEventListener('click', e => { e.stopPropagation(); setTierHidden(true); });
  onBillingChange(() => { if (ui && !playing) ui.btn.title = tierTitle(ui.shown); });

  onPlanChange(c => {
    if (c.from === c.to) return;
    queued = c.to;
    tryPlay();
  });
  onPlansDialogClose(() => window.setTimeout(tryPlay, 120));
  document.addEventListener('doska:settings-closed', () => window.setTimeout(tryPlay, 120));
}

let queued: PlanTier | null = null;
let playing = false;

/** Превращение — когда тариф сменился и его видно (окна подписки и настроек закрыты). */
function tryPlay(): void {
  if (!ui || playing || queued === null) return;
  if (plansDialogOpen() || settingsDialogOpen()) return;
  const to = queued;
  queued = null;
  if (to === ui.shown) return;
  playTransition(ui.shown, to);
}

// ----- Превращение -----

interface Particle {
  x: number; y: number; vx: number; vy: number;
  life: number; max: number; size: number; color: string;
  kind: 'spark' | 'confetti' | 'star' | 'dust' | 'twinkle';
  rot: number; vr: number; gravity: number; drag: number;
  /** Искра летит к центру и гаснет у цели. */
  home?: { x: number; y: number };
}

interface Letter { el: HTMLElement; x: number; y: number; vx: number; vy: number; r: number; vr: number; s: Spring; ty: Spring; delay: number; alpha: number }

export const TRANSITION_S = 3;
const DOWN_S = 2.6;

function lerpColor(a: string, b: string, t: number): string {
  const p = (h: string) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  return `rgb(${x.map((v, i) => Math.round(v + (y[i] - v) * t)).join(',')})`;
}

function splitLetters(label: HTMLElement, text: string, plan: PlanTier): HTMLElement[] {
  label.textContent = '';
  const pal = PALETTE[plan];
  const chars = [...text];
  return chars.map((ch, i) => {
    const s = el('span', 'tier-letter', ch === ' ' ? ' ' : ch);
    s.style.color = plan === 'free' ? pal[0] : lerpColor(pal[0], pal[1], chars.length > 1 ? i / (chars.length - 1) : 0);
    label.appendChild(s);
    return s;
  });
}

function playTransition(from: PlanTier, to: PlanTier): void {
  const u = ui!;
  if (uiAnimOff() || reduceMotion() || document.body.classList.contains('hide-tier-button') || !u.btn.offsetWidth) {
    paintStatic(to);
    return;
  }
  if (!motionEnabled()) {
    // «Обычные»: старая надпись гаснет, новая выпрыгивает со вспышкой
    u.wrap.classList.remove('tier-css-swap');
    void u.wrap.offsetWidth;
    paintStatic(to);
    u.wrap.classList.add('tier-css-swap');
    window.setTimeout(() => u.wrap.classList.remove('tier-css-swap'), 900);
    return;
  }
  playing = true;
  const up = planRank(to) > planRank(from);
  const total = up ? TRANSITION_S : DOWN_S;
  u.wrap.classList.add('tier-playing', up ? 'tier-up' : 'tier-down');
  u.wrap.dataset.plan = from;
  const fromText = PLAN_TITLES[from];
  const toText = PLAN_TITLES[to];
  const oldLetters: Letter[] = splitLetters(u.label, fromText, from).map(e => ({ el: e, x: 0, y: 0, vx: 0, vy: 0, r: 0, vr: 0, s: S(1), ty: S(0), delay: 0, alpha: 1 }));
  let newLetters: Letter[] = [];

  // холст частиц на всё окно, над шапкой
  const canvas = el('canvas', 'tier-fx');
  canvas.setAttribute('aria-hidden', 'true');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(window.innerWidth * dpr);
  canvas.height = Math.round(window.innerHeight * dpr);
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  ctx?.scale(dpr, dpr);

  const rect = () => u.label.getBoundingClientRect();
  const center = () => { const r = rect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
  const parts: Particle[] = [];
  const palTo = PALETTE[to];
  const pick = (pal: readonly string[]) => pal[Math.floor(Math.random() * pal.length)];
  const rings: { t: number; max: number; r: number; color: string }[] = [];
  let flash = 0;

  const spawn = (p: Partial<Particle> & Pick<Particle, 'x' | 'y' | 'kind'>): void => {
    parts.push({ vx: 0, vy: 0, life: 1, max: 1, size: 3, color: pick(palTo), rot: Math.random() * 6, vr: 0, gravity: 0, drag: 0, ...p });
  };

  let t = 0;
  let exploded = false, dropped = false, newShown = false, shimmer = false;
  let sparkAcc = 0, twinkleAcc = 0;

  const showNew = (): void => {
    newShown = true;
    u.wrap.dataset.plan = to;
    newLetters = splitLetters(u.label, toText, to).map((e, i) => {
      const s = S(0), ty = S(up ? -12 : 0);
      tune(s, 520, up ? 16 : 30); // --spring-pop
      tune(ty, 420, 26);
      return { el: e, x: 0, y: 0, vx: 0, vy: 0, r: 0, vr: 0, s, ty, delay: i * (up ? 0.07 : 0.045), alpha: 0 };
    });
  };

  const explode = (): void => {
    exploded = true;
    const c = center();
    for (const l of oldLetters) {
      const a = (Math.random() - 0.5) * Math.PI * 1.2 - Math.PI / 2;
      const v = 140 + Math.random() * 180;
      l.vx = Math.cos(a) * v + (Math.random() - 0.5) * 120;
      l.vy = Math.sin(a) * v;
      l.vr = (Math.random() - 0.5) * 1400;
    }
    flash = 1;
    rings.push({ t: 0, max: 0.55, r: 90, color: palTo[0] }, { t: -0.08, max: 0.6, r: 130, color: palTo[1] });
    for (let i = 0; i < 54; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = 160 + Math.random() * 320;
      spawn({
        x: c.x, y: c.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 80, kind: i % 3 === 0 ? 'star' : 'confetti',
        size: 3 + Math.random() * 4, life: 1.1 + Math.random() * 0.8, gravity: 520, drag: 1.6, vr: (Math.random() - 0.5) * 14,
      });
      parts[parts.length - 1].max = parts[parts.length - 1].life;
    }
  };

  const drop = (): void => {
    dropped = true;
    oldLetters.forEach((l, i) => {
      l.delay = i * 0.05;
      l.vx = (Math.random() - 0.5) * 60;
      l.vy = -30 - Math.random() * 40;
      l.vr = (Math.random() - 0.5) * 300;
    });
  };

  const comp = {
    frame(dt: number) {
      t += dt;
      const c = center();
      if (up) {
        // заряд: искры стягиваются к надписи
        if (t < 0.85) {
          sparkAcc += dt * 70;
          while (sparkAcc >= 1) {
            sparkAcc--;
            const a = Math.random() * Math.PI * 2;
            const r = 50 + Math.random() * 40;
            spawn({ x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r * 0.7, kind: 'spark', size: 1.4 + Math.random() * 1.6, life: 0.6, home: c });
          }
        }
        if (!exploded && t >= 0.85) explode();
        if (!newShown && t >= 1.35) showNew();
        if (!shimmer && t >= 2.25) { shimmer = true; u.label.classList.add('tier-shimmer'); }
        if (t >= 2.0 && t < 2.9) {
          twinkleAcc += dt * 14;
          while (twinkleAcc >= 1) {
            twinkleAcc--;
            const r = rect();
            spawn({ x: r.left - 8 + Math.random() * (r.width + 16), y: r.top - 8 + Math.random() * (r.height + 16), kind: 'twinkle', size: 2.5 + Math.random() * 3, life: 0.5, max: 0.5 });
          }
        }
      } else {
        if (!dropped && t >= 0.45) drop();
        if (dropped && t < 1.4) {
          sparkAcc += dt * 40;
          while (sparkAcc >= 1) {
            sparkAcc--;
            const r = rect();
            spawn({
              x: r.left + Math.random() * r.width, y: r.top + r.height * (0.3 + Math.random() * 0.7), kind: 'dust', color: pick(PALETTE.free),
              vx: (Math.random() - 0.5) * 40, vy: 10 + Math.random() * 40, size: 1 + Math.random() * 2, life: 0.9, max: 0.9, gravity: 60, drag: 1,
            });
          }
        }
        if (!newShown && t >= 1.3) showNew();
      }
      // буквы
      for (const l of oldLetters) {
        if (up && exploded) {
          l.vy += 900 * dt; l.x += l.vx * dt; l.y += l.vy * dt; l.r += l.vr * dt; l.alpha = Math.max(0, l.alpha - dt * 1.6);
        } else if (!up && dropped && t - 0.45 >= l.delay) {
          l.vy += 1600 * dt; l.x += l.vx * dt; l.y += l.vy * dt; l.r += l.vr * dt; l.alpha = Math.max(0, l.alpha - dt * 1.3);
        }
      }
      for (const l of newLetters) {
        if (t - (up ? 1.35 : 1.3) < l.delay) continue;
        l.s.t = 1; l.ty.t = 0;
        step(l.s, dt); step(l.ty, dt);
        l.alpha = Math.min(1, l.alpha + dt * (up ? 8 : 3.2));
      }
      // частицы
      for (const p of parts) {
        p.life -= dt;
        if (p.home) {
          const dx = p.home.x - p.x, dy = p.home.y - p.y;
          const d = Math.hypot(dx, dy) || 1;
          const sp = 160 + (0.6 - p.life) * 500;
          p.vx = (dx / d) * sp; p.vy = (dy / d) * sp;
          if (d < 6) p.life = 0;
        } else {
          p.vy += p.gravity * dt;
          const k = Math.max(0, 1 - p.drag * dt);
          p.vx *= k; p.vy *= k;
        }
        p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
      }
      for (let i = parts.length - 1; i >= 0; i--) if (parts[i].life <= 0) parts.splice(i, 1);
      for (const r of rings) r.t += dt;
      flash = Math.max(0, flash - dt * 4);
    },
    render() {
      // заряд: дрожание и свечение
      const charge = up ? clamp(t / 0.85, 0, 1) : 0;
      if (up && !exploded) {
        const a = 2.6 * charge * charge;
        u.label.style.transform = `translate(${(Math.sin(t * 240) * a).toFixed(2)}px, ${(Math.cos(t * 190) * a * 0.5).toFixed(2)}px)`;
        u.wrap.style.setProperty('--tier-glow', charge.toFixed(3));
      } else {
        u.label.style.transform = '';
        u.wrap.style.setProperty('--tier-glow', up ? clamp(1 - (t - 0.85) * 2, 0, 1).toFixed(3) : '0');
      }
      if (!up && !dropped) {
        const g = clamp(t / 0.45, 0, 1);
        oldLetters.forEach((l, i) => { l.el.style.color = lerpColor(i % 2 ? PALETTE[from][1] : PALETTE[from][0], '#b3b9c3', g); });
      }
      if (!newShown) {
        for (const l of oldLetters) {
          l.el.style.transform = `translate(${l.x.toFixed(1)}px, ${l.y.toFixed(1)}px) rotate(${l.r.toFixed(1)}deg)`;
          l.el.style.opacity = l.alpha.toFixed(3);
        }
      } else {
        for (const l of newLetters) {
          const s = Math.max(0, l.s.x);
          l.el.style.transform = `translateY(${l.ty.x.toFixed(2)}px) scale(${s.toFixed(4)})`;
          l.el.style.opacity = l.alpha.toFixed(3);
          if (!up) l.el.style.filter = `blur(${((1 - l.alpha) * 6).toFixed(2)}px)`;
        }
        // старые буквы ещё долетают — поверх, на холсте их уже нет: просто гаснут вместе с частицами
      }
      if (!ctx) return;
      ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
      const c = center();
      if (flash > 0) {
        const g = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, 46);
        g.addColorStop(0, `rgba(255,255,255,${(0.95 * flash).toFixed(3)})`);
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(c.x, c.y, 46, 0, Math.PI * 2); ctx.fill();
      }
      for (const r of rings) {
        if (r.t < 0 || r.t > r.max) continue;
        const k = r.t / r.max;
        ctx.globalAlpha = 1 - k;
        ctx.strokeStyle = r.color;
        ctx.lineWidth = 6 * (1 - k) + 1;
        ctx.beginPath(); ctx.ellipse(c.x, c.y, r.r * k, r.r * k * 0.62, 0, 0, Math.PI * 2); ctx.stroke();
      }
      for (const p of parts) {
        const a = p.kind === 'twinkle' ? Math.sin(clamp(p.life / p.max, 0, 1) * Math.PI) : clamp(p.life / p.max, 0, 1);
        ctx.globalAlpha = a;
        ctx.fillStyle = p.color;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        if (p.kind === 'confetti') ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        else if (p.kind === 'star' || p.kind === 'twinkle') starPath(ctx, p.size);
        else { ctx.beginPath(); ctx.arc(0, 0, p.size, 0, Math.PI * 2); ctx.fill(); }
        ctx.restore();
      }
      ctx.globalAlpha = 1;
    },
    settled: () => t >= total && parts.length === 0,
  };
  // окончание: всё на место
  const finish = () => {
    playing = false;
    unregister(loop);
    canvas.remove();
    u.wrap.classList.remove('tier-playing', 'tier-up', 'tier-down');
    u.wrap.style.removeProperty('--tier-glow');
    u.label.style.transform = '';
    paintStatic(to);
    // блик ещё допробегает по готовой надписи
    if (up) {
      u.label.classList.add('tier-shimmer');
      window.setTimeout(() => u.label.classList.remove('tier-shimmer'), 900);
    }
    tryPlay();
  };
  const loop: MotionComponent = {
    frame: dt => { if (playing) comp.frame(dt); },
    render: () => {
      if (!playing) return;
      comp.render();
      if (comp.settled()) finish();
    },
    settled: () => !playing,
  };
  register(loop);
  wake();
}

function starPath(ctx: CanvasRenderingContext2D, r: number): void {
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const rr = i % 2 === 0 ? r : r * 0.38;
    ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fill();
}
