// Спойлер: <details> с плавным раскрытием (например, «Без облака» в окне «Поделиться»).
// Три режима анимаций доски:
// - «Улучшенные» — высота содержимого на пружине --spring-soft (260/24, «крупные сдвиги и смена размера»),
//   содержимое проявляется; закрытие — обратно, details закрывается, когда высота доехала до нуля;
// - «Обычные» (body.no-motion) — CSS-переход высоты;
// - «Выкл» (body.no-ui-anim) и «уменьшить движение» — сразу.

import { S, clamp, motionEnabled, reduceMotion, register, spring, step, tune, uiAnimOff, wake, type Spring } from './motion';

const SOFT: readonly [number, number] = [260, 24];

interface Inst { details: HTMLDetailsElement; body: HTMLElement; H: Spring; opening: boolean }
const moving = new Set<Inst>();
let registered = false;

function ensureLoop(): void {
  if (registered) return;
  registered = true;
  register({
    frame(dt) { for (const it of moving) step(it.H, dt); },
    render() {
      for (const it of [...moving]) {
        const done = !it.details.isConnected || (Math.abs(it.H.x - it.H.t) < 0.5 && Math.abs(it.H.v) < 5);
        if (done) { moving.delete(it); finish(it); continue; }
        const h = Math.max(0, it.H.x);
        it.body.style.height = `${h.toFixed(2)}px`;
        it.body.style.opacity = clamp(it.H.t > 0 ? h / it.H.t : h / Math.max(1, it.body.scrollHeight), 0, 1).toFixed(3);
      }
    },
    settled: () => moving.size === 0,
  });
}

function finish(it: Inst): void {
  for (const k of ['height', 'opacity', 'overflow', 'transition']) it.body.style.removeProperty(k);
  if (!it.opening) it.details.open = false;
  it.details.classList.remove('spoiler-closing');
}

export interface SpoilerOptions {
  className: string;
  summary: string;
  title?: string;
  content: HTMLElement;
  onToggle?: (open: boolean) => void;
}

/** <details class="spoiler …"><summary>текст + шеврон</summary><div class="spoiler-body">содержимое</div></details> */
export function createSpoiler(o: SpoilerOptions): HTMLDetailsElement {
  const details = document.createElement('details');
  details.className = `spoiler ${o.className}`;
  const summary = document.createElement('summary');
  const text = document.createElement('span');
  text.className = 'spoiler-text';
  text.textContent = o.summary;
  const chev = document.createElement('span');
  chev.className = 'spoiler-chev';
  chev.setAttribute('aria-hidden', 'true');
  chev.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>'; // константа
  summary.append(text, chev);
  if (o.title) summary.title = o.title;
  const body = document.createElement('div');
  body.className = 'spoiler-body';
  body.append(o.content);
  details.append(summary, body);
  const it: Inst = { details, body, H: S(0, ...SOFT), opening: false };

  summary.addEventListener('click', e => {
    e.preventDefault();
    const open = !(details.open && !details.classList.contains('spoiler-closing'));
    // высота сейчас: у закрытого — ноль, у едущего — его инлайн-высота
    const from = details.open ? body.offsetHeight : 0;
    it.opening = open;
    if (open) { details.open = true; details.classList.remove('spoiler-closing'); }
    else details.classList.add('spoiler-closing');
    details.classList.toggle('spoiler-on', open);
    o.onToggle?.(open);
    const off = uiAnimOff() || reduceMotion();
    if (off) { moving.delete(it); finish(it); return; }
    // естественная высота содержимого
    body.style.removeProperty('height');
    const to = open ? body.scrollHeight : 0;
    if (!motionEnabled()) {
      body.style.overflow = 'hidden';
      body.style.height = `${from}px`;
      void body.offsetHeight;
      body.style.transition = 'height 0.2s cubic-bezier(0.22, 0.8, 0.24, 1), opacity 0.2s';
      body.style.height = `${to}px`;
      body.style.opacity = open ? '1' : '0';
      window.setTimeout(() => { if (it.opening === open) finish(it); }, 220);
      return;
    }
    if (!moving.has(it)) { it.H.x = from; it.H.v = 0; }
    it.H.t = to;
    tune(it.H, ...spring('--spring-soft', SOFT));
    body.style.overflow = 'hidden';
    body.style.height = `${it.H.x}px`;
    moving.add(it);
    ensureLoop();
    wake();
  });
  return details;
}
