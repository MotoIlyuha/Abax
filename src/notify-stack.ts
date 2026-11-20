// Стопка уведомлений (SPEC_CHAT §4): #notify-stack под кнопкой «Чат и уведомления», вместо пилюль комнаты.
// По образцам:
//  • Notification stack (Kokonut UI, MIT) — несколько карточек — свёрнутая стопка: передняя и две выглядывают снизу
//    (PEEK 10, масштаб 1 − 0.05·глубина, содержимое задних гаснет); наведение или фокус — список с заголовком
//    «Новые · N» и кнопкой «Скрыть»; смахивание вбок (DISMISS 100 px или флик 0.11 px/мс, возврат — пружина 520
//    с критическим затуханием, улёт ≥ 1400 px/с с ускорением 4200), × и Delete/Backspace;
//  • Focus mode (designbookmark) — новая карточка влетает спереди (падение −14 px, масштаб .96→1, прозрачность и
//    размытие); через STACK_IDLE_MS без новых, наведения, фокуса и перетаскивания задние подъезжают под переднюю,
//    и вся стопка уходит в кнопку ЧУ (к её центру, масштаб ~0.2, гаснет), кнопка «принимает» её, счётчик
//    перекатывается, когда карточки долетели. Наведение на кнопку — стопка поднимается из неё и раскладывается.
// В стопке — до STACK_MAX последних непрочитанных и не убранных уведомлений: показанные сейчас и ушедшие в кнопку.
// Тихие (отклик на моё действие) видны STACK_QUIET_MS и исчезают, не уходя в кнопку. «Не беспокоить» — стопка не
// показывается, уведомление «падает» в кнопку (в «Улучшенных» — короткий призрак карточки под кнопкой).
// Три режима анимаций: «Улучшенные» — пружины общего цикла src/motion.ts; «Обычные» — CSS transform/opacity
// 300 мс cubic-bezier(.23,1,.32,1); «Выкл» и «уменьшить движение» — сразу.
// Пока боковая панель открыта в режиме ЧУ, стопка не показывается и наведение на кнопку её не поднимает
// (уведомления сразу в ленте — вид панели сам помечает их прочитанными); открылась панель в другом режиме —
// показанная стопка уходит в кнопку. Щелчок по карточке — её onClick или панель ЧУ на нужной вкладке.
// Имена и тексты приходят от других участников — только textContent; SVG — константы каталога иконок.

import { S, clamp, register, step, tune, wake, type Spring } from './motion';
import { menuMotion, type MenuMotion } from './menu-motion';
import { CLOSE_ICON } from './icons';
import { noticeContent, noticeMedia, paintNoticeTime } from './notice-card';
import { doNotDisturb, markNoticeRead, noticeText, onNotices, type Notice, type NoticeEvent } from './notify-center';
import { notifyAbsorb, notifyButton, setNotifyPending } from './notify-button';
import { onSidePanel, openSidePanel, sidePanelMode, sidePanelOpen } from './side-panel';
import { revealChatMessage, setNotifyTab } from './notify-panel';

/** Боковая панель открыта в режиме ЧУ: уведомления сразу в ленте, стопка не показывается. */
const panelNotify = (): boolean => sidePanelOpen() && sidePanelMode() === 'notify';

/** Сколько уведомлений держит стопка: новое вытесняет самое старое. */
export const STACK_MAX = 5;
/** Через сколько после последнего нового стопка уходит в кнопку ЧУ. */
export const STACK_IDLE_MS = 5000;
/** Сколько видно тихое уведомление. */
export const STACK_QUIET_MS = 3500;
/** Через сколько после ухода мыши (фокуса, перетаскивания) стопка снова уходит в кнопку. */
export const STACK_LEAVE_MS = 600;

const PEEK = 10;
const BEHIND = 2;
const GAP = 8;
/** Заголовок «Новые · N» с промежутком до первой карточки. */
const HEAD = 38;
const FALLBACK_H = 76;
const WIDTH = 340;
const DISMISS_DISTANCE = 100;
const DISMISS_VELOCITY = 0.11; // px/мс
const AXIS_LOCK = 6;
const VELOCITY_WINDOW_MS = 80;
const FLY_MIN = 1400; // px/с
const FLY_ACCEL = 4200; // px/с²
const CSS_MS = 300;
/** Масштаб стопки в кнопке. */
const TUCK_SCALE = 0.18;

const SOFT: readonly [number, number] = [260, 24];
const FADE: readonly [number, number] = [420, 32];
const SWIPE: readonly [number, number] = [520, 2 * Math.sqrt(520)];
/** Полёт в кнопку и призрак: почти без перелёта, чтобы не «проскочить» кнопку. */
const FLIGHT: readonly [number, number] = [380, 37];

interface Card {
  n: Notice;
  el: HTMLElement;
  time: HTMLTimeElement;
  h: number;
  y: Spring; s: Spring; o: Spring; x: Spring;
  /** Прозрачность от перетаскивания. */
  dragO: number;
  /** На экране (а не в кнопке). */
  shown: boolean;
  /** Пришло и ещё не долетело до кнопки: счётчик его пока не считает. */
  fresh: boolean;
  /** Тихое: когда исчезнуть (0 — не тихое). */
  quietUntil: number;
  /** Пауза перед падением новой карточки (с). */
  hold: number;
  /** Смахнута: улетает вбок. */
  fly: { v: number; dist: number } | null;
  dragging: boolean;
}

interface Ghost { id: string; el: HTMLElement; A: Spring; F: Spring; time: number; landed: boolean; dy: number }

