// Адаптивная шапка: когда места не хватает, элементы уходят по одному в постоянном порядке —
// экспорт, импорт, затем «Отменить / Повторить» переезжают под панель инструментов
// (вертикальной плашкой), и последней «Поделиться» сжимается до иконки.
// Чистая часть (fitLevel, fitState) не трогает DOM и проверяется unit-тестами.

/** Шаги ужатия шапки по порядку. */
export const FIT_STEPS = ['export', 'import', 'undo', 'share'] as const;
export type FitStep = typeof FIT_STEPS[number];

/** Элемент левой части шапки (логотип, проект, кнопки) с его естественной шириной. */
export interface FitItem {
  /** Шаг, на котором элемент уходит из шапки; без шага — остаётся всегда. */
  step?: FitStep;
  width: number;
  /** Скрыт пользователем (меню «Скрыть», настройки) — места не занимает. */
  userHidden?: boolean;
}

export interface FitInput {
  /** Ширина шапки. */
  available: number;
  /** Промежуток между элементами внутри стороны шапки. */
  gap: number;
  /** Промежуток между левой и правой сторонами шапки. */
  sideGap: number;
  items: FitItem[];
  /** Ширина правой стороны при полной кнопке «Поделиться». */
  right: number;
  /** На сколько уже правая сторона, когда «Поделиться» — иконка (0 — кнопки нет). */
  shareShrink: number;
}

/** Нужная ширина шапки, если применены первые `level` шагов. */
export function fitWidth(input: FitInput, level: number): number {
  const removed = new Set<FitStep>(FIT_STEPS.slice(0, level));
  const shown = input.items.filter(i => !i.userHidden && i.width > 0 && !(i.step && removed.has(i.step)));
  const left = shown.reduce((sum, i) => sum + i.width, 0) + input.gap * Math.max(0, shown.length - 1);
  const right = input.right - (removed.has('share') ? input.shareShrink : 0);
  return left + right + (right > 0 && left > 0 ? input.sideGap : 0);
}

/** Сколько шагов ужатия нужно, чтобы шапка поместилась (0 — всё на месте, FIT_STEPS.length — предел). */
export function fitLevel(input: FitInput): number {
  for (let level = 0; level < FIT_STEPS.length; level++) {
    if (fitWidth(input, level) <= input.available + 0.5) return level;
  }
  return FIT_STEPS.length;
}

export interface FitState {
  level: number;
  /**
   * Пункты меню «Скрыть», которым не хватает места: даже если пользователь покажет элемент,
   * шапка уберёт его сама. «Отменить / Повторить» сюда не попадают — они переезжают, а не исчезают.
   */
  noRoom: Set<'export' | 'import'>;
}

/** Итог ужатия и недоступные пункты «Скрыть» (место считается так, будто показан только этот элемент). */
export function fitState(input: FitInput): FitState {
  const level = fitLevel(input);
  const noRoom = new Set<'export' | 'import'>();
  for (const step of ['export', 'import'] as const) {
    if (!input.items.some(i => i.step === step && i.width > 0)) continue;
    const shown = { ...input, items: input.items.map(i => i.step === step ? { ...i, userHidden: false } : i) };
    if (fitLevel(shown) > FIT_STEPS.indexOf(step)) noRoom.add(step);
  }
  return { level, noRoom };
}

// ----- DOM -----

/** Название проекта и страницы до такой ширины не обрезаем, пока можно убрать кнопки. */
const PROJECT_MIN = 220;
const LEVEL_CLASSES = FIT_STEPS.map(s => `fit-${s}`);
/** Классы body, которыми пользователь прячет элементы шапки (меню «Скрыть», настройки). */
const USER_HIDE: Partial<Record<FitStep, string>> = {
  export: 'hide-export-button',
  import: 'hide-import-buttons',
  undo: 'hide-undo-redo',
};

let current: FitState = { level: 0, noRoom: new Set() };
let scheduled = 0;
let observer: MutationObserver | null = null;

/** Последний расчёт шапки: для меню «Скрыть». */
export function topbarFit(): FitState {
  return current;
}

function stepOf(el: Element): FitStep | undefined {
  if (el.classList.contains('export-group')) return 'export';
  if (el.classList.contains('import-group')) return 'import';
  if (el.classList.contains('undo-group')) return 'undo';
  return undefined;
}

