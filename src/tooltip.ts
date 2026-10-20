// Кастомные подсказки вместо нативных title: тёмный пузырь со стрелкой.
// Работает через делегирование — подхватывает любой элемент с атрибутом title,
// включая созданные динамически. title переносится в data-tip, чтобы браузер
// не показывал свою подсказку поверх нашей.

type Side = 'top' | 'bottom' | 'left' | 'right';

const SHOW_DELAY = 450;   // первая подсказка
const WARM_DELAY = 40;    // при переходе между соседними кнопками
const WARM_WINDOW = 500;  // сколько держится «тёплый» режим после скрытия
const GAP = 8;            // зазор между элементом и пузырём
const MARGIN = 6;         // отступ от края окна

let tipEl: HTMLDivElement | null = null;
let target: HTMLElement | null = null;
let showTimer = 0;
let hiddenAt = -Infinity;
let visible = false;

function ensureEl(): HTMLDivElement {
  if (!tipEl) {
    tipEl = document.createElement('div');
    tipEl.id = 'tooltip';
    tipEl.setAttribute('role', 'tooltip');
    document.body.appendChild(tipEl);
  }
  return tipEl;
}

/** Забирает title у элемента (и всех предков), возвращает ближайший элемент с подсказкой. */
function findTarget(start: EventTarget | null): HTMLElement | null {
  let el = start instanceof Element ? start : null;
  let found: HTMLElement | null = null;
  while (el && el !== document.body) {
    if (el instanceof HTMLElement || el instanceof SVGElement) {
      const t = el.getAttribute('title');
      if (t !== null) {
        el.removeAttribute('title');
        if (t) el.setAttribute('data-tip', t);
      }
      if (!found && el instanceof HTMLElement && el.dataset.tip) found = el;
    }
    el = el.parentElement;
  }
  return found;
}

/** «Отменить (Ctrl+Z)» → текст + хоткей отдельным приглушённым фрагментом. */
function render(el: HTMLDivElement, text: string): void {
  el.textContent = '';
  const m = /^(.+?)\s+\(((?:Ctrl|Shift|Alt|Del|[A-Z0-9])[^()]*)\)$/.exec(text);
  const label = document.createElement('span');
  label.textContent = m ? m[1] : text;
  el.appendChild(label);
  if (m) {
    const kbd = document.createElement('span');
    kbd.className = 'tooltip-kbd';
    kbd.textContent = m[2];
    el.appendChild(kbd);
  }
}

function preferredSide(el: HTMLElement): Side {
  const explicit = el.closest<HTMLElement>('[data-tip-side]')?.dataset.tipSide;
  if (explicit === 'top' || explicit === 'bottom' || explicit === 'left' || explicit === 'right') return explicit;
  const toolbar = el.closest<HTMLElement>('#toolbar');
  if (toolbar) {
    const pos = toolbar.dataset.pos;
    if (pos === 'left') return 'right';
    if (pos === 'right') return 'left';
    if (pos === 'bottom') return 'top';
  }
  return 'bottom';
}

const OPPOSITE: Record<Side, Side> = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };

function place(el: HTMLDivElement, anchor: HTMLElement): void {
  const r = anchor.getBoundingClientRect();
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const fits = (s: Side): boolean =>
    s === 'right' ? r.right + GAP + w <= vw - MARGIN
    : s === 'left' ? r.left - GAP - w >= MARGIN
    : s === 'bottom' ? r.bottom + GAP + h <= vh - MARGIN
    : r.top - GAP - h >= MARGIN;
  let side = preferredSide(anchor);
  if (!fits(side) && fits(OPPOSITE[side])) side = OPPOSITE[side];

  let left: number;
  let top: number;
  if (side === 'left' || side === 'right') {
    left = side === 'right' ? r.right + GAP : r.left - GAP - w;
    top = r.top + r.height / 2 - h / 2;
  } else {
    left = r.left + r.width / 2 - w / 2;
    top = side === 'bottom' ? r.bottom + GAP : r.top - GAP - h;
  }
  const cl = Math.max(MARGIN, Math.min(left, vw - w - MARGIN));
  const ct = Math.max(MARGIN, Math.min(top, vh - h - MARGIN));
  // стрелка остаётся напротив центра элемента, даже если пузырь прижат к краю
  if (side === 'left' || side === 'right') {
    el.style.setProperty('--arrow', `${Math.max(8, Math.min(h - 8, r.top + r.height / 2 - ct))}px`);
  } else {
    el.style.setProperty('--arrow', `${Math.max(8, Math.min(w - 8, r.left + r.width / 2 - cl))}px`);
  }
  el.dataset.side = side;
  el.style.left = `${Math.round(cl)}px`;
  el.style.top = `${Math.round(ct)}px`;
}

function show(): void {
  if (!target || !target.isConnected || !target.dataset.tip) return;
  const el = ensureEl();
  render(el, target.dataset.tip);
  el.classList.remove('show');
  el.style.left = '-9999px';
  el.style.top = '-9999px';
  el.hidden = false;
  place(el, target);
  el.classList.add('show');
  visible = true;
}

function hide(): void {
  clearTimeout(showTimer);
  if (visible) hiddenAt = performance.now();
  visible = false;
  target = null;
  if (tipEl) {
    tipEl.classList.remove('show');
    tipEl.hidden = true;
  }
}

export function initTooltips(): void {
  document.addEventListener('pointerover', (e) => {
    if (e.pointerType === 'touch') return;
    const t = findTarget(e.target);
    if (t === target) return;
    const warm = visible || performance.now() - hiddenAt < WARM_WINDOW;
    hide();
    if (!t) return;
    target = t;
    showTimer = window.setTimeout(show, warm ? WARM_DELAY : SHOW_DELAY);
  });
  document.addEventListener('pointerout', (e) => {
    if (!target) return;
    const to = e.relatedTarget;
    if (to instanceof Node && target.contains(to)) return;
    hide();
  });
  // нажатие, прокрутка, клавиатура — подсказка больше не нужна
  document.addEventListener('pointerdown', () => { hide(); hiddenAt = -Infinity; }, true);
  document.addEventListener('wheel', hide, { capture: true, passive: true });
  document.addEventListener('keydown', hide, true);
  window.addEventListener('blur', hide);
  window.addEventListener('resize', hide);
}
