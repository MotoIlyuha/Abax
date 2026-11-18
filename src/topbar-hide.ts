// Плавное скрытие групп кнопок шапки (меню «Скрыть»): при «Улучшенных» анимациях группа
// уезжает влево ПОД соседние плашки и растворяется, а плашки справа от неё съезжают следом.
// Сдвиг — отрицательный margin-left на ширину группы и зазор, поэтому соседи двигаются сами.
// «Обычные» и «Выкл» — как раньше: группа пропадает и появляется сразу.

import { S, atRest, clamp, motionEnabled, register, snap, spring, step, tune, uiAnimOff, wake, type Spring } from './motion';

/** Крупный сдвиг панели: без заметного перелёта. */
const SOFT_FALLBACK = [260, 24] as const;

interface Slot {
  el: HTMLElement;
  /** 0 — группа на месте, 1 — спрятана под соседом. */
  h: Spring;
  /** Ширина группы вместе с зазором до соседа. */
  shift: number;
  setClass: (hidden: boolean) => void;
}

const slots = new Map<HTMLElement, Slot>();
/** Группы в движении. */
const moving = new Set<Slot>();
let registered = false;

function ensureLoop(): void {
  if (registered) return;
  registered = true;
  register({
    frame(dt) { for (const s of moving) step(s.h, dt); },
    render() {
      for (const s of moving) {
        if (atRest(s.h, 0.002)) { snap(s.h); finish(s); continue; }
        paint(s);
      }
    },
    settled: () => moving.size === 0,
  });
}

function paint(s: Slot): void {
  s.el.style.marginLeft = `${(-s.shift * s.h.x).toFixed(2)}px`;
  s.el.style.opacity = clamp(1 - s.h.x, 0, 1).toFixed(3);
}

function clear(el: HTMLElement): void {
  for (const p of ['margin-left', 'opacity', 'pointer-events']) el.style.removeProperty(p);
  el.classList.remove('topbar-sliding');
}

function finish(s: Slot): void {
  moving.delete(s);
  // спряталась до конца — теперь её можно убрать из раскладки
  if (s.h.t === 1) s.setClass(true);
  clear(s.el);
}

const animated = (): boolean => motionEnabled() && !uiAnimOff();

/**
 * Прячет или показывает группу шапки. setClass ставит/снимает класс на body, который
 * убирает группу из раскладки (display: none): при скрытии — в конце анимации, при показе — сразу.
 */
export function setTopbarGroupHidden(el: HTMLElement, hidden: boolean, setClass: (hidden: boolean) => void): void {
  let s = slots.get(el);
  if (!s) { s = { el, h: S(0), shift: 0, setClass }; slots.set(el, s); }
  s.setClass = setClass;
  const inMotion = moving.has(s);
  // «Отменить / Повторить», переехавшие под панель инструментов (адаптивная шапка), не сдвигаем
  if (!animated() || getComputedStyle(el).position === 'fixed') {
    moving.delete(s); snap(s.h); clear(el);
    setClass(hidden);
    return;
  }
  if (hidden) {
    // уже не видна (скрыта или её прячет режим гостя) — двигать нечего
    if (!inMotion && el.offsetParent === null) { setClass(true); return; }
    if (!inMotion) s.h.x = 0;
  } else {
    const wasGone = el.offsetParent === null;
    setClass(false);
    if (el.offsetParent === null) return; // не показывается по другой причине
    if (!inMotion) s.h.x = wasGone ? 1 : 0;
  }
  // ширина без нашего сдвига: margin не влияет на offsetWidth
  const gap = parseFloat(getComputedStyle(el.parentElement ?? el).columnGap) || 0;
  s.shift = el.offsetWidth + gap;
  s.h.t = hidden ? 1 : 0;
  tune(s.h, ...spring('--spring-soft', SOFT_FALLBACK));
  el.classList.add('topbar-sliding');
  el.style.pointerEvents = hidden ? 'none' : '';
  paint(s);
  moving.add(s);
  ensureLoop();
  wake();
}
