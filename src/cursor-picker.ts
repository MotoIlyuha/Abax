// Выбор курсора: настоящий холст с выделенной усечённой пирамидой и курсором с именем, слева на холсте —
// прокручиваемый список пресетов. Общий для окна первого входа и раздела настроек «Профиль».
// Мышь входит на холст — курсор с именем «надевается» на неё, выделение пропадает; курсоры списка
// поворачиваются к мыши, рядом — притягиваются, при входе в карточку — надеваются вместо текущего
// (выделение и бейдж на время наведения — цвета этого курсора). Клик — выбор (рамка у карточки).
// Холст живой, как доска: фигуру выделяют кликом и рамкой, снимают выделение кликом по пустому месту,
// переносят и меняют ручками параметров тела (размеры, верхнее основание).
// Разметка курсоров — из каталога (только константы), имя пользователя — только textContent.
// Все анимации — на общем цикле пружин (src/motion.ts): кадры идут, только пока что-то движется.
// В правом верхнем углу — аватар пользователя с курсором, как в шапке (src/avatar.ts): буквы, смайл или фото.

import { CURSOR_CSS_SIZE, CURSOR_PRESETS, cursorCss, cursorPreset, cursorSvg } from './cursors';
import { aabbIntersects, applyHandle, elementAABB, elementHandles, hitTest, translateElement, type AABB } from './geom';
import { atRest, register, reduceMotion, S, snap, step, uiAnimOff, unregister, wake, type MotionComponent, type Spring } from './motion';
import { pickCursor, previewLocked, revertChoice, type CursorChoice } from './onboarding-logic';
import { drawSelectionPreview, renderScene } from './renderer';
import { fitSolid } from './solid';
import type { Camera, Handle, SolidEl } from './types';
import { CHEVRON_UP_ICON } from './icons';
import { createUserAvatar, updateUserAvatar, type AvatarData } from './avatar';

export interface CursorPickerOptions {
  choice: CursorChoice;
  /** Есть право на Pro-курсоры. */
  entitled: boolean;
  /** Имя в бейдже превью. */
  name: string;
  /** Аватар в углу превью: смайл, фото или null — буквы имени. */
  avatar?: string | null;
  onChange(choice: CursorChoice): void;
}

export interface CursorPicker {
  el: HTMLElement;
  /** Обновить имя в бейдже превью. */
  setName(name: string): void;
  /** Обновить аватар в углу превью. */
  setAvatar(avatar: string | null): void;
  choice(): CursorChoice;
  /** Снять наблюдатели и анимации (окно закрыли). */
  dispose(): void;
}

// ----- геометрия (чистые функции — проверяются юнит-тестами) -----

/** Размер иконки курсора в карточке и самого курсора, px. */
export const ICON_SIZE = 24;
const ARROW_SIZE = CURSOR_CSS_SIZE;
/** Центр поворота иконки (≈ центр масс стрелки) и кончик — в долях стороны. */
const ORIGIN_K = 12 / 32;
const TIP_K = 3 / 32;
/** Куда смотрит стрелка без поворота: кончик из центра — влево-вверх. */
const BASE_ANGLE = Math.atan2(TIP_K - ORIGIN_K, TIP_K - ORIGIN_K);
/** Притяжение: радиус, доля пути к мыши и предел смещения, px. */
export const MAGNET_R = 64;
const MAGNET_K = 0.4;
const MAGNET_MAX = 11;

/** Угол в (-π, π]. */
export function wrapAngle(a: number): number {
  a = (a + Math.PI) % (2 * Math.PI);
  if (a <= 0) a += 2 * Math.PI;
  return a - Math.PI;
}

/** Поворот иконки (рад), при котором её кончик смотрит из (cx, cy) на (mx, my). */
export function lookAngle(cx: number, cy: number, mx: number, my: number): number {
  if (mx === cx && my === cy) return 0;
  return wrapAngle(Math.atan2(my - cy, mx - cx) - BASE_ANGLE);
}

