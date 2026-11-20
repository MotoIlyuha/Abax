// Кнопка «Чат, комментарии и уведомления» (ЧКУ, SPEC_CHAT §3, SPEC_COMMENTS §6): #btn-notify в шапке — крайняя справа, видна всегда.
// Счётчик — непрочитанные центра уведомлений (src/notify-center.ts), кроме тех, что ещё видны в стопке
// и не «долетели» до кнопки (их стопка сообщает через setNotifyPending): число меняется, когда карточки
// уходят в кнопку. «Не беспокоить» — счётчик серый, у кнопки маленький полумесяц.
// Три режима анимаций (SPEC_CHAT §0):
// - «Улучшенные» — счётчик перекатывается (src/roll-text.ts) и подпрыгивает ×1.18 (pop 520/16), появляется
//   и исчезает пружиной; кнопка «принимает» уведомления коротким провалом масштаба (notifyAbsorb);
// - «Обычные» — те же состояния CSS-переходами;
// - «Выкл» и «уменьшить движение» — сразу.
// Щелчок — боковая панель в режиме ЧУ (src/side-panel.ts): закрыта или в другом режиме — открывается на ЧУ,
// открыта на ЧУ — закрывается. aria-expanded — панель открыта в режиме ЧУ. Когда панель закрывается и кнопка
// закрытия «возвращается» в ЧУ, кнопка принимает её тем же провалом масштаба (событие doska:side-panel-absorb).

import { DND_ICON, notifyTabIcon } from './icons';
import { notifyTab } from './notify-panel';
import { createRoll, type Roll } from './roll-text';
import { S, clamp, register, step, tune, wake, type Spring } from './motion';
import { menuMotion } from './menu-motion';
import { doNotDisturb, formatUnread, notices, onNotices } from './notify-center';
import { onSidePanel, sidePanelMode, sidePanelOpen, toggleSidePanel } from './side-panel';

export const NOTIFY_LABEL = 'Чат, комментарии и уведомления';
export const NOTIFY_DND_HINT = 'Не беспокоить включено';

/** Подпись кнопки (aria-label и подсказка) для числа непрочитанных. */
export function notifyLabel(count: number, dnd: boolean): string {
  const text = formatUnread(count);
  const base = text ? `${NOTIFY_LABEL}: непрочитанных — ${text}` : NOTIFY_LABEL;
  return dnd ? `${base} · ${NOTIFY_DND_HINT}` : base;
}

/** Высота строки счётчика (перекат). */
const ROW = 18;
/** Пружины образца Focus mode: появление и подпрыгивание счётчика, перекат числа. */
const POP: readonly [number, number] = [520, 16];
const FADE: readonly [number, number] = [420, 32];
/** Насколько подпрыгивает счётчик при смене числа и насколько «проваливается» кнопка, принимая стопку. */
const BUMP = 1.18;
const DIP = 0.9;

interface Ui { btn: HTMLButtonElement; badge: HTMLElement; roll: Roll }
let ui: Ui | null = null;
let pending: ReadonlySet<string> = new Set();
/** Число на счётчике сейчас (-1 — ещё не рисовали). */
let shown = -1;
let subscribed = false;

// ----- Пружины («Улучшенные») -----

const CH: Spring = S(0); // счётчик виден: 0…1
const CP: Spring = S(1); // подпрыгивание счётчика
const BS: Spring = S(1); // масштаб кнопки: провал при приёме
let animating = false;
let looped = false;

const near = (s: Spring): boolean => Math.abs(s.x - s.t) < 0.002 && Math.abs(s.v) < 0.03;

function ensureLoop(): void {
  if (looped) return;
  looped = true;
  register({
    frame(dt) {
      if (!animating) return;
      step(CH, dt); step(CP, dt); step(BS, dt);
    },
    render() {
      if (!animating) return;
      if (!ui || !ui.btn.isConnected || (near(CH) && near(CP) && near(BS))) { stopSprings(); return; }
      paint();
    },
    settled: () => !animating,
  });
}

/** Кадр пружин в DOM (и сразу при старте: без кадра с CSS-состоянием между классом и первой пружиной). */
function paint(): void {
  if (!ui) return;
  const c = Math.max(0, CH.x) * CP.x;
  ui.badge.style.transform = `scale(${c.toFixed(4)})`;
  ui.badge.style.opacity = clamp(CH.x * 1.5, 0, 1).toFixed(3);
  ui.badge.style.visibility = 'visible';
  ui.btn.style.scale = BS.x.toFixed(4);
}

/** Пружины успокоились или режим сменился: инлайн снимается, дальше — CSS по классам. */
function stopSprings(): void {
  animating = false;
  CH.x = CH.t; CH.v = 0; CP.x = CP.t; CP.v = 0; BS.x = BS.t; BS.v = 0;
  if (!ui) return;
  for (const p of ['transform', 'opacity', 'visibility']) ui.badge.style.removeProperty(p);
  ui.btn.style.removeProperty('scale');
}