let root: HTMLElement | null = null;
let headTitle: HTMLElement | null = null;
let liveRegion: HTMLElement | null = null;
/** Карточки стопки, передняя (самая новая) первой. */
let cards: Card[] = [];
/** Убранные карточки, пока доигрывают уход. */
let leaving: Card[] = [];
let ghosts: Ghost[] = [];

type Phase = 'hidden' | 'shown' | 'tucking';
let phase: Phase = 'hidden';
let expanded = false;
/** Задние подъехали под переднюю перед уходом в кнопку (и при подъёме из неё). */
let tight = false;
let hoverStack = false;
let hoverButton = false;
let focusInside = false;
let dragging = false;
/** Раскрыта с клавиатуры (стрелка вниз на кнопке ЧУ): держится до «Скрыть», Esc или щелчка мимо. */
let pinned = false;
/** Показана наведением на кнопку ЧУ: уходит обратно через STACK_LEAVE_MS. */
let byButton = false;
let idleUntil = 0;
let graceUntil = 0;
let timer = 0;
let cssTimer = 0;
let suppressClick = false;
/** Уведомления, которые стопка сама помечает прочитанными (их событие 'read' она не обрабатывает). */
const ownReads = new Set<string>();

const P: Spring = S(0); // 0 — стопка на месте, 1 — в кнопке
let geo = { dx: 0, dy: 0, oy: FALLBACK_H / 2 };
let absorbed = false;
let simTimers: { t: number; fn: () => void }[] = [];
let looped = false;
let subscribed = false;
let boundButton: HTMLElement | null = null;

const mode = (): MenuMotion => menuMotion();

/** Таймер в секундах симуляции (только «Улучшенные»: идёт вместе с пружинами). */
function after(sec: number, fn: () => void): void {
  simTimers.push({ t: sec, fn });
  kick();
}

/** Разбудить общий цикл пружин: стопке есть что двигать. */
function kick(): void {
  ensureLoop();
  moving = true;
  wake();
}

// ----- Разметка -----

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

/** Фокус пришёл с клавиатуры (:focus-visible); без поддержки селектора — считаем, что да. */
function keyboardFocus(t: EventTarget | null): boolean {
  if (!(t instanceof Element)) return false;
  try { return t.matches(':focus-visible'); } catch { return true; }
}

function ensureRoot(): HTMLElement {
  if (root && root.isConnected) return root;
  // стопку убрали из документа вместе с интерфейсом: начинаем с пустой
  for (const c of [...cards, ...leaving]) c.el.remove();
  cards = [];
  leaving = [];
  phase = 'hidden';
  const r = (document.getElementById('notify-stack') as HTMLElement | null) ?? el('div', '');
  r.id = 'notify-stack';
  r.textContent = '';
  r.hidden = true;
  r.setAttribute('role', 'region');
  r.setAttribute('aria-label', 'Новые уведомления');
  const head = el('div', 'ns-head');
  headTitle = el('span', 'ns-head-title');
  const hide = el('button', 'ns-hide', 'Скрыть');
  hide.type = 'button';
  hide.title = 'Убрать стопку в кнопку «Чат и уведомления»';
  hide.addEventListener('click', ev => { ev.stopPropagation(); tuckNow(true); });
  head.append(headTitle, hide);
  r.append(head);
  // наведение — по настоящему движению мыши: стопка, появившаяся под неподвижным курсором, не залипает раскрытой
  r.addEventListener('pointermove', ev => { if (!hoverStack && ev.pointerType !== 'touch' && phase === 'shown') { hoverStack = true; update(); } });
  r.addEventListener('pointerleave', () => { if (!hoverStack) return; hoverStack = false; graceUntil = Date.now() + STACK_LEAVE_MS; update(); });
  r.addEventListener('focusin', ev => {
    if (phase !== 'shown' || !keyboardFocus(ev.target)) return;
    focusInside = true;
    update();
  });
  r.addEventListener('focusout', ev => {
    if (ev.relatedTarget instanceof Node && r.contains(ev.relatedTarget)) return;
    focusInside = false;
    graceUntil = Date.now() + STACK_LEAVE_MS;
    update();
  });
  r.addEventListener('keydown', ev => {
    if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); tuckNow(true); }
  });
  if (!r.isConnected) document.body.appendChild(r);
  root = r;
  // скрытая живая область: чтение с экрана проговаривает новое уведомление
  liveRegion = document.getElementById('notify-live') ?? el('div', 'ns-live');
  liveRegion.id = 'notify-live';
  liveRegion.setAttribute('aria-live', 'polite');
  liveRegion.setAttribute('role', 'status');
  if (!liveRegion.isConnected) document.body.appendChild(liveRegion);
  return r;
}

function buildCard(n: Notice): Card {
  const card = el('div', `ns-card ns-${n.level}${n.kind === 'chat' ? ' ns-chat' : ''}`);
  card.dataset.id = n.id;
  card.tabIndex = 0;
  card.setAttribute('role', 'article');
  card.setAttribute('aria-label', noticeText(n));
  // содержимое — общая карточка (src/notice-card.ts); действие сначала убирает карточку
  const { content, time } = noticeContent(n, () => dismiss(c, 'fade'));
  const c: Card = {
    n, el: card, time, h: 0,
    y: S(0), s: S(1), o: S(0), x: S(0), dragO: 1,
    shown: false, fresh: false, quietUntil: 0, hold: 0, fly: null, dragging: false,
  };
  const close = el('button', 'ns-close');
  close.type = 'button';
  close.title = 'Убрать';
  close.setAttribute('aria-label', 'Убрать уведомление');
  close.innerHTML = CLOSE_ICON; // константа каталога иконок
  close.addEventListener('click', ev => { ev.stopPropagation(); dismiss(c, 'fade'); });
  card.append(content, close);
  card.addEventListener('click', () => {
    if (suppressClick) { suppressClick = false; return; }
    activate(c);
  });
  card.addEventListener('keydown', ev => onCardKey(c, ev));
  card.addEventListener('pointerdown', ev => onPointerDown(c, ev));
  return c;
}

