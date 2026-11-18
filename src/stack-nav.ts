// Страницы внутри окна (по мотивам «Stack panel» от Kokonut UI, MIT; designbookmark.com/motion#stack-panel).
// Пункт открывает свою страницу справа, а его подпись взлетает в заголовок; «назад», Esc или свайп вправо
// возвращают. Нижняя страница сдвигается на треть пути (параллакс 0.3) и чуть темнеет, высота окна
// следует за верхней страницей. Пружины пересчитаны из параметров образца (motion: duration/bounce → k/c):
// вход 0.42 с без отскока → 483/44, «назад» 0.34 с → 738/54, высота 0.38 с → 590/49.
// Высота окна плавно следует и за содержимым страницы (появилась ссылка, добавилось приглашение).
//
// Три режима анимаций доски:
// - «Улучшенные» — всё выше на пружинах; свайп вправо (палец или перо) уводит страницу назад;
// - «Обычные» (body.no-motion) — новая страница проявляется, высота меняется CSS-переходом;
// - «Выкл» (body.no-ui-anim) и «уменьшить движение» — страницы меняются сразу.

import { S, clamp, motionEnabled, reduceMotion, register, step, tune, uiAnimOff, unregister, wake, type Spring } from './motion';

const PUSH: readonly [number, number] = [483, 44];
const POP: readonly [number, number] = [738, 54];
const HEIGHT: readonly [number, number] = [590, 49];
const PARALLAX = 0.3;
const SHADE = 0.06;
const POP_DISTANCE = 0.35;
const POP_VELOCITY = 500; // px/с
const AXIS_LOCK = 6;
const EASE_OUT = 'cubic-bezier(0.23, 1, 0.32, 1)';

type Mode = 'off' | 'normal' | 'enhanced';
const modeNow = (): Mode => (uiAnimOff() || reduceMotion() ? 'off' : motionEnabled() ? 'enhanced' : 'normal');

export interface StackLevel {
  page: HTMLElement;
  title: HTMLElement;
  /** Пункт, который открыл страницу: на него возвращается фокус после «назад». */
  opener: HTMLElement | null;
}

export interface StackNavOptions {
  /** Окно: его высоту ведёт анимация. */
  dialog: HTMLElement;
  /** Контейнер страниц. */
  view: HTMLElement;
  /** Место заголовка в шапке. */
  titles: HTMLElement;
  /** Кнопка «назад» (видна на вложенных страницах). */
  back: HTMLElement;
  root: StackLevel;
  /** Сменилась верхняя страница (после push/pop, ещё до конца анимации). */
  onChange?: (top: StackLevel) => void;
}

export interface StackNav {
  readonly depth: number;
  readonly busy: boolean;
  top(): StackLevel;
  /** Открыть страницу. origin — подпись пункта: из неё заголовок взлетает в шапку. */
  push(level: StackLevel, origin?: HTMLElement | null): void;
  pop(): void;
  /** Высота окна плавно доезжает до содержимого (вызывать после изменений, которых не видит наблюдатель). */
  follow(): void;
  destroy(): void;
}

interface Nav {
  dir: 1 | -1;
  top: HTMLElement;
  under: HTMLElement;
  shade: HTMLElement;
  W: number;
  X: Spring;
  T: Spring | null;
  fly: { el: HTMLElement; dx: number; dy: number; scale: number } | null;
  done: () => void;
}

