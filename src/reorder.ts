/**
 * Перестановка карточек перетаскиванием (мышь, перо, палец).
 * Карточка едет за указателем, соседи раздвигаются перестановкой узлов в DOM;
 * по отпусканию вызывается onEnd с исходным и новым индексом.
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
  /**
   * Карточку можно вынести за пределы списка (страницу — на холст): снаружи за указателем
   * едет призрак, карточка остаётся на месте; отпустили снаружи — drop с точкой окна.
   */
  dropOutside?: {
    enabled(): boolean;
    ghost(item: HTMLElement): HTMLElement;
    drop(index: number, x: number, y: number): void;
  };
}

/** Сдвиг, после которого нажатие мышью или пером становится перетаскиванием. */
const DRAG_SLOP = 5;
/** Долгое нажатие пальцем, после которого карточку можно тащить. */
const TOUCH_HOLD_MS = 350;
const EDGE = 40;
const EDGE_SPEED = 14;

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
  active: boolean;
  holdTimer: number;
  raf: number;
  /** Призрак карточки, пока указатель за пределами списка (см. dropOutside). */
  ghost: HTMLElement | null;
}

let current: Drag | null = null;

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
    // отпустили за пределами списка: порядок прежний, карточку «бросили» туда
    const dropped = commit && !!d.ghost;
    setGhost(d, false);
    if (dropped) commit = false;
    d.item.classList.remove('dragging');
    d.item.style.transform = '';
    document.body.classList.remove('reordering');
    if (!commit) container.insertBefore(d.item, d.origNext);
    // клик, который браузер пришлёт за отпусканием, — не выбор карточки
    const swallow = (e: Event) => { e.stopPropagation(); e.preventDefault(); };
    window.addEventListener('click', swallow, { capture: true, once: true });
    setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0);
    opts.onEnd(d.from, commit ? opts.items().indexOf(d.item) : d.from);
    if (dropped) opts.dropOutside!.drop(d.from, d.x, d.y);
  };

  /** Указатель за пределами списка — призрак вместо карточки (если вынос разрешён). */
  const outside = (d: Drag) => {
    if (!opts.dropOutside?.enabled()) return false;
    const r = container.getBoundingClientRect();
    return d.x < r.left || d.x > r.right || d.y < r.top || d.y > r.bottom;
  };
  const setGhost = (d: Drag, on: boolean) => {
    if (on && !d.ghost) {
      d.ghost = opts.dropOutside!.ghost(d.item);
      d.ghost.classList.add('drag-ghost');
      document.body.appendChild(d.ghost);
      d.item.classList.add('drag-out');
      // снаружи карточка ждёт на исходном месте
      container.insertBefore(d.item, d.origNext);
    } else if (!on && d.ghost) {
      d.ghost.remove();
      d.ghost = null;
      d.item.classList.remove('drag-out');
    }
    if (d.ghost) d.ghost.style.transform = `translate(${d.x}px, ${d.y}px) translate(-50%, -50%)`;
  };

  /** Карточка следует за указателем от своего текущего места в раскладке. */
  const follow = (d: Drag) => {
    d.item.style.transform = '';
    const r = d.item.getBoundingClientRect();
    d.item.style.transform = `translate(${d.x - d.grabX - r.left}px, ${d.y - d.grabY - r.top}px)`;
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
    if (d.ghost) { d.raf = requestAnimationFrame(autoScroll); return; }
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
    d.item.classList.add('dragging');
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
      active: false, holdTimer: 0, raf: 0, ghost: null,
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
    const out = outside(d);
    setGhost(d, out);
    if (out) { d.item.style.transform = ''; return; }
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
