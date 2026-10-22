/**
 * Перестановка карточек перетаскиванием (мышь, перо, палец).
 * За указателем едет копия карточки поверх страницы (её не обрезают края прокручиваемого списка),
 * а сама карточка остаётся в списке местом, куда встанет: соседи раздвигаются перестановкой узлов в DOM.
 * По отпусканию вызывается onEnd с исходным и новым индексом.
 * Палец сначала задерживают на месте (долгое нажатие) — обычное движение пальцем прокручивает список.
 */

export interface SortableOptions {
  /** Карточки, которые можно переставлять (в порядке DOM). */
  items: () => HTMLElement[];
  /** Перетаскивание закончено: from === to — порядок не изменился (или отменён). */
  onEnd: (from: number, to: number) => void;
  /** Можно ли сейчас перетаскивать (например, гостю совместной работы — нет). */
  enabled?: () => boolean;
  /** Прокручиваемый предок: у краёв он листается сам. */
  scroller?: HTMLElement;
}

/** Сдвиг, после которого нажатие мышью или пером становится перетаскиванием. */
const DRAG_SLOP = 5;
/** Долгое нажатие пальцем, после которого карточку можно тащить. */
const TOUCH_HOLD_MS = 350;
const EDGE = 40;
const EDGE_SPEED = 14;
/** Копия карточки долетает до её нового места. */
const DROP_MS = 160;

interface Drag {
  item: HTMLElement;
  pointerId: number;
  from: number;
  /** Узел, перед которым карточка стояла: по нему возвращаем её на место при отмене. */
  origNext: Node | null;
  startX: number;
  startY: number;
  x: number;
  y: number;
  /** Точка захвата внутри карточки. */
  grabX: number;
  grabY: number;
  /** Копия карточки, которая едет за указателем (есть, пока идёт перетаскивание). */
  ghost: HTMLElement | null;
  active: boolean;
  holdTimer: number;
  raf: number;
}

let current: Drag | null = null;

/** Копия карточки для перетаскивания: те же размеры и содержимое холстов (cloneNode их пиксели не копирует). */
function makeGhost(item: HTMLElement): HTMLElement {
  const r = item.getBoundingClientRect();
  const ghost = item.cloneNode(true) as HTMLElement;
  ghost.classList.add('reorder-ghost');
  ghost.removeAttribute('title');
  ghost.setAttribute('aria-hidden', 'true');
  Object.assign(ghost.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
  const src = item.querySelectorAll('canvas');
  ghost.querySelectorAll('canvas').forEach((cv, i) => {
    const from = src[i];
    if (!from || from.width === 0 || from.height === 0) return;
    cv.width = from.width;
    cv.height = from.height;
    cv.getContext('2d')?.drawImage(from, 0, 0);
  });
  document.body.appendChild(ghost);
  return ghost;
}

/** Копия долетает до места карточки в списке и исчезает. */
function dropGhost(ghost: HTMLElement, to: DOMRect): void {
  const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce || typeof ghost.animate !== 'function') { ghost.remove(); return; }
  const anim = ghost.animate([{ left: `${to.left}px`, top: `${to.top}px`, transform: 'none', boxShadow: 'none' }], {
    duration: DROP_MS, easing: 'ease-out', fill: 'forwards',
  });
  anim.finished.then(() => ghost.remove(), () => ghost.remove());
}

/** Идёт перетаскивание: перерисовка списка подождёт до его конца. */
export function reordering(): boolean {
  return current?.active ?? false;
}