/** Смещение иконки к мыши: (dx, dy) — от центра иконки до мыши. Плавно гаснет к краю радиуса. */
export function magnetOffset(dx: number, dy: number): { x: number; y: number } {
  const d = Math.hypot(dx, dy);
  if (d >= MAGNET_R || d === 0) return { x: 0, y: 0 };
  const edge = MAGNET_R * 0.55;
  const t = d <= edge ? 1 : 1 - (d - edge) / (MAGNET_R - edge);
  const fall = t * t * (3 - 2 * t);
  let x = dx * MAGNET_K * fall;
  let y = dy * MAGNET_K * fall;
  const len = Math.hypot(x, y);
  if (len > MAGNET_MAX) { x *= MAGNET_MAX / len; y *= MAGNET_MAX / len; }
  return { x, y };
}

/** Полоса прокрутки списка: размер и сдвиг ползунка на дорожке track, нужны ли кнопки вверх/вниз. */
export function scrollThumb(scrollH: number, clientH: number, scrollTop: number, track: number, min = 24): {
  over: boolean; size: number; offset: number; up: boolean; down: boolean;
} {
  const max = scrollH - clientH;
  if (max <= 1 || clientH <= 0) return { over: false, size: 0, offset: 0, up: false, down: false };
  const size = Math.min(track, Math.max(min, (track * clientH) / scrollH));
  const k = Math.max(0, Math.min(1, scrollTop / max));
  return { over: true, size, offset: k * (track - size), up: scrollTop > 1, down: scrollTop < max - 1 };
}

const easeOut = (t: number): number => 1 - (1 - t) ** 3;

// ----- DOM -----

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** Разметка курсоров из каталога: строится один раз на пресет и размер. */
const svgMemo = new Map<string, string>();
function svgOf(id: string, size: number): string {
  const key = `${id}:${size}`;
  let s = svgMemo.get(key);
  if (!s) { s = cursorSvg(id, { size }); svgMemo.set(key, s); }
  return s;
}
const cssMemo = new Map<string, string>();
function cssOf(id: string): string {
  let s = cssMemo.get(id);
  if (!s) { s = cursorCss(id); cssMemo.set(id, s); }
  return s;
}

/** Попадание по каркасу и по ручке, px (как на доске). */
const HIT_TOL = 6;
const HANDLE_HIT = 8;

/** Цвет и толщина каркаса тела на превью. */
const SOLID_STYLE = { id: 'cp-demo', color: '#1f2329', width: 2 };

interface Item {
  id: string;
  btn: HTMLButtonElement;
  icon: HTMLElement;
  /** Левый верхний угол иконки в координатах содержимого списка (без прокрутки). */
  ix: number; iy: number;
  ox: Spring; oy: Spring; rot: Spring;
  /** Последнее записанное в DOM (чтобы не трогать стиль без изменений). */
  w: string;
}

/** Анимация курсора к цели: смещение от цели, поворот и масштаб гаснут за dur секунд. */
interface Tween { dx: number; dy: number; rot: number; scale: number; t: number; dur: number }