function updateTime(c: Card): void {
  paintNoticeTime(c.time, c.n.ts);
}

function announce(n: Notice): void {
  if (!liveRegion) return;
  liveRegion.textContent = '';
  liveRegion.append(el('p', '', noticeText(n)));
}

// ----- Раскладка -----

/** Где стопка: правый край — по правому краю кнопки ЧУ, верх — на 8 px ниже неё (шапки). */
function place(): void {
  if (!root) return;
  const b = notifyButton()?.getBoundingClientRect();
  const right = b && b.width ? Math.max(8, window.innerWidth - b.right) : 12;
  const top = b && b.height ? b.bottom + 8 : 68;
  root.style.right = `${Math.round(right)}px`;
  root.style.top = `${Math.round(top)}px`;
}

function visible(): Card[] {
  return cards.filter(c => c.shown);
}

/** Естественная высота карточек (задние свёрнутой стопки подогнаны по передней — их не перемеряем). */
function measure(): void {
  for (const c of cards) {
    if (c.el.style.height) continue;
    const h = c.el.offsetHeight;
    if (h > 0) c.h = h;
  }
}

const hOf = (c: Card): number => c.h || FALLBACK_H;

/** Цели пружин по состоянию стопки: свёрнута, раскрыта или задние под передней. */
function layout(): void {
  if (!root) return;
  measure();
  const vis = visible();
  const exp = expanded && !tight && vis.length > 1;
  root.classList.toggle('expanded', exp);
  if (headTitle) headTitle.textContent = `Новые · ${vis.length}`;
  let y = exp ? HEAD : 0;
  const front = vis[0] ? hOf(vis[0]) : 0;
  vis.forEach((c, i) => {
    updateTime(c);
    c.el.style.zIndex = String(STACK_MAX * 3 - i);
    const back = !exp && i > 0;
    c.el.classList.toggle('ns-back', back);
    c.el.classList.toggle('ns-off', back && i > BEHIND);
    c.el.removeAttribute('aria-hidden');
    c.el.tabIndex = back ? -1 : 0;
    // задние свёрнутой стопки — высотой с переднюю: края выглядывают снизу ровно на PEEK, а не торчат сверху
    if (back) c.el.style.height = `${front}px`;
    else c.el.style.removeProperty('height');
    if (exp) {
      c.y.t = y; c.s.t = 1; c.o.t = 1;
      y += hOf(c) + GAP;
    } else if (tight) {
      c.y.t = i * 7; c.s.t = 1 - i * 0.05; c.o.t = i <= BEHIND ? 1 : 0;
    } else {
      const s = 1 - i * 0.05;
      c.s.t = s;
      c.y.t = front + i * PEEK - front * s;
      c.o.t = i <= BEHIND ? 1 : 0;
    }
  });
  // ушедшие в кнопку карточки ждут под передней, невидимые и недоступные
  for (const c of cards) {
    if (c.shown) continue;
    c.el.classList.add('ns-back', 'ns-off');
    c.el.setAttribute('aria-hidden', 'true');
    c.el.tabIndex = -1;
    c.el.style.zIndex = '0';
    c.y.t = 0; c.s.t = 0.92; c.o.t = 0;
  }
  const height = exp ? y - GAP : front + Math.min(BEHIND, Math.max(0, vis.length - 1)) * PEEK;
  root.style.height = `${Math.max(0, Math.round(height))}px`;
}

/** Применить цели: пружины («Улучшенные») или сразу (CSS-переходы «Обычных» доигрывают сами). */
function commit(): void {
  if (!root) return;
  const m = mode();
  root.classList.toggle('ns-css', m === 'normal');
  if (m === 'enhanced') { kick(); return; }
  for (const c of cards) {
    if (c.dragging) continue;
    snapCard(c);
    paintCard(c, m);
  }
}

function snapCard(c: Card): void {
  for (const s of [c.y, c.s, c.o]) { s.x = s.t; s.v = 0; }
  if (!c.fly) { c.x.x = c.x.t; c.x.v = 0; }
}

function paintCard(c: Card, m: MenuMotion): void {
  const x = c.x.x;
  const s = Math.max(0, c.s.x);
  const base = clamp(c.o.x, 0, 1);
  let o = base * c.dragO;
  if (c.fly) o *= Math.max(0, 1 - Math.abs(x) / c.fly.dist);
  const st = c.el.style;
  st.transform = `translate3d(${x.toFixed(2)}px, ${c.y.x.toFixed(2)}px, 0) scale(${s.toFixed(4)})`;
  st.opacity = o.toFixed(3);
  st.filter = m === 'enhanced' && base < 0.98 ? `blur(${((1 - base) * 4).toFixed(2)}px)` : '';
}

/** «Обычные»: начальное положение без перехода, затем цель — с CSS-переходом. */
function cssFrom(c: Card, from: { y: number; s: number; o: number }): void {
  c.el.classList.add('ns-instant');
  c.y.x = from.y; c.s.x = from.s; c.o.x = from.o;
  paintCard(c, 'normal');
  void c.el.offsetWidth;
  c.el.classList.remove('ns-instant');
}