export function makeSortable(container: HTMLElement, opts: SortableOptions): void {
  const finish = (commit: boolean) => {
    const d = current;
    if (!d) return;
    current = null;
    clearTimeout(d.holdTimer);
    cancelAnimationFrame(d.raf);
    if (container.hasPointerCapture(d.pointerId)) container.releasePointerCapture(d.pointerId);
    if (!d.active) return;
    document.body.classList.remove('reordering');
    if (!commit) container.insertBefore(d.item, d.origNext);
    if (d.ghost) dropGhost(d.ghost, d.item.getBoundingClientRect());
    d.item.classList.remove('drag-source');
    // клик, который браузер пришлёт за отпусканием, — не выбор карточки
    const swallow = (e: Event) => { e.stopPropagation(); e.preventDefault(); };
    window.addEventListener('click', swallow, { capture: true, once: true });
    setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0);
    opts.onEnd(d.from, commit ? opts.items().indexOf(d.item) : d.from);
  };

  /** Копия карточки следует за указателем, держась за точку захвата. */
  const follow = (d: Drag) => {
    if (!d.ghost) return;
    d.ghost.style.left = `${d.x - d.grabX}px`;
    d.ghost.style.top = `${d.y - d.grabY}px`;
  };

  /** Встаёт на место карточки под указателем: правее/ниже неё, если шла сверху, иначе перед ней. */
  const place = (d: Drag) => {
    const items = opts.items();
    const over = items.find(el => {
      if (el === d.item) return false;
      const r = el.getBoundingClientRect();
      return d.x >= r.left && d.x <= r.right && d.y >= r.top && d.y <= r.bottom;
    });
    if (!over) return;
    if (items.indexOf(over) > items.indexOf(d.item)) over.after(d.item);
    else over.before(d.item);
  };

  const autoScroll = () => {
    const d = current;
    const sc = opts.scroller;
    if (!d || !d.active || !sc) return;
    const r = sc.getBoundingClientRect();
    let dx = 0;
    let dy = 0;
    if (sc.scrollWidth > sc.clientWidth) {
      if (d.x < r.left + EDGE) dx = -EDGE_SPEED;
      else if (d.x > r.right - EDGE) dx = EDGE_SPEED;
    }
    if (sc.scrollHeight > sc.clientHeight) {
      if (d.y < r.top + EDGE) dy = -EDGE_SPEED;
      else if (d.y > r.bottom - EDGE) dy = EDGE_SPEED;
    }
    if (dx || dy) {
      sc.scrollBy(dx, dy);
      place(d);
      follow(d);
    }
    d.raf = requestAnimationFrame(autoScroll);
  };

  const begin = (d: Drag) => {
    d.active = true;
    // захват — только у начатого перетаскивания: иначе клик по карточке ушёл бы контейнеру
    container.setPointerCapture(d.pointerId);
    d.ghost = makeGhost(d.item);
    d.item.classList.add('drag-source');
    document.body.classList.add('reordering');
    follow(d);
    d.raf = requestAnimationFrame(autoScroll);
  };

  container.addEventListener('pointerdown', e => {
    // список перерисовали посреди нажатия — оно осиротело
    if (current && !current.item.isConnected) current = null;
    if (current || e.button !== 0 || (opts.enabled && !opts.enabled())) return;
    const target = e.target as HTMLElement;
    if (target.closest('button, input, textarea')) return;
    const item = opts.items().find(el => el.contains(target));
    if (!item) return;
    const r = item.getBoundingClientRect();
    const d: Drag = {
      item, pointerId: e.pointerId,
      from: opts.items().indexOf(item), origNext: item.nextSibling,
      startX: e.clientX, startY: e.clientY, x: e.clientX, y: e.clientY,
      grabX: e.clientX - r.left, grabY: e.clientY - r.top,
      ghost: null, active: false, holdTimer: 0, raf: 0,
    };
    current = d;
    if (e.pointerType === 'touch') d.holdTimer = window.setTimeout(() => { if (current === d) begin(d); }, TOUCH_HOLD_MS);
  });

  container.addEventListener('pointermove', e => {
    const d = current;
    if (!d || e.pointerId !== d.pointerId) return;
    d.x = e.clientX;
    d.y = e.clientY;
    if (!d.active) {
      if (Math.hypot(d.x - d.startX, d.y - d.startY) < DRAG_SLOP) return;
      // палец сдвинулся раньше долгого нажатия — это прокрутка, а не перетаскивание
      if (e.pointerType === 'touch') { finish(false); return; }
      begin(d);
    }
    place(d);
    follow(d);
  });

  container.addEventListener('pointerup', e => { if (current?.pointerId === e.pointerId) finish(true); });
  container.addEventListener('pointercancel', e => { if (current?.pointerId === e.pointerId) finish(false); });
  container.addEventListener('lostpointercapture', e => { if (current?.pointerId === e.pointerId) finish(false); });
  // пока карточку тащат пальцем, страница не прокручивается и не показывает контекстное меню
  container.addEventListener('touchmove', e => { if (current?.active) e.preventDefault(); }, { passive: false });
  container.addEventListener('contextmenu', e => { if (current) e.preventDefault(); });
}
