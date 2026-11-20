// Своя тонкая полоса прокрутки поверх содержимого (вынесена из pills масштаба в «Масштаб, вид и взаимодействия»).
// Родная полоса скрыта; ползунок лежит поверх края, без стрелок и дорожки, плавно появляется при прокрутке
// и наведении и гаснет через 0.9 с; при наведении на сам ползунок он чуть толще, его можно тянуть.
// Ось x — ряд (колесо мыши крутит его по горизонтали), ось y — колонка.
// Края (edges): за краем есть ещё элементы — у этого края тень ('shadow', для карточек) или растворение
// содержимого ('fade', для лент поверх холста); у края, где прокручивать уже некуда, — ничего.
// Три режима анимаций: появление и исчезновение — CSS-переход; при «Выкл» (body.no-ui-anim) — сразу.

export interface OverlayScrollOptions {
  /** Ось; функция — ось меняется на лету (лента страниц: внизу — ряд, вверху — колонка). */
  axis: 'x' | 'y' | (() => 'x' | 'y');
  /** Где лежит ползунок: неподвижный родитель прокручиваемого блока (position: relative). */
  host?: HTMLElement;
  /** Колесо мыши прокручивает ряд по горизонтали (только для оси x). */
  wheel?: boolean;
  /** Подсказка «есть ещё» у краёв, за которыми есть содержимое. */
  edges?: 'shadow' | 'fade';
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
  const axisOf = (): 'x' | 'y' => (typeof o.axis === 'function' ? o.axis() : o.axis);
  let x = axisOf() === 'x';
  host.classList.add('oscroll-host');
  scroller.classList.add('oscroll', x ? 'oscroll-x' : 'oscroll-y');
  const thumb = document.createElement('div');
  thumb.className = `oscroll-thumb ${x ? 'oscroll-thumb-x' : 'oscroll-thumb-y'}`;
  thumb.setAttribute('aria-hidden', 'true');
  thumb.hidden = true;
  host.append(thumb);
  let hideTimer = 0;
  // тени краёв — отдельные слои в рамке (над прокручиваемым блоком, сами не прокручиваются)
  const shades = o.edges === 'shadow'
    ? (['start', 'end'] as const).map(side => {
      const e = document.createElement('div');
      e.className = `oscroll-shade oscroll-shade-${x ? 'x' : 'y'} oscroll-shade-${side}`;
      e.setAttribute('aria-hidden', 'true');
      host.append(e);
      return e;
    })
    : [];
  if (o.edges === 'fade') scroller.classList.add(x ? 'oscroll-fade-x' : 'oscroll-fade-y');

  const dims = () => (x
    ? { total: scroller.scrollWidth, view: scroller.clientWidth, pos: scroller.scrollLeft }
    : { total: scroller.scrollHeight, view: scroller.clientHeight, pos: scroller.scrollTop });

  /** Края: есть ли что прокручивать в начале и в конце. */
  const edges = (pos: number, total: number, view: number) => {
    const start = pos > 1;
    const end = pos < total - view - 1;
    host.classList.toggle('oscroll-more-start', start);
    host.classList.toggle('oscroll-more-end', end);
    if (o.edges === 'fade') {
      scroller.style.setProperty('--oscroll-fs', start ? '1' : '0');
      scroller.style.setProperty('--oscroll-fe', end ? '1' : '0');
    }
  };

  /** Ось сменилась: классы ползунка, блока и теней — под новую. */
  const setAxis = () => {
    const nx = axisOf() === 'x';
    if (nx === x) return;
    x = nx;
    scroller.classList.toggle('oscroll-x', x);
    scroller.classList.toggle('oscroll-y', !x);
    thumb.classList.toggle('oscroll-thumb-x', x);
    thumb.classList.toggle('oscroll-thumb-y', !x);
    for (const k of ['width', 'height', 'transform']) thumb.style.removeProperty(k);
    if (o.edges === 'fade') { scroller.classList.toggle('oscroll-fade-x', x); scroller.classList.toggle('oscroll-fade-y', !x); }
    for (const e of shades) { e.classList.toggle('oscroll-shade-x', x); e.classList.toggle('oscroll-shade-y', !x); e.removeAttribute('style'); }
  };

  const sync = () => {
    setAxis();
    const { total, view, pos } = dims();
    edges(pos, total, view);
    // прокручиваемый блок может выступать из рамки (отрицательные поля): ползунок и тени — по его видимой области
    const along = x ? scroller.offsetLeft : scroller.offsetTop;
    const across = x
      ? scroller.offsetTop + scroller.offsetHeight - host.clientHeight
      : scroller.offsetLeft + scroller.offsetWidth - host.clientWidth;
    for (const [i, e] of shades.entries()) {
      if (x) { e.style.left = `${along + (i ? view - 16 : 0)}px`; e.style.top = `${scroller.offsetTop}px`; e.style.height = `${scroller.clientHeight}px`; }
      else { e.style.top = `${along + (i ? view - 12 : 0)}px`; e.style.left = `${scroller.offsetLeft}px`; e.style.width = `${scroller.clientWidth}px`; }
    }
    if (total <= view + 1) { thumb.hidden = true; return; }
    thumb.hidden = false;
    const size = Math.max(MIN_THUMB, (view * view) / total);
    const at = along + (pos / (total - view)) * (view - size);
    if (x) {
      thumb.style.width = `${size}px`;
      thumb.style.transform = `translate(${at}px, ${across}px)`;
    } else {
      thumb.style.height = `${size}px`;
      thumb.style.transform = `translate(${across}px, ${at}px)`;
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
      host.classList.remove('oscroll-more-start', 'oscroll-more-end');
      scroller.classList.remove('oscroll-fade-x', 'oscroll-fade-y');
      thumb.remove();
      for (const e of shades) e.remove();
    },
  };
}