// ----- Группа: уход в кнопку и подъём из неё -----

/** Сдвиг от передней карточки к центру кнопки ЧУ. */
function measureGeo(): void {
  if (!root) return;
  const top = parseFloat(root.style.top) || 68;
  const right = parseFloat(root.style.right) || 12;
  const width = root.offsetWidth || Math.min(WIDTH, window.innerWidth - 24);
  const left = window.innerWidth - right - width;
  const front = visible()[0] ?? cards[0];
  const h = front ? hOf(front) : FALLBACK_H;
  const b = notifyButton()?.getBoundingClientRect();
  const bx = b && b.width ? b.left + b.width / 2 : window.innerWidth - 36;
  const by = b && b.height ? b.top + b.height / 2 : 36;
  geo = { dx: bx - (left + width / 2), dy: by - (top + h / 2), oy: h / 2 };
}

function groupTransform(p: number): string {
  const sc = 1 - (1 - TUCK_SCALE) * p;
  return `translate(${(geo.dx * p).toFixed(2)}px, ${(geo.dy * p).toFixed(2)}px) scale(${sc.toFixed(4)})`;
}

function paintGroup(): void {
  if (!root) return;
  const p = clamp(P.x, -0.1, 1);
  if (Math.abs(p) < 0.002) {
    root.style.removeProperty('transform');
    root.style.removeProperty('opacity');
    return;
  }
  root.style.transformOrigin = `50% ${geo.oy.toFixed(1)}px`;
  root.style.transform = groupTransform(p);
  root.style.opacity = (p < 0.45 ? 1 : clamp(1 - (p - 0.45) / 0.45, 0, 1)).toFixed(3);
}

/** Уйти в кнопку: задние подъезжают под переднюю, через .24 с вся стопка летит к центру кнопки. */
function tuck(): void {
  if (!root || phase !== 'shown') return;
  clearTimeout(timer);
  timer = 0;
  // тихие в кнопку не уходят
  for (const c of [...cards]) if (c.quietUntil) remove(c, 'instant');
  if (!visible().length) { finishTuck(); return; }
  const m = mode();
  phase = 'tucking';
  absorbed = false;
  measureGeo();
  if (m === 'off') { finishTuck(); return; }
  root.classList.add('ns-under');
  if (m === 'normal') {
    root.classList.add('ns-css');
    root.style.transformOrigin = `50% ${geo.oy.toFixed(1)}px`;
    root.style.transform = groupTransform(1);
    root.style.opacity = '0';
    clearTimeout(cssTimer);
    cssTimer = window.setTimeout(() => { cssTimer = 0; if (phase === 'tucking') finishTuck(); }, CSS_MS);
    return;
  }
  tight = true;
  layout();
  commit();
  P.x = 0; P.v = 0; P.t = 0;
  tune(P, ...FLIGHT);
  after(0.24, () => { if (phase === 'tucking') { P.t = 1; kick(); } });
}

/** Стопка в кнопке: счётчик досчитывает долетевшие, кнопка их «принимает». */
function finishTuck(): void {
  clearTimeout(cssTimer);
  cssTimer = 0;
  phase = 'hidden';
  tight = false;
  expanded = false;
  byButton = false;
  pinned = false;
  hoverStack = false;
  focusInside = false;
  P.x = 0; P.v = 0; P.t = 0;
  for (const c of [...leaving]) dropNode(c);
  for (const c of cards) { c.shown = false; c.fresh = false; c.dragO = 1; }
  if (root) {
    root.hidden = true;
    root.classList.remove('ns-under', 'expanded');
    root.style.removeProperty('transform');
    root.style.removeProperty('opacity');
  }
  layout();
  commit();
  if (!absorbed) notifyAbsorb();
  absorbed = false;
  syncPending();
}

/** Подняться из кнопки (наведение на неё, щелчок без чата): стопка встаёт под передней и раскладывается. */
function reveal(): boolean {
  if (!cards.length) return false;
  const r = ensureRoot();
  byButton = true;
  const m = mode();
  if (phase === 'shown') {
    for (const c of cards) c.shown = true;
    update();
    return true;
  }
  if (phase === 'tucking') {
    // разворот на лету: стопка возвращается и раскладывается
    phase = 'shown';
    for (const c of cards) c.shown = true;
    if (m === 'enhanced') {
      P.t = 0;
      tune(P, ...SOFT);
      after(0.26, () => { if (phase === 'shown') { tight = false; update(); } });
    } else {
      clearTimeout(cssTimer);
      cssTimer = 0;
      r.style.removeProperty('transform');
      r.style.removeProperty('opacity');
      r.classList.remove('ns-under');
      tight = false;
    }
    update();
    return true;
  }
  phase = 'shown';
  r.hidden = false;
  place();
  for (const c of cards) c.shown = true;
  expanded = true;
  if (m === 'enhanced') {
    measureGeo();
    tight = true;
    layout();
    for (const c of cards) { snapCard(c); paintCard(c, m); }
    r.classList.add('ns-under');
    P.x = 1; P.v = 0; P.t = 0;
    tune(P, ...SOFT);
    paintGroup();
    after(0.26, () => { if (phase === 'shown') { tight = false; update(); } });
    kick();
  } else if (m === 'normal') {
    layout();
    for (const c of cards) { snapCard(c); paintCard(c, m); }
    measureGeo();
    r.classList.add('ns-instant', 'ns-under');
    r.style.transformOrigin = `50% ${geo.oy.toFixed(1)}px`;
    r.style.transform = groupTransform(1);
    r.style.opacity = '0';
    void r.offsetWidth;
    r.classList.remove('ns-instant');
    r.classList.add('ns-css');
    r.style.removeProperty('transform');
    r.style.removeProperty('opacity');
    clearTimeout(cssTimer);
    cssTimer = window.setTimeout(() => { cssTimer = 0; root?.classList.remove('ns-under'); }, CSS_MS);
  } else {
    layout();
    commit();
  }
  schedule();
  return true;
}

