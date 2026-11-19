// Группа аватаров: горизонтальная стопка. Свёрнутая — аватары стоят тесно, но не перекрывают друг друга
// (инициалы и курсоры видны); наведение мышью, нажатие на планшете или фокус с клавиатуры раскрывают её —
// промежутки растут, и с аватарами можно взаимодействовать. Один аватар доступен сразу.
// Анимации по трём уровням (настройка доски «Анимации», src/menu-motion.ts → menuMotion()):
//  • «Выкл» — аватары встают на место сразу;
//  • «Обычные» — CSS-переходы (transform и ширина), появление и уход — короткие CSS-анимации;
//  • «Улучшенные» — пружины motion.ts: аватары разъезжаются с небольшим перелётом и задержкой друг за другом,
//    новый аватар «выпрыгивает», ушедший сжимается.

import { createUserAvatar, updateUserAvatar, type AvatarData } from './avatar';
import { menuMotion } from './menu-motion';
import { S, register, snap, spring, step, tune, wake, type Spring } from './motion';

export interface AvatarGroupItem {
  /** Постоянный ключ (номер участника): по нему аватар обновляется на месте. */
  key: string;
  /** Аватар; нет — счётчик «+N» (more). */
  data?: AvatarData;
  more?: { count: number; title: string };
  /** Нажали на раскрытый аватар (или единственный). */
  onActivate?: (btn: HTMLElement) => void;
}

export interface AvatarGroup {
  el: HTMLElement;
  /** Новый состав: аватары с теми же ключами обновляются на месте. */
  set(items: readonly AvatarGroupItem[]): void;
  /** Стопка раскрыта (или в ней один аватар) — с аватарами можно взаимодействовать. */
  interactive(): boolean;
  /** Держать раскрытой (пока открыто меню аватара); false — можно сворачивать. */
  hold(on: boolean): void;
  collapse(): void;
  /** Узел аватара по ключу. */
  node(key: string): HTMLElement | null;
}

export interface AvatarGroupOptions {
  /** Диаметр аватара, px (как --ua-size в style.css). */
  size?: number;
  /** Промежуток между аватарами в свёрнутой и раскрытой стопке, px. */
  tight?: number;
  open?: number;
  label?: string;
  /** Класс узлов аватаров (например, 'presence-avatar' в шапке, 'page-avatar' у карточек страниц). */
  itemClass?: string;
}

/** На сколько курсор выступает за круг справа и снизу — доля диаметра (см. .ua-cursor в style.css). */
const CURSOR_OUT = 0.15;
/** Мышь ушла — пауза перед сворачиванием, мс. */
const LEAVE_MS = 220;
/** Пауза между аватарами, когда стопка раскрывается («Улучшенные»), с. */
const STAGGER = 0.022;
/** «Обычные»: сколько длится уход аватара (как ag-leave в style.css), мс. */
const CSS_LEAVE_MS = 160;

let SPREAD: [number, number] = [420, 26]; // аватары разъезжаются (небольшой перелёт)
let POP: [number, number] = [520, 20];    // новый аватар выпрыгивает
let GONE: [number, number] = [900, 60];   // ушедший сжимается

interface Slot {
  key: string;
  el: HTMLElement;
  item: AvatarGroupItem;
  x: Spring;
  s: Spring;
  /** Задержка перед стартом пружины x, с. */
  wait: number;
  leaving: boolean;
}

interface GroupState {
  el: HTMLElement;
  slots: Slot[];
  W: Spring;
  springy: boolean;
}

const live = new Set<GroupState>();
let looped = false;

function ensureLoop(): void {
  if (looped) return;
  looped = true;
  SPREAD = spring('--avatar-spread', SPREAD);
  POP = spring('--avatar-pop', POP);
  GONE = spring('--avatar-gone', GONE);
  register({
    frame(dt) {
      for (const g of live) {
        if (!g.springy) continue;
        step(g.W, dt);
        for (const sl of g.slots) {
          if (sl.wait > 0) sl.wait = Math.max(0, sl.wait - dt);
          else step(sl.x, dt);
          step(sl.s, dt);
        }
      }
    },
    render() {
      for (const g of live) {
        if (!g.springy) continue;
        g.el.style.width = `${Math.max(0, g.W.x)}px`;
        for (const sl of g.slots) {
          sl.el.style.transform = `translateX(${sl.x.x.toFixed(2)}px) scale(${Math.max(0, sl.s.x).toFixed(3)})`;
          if (sl.leaving && sl.s.x <= 0.02) removeSlot(g, sl);
        }
        if (settledGroup(g)) finishSprings(g);
      }
    },
    settled() {
      for (const g of live) if (g.springy && !settledGroup(g)) return false;
      return true;
    },
  });
}