/** Замер шапки без ужатия и без пользовательского скрытия; всё возвращается как было в том же кадре. */
function measure(): FitInput | null {
  const bar = document.getElementById('topbar');
  const left = bar?.querySelector<HTMLElement>('.topbar-right');
  const right = bar?.querySelector<HTMLElement>('.topbar-left');
  const share = document.getElementById('btn-share');
  if (!bar || !left || !right || !bar.offsetWidth) return null;
  const body = document.body;
  const levelBefore = LEVEL_CLASSES.filter(c => body.classList.contains(c));
  const userBefore = new Map(Object.entries(USER_HIDE).map(([step, cls]) => [step as FitStep, body.classList.contains(cls)]));
  body.classList.remove(...LEVEL_CLASSES, ...Object.values(USER_HIDE));
  // «проект / страница» на время замера не сжимается: нужна его естественная ширина
  body.classList.add('fit-measure');
  const items: FitItem[] = [];
  for (const el of Array.from(left.children) as HTMLElement[]) {
    const step = stepOf(el);
    const width = el.classList.contains('project-group') ? Math.min(el.offsetWidth, PROJECT_MIN) : el.offsetWidth;
    items.push({ step, width, userHidden: step ? userBefore.get(step) : false });
  }
  // группа аватаров считается свёрнутой: раскрытая наведением стопка не должна прятать кнопки шапки
  const avatars = right.querySelector<HTMLElement>('.avatar-group');
  const rest = Number(avatars?.dataset.restWidth);
  const rightFull = right.offsetWidth - (avatars && Number.isFinite(rest) ? Math.max(0, avatars.offsetWidth - rest) : 0);
  const shareFull = share && share.offsetWidth ? share.offsetWidth : 0;
  let shareShrink = 0;
  if (shareFull) {
    body.classList.add('fit-share');
    shareShrink = Math.max(0, shareFull - share!.offsetWidth);
    body.classList.remove('fit-share');
  }
  body.classList.remove('fit-measure');
  const gap = parseFloat(getComputedStyle(left).columnGap) || 0;
  const sideGap = parseFloat(getComputedStyle(bar).columnGap) || 0;
  body.classList.add(...levelBefore);
  for (const [step, on] of userBefore) if (on) body.classList.add(USER_HIDE[step]!);
  return { available: bar.clientWidth, gap, sideGap, items, right: rightFull, shareShrink };
}

/** Плашка «Отменить / Повторить» под панелью инструментов (для любой стороны панели). */
function placeUndoDock(): void {
  const group = document.querySelector<HTMLElement>('.undo-group');
  const toolbar = document.getElementById('toolbar');
  if (!group || !document.body.classList.contains('fit-undo')) return;
  const w = group.offsetWidth;
  const h = group.offsetHeight;
  const root = document.documentElement.style;
  const r = toolbar && toolbar.offsetWidth ? toolbar.getBoundingClientRect() : null;
  let x = 12;
  let y = 72;
  if (r) {
    const pos = toolbar!.dataset.pos ?? 'left';
    if (pos === 'bottom') { x = r.left - 12 - w; y = r.bottom - h; }
    else if (pos === 'top') { x = r.left; y = r.bottom + 12; }
    else { x = r.left + (r.width - w) / 2; y = r.bottom + 12; } // слева и справа — по центру под панелью
  }
  x = Math.max(8, Math.min(x, window.innerWidth - w - 8));
  y = Math.max(8, Math.min(y, window.innerHeight - h - 8));
  root.setProperty('--undo-dock-x', `${Math.round(x)}px`);
  root.setProperty('--undo-dock-y', `${Math.round(y)}px`);
}

/** Пересчитать шапку сейчас. */
export function refitTopbar(): void {
  const input = measure();
  if (!input) return;
  const next = fitState(input);
  LEVEL_CLASSES.forEach((cls, i) => document.body.classList.toggle(cls, i < next.level));
  placeUndoDock();
  const changed = next.level !== current.level || [...next.noRoom].join() !== [...current.noRoom].join();
  current = next;
  // замер и применение сами меняют классы body: эти записи — не повод для нового пересчёта
  observer?.takeRecords();
  if (changed) document.dispatchEvent(new CustomEvent('topbar-fit'));
}

/** Пересчёт в следующем кадре; несколько поводов за кадр — один пересчёт. */
export function scheduleTopbarFit(): void {
  if (scheduled) return;
  scheduled = requestAnimationFrame(() => { scheduled = 0; refitTopbar(); });
}

/** Следить за шапкой: размер окна, содержимое шапки, классы body и положение панели инструментов. */
export function initTopbarFit(): void {
  const bar = document.getElementById('topbar');
  if (!bar) return;
  const ro = new ResizeObserver(scheduleTopbarFit);
  ro.observe(bar);
  for (const el of bar.querySelectorAll<HTMLElement>('.topbar-side, .topbar-side > *')) ro.observe(el);
  const toolbar = document.getElementById('toolbar');
  if (toolbar) ro.observe(toolbar);
  // движение аватаров в группе (стили кадров пружин) — не повод пересчитывать шапку; состав группы — повод
  const mo = observer = new MutationObserver(records => {
    if (records.some(r => !(r.type === 'attributes' && r.attributeName !== 'hidden' && r.target instanceof Element && r.target.closest('.avatar-group')))) scheduleTopbarFit();
  });
  mo.observe(bar, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['hidden', 'style', 'class'] });
  mo.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  if (toolbar) mo.observe(toolbar, { attributes: true, attributeFilter: ['data-pos', 'style', 'class'] });
  window.addEventListener('resize', scheduleTopbarFit);
  document.getElementById('page-name')?.addEventListener('input', scheduleTopbarFit);
  refitTopbar();
}