/** «Скрыть», Esc: в кнопку сейчас же; focusButton — фокус на кнопку ЧУ, если он был в стопке. */
function tuckNow(focusButton: boolean): void {
  const hadFocus = !!root && root.contains(document.activeElement);
  pinned = false;
  byButton = false;
  hoverStack = false;
  focusInside = false;
  if (phase === 'shown') tuck();
  if (focusButton && hadFocus) notifyButton()?.focus();
}

// ----- Карточки: появление и уход -----

function syncPending(): void {
  const ids = new Set<string>();
  for (const c of cards) if (c.fresh && !c.n.read) ids.add(c.n.id);
  for (const g of ghosts) if (!g.landed) ids.add(g.id);
  setNotifyPending(ids);
}

function dropNode(c: Card): void {
  c.el.remove();
  const i = leaving.indexOf(c);
  if (i >= 0) leaving.splice(i, 1);
  if (root && phase === 'hidden' && !leaving.length) root.hidden = true;
}

/** Убрать карточку из стопки: 'fade' — гаснет, 'fly' — улетает вбок (смахнули), 'instant' — сразу. */
function remove(c: Card, how: 'fade' | 'fly' | 'instant', flyV = 0): void {
  const i = cards.indexOf(c);
  if (i < 0) return;
  cards.splice(i, 1);
  c.fresh = false;
  c.dragging = false;
  const m = mode();
  const onScreen = c.shown && phase !== 'hidden' && !!root && !root.hidden;
  if (how === 'instant' || !onScreen || m === 'off') {
    c.el.remove();
  } else {
    leaving.push(c);
    c.el.classList.add('ns-leaving');
    c.el.setAttribute('aria-hidden', 'true');
    if (how === 'fly') {
      const dir = Math.sign(c.x.x) || Math.sign(flyV) || 1;
      const dist = (c.el.offsetWidth || WIDTH) * 1.1;
      if (m === 'enhanced') {
        c.fly = { v: dir * Math.max(Math.abs(flyV) * 1000, FLY_MIN), dist };
      } else {
        c.fly = { v: 0, dist };
        c.x.x = c.x.t = dir * dist;
        c.dragO = 1;
        paintCard(c, m);
        window.setTimeout(() => dropNode(c), CSS_MS);
      }
    } else {
      c.o.t = 0;
      c.s.t = Math.max(0, c.s.t) * 0.96;
      tune(c.o, ...FADE);
      tune(c.s, ...FADE);
      if (m === 'normal') {
        snapCard(c);
        paintCard(c, m);
        window.setTimeout(() => dropNode(c), CSS_MS);
      }
    }
  }
  afterChange();
}

/** Пользователь убрал карточку: уведомление прочитано, фокус — на следующую. */
function dismiss(c: Card, how: 'fade' | 'fly', flyV = 0): void {
  if (!cards.includes(c)) return;
  const hadFocus = c.el.contains(document.activeElement);
  const vis = visible();
  const next = vis[vis.indexOf(c) + 1] ?? vis[vis.indexOf(c) - 1];
  ownReads.add(c.n.id);
  markNoticeRead(c.n.id);
  ownReads.delete(c.n.id);
  remove(c, how, flyV);
  if (hadFocus) {
    if (next && cards.includes(next)) next.el.focus();
    else notifyButton()?.focus();
  }
}

/** Щелчок по карточке: её действие (открыть чат и т.п.), уведомление прочитано. */
function activate(c: Card): void {
  const n = c.n;
  dismiss(c, 'fade');
  if (n.onClick) { n.onClick(); return; }
  setNotifyTab(n.kind === 'chat' ? 'chat' : n.kind === 'comment' ? 'comments' : 'notices');
  openSidePanel('notify');
  if (n.kind === 'chat' && n.chatId) revealChatMessage(n.chatId);
}

/** Панель ЧУ открылась: стопка прячется сразу (ушедшее остаётся «в кнопке»), кнопку не дёргает. */
function hideForPanel(): void {
  if (phase === 'hidden') return;
  for (const c of [...cards]) if (c.quietUntil) remove(c, 'instant');
  absorbed = true;
  simTimers = [];
  finishTuck();
}

/** После изменения состава: раскладка, счётчик, таймеры; стопка без видимых карточек прячется
 *  (ушедшие в кнопку остаются в ней). */
function afterChange(): void {
  if (phase === 'shown' && !visible().length) {
    phase = 'hidden';
    expanded = false;
    byButton = false;
    pinned = false;
    hoverStack = false;
    focusInside = false;
    if (!leaving.length && root) root.hidden = true;
  }
  layout();
  commit();
  syncPending();
  schedule();
}

