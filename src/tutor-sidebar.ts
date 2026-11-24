import { S, atRest, clamp, motionEnabled, reduceMotion, register, snap, step, uiAnimOff, wake } from './motion';

/** Боковая панель по мотивам Sidebar collapse из DesignBookmark. */
export function mountTutorSidebar(root: HTMLElement, rail: HTMLElement, nav: HTMLElement, toggle: HTMLButtonElement, logo: HTMLElement): () => void {
  const highlight = document.createElement('span');
  highlight.className = 'tu-sidebar-highlight';
  highlight.setAttribute('aria-hidden', 'true');
  nav.prepend(highlight);
  const buttons = Array.from(nav.querySelectorAll<HTMLButtonElement>('button'));
  const labels = Array.from(rail.querySelectorAll<HTMLElement>('.tu-sidebar-label, .tu-nav-label'))
    .map(el => ({ el, spring: S(1, 300, 26), delay: 0 }));
  const width = S(212, 260, 24), rotation = S(0, 300, 22), y = S(0, 380, 28);
  let open = true, initialized = false;

  const paint = () => {
    root.style.setProperty('--tu-sidebar-width', `${width.x}px`);
    const r = clamp(rotation.x, 0, 1);
    toggle.style.setProperty('--tu-sidebar-rotation', `${180 * r}deg`);
    logo.style.setProperty('--tu-sidebar-logo-opacity', String(clamp(1 - r * 2, 0, 1)));
    labels.forEach(({ el, spring }) => {
      const opacity = clamp(spring.x, 0, 1);
      el.style.setProperty('--tu-sidebar-label-opacity', String(opacity));
      el.style.setProperty('--tu-sidebar-label-x', `${(1 - opacity) * -10}px`);
    });
    highlight.style.setProperty('--tu-sidebar-y', `${y.x}px`);
  };
  register({
    frame(dt) {
      step(width, dt); step(rotation, dt); step(y, dt);
      for (const label of labels) {
        if (label.delay > 0) {
          label.delay -= dt;
          if (label.delay <= 0 && open) label.spring.t = 1;
        }
        step(label.spring, dt);
      }
    },
    render: paint,
    settled: () => atRest(width) && atRest(rotation) && atRest(y) && labels.every(l => l.delay <= 0 && atRest(l.spring)),
  });
  const wide = () => matchMedia('(min-width: 641px)').matches;
  const expandedWidth = () => matchMedia('(max-width: 880px)').matches ? 162 : 212;
  const animate = () => motionEnabled() && !uiAnimOff() && !reduceMotion() && wide();
  function update(): void {
    const selected = buttons.find(button => button.getAttribute('aria-current') === 'page');
    highlight.hidden = !selected;
    if (selected) {
      y.t = selected.offsetTop;
      highlight.style.height = `${selected.offsetHeight}px`;
    }
    if (!initialized || !animate()) { snap(y); paint(); } else wake();
    initialized = true;
  }
  function setOpen(value: boolean): void {
    open = value;
    root.classList.toggle('tu-sidebar-closed', !open);
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Свернуть боковую панель' : 'Развернуть боковую панель');
    toggle.title = open ? 'Свернуть боковую панель' : 'Развернуть боковую панель';
    width.t = open ? expandedWidth() : 64;
    rotation.t = open ? 0 : 1;
    const animated = animate();
    root.classList.toggle('tu-sidebar-css', !animated && !uiAnimOff() && !reduceMotion());
    labels.forEach((label, index) => {
      label.delay = animated && open ? .06 + index * .04 : 0;
      if (!open || !animated) label.spring.t = open ? 1 : 0;
    });
    if (animated) wake();
    else { snap(width); snap(rotation); labels.forEach(l => snap(l.spring)); paint(); }
  }
  toggle.addEventListener('click', () => setOpen(!open));
  window.addEventListener('resize', () => {
    width.t = open ? expandedWidth() : 64;
    snap(width);
    update();
    paint();
  });
  setOpen(true);
  return update;
}
