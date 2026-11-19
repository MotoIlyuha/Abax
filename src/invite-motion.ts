// Движение формы приглашения (по мотивам «Invite people» с designbookmark.com/motion, invite.js).
// - Неверный адрес: поле «мотает головой» (пружина 700/12, толчок 420) и краснеет.
// - Отправлено: адрес уходит из поля «пилюлей», сужается в кружок, пока слова размываются, в кружке
//   появляется значок человека, и он по дуге перелетает в новую строку списка доступа (0–0.3 с — пилюля,
//   0.3–0.95 с — дуга), приземляется с лёгким сжатием (пружина 520/16) и становится настоящим значком строки.
// Время — по часам анимации, как в образце; текст пилюли — только textContent.
//
// Три режима анимаций доски: «Улучшенные» — всё выше; «Обычные» (body.no-motion) — новая строка проявляется
// CSS-анимацией, поле с ошибкой коротко вздрагивает CSS; «Выкл» (body.no-ui-anim) — без движения.

import { S, clamp, motionEnabled, reduceMotion, register, step, tune, uiAnimOff, wake, type Spring } from './motion';

const POP: readonly [number, number] = [520, 16];

interface Shake { el: HTMLElement; s: Spring }
interface Flyer {
  el: HTMLElement;
  tx: HTMLElement;
  av: HTMLElement;
  t: number;
  x0: number; y0: number; w0: number; d: number;
  target: HTMLElement;
  land: () => void;
}
interface Landing { el: HTMLElement; k: Spring }

const shakes = new Set<Shake>();
const flyers = new Set<Flyer>();
const landings = new Set<Landing>();
let registered = false;

const io = (u: number): number => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);
const out = (u: number): number => 1 - Math.pow(1 - u, 3);

function ensureLoop(): void {
  if (registered) return;
  registered = true;
  register({
    frame(dt) {
      for (const s of shakes) step(s.s, dt);
      for (const f of flyers) f.t += dt;
      for (const l of landings) step(l.k, dt);
    },
    render() {
      for (const s of [...shakes]) {
        if (!s.el.isConnected || (Math.abs(s.s.x) < 0.05 && Math.abs(s.s.v) < 0.5)) {
          s.el.style.removeProperty('translate');
          shakes.delete(s);
        } else s.el.style.translate = `${(s.s.x * 0.5).toFixed(2)}px 0`;
      }
      for (const f of [...flyers]) renderFlyer(f);
      for (const l of [...landings]) {
        if (!l.el.isConnected || (Math.abs(l.k.x - 1) < 0.002 && Math.abs(l.k.v) < 0.02)) {
          l.el.style.removeProperty('scale');
          landings.delete(l);
        } else l.el.style.scale = Math.max(0, l.k.x).toFixed(3);
      }
    },
    settled: () => shakes.size === 0 && flyers.size === 0 && landings.size === 0,
  });
}

/** Поле с неверным адресом: качнуть и подсветить красным (класс is-bad на 0.9 с). */
export function shakeField(el: HTMLElement): void {
  el.classList.add('is-bad');
  window.setTimeout(() => el.classList.remove('is-bad'), 900);
  if (uiAnimOff() || reduceMotion()) return;
  if (!motionEnabled()) {
    el.classList.remove('is-shaking');
    void el.offsetWidth;
    el.classList.add('is-shaking');
    window.setTimeout(() => el.classList.remove('is-shaking'), 400);
    return;
  }
  let s = [...shakes].find(x => x.el === el);
  if (!s) {
    s = { el, s: S(0) };
    tune(s.s, 700, 12);
    shakes.add(s);
  }
  s.s.v += 420;
  ensureLoop();
  wake();
}

function renderFlyer(f: Flyer): void {
  if (!f.target.isConnected || !f.el.isConnected) { finishFlyer(f); return; }
  const r = f.target.getBoundingClientRect();
  const x1 = r.left + (r.width - f.d) / 2;
  const y1 = r.top + (r.height - f.d) / 2;
  const a = clamp(f.t / 0.3, 0, 1);
  const ea = out(a);
  const u = io(clamp((f.t - 0.3) / 0.65, 0, 1));
  const w = f.w0 + (f.d - f.w0) * io(a);
  const arc = Math.sin(u * Math.PI);
  const x = f.x0 + (x1 - f.x0) * u;
  const y = f.y0 - ea * 4 + (y1 - f.y0 + 4) * u - arc * 42;
  f.el.style.width = `${w.toFixed(1)}px`;
  f.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) scale(${(1 + arc * 0.1).toFixed(3)})`;
  const tv = clamp(1 - a * 1.8, 0, 1);
  f.tx.style.opacity = tv.toFixed(3);
  f.tx.style.filter = tv > 0.98 ? '' : `blur(${((1 - tv) * 3).toFixed(2)}px)`;
  const p = clamp((f.t - 0.22) / 0.25, 0, 1);
  const pop = p <= 0 ? 0 : 1 + Math.sin(p * Math.PI) * 0.18 * (1 - p) - (1 - p) * (1 - p);
  f.av.style.transform = `scale(${Math.max(0, pop).toFixed(3)})`;
  if (f.t >= 0.95) finishFlyer(f);
}

function finishFlyer(f: Flyer): void {
  if (!flyers.has(f)) return;
  flyers.delete(f);
  f.el.remove();
  f.land();
}

/**
 * Адрес улетает из поля field в значок target (строка уже в списке, её значок и текст скрыты).
 * reveal — показать строку (вызывается при приземлении или сразу, если анимации нет).
 * host — куда положить летящую пилюлю (окно; она стоит position: fixed).
 */
export function flyInvite(field: HTMLElement, text: string, target: HTMLElement, host: HTMLElement, reveal: () => void): void {
  if (uiAnimOff() || reduceMotion() || !motionEnabled()) { reveal(); return; }
  const fr = field.getBoundingClientRect();
  const tr = target.getBoundingClientRect();
  const d = tr.width || 28;
  if (fr.width <= 0 || tr.width <= 0) { reveal(); return; }
  const el = document.createElement('div');
  el.className = 'inv-fly';
  el.setAttribute('aria-hidden', 'true');
  el.style.height = `${d}px`;
  const tx = document.createElement('span');
  tx.className = 'inv-fly-text';
  tx.textContent = text;
  const av = document.createElement('span');
  av.className = 'inv-fly-av';
  av.textContent = (text.trim()[0] ?? '?').toUpperCase();
  av.style.transform = 'scale(0)';
  el.append(tx, av);
  host.append(el);
  const tw = tx.offsetWidth;
  const f: Flyer = {
    el, tx, av, t: 0, d, target,
    x0: fr.left + 4, y0: fr.top + (fr.height - d) / 2, w0: Math.max(d, Math.min(fr.width - 8, tw + 24)),
    land: () => {
      reveal();
      // настоящий значок: приземление со сжатием
      const k = S(0.82);
      tune(k, ...POP);
      k.t = 1;
      target.style.scale = '0.82';
      landings.add({ el: target, k });
      ensureLoop();
      wake();
    },
  };
  flyers.add(f);
  renderFlyer(f);
  ensureLoop();
  wake();
}
