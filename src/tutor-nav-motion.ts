import { S, atRest, clamp, motionEnabled, reduceMotion, register, snap, step, wake } from './motion';

/** Анимация мобильной навигации по мотивам Bottom Bar из DesignBookmark. */
export function mountTutorNavMotion(nav: HTMLElement): () => void {
  const highlight = document.createElement('span');
  highlight.className = 'tu-nav-highlight';
  highlight.setAttribute('aria-hidden', 'true');
  nav.prepend(highlight);
  const tabs = Array.from(nav.querySelectorAll<HTMLButtonElement>('button')).map((button) => ({
    button,
    label: button.querySelector<HTMLElement>('.tu-nav-label')!,
    icon: button.querySelector<HTMLElement>('.tu-glyph')!,
    width: S(0, 300, 26),
    pop: S(1, 520, 14),
    full: 0,
  }));
  const x = S(0, 340, 28), width = S(0, 340, 28);
  let selected = -1;
  let initialized = false;
  let previous = -1;

  const render = () => {
    for (const tab of tabs) {
      const w = Math.max(0, tab.width.x);
      tab.label.style.setProperty('--tu-label-width', `${w}px`);
      tab.label.style.setProperty('--tu-label-opacity', String(tab.full ? clamp(w / tab.full * 1.4 - .4, 0, 1) : 0));
      tab.icon.style.setProperty('--tu-icon-scale', String(tab.pop.x));
    }
    highlight.style.transform = `translateX(${x.x}px)`;
    highlight.style.width = `${Math.max(0, width.x)}px`;
  };
  const component = {
    frame(dt: number) {
      for (const tab of tabs) { step(tab.width, dt); step(tab.pop, dt); }
      if (selected >= 0) {
        x.t = tabs[selected].button.offsetLeft;
        width.t = tabs[selected].button.offsetWidth;
      }
      step(x, dt); step(width, dt);
    },
    render,
    settled: () => tabs.every((tab) => atRest(tab.width) && atRest(tab.pop)) && atRest(x) && atRest(width),
  };
  register(component);

  const update = () => {
    selected = tabs.findIndex((tab) => tab.button.getAttribute('aria-current') === 'page');
    highlight.hidden = selected < 0;
    for (const [index, tab] of tabs.entries()) {
      const currentWidth = tab.label.style.getPropertyValue('--tu-label-width');
      tab.label.style.setProperty('--tu-label-width', '0px');
      tab.full = tab.label.scrollWidth;
      tab.label.style.setProperty('--tu-label-width', currentWidth);
      tab.width.t = index === selected ? tab.full : 0;
    }
    const animate = initialized && motionEnabled() && !reduceMotion() && matchMedia('(max-width: 640px)').matches;
    if (animate && selected >= 0 && selected !== previous) {
      tabs[selected].pop.x = .72;
      tabs[selected].pop.v = 6;
    }
    if (!animate) {
      tabs.forEach((tab) => { snap(tab.width); snap(tab.pop); });
      render();
      if (selected >= 0) {
        x.t = tabs[selected].button.offsetLeft;
        width.t = tabs[selected].button.offsetWidth;
        snap(x); snap(width);
      }
      render();
    } else wake();
    previous = selected;
    initialized = true;
  };
  window.addEventListener('resize', () => { initialized = false; update(); });
  return update;
}