const near = (s: Spring): boolean => Math.abs(s.x - s.t) < 0.05 && Math.abs(s.v) < 0.5;

function settledGroup(g: GroupState): boolean {
  if (!near(g.W)) return false;
  return g.slots.every(sl => sl.wait === 0 && near(sl.x) && (sl.leaving ? sl.s.x <= 0.02 : Math.abs(sl.s.x - sl.s.t) < 0.005 && Math.abs(sl.s.v) < 0.05));
}

/** Пружины успокоились: точные значения, стопка снова живёт без пружин. */
function finishSprings(g: GroupState): void {
  g.springy = false;
  snap(g.W);
  g.el.style.width = `${g.W.t}px`;
  for (const sl of [...g.slots]) {
    if (sl.leaving) { removeSlot(g, sl); continue; }
    snap(sl.x); snap(sl.s);
    sl.el.style.transform = `translateX(${sl.x.t}px)`;
  }
}

function removeSlot(g: GroupState, sl: Slot): void {
  sl.el.remove();
  const i = g.slots.indexOf(sl);
  if (i >= 0) g.slots.splice(i, 1);
}

/** Аватар или счётчик «+N». */
function makeNode(item: AvatarGroupItem, cls: string): HTMLElement {
  if (item.data) return createUserAvatar(item.data, cls);
  const n = document.createElement('span');
  n.className = `${cls} more user-avatar`;
  return n;
}

function fillNode(el: HTMLElement, item: AvatarGroupItem): void {
  if (item.data) { updateUserAvatar(el, item.data); return; }
  const m = item.more ?? { count: 0, title: '' };
  el.textContent = `+${m.count}`;
  el.title = m.title;
  el.setAttribute('aria-label', m.title);
}