/** Новое уведомление влетает спереди (или тихо ложится в стопку при «не беспокоить»). */
function arrive(n: Notice): void {
  const r = ensureRoot();
  const silent = doNotDisturb() && !n.quiet && phase !== 'shown' && !hoverButton;
  if (!silent && !(doNotDisturb() && !n.quiet)) announce(n);
  const c = buildCard(n);
  c.quietUntil = n.quiet ? Date.now() + STACK_QUIET_MS : 0;
  cards.unshift(c);
  r.insertBefore(c.el, r.querySelector('.ns-card'));
  // шестое вытесняет самое старое: оно уезжает и гаснет (уведомление в центре остаётся непрочитанным)
  while (cards.length > STACK_MAX) remove(cards[cards.length - 1], 'fade');
  const m = mode();
  if (silent) {
    c.shown = false;
    c.fresh = false;
    if (m === 'enhanced') spawnGhost(c);
    layout();
    commit();
    syncPending();
    return;
  }
  c.shown = true;
  c.fresh = !n.read;
  idleUntil = Date.now() + STACK_IDLE_MS;
  if (!hoverButton) byButton = false;
  if (phase === 'tucking') {
    // стопка ещё летела в кнопку — возвращается, новая карточка ложится спереди
    phase = 'shown';
    if (m === 'enhanced') { P.t = 0; tune(P, ...SOFT); after(0.2, () => { if (phase === 'shown') { tight = false; update(); } }); }
    else {
      clearTimeout(cssTimer);
      cssTimer = 0;
      r.style.removeProperty('transform');
      r.style.removeProperty('opacity');
      r.classList.remove('ns-under');
      tight = false;
    }
  }
  const wasHidden = phase === 'hidden';
  phase = 'shown';
  if (wasHidden) {
    r.hidden = false;
    r.classList.remove('ns-under');
    r.style.removeProperty('transform');
    r.style.removeProperty('opacity');
    place();
  }
  expanded = wantExpanded();
  if (expanded) for (const x of cards) x.shown = true;
  layout();
  r.classList.toggle('ns-css', m === 'normal');
  if (m === 'enhanced') {
    // короткое падение, проявление и снятие размытия; остальные сначала уступают место
    c.y.x = c.y.t - 14; c.s.x = 0.96; c.o.x = 0;
    tune(c.y, ...SOFT); tune(c.s, ...FADE); tune(c.o, ...FADE); tune(c.x, ...SWIPE);
    c.hold = 0.07;
    for (const o of cards) if (o !== c) { tune(o.y, ...SOFT); tune(o.s, ...FADE); tune(o.o, ...FADE); }
    paintCard(c, m);
    kick();
  } else if (m === 'normal') {
    cssFrom(c, { y: c.y.t - 14, s: 0.96, o: 0 });
    commit();
  } else {
    commit();
  }
  syncPending();
  schedule();
}

// ----- Призрак «не беспокоить» («Улучшенные») -----

function spawnGhost(c: Card): void {
  const b = notifyButton();
  const r = b?.getBoundingClientRect();
  if (!b || !r || !r.width) return;
  const g = el('div', 'ns-ghost');
  g.setAttribute('aria-hidden', 'true');
  g.append(noticeMedia(c.n), el('span', 'ns-ghost-text', c.n.title || 'Участник'));
  const w = 150;
  const h = 36;
  const left = clamp(r.left + r.width / 2 - w / 2, 8, window.innerWidth - w - 8);
  const top = r.bottom + 10;
  g.style.left = `${Math.round(left)}px`;
  g.style.top = `${Math.round(top)}px`;
  document.body.appendChild(g);
  const ghost: Ghost = { id: c.n.id, el: g, A: S(0), F: S(0), time: 0, landed: false, dy: r.top + r.height / 2 - (top + h / 2) };
  tune(ghost.A, ...FADE);
  tune(ghost.F, ...FLIGHT);
  ghost.A.t = 1;
  ghosts.push(ghost);
  paintGhost(ghost);
  kick();
}

function paintGhost(g: Ghost): void {
  const a = clamp(g.A.x, 0, 1);
  const f = clamp(g.F.x, 0, 1);
  const y = (1 - a) * 8 + f * g.dy;
  const s = (0.9 + 0.1 * a) * (1 - 0.75 * f);
  const o = a * (f < 0.5 ? 1 : clamp(1 - (f - 0.5) / 0.4, 0, 1));
  g.el.style.transform = `translateY(${y.toFixed(2)}px) scale(${s.toFixed(4)})`;
  g.el.style.opacity = o.toFixed(3);
}

// ----- Смахивание -----

function onPointerDown(c: Card, ev: PointerEvent): void {
  if (ev.button !== 0 || !cards.includes(c) || phase !== 'shown' || c.el.classList.contains('ns-back')) return;
  if (ev.target instanceof Element && ev.target.closest('button')) return;
  const sx = ev.clientX;
  const sy = ev.clientY;
  const pid = ev.pointerId;
  let lock: 'x' | 'y' | null = null;
  const samples: { x: number; t: number }[] = [{ x: 0, t: ev.timeStamp }];
  const move = (e: PointerEvent) => {
    if (e.pointerId !== pid) return;
    const dx = e.clientX - sx;
    const dy = e.clientY - sy;
    if (!lock) {
      if (Math.abs(dx) > AXIS_LOCK && Math.abs(dx) > Math.abs(dy)) {
        lock = 'x';
        c.dragging = true;
        dragging = true;
        c.el.classList.add('ns-drag');
        try { c.el.setPointerCapture(pid); } catch { /* указатель уже отпущен */ }
        schedule();
      } else if (Math.abs(dy) > AXIS_LOCK) {
        lock = 'y';
        cleanup();
        return;
      } else return;
    }
    c.x.x = c.x.t = dx;
    c.x.v = 0;
    c.dragO = Math.max(1 - Math.abs(dx) / 240, 0.3);
    samples.push({ x: dx, t: e.timeStamp });
    while (samples.length > 2 && e.timeStamp - samples[0].t > VELOCITY_WINDOW_MS) samples.shift();
    paintCard(c, mode());
  };
  const up = (e: PointerEvent) => {
    if (e.pointerId !== pid) return;
    cleanup();
    if (lock !== 'x') return;
    suppressClick = true;
    window.setTimeout(() => { suppressClick = false; }, 0);
    c.dragging = false;
    dragging = false;
    c.el.classList.remove('ns-drag');
    const dx = c.x.x;
    const first = samples[0];
    const last = samples[samples.length - 1];
    const v = last.t > first.t ? (last.x - first.x) / (last.t - first.t) : 0;
    const flick = e.type !== 'pointercancel' && Math.abs(v) > DISMISS_VELOCITY && Math.sign(v) === Math.sign(dx);
    graceUntil = Date.now() + STACK_LEAVE_MS;
    if (e.type !== 'pointercancel' && (Math.abs(dx) > DISMISS_DISTANCE || flick)) { dismiss(c, 'fly', v); return; }
    // возврат: пружина 520 с критическим затуханием
    c.dragO = 1;
    c.x.t = 0;
    const m = mode();
    if (m === 'enhanced') {
      tune(c.x, ...SWIPE);
      c.x.v = v * 1000;
      kick();
    } else {
      c.x.x = 0;
      paintCard(c, m);
    }
    schedule();
  };
  const cleanup = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', up);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
}