export function createCursorPicker(o: CursorPickerOptions): CursorPicker {
  let choice = o.choice;
  let name = o.name;
  let avatar = o.avatar ?? null;
  const root = el('div', 'cp');

  // ----- холст -----
  const preview = el('div', 'cp-preview');
  const scene = el('canvas', 'cp-scene');
  const selection = el('canvas', 'cp-selection');
  scene.setAttribute('aria-hidden', 'true');
  selection.setAttribute('aria-hidden', 'true');

  // ----- список курсоров слева -----
  const rail = el('div', 'cp-rail');
  const list = el('div', 'cp-scroller');
  list.setAttribute('role', 'radiogroup');
  list.setAttribute('aria-label', 'Курсор');
  const thumb = el('div', 'cp-thumb');
  thumb.setAttribute('aria-hidden', 'true');
  const up = el('button', 'cp-scroll-btn cp-up');
  const down = el('button', 'cp-scroll-btn cp-down');
  for (const b of [up, down]) {
    b.type = 'button';
    b.tabIndex = -1;
    b.setAttribute('aria-hidden', 'true');
    b.innerHTML = CHEVRON_UP_ICON;
  }
  const items: Item[] = [];
  for (const p of CURSOR_PRESETS) {
    const b = el('button', 'cp-item');
    b.type = 'button';
    b.dataset.cursor = p.id;
    b.setAttribute('role', 'radio');
    // без title: название и так на карточке, а всплывающая подсказка закрыла бы соседние
    if (p.tier === 'pro') b.setAttribute('aria-label', `${p.name}, Pro`);
    b.style.setProperty('--cp-item-sel', p.selectionColor);
    const icon = el('span', 'cp-item-icon');
    icon.innerHTML = svgOf(p.id, ICON_SIZE);
    b.append(icon, el('span', 'cp-item-name', p.name));
    // бейдж — признак уровня курсора: виден и тем, у кого есть подписка
    if (p.tier === 'pro') b.appendChild(el('span', 'cp-pro', 'Pro'));
    b.addEventListener('click', () => set(pickCursor(choice, p.id, o.entitled)));
    list.appendChild(b);
    items.push({ id: p.id, btn: b, icon, ix: 0, iy: 0, ox: S(0, 320, 26), oy: S(0, 320, 26), rot: S(0, 220, 26), w: '' });
  }
  rail.append(list, thumb, up, down);

  // ----- курсор с именем -----
  const pointer = el('div', 'cp-pointer');
  pointer.setAttribute('aria-hidden', 'true');
  const ghost = el('i', 'cp-arrow cp-arrow-ghost');
  const arrow = el('i', 'cp-arrow');
  const badge = el('span', 'cp-badge');
  pointer.append(ghost, arrow, badge);

  preview.append(scene, selection, rail, pointer);

  const lock = el('div', 'cp-lock');
  lock.setAttribute('role', 'status');
  const lockText = el('span', 'cp-lock-text', 'Доступно в подписке Pro');
  const back = el('button', 'cp-lock-back', 'Вернуться к бесплатному курсору');
  back.type = 'button';
  back.addEventListener('click', () => set(revertChoice(choice)));
  lock.append(lockText, back);

  // мой аватар с курсором — как в шапке, на самом холсте (мышь над ним не уходит с холста);
  // курсор и цвета — того, что сейчас примеряется
  const faceData = (): AvatarData => {
    const p = cursorPreset(displayed());
    return { name, bg: p.badgeBg, fg: p.badgeText, cursorId: p.id, avatar, status: 'online', title: 'Это ваш аватар' };
  };
  const face = createUserAvatar({ name, bg: '#868e96', fg: '#ffffff', status: 'online', title: 'Это ваш аватар' }, 'cp-face');
  face.tabIndex = -1;
  preview.insertBefore(face, pointer);

  root.append(preview, lock);

  // ----- состояние -----
  /** Размер холста, px CSS. */
  let W = 0, H = 0;
  let demo: SolidEl | null = null;
  const cam: Camera = { x: 0, y: 0, zoom: 1 };
  /** Где стоит курсор, пока мыши нет на холсте. */
  let restX = 0, restY = 0;
  /** Сдвиг содержимого списка относительно холста. */
  let listX = 0, listY = 0;
  /** Мышь на холсте и её координаты. */
  let inside = false;
  let mx = 0, my = 0;
  /** Карточка под мышью. */
  let hovered: Item | null = null;
  /** Какой курсор сейчас надет на мышь (или стоит у фигуры). */
  let worn = choice.preview;
  let wornSvg = '';
  let tween: Tween | null = null;
  /** Последнее показанное положение курсора (для анимаций из текущей точки). */
  let px = 0, py = 0, prot = 0, pscale = 1;
  let pw = '';
  /** Аппаратный курсор вместо нарисованного (мышь на холсте и анимаций нет) — без задержки кадра. */
  let hw = false;
  let animate = true;
  let selColor = '';
  let selVisible = true;
  let disposed = false;
  /** Ширина бейджа с именем и бейдж слева от курсора (у правого края холста). */
  let badgeW = 0;
  let flipped = false;
  /** Фигура выделена. Пока мыши нет, она выделена напоказ; мышь пришла — выделение снимается. */
  let selected = true;
  /** Правый край списка: фигура не заходит под него. */
  let railRight = 0;
  /** Рамка выделения областью (координаты холста). */
  let marquee: AABB | null = null;
  /** Слои ждут перерисовки на ближайшем кадре. */
  let sceneDirty = false, selDirty = false;

  const displayed = (): string => hovered?.id ?? choice.preview;

  // ----- отрисовка холста -----

  function layout(): void {
    const w = preview.clientWidth, h = preview.clientHeight;
    if (!w || !h) return;
    const sizeChanged = w !== W || h !== H;
    W = w; H = h;
    measureItems();
    railRight = rail.offsetLeft + rail.offsetWidth;
    if (sizeChanged || !demo) {
      // фигуру заново расставляем только при смене размера холста — правки пользователя живут до него
      const free = Math.max(80, W - railRight);
      const bw = Math.max(60, Math.min(200, free - 80, ((H - 110) * 170) / 150));
      const bh = (bw * 150) / 170;
      // фигура чуть левее центра: справа от курсора у фигуры остаётся место под бейдж
      const bx = railRight + Math.max(16, (free - bw) * 0.4);
      const by = (H - bh) / 2 - 14;
      demo = fitSolid('truncPyramid', bx, by, bx + bw, by + bh, SOLID_STYLE);
      sceneDirty = selDirty = true;
    }
    restFromDemo();
    if (!inside && !tween) { px = restX; py = restY; }
    badge.style.maxWidth = `${Math.max(80, Math.min(220, W - 60))}px`;
    measureBadge();
    updateScrollUi();
    wake();
  }

  /** Курсор у правой нижней ручки фигуры: бейдж с именем — под ней, не закрывает её. */
  function restFromDemo(): void {
    if (!demo) return;
    const a = elementAABB(demo);
    restX = Math.min(a.x1 - 24, W - 40);
    restY = Math.max(20, Math.min(a.y1 - 4, H - 50));
  }

  function fitCanvas(c: HTMLCanvasElement): CanvasRenderingContext2D | null {
    const dpr = window.devicePixelRatio || 1;
    const cw = Math.round(W * dpr), ch = Math.round(H * dpr);
    if (c.width !== cw || c.height !== ch) { c.width = cw; c.height = ch; }
    return c.getContext('2d');
  }

  /** Каркас тела — настоящим рендерером доски; перерисовывается только при смене размера. */
  function drawScene(): void {
    if (!demo || !W) return;
    const ctx = fitCanvas(scene);
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    renderScene(ctx, [demo], cam, W, H, dpr, 'none', undefined, true);
    if (marquee) {
      // рамка выделения областью — как на доске: цвет выделения, лёгкая заливка
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const x = Math.min(marquee.x0, marquee.x1), y = Math.min(marquee.y0, marquee.y1);
      const w = Math.abs(marquee.x1 - marquee.x0), h = Math.abs(marquee.y1 - marquee.y0);
      ctx.fillStyle = selColor;
      ctx.globalAlpha = 0.06;
      ctx.fillRect(x, y, w, h);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = selColor;
      ctx.lineWidth = 1;
      ctx.strokeRect(x, y, w, h);
    }
  }

  /** Рамка и ручки выделения — отдельный слой: смена цвета не трогает тело, скрытие — через opacity. */
  function drawSelection(): void {
    if (!demo || !W) return;
    const ctx = fitCanvas(selection);
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    drawSelectionPreview(ctx, demo, cam, selColor);
  }

  /** Цвета выделения и бейджа, видимость выделения, вид курсора — по наведению и выбору. */
  function paintLook(): void {
    const p = cursorPreset(displayed());
    if (p.selectionColor !== selColor) {
      selColor = p.selectionColor;
      preview.style.setProperty('--cp-sel', selColor);
      selDirty = true;
      if (marquee) sceneDirty = true;
      wake();
    }
    preview.dataset.effect = p.effect;
    badge.style.background = p.badgeBg;
    badge.style.color = p.badgeText;
    // на карточке курсора выделение видно всегда — примерка цвета
    const vis = selected || hovered !== null;
    if (vis !== selVisible) {
      selVisible = vis;
      preview.classList.toggle('cp-hide-sel', !vis);
    }
    preview.dataset.selected = selected ? 'true' : 'false';
    wear(displayed());
    updateUserAvatar(face, faceData());
  }

  function wear(id: string): void {
    worn = id;
    const svg = svgOf(id, ARROW_SIZE);
    if (svg !== wornSvg) { wornSvg = svg; arrow.innerHTML = svg; }
    if (hw) preview.style.cursor = cssOf(id);
  }

  function paint(): void {
    paintLook();
    badge.textContent = name;
    const locked = previewLocked(choice);
    lock.hidden = !locked;
    root.classList.toggle('locked', locked);
    for (const it of items) {
      const on = it.id === choice.preview;
      it.btn.classList.toggle('active', on);
      it.btn.setAttribute('aria-checked', on ? 'true' : 'false');
      it.btn.tabIndex = on ? 0 : -1;
    }
  }

  function measureBadge(): void {
    badgeW = badge.offsetWidth;
    pw = ''; // пересчитать сторону бейджа на ближайшем кадре
    wake();
  }

  function set(next: CursorChoice): void {
    choice = next;
    paint();
    o.onChange(choice);
  }

  // ----- список: положения иконок и прокрутка -----

  function measureItems(): void {
    listX = rail.offsetLeft + list.offsetLeft;
    listY = rail.offsetTop + list.offsetTop;
    for (const it of items) {
      it.ix = it.btn.offsetLeft + it.icon.offsetLeft;
      it.iy = it.btn.offsetTop + it.icon.offsetTop;
    }
  }

  /** Центр поворота иконки в координатах холста (с учётом прокрутки, без пружин). */
  function iconOrigin(it: Item): { x: number; y: number } {
    return { x: listX + it.ix + ICON_SIZE * ORIGIN_K, y: listY + it.iy - list.scrollTop + ICON_SIZE * ORIGIN_K };
  }

  let thumbSize = 0;
  function updateScrollUi(): void {
    const track = list.clientHeight - 12;
    const s = scrollThumb(list.scrollHeight, list.clientHeight, list.scrollTop, track);
    thumbSize = s.size;
    rail.classList.toggle('scrollable', s.over);
    up.classList.toggle('show', s.up);
    down.classList.toggle('show', s.down);
    if (s.over) {
      thumb.style.height = `${s.size}px`;
      thumb.style.transform = `translate3d(0, ${6 + s.offset}px, 0)`;
    }
  }

  list.addEventListener('scroll', () => {
    updateScrollUi();
    if (inside) retarget();
  }, { passive: true });

  const pageStep = (): number => Math.max(40, list.clientHeight - 56);
  up.addEventListener('click', () => list.scrollBy({ top: -pageStep(), behavior: animate ? 'smooth' : 'auto' }));
  down.addEventListener('click', () => list.scrollBy({ top: pageStep(), behavior: animate ? 'smooth' : 'auto' }));

  // перетаскивание ползунка
  let drag: { y: number; top: number } | null = null;
  thumb.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    e.preventDefault();
    drag = { y: e.clientY, top: list.scrollTop };
    thumb.setPointerCapture(e.pointerId);
    rail.classList.add('dragging');
  });
  thumb.addEventListener('pointermove', e => {
    if (!drag) return;
    const track = list.clientHeight - 12 - thumbSize;
    const max = list.scrollHeight - list.clientHeight;
    if (track > 0) list.scrollTop = drag.top + ((e.clientY - drag.y) * max) / track;
  });
  const endDrag = (): void => { drag = null; rail.classList.remove('dragging'); };
  thumb.addEventListener('pointerup', endDrag);
  thumb.addEventListener('pointercancel', endDrag);

  /** Прокрутить список так, чтобы карточка была видна целиком. */
  function reveal(it: Item, center = false): void {
    const top = it.btn.offsetTop, h = it.btn.offsetHeight, ch = list.clientHeight;
    if (!ch) return;
    const pad = 28; // под кнопками прокрутки
    if (center) list.scrollTop = top - (ch - h) / 2;
    else if (top - pad < list.scrollTop) list.scrollTop = top - pad;
    else if (top + h + pad > list.scrollTop + ch) list.scrollTop = top + h + pad - ch;
  }

  // клавиатура: стрелки — как у группы переключателей
  list.addEventListener('keydown', e => {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const i = items.findIndex(it => it.id === choice.preview);
    const it = items[(i + step + items.length) % items.length];
    set(pickCursor(choice, it.id, o.entitled));
    it.btn.focus({ preventScroll: true });
    reveal(it);
  });

  // ----- мышь на холсте -----

  /** Цели пружин иконок: поворот к мыши и притяжение; без мыши — исходное положение. */
  function retarget(): void {
    for (const it of items) {
      if (!inside || !animate) {
        it.ox.t = 0; it.oy.t = 0; it.rot.t = it.rot.x + wrapAngle(-it.rot.x);
        if (!animate) { snap(it.ox); snap(it.oy); snap(it.rot); }
        continue;
      }
      const c = iconOrigin(it);
      const m = magnetOffset(mx - c.x, my - c.y);
      it.ox.t = m.x;
      it.oy.t = m.y;
      // кратчайший поворот от текущего угла
      const a = lookAngle(c.x + m.x, c.y + m.y, mx, my);
      it.rot.t = it.rot.x + wrapAngle(a - it.rot.x);
    }
    wake();
  }

  function startTween(dx: number, dy: number, rot: number, scale: number, dur: number): void {
    tween = animate && dur > 0 ? { dx, dy, rot, scale, t: 0, dur } : null;
    setHw();
  }

  function setHw(): void {
    const next = inside && !tween;
    if (next === hw) return;
    hw = next;
    pointer.classList.toggle('hw', hw);
    preview.style.cursor = hw ? cssOf(worn) : inside ? 'none' : '';
  }

  /** Кончик иконки карточки сейчас (с пружинами) — откуда курсор «перелетает» на мышь. */
  function iconTip(it: Item): { x: number; y: number } {
    const c = iconOrigin(it);
    const r = ICON_SIZE * (TIP_K - ORIGIN_K);
    const a = it.rot.x;
    const cos = Math.cos(a), sin = Math.sin(a);
    return { x: c.x + it.ox.x + r * cos - r * sin, y: c.y + it.oy.x + r * sin + r * cos };
  }

  /** Старый курсор тает на месте, пока новый надевается. */
  function fadeGhost(): void {
    if (typeof ghost.animate !== 'function' || !animate) return;
    ghost.innerHTML = wornSvg;
    ghost.style.transform = arrow.style.transform;
    ghost.animate(
      [{ opacity: 1, transform: `${arrow.style.transform} scale(1)` }, { opacity: 0, transform: `${arrow.style.transform} scale(0.55)` }],
      { duration: 150, easing: 'ease-out' },
    );
  }

  /** Отпустить карточку: её иконка возвращается в список из точки мыши. */
  function release(it: Item): void {
    it.icon.classList.remove('worn');
    if (!animate) return;
    const c = iconOrigin(it);
    const r = ICON_SIZE * (TIP_K - ORIGIN_K);
    it.ox.x = mx - (c.x + r);
    it.oy.x = my - (c.y + r);
    it.rot.x = 0;
    it.ox.v = it.oy.v = it.rot.v = 0;
  }

  /** fly — курсор карточки перелетает из её иконки на мышь (при входе на холст сразу на карточку — нет). */
  function setHovered(next: Item | null, fly = true): void {
    if (next === hovered) return;
    const prev = hovered;
    if (prev) release(prev);
    if (next) {
      // надевается курсор карточки: из её иконки на мышь
      const tip = iconTip(next);
      if (!prev && fly) fadeGhost();
      hovered = next;
      next.icon.classList.add('worn');
      if (fly) startTween(tip.x - mx, tip.y - my, next.rot.x, ICON_SIZE / ARROW_SIZE, 0.16);
    } else {
      hovered = null;
      // ушли с карточки на холст — вернулся выбранный курсор
      if (prev && prev.id !== choice.preview) startTween(0, 0, 0, 0.6, 0.16);
    }
    paintLook();
    retarget();
  }

  const itemAt = (t: EventTarget | null): Item | null => {
    const b = t instanceof Element ? t.closest<HTMLElement>('.cp-item') : null;
    return b ? items.find(it => it.btn === b) ?? null : null;
  };

  function locate(e: PointerEvent): void {
    const r = preview.getBoundingClientRect();
    mx = e.clientX - r.left;
    my = e.clientY - r.top;
  }

  // ----- холст как доска: выделение, рамка, перенос, ручки параметров -----

  type Act =
    | { kind: 'move'; pid: number; x: number; y: number; orig: SolidEl }
    | { kind: 'param'; pid: number; h: Handle; orig: SolidEl }
    | { kind: 'marquee'; pid: number };
  let act: Act | null = null;

  function handleAt(x: number, y: number): Handle | null {
    if (!selected || !demo) return null;
    for (const hp of elementHandles(demo, cam.zoom)) {
      if (Math.hypot(hp.x - x, hp.y - y) <= HANDLE_HIT) return hp.h;
    }
    return null;
  }

  /** Фигура целиком остаётся на холсте правее списка. */
  const area = (): AABB => ({ x0: railRight + 6, y0: 6, x1: W - 6, y1: H - 6 });
  const inArea = (a: AABB, b: AABB): boolean => a.x0 >= b.x0 && a.y0 >= b.y0 && a.x1 <= b.x1 && a.y1 <= b.y1;

  function redraw(): void {
    sceneDirty = selDirty = true;
    wake();
  }

  function drive(): void {
    if (!act || !demo) return;
    if (act.kind === 'move') {
      const a = elementAABB(act.orig), b = area();
      const dx = Math.max(b.x0 - a.x0, Math.min(b.x1 - a.x1, mx - act.x));
      const dy = Math.max(b.y0 - a.y0, Math.min(b.y1 - a.y1, my - act.y));
      demo = translateElement(act.orig, dx, dy) as SolidEl;
    } else if (act.kind === 'param') {
      const next = applyHandle(act.orig, act.h, { x: mx, y: my, p: 0.5 }) as SolidEl;
      // за край холста фигура не растёт: ручка упирается
      if (inArea(elementAABB(next), area())) demo = next;
    } else if (marquee) {
      marquee.x1 = mx;
      marquee.y1 = my;
    }
    redraw();
  }

  preview.addEventListener('pointerdown', e => {
    if (e.button !== 0 || !demo || act || !W) return;
    if (e.target instanceof Node && rail.contains(e.target)) return;
    locate(e);
    const h = handleAt(mx, my);
    if (h) act = { kind: 'param', pid: e.pointerId, h, orig: demo };
    else if (hitTest(demo, mx, my, HIT_TOL / cam.zoom)) {
      selected = true;
      act = { kind: 'move', pid: e.pointerId, x: mx, y: my, orig: demo };
    } else {
      // пустое место: выделение снимается, начинается рамка
      selected = false;
      marquee = { x0: mx, y0: my, x1: mx, y1: my };
      act = { kind: 'marquee', pid: e.pointerId };
    }
    e.preventDefault();
    try { preview.setPointerCapture(e.pointerId); } catch { /* указатель уже отпущен */ }
    paintLook();
    redraw();
  });

  function finishAct(e: PointerEvent): void {
    if (!act || e.pointerId !== act.pid) return;
    if (act.kind === 'marquee' && marquee && demo) {
      const r = {
        x0: Math.min(marquee.x0, marquee.x1), y0: Math.min(marquee.y0, marquee.y1),
        x1: Math.max(marquee.x0, marquee.x1), y1: Math.max(marquee.y0, marquee.y1),
      };
      // клик без протягивания — просто снять выделение; рамка — выделить задетое (как на доске)
      selected = (r.x1 - r.x0 > 2 || r.y1 - r.y0 > 2) && aabbIntersects(elementAABB(demo), r);
      marquee = null;
    }
    act = null;
    restFromDemo();
    paintLook();
    redraw();
  }
  preview.addEventListener('pointerup', finishAct);
  preview.addEventListener('pointercancel', finishAct);

  // скролл и кнопки списка — только пока мышь над списком
  rail.addEventListener('pointerenter', e => { if (e.pointerType !== 'touch') rail.classList.add('hover'); });
  rail.addEventListener('pointerleave', () => rail.classList.remove('hover'));

  preview.addEventListener('pointerenter', e => {
    if (e.pointerType === 'touch') return;
    animate = !reduceMotion() && !uiAnimOff();
    measureItems();
    locate(e);
    inside = true;
    // мышь пришла — показное выделение снимается, дальше холст ведёт себя как доска
    selected = false;
    // курсор с именем «надевается» на мышь из своей точки
    startTween(px - mx, py - my, prot, pscale, 0.2);
    setHovered(itemAt(e.target), false);
    paintLook();
    retarget();
  });
  preview.addEventListener('pointermove', e => {
    const own = act !== null && e.pointerId === act.pid;
    if (own || (inside && e.pointerType !== 'touch')) locate(e);
    if (own) drive();
    if (inside && e.pointerType !== 'touch') retarget();
  });
  preview.addEventListener('pointerover', e => {
    if (!inside || e.pointerType === 'touch' || act) return;
    setHovered(itemAt(e.target));
  });
  preview.addEventListener('pointerleave', e => {
    if (!inside || e.pointerType === 'touch') return;
    if (hovered) release(hovered);
    hovered = null;
    inside = false;
    // мышь ушла — фигура снова выделена напоказ
    selected = true;
    restFromDemo();
    // курсор возвращается к фигуре
    startTween(px - restX, py - restY, prot, pscale, 0.3);
    setHw();
    paintLook();
    retarget();
  });

  // ----- цикл анимации -----

  const motion: MotionComponent = {
    frame(dt) {
      if (tween) tween.t += dt;
      for (const it of items) { step(it.ox, dt); step(it.oy, dt); step(it.rot, dt); }
    },
    render() {
      if (sceneDirty) { sceneDirty = false; drawScene(); }
      if (selDirty) { selDirty = false; drawSelection(); }
      for (const it of items) {
        const w = `translate3d(${it.ox.x.toFixed(2)}px, ${it.oy.x.toFixed(2)}px, 0) rotate(${it.rot.x.toFixed(4)}rad)`;
        if (w !== it.w) { it.w = w; it.icon.style.transform = w; }
      }
      let x = inside ? mx : restX, y = inside ? my : restY, r = 0, s = 1;
      if (tween) {
        const k = Math.min(1, tween.t / tween.dur);
        const e = easeOut(k);
        x += tween.dx * (1 - e);
        y += tween.dy * (1 - e);
        r = tween.rot * (1 - e);
        s = tween.scale + (1 - tween.scale) * e;
        if (k >= 1) { tween = null; setHw(); }
      }
      px = x; py = y; prot = r; pscale = s;
      const w = `${x.toFixed(2)},${y.toFixed(2)},${r.toFixed(4)},${s.toFixed(3)}`;
      if (w !== pw) {
        pw = w;
        pointer.style.transform = `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0)`;
        arrow.style.transform = r || s !== 1 ? `rotate(${r.toFixed(4)}rad) scale(${s.toFixed(3)})` : '';
        // бейдж не вылезает за правый край: переворачивается на левую сторону курсора
        const flip = W > 0 && x + 22 + badgeW > W - 4 && x - 10 - badgeW >= 4;
        if (flip !== flipped) { flipped = flip; pointer.classList.toggle('flip', flip); }
      }
    },
    settled() {
      if (tween || sceneDirty || selDirty) return false;
      for (const it of items) if (!atRest(it.ox, 0.05) || !atRest(it.oy, 0.05) || !atRest(it.rot, 0.002)) return false;
      return true;
    },
  };
  register(motion);

  // ----- размер холста -----
  let first = true;
  const ro = typeof ResizeObserver === 'function'
    ? new ResizeObserver(() => {
      if (disposed) return;
      layout();
      if (first && W) {
        first = false;
        const it = items.find(i => i.id === choice.preview);
        if (it) reveal(it, true);
        updateScrollUi();
      }
    })
    : null;
  ro?.observe(preview);

  paint();
  return {
    el: root,
    setName(n: string) {
      if (n === name) return;
      name = n;
      badge.textContent = n;
      updateUserAvatar(face, faceData());
      if (W) measureBadge();
    },
    setAvatar(a: string | null) {
      if (a === avatar) return;
      avatar = a;
      updateUserAvatar(face, faceData());
    },
    choice: () => choice,
    dispose() {
      if (disposed) return;
      disposed = true;
      ro?.disconnect();
      unregister(motion);
    },
  };
}