function startSprings(): void {
  ensureLoop();
  animating = true;
  paint();
  wake();
}

/** Перезапуск CSS-анимации (класс снимается сам по окончании). */
function replay(el: HTMLElement, cls: string): void {
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
  el.addEventListener('animationend', () => el.classList.remove(cls), { once: true });
}

// ----- Счётчик -----

/** Сколько показывает счётчик: непрочитанные, кроме ещё летящих в кнопку. */
function displayed(): number {
  let n = 0;
  for (const x of notices()) if (!x.read && !pending.has(x.id)) n++;
  return n;
}

function render(): void {
  if (!ui) return;
  const { btn, badge, roll } = ui;
  const n = displayed();
  const dnd = doNotDisturb();
  btn.classList.toggle('dnd', dnd);
  const label = notifyLabel(n, dnd);
  btn.title = label;
  btn.setAttribute('aria-label', label);
  btn.setAttribute('aria-expanded', sidePanelOpen() && sidePanelMode() === 'notify' ? 'true' : 'false');
  if (n === shown) return;
  const first = shown < 0;
  const prev = Math.max(0, shown);
  shown = n;
  const text = formatUnread(n);
  const mode = first ? 'off' : menuMotion();
  // 0 — прежнее число остаётся на сжимающемся счётчике
  if (text) roll.set(text, { instant: prev === 0, dir: n >= prev ? 1 : -1 });
  badge.classList.toggle('on', n > 0);
  if (mode === 'enhanced') {
    if (n > 0) { CP.x = BUMP; CP.v = 0; CP.t = 1; }
    CH.t = n > 0 ? 1 : 0;
    startSprings();
    return;
  }
  if (animating) stopSprings();
  if (mode === 'normal' && n > 0) replay(badge, 'nb-pop');
}

// ----- API -----

/** Иконка кнопки по выбранной вкладке панели: «Все» — колокольчик с пузырём, «Чат» — пузырь, «Уведомления» — колокольчик. */
function paintIcon(): void {
  if (!ui) return;
  const t = notifyTab();
  const html = notifyTabIcon(t); // константы каталога иконок
  if (ui.btn.dataset.icon === t) return;
  ui.btn.dataset.icon = t;
  ui.btn.querySelector(':scope > svg')?.remove();
  ui.btn.insertAdjacentHTML('afterbegin', html);
}

/** Кнопка ЧУ в шапке: иконка, счётчик, полумесяц «не беспокоить», щелчок. Повторный вызов только обновляет. */
export function initNotifyButton(): void {
  const btn = document.getElementById('btn-notify') as HTMLButtonElement | null;
  if (!subscribed) {
    subscribed = true;
    onNotices(() => render());
    onSidePanel(() => render());
    document.addEventListener('doska:side-panel-absorb', () => notifyAbsorb());
    document.addEventListener('doska:notify-tab', () => paintIcon());
  }
  if (!btn) return;
  if (ui?.btn === btn) { render(); return; }
  btn.type = 'button';
  const badge = document.createElement('span');
  badge.className = 'nb-badge';
  badge.setAttribute('aria-hidden', 'true');
  const roll = createRoll('nb-roll', ROW, { enter: FADE, leave: FADE });
  badge.append(roll.el);
  const moon = document.createElement('span');
  moon.className = 'nb-moon';
  moon.setAttribute('aria-hidden', 'true');
  moon.innerHTML = DND_ICON; // константа каталога иконок
  btn.append(badge, moon);
  btn.addEventListener('click', onClick);
  ui = { btn, badge, roll };
  shown = -1;
  paintIcon();
  tune(CH, ...POP);
  tune(CP, ...POP);
  tune(BS, ...POP);
  render();
}

function onClick(): void {
  toggleSidePanel('notify');
}

/** Кнопка ЧУ (для стопки: откуда подниматься и куда уходить). */
export function notifyButton(): HTMLButtonElement | null {
  return ui && ui.btn.isConnected ? ui.btn : null;
}

/** Уведомления, которые ещё видны в стопке и не долетели до кнопки: счётчик их пока не считает. */
export function setNotifyPending(ids: ReadonlySet<string>): void {
  pending = new Set(ids);
  render();
}

/** Кнопка «принимает» стопку или призрак уведомления: короткий провал масштаба и пружина. */
export function notifyAbsorb(): void {
  if (!ui) return;
  const mode = menuMotion();
  if (mode === 'off') return;
  if (mode === 'normal') { replay(ui.btn, 'nb-absorb'); return; }
  tune(BS, ...POP);
  BS.x = DIP;
  BS.v = 0;
  BS.t = 1;
  startSprings();
}

/** Число на счётчике (для тестов и стопки). */
export function notifyShownCount(): number {
  return Math.max(0, shown);
}