function onCardKey(c: Card, ev: KeyboardEvent): void {
  if (ev.target !== c.el) return;
  if (ev.key === 'Delete' || ev.key === 'Backspace') {
    ev.preventDefault();
    dismiss(c, 'fade');
  } else if (ev.key === 'Enter' || ev.key === ' ') {
    ev.preventDefault();
    activate(c);
  } else if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
    ev.preventDefault();
    const vis = visible();
    const next = vis[vis.indexOf(c) + (ev.key === 'ArrowDown' ? 1 : -1)];
    next?.el.focus();
  }
}

// ----- Наведение, фокус, таймеры -----

function wantExpanded(): boolean {
  return hoverStack || focusInside || pinned || byButton || (dragging && expanded);
}

function blocked(): boolean {
  return hoverStack || hoverButton || focusInside || dragging || pinned;
}

/** Состояние наведения/фокуса изменилось: раскрыть или свернуть, перезапустить таймеры. */
function update(): void {
  if (!root || phase !== 'shown') { schedule(); return; }
  const want = wantExpanded();
  // раскрытая стопка показывает всё, что в ней есть, и то, что уже ушло в кнопку
  if (want) for (const c of cards) c.shown = true;
  expanded = want;
  layout();
  commit();
  schedule();
}

function schedule(): void {
  clearTimeout(timer);
  timer = 0;
  if (phase !== 'shown' || blocked()) return;
  const now = Date.now();
  let next = Infinity;
  for (const c of cards) if (c.quietUntil) next = Math.min(next, Math.max(c.quietUntil, graceUntil));
  if (visible().some(c => !c.quietUntil)) next = Math.min(next, Math.max(byButton ? 0 : idleUntil, graceUntil));
  if (next === Infinity) return;
  timer = window.setTimeout(tick, Math.max(0, next - now));
}

function tick(): void {
  timer = 0;
  if (phase !== 'shown' || blocked()) return;
  const now = Date.now();
  for (const c of [...cards]) if (c.quietUntil && Math.max(c.quietUntil, graceUntil) <= now) remove(c, 'fade');
  if (phase === 'shown' && visible().some(c => !c.quietUntil) && Math.max(byButton ? 0 : idleUntil, graceUntil) <= now) { tuck(); return; }
  schedule();
}

// ----- Общий цикл пружин -----

const near = (s: Spring, dx: number, dv: number): boolean => Math.abs(s.x - s.t) < dx && Math.abs(s.v) < dv;
const cardStill = (c: Card): boolean => !c.fly && c.hold <= 0 && near(c.y, 0.05, 0.5) && near(c.s, 0.001, 0.01) && near(c.o, 0.002, 0.02) && (c.dragging || near(c.x, 0.3, 10));
let moving = false;

function ensureLoop(): void {
  if (looped) return;
  looped = true;
  register({ frame, render, settled: () => !moving });
}

function frame(dt: number): void {
  for (let i = simTimers.length - 1; i >= 0; i--) {
    const t = simTimers[i];
    t.t -= dt;
    if (t.t <= 0) { simTimers.splice(i, 1); t.fn(); }
  }
  for (const c of [...cards, ...leaving]) {
    if (c.hold > 0) {
      c.hold -= dt;
      if (c.hold > 0) continue;
    }
    step(c.y, dt); step(c.s, dt); step(c.o, dt);
    if (c.fly) {
      const dir = Math.sign(c.fly.v) || 1;
      c.fly.v += dir * FLY_ACCEL * dt;
      c.x.x += c.fly.v * dt;
    } else if (!c.dragging) step(c.x, dt);
  }
  step(P, dt);
  for (const g of ghosts) {
    g.time += dt;
    if (g.time > 0.34) g.F.t = 1;
    step(g.A, dt); step(g.F, dt);
  }
}

