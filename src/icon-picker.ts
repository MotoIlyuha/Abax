// Окно выбора иконки проекта, как в Miro: поиск, вкладки категорий, сетка эмодзи
// и загрузка своей картинки. Эмодзи (src/emoji-data.json, см. scripts/emoji.mjs) грузятся
// отдельным куском при первом открытии окна.

import { claimMenu, closeMenu, openMenu, releaseMenu, settleMenu } from './menu-motion';
import { CATEGORY_ICONS, UPLOAD_ICON } from './icons';

/** Категория → [эмодзи, «название и теги» в нижнем регистре]. */
type EmojiData = Record<string, [string, string][]>;

const CATEGORIES: { key: string; title: string; icon: string }[] = [
  { key: 's', title: 'Смайлы и люди', icon: CATEGORY_ICONS.s },
  { key: 'a', title: 'Животные и природа', icon: CATEGORY_ICONS.a },
  { key: 'f', title: 'Еда и напитки', icon: CATEGORY_ICONS.f },
  { key: 'c', title: 'Занятия и спорт', icon: CATEGORY_ICONS.c },
  { key: 't', title: 'Путешествия и места', icon: CATEGORY_ICONS.t },
  { key: 'o', title: 'Предметы', icon: CATEGORY_ICONS.o },
  { key: 'y', title: 'Символы', icon: CATEGORY_ICONS.y },
  { key: 'g', title: 'Флаги', icon: CATEGORY_ICONS.g },
];

/** Сторона загруженной картинки: иконке больше не нужно, а проект не раздувается. */
const UPLOAD_PX = 64;

let data: Promise<EmojiData> | null = null;

function loadEmoji(): Promise<EmojiData> {
  data ??= import('./emoji-data.json').then(m => m.default as unknown as EmojiData);
  return data;
}

/** Флаги стран Windows рисует буквами (в системном шрифте их нет) — там их не показываем. */
const HIDE_COUNTRY_FLAGS = typeof navigator !== 'undefined' && /Windows/i.test(navigator.userAgent);
const COUNTRY_FLAG = /[\u{1F1E6}-\u{1F1FF}\u{E0061}-\u{E007A}]/u;

let open: { el: HTMLElement; anchor: HTMLElement; off: () => void } | null = null;

export function iconPickerOpen(): boolean {
  return open !== null;
}

/** Закрыть окно; instant — без анимации (окно сменяется другим или меняется размер окна). */
export function closeIconPicker(instant = false): void {
  if (!open) return;
  const { el, off } = open;
  open = null;
  off();
  releaseMenu('icon');
  closeMenu(el, instant);
}

/** Картинка → квадрат UPLOAD_PX (обрезка по центру) в PNG; null — не прочиталась. */
async function fileToIcon(file: File): Promise<string | null> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    if (!side) return null;
    const cv = document.createElement('canvas');
    cv.width = cv.height = UPLOAD_PX;
    cv.getContext('2d')!.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, UPLOAD_PX, UPLOAD_PX);
    return cv.toDataURL('image/png');
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export interface IconPickerOptions {
  /** Подпись окна для чтения с экрана (по умолчанию «Иконка проекта»). */
  label?: string;
  /** Кнопка «Загрузить» своей картинки (по умолчанию есть). */
  upload?: boolean;
  /** Подсказка кнопки «Убрать». */
  removeTitle?: string;
  /** Окно открыто из модального окна (настройки, знакомство): поверх него. */
  overDialog?: boolean;
}

/**
 * Окно выбора иконки у anchor. onPick — эмодзи или картинка (data:image/png); null — убрать иконку.
 * Повторный вызов с тем же anchor закрывает окно.
 */
