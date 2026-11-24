import { S, clamp, motionEnabled, reduceMotion, register, step, uiAnimOff, wake, type Spring } from './motion';
interface Control { el: HTMLElement; buttons: HTMLButtonElement[]; highlight: HTMLElement; spring: Spring }
const moving = new Set<Control>();
register({
  frame(dt) { for (const control of moving) step(control.spring, dt); },
  render() {
    for (const control of moving) {
      const s = control.spring;
      if (!control.el.isConnected || (Math.abs(s.x - s.t) < .01 && Math.abs(s.v) < .01)) {
        s.x = s.t; s.v = 0; moving.delete(control);
      }
      paint(control);
    }
  },
  settled: () => moving.size === 0,
});

function paint(control: Control): void {
  const speed = clamp(Math.abs(control.spring.v) / 1400, 0, .22);
  control.highlight.style.transform = `translateX(${control.spring.x}px) scale(${1 + speed}, ${1 - speed * .5})`;
}

export function createTutorSegments<T extends string>(options: readonly (readonly [T, string])[], value: T, label: string, change: (value: T) => void) {
  const el = document.createElement('div');
  el.className = 'tu-segments tu-calendar-segments';
  el.setAttribute('role', 'radiogroup');
  el.setAttribute('aria-label', label);
  const highlight = document.createElement('span');
  highlight.className = 'tu-calendar-highlight';
  highlight.setAttribute('aria-hidden', 'true');
  const buttons = options.map(([id, label]) => {
    const button = document.createElement('button');
    button.type = 'button'; button.textContent = label; button.setAttribute('role', 'radio');
    button.addEventListener('click', () => select(id, true));
    return button;
  });
  el.append(highlight, ...buttons);
  const control: Control = { el, buttons, highlight, spring: S(0, 300, 20) };
  let current = value;
  function position(animate: boolean): void {
    const button = buttons[options.findIndex(([id]) => id === current)];
    control.spring.t = button.offsetLeft;
    highlight.style.width = `${button.offsetWidth}px`;
    const animated = animate && !uiAnimOff() && !reduceMotion();
    el.classList.toggle('tu-calendar-segments-css', animated && !motionEnabled());
    if (animated && motionEnabled()) { moving.add(control); wake(); }
    else { moving.delete(control); control.spring.x = control.spring.t; control.spring.v = 0; paint(control); }
  }
  function select(next: T, user: boolean): void {
    const changed = current !== next;
    current = next;
    buttons.forEach((button, i) => {
      const selected = options[i][0] === current;
      button.setAttribute('aria-checked', String(selected));
      button.tabIndex = selected ? 0 : -1;
    });
    position(user && changed);
    if (user && changed) {
      const focused = buttons.includes(document.activeElement as HTMLButtonElement);
      change(next);
      if (focused) buttons[options.findIndex(([id]) => id === next)].focus({ preventScroll: true });
    }
  }
  el.addEventListener('keydown', event => {
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    const next = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? (i + 1) % buttons.length
      : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? (i + buttons.length - 1) % buttons.length
        : event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : -1;
    if (next < 0) return;
    event.preventDefault(); buttons[next].focus(); select(options[next][0], true);
  });
  select(value, false);
  if (typeof ResizeObserver === 'function') new ResizeObserver(() => position(false)).observe(el);
  return { el, sync(next: T) { if (next !== current) select(next, false); else if (!moving.has(control)) position(false); } };
}
