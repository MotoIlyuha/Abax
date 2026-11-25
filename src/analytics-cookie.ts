// Анимация адаптирована из Cookie Bite от DesignBookmark.
import { atRest, clamp, S, step } from './motion';

const ns = 'http://www.w3.org/2000/svg';
const svg = (name: string, attrs: Record<string, string | number> = {}) => {
  const el = document.createElementNS(ns, name);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value));
  return el;
};

type Bite = { spring: ReturnType<typeof S>; circles: SVGElement[]; sizes: number[]; x: number; y: number };
const biteMap = new WeakMap<HTMLElement, Bite[]>();

export function createAnalyticsCookie(): HTMLElement {
  const plate = document.createElement('div');
  plate.className = 'analytics-cookie-plate';
  plate.setAttribute('aria-hidden', 'true');
  const image = svg('svg', { viewBox: '0 0 64 64', class: 'analytics-cookie-svg' });
  const defs = svg('defs');
  const mask = svg('mask', { id: 'analytics-cookie-mask', maskUnits: 'userSpaceOnUse', x: -8, y: -8, width: 80, height: 80 });
  mask.append(svg('rect', { x: -8, y: -8, width: 80, height: 80, fill: 'white' }));
  const bites: Bite[] = [-42, 28, 196].map(angle => {
    const a = angle * Math.PI / 180, x = 32 + Math.cos(a) * 30, y = 32 + Math.sin(a) * 30;
    const parts = [[x, y, 13], ...[-52, 0, 52].map(t => {
      const q = a + Math.PI + t * Math.PI / 180;
      return [x + Math.cos(q) * 11.5, y + Math.sin(q) * 11.5, 5.2];
    })];
    const circles = parts.map(([cx, cy]) => svg('circle', { cx, cy, r: 0, fill: 'black' }));
    mask.append(...circles);
    return { spring: S(0, 700, 22), circles, sizes: parts.map(p => p[2]), x, y };
  });
  defs.append(mask); image.append(defs);
  const shape = svg('g', { mask: 'url(#analytics-cookie-mask)' });
  shape.append(svg('circle', { cx: 32, cy: 32, r: 30, fill: '#b87a20' }));
  shape.append(svg('circle', { cx: 32, cy: 30.5, r: 28.5, fill: '#efb84d' }));
  for (const [cx, cy, r] of [[22,19,4.4],[41,16,3.3],[46,31,4.2],[30,34,3.5],[17,38,3.1],[38,48,4.4],[24,51,2.7]]) {
    shape.append(svg('circle', { cx, cy, r, fill: '#82501f' }));
  }
  image.append(shape); plate.append(image); biteMap.set(plate, bites);
  return plate;
}