export function openIconPicker(anchor: HTMLElement, current: string | null, onPick: (icon: string | null) => void, opts: IconPickerOptions = {}): void {
  if (open?.anchor === anchor) { closeIconPicker(); return; }
  closeIconPicker(true);
  // прошлое окно ещё втягивается в свою кнопку — убираем его, чтобы id не повторялся
  for (const old of document.querySelectorAll<HTMLElement>('#icon-picker')) settleMenu(old);
  const el = document.createElement('div');
  el.id = 'icon-picker';
  el.className = opts.overDialog ? 'popup-menu ip-over-dialog' : 'popup-menu';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', opts.label ?? 'Иконка проекта');
  // клавиши поля поиска — окну, а не модальному окну под ним (src/settings-dialog.ts, src/onboarding.ts)
  el.dataset.ownKeys = '';

  const head = document.createElement('div');
  head.className = 'ip-head';
  const search = document.createElement('input');
  search.type = 'search';
  search.className = 'ip-search';
  search.placeholder = 'Поиск';
  search.spellcheck = false;
  search.autocomplete = 'off';
  head.appendChild(search);
  if (current) {
    const remove = document.createElement('button');
    remove.className = 'ip-remove';
    remove.textContent = 'Убрать';
    remove.title = opts.removeTitle ?? 'Убрать иконку';
    remove.addEventListener('click', () => { closeIconPicker(); onPick(null); });
    head.appendChild(remove);
  }

  const tabs = document.createElement('div');
  tabs.className = 'ip-tabs';
  tabs.setAttribute('role', 'tablist');
  const body = document.createElement('div');
  body.className = 'ip-body';
  const status = document.createElement('div');
  status.className = 'ip-status';
  status.textContent = 'Загрузка…';
  body.appendChild(status);

  const foot = document.createElement('div');
  foot.className = 'ip-foot';
  const upload = document.createElement('button');
  upload.className = 'ip-upload';
  upload.innerHTML = UPLOAD_ICON;
  upload.append('Загрузить');
  upload.title = 'Своя картинка: обрежется в квадрат';
  const file = document.createElement('input');
  file.type = 'file';
  file.accept = 'image/*';
  file.hidden = true;
  upload.addEventListener('click', () => file.click());
  file.addEventListener('change', () => {
    const f = file.files?.[0];
    if (!f) return;
    void fileToIcon(f).then(icon => {
      if (!icon) { alert('Не удалось прочитать изображение'); return; }
      closeIconPicker();
      onPick(icon);
    });
  });
  foot.append(upload, file);
  const withUpload = opts.upload !== false;
  el.append(head, tabs, body, ...(withUpload ? [foot] : []));
  document.body.appendChild(el);
  claimMenu('icon', () => closeIconPicker());
  openMenu(el, { from: anchor, place: () => place(el, anchor), remove: true, items: () => (withUpload ? [head, tabs, body, foot] : [head, tabs, body]) });

  const pick = (emoji: string) => { closeIconPicker(); onPick(emoji); };
  const emojiButton = ([emoji, words]: [string, string]): HTMLButtonElement => {
    const b = document.createElement('button');
    b.className = 'ip-emoji' + (emoji === current ? ' active' : '');
    b.textContent = emoji;
    b.title = words.split(' ').slice(0, 4).join(' ');
    b.addEventListener('click', () => pick(emoji));
    return b;
  };

  const tabButtons = new Map<string, HTMLButtonElement>();
  const sections = new Map<string, HTMLElement>();
  const grids = new Map<HTMLElement, { items: [string, string][]; start: number; end: number; columns: number }>();
  const rowHeight = 38;
  const renderGrids = () => {
    for (const [grid, view] of grids) {
      if (grid.parentElement?.hidden) continue;
      const columns = Math.max(1, Math.floor((grid.clientWidth || body.clientWidth || 342) / rowHeight));
      const rows = Math.ceil(view.items.length / columns);
      const top = grid.offsetTop;
      const startRow = Math.max(0, Math.min(rows, Math.floor((body.scrollTop - top) / rowHeight) - 2));
      const endRow = Math.max(startRow, Math.min(rows, Math.ceil((body.scrollTop + (body.clientHeight || 300) - top) / rowHeight) + 2));
      const start = startRow * columns, end = Math.min(view.items.length, endRow * columns);
      if (view.start === start && view.end === end && view.columns === columns) continue;
      view.start = start; view.end = end; view.columns = columns;
      grid.style.paddingTop = `${startRow * rowHeight}px`;
      grid.style.paddingBottom = `${(rows - endRow) * rowHeight}px`;
      const fragment = document.createDocumentFragment();
      for (const item of view.items.slice(start, end)) fragment.appendChild(emojiButton(item));
      grid.replaceChildren(fragment);
    }
  };
  const registerGrid = (grid: HTMLElement, items: [string, string][]) => {
    grids.set(grid, { items, start: -1, end: -1, columns: 0 });
  };
  let jumped = false;
  for (const c of CATEGORIES) {
    const t = document.createElement('button');
    t.className = 'ip-tab';
    t.title = c.title;
    t.innerHTML = c.icon;
    t.setAttribute('role', 'tab');
    t.addEventListener('click', () => {
      search.value = '';
      showSections();
      // offsetTop раздела — от .ip-body (у неё position: relative)
      const s = sections.get(c.key);
      const before = body.scrollTop;
      if (s) body.scrollTop = s.offsetTop;
      jumped = body.scrollTop !== before;
      markTab(c.key);
      renderGrids();
    });
    tabButtons.set(c.key, t);
    tabs.appendChild(t);
  }
  const markTab = (key: string) => {
    for (const [k, t] of tabButtons) t.setAttribute('aria-selected', String(k === key));
  };
  markTab(CATEGORIES[0].key);

  const results = document.createElement('div');
  results.className = 'ip-section ip-results';
  results.hidden = true;
  const showSections = () => {
    results.hidden = true;
    for (const s of sections.values()) s.hidden = false;
  };

  let all: [string, string][] = [];
  void loadEmoji().then(d => {
    if (open?.el !== el) return;
    status.remove();
    for (const c of CATEGORIES) {
      const list = (d[c.key] ?? []).filter(([e]) => !(HIDE_COUNTRY_FLAGS && COUNTRY_FLAG.test(e)));
      if (list.length === 0) { tabButtons.get(c.key)!.remove(); continue; }
      all = all.concat(list);
      const s = document.createElement('section');
      s.className = 'ip-section';
      s.dataset.cat = c.key;
      const h = document.createElement('div');
      h.className = 'ip-title';
      h.textContent = c.title;
      const grid = document.createElement('div');
      grid.className = 'ip-grid';
      registerGrid(grid, list);
      s.append(h, grid);
      sections.set(c.key, s);
      body.appendChild(s);
    }
    body.appendChild(results);
    renderGrids();
    // запрос набрали, пока эмодзи грузились, — ищем по нему теперь
    if (search.value.trim()) search.dispatchEvent(new Event('input'));
  });

  // подсветка вкладки — по прокрутке; докрутили до конца — последний раздел (он короче окна).
  // Прокрутку от клика по вкладке пропускаем: у конца списка раздел не встаёт наверх, а вкладка — та, что нажали
  body.addEventListener('scroll', () => {
    renderGrids();
    if (jumped) { jumped = false; return; }
    if (!results.hidden || sections.size === 0) return;
    let cur = CATEGORIES[0].key;
    for (const [k, s] of sections) if (s.offsetTop <= body.scrollTop + 8) cur = k;
    if (body.scrollTop + body.clientHeight >= body.scrollHeight - 2) cur = [...sections.keys()].pop()!;
    markTab(cur);
  });

  search.addEventListener('input', () => {
    const q = search.value.trim().toLowerCase();
    if (!q) { showSections(); renderGrids(); return; }
    for (const s of sections.values()) s.hidden = true;
    results.hidden = false;
    const previousGrid = results.querySelector<HTMLElement>('.ip-grid');
    if (previousGrid) grids.delete(previousGrid);
    results.textContent = '';
    // сначала те, чьё название начинается с запроса («ракета» — 🚀, потом 🧑‍🚀), затем совпадения с начала слова
    const rank = (words: string) => words.startsWith(q) ? 0 : (' ' + words).includes(' ' + q) ? 1 : 2;
    const found = all
      .filter(([e, words]) => e === q || words.includes(q))
      .map((item, i) => ({ item, r: rank(item[1]), i }))
      .sort((a, b) => a.r - b.r || a.i - b.i)
      .map(x => x.item);
    const h = document.createElement('div');
    h.className = 'ip-title';
    h.textContent = found.length ? 'Найдено' : 'Ничего не нашлось';
    const grid = document.createElement('div');
    grid.className = 'ip-grid';
    registerGrid(grid, found);
    results.append(h, grid);
    body.scrollTop = 0;
    renderGrids();
  });
  search.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      const first = results.hidden ? null : results.querySelector<HTMLButtonElement>('.ip-emoji');
      first?.click();
    } else if (e.key === 'Escape') {
      closeIconPicker();
    }
  });

  // клик мимо, Esc, прокрутка домашней или смена размера окна — закрыть
  const onDown = (e: PointerEvent) => {
    const t = e.target as Node;
    if (!el.contains(t) && !anchor.contains(t)) closeIconPicker();
  };
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeIconPicker(); };
  const onResize = () => closeIconPicker(true);
  document.addEventListener('pointerdown', onDown, true);
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('resize', onResize);
  open = {
    el, anchor,
    off: () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', onResize);
    },
  };
  search.focus();
}

/** Под кнопкой-вызовом (не влезает — над ней), в пределах окна. */
function place(el: HTMLElement, anchor: HTMLElement): void {
  const a = anchor.getBoundingClientRect();
  const w = el.offsetWidth, h = el.offsetHeight;
  const m = 8;
  // В шапке выравниваем панель по внешнему краю группы проекта.
  const group = anchor.closest('.project-group');
  const bounds = group ? group.getBoundingClientRect() : a;
  let left = bounds.left;
  let top = bounds.bottom + 6;
  if (top + h > window.innerHeight - m && bounds.top - 6 - h >= m) top = bounds.top - 6 - h;
  left = Math.max(m, Math.min(left, window.innerWidth - w - m));
  top = Math.max(m, Math.min(top, window.innerHeight - h - m));
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
}