export function createStackNav(o: StackNavOptions): StackNav {
  const stack: StackLevel[] = [o.root];
  const H = S(0, ...HEIGHT);
  let nav: Nav | null = null;
  let sizing = false;   // высота едет за содержимым
  let cssTimer = 0;
  let drag: { id: number; x0: number; y0: number; axis: 'x' | 'y' | null; samples: { x: number; t: number }[]; W: number } | null = null;
  let lastH = 0;

  const comp = {
    frame(dt: number) {
      if (nav) { step(nav.X, dt); if (nav.T) step(nav.T, dt); }
      if (nav || sizing) step(H, dt);
    },
    render() {
      if (!o.dialog.isConnected) { nav = null; sizing = false; return; }
      if (nav || sizing) o.dialog.style.height = `${Math.max(0, H.x).toFixed(2)}px`;
      if (nav) {
        const n = nav;
        const x = n.X.x;
        n.top.style.transform = `translateX(${x.toFixed(2)}px)`;
        n.under.style.transform = `translateX(${(-PARALLAX * (n.W - x)).toFixed(2)}px)`;
        n.shade.style.opacity = (SHADE * clamp(1 - x / n.W, 0, 1)).toFixed(3);
        if (n.fly && n.T) {
          const t = n.T.x;
          n.fly.el.style.transform = `translate(${(n.fly.dx * (1 - t)).toFixed(2)}px, ${(n.fly.dy * (1 - t)).toFixed(2)}px) scale(${(n.fly.scale + (1 - n.fly.scale) * t).toFixed(4)})`;
        }
        const still = (s: Spring, e: number) => Math.abs(s.x - s.t) < e && Math.abs(s.v) < e * 10;
        if (!drag && still(n.X, 0.5) && still(H, 0.5) && (!n.T || still(n.T, 0.003))) n.done();
      } else if (sizing && Math.abs(H.x - H.t) < 0.5 && Math.abs(H.v) < 5) {
        sizing = false;
        o.dialog.style.removeProperty('height');
      }
    },
    settled: () => !nav && !sizing,
  };
  register(comp);

  /** Естественная высота окна сейчас (без инлайн-высоты). */
  const natural = (): number => {
    const prev = o.dialog.style.height;
    o.dialog.style.removeProperty('height');
    const h = o.dialog.offsetHeight;
    o.dialog.style.height = prev;
    return h;
  };
  const busyMenu = () => o.dialog.classList.contains('mm-morph') || o.dialog.classList.contains('mm-closing') || o.dialog.hidden;

  // высота окна следует за содержимым верхней страницы
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => follow()) : null;
  const watch = (page: HTMLElement) => {
    ro?.disconnect();
    const inner = page.firstElementChild;
    if (inner instanceof HTMLElement) ro?.observe(inner);
  };
  watch(o.root.page);

  function follow(): void {
    if (nav || drag || busyMenu()) { lastH = 0; return; }
    const was = lastH || o.dialog.offsetHeight;
    const h = natural();
    lastH = h;
    if (!was || Math.abs(h - was) < 1) return;
    const mode = modeNow();
    if (mode === 'off') return;
    if (mode === 'normal') {
      clearTimeout(cssTimer);
      o.dialog.style.height = `${was}px`;
      void o.dialog.offsetHeight;
      o.dialog.style.transition = 'height 0.18s cubic-bezier(0.22, 0.8, 0.24, 1)';
      o.dialog.style.height = `${h}px`;
      cssTimer = window.setTimeout(() => { o.dialog.style.removeProperty('transition'); o.dialog.style.removeProperty('height'); }, 200);
      return;
    }
    if (!sizing) { H.x = was; H.v = 0; }
    H.t = h;
    tune(H, ...HEIGHT);
    sizing = true;
    o.dialog.style.height = `${H.x}px`;
    wake();
  }

  const setBack = () => {
    const show = stack.length > 1;
    o.back.hidden = !show;
  };

  const fade = (el: HTMLElement, frames: Keyframe[], ms: number, then?: () => void) => {
    if (typeof el.animate !== 'function' || modeNow() === 'off') { then?.(); return; }
    const a = el.animate(frames, { duration: ms, easing: EASE_OUT, fill: 'forwards' });
    a.onfinish = () => { then?.(); a.cancel(); };
  };

  /** Заголовки: прежний уходит, новый приходит (из пункта или со сдвигом). */
  const swapTitles = (from: HTMLElement, to: HTMLElement, dir: 1 | -1, mode: Mode): void => {
    if (from === to) return;
    o.titles.append(to);
    if (mode === 'off') { from.remove(); return; }
    from.classList.add('stack-title-leaving');
    fade(from, [{ opacity: 1, transform: 'translateX(0)' }, { opacity: 0, transform: `translateX(${dir * -40}px)` }], mode === 'normal' ? 120 : 180, () => {
      from.remove();
      from.classList.remove('stack-title-leaving');
    });
  };

  const clearPage = (p: HTMLElement) => {
    for (const k of ['position', 'left', 'top', 'width', 'height', 'transform', 'z-index', 'box-shadow']) p.style.removeProperty(k);
    p.classList.remove('stack-top', 'stack-under', 'mm-fade');
    p.removeAttribute('inert');
    p.querySelector(':scope > .stack-shade')?.remove();
  };

  const pin = (p: HTMLElement) => {
    // страница вынимается из потока и остаётся на месте
    const h = p.offsetHeight;
    p.style.position = 'absolute';
    p.style.left = '0';
    p.style.top = '0';
    p.style.width = '100%';
    p.style.height = `${h}px`;
  };

  const shadeOf = (p: HTMLElement): HTMLElement => {
    let s = p.querySelector<HTMLElement>(':scope > .stack-shade');
    if (!s) {
      s = document.createElement('div');
      s.className = 'stack-shade';
      s.setAttribute('aria-hidden', 'true');
      p.append(s);
    }
    return s;
  };

  function swap(from: StackLevel, to: StackLevel, dir: 1 | -1, origin: HTMLElement | null, startX?: number, v0 = 0): void {
    const mode = busyMenu() ? 'off' : modeNow();
    const focused = o.dialog.contains(document.activeElement);
    clearTimeout(cssTimer);
    o.dialog.style.removeProperty('transition');
    sizing = false;
    lastH = 0;
    const H0 = o.dialog.offsetHeight;
    const W = o.view.clientWidth || o.dialog.clientWidth || 1;
    const focusAfter = () => {
      if (!focused) return;
      if (dir === 1) o.back.focus({ preventScroll: true });
      else (from.opener && to.page.contains(from.opener) ? from.opener : o.back.hidden ? null : o.back)?.focus({ preventScroll: true });
    };
    if (mode === 'off') {
      if (from.page.isConnected) from.page.replaceWith(to.page); else o.view.append(to.page);
      clearPage(to.page);
      swapTitles(from.title, to.title, dir, mode);
      setBack();
      watch(to.page);
      o.onChange?.(to);
      focusAfter();
      return;
    }
    if (mode === 'normal') {
      if (from.page.isConnected) from.page.replaceWith(to.page); else o.view.append(to.page);
      clearPage(to.page);
      swapTitles(from.title, to.title, dir, mode);
      setBack();
      const H1 = natural();
      o.dialog.style.height = `${H0}px`;
      to.page.classList.add('mm-fade');
      void o.dialog.offsetHeight;
      o.dialog.style.transition = 'height 0.18s cubic-bezier(0.22, 0.8, 0.24, 1)';
      o.dialog.style.height = `${H1}px`;
      cssTimer = window.setTimeout(() => {
        o.dialog.style.removeProperty('transition');
        o.dialog.style.removeProperty('height');
        to.page.classList.remove('mm-fade');
      }, 220);
      watch(to.page);
      o.onChange?.(to);
      focusAfter();
      return;
    }
    // «Улучшенные»: верхняя страница въезжает справа (или уезжает вправо), нижняя — с параллаксом
    const topPage = dir === 1 ? to.page : from.page;
    const underPage = dir === 1 ? from.page : to.page;
    if (dir === 1) {
      pin(from.page);
      o.view.append(to.page);
    } else {
      if (!from.page.isConnected) o.view.append(from.page);
      pin(from.page);
      o.view.prepend(to.page);
    }
    topPage.classList.add('stack-top');
    underPage.classList.add('stack-under');
    // уходящая страница недоступна, пока едет (в неё не попасть ни Tab, ни щелчком); на приходящую сразу можно вернуть фокус
    from.page.setAttribute('inert', '');
    const shade = shadeOf(underPage);
    swapTitles(from.title, to.title, dir, mode);
    setBack();
    const H1 = natural();
    H.x = H0; H.v = 0; H.t = H1;
    tune(H, ...HEIGHT);
    o.dialog.style.height = `${H0}px`;
    const X = S(startX ?? (dir === 1 ? W : 0));
    X.v = v0;
    X.t = dir === 1 ? 0 : W;
    tune(X, ...(dir === 1 ? PUSH : POP));
    let T: Spring | null = null;
    let fly: Nav['fly'] = null;
    if (dir === 1 && origin && origin.isConnected) {
      // подпись пункта взлетает в шапку и становится заголовком
      const a = origin.getBoundingClientRect();
      const b = to.title.getBoundingClientRect();
      const fsA = parseFloat(getComputedStyle(origin).fontSize) || 13;
      const fsB = parseFloat(getComputedStyle(to.title).fontSize) || 14;
      if (b.width > 0 && a.width > 0) {
        fly = { el: to.title, dx: a.left - b.left, dy: a.top + a.height / 2 - (b.top + b.height / 2), scale: fsA / fsB };
        T = S(0);
        T.t = 1;
        tune(T, ...PUSH);
        to.title.style.transformOrigin = 'left center';
      }
    }
    if (!fly) fade(to.title, [{ opacity: 0, transform: `translateX(${dir * 24}px)` }, { opacity: 1, transform: 'translateX(0)' }], 280);
    if (dir === 1) fade(o.back, [{ opacity: 0 }, { opacity: 1 }], 180);
    const done = () => {
      nav = null;
      if (dir === -1) from.page.remove(); else underPage.remove();
      clearPage(from.page);
      clearPage(to.page);
      to.title.style.removeProperty('transform');
      to.title.style.removeProperty('transform-origin');
      o.dialog.style.removeProperty('height');
      watch(to.page);
    };
    nav = { dir, top: topPage, under: underPage, shade, W, X, T, fly, done };
    o.onChange?.(to);
    focusAfter();
    comp.render();
    wake();
  }

  function push(level: StackLevel, origin?: HTMLElement | null): void {
    if (nav || drag) return;
    const from = stack[stack.length - 1];
    stack.push(level);
    swap(from, level, 1, origin ?? null);
  }

  function pop(startX?: number, v0 = 0): void {
    if (stack.length < 2 || (nav && startX === undefined)) return;
    const from = stack.pop()!;
    swap(from, stack[stack.length - 1], -1, null, startX, v0);
  }

  // ----- Свайп вправо: страница уходит назад (палец или перо, «Улучшенные») -----
  const onDown = (e: PointerEvent) => {
    if (e.pointerType === 'mouse' || stack.length < 2 || nav || modeNow() !== 'enhanced') return;
    drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, axis: null, samples: [{ x: e.clientX, t: e.timeStamp }], W: o.view.clientWidth || 1 };
  };
  let dragNav: { X: Spring } | null = null;
  const onMove = (e: PointerEvent) => {
    const d = drag;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x0;
    const dy = e.clientY - d.y0;
    if (!d.axis) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < AXIS_LOCK) return;
      d.axis = Math.abs(dx) > Math.abs(dy) && dx > 0 ? 'x' : 'y';
      if (d.axis === 'y') { drag = null; return; }
      // начало свайпа: нижняя страница встаёт под верхнюю
      const top = stack[stack.length - 1];
      const under = stack[stack.length - 2];
      pin(top.page);
      o.view.prepend(under.page);
      top.page.classList.add('stack-top');
      under.page.classList.add('stack-under');
      under.page.setAttribute('inert', '');
      shadeOf(under.page);
      dragNav = { X: S(0) };
      d.x0 = e.clientX;
      d.samples = [{ x: e.clientX, t: e.timeStamp }];
      try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* не страшно */ }
    }
    if (d.axis !== 'x' || !dragNav) return;
    d.samples.push({ x: e.clientX, t: e.timeStamp });
    while (d.samples.length > 2 && e.timeStamp - d.samples[0].t > 100) d.samples.shift();
    const x = Math.max(0, e.clientX - d.x0);
    const top = stack[stack.length - 1].page;
    const under = stack[stack.length - 2].page;
    top.style.transform = `translateX(${x}px)`;
    under.style.transform = `translateX(${(-PARALLAX * (d.W - x)).toFixed(2)}px)`;
    const shade = under.querySelector<HTMLElement>(':scope > .stack-shade');
    if (shade) shade.style.opacity = (SHADE * clamp(1 - x / d.W, 0, 1)).toFixed(3);
    dragNav.X.x = x;
  };
  const onUp = (e: PointerEvent) => {
    const d = drag;
    if (!d || d.id !== e.pointerId) return;
    drag = null;
    if (d.axis !== 'x' || !dragNav) return;
    const x = dragNav.X.x;
    dragNav = null;
    const first = d.samples[0];
    const vx = ((e.clientX - first.x) / Math.max(e.timeStamp - first.t, 1)) * 1000;
    const under = stack[stack.length - 2];
    const top = stack[stack.length - 1];
    if (x > d.W * POP_DISTANCE || vx > POP_VELOCITY) {
      under.page.remove();
      clearPage(under.page);
      pop(x, vx);
    } else {
      // вернуть на место
      const X = S(x);
      X.t = 0;
      X.v = vx;
      tune(X, ...PUSH);
      H.x = H.t = o.dialog.offsetHeight;
      nav = {
        dir: 1, top: top.page, under: under.page, shade: shadeOf(under.page), W: d.W, X, T: null, fly: null,
        done: () => { nav = null; under.page.remove(); clearPage(under.page); clearPage(top.page); o.dialog.style.removeProperty('height'); },
      };
      wake();
    }
  };
  o.view.addEventListener('pointerdown', onDown);
  o.view.addEventListener('pointermove', onMove);
  o.view.addEventListener('pointerup', onUp);
  o.view.addEventListener('pointercancel', onUp);

  setBack();

  return {
    get depth() { return stack.length - 1; },
    get busy() { return nav !== null; },
    top: () => stack[stack.length - 1],
    push,
    pop: () => pop(),
    follow,
    destroy() {
      ro?.disconnect();
      clearTimeout(cssTimer);
      nav = null;
      sizing = false;
      unregister(comp);
    },
  };
}
