// Своя тонкая полоса прокрутки поверх содержимого (вынесена из pills масштаба в «Масштаб и вид»).
// Родная полоса скрыта; ползунок лежит поверх края, без стрелок и дорожки, плавно появляется при прокрутке
// и наведении и гаснет через 0.9 с; при наведении на сам ползунок он чуть толще, его можно тянуть.
// Ось x — ряд (колесо мыши крутит его по горизонтали), ось y — колонка.
// Три режима анимаций: появление и исчезновение — CSS-переход; при «Выкл» (body.no-ui-anim) — сразу.

export interface OverlayScrollOptions {
  axis: 'x' | 'y';
  /** Где лежит ползунок: неподвижный родитель прокручиваемого блока (position: relative). */
  host?: HTMLElement;
  /** Колесо мыши прокручивает ряд по горизонтали (только для оси x). */
  wheel?: boolean;
}

export interface OverlayScroll {
  readonly thumb: HTMLElement;
  /** Пересчитать ползунок (после смены содержимого, которую не заметил наблюдатель). */
  sync(): void;
  destroy(): void;
}

const MIN_THUMB = 24;
const HIDE_MS = 900;

export function attachOverlayScroll(scroller: HTMLElement, o: OverlayScrollOptions): OverlayScroll {
  const host = o.host ?? scroller.parentElement!;
  const x = o.axis === 'x';
  host.classList.add('oscroll-host');
  scroller.classList.add('oscroll', x ? 'oscroll-x' : 'oscroll-y');
  const thumb = document.createElement('div');
  thumb.className = `oscroll-thumb ${x ? 'oscroll-thumb-x' : 'oscroll-thumb-y'}`;
  thumb.setAttribute('aria-hidden', 'true');
  thumb.hidden = true;
  host.append(thumb);
  let hideTimer = 0;

  const dims = () => (x
    ? { total: scroller.scrollWidth, view: scroller.clientWidth, pos: scroller.scrollLeft, offset: scroller.offsetLeft }
    : { total: scroller.scrollHeight, view: scroller.clientHeight, pos: scroller.scrollTop, offset: scroller.offsetTop });

  const sync = () => {
    const { total, view, pos, offset } = dims();
    if (total <= view + 1) { thumb.hidden = true; return; }
    thumb.hidden = false;
    const size = Math.max(MIN_THUMB, (view * view) / total);
    const at = (pos / (total - view)) * (view - size);
    if (x) {
      thumb.style.width = `${size}px`;
      thumb.style.transform = `translateX(${at}px)`;
    } else {
      thumb.style.height = `${size}px`;
      thumb.style.transform = `translateY(${offset + at}px)`;
    }
  };
  const flash = () => {
    sync();
    host.classList.add('scrolling');
    window.clearTimeout(hideTimer);
    hideTimer = window.setTimeout(() => host.classList.remove('scrolling'), HIDE_MS);
  };
  const onWheel = (e: WheelEvent) => {
    if (e.deltaY === 0 || scroller.scrollWidth <= scroller.clientWidth) return;
    e.preventDefault();
    scroller.scrollLeft += e.deltaY;
  };
  scroller.addEventListener('scroll', flash);
  host.addEventListener('pointerenter', sync);
  if (x && o.wheel) scroller.addEventListener('wheel', onWheel, { passive: false });
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(sync) : null;
  ro?.observe(scroller);
  if (scroller.firstElementChild) ro?.observe(scroller.firstElementChild);

  thumb.addEventListener('pointerdown', e => {
    e.preventDefault();
    try { thumb.setPointerCapture(e.pointerId); } catch { /* не страшно */ }
    host.classList.add('dragging');
    const start = x ? e.clientX : e.clientY;
    const { total, view, pos } = dims();
    const size = x ? thumb.offsetWidth : thumb.offsetHeight;
    const ratio = (total - view) / Math.max(1, view - size);
    const move = (ev: PointerEvent) => {
      const d = ((x ? ev.clientX : ev.clientY) - start) * ratio;
      if (x) scroller.scrollLeft = pos + d; else scroller.scrollTop = pos + d;
    };
    const up = () => {
      host.classList.remove('dragging');
      thumb.removeEventListener('pointermove', move);
      thumb.removeEventListener('pointerup', up);
      thumb.removeEventListener('pointercancel', up);
    };
    thumb.addEventListener('pointermove', move);
    thumb.addEventListener('pointerup', up);
    thumb.addEventListener('pointercancel', up);
  });

  return {
    thumb,
    sync,
    destroy() {
      ro?.disconnect();
      window.clearTimeout(hideTimer);
      scroller.removeEventListener('scroll', flash);
      scroller.removeEventListener('wheel', onWheel);
      host.removeEventListener('pointerenter', sync);
      thumb.remove();
    },
  };
}