export function animateAnalyticsChoice(card: HTMLElement, plate: HTMLElement, accepted: boolean): void {
  const image = plate.querySelector<SVGSVGElement>('svg')!;
  const bites = biteMap.get(plate)!;
  const scale = S(1, 520, 16), rotation = S(0, 190, 9), width = S(card.offsetWidth, 260, 24), height = S(card.offsetHeight, 230, 22), morph = S(0, 260, 24), tick = S(0, 160, 20);
  const initialWidth = width.x;
  const done = document.createElement('div');
  done.className = 'analytics-done';
  done.setAttribute('role', 'status');
  const check = svg('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true' });
  const path = svg('path', { d: 'M6 12.5l4 4 8-9', pathLength: 1 });
  check.append(path);
  const label = document.createElement('span');
  label.textContent = accepted ? 'Аналитика разрешена' : 'Аналитика отключена';
  done.append(check, label); card.append(done);
  const parts = Array.from(card.children).filter(el => el !== done) as HTMLElement[];
  const crumbs = Array.from({ length: 18 }, () => {
    const el = document.createElement('i'); el.className = 'analytics-crumb'; plate.append(el);
    return { el, life: 0, x: 0, y: 0, vx: 0, vy: 0, angle: 0, spin: 0 };
  });
  const exit = S(0, 420, 30);
  const help = document.getElementById('btn-help');
  let leaving = false, dx = 0, dy = 0;
  let crumbIndex = 0, time = 0, last = 0, stage = 0, flickX = 0, flickY = 0, vx = -60, vy = 0;
  function spray(x: number, y: number, count: number, power: number) {
    for (let i = 0; i < count; i++) {
      const c = crumbs[crumbIndex++ % crumbs.length], a = Math.random() * Math.PI * 2;
      c.life = .75 + Math.random() * .35; c.x = x; c.y = y;
      c.vx = Math.cos(a) * power * (.4 + Math.random()); c.vy = -Math.abs(Math.sin(a)) * power * (.6 + Math.random()) - 40;
      c.angle = 0; c.spin = (Math.random() - .5) * 900;
    }
  }
  function frame(now: number) {
    if (!card.isConnected) return;
    const dt = last ? Math.min((now - last) / 1000, 1 / 30) : 1 / 60; last = now; time += dt;
    if (accepted) {
      while (stage < 3 && time >= .1 + stage * .27) {
        const b = bites[stage]; b.spring.t = 1; rotation.v += (stage % 2 ? -1 : 1) * 520; scale.x = .86; spray(b.x, b.y, 5, 150); stage++;
      }
      if (stage === 3 && time >= .91) { scale.k = 600; scale.c = 34; scale.t = 0; spray(32, 32, 6, 110); stage++; }
    } else {
      vx -= 620 * dt; flickX += vx * dt;
      if (flickX < -46) { vy += 1500 * dt; flickY += vy * dt; }
    }
    const foldTime = accepted ? 1.2 : .8;
    if (time >= foldTime && morph.t === 0) {
      morph.t = 1; width.t = Math.min(initialWidth, done.offsetWidth + 28); height.t = 44;
      card.style.overflow = 'hidden';
    }
    if (time >= foldTime + .28) tick.t = 1;
    if (time >= foldTime + 1.25 && !leaving) {
      leaving = true;
      const from = card.getBoundingClientRect(), to = help?.getBoundingClientRect();
      if (to) {
        dx = to.left + to.width / 2 - (from.left + from.width / 2);
        dy = to.top + to.height / 2 - (from.top + from.height / 2);
        help?.parentElement?.classList.add('analytics-arriving');
      }
      card.style.transformOrigin = 'center';
      exit.t = 1;
    }
    for (let i = 0; i < 4; i++) {
      [scale, rotation, width, height, morph, tick, exit, ...bites.map(b => b.spring)].forEach(s => step(s, dt / 4));
    }
    bites.forEach(b => b.circles.forEach((c, i) => c.setAttribute('r', String(Math.max(0, b.spring.x) * b.sizes[i]))));
    image.style.transform = `translate(${flickX}px, ${flickY}px) rotate(${rotation.x * .012 + flickX / 28}rad) scale(${Math.max(0, scale.x)})`;
    for (const c of crumbs) {
      if (c.life > 0) { c.life -= dt; c.vy += 900 * dt; c.x += c.vx * dt; c.y += c.vy * dt; c.angle += c.spin * dt; }
      c.el.style.opacity = String(clamp(c.life * 3, 0, 1));
      c.el.style.transform = `translate(${c.x}px, ${c.y}px) rotate(${c.angle}deg)`;
    }
    const m = clamp(morph.x, 0, 1);
    card.style.width = `${width.x}px`; card.style.height = `${height.x}px`; card.style.boxSizing = 'border-box';
    for (const part of parts) part.style.opacity = String(clamp(1 - m * 2.2, 0, 1));
    done.style.opacity = String(clamp(m * 2.2 - 1.2, 0, 1));
    path.style.strokeDashoffset = String(1 - clamp(tick.x, 0, 1));
    if (leaving) {
      const p = clamp(exit.x, 0, 1);
      card.style.transform = `translate(${dx * p}px, ${dy * p}px) scale(${1 - p})`;
      card.style.opacity = String(1 - p);
      if (atRest(exit, .01)) {
        card.remove();
        if (help?.isConnected) bounceHelp(help);
        else help?.parentElement?.classList.remove('analytics-arriving');
        return;
      }
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

// Упругий отклик начинается, когда свёрнутая плашка достигает кнопки.
function bounceHelp(button: HTMLElement): void {
  const spring = S(1, 520, 16);
  spring.x = .82;
  const oldScale = button.style.scale;
  let last = 0;
  const frame = (now: number) => {
    if (!button.isConnected) return;
    const dt = last ? Math.min((now - last) / 1000, 1 / 30) : 1 / 60;
    last = now;
    for (let i = 0; i < 4; i++) step(spring, dt / 4);
    button.style.scale = String(spring.x);
    if (atRest(spring, .01)) {
      button.style.scale = oldScale;
      button.parentElement?.classList.remove('analytics-arriving');
    } else requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