export function createAvatarGroup(opts: AvatarGroupOptions = {}): AvatarGroup {
  const size = opts.size ?? 26;
  const tight = opts.tight ?? 3;
  const openGap = opts.open ?? 10;
  const out = Math.round(size * CURSOR_OUT);
  const root = document.createElement('div');
  root.className = 'avatar-group';
  root.setAttribute('role', 'group');
  root.setAttribute('aria-label', opts.label ?? 'Участники');
  root.style.height = `${size + out}px`;
  // размер аватаров внутри — от диаметра группы (курсор, значок статуса, шрифт)
  root.style.setProperty('--ua-size', `${size}px`);
  const g: GroupState = { el: root, slots: [], W: S(0), springy: false };
  live.add(g);
  let open = false;
  let held = false;
  let leaveTimer = 0;

  const present = (): Slot[] => g.slots.filter(sl => !sl.leaving);
  const interactive = (): boolean => open || present().length <= 1;

  function layout(entering: Set<Slot> = new Set(), opening = false): void {
    const list = present();
    const gap = interactive() && list.length > 1 ? openGap : tight;
    const widthAt = (gp: number): number => (list.length ? (list.length - 1) * (size + gp) + size + out : 0);
    const width = widthAt(gap);
    // ширина свёрнутой стопки: по ней шапка (src/topbar-fit.ts) решает, что убрать, — раскрытие ничего не прячет
    root.dataset.restWidth = String(widthAt(tight));
    root.classList.toggle('open', interactive());
    root.dataset.open = interactive() ? '1' : '0';
    root.classList.toggle('single', list.length <= 1);
    const mode = menuMotion();
    root.classList.toggle('ag-css', mode === 'normal');
    if (mode === 'enhanced') {
      ensureLoop();
      g.springy = true;
      tune(g.W, ...SPREAD);
      g.W.t = width;
      list.forEach((sl, i) => {
        tune(sl.x, ...SPREAD);
        sl.x.t = i * (size + gap);
        if (entering.has(sl)) { sl.x.x = sl.x.t; sl.x.v = 0; sl.s.x = 0.2; sl.s.v = 0; tune(sl.s, ...POP); }
        sl.s.t = 1;
        // раскрывается — разъезжаются по очереди слева направо; сворачивается — все вместе
        sl.wait = opening ? i * STAGGER : 0;
      });
      for (const sl of g.slots) if (sl.leaving) { tune(sl.s, ...GONE); sl.s.t = 0; }
      wake();
      return;
    }
    g.springy = false;
    g.W.x = g.W.t = width;
    root.style.width = `${width}px`;
    list.forEach((sl, i) => {
      sl.x.x = sl.x.t = i * (size + gap);
      sl.s.x = sl.s.t = 1;
      sl.el.style.transform = `translateX(${sl.x.t}px)`;
      if (mode === 'normal' && entering.has(sl)) {
        sl.el.classList.add('ag-enter');
        sl.el.addEventListener('animationend', () => sl.el.classList.remove('ag-enter'), { once: true });
      }
    });
    for (const sl of [...g.slots]) {
      if (!sl.leaving) continue;
      if (mode === 'off') { removeSlot(g, sl); continue; }
      if (sl.el.classList.contains('ag-leave')) continue;
      sl.el.classList.add('ag-leave');
      setTimeout(() => removeSlot(g, sl), CSS_LEAVE_MS);
    }
  }

  function setOpen(on: boolean): void {
    clearTimeout(leaveTimer);
    if (open === on) return;
    if (!on && held) return;
    open = on;
    layout(new Set(), on);
  }

  root.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse') setOpen(true); });
  root.addEventListener('pointerleave', e => {
    if (e.pointerType !== 'mouse' || held) return;
    clearTimeout(leaveTimer);
    leaveTimer = window.setTimeout(() => setOpen(false), LEAVE_MS);
  });
  // нажатие по свёрнутой стопке (планшет) только раскрывает её; по раскрытой — действие аватара
  root.addEventListener('click', e => {
    const target = e.target instanceof Element ? e.target.closest<HTMLElement>('.user-avatar') : null;
    const sl = target ? g.slots.find(s => s.el === target && !s.leaving) : undefined;
    if (!interactive()) {
      e.stopPropagation();
      setOpen(true);
      return;
    }
    if (sl?.item.onActivate) {
      e.stopPropagation();
      sl.item.onActivate(sl.el);
    }
  });
  // перетаскивание и рисование под шапкой не должны начинаться с аватара
  root.addEventListener('pointerdown', e => e.stopPropagation());
  document.addEventListener('pointerdown', e => {
    if (!open || held || !(e.target instanceof Node) || root.contains(e.target)) return;
    setOpen(false);
  }, true);
  root.addEventListener('focusin', () => setOpen(true));
  root.addEventListener('focusout', e => {
    if (e.relatedTarget instanceof Node && root.contains(e.relatedTarget)) return;
    if (!root.matches(':hover')) setOpen(false);
  });
  root.addEventListener('keydown', e => {
    if (e.key === 'Escape' && open && !held) { setOpen(false); (document.activeElement as HTMLElement | null)?.blur(); }
  });

  return {
    el: root,
    set(items) {
      const entering = new Set<Slot>();
      const keys = new Set(items.map(i => i.key));
      for (const sl of g.slots) if (!keys.has(sl.key) && !sl.leaving) { sl.leaving = true; sl.el.setAttribute('aria-hidden', 'true'); sl.el.tabIndex = -1; }
      const next: Slot[] = [];
      for (const item of items) {
        let sl = g.slots.find(s => s.key === item.key && !s.leaving);
        // аватар сменился счётчиком или наоборот — новый узел
        if (sl && !!sl.item.data !== !!item.data) { sl.leaving = true; sl = undefined; }
        if (!sl) {
          const el = makeNode(item, opts.itemClass ?? 'presence-avatar');
          el.classList.add('ag-item');
          sl = { key: item.key, el, item, x: S(0), s: S(1), wait: 0, leaving: false };
          entering.add(sl);
        }
        sl.item = item;
        fillNode(sl.el, item);
        next.push(sl);
      }
      // порядок в документе — порядок в стопке (Tab идёт слева направо); уходящие остаются, пока не исчезнут
      const leaving = g.slots.filter(s => s.leaving);
      g.slots = [...next, ...leaving];
      for (const sl of next) root.appendChild(sl.el);
      for (const sl of leaving) if (sl.el.isConnected) root.appendChild(sl.el);
      // первый показ: без «выпрыгивания» всех сразу
      const first = root.childElementCount === next.length && entering.size === next.length && !root.isConnected;
      layout(first ? new Set() : entering);
    },
    interactive,
    hold(on) {
      held = on;
      if (!on && open && !root.matches(':hover') && !root.contains(document.activeElement)) setOpen(false);
    },
    collapse() { held = false; setOpen(false); },
    node(key) { return g.slots.find(s => s.key === key && !s.leaving)?.el ?? null; },
  };
}