function render(): void {
  if (!moving) return;
  const m = mode();
  if (m !== 'enhanced') {
    // режим сменили на ходу: всё встаёт на место сразу
    simTimers = [];
    for (const c of [...leaving]) dropNode(c);
    for (const g of ghosts) g.el.remove();
    ghosts = [];
    if (phase === 'tucking') finishTuck();
    commit();
    paintGroup();
    syncPending();
    moving = false;
    return;
  }
  let busy = simTimers.length > 0;
  for (const c of [...leaving]) {
    const gone = c.fly ? Math.abs(c.x.x) >= c.fly.dist : c.o.x < 0.02;
    if (gone) { dropNode(c); continue; }
    paintCard(c, m);
    busy = true;
  }
  for (const c of cards) {
    if (cardStill(c)) {
      snapCard(c);
      paintCard(c, m);
    } else {
      paintCard(c, m);
      busy = true;
    }
  }
  if (root && phase === 'hidden' && !leaving.length) root.hidden = true;
  // стопка летит в кнопку: почти вошла — кнопка «принимает», счётчик досчитывает
  if (phase === 'tucking' && P.t === 1) {
    if (!absorbed && P.x > 0.7) {
      absorbed = true;
      for (const c of cards) c.fresh = false;
      notifyAbsorb();
      syncPending();
    }
    if (P.x > 0.97) finishTuck();
  }
  if (phase === 'shown' && P.t === 0 && root?.classList.contains('ns-under') && P.x < 0.05) root.classList.remove('ns-under');
  paintGroup();
  if (!near(P, 0.002, 0.03)) busy = true;
  for (const g of [...ghosts]) {
    if (!g.landed && g.F.x > 0.7) {
      g.landed = true;
      notifyAbsorb();
      syncPending();
    }
    if (g.F.t === 1 && g.F.x > 0.97) {
      g.el.remove();
      ghosts.splice(ghosts.indexOf(g), 1);
      continue;
    }
    paintGhost(g);
    busy = true;
  }
  moving = busy;
}

// ----- Подписка на центр уведомлений -----

function onEvent(ev: NoticeEvent): void {
  if (ev.type === 'push') {
    for (const d of ev.dropped) { const c = cards.find(x => x.n.id === d.id); if (c) remove(c, 'instant'); }
    if (panelNotify()) { afterChange(); return; }
    arrive(ev.notice);
  } else if (ev.type === 'read' || ev.type === 'clear') {
    // прочитанное в другом месте (открыли чат) уходит из стопки; тихие живут своё время
    const ids = new Set(ev.ids);
    for (const c of [...cards]) if (ids.has(c.n.id) && !ownReads.has(c.n.id) && (ev.type === 'clear' || !c.quietUntil)) remove(c, 'fade');
  } else if (ev.type === 'dnd' && ev.on && phase === 'shown' && !blocked()) {
    tuck();
  }
}

// ----- API -----

/** Стопка под кнопкой ЧУ: подписка на центр уведомлений, наведение на кнопку. Повторный вызов — только кнопка. */
export function initNotifyStack(): void {
  if (!subscribed) {
    subscribed = true;
    onNotices(onEvent);
    onSidePanel(s => {
      if (s.open && s.mode === 'notify') hideForPanel();
      else if (s.open && phase === 'shown' && !blocked()) tuck();
    });
    // щелчок мимо раскрытой щелчком стопки — она уходит
    document.addEventListener('pointerdown', ev => {
      if (!pinned || !(ev.target instanceof Node)) return;
      if (root?.contains(ev.target) || boundButton?.contains(ev.target)) return;
      pinned = false;
      byButton = false;
      graceUntil = Date.now() + STACK_LEAVE_MS;
      update();
    }, true);
    window.addEventListener('resize', () => { if (phase === 'shown') place(); });
  }
  ensureRoot();
  const b = notifyButton();
  if (b && b !== boundButton) {
    boundButton = b;
    b.addEventListener('pointermove', ev => {
      if (hoverButton || ev.pointerType === 'touch' || panelNotify()) return;
      hoverButton = true;
      if (cards.length) reveal();
      else schedule();
    });
    b.addEventListener('pointerleave', () => {
      hoverButton = false;
      graceUntil = Date.now() + STACK_LEAVE_MS;
      update();
    });
    b.addEventListener('keydown', ev => {
      if (ev.key !== 'ArrowDown' || !cards.length || panelNotify()) return;
      ev.preventDefault();
      pinned = true;
      reveal();
      visible()[0]?.el.focus();
    });
  }
}

/** Убрать всё из стопки сразу (конец совместной работы); уведомления в центре не трогаются. */
export function clearNotifyStack(): void {
  for (const c of [...cards, ...leaving]) c.el.remove();
  for (const g of ghosts) g.el.remove();
  cards = [];
  leaving = [];
  ghosts = [];
  simTimers = [];
  clearTimeout(timer);
  clearTimeout(cssTimer);
  timer = 0;
  cssTimer = 0;
  phase = 'hidden';
  expanded = false;
  tight = false;
  pinned = false;
  byButton = false;
  hoverStack = false;
  hoverButton = false;
  focusInside = false;
  dragging = false;
  suppressClick = false;
  idleUntil = 0;
  graceUntil = 0;
  P.x = 0; P.v = 0; P.t = 0;
  if (root) {
    root.hidden = true;
    root.classList.remove('ns-under', 'expanded');
    root.style.removeProperty('transform');
    root.style.removeProperty('opacity');
  }
  syncPending();
}

/** Убрать из стопки одно уведомление, не помечая прочитанным (обёртка showPill). */
export function hideStackNotice(id: string): void {
  const c = cards.find(x => x.n.id === id);
  if (c) remove(c, 'fade');
}

/** Сколько уведомлений в стопке (на экране и ушедших в кнопку). */
export function stackCount(): number {
  return cards.length;
}

/** Стопка на экране (не в кнопке). */
export function stackShown(): boolean {
  return phase === 'shown' && !!root && !root.hidden;
}
